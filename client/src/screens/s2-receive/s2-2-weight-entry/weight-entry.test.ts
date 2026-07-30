// S2.2 weight entry — the rules this screen repeats, tested.
//
// NOTHING HERE RENDERS. There is no browser or component harness in this repo
// and adding one (jsdom, a renderer) would be a dependency a lane may not add
// (`phase-2-build-plan.md §3`), so the screen's decisions were written as
// functions of plain records precisely so they could be tested at all. What is
// NOT covered is stated in this lane's report rather than implied by a green
// suite.
//
// These are communication-only rules — `server/test/receive.test.ts` covers the
// same invariants where they are actually enforced, against the migrated
// database. Three things here would break silently if the client got them wrong:
//
//   A165  a weight is a decimal string end to end. A float round trip would be
//         invisible until an NTFB report was off by a cent-scale rounding.
//   I12   `WEIGHED` is derived. "Mark stop weighed" navigates; nothing on this
//         screen writes a stop's state.
//   I13   a correction is void + insert underneath, and the UI must never say so.
//
// Run: npx vitest run --root client

import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../api/index.ts';
import { RECEIVE_STOP_STATES } from '../../../api/shared.ts';
import type {
  CategoryTile,
  ReceiveStopDetail,
  ReceiveStopState,
  ReceiveStopSummary,
  WeightEntrySummary,
} from '../../../api/shared.ts';
import {
  COPY,
  FORBIDDEN_EDIT_WORDS,
  FORBIDDEN_IN_COPY,
  KEYPAD_MAX_DIGITS,
  acceptKeypadValue,
  advanceTargetFor,
  allStopsResolved,
  applyStopState,
  canAddWeight,
  canSkipStop,
  findEntry,
  formatPounds,
  formatWeight,
  hasUnsavedEntry,
  hasWeights,
  isResolved,
  leaveDecision,
  messageFor,
  nextUnresolvedStop,
  normalizeWeight,
  orderedStops,
  orderedTiles,
  progressLabel,
  progressOf,
  sheetIsOpen,
  shouldReloadAfter,
  stopStateLabel,
  stopStateMark,
} from './weight-entry.ts';

// ---------------------------------------------------------------------------

function entry(over: Partial<WeightEntrySummary> = {}): WeightEntrySummary {
  return {
    id: 'entry-1',
    weight: '61.00',
    note: null,
    createdAt: '2026-07-28T18:00:00.000Z',
    createdByName: 'Karen Diaz',
    ...over,
  };
}

function tile(over: Partial<CategoryTile> = {}): CategoryTile {
  return {
    categoryId: 'cat-1',
    categoryName: 'Produce',
    entries: [],
    subtotal: '0.00',
    ...over,
  };
}

function detail(over: Partial<ReceiveStopDetail> = {}): ReceiveStopDetail {
  return {
    shiftId: 'shift-1',
    stopId: 'stop-1',
    donorId: 'donor-1',
    donorName: "Sam's",
    state: 'COLLECTED',
    stopNote: null,
    donorNote: null,
    runNote: null,
    tiles: [tile()],
    stopTotal: '0.00',
    ...over,
  };
}

function stop(over: Partial<ReceiveStopSummary> = {}): ReceiveStopSummary {
  return {
    id: 'stop-1',
    donorId: 'donor-1',
    donorName: "Sam's",
    position: 0,
    state: 'PENDING',
    ...over,
  };
}

/** Stops in order, with the states given. */
function strip(...states: ReceiveStopState[]): ReceiveStopSummary[] {
  return states.map((state, index) =>
    stop({
      id: `stop-${index + 1}`,
      donorId: `donor-${index + 1}`,
      donorName: `Store ${index + 1}`,
      position: index,
      state,
    }),
  );
}

// ---------------------------------------------------------------------------
// A165 — a weight is a string, from the keypad to the wire
// ---------------------------------------------------------------------------

