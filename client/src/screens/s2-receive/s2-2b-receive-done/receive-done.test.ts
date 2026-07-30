// S2.2b receive done — the rules this screen repeats, tested.
//
// NOTHING HERE RENDERS. There is no browser or component harness in this repo and
// adding one (jsdom, a renderer) would be a dependency no lane may add
// (build-plan §3/D5), so the screen's decisions were written as functions of
// plain records precisely so they could be tested at all.
//
// These are communication-only rules — `server/test/receive.test.ts` covers I11
// and I12 where they are actually enforced, against the migrated database. The
// three a wrong client answer would break silently:
//
//   §3.2   a skipped stop prints "skipped", never "0 lb"
//   I12    the action is offered only when the server says the run is ready
//   A165   a weight is a decimal STRING and is never routed through a number
//
// Run: npx vitest run --root client

import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../api/index.ts';
import { RECEIVE_STOP_STATES } from '../../../api/shared.ts';
import type { ReceiveDoneLine, ReceiveDoneSummary } from '../../../api/shared.ts';
import {
  COPY,
  FORBIDDEN_IN_COPY,
  canFinish,
  doneNotice,
  formatWeight,
  isResolved,
  lineStatus,
  messageFor,
  outstandingLines,
  runTitle,
  shouldReloadAfter,
  weightWithUnit,
} from './receive-done.ts';

// ---------------------------------------------------------------------------

function line(over: Partial<ReceiveDoneLine> = {}): ReceiveDoneLine {
  return { donorName: "Sam's", state: 'WEIGHED', total: '2192.00', ...over };
}

