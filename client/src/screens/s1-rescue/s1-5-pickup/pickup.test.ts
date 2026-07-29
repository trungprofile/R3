// S1.5 driver pickup execution — the rules this screen repeats, tested.
//
// NOTHING HERE RENDERS. There is no browser or component harness in this repo and
// adding one (jsdom, a renderer) would be a dependency a lane may not add
// (build-plan §3/D5), so the screen's decisions were written as functions of
// plain records precisely so they could be tested at all. What is NOT covered is
// stated in this wave's report rather than implied by a green suite.
//
// These are communication-only rules — `server/test/execution.test.ts` covers the
// same invariants where they are actually enforced, against the migrated
// database. The two that matter most here are the two a wrong client answer would
// break silently:
//
//   I27  the gate is {COLLECTED, SKIPPED, REASSIGNED} — three states. A run with
//        a stop reassigned off it must still offer "Heading back".
//   D1   a Phase-1 run stays IN_PROGRESS forever, including after the milestone.
//
// Run: npx vitest run --root client

import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../api/index.ts';
import { SHIFTSTOP_DISPOSITIONS } from '../../../api/shared.ts';
import type { RunDetail, RunStopSummary, TruckSummary } from '../../../api/shared.ts';
import {
  COPY,
  FORBIDDEN_IN_COPY,
  actionsFor,
  canHeadBack,
  canMoveDown,
  canMoveUp,
  canEditNote,
  canResolve,
  headingBackState,
  messageFor,
  moveStop,
  nextPendingStop,
  orderedStops,
  phaseFor,
  progressLabel,
  progressOf,
  reorderPayload,
  reviewLines,
  runIsStillInProgress,
  selectableTrucks,
  shouldReloadAfter,
  stopStatusLabel,
  stopsOnThisRun,
  timeOfDay,
  truckLabel,
} from './logic.ts';

// ---------------------------------------------------------------------------

const OWNER = 'driver-1';

function stop(over: Partial<RunStopSummary> = {}): RunStopSummary {
  return {
    id: 'stop-1',
    donorId: 'donor-1',
    donorName: "Sam's",
    donorAddress: '1 Main St',
    donorNote: null,
    position: 0,
    disposition: 'PENDING',
    note: null,
    ...over,
  };
}

function run(over: Partial<RunDetail> = {}): RunDetail {
  return {
    shiftId: 'shift-1',
    status: 'IN_PROGRESS',
    routeId: 'route-1',
    routeName: 'Tuesday AM',
    startsAt: '2026-07-28T13:00:00.000Z',
    endsAt: '2026-07-28T16:00:00.000Z',
    ownerId: OWNER,
    truckId: 'truck-1',
    truckName: 'Blue van',
    note: null,
    staffNote: null,
    pickupCompletedAt: null,
    assignedOverConflict: false,
    stops: [],
    ...over,
  };
}

/** Three stops, in order, with the dispositions given. */
function stops(...dispositions: RunStopSummary['disposition'][]): RunStopSummary[] {
  return dispositions.map((disposition, index) =>
    stop({
      id: `stop-${index + 1}`,
      donorId: `donor-${index + 1}`,
      donorName: `Store ${index + 1}`,
      position: index,
      disposition,
    }),
  );
}