describe('A165 — weights never become numbers', () => {
  it('sends back exactly the digits that were typed', () => {
    // A float round trip is the failure this guards: `numeric(8,2)` is exact and
    // a JS number is not, so a value that is not binary-representable would come
    // back subtly wrong in the column that feeds the NTFB report.
    for (const typed of ['1222.35', '0.07', '10.10', '999999.99', '12.30', '3']) {
      expect(normalizeWeight(typed)).toBe(typed);
    }
  });

  it('keeps a trailing zero a scale actually printed', () => {
    // `12.30` through a number and back is `12.3`. The digits sent are the digits
    // typed.
    expect(normalizeWeight('12.30')).toBe('12.30');
  });

  it('drops only the half-typed decimal point', () => {
    expect(normalizeWeight('12.')).toBe('12');
    expect(normalizeWeight('0.')).toBe('0');
    expect(normalizeWeight(' 45 ')).toBe('45');
  });

  it('drops a leading zero the keypad let through', () => {
    expect(normalizeWeight('07')).toBe('7');
    expect(normalizeWeight('0.5')).toBe('0.5');
    expect(normalizeWeight('0')).toBe('0');
  });
});

describe('the keypad accepts what numeric(8,2) can hold', () => {
  it('takes digits', () => {
    expect(acceptKeypadValue('51', '516')).toBe('516');
  });

  it('takes a decimal point and two places — scales read in tenths', () => {
    expect(acceptKeypadValue('12', '12.')).toBe('12.');
    expect(acceptKeypadValue('12.', '12.3')).toBe('12.3');
    expect(acceptKeypadValue('12.3', '12.35')).toBe('12.35');
  });

  it('refuses a third decimal place instead of silently rounding it', () => {
    expect(acceptKeypadValue('12.35', '12.351')).toBe('12.35');
  });

  it('refuses a seventh whole digit — the column holds six', () => {
    expect(acceptKeypadValue('999999', '9999999')).toBe('999999');
    expect(acceptKeypadValue('999999', '999999.9')).toBe('999999.9');
  });

  it('normalises the leading zero the keypad produces', () => {
    expect(acceptKeypadValue('0', '07')).toBe('7');
    // `.` pressed first gives `0.`, which is a legal thing to be mid-typing.
    expect(acceptKeypadValue('', '0.')).toBe('0.');
  });

  it('clears to empty on backspace', () => {
    expect(acceptKeypadValue('5', '')).toBe('');
  });

  it('refuses anything that is not a number being typed', () => {
    expect(acceptKeypadValue('12', '12..')).toBe('12');
    expect(acceptKeypadValue('12', '12a')).toBe('12');
    expect(acceptKeypadValue('12', '-12')).toBe('12');
  });

  it('caps the keypad at the digits the column holds', () => {
    expect(KEYPAD_MAX_DIGITS).toBe(8);
  });
});

describe('"Add weight" is offered only for a weight', () => {
  it('takes a plain number', () => {
    expect(canAddWeight('516')).toBe(true);
    expect(canAddWeight('12.35')).toBe(true);
    expect(canAddWeight('12.')).toBe(true);
  });

  it('takes zero — refusing it would be a rule this screen invented', () => {
    expect(canAddWeight('0')).toBe(true);
  });

  it('refuses nothing at all', () => {
    expect(canAddWeight('')).toBe(false);
    expect(canAddWeight('   ')).toBe(false);
    expect(canAddWeight('.')).toBe(false);
  });

  it('refuses more than the column holds', () => {
    expect(canAddWeight('1234567')).toBe(false);
    expect(canAddWeight('12.345')).toBe(false);
  });
});

describe('weights on screen', () => {
  it('reads like the paper sheet did', () => {
    expect(formatWeight('293.00')).toBe('293');
    expect(formatWeight('12.50')).toBe('12.5');
    expect(formatWeight('1222.35')).toBe('1222.35');
    expect(formatWeight('0.00')).toBe('0');
  });

  it('always shows the unit (§7)', () => {
    expect(formatPounds('2192.00')).toBe('2192 lb');
  });

  it('shows an unreadable value as it arrived rather than guessing', () => {
    expect(formatWeight('not a weight')).toBe('not a weight');
  });
});

// ---------------------------------------------------------------------------
// The tiles
// ---------------------------------------------------------------------------