function summary(over: Partial<ReceiveDoneSummary> = {}): ReceiveDoneSummary {
  return {
    shiftId: 'shift-1',
    routeName: 'Tue AM run',
    ownerName: 'Karen',
    lines: [line()],
    runTotal: '2192.00',
    readyForReceiveDone: true,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Weights (A165)
// ---------------------------------------------------------------------------

describe('formatWeight', () => {
  it('drops a whole-number fraction', () => {
    expect(formatWeight('2192.00')).toBe('2192');
    expect(formatWeight('0.00')).toBe('0');
  });

  it('keeps a real fraction and trims only trailing zeros', () => {
    expect(formatWeight('12.50')).toBe('12.5');
    expect(formatWeight('12.05')).toBe('12.05');
    expect(formatWeight('1222.35')).toBe('1222.35');
  });

  it('leaves a value with no point alone', () => {
    expect(formatWeight('640')).toBe('640');
  });

  it('never routes the value through a JS number', () => {
    // The point of the string: 1222.35 is not representable in binary floating
    // point, so `String(Number(x))` is a coin flip on any given value and this
    // column feeds the NTFB report.
    const exact = '99999.99';
    expect(formatWeight(exact)).toBe('99999.99');
    expect(weightWithUnit(exact)).toBe('99999.99 lb');
  });

  it('always shows the unit (§7)', () => {
    expect(weightWithUnit('2192.00')).toBe('2192 lb');
  });
});

// ---------------------------------------------------------------------------
// Line status (§3.2 — skipped is not zero)
// ---------------------------------------------------------------------------

describe('lineStatus', () => {
  it('prints a weighed stop with its total', () => {
    expect(lineStatus(line({ total: '2192.00' }))).toBe('weighed, 2192 lb');
  });

  it('prints "skipped" for a skipped stop, never "0 lb"', () => {
    const skipped = lineStatus(line({ state: 'SKIPPED', total: null }));
    expect(skipped).toBe('skipped');
    expect(skipped).not.toContain('0');
    expect(skipped).not.toContain('lb');
  });

  it('names a stop staff moved to another driver', () => {
    expect(lineStatus(line({ state: 'REASSIGNED', total: null }))).toBe(
      'moved to another driver',
    );
  });

  it('says what is missing for each unresolved state', () => {
    expect(lineStatus(line({ state: 'PENDING', total: null }))).toBe('not picked up yet');
    expect(lineStatus(line({ state: 'COLLECTED', total: null }))).toBe(
      'picked up, not weighed yet',
    );
  });

  it('has a sentence for every state the wire can carry', () => {
    for (const state of RECEIVE_STOP_STATES) {
      expect(lineStatus(line({ state, total: null })).length).toBeGreaterThan(0);
    }
  });

  it('survives a weighed stop the server reports with no total', () => {
    // Should not happen — a WEIGHED stop has a non-voided row by definition — but
    // "weighed, null lb" is the kind of thing that ships if nobody says otherwise.
    expect(lineStatus(line({ state: 'WEIGHED', total: null }))).toBe('weighed');
  });
});

// ---------------------------------------------------------------------------
// The completion gate (I12)
// ---------------------------------------------------------------------------

describe('the gate', () => {
  it('admits exactly the three states I12 names', () => {
    expect(isResolved('WEIGHED')).toBe(true);
    expect(isResolved('SKIPPED')).toBe(true);
    expect(isResolved('REASSIGNED')).toBe(true);
    expect(isResolved('PENDING')).toBe(false);
    expect(isResolved('COLLECTED')).toBe(false);
  });

  it('offers the action only when the server says the run is ready', () => {
    expect(canFinish(summary({ readyForReceiveDone: true }))).toBe(true);
    expect(canFinish(summary({ readyForReceiveDone: false }))).toBe(false);
  });

  it('does not second-guess the server by re-deriving the gate', () => {
    // WEIGHED is a read-time projection over non-voided weight rows (I12) and the
    // client cannot see them. A run whose lines all read resolved but which the
    // server calls unready must stay unready here.
    const disagreeing = summary({
      lines: [line({ state: 'WEIGHED' })],
      readyForReceiveDone: false,
    });
    expect(canFinish(disagreeing)).toBe(false);
  });

  it('closes a run with no stops at all', () => {
    expect(canFinish(summary({ lines: [], runTotal: '0.00' }))).toBe(true);
  });

  it('lists only the stops still holding the run open', () => {
    const mixed = summary({
      readyForReceiveDone: false,
      lines: [
        line({ donorName: "Sam's", state: 'WEIGHED' }),
        line({ donorName: 'Kroger', state: 'COLLECTED', total: null }),
        line({ donorName: 'Aldi', state: 'SKIPPED', total: null }),
        line({ donorName: 'Walmart', state: 'PENDING', total: null }),
      ],
    });
    expect(outstandingLines(mixed).map((l) => l.donorName)).toEqual(['Kroger', 'Walmart']);
  });
});

// ---------------------------------------------------------------------------
// Titles and the closing notice
// ---------------------------------------------------------------------------

describe('runTitle', () => {
  it('reads as the driver’s run', () => {
    expect(runTitle({ routeName: 'Tue AM run', ownerName: 'Karen' })).toBe("Karen's Tue AM run");
  });

  it('falls back to the route when nobody owns it', () => {
    expect(runTitle({ routeName: 'Tue AM run', ownerName: null })).toBe('Tue AM run');
  });
});

describe('doneNotice', () => {
  it('says only that the run finished when nothing was dropped', () => {
    expect(doneNotice(0)).toBe('Run finished.');
  });

  it('tells the receiver when a driver’s prefill was dropped (I17)', () => {
    // Purging is inline in the receive-done transaction. A prefill vanishing
    // silently reads as data loss to the one person who could still have acted.
    expect(doneNotice(1)).toContain('One flagged extra pickup was dropped');
    expect(doneNotice(3)).toContain('3 flagged extra pickups were dropped');
  });

  it('keeps its grammar in both directions', () => {
    expect(doneNotice(1)).toContain('weighed it.');
    expect(doneNotice(2)).toContain('weighed them.');
  });
});

// ---------------------------------------------------------------------------
// Errors (§6)
// ---------------------------------------------------------------------------

describe('errors', () => {
  it('prefers the server’s own sentence', () => {
    const refusal = new ApiError('conflict', { detail: 'Every stop needs a weight or a skip.' });
    expect(messageFor(refusal)).toBe('Every stop needs a weight or a skip.');
  });

  it('falls back to the plain per-kind message, never a code', () => {
    const message = messageFor(new ApiError('server', { correlationId: 'abc-123' }));
    expect(message.length).toBeGreaterThan(0);
    expect(message).not.toContain('abc-123');
    expect(message).not.toContain('500');
  });

  it('re-reads when someone else changed the run first', () => {
    expect(shouldReloadAfter(new ApiError('conflict'))).toBe(true);
    expect(shouldReloadAfter(new ApiError('not-found'))).toBe(true);
    expect(shouldReloadAfter(new ApiError('offline'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Copy (§7)
// ---------------------------------------------------------------------------

describe('microcopy', () => {
  const sentences = Object.values(COPY);

  it('says something everywhere', () => {
    for (const sentence of sentences) expect(sentence.length).toBeGreaterThan(0);
  });

  it('uses no forbidden word', () => {
    for (const sentence of sentences) {
      for (const word of FORBIDDEN_IN_COPY) {
        expect(sentence.toLowerCase()).not.toContain(word);
      }
    }
  });

  it('never promises an undo', () => {
    // Receive-done is the one completion action and it has no reversal (I11). A
    // correction afterwards is the void-and-reweigh path, on another screen.
    for (const sentence of sentences) {
      expect(sentence.toLowerCase()).not.toContain('undo');
      expect(sentence.toLowerCase()).not.toContain('reopen');
    }
  });
});