function truck(over: Partial<TruckSummary> = {}): TruckSummary {
  return {
    id: 'truck-1',
    truckName: 'Blue van',
    plate: null,
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

// ---------------------------------------------------------------------------
// I27 — the "Heading back" gate
// ---------------------------------------------------------------------------

describe('I27 gate — "Heading back" appears when no stop is PENDING', () => {
  it('is closed while a stop is still to do', () => {
    expect(canHeadBack(stops('COLLECTED', 'PENDING'))).toBe(false);
  });

  it('opens once every stop is collected', () => {
    expect(canHeadBack(stops('COLLECTED', 'COLLECTED'))).toBe(true);
  });

  it('counts a skipped stop as resolved', () => {
    expect(canHeadBack(stops('COLLECTED', 'SKIPPED'))).toBe(true);
  });

  it('counts a REASSIGNED stop as resolved for THIS run', () => {
    // The load-bearing case. I27's gate is {COLLECTED, SKIPPED, REASSIGNED} —
    // three states, amended in the locked doc under human authorization. A stop
    // staff moved to another driver is no longer this driver's to resolve (I30),
    // and reading it the other way would freeze the very run the reassignment
    // existed to rescue.
    expect(canHeadBack(stops('COLLECTED', 'REASSIGNED'))).toBe(true);
    expect(canHeadBack(stops('SKIPPED', 'REASSIGNED'))).toBe(true);
    expect(canHeadBack(stops('REASSIGNED', 'REASSIGNED'))).toBe(true);
  });

  it('stays closed when a reassignment leaves a PENDING stop behind', () => {
    expect(canHeadBack(stops('REASSIGNED', 'PENDING'))).toBe(false);
  });

  it('is open on a run with no stops at all', () => {
    // A route with zero stops snapshots to an empty list; the server's gate is
    // vacuously true there too (A93).
    expect(canHeadBack([])).toBe(true);
  });

  it('offers the button and reports the milestone once it is set', () => {
    const before = headingBackState(run({ stops: stops('COLLECTED', 'REASSIGNED') }));
    expect(before.offered).toBe(true);
    expect(before.confirmed).toBe(false);
    expect(before.confirmedAt).toBeNull();

    const after = headingBackState(
      run({
        stops: stops('COLLECTED', 'REASSIGNED'),
        pickupCompletedAt: '2026-07-28T21:32:00.000Z',
      }),
    );
    expect(after.offered).toBe(true);
    expect(after.confirmed).toBe(true);
    expect(after.confirmedAt).not.toBe('');
  });
});

// ---------------------------------------------------------------------------
// D1 — a Phase-1 run never reaches COMPLETED
// ---------------------------------------------------------------------------

describe('D1 — the run stays IN_PROGRESS, before and after the milestone', () => {
  const resolved = run({
    stops: stops('COLLECTED', 'SKIPPED'),
    pickupCompletedAt: '2026-07-28T21:32:00.000Z',
  });

  it('is still in progress after every stop is resolved and the milestone is set', () => {
    // I27 sets a timestamp and deliberately does not touch `status`. The
    // receiver's receive-done is the only completion action (I11) and it ships in
    // Phase 2, so this is the correct end state for Phase 1, not a gap.
    expect(resolved.status).toBe('IN_PROGRESS');
    expect(runIsStillInProgress(resolved)).toBe(true);
  });

  it('still shows the driver their run afterwards', () => {
    expect(phaseFor(resolved, OWNER)).toEqual({ kind: 'active' });
  });

  it('offers no action that closes the run', () => {
    const actions = actionsFor(resolved, OWNER);
    expect(actions).toContain('heading-back');
    for (const action of actions) {
      expect(action).not.toMatch(/complete|finish|close|receive|done/i);
    }
  });

  it('keeps the heading-back action available for a second confirm', () => {
    // `completePickup` is idempotent — a second confirm keeps the first timestamp
    // and carries only the note (A89), so nothing is hidden after the first tap.
    expect(headingBackState(resolved).offered).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Which face of the screen
// ---------------------------------------------------------------------------

describe('phaseFor', () => {
  it('sends a claimed run of mine to the truck picker', () => {
    expect(phaseFor(run({ status: 'CLAIMED', truckId: null, truckName: null }), OWNER)).toEqual({
      kind: 'start',
    });
  });

  it('sends a started run of mine to the stop list', () => {
    expect(phaseFor(run(), OWNER)).toEqual({ kind: 'active' });
  });

  it('refuses a run owned by someone else', () => {
    const phase = phaseFor(run({ ownerId: 'driver-2' }), OWNER);
    expect(phase.kind).toBe('unavailable');
    expect(phase.kind === 'unavailable' && phase.title).toBe(COPY.notYours);
  });

  it('explains an unclaimed run rather than offering to start it', () => {
    const phase = phaseFor(run({ status: 'OPEN', ownerId: null }), OWNER);
    expect(phase.kind).toBe('unavailable');
    expect(phase.kind === 'unavailable' && phase.title).toBe(COPY.notClaimed);
  });

  it('explains a cancelled run', () => {
    const phase = phaseFor(run({ status: 'CANCELLED' }), OWNER);
    expect(phase.kind === 'unavailable' && phase.title).toBe(COPY.cancelled);
  });

  it('has a branch for COMPLETED even though Phase 1 never reaches it', () => {
    // Unreachable in Phase 1 (D1). Built, left unexercised in the app — but the
    // branch must not fall through to "start" if Phase 2 ever gets here.
    const phase = phaseFor(run({ status: 'COMPLETED' }), OWNER);
    expect(phase.kind === 'unavailable' && phase.title).toBe(COPY.finished);
  });

  it('offers only the start action before the run begins', () => {
    expect(actionsFor(run({ status: 'CLAIMED' }), OWNER)).toEqual(['start']);
  });

  it('offers nothing at all on another driver run', () => {
    expect(actionsFor(run({ ownerId: 'driver-2' }), OWNER)).toEqual([]);
  });

  it('offers check-off and skip only while something is pending', () => {
    const pending = actionsFor(run({ stops: stops('PENDING', 'COLLECTED') }), OWNER);
    expect(pending).toContain('collect');
    expect(pending).toContain('skip');
    expect(pending).not.toContain('heading-back');

    const finished = actionsFor(run({ stops: stops('COLLECTED', 'SKIPPED') }), OWNER);
    expect(finished).not.toContain('collect');
    expect(finished).not.toContain('skip');
    expect(finished).toContain('heading-back');
  });

  it('offers no reordering when one stop is left on the run', () => {
    expect(actionsFor(run({ stops: stops('PENDING', 'REASSIGNED') }), OWNER)).not.toContain(
      'reorder',
    );
  });
});

// ---------------------------------------------------------------------------
// The stop list
// ---------------------------------------------------------------------------

describe('the stop list', () => {
  it('reads in position order, not array order', () => {
    const scrambled = [stop({ id: 'b', position: 1 }), stop({ id: 'a', position: 0 })];
    expect(orderedStops(scrambled).map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('focuses the first stop still to do', () => {
    expect(nextPendingStop(stops('COLLECTED', 'PENDING', 'PENDING'))?.id).toBe('stop-2');
  });

  it('has no focus once everything is resolved', () => {
    expect(nextPendingStop(stops('COLLECTED', 'SKIPPED'))).toBeNull();
  });

  it('leaves a moved stop out of the count entirely', () => {
    // Neither done nor outstanding: it is another driver's work now (I30).
    expect(progressOf(stops('COLLECTED', 'PENDING', 'REASSIGNED'))).toEqual({ done: 1, total: 2 });
    expect(progressLabel(stops('COLLECTED', 'PENDING', 'REASSIGNED'))).toBe('1 of 2 done');
  });

  it('keeps a moved stop visible but off the run', () => {
    const list = stops('PENDING', 'REASSIGNED');
    expect(stopsOnThisRun(list).map((s) => s.id)).toEqual(['stop-1']);
    expect(orderedStops(list)).toHaveLength(2);
  });

  it('allows resolving only out of PENDING', () => {
    // The driver's two edges both start at PENDING; COLLECTED -> SKIPPED is the
    // receiver's, REASSIGNED is terminal, and there is no edge back (A83).
    expect(canResolve(stop({ disposition: 'PENDING' }))).toBe(true);
    expect(canResolve(stop({ disposition: 'COLLECTED' }))).toBe(false);
    expect(canResolve(stop({ disposition: 'SKIPPED' }))).toBe(false);
    expect(canResolve(stop({ disposition: 'REASSIGNED' }))).toBe(false);
  });

  it('keeps the note editable after a stop is resolved, but not after it moves', () => {
    expect(canEditNote(stop({ disposition: 'COLLECTED' }))).toBe(true);
    expect(canEditNote(stop({ disposition: 'SKIPPED' }))).toBe(true);
    expect(canEditNote(stop({ disposition: 'REASSIGNED' }))).toBe(false);
  });

  it('labels every disposition in plain words', () => {
    expect(stopStatusLabel('PENDING')).toBe(COPY.statusToDo);
    expect(stopStatusLabel('COLLECTED')).toBe(COPY.statusPickedUp);
    expect(stopStatusLabel('SKIPPED')).toBe(COPY.statusSkipped);
    expect(stopStatusLabel('REASSIGNED')).toBe(COPY.statusMoved);
    // There is no WEIGHED label because there is no WEIGHED disposition: it is a
    // read-time projection over non-voided WeightEntry rows (I12), never stored.
    expect(SHIFTSTOP_DISPOSITIONS).not.toContain('WEIGHED');
  });

  it('lists every stop on the review screen, moved ones included', () => {
    const lines = reviewLines(stops('COLLECTED', 'REASSIGNED'));
    expect(lines.map((line) => line.status)).toEqual([COPY.statusPickedUp, COPY.statusMoved]);
  });
});

// ---------------------------------------------------------------------------
// Reordering
// ---------------------------------------------------------------------------

describe('reordering (S1.5: changing order never loses check state)', () => {
  it('swaps a stop with its neighbour and renumbers from zero', () => {
    const moved = moveStop(stops('PENDING', 'PENDING', 'PENDING'), 'stop-3', -1);
    expect(moved.map((s) => s.id)).toEqual(['stop-1', 'stop-3', 'stop-2']);
    expect(moved.map((s) => s.position)).toEqual([0, 1, 2]);
  });

  it('never changes a disposition or a note', () => {
    const before = [
      stop({ id: 'a', position: 0, disposition: 'COLLECTED', note: 'two crates' }),
      stop({ id: 'b', position: 1, disposition: 'PENDING' }),
    ];
    const after = moveStop(before, 'b', -1);
    expect(after.map((s) => s.id)).toEqual(['b', 'a']);
    const a = after.find((s) => s.id === 'a')!;
    expect(a.disposition).toBe('COLLECTED');
    expect(a.note).toBe('two crates');
  });

  it('does nothing at the ends, and nothing for an unknown stop', () => {
    const list = stops('PENDING', 'PENDING');
    expect(moveStop(list, 'stop-1', -1).map((s) => s.id)).toEqual(['stop-1', 'stop-2']);
    expect(moveStop(list, 'stop-2', 1).map((s) => s.id)).toEqual(['stop-1', 'stop-2']);
    expect(moveStop(list, 'nope', 1).map((s) => s.id)).toEqual(['stop-1', 'stop-2']);
  });

  it('pushes a moved stop to the end, the way the server numbers it', () => {
    const list = [
      stop({ id: 'a', position: 0, disposition: 'PENDING' }),
      stop({ id: 'gone', position: 1, disposition: 'REASSIGNED' }),
      stop({ id: 'b', position: 2, disposition: 'PENDING' }),
    ];
    const after = moveStop(list, 'b', -1);
    expect(after.map((s) => s.id)).toEqual(['b', 'a', 'gone']);
    expect(after.map((s) => s.position)).toEqual([0, 1, 2]);
  });

  it('sends every stop still on the run exactly once, and no moved one', () => {
    // The server refuses anything else (A84): a list that names a REASSIGNED
    // stop, repeats one, or omits one is a 400.
    const list = [
      stop({ id: 'a', position: 0, disposition: 'PENDING' }),
      stop({ id: 'gone', position: 1, disposition: 'REASSIGNED' }),
      stop({ id: 'b', position: 2, disposition: 'COLLECTED' }),
    ];
    const payload = reorderPayload(list);
    expect(payload).toEqual(['a', 'b']);
    expect(new Set(payload).size).toBe(payload.length);
  });

  it('hides the move that would fall off the list', () => {
    const list = stops('PENDING', 'PENDING', 'REASSIGNED');
    expect(canMoveUp(list, 'stop-1')).toBe(false);
    expect(canMoveDown(list, 'stop-1')).toBe(true);
    expect(canMoveUp(list, 'stop-2')).toBe(true);
    expect(canMoveDown(list, 'stop-2')).toBe(false);
    // A moved stop is not in the order at all.
    expect(canMoveUp(list, 'stop-3')).toBe(false);
    expect(canMoveDown(list, 'stop-3')).toBe(false);
  });

  it('offers no move at all on a one-stop run', () => {
    const list = stops('PENDING');
    expect(canMoveUp(list, 'stop-1')).toBe(false);
    expect(canMoveDown(list, 'stop-1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The start step
// ---------------------------------------------------------------------------

describe('the truck picker', () => {
  it('hides an inactive truck from driver selection', () => {
    const list = [truck({ id: 't1' }), truck({ id: 't2', active: false })];
    expect(selectableTrucks(list).map((t) => t.id)).toEqual(['t1']);
  });

  it('shows the plate when there is one', () => {
    expect(truckLabel(truck({ truckName: 'Blue van', plate: null }))).toBe('Blue van');
    expect(truckLabel(truck({ truckName: 'Blue van', plate: 'ABC-123' }))).toContain('ABC-123');
  });
});

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

describe('what a failure says', () => {
  it('prefers the server sentence when there is one', () => {
    const error = new ApiError('conflict', {
      status: 409,
      detail: 'Finish or skip every stop before you head back.',
      correlationId: 'abc-123',
    });
    expect(messageFor(error)).toBe('Finish or skip every stop before you head back.');
  });

  it('falls back to the plain message, and never shows a code', () => {
    const message = messageFor(new ApiError('offline'));
    expect(message).toBe("You're offline. R3 needs a connection.");
    expect(message).not.toMatch(/\d{3}|correlation/i);
  });

  it('turns anything else into a plain message too', () => {
    expect(messageFor(new Error('boom'))).not.toContain('boom');
  });

  it('re-reads the run when this screen is out of date, and not otherwise', () => {
    expect(shouldReloadAfter(new ApiError('conflict'))).toBe(true);
    expect(shouldReloadAfter(new ApiError('not-found'))).toBe(true);
    expect(shouldReloadAfter(new ApiError('offline'))).toBe(false);
    expect(shouldReloadAfter(new ApiError('invalid'))).toBe(false);
  });

  it('survives a timestamp it cannot read', () => {
    expect(timeOfDay('not a date')).toBe('');
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

  it('never says the run is over', () => {
    // `pickup_completed_at` is a handoff signal, not a completion (I27), and a
    // Phase-1 run stays IN_PROGRESS forever (D1). The one sentence about a
    // finished run is the COMPLETED branch, which Phase 1 cannot reach.
    const handoff = [
      COPY.headingBack,
      COPY.headingBackHint,
      COPY.headingBackToast,
      COPY.reviewTitle,
      COPY.reviewAgain,
      COPY.reviewIntro,
      COPY.confirmHeadingBack,
      COPY.confirmedTitle,
      COPY.confirmedHint,
      COPY.runNoteHint,
    ];
    for (const sentence of handoff) {
      expect(sentence).not.toMatch(/\b(run|it) is (over|done|finished|complete)/i);
      expect(sentence).not.toMatch(/\b(finish|complete|clos(e|ing))\s+(the\s+|your\s+)?run\b/i);
    }
  });

  it('never promises the pantry was told', () => {
    // The truck-inbound alert is the one piece of cap 13 held back to Phase 2
    // (PRD §5) and the server deliberately enqueues nothing, so any sentence
    // claiming a notification would be false.
    for (const sentence of sentences) {
      expect(sentence).not.toMatch(/notif|alert|we(’|')?ll tell|we told|let them know|message/i);
    }
  });

  it('names the consequence on the one confirm that cannot be undone', () => {
    // §6: a confirm names the consequence. The ShiftStop machine has no edge back
    // to PENDING, so skipping really is one-way from here.
    expect(COPY.skipQuestion).toMatch(/\?$/);
    expect(COPY.skipConsequence.toLowerCase()).toContain('undo');
  });

  it('says the milestone is optional', () => {
    expect(COPY.headingBackHint.toLowerCase()).toContain('optional');
  });

  it('tells an empty state what to do next', () => {
    for (const next of [COPY.notClaimedNext, COPY.notYoursNext, COPY.noTrucksNext]) {
      expect(next.length).toBeGreaterThan(0);
      expect(next).toMatch(/board|admin|ask/i);
    }
  });
});