describe('tile order never moves under the hand', () => {
  const tiles = [
    tile({ categoryId: 'c-produce', categoryName: 'Produce', subtotal: '1222.00' }),
    tile({ categoryId: 'c-bakery', categoryName: 'Bakery', subtotal: '323.00' }),
    tile({ categoryId: 'c-dairy', categoryName: 'Dairy', subtotal: '0.00' }),
  ];

  it('is alphabetical, matching what the server already returns', () => {
    expect(orderedTiles(tiles).map((t) => t.categoryName)).toEqual([
      'Bakery',
      'Dairy',
      'Produce',
    ]);
  });

  it('does not depend on subtotals or on entries', () => {
    // The one thing this screen must never do to an older volunteer: move the
    // target between one weight and the next.
    const before = orderedTiles(tiles).map((t) => t.categoryId);
    const busier = tiles.map((t) =>
      t.categoryId === 'c-dairy'
        ? { ...t, subtotal: '99999.00', entries: [entry({ id: 'e-9', weight: '99999.00' })] }
        : t,
    );
    expect(orderedTiles(busier).map((t) => t.categoryId)).toEqual(before);
  });

  it('gives a category archived mid-run a fixed place too', () => {
    // `readStopSheet` appends a category archived after its entries were logged,
    // so without this it would sit last and jump when a tile was added.
    const withArchived = [...tiles, tile({ categoryId: 'c-deli', categoryName: 'Deli' })];
    expect(orderedTiles(withArchived).map((t) => t.categoryName)).toEqual([
      'Bakery',
      'Dairy',
      'Deli',
      'Produce',
    ]);
  });

  it('renders from the tiles it is given, not from a list of names', () => {
    // The 11 AGFP categories are seed data, not client code (S1.8/S2.2).
    const one = orderedTiles([tile({ categoryName: 'Rescue misc' })]);
    expect(one).toHaveLength(1);
    expect(one[0]?.categoryName).toBe('Rescue misc');
  });
});

