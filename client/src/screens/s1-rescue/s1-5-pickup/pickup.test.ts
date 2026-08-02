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
import { DONATION_ON_ROUTE_MESSAGE, SHIFTSTOP_DISPOSITIONS } from '../../../api/shared.ts';
import type {
  CategorySummary,
  DonationSummary,
  DonorSummary,
  RunDetail,
  RunStopSummary,
  TruckSummary,
} from '../../../api/shared.ts';
import {
  AD_HOC_ANON_CHOICE,
  AD_HOC_LABEL_CHOICE,
  COPY,
  EMPTY_AD_HOC_DRAFT,
  FORBIDDEN_IN_COPY,
  NO_STOP_EXPANSION,
  actionsFor,
  adHocChoiceOf,
  adHocReady,
  adHocRequest,
  adHocStoreFor,
  canHeadBack,
  canMoveDown,
  canMoveUp,
  canEditNote,
  canResolve,
  flaggedLine,
  forgetStopExpansion,
  headingBackState,
  isOnRouteRefusal,
  isStopExpanded,
  mapLinkFor,
  messageFor,
  moveStop,
  nextPendingStop,
  orderedStops,
  phaseFor,
  photoAlt,
  photoUrlFor,
  placeFor,
  progressLabel,
  progressOf,
  reorderPayload,
  reviewLines,
  runIsStillInProgress,
  selectableCategories,
  selectableDonors,
  selectableTrucks,
  shouldReloadAfter,
  stopStatusLabel,
  stopToggleLabel,
  stopsOnThisRun,
  timeOfDay,
  toggleStopExpansion,
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
// Flag a stop not on my route (cap 12 — I14, I17, I29, D8)
// ---------------------------------------------------------------------------

function donor(over: Partial<DonorSummary> = {}): DonorSummary {
  return {
    id: 'donor-9',
    name: 'The bakery on 5th',
    address: null,
    contact: null,
    note: null,
    mapUrl: null,
    hasPhoto: false,
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function category(over: Partial<CategorySummary> = {}): CategorySummary {
  return {
    id: 'cat-1',
    name: 'Bakery',
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function donation(over: Partial<DonationSummary> = {}): DonationSummary {
  return {
    id: 'don-1',
    shiftId: 'shift-1',
    status: 'SUGGESTED',
    source: 'MASTER',
    donorId: 'donor-9',
    donorLabel: null,
    donorDisplay: 'The bakery on 5th',
    categoryId: 'cat-1',
    categoryName: 'Bakery',
    weight: null,
    reportable: true,
    receivedDate: '2026-07-28',
    note: null,
    createdByName: 'Karen',
    createdAt: '2026-07-28T21:00:00.000Z',
    editableByReceiver: true,
    ...over,
  };
}

describe('the flag is offered on an in-progress run and nowhere else', () => {
  it('is available while stops are pending and still available afterwards', () => {
    // The server's only state test is `status === 'IN_PROGRESS'` — a driver can be
    // handed something extra at any point of the drive, including on the way home.
    expect(actionsFor(run({ stops: stops('PENDING') }), OWNER)).toContain('flag-ad-hoc');
    expect(
      actionsFor(
        run({ stops: stops('COLLECTED'), pickupCompletedAt: '2026-07-28T21:32:00.000Z' }),
        OWNER,
      ),
    ).toContain('flag-ad-hoc');
  });

  it('is not offered before the run starts, or on another driver run', () => {
    expect(actionsFor(run({ status: 'CLAIMED' }), OWNER)).not.toContain('flag-ad-hoc');
    expect(actionsFor(run({ ownerId: 'driver-2' }), OWNER)).not.toContain('flag-ad-hoc');
  });
});

describe('the store picker (I29, communication only)', () => {
  it('hides a donor already on this run', () => {
    // I29: on-route food is another weight_entry on that stop, not an unscheduled
    // donation. The server refuses it; this only saves the driver the round trip.
    const list = [donor({ id: 'donor-1' }), donor({ id: 'donor-9' })];
    expect(selectableDonors(list, stops('PENDING', 'PENDING')).map((d) => d.id)).toEqual([
      'donor-9',
    ]);
  });

  it('still hides a donor whose stop was moved to another driver', () => {
    // The load-bearing case. The server's guard reads `shift_stop` with NO
    // disposition filter, so a REASSIGNED stop blocks the flag exactly like a
    // pending one. Filtering against `stopsOnThisRun` here would offer a store the
    // server then refuses — a picker that lies.
    const moved = [stop({ id: 'stop-1', donorId: 'donor-1', disposition: 'REASSIGNED' })];
    expect(selectableDonors([donor({ id: 'donor-1' })], moved)).toEqual([]);
  });

  it('hides a deactivated donor (I21) and an archived category (§3.3)', () => {
    expect(selectableDonors([donor({ active: false })], [])).toEqual([]);
    expect(selectableCategories([category({ active: false }), category({ id: 'c2' })])).toHaveLength(
      1,
    );
  });

  it('offers every donor on a run with no stops', () => {
    expect(selectableDonors([donor()], [])).toHaveLength(1);
  });

  it('maps the three source shapes to and from a radio value', () => {
    expect(adHocChoiceOf({ kind: 'master', donorId: 'donor-9' })).toBe('donor-9');
    expect(adHocChoiceOf({ kind: 'label', donorLabel: 'x' })).toBe(AD_HOC_LABEL_CHOICE);
    expect(adHocChoiceOf({ kind: 'anon' })).toBe(AD_HOC_ANON_CHOICE);

    expect(adHocStoreFor('donor-9', '')).toEqual({ kind: 'master', donorId: 'donor-9' });
    expect(adHocStoreFor(AD_HOC_ANON_CHOICE, 'typed')).toEqual({ kind: 'anon' });
    // Switching away and back keeps what was typed.
    expect(adHocStoreFor(AD_HOC_LABEL_CHOICE, 'typed')).toEqual({
      kind: 'label',
      donorLabel: 'typed',
    });
  });
});

describe('what the flag sends (D8, I14)', () => {
  it('sends a category and never a weight', () => {
    const request = adHocRequest({
      store: { kind: 'master', donorId: 'donor-9' },
      categoryId: 'cat-1',
      note: '',
    });
    expect(request).toEqual({ donorId: 'donor-9', categoryId: 'cat-1' });
    // D8: `ui-ux-spec.md:193` calls this "just a donor picker … and an optional
    // note", but the locked doc makes Category required with no SUGGESTED
    // exemption — and grants one to `weight` in the very next row. So: a category,
    // and no weight, because the driver has no scale.
    expect(Object.keys(request!)).not.toContain('weight');
  });

  it('refuses to build a request without a category', () => {
    const draft = { store: { kind: 'anon' } as const, categoryId: null, note: '' };
    expect(adHocRequest(draft)).toBeNull();
    expect(adHocReady(draft)).toBe(false);
  });

  it('never sends donorId and donorLabel together', () => {
    // `ck_ud_source_exclusive` forbids both, and the server refuses the pair with
    // "Pick a store from the list or type a name, not both." The draft cannot
    // express the illegal state, which is the point of the union.
    for (const store of [
      { kind: 'master', donorId: 'donor-9' } as const,
      { kind: 'label', donorLabel: 'The bakery on 5th' } as const,
      { kind: 'anon' } as const,
    ]) {
      const request = adHocRequest({ store, categoryId: 'cat-1', note: '' })!;
      const named = [request.donorId, request.donorLabel].filter((v) => v != null);
      expect(named.length).toBeLessThanOrEqual(1);
    }
  });

  it('treats "no name for it" as a complete answer and a blank typed name as not', () => {
    // Anonymous is a legitimate third source (`donor_id` and `donor_label` both
    // null → ANON). An empty "Somewhere else" box is just an unfinished form.
    expect(adHocReady({ store: { kind: 'anon' }, categoryId: 'cat-1', note: '' })).toBe(true);
    expect(
      adHocReady({ store: { kind: 'label', donorLabel: '   ' }, categoryId: 'cat-1', note: '' }),
    ).toBe(false);
  });

  it('trims the typed name and the note, and drops an empty note entirely', () => {
    expect(
      adHocRequest({
        store: { kind: 'label', donorLabel: '  The bakery on 5th ' },
        categoryId: 'cat-1',
        note: '  two trays  ',
      }),
    ).toEqual({ donorLabel: 'The bakery on 5th', categoryId: 'cat-1', note: 'two trays' });

    expect(
      Object.keys(adHocRequest({ store: { kind: 'anon' }, categoryId: 'cat-1', note: '   ' })!),
    ).toEqual(['categoryId']);
  });

  it('starts empty and unsendable', () => {
    expect(adHocReady(EMPTY_AD_HOC_DRAFT)).toBe(false);
  });
});

describe('what a flagged pickup looks like afterwards', () => {
  it('reads as a store and a kind of food, never as a stop', () => {
    // I14: a driver-add writes no ShiftStop. It has no position, no disposition
    // and nothing to check off, so it must not be rendered as a row of the list.
    const line = flaggedLine(donation());
    expect(line).toContain('The bakery on 5th');
    expect(line).toContain('Bakery');
    for (const disposition of SHIFTSTOP_DISPOSITIONS) {
      expect(line).not.toContain(stopStatusLabel(disposition));
    }
  });

  it('uses the server "unattributed" display for an anonymous pickup', () => {
    expect(
      flaggedLine(
        donation({ source: 'ANON', donorId: null, donorDisplay: 'Unattributed donation' }),
      ),
    ).toContain('Unattributed');
  });

  it('tells the I29 refusal apart from every other failure', () => {
    const refused = new ApiError('conflict', { status: 409, detail: DONATION_ON_ROUTE_MESSAGE });
    expect(isOnRouteRefusal(refused)).toBe(true);
    expect(messageFor(refused)).toBe(DONATION_ON_ROUTE_MESSAGE);
    expect(isOnRouteRefusal(new ApiError('conflict', { detail: 'That run is not yours.' }))).toBe(
      false,
    );
    expect(isOnRouteRefusal(new ApiError('offline'))).toBe(false);
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
// One stop open at a time (D21) — presentation, and provably nothing else
// ---------------------------------------------------------------------------

describe('which stop is open', () => {
  it('opens the current stop and nothing else', () => {
    const list = stops('COLLECTED', 'PENDING', 'PENDING');
    const open = list.filter((s) => isStopExpanded(s, list, NO_STOP_EXPANSION));

    expect(open.map((s) => s.id)).toEqual(['stop-2']);
    // The same stop S1.5 already calls "visually the focus".
    expect(nextPendingStop(list)?.id).toBe('stop-2');
  });

  it('opens nothing when there is no current stop', () => {
    // Every stop resolved: the run's remaining work is "Heading back", which sits
    // below the list and takes the primary. A wall of finished cards above it
    // would be four screens of nothing to do.
    const list = stops('COLLECTED', 'SKIPPED', 'REASSIGNED');
    expect(list.some((s) => isStopExpanded(s, list, NO_STOP_EXPANSION))).toBe(false);
    expect(canHeadBack(list)).toBe(true);
  });

  it('lets a tap override the default in both directions', () => {
    const list = stops('PENDING', 'PENDING');
    const current = list[0]!;
    const other = list[1]!;

    // Open one that is not current.
    const opened = toggleStopExpansion(NO_STOP_EXPANSION, other, list);
    expect(isStopExpanded(other, list, opened)).toBe(true);
    // ...without closing the current one. Nothing here is exclusive.
    expect(isStopExpanded(current, list, opened)).toBe(true);

    // And close the current one.
    const closed = toggleStopExpansion(opened, current, list);
    expect(isStopExpanded(current, list, closed)).toBe(false);
    expect(isStopExpanded(other, list, closed)).toBe(true);
  });

  it('lets a finished stop be reopened, because its note outlives the check-off', () => {
    const list = stops('COLLECTED', 'PENDING');
    const done = list[0]!;

    expect(isStopExpanded(done, list, NO_STOP_EXPANSION)).toBe(false);
    expect(canEditNote(done)).toBe(true);

    const reopened = toggleStopExpansion(NO_STOP_EXPANSION, done, list);
    expect(isStopExpanded(done, list, reopened)).toBe(true);
  });

  it('forgets a choice so the stop follows the default again', () => {
    // What the screen does when a stop resolves: the focus moves on and the
    // finished card closes itself rather than being pinned open by an old tap.
    const before = stops('PENDING', 'PENDING');
    const opened = toggleStopExpansion(NO_STOP_EXPANSION, before[1]!, before);

    const after = stops('COLLECTED', 'PENDING');
    const forgotten = forgetStopExpansion(opened, 'stop-1');

    expect(isStopExpanded(after[0]!, after, forgotten)).toBe(false);
    // And the next stop is now the current one, so it opens on its own.
    expect(isStopExpanded(after[1]!, after, forgotten)).toBe(true);
  });

  it('forgetting a stop with no choice changes nothing', () => {
    expect(forgetStopExpansion(NO_STOP_EXPANSION, 'stop-1')).toBe(NO_STOP_EXPANSION);
  });

  it('changes no rule the run depends on', () => {
    // The load-bearing claim. Collapsing is presentation: every stop is still in
    // the list, in the same order, with the same dispositions, and the gate, the
    // count and the reorder payload all answer exactly as before.
    const list = stops('PENDING', 'COLLECTED', 'REASSIGNED');
    const collapsed = toggleStopExpansion(NO_STOP_EXPANSION, list[0]!, list);

    expect(orderedStops(list).map((s) => s.id)).toEqual(['stop-1', 'stop-2', 'stop-3']);
    expect(stopsOnThisRun(list)).toHaveLength(2);
    expect(progressLabel(list)).toBe('1 of 2 done');
    expect(canHeadBack(list)).toBe(false);
    expect(reorderPayload(list)).toEqual(['stop-1', 'stop-2']);
    // Not one of the above reads the expansion, which is the point.
    expect(Object.keys(collapsed)).toEqual(['stop-1']);
  });

  it('names the store in the toggle, so the icon is never the only label', () => {
    const one = stop({ donorName: "Sam's" });
    expect(stopToggleLabel(one, false)).toContain("Sam's");
    expect(stopToggleLabel(one, true)).toContain("Sam's");
    expect(stopToggleLabel(one, false)).not.toBe(stopToggleLabel(one, true));
  });
});

// ---------------------------------------------------------------------------
// Finding the door (D20)
// ---------------------------------------------------------------------------

describe('the map link', () => {
  it('prefers the link an admin set', () => {
    // D20's whole reason: the address geocodes to the shopfront and the pantry
    // collects from a dock round the back.
    const place = placeFor(
      stop({ donorId: 'donor-9', donorAddress: '1 Main St' }),
      [donor({ id: 'donor-9', mapUrl: 'https://maps.example/dock' })],
    );
    expect(mapLinkFor(place)).toBe('https://maps.example/dock');
  });

  it('derives one from the address otherwise, escaped', () => {
    const place = placeFor(stop({ donorAddress: '4400 N Freeway #2, Fort Worth' }), []);
    expect(mapLinkFor(place)).toBe(
      'https://www.google.com/maps/search/?api=1&query=' +
        encodeURIComponent('4400 N Freeway #2, Fort Worth'),
    );
    // The `#` in a US address would truncate the URL at the fragment if it were
    // pasted in raw, which is the bug this assertion exists for.
    expect(mapLinkFor(place)).not.toContain('#2');
  });

  it('offers nothing to open when there is nothing to open', () => {
    expect(mapLinkFor(placeFor(stop({ donorAddress: null }), []))).toBeNull();
    expect(mapLinkFor(placeFor(stop({ donorAddress: '   ' }), []))).toBeNull();
    // A blank stored link falls back rather than producing a dead control.
    const blank = placeFor(stop({ donorAddress: '1 Main St' }), [
      donor({ id: 'donor-1', mapUrl: '  ' }),
    ]);
    expect(mapLinkFor(blank)).toContain('1%20Main%20St');
  });
});

describe('the store photo', () => {
  it('is asked for only when one exists', () => {
    const withPhoto = placeFor(stop({ donorId: 'donor-1' }), [
      donor({ id: 'donor-1', hasPhoto: true }),
    ]);
    expect(withPhoto.hasPhoto).toBe(true);
    expect(placeFor(stop({ donorId: 'donor-1' }), [donor({ id: 'donor-1' })]).hasPhoto).toBe(
      false,
    );
  });

  it('degrades to no aids when the donor list has not arrived', () => {
    // A second request lagging must never cost the driver a stop. The address
    // rides on the stop itself, so the map link still works.
    const place = placeFor(stop({ donorAddress: '1 Main St' }), []);
    expect(place.hasPhoto).toBe(false);
    expect(place.mapUrl).toBeNull();
    expect(mapLinkFor(place)).not.toBeNull();
  });

  it('points at the photo endpoint, not at a donor payload', () => {
    // D20 — the bytes have their own route precisely so no list carries them.
    expect(photoUrlFor('donor-1')).toBe('/api/donors/donor-1/photo');
    expect(photoUrlFor('a/b')).toBe('/api/donors/a%2Fb/photo');
  });

  it('describes what the picture is of', () => {
    expect(photoAlt(stop({ donorName: "Sam's" }))).toContain("Sam's");
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
      COPY.headingBackToast,
      COPY.reviewTitle,
      COPY.reviewAgain,
      COPY.reviewIntro,
      COPY.confirmHeadingBack,
      COPY.confirmedTitle,
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

  it('uses no em dash (D21)', () => {
    // Two sentences, or a comma. Never a hyphen swap either, which is why this
    // matches the character rather than the punctuation's intent.
    for (const sentence of sentences) expect(sentence).not.toContain('—');
  });

  it('keeps only the hints a driver could not work out from the control (D21)', () => {
    // The deleted ones restated the button under them: "Which truck are you
    // taking?" over a list of trucks, "Optional" under a button already sitting
    // in an optional block. What survives says something the screen does not.
    expect(COPY).not.toHaveProperty('pickTruckHint');
    expect(COPY).not.toHaveProperty('headingBackHint');
    expect(COPY).not.toHaveProperty('confirmedHint');
    expect(COPY).not.toHaveProperty('flagAdHocHint');
    expect(COPY).not.toHaveProperty('flagNoteHint');
    expect(COPY).not.toHaveProperty('flaggedListHint');

    // Kept: a consequence, and a fact about where data went.
    expect(COPY.skipConsequence.length).toBeGreaterThan(0);
    expect(COPY.flaggedListNote.toLowerCase()).toContain('reload');
    expect(COPY.flagStoreHint.toLowerCase()).toContain('not listed');
  });

  it('never asks the driver for a weight they cannot take', () => {
    // S1.5: "no weight entry here". The driver has no scale; the receiver weighs
    // it at S2.3. A prompt for pounds would be asking for a guess.
    for (const sentence of sentences) {
      expect(sentence).not.toMatch(/\blbs?\b|\bpounds?\b|\bweigh (it|this) (in|now)\b/i);
    }
    // And the copy says whose job it is instead.
    expect(COPY.flagIntro.toLowerCase()).toContain('pantry');
    expect(COPY.flagIntro.toLowerCase()).toContain('weigh');
  });

  it('says the flagged pickup is not a stop', () => {
    // I14: a driver-add never creates a ShiftStop, so the copy must not let a
    // driver think the route grew a stop. D21 deleted the hint under the list
    // that used to say this, so the LABEL carries it now — the sentence has not
    // gone, it moved to where it is read first.
    expect(COPY.flaggedListLabel.toLowerCase()).toContain('not stops');
  });

  it('tells an empty state what to do next', () => {
    for (const next of [COPY.notClaimedNext, COPY.notYoursNext, COPY.noTrucksNext]) {
      expect(next.length).toBeGreaterThan(0);
      expect(next).toMatch(/board|admin|ask/i);
    }
  });
});
