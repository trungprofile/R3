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
//   I12   `WEIGHED` is derived. "Done" navigates; nothing on this screen writes
//         a stop's state.
//   I13   a correction is void + insert underneath, and the UI must never say so.
//
// Run: npx vitest run --root client

import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../api/index.ts';
import { RECEIVE_INCOMPLETE_MESSAGE, RECEIVE_STOP_STATES } from '../../../api/shared.ts';
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
  ENTRIES_ALWAYS_VISIBLE,
  KEYPAD_MAX_DIGITS,
  acceptKeypadValue,
  advanceTargetFor,
  allStopsResolved,
  applyStopState,
  canAddWeight,
  canSkipStop,
  entryCountLabel,
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
  outstandingStops,
  progressLabel,
  progressOf,
  sheetIsOpen,
  shouldReloadAfter,
  stopStateLabel,
  stopStateMark,
  submitDecision,
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
    driverName: 'Karen Diaz',
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

// ---------------------------------------------------------------------------
// `D45` — a busy category stops resizing the screen
// ---------------------------------------------------------------------------

describe('a busy category says how many numbers it holds', () => {
  /** N entries with distinct ids, so the list is a real list. */
  const entries = (count: number) =>
    Array.from({ length: count }, (_, index) => entry({ id: `e-${index}` }));

  it('says nothing while nothing can be hidden', () => {
    // The entry list is capped at two chip rows and scrolls inside them. Two is
    // the fewest chips two rows can ever hold, so at or below that the receiver
    // is definitely seeing everything and a count would be noise.
    expect(entryCountLabel([])).toBeNull();
    expect(entryCountLabel(entries(1))).toBeNull();
    expect(entryCountLabel(entries(ENTRIES_ALWAYS_VISIBLE))).toBeNull();
  });

  it('counts them once the row may be showing fewer than it has', () => {
    // The affordance for a scroll region that has none of its own — without it
    // the cap is a trap, because numbers vanish with nothing saying they did.
    expect(entryCountLabel(entries(3))).toBe('3 entries');
    expect(entryCountLabel(entries(20))).toBe('20 entries');
  });

  it('is a floor, not a measurement', () => {
    // How many chips actually fit is a function of the digits typed into them and
    // the pane's width, neither of which this side can know. It therefore errs
    // toward showing the count rather than toward hiding numbers silently.
    expect(ENTRIES_ALWAYS_VISIBLE).toBe(2);
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
// I12 — the strip, and where "Done" goes
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

describe('"Done" only navigates (I12)', () => {
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

// ---------------------------------------------------------------------------
// `D62` — Submit run, in the progress row and present always
// ---------------------------------------------------------------------------

describe('`D62` — Submit run', () => {
  it('goes to Receive done once every stop is resolved', () => {
    // Same target the all-stops-done banner used, and the same gate — what
    // changed is that the control is on the screen before the gate opens.
    expect(submitDecision(strip('WEIGHED', 'SKIPPED', 'REASSIGNED'))).toBe('go');
    expect(submitDecision(strip('WEIGHED'))).toBe('go');
  });

  it('is blocked while any stop still wants a weight, and does not navigate', () => {
    expect(submitDecision(strip('WEIGHED', 'COLLECTED'))).toBe('blocked');
    expect(submitDecision(strip('PENDING', 'PENDING'))).toBe('blocked');
  });

  it('is blocked on a strip that has not loaded rather than sending someone on', () => {
    // An empty strip is a failed or pending read, not a finished run — the same
    // reading `allStopsResolved` takes.
    expect(submitDecision([])).toBe('blocked');
  });

  it('agrees with the gate the whole screen already uses (I12)', () => {
    // Two readings of one rule would be one too many. Submit must open exactly
    // when `allStopsResolved` does, since that is what "Done" follows as well.
    for (const stops of [
      strip('WEIGHED', 'COLLECTED'),
      strip('WEIGHED', 'SKIPPED'),
      strip('PENDING'),
      [],
    ]) {
      expect(submitDecision(stops) === 'go').toBe(allStopsResolved(stops));
    }
  });

  it('names what is outstanding, in route order', () => {
    const stops = [
      stop({ id: 'a', donorName: 'Aldi', position: 2, state: 'PENDING' }),
      stop({ id: 'b', donorName: 'Kroger', position: 0, state: 'WEIGHED' }),
      stop({ id: 'c', donorName: "Sam's", position: 1, state: 'COLLECTED' }),
    ];
    expect(outstandingStops(stops).map((s) => s.donorName)).toEqual(["Sam's", 'Aldi']);
  });

  it('lists nothing when the run is finished', () => {
    expect(outstandingStops(strip('WEIGHED', 'SKIPPED', 'REASSIGNED'))).toEqual([]);
  });

  it('reads outstanding the same way S2.2b does (I12)', () => {
    // S2.2b's `outstandingLines` is `isResolved` negated over the completion
    // summary; this is the same negation over the strip. The two screens must not
    // disagree about which stop is missing.
    const stops = strip('WEIGHED', 'COLLECTED', 'PENDING', 'SKIPPED', 'REASSIGNED');
    expect(outstandingStops(stops).every((s) => !isResolved(s.state))).toBe(true);
    expect(outstandingStops(stops)).toHaveLength(2);
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

describe('a note is one line, and says whose it is (`D68`)', () => {
  it('names the driver in the label rather than heading the note', () => {
    // "About the whole run" over a body cost two lines of the entry column to say
    // something the position already said. Who wrote it is the part the receiver
    // cannot see, and it decides how much the note is worth acting on.
    expect(COPY.stopNoteLabel('Karen Diaz')).toBe("Karen Diaz's note:");
    expect(COPY.runNoteLabel('Karen Diaz')).toBe("Karen Diaz's note on the run:");
    // The store's note is nobody's: it is an admin's standing note about a place.
    expect(COPY.donorNoteLabel).toBe('Store note:');
  });

  it('spells every possessive one way, including after an s', () => {
    // The same single rule S2.1b's run label follows. Two rules would spell one
    // volunteer's name two ways on two screens.
    expect(COPY.stopNoteLabel('Chris')).toBe("Chris's note:");
  });

  it('names the role when a run has no driver', () => {
    // A stop is readable on a run with no owner. The note must not vanish, and it
    // must not claim an author it does not have.
    expect(COPY.stopNoteLabel(null)).toBe('Driver note:');
    expect(COPY.runNoteLabel(null)).toBe('Driver note on the run:');
  });

  it('distinguishes the stop note from the run note', () => {
    // Both come from the same driver. One is about this store and one about the
    // whole morning, and a receiver acts on them differently.
    expect(COPY.stopNoteLabel('Karen')).not.toBe(COPY.runNoteLabel('Karen'));
  });
});

describe('microcopy', () => {
  // Two labels are functions of the driver's name since `D68` made a note one
  // line ("Karen's note:"). Resolve them so the sweeps below still see every
  // string a receiver can read — a label that escapes the sweep is a label the
  // forbidden-word and I11/I13 rules stop covering, which is the whole point of
  // sweeping rather than listing.
  const sentences: string[] = Object.values(COPY).flatMap((value) =>
    typeof value === 'function' ? [value('Karen Diaz'), value(null)] : [value],
  );

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
    // may imply the run is finished — including "Done", which resolves nothing
    // (I12).
    for (const sentence of sentences) {
      expect(sentence).not.toMatch(/\b(finish|complete|clos(e|ing))\s+(the\s+|this\s+)?run\b/i);
      expect(sentence).not.toMatch(/run is (over|done|finished|complete)/i);
    }
  });

  it('shows the unit on the sheet (§7)', () => {
    expect(COPY.unit).toBe('lb');
  });

  it('keeps the two stop actions to a verb, with the noun in the aria label (`D37`)', () => {
    // `ui-ux-spec.md` S2.2 draws these as "Mark stop weighed" and "Skip stop".
    // `D37` cut both to the verb: the stop's name is in the header and its total is
    // directly above the buttons, so the labels were repeating what the screen had
    // already said. A screen reader meets a button without that context, which is
    // what the aria labels are for — and they must still name the stop.
    expect(COPY.markWeighed).toBe('Done');
    expect(COPY.skipStop).toBe('Skip');
    expect(COPY.markWeighedAria.toLowerCase()).toContain('stop');
    expect(COPY.skipStopAria.toLowerCase()).toContain('stop');
    // The destructive confirm keeps the long form: §3 wants the button that cannot
    // be taken back to name the action, not to echo the one that opened the modal.
    expect(COPY.skipConfirm).toBe('Skip stop');
  });

  it('uses no em dash (§7)', () => {
    for (const sentence of sentences) expect(sentence).not.toContain('—');
  });

  it('does not restate the refusal S2.2b and the server already word (`D62`)', () => {
    // The modal shows `RECEIVE_INCOMPLETE_MESSAGE` itself. A second copy of that
    // sentence in this file is the thing that would drift.
    for (const sentence of sentences) expect(sentence).not.toBe(RECEIVE_INCOMPLETE_MESSAGE);
    expect(RECEIVE_INCOMPLETE_MESSAGE.length).toBeGreaterThan(0);
  });

  it('words the Submit modal as S2.2b words its BLOCKED stage (`D62`)', () => {
    // Not imported from S2.2b — one screen's copy is not another's dependency —
    // but the receiver meets both, so the words are the same words.
    expect(COPY.notReady).toBe('This run is not finished yet');
    expect(COPY.outstandingLabel).toBe('Still to do');
  });

  it('has no run-notes disclosure left to label (`D68`)', () => {
    // The three notes are labelled text now. The toggle's word going with it is
    // the point: a stray copy key outlives the control it named and comes back as
    // a second, hidden way to read a note.
    expect('runNotesToggle' in COPY).toBe(false);
    expect(COPY.runNoteLabel.length).toBeGreaterThan(0);
    expect(COPY.stopNoteLabel.length).toBeGreaterThan(0);
    expect(COPY.donorNoteLabel.length).toBeGreaterThan(0);
  });

  it('has no all-stops-done banner left to label (`D62`)', () => {
    // Submit run replaced it and is present always, so the banner's two strings
    // are not a fallback — they are a control that no longer exists.
    expect('allDoneBanner' in COPY).toBe(false);
    expect('goToReceiveDone' in COPY).toBe(false);
  });

  it('names the way out as the place it goes (`D60`)', () => {
    // `BackLink` takes a noun; the chevron already says "back". Same label S2.2b
    // uses for the same destination.
    expect(COPY.backToRuns).toBe('Runs');
  });

  it('offers Submit without claiming it closes the run (I11)', () => {
    // Receive done (S2.2b) is still the one completion action. Submit is the way
    // to it, and the label must not read as the act itself.
    expect(COPY.submitRun).toBe('Submit run');
    expect(COPY.submitRun.toLowerCase()).not.toContain('finish');
    expect(COPY.submitRun.toLowerCase()).not.toContain('receive done');
  });
});