describe('what the stop has on it', () => {
  it('knows when nothing has been weighed', () => {
    expect(hasWeights(detail())).toBe(false);
    expect(hasWeights(detail({ tiles: [tile({ entries: [entry()] })] }))).toBe(true);
  });

  it('finds one entry across the tiles for the ✎', () => {
    const sheet = detail({
      tiles: [
        tile({ categoryId: 'c-1', categoryName: 'Bakery', entries: [entry({ id: 'e-1' })] }),
        tile({ categoryId: 'c-2', categoryName: 'Produce', entries: [entry({ id: 'e-2' })] }),
      ],
    });
    expect(findEntry(sheet, 'e-2')?.tile.categoryName).toBe('Produce');
    expect(findEntry(sheet, 'nope')).toBeNull();
  });

  it("takes numbers while the stop is the receiver's to weigh", () => {
    expect(sheetIsOpen(detail({ state: 'PENDING' }))).toBe(true);
    expect(sheetIsOpen(detail({ state: 'COLLECTED' }))).toBe(true);
    expect(sheetIsOpen(detail({ state: 'WEIGHED' }))).toBe(true);
  });

  it('takes none once the stop is skipped or moved', () => {
    // SKIPPED cannot be undone from here (S2.2); REASSIGNED is another run's
    // now and the server refuses every write on it (I30).
    expect(sheetIsOpen(detail({ state: 'SKIPPED' }))).toBe(false);
    expect(sheetIsOpen(detail({ state: 'REASSIGNED' }))).toBe(false);
  });

  it('offers Skip only for a stop with nothing on it', () => {
    // The server refuses a skip once a non-voided weight exists ("Remove them
    // before skipping it"), so offering it would be offering a refusal.
    expect(canSkipStop(detail())).toBe(true);
    expect(canSkipStop(detail({ tiles: [tile({ entries: [entry()] })] }))).toBe(false);
    expect(canSkipStop(detail({ state: 'SKIPPED' }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// I12 — the strip, and where "Mark stop weighed" goes
// ---------------------------------------------------------------------------

describe('I12 — which states are resolved', () => {
  it('counts exactly WEIGHED, SKIPPED and REASSIGNED', () => {
    const resolved = RECEIVE_STOP_STATES.filter(isResolved);
    expect([...resolved].sort()).toEqual(['REASSIGNED', 'SKIPPED', 'WEIGHED']);
  });

  it('leaves a COLLECTED stop outstanding — the driver picked it up, nobody weighed it', () => {
    expect(isResolved('COLLECTED')).toBe(false);
    expect(isResolved('PENDING')).toBe(false);
  });

  it('counts the run', () => {
    expect(progressOf(strip('WEIGHED', 'PENDING', 'SKIPPED'))).toEqual({ done: 2, total: 3 });
    expect(progressLabel(strip('WEIGHED', 'PENDING', 'SKIPPED'))).toBe('2 of 3 done');
  });

  it('is only "all done" when there is something to be done', () => {
    expect(allStopsResolved(strip('WEIGHED', 'SKIPPED', 'REASSIGNED'))).toBe(true);
    expect(allStopsResolved(strip('WEIGHED', 'COLLECTED'))).toBe(false);
    // An empty strip has not loaded; it is not a finished run.
    expect(allStopsResolved([])).toBe(false);
  });

  it('orders the strip by position, whatever order it arrived in', () => {
    const shuffled = [stop({ id: 'b', position: 2 }), stop({ id: 'a', position: 1 })];
    expect(orderedStops(shuffled).map((s) => s.id)).toEqual(['a', 'b']);
  });
});

describe('the next stop to weigh', () => {
  it('is the next one along that still wants a weight', () => {
    const stops = strip('WEIGHED', 'PENDING', 'COLLECTED');
    expect(nextUnresolvedStop(stops, 'stop-1')?.id).toBe('stop-2');
  });

  it('skips the ones already resolved', () => {
    const stops = strip('WEIGHED', 'SKIPPED', 'COLLECTED');
    expect(nextUnresolvedStop(stops, 'stop-1')?.id).toBe('stop-3');
  });

  it('wraps to the top, so a stop left behind is not stranded', () => {
    const stops = strip('PENDING', 'WEIGHED', 'WEIGHED');
    expect(nextUnresolvedStop(stops, 'stop-3')?.id).toBe('stop-1');
  });

  it('never returns the stop being weighed', () => {
    const stops = strip('COLLECTED', 'WEIGHED');
    expect(nextUnresolvedStop(stops, 'stop-1')).toBeNull();
  });

  it('is nothing when every stop is resolved', () => {
    expect(nextUnresolvedStop(strip('WEIGHED', 'SKIPPED'), 'stop-1')).toBeNull();
  });
});

describe('"Mark stop weighed" only navigates (I12)', () => {
  it('goes to the next stop that wants a weight', () => {
    const target = advanceTargetFor(strip('WEIGHED', 'COLLECTED'), 'stop-1');
    expect(target).toEqual({ kind: 'stop', stop: expect.objectContaining({ id: 'stop-2' }) });
  });

  it('goes to Receive done once the whole run is resolved', () => {
    // S2.2b is the one completion action (I11) and the run cannot close without
    // it — so a fully-weighed run has to be able to reach it from here.
    expect(advanceTargetFor(strip('WEIGHED', 'SKIPPED'), 'stop-1')).toEqual({
      kind: 'receive-done',
    });
  });

  it('stays put rather than stranding an unweighed stop', () => {
    // Nothing else is unresolved, but this stop is not resolved either. Leaving
    // would drop it out of sight while it still blocks the run.
    expect(advanceTargetFor(strip('COLLECTED', 'WEIGHED'), 'stop-1')).toEqual({ kind: 'stay' });
    expect(advanceTargetFor([], 'stop-1')).toEqual({ kind: 'stay' });
  });
});

describe('the strip re-reads from the same response as the sheet', () => {
  it('folds the new state in without a second request', () => {
    const stops = strip('COLLECTED', 'PENDING');
    const updated = applyStopState(stops, 'stop-1', 'WEIGHED');
    expect(updated[0]?.state).toBe('WEIGHED');
    expect(updated[1]?.state).toBe('PENDING');
  });

  it('leaves the list alone when the stop is not on it', () => {
    const stops = strip('COLLECTED');
    expect(applyStopState(stops, 'elsewhere', 'WEIGHED')).toEqual(stops);
  });
});

describe('what a stop says to a receiver', () => {
  it('says "to weigh" for both unresolved states', () => {
    // PENDING vs COLLECTED is whether the driver checked it off — the driver's
    // business, not the person at the tablet's.
    expect(stopStateLabel('PENDING')).toBe(stopStateLabel('COLLECTED'));
    expect(stopStateLabel('PENDING')).toBe(COPY.stateToWeigh);
  });

  it('has a word and a mark for every state that can arrive', () => {
    for (const state of RECEIVE_STOP_STATES) {
      expect(stopStateLabel(state).length).toBeGreaterThan(0);
      expect(stopStateMark(state).length).toBeGreaterThan(0);
    }
  });

  it('never says a stop is weighed unless it is', () => {
    expect(stopStateLabel('COLLECTED')).not.toBe(COPY.stateWeighed);
  });
});

// ---------------------------------------------------------------------------
// Leaving mid-entry (S2.2's edge case)
// ---------------------------------------------------------------------------

describe('leaving with a number still on the keypad warns', () => {
  it('warns when something is typed', () => {
    expect(hasUnsavedEntry('516')).toBe(true);
    expect(leaveDecision('516')).toBe('warn');
    expect(leaveDecision('0.')).toBe('warn');
  });

  it('goes straight there when nothing is', () => {
    expect(hasUnsavedEntry('')).toBe(false);
    expect(hasUnsavedEntry('  ')).toBe(false);
    expect(leaveDecision('')).toBe('go');
  });
});

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

describe('errors', () => {
  it("prefers the server's own sentence when it sent one", () => {
    const refusal = new ApiError('conflict', {
      detail: 'That stop already has weights. Remove them before skipping it.',
    });
    expect(messageFor(refusal)).toBe(
      'That stop already has weights. Remove them before skipping it.',
    );
  });

  it('falls back to the plain per-kind message, never a code', () => {
    expect(messageFor(new ApiError('offline'))).toBe("You're offline. R3 needs a connection.");
    expect(messageFor(new Error('boom'))).not.toContain('boom');
  });

  it('re-reads the sheet when someone else got there first', () => {
    // Two receivers on one run is the expected case (S2.1b), so a conflict is a
    // cue to re-read rather than an error to sit on.
    expect(shouldReloadAfter(new ApiError('conflict'))).toBe(true);
    expect(shouldReloadAfter(new ApiError('not-found'))).toBe(true);
    expect(shouldReloadAfter(new ApiError('offline'))).toBe(false);
    expect(shouldReloadAfter(new ApiError('invalid'))).toBe(false);
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

  it('uses no forbidden word (§7)', () => {
    for (const sentence of sentences) {
      for (const word of FORBIDDEN_IN_COPY) {
        expect(sentence.toLowerCase()).not.toContain(word);
      }
    }
  });

  it('never says how a correction is stored (I13)', () => {
    // To the receiver, editing a weight replaces a number and that is the whole
    // story. The void-and-reinsert underneath is the server's business.
    for (const sentence of sentences) {
      for (const word of FORBIDDEN_EDIT_WORDS) {
        expect(sentence.toLowerCase()).not.toContain(word);
      }
    }
  });

  it('names the consequence on both confirms that cannot be taken back (§6)', () => {
    expect(COPY.skipQuestion).toMatch(/\?$/);
    expect(COPY.skipConsequence.toLowerCase()).toContain('cannot');
    expect(COPY.removeQuestion).toMatch(/\?$/);
    expect(COPY.removeConsequence.toLowerCase()).toContain('cannot');
  });

  it('never claims this screen closes the run (I11)', () => {
    // Receive done is the one completion action, one screen along. Nothing here
    // may imply the run is finished — including "Mark stop weighed", which
    // resolves nothing (I12).
    for (const sentence of sentences) {
      expect(sentence).not.toMatch(/\b(finish|complete|clos(e|ing))\s+(the\s+|this\s+)?run\b/i);
      expect(sentence).not.toMatch(/run is (over|done|finished|complete)/i);
    }
  });

  it('shows the unit on the sheet (§7)', () => {
    expect(COPY.unit).toBe('lb');
  });
});
