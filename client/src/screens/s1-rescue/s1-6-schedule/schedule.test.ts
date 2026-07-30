// S1.6's rules, tested without a browser.
//
// There is no jsdom and no component renderer in this repo, and adding one would be
// a dependency (build-plan §3/D5), so nothing here renders anything. What is covered
// is what `logic.ts` exists for, and the list is chosen by what a wrong answer would
// silently break rather than by what is easy to assert:
//
//   * the pantry-zone conversions, in BOTH directions — the screen that chooses
//     times is the one where a device-zone slip writes the wrong instant (A120);
//   * the computed "starting" date, including the case that surprises people (A111);
//   * the shape of every request body, because "no truck field" and "no start date"
//     are properties of the payload, not of the markup (I8, §5.3);
//   * which eligibility reasons staff may confirm through, which is I20's exemption
//     and the one rule on this screen that a plausible-looking mistake inverts;
//   * both halves of the reorder agreeing about what an order is.
//
// The report says plainly what this leaves uncovered.
//
// Run: npx vitest run --root client

import { describe, expect, it } from 'vitest';
import {
  COPY,
  EMPTY_PATTERN,
  EMPTY_PUBLISH,
  FORBIDDEN_IN_COPY,
  addStop,
  addableDonors,
  assignIsBlocked,
  buildPatternCreate,
  buildPublish,
  buildRouteUpdate,
  canCancelRun,
  canMoveRun,
  canSetDriver,
  dayHeading,
  driverChoices,
  duplicateNotice,
  firstOccurrence,
  formatClockRange,
  formatDayLabel,
  formatInstantRange,
  formatShortDate,
  groupRunsByDay,
  isoWeekdayOf,
  monthGrid,
  moveStop,
  moveStopTo,
  needsEditScope,
  pantryClock,
  pantryToday,
  patternLine,
  patternSentence,
  pickRangeDay,
  removeStop,
  routeFormOf,
  schedulableRoutes,
  toggleWeekday,
  validatePattern,
  validatePublish,
  validateRoute,
  validateTerminate,
  weekdaysSentence,
} from './logic.ts';
import type { PatternForm, PublishForm, RouteForm, StopDraft } from './logic.ts';
import type {
  DonorSummary,
  RecurrencePatternSummary,
  RouteDetail,
  ShapedUser,
  ShiftStatus,
  ShiftSummary,
} from '../../../api/shared.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CHICAGO = 'America/Chicago';

function run(over: Partial<ShiftSummary> = {}): ShiftSummary {
  return {
    id: 's1',
    routeId: 'r1',
    routeName: 'Riverside',
    occurrenceDate: '2026-08-04',
    startsAt: '2026-08-04T14:00:00.000Z',
    endsAt: '2026-08-04T16:00:00.000Z',
    status: 'OPEN' as ShiftStatus,
    ownerId: null,
    ownerName: null,
    truckName: null,
    recurrencePatternId: null,
    assignedOverConflict: false,
    staffNote: null,
    note: null,
    pickupCompletedAt: null,
    ...over,
  };
}

function donor(over: Partial<DonorSummary> = {}): DonorSummary {
  return {
    id: 'd1',
    name: 'Kroger',
    address: '1 Main St',
    contact: null,
    note: null,
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function user(over: Partial<ShapedUser> = {}): ShapedUser {
  return {
    id: 'u1',
    username: 'kareno',
    firstName: 'Karen',
    lastName: 'Olsen',
    tier: 'VOLUNTEER',
    duties: ['DRIVE'],
    active: true,
    ...over,
  };
}

function route(over: Partial<RouteDetail> = {}): RouteDetail {
  return {
    id: 'r1',
    name: 'Riverside',
    active: true,
    stopCount: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    stops: [
      {
        id: 'rs1',
        donorId: 'd1',
        donorName: 'Kroger',
        donorAddress: '1 Main St',
        donorActive: true,
        position: 0,
      },
    ],
    ...over,
  };
}

function pattern(over: Partial<RecurrencePatternSummary> = {}): RecurrencePatternSummary {
  return {
    id: 'p1',
    routeId: 'r1',
    routeName: 'Riverside',
    weekdays: [2],
    startTime: '09:00',
    endTime: '11:00',
    endDate: null,
    ownerDefaultId: null,
    ownerDefaultName: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

const stops: StopDraft[] = [
  { donorId: 'a', donorName: 'Aldi', donorAddress: null, donorActive: true },
  { donorId: 'b', donorName: 'Bakery', donorAddress: null, donorActive: true },
  { donorId: 'c', donorName: 'Costco', donorAddress: null, donorActive: true },
];

const names = (list: readonly StopDraft[]) => list.map((stop) => stop.donorId).join('');

// ---------------------------------------------------------------------------
// The pantry's clock (A120)
// ---------------------------------------------------------------------------

describe('pantry-local calendar and clock', () => {
  it('reads TODAY from the pantry zone, not the machine running the browser', () => {
    // 02:00 UTC on the 5th is still the evening of the 4th at the pantry. A staff
    // laptop in London would otherwise offer a day picker whose "today" is a day
    // ahead of the calendar the server will evaluate the date against.
    const at = new Date('2026-08-05T02:00:00.000Z');
    expect(pantryToday(at, CHICAGO)).toBe('2026-08-04');
    expect(pantryToday(at, 'UTC')).toBe('2026-08-05');
    expect(pantryToday(at, 'Australia/Sydney')).toBe('2026-08-05');
  });

  it('reads the pantry wall clock as HH:MM, with midnight as 00:00', () => {
    expect(pantryClock(new Date('2026-08-05T02:00:00.000Z'), CHICAGO)).toBe('21:00');
    // `hour12: false` renders this hour as "24" in some locales; `hourCycle: 'h23'`
    // is why it does not here.
    expect(pantryClock(new Date('2026-08-05T05:00:00.000Z'), CHICAGO)).toBe('00:00');
  });

  it('falls back to the device zone only when the zone has not arrived yet', () => {
    // Null is the pre-sign-in moment. It must not throw, and it must agree with the
    // device — there is nothing better to use for that one render.
    const at = new Date('2026-08-05T02:00:00.000Z');
    expect(pantryToday(at, null)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(pantryClock(at, null)).toMatch(/^\d{2}:\d{2}$/);
  });

  it('renders an existing run in the pantry zone, never the device one', () => {
    // The same instant, two zones. A run's window is a pantry-local fact.
    expect(
      formatInstantRange('2026-08-04T14:00:00.000Z', '2026-08-04T16:00:00.000Z', CHICAGO),
    ).toBe('9:00 AM – 11:00 AM');
    expect(
      formatInstantRange('2026-08-04T14:00:00.000Z', '2026-08-04T16:00:00.000Z', 'UTC'),
    ).toBe('2:00 PM – 4:00 PM');
  });

  it('prints a repeating rule’s own times without converting them', () => {
    // `recurrence_pattern.start_time` is a `time`, pantry-local wall clock — it was
    // never an instant, so there is nothing to convert and no zone involved.
    expect(formatClockRange('09:00', '11:00')).toBe('9:00 AM – 11:00 AM');
  });

  it('names the weekday of a date without a zone', () => {
    expect(isoWeekdayOf('2026-08-04')).toBe(2); // ISO: Tuesday
    expect(isoWeekdayOf('2026-08-09')).toBe(7); // Sunday is 7, not 0
  });

  it('lays a month out Sunday-first as six weeks of seven', () => {
    const grid = monthGrid(2026, 8);
    expect(grid).toHaveLength(6);
    expect(grid.every((week) => week.length === 7)).toBe(true);
    // 1 Aug 2026 is a Saturday, so the first row is seven filler days but the last
    // cell of it.
    expect(grid[0]?.[6]?.iso).toBe('2026-08-01');
    expect(grid[0]?.[6]?.inMonth).toBe(true);
    expect(grid[0]?.[0]?.inMonth).toBe(false);
  });

  it('says Today and Tomorrow where they apply', () => {
    expect(dayHeading('2026-08-04', '2026-08-04')).toBe('Today, Aug 4');
    expect(dayHeading('2026-08-05', '2026-08-04')).toBe('Tomorrow, Aug 5');
    expect(dayHeading('2026-08-06', '2026-08-04')).toBe('Thursday, Aug 6');
  });

  it('adds the year only when it is not the one staff is standing in', () => {
    expect(formatShortDate('2026-08-04', '2026-01-01')).toBe('Aug 4');
    expect(formatShortDate('2027-08-04', '2026-01-01')).toBe('Aug 4, 2027');
    expect(formatDayLabel('2026-08-04', '2026-08-01')).toBe('Tue, Aug 4');
  });
});

// ---------------------------------------------------------------------------
// Publish one run (I8, PRD cap 4)
// ---------------------------------------------------------------------------

describe('publishing one run', () => {
  const ready: PublishForm = {
    routeId: 'r1',
    date: '2026-08-04',
    startTime: '09:00',
    endTime: '11:00',
    staffNote: '',
  };

  it('asks for a route, a day and two times, in that order', () => {
    expect(validatePublish(EMPTY_PUBLISH)).toBe(COPY.noRoute);
    expect(validatePublish({ ...EMPTY_PUBLISH, routeId: 'r1' })).toBe(COPY.noDate);
    expect(validatePublish({ ...ready, startTime: null })).toBe(COPY.noTimes);
    expect(validatePublish(ready)).toBeNull();
  });

  it('refuses an end time that is not later in the same day', () => {
    // Mirrors `ck_shift_window`. The constraint is the enforcement; this only makes
    // it read as a sentence before the round trip.
    expect(validatePublish({ ...ready, endTime: '09:00' })).toBe(COPY.endBeforeStart);
    expect(validatePublish({ ...ready, endTime: '08:00' })).toBe(COPY.endBeforeStart);
  });

  it('sends the date and times as pantry-local TEXT, never an instant', () => {
    const body = buildPublish(ready);
    expect(body).toEqual({
      routeId: 'r1',
      date: '2026-08-04',
      startTime: '09:00',
      endTime: '11:00',
    });
  });

  it('sends NO truck and NO driver field (I8, PRD cap 4)', () => {
    // The driver picks the truck when they start the run, and a run exists
    // independently of any driver. Neither is a field staff can set here, and this
    // is the assertion that keeps that true if someone adds one to the form.
    const body = buildPublish(ready);
    const keys = Object.keys(body ?? {});
    expect(keys).not.toContain('truckId');
    expect(keys).not.toContain('truckName');
    expect(keys).not.toContain('ownerId');
    expect(keys).not.toContain('driverId');
  });

  it('sends a note only when there is one, and trims it', () => {
    expect(buildPublish({ ...ready, staffNote: '   ' })?.staffNote).toBeUndefined();
    expect(buildPublish({ ...ready, staffNote: '  side door  ' })?.staffNote).toBe('side door');
  });

  it('builds nothing from a form that is not ready', () => {
    expect(buildPublish(EMPTY_PUBLISH)).toBeNull();
  });

  it('reports a duplicate as a notice, never as a refusal', () => {
    expect(duplicateNotice([])).toBeNull();
    expect(
      duplicateNotice([
        {
          shiftId: 's9',
          occurrenceDate: '2026-08-04',
          routeName: 'Riverside',
          startsAt: '2026-08-04T14:00:00.000Z',
          endsAt: '2026-08-04T16:00:00.000Z',
        },
      ]),
    ).toContain('still published');
  });
});

// ---------------------------------------------------------------------------
// The recurring builder (A111, `domain-modeling.md §5.3`)
// ---------------------------------------------------------------------------

describe('the "starting" date is computed, not entered (A111)', () => {
  it('is today when today is on the pattern and the window has not begun', () => {
    // 2026-08-04 is a Tuesday. 08:00 at the pantry, a 9am rule: today still counts.
    expect(firstOccurrence([2], '09:00', '2026-08-04', '08:00')).toBe('2026-08-04');
  });

  it('is NEXT week when today’s window has already begun', () => {
    // The filter `materializeIn` applies (`window.startsAt >= now`) and the part a
    // re-derivation drops: a Tuesday rule saved on Tuesday afternoon starts on the
    // 11th, and the sentence has to say so or it names a run that never appears.
    expect(firstOccurrence([2], '09:00', '2026-08-04', '14:00')).toBe('2026-08-11');
  });

  it('keeps today when the window begins exactly now', () => {
    // `>= now`, not `> now`.
    expect(firstOccurrence([2], '09:00', '2026-08-04', '09:00')).toBe('2026-08-04');
  });

  it('takes the nearest of several weekdays', () => {
    // Tuesday + Thursday, asked on the Tuesday after that Tuesday's window: the
    // Thursday is next.
    expect(firstOccurrence([2, 4], '09:00', '2026-08-04', '14:00')).toBe('2026-08-06');
  });

  it('has nothing to compute before a weekday is picked', () => {
    expect(firstOccurrence([], '09:00', '2026-08-04', '08:00')).toBeNull();
  });

  it('is null when the end date falls before the first run', () => {
    // A rule that would mint nothing at all. Staff is told before saving rather
    // than left looking for runs that never appear.
    expect(firstOccurrence([2], '09:00', '2026-08-04', '14:00', '2026-08-06')).toBeNull();
  });

  it('renders S1.6’s sentence, with an end and without one', () => {
    const base: PatternForm = { ...EMPTY_PATTERN, routeId: 'r1', weekdays: [2], startTime: '09:00', endTime: '11:00' };
    expect(patternSentence(base, '2026-08-04', '08:00')).toBe(
      'Every Tuesday, starting Aug 4, no end.',
    );
    expect(patternSentence({ ...base, endDate: '2026-09-29' }, '2026-08-04', '08:00')).toBe(
      'Every Tuesday, starting Aug 4, until Sep 29.',
    );
    expect(patternSentence({ ...base, weekdays: [] }, '2026-08-04', '08:00')).toBeNull();
    expect(patternSentence({ ...base, endDate: '2026-08-03' }, '2026-08-04', '08:00')).toContain(
      'before the first run',
    );
  });

  it('names the days in plain language rather than collapsing them', () => {
    // `shared/src/coverage.ts`'s `weekdayLabel` collapses three or more to
    // "repeating" because a claim toast cannot recite a list. A builder can, and
    // S1.6 asks for plain language.
    expect(weekdaysSentence([2])).toBe('Every Tuesday');
    expect(weekdaysSentence([2, 4])).toBe('Every Tuesday and Thursday');
    expect(weekdaysSentence([1, 3, 5])).toBe('Every Monday, Wednesday and Friday');
    expect(weekdaysSentence([1, 2, 3, 4, 5, 6, 7])).toBe('Every day');
    expect(weekdaysSentence([])).toBeNull();
    // Out-of-range days cannot reach the wire; `ck_rp_weekdays` is 1..7.
    expect(weekdaysSentence([0, 8])).toBeNull();
  });

  it('keeps the weekday set sorted and toggling', () => {
    expect(toggleWeekday([2], 1)).toEqual([1, 2]);
    expect(toggleWeekday([1, 2], 2)).toEqual([1]);
  });

  it('sends NO start date, ever (§5.3 has no column for one)', () => {
    const body = buildPatternCreate({
      ...EMPTY_PATTERN,
      routeId: 'r1',
      weekdays: [2],
      startTime: '09:00',
      endTime: '11:00',
    });
    expect(body).toEqual({
      routeId: 'r1',
      weekdays: [2],
      startTime: '09:00',
      endTime: '11:00',
      endDate: null,
    });
    expect(Object.keys(body ?? {})).not.toContain('startDate');
  });

  it('asks for a route, days and times', () => {
    expect(validatePattern(EMPTY_PATTERN)).toBe(COPY.noRoute);
    expect(validatePattern({ ...EMPTY_PATTERN, routeId: 'r1' })).toBe(COPY.noWeekday);
    expect(
      validatePattern({ ...EMPTY_PATTERN, routeId: 'r1', weekdays: [2] }),
    ).toBe(COPY.noTimes);
  });

  it('describes a stored repeating run in one line', () => {
    expect(patternLine(pattern(), '2026-08-04')).toBe('Every Tuesday · 9:00 AM – 11:00 AM · no end');
    expect(patternLine(pattern({ endDate: '2026-09-29' }), '2026-08-04')).toContain('until Sep 29');
  });
});

describe('the bulk-terminate range', () => {
  it('needs both ends, in order', () => {
    expect(validateTerminate({ fromDate: null, toDate: null })).toBe(COPY.terminateNoRange);
    expect(validateTerminate({ fromDate: '2026-08-06', toDate: '2026-08-04' })).toBe(
      COPY.terminateNoRange,
    );
    expect(validateTerminate({ fromDate: '2026-08-04', toDate: '2026-08-06' })).toBeNull();
  });

  it('builds the range in two taps and starts over on a third', () => {
    const one = pickRangeDay({ fromDate: null, toDate: null }, '2026-08-04');
    expect(one).toEqual({ fromDate: '2026-08-04', toDate: '2026-08-04' });
    expect(pickRangeDay(one, '2026-08-06')).toEqual({
      fromDate: '2026-08-04',
      toDate: '2026-08-06',
    });
    // A second tap before the first extends the other end.
    expect(pickRangeDay(one, '2026-08-01')).toEqual({
      fromDate: '2026-08-01',
      toDate: '2026-08-04',
    });
    const range = { fromDate: '2026-08-04', toDate: '2026-08-06' };
    expect(pickRangeDay(range, '2026-08-20')).toEqual({
      fromDate: '2026-08-20',
      toDate: '2026-08-20',
    });
  });

  it('warns that the cancel is terminal and not a release', () => {
    // I10 makes CANCELLED terminal, and this is explicitly NOT the driver's
    // release-range, which returns runs to the board.
    expect(COPY.terminateConsequence).toContain('cannot be brought back');
    expect(COPY.terminateHint).toContain('not the same as putting them back on the board');
  });
});

// ---------------------------------------------------------------------------
// The route builder (PRD cap 4)
// ---------------------------------------------------------------------------

describe('the route builder', () => {
  it('moves a store one place, and does nothing at the ends', () => {
    expect(names(moveStop(stops, 1, -1))).toBe('bac');
    expect(names(moveStop(stops, 1, 1))).toBe('acb');
    expect(names(moveStop(stops, 0, -1))).toBe('abc');
    expect(names(moveStop(stops, 2, 1))).toBe('abc');
  });

  it('drops a dragged store where it landed, closing the gap', () => {
    expect(names(moveStopTo(stops, 0, 2))).toBe('bca');
    expect(names(moveStopTo(stops, 2, 0))).toBe('cab');
    expect(names(moveStopTo(stops, 1, 1))).toBe('abc');
    expect(names(moveStopTo(stops, 0, 9))).toBe('abc');
  });

  it('agrees with the buttons for an adjacent move', () => {
    // The two affordances are one operation. If these ever disagree, dragging and
    // Move down would produce different routes from the same gesture.
    expect(names(moveStopTo(stops, 0, 1))).toBe(names(moveStop(stops, 0, 1)));
    expect(names(moveStopTo(stops, 2, 1))).toBe(names(moveStop(stops, 2, -1)));
  });

  it('adds a store once and removes it by id', () => {
    const added = addStop(stops, donor({ id: 'd9', name: 'Deli' }));
    expect(names(added)).toBe('abcd9');
    expect(names(addStop(added, donor({ id: 'd9' })))).toBe('abcd9');
    expect(names(removeStop(added, 'b'))).toBe('acd9');
  });

  it('offers only active stores that are not already on the route (I21)', () => {
    const list = [
      donor({ id: 'a', name: 'Aldi' }),
      donor({ id: 'z', name: 'Zippy' }),
      donor({ id: 'm', name: 'Market' }),
      donor({ id: 'x', name: 'Gone', active: false }),
    ];
    expect(addableDonors(list, stops).map((entry) => entry.id)).toEqual(['m', 'z']);
  });

  it('asks for a name and at least one store', () => {
    expect(validateRoute({ routeId: null, name: '  ', stops })).toBe(COPY.routeNoName);
    expect(validateRoute({ routeId: null, name: 'North', stops: [] })).toBe(COPY.routeNoStops);
    expect(validateRoute({ routeId: null, name: 'North', stops })).toBeNull();
  });

  it('sends the order as a list of donor ids and no positions', () => {
    const form: RouteForm = { routeId: 'r1', name: '  North  ', stops };
    expect(buildRouteUpdate(form)).toEqual({ name: 'North', stops: ['a', 'b', 'c'] });
  });

  it('reads a stored route back in position order', () => {
    const messy = route({
      stops: [
        { id: '2', donorId: 'b', donorName: 'B', donorAddress: null, donorActive: true, position: 1 },
        { id: '1', donorId: 'a', donorName: 'A', donorAddress: null, donorActive: false, position: 0 },
      ],
    });
    const form = routeFormOf(messy);
    expect(names(form.stops)).toBe('ab');
    // A deactivated store is kept and flagged, never dropped from under staff (I21).
    expect(form.stops[0]?.donorActive).toBe(false);
  });

  it('offers only active routes with at least one store for scheduling', () => {
    const list = [
      route({ id: 'ok', name: 'B route' }),
      route({ id: 'archived', name: 'A route', active: false }),
      route({ id: 'empty', name: 'C route', stops: [] }),
    ];
    expect(schedulableRoutes(list).map((entry) => entry.id)).toEqual(['ok']);
  });
});

// ---------------------------------------------------------------------------
// Assign (I20's staff-assign exemption)
// ---------------------------------------------------------------------------

describe('assign is a warning, never a block (I20)', () => {
  it('lets staff confirm through a conflict of availability or another run', () => {
    // These are the two reasons `services/coverage.ts` lists as confirmable. If this
    // ever returns true, S1.6 hides the confirm button and the exemption is gone.
    expect(assignIsBlocked([])).toBe(false);
    expect(assignIsBlocked(['AVAILABILITY_BLOCK'])).toBe(false);
    expect(assignIsBlocked(['OWNED_SHIFT_OVERLAP'])).toBe(false);
    expect(assignIsBlocked(['AVAILABILITY_BLOCK', 'OWNED_SHIFT_OVERLAP'])).toBe(false);
  });

  it('does not let staff confirm through a missing duty or a dead account', () => {
    // The exemption covers the temporal half of `eligible()` and nothing else: I2's
    // duty is set membership and I21 hides a deactivated account from new use.
    expect(assignIsBlocked(['NO_DRIVE_DUTY'])).toBe(true);
    expect(assignIsBlocked(['DEACTIVATED'])).toBe(true);
    expect(assignIsBlocked(['UNKNOWN_USER'])).toBe(true);
    expect(assignIsBlocked(['AVAILABILITY_BLOCK', 'NO_DRIVE_DUTY'])).toBe(true);
  });

  it('offers only active accounts that hold the Drive duty (I2)', () => {
    const list = [
      user({ id: 'driver', firstName: 'Zoe', duties: ['DRIVE'] }),
      user({ id: 'coordinator', firstName: 'Amy', tier: 'STAFF', duties: [] }),
      user({ id: 'receiver', firstName: 'Bob', duties: ['RECEIVE'] }),
      user({ id: 'gone', firstName: 'Cal', duties: ['DRIVE'], active: false }),
      user({ id: 'both', firstName: 'Ann', tier: 'ADMIN', duties: ['DRIVE', 'REPORT'] }),
    ];
    // A Staff coordinator is NOT a driver — tier never confers a duty. And an Admin
    // who holds Drive is offered, because tier does not withhold one either.
    expect(driverChoices(list).map((entry) => entry.id)).toEqual(['both', 'driver']);
  });

  it('offers a driver only while the run can still change hands', () => {
    // A started run's truck is picked and its stops are snapshotted (I5/I8), so the
    // shift is not the unit that moves; CANCELLED and COMPLETED are terminal (I10).
    expect(canSetDriver(run({ status: 'OPEN' }))).toBe(true);
    expect(canSetDriver(run({ status: 'CLAIMED' }))).toBe(true);
    expect(canSetDriver(run({ status: 'IN_PROGRESS' }))).toBe(false);
    expect(canSetDriver(run({ status: 'CANCELLED' }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The runs list
// ---------------------------------------------------------------------------

describe('the runs list', () => {
  it('groups by the pantry-local occurrence date, not by the instant', () => {
    const groups = groupRunsByDay(
      [
        run({ id: 'later', occurrenceDate: '2026-08-06' }),
        run({ id: 'first', occurrenceDate: '2026-08-04' }),
        run({
          id: 'second',
          occurrenceDate: '2026-08-04',
          startsAt: '2026-08-04T18:00:00.000Z',
        }),
      ],
      '2026-08-04',
    );
    expect(groups.map((group) => group.date)).toEqual(['2026-08-04', '2026-08-06']);
    expect(groups[0]?.runs.map((entry) => entry.id)).toEqual(['first', 'second']);
    expect(groups[0]?.heading).toBe('Today, Aug 4');
  });

  it('asks the scope question only for a run that came from a pattern', () => {
    // PRD cap 4: editing one date must not break the pattern. A one-off has nothing
    // to ask about.
    expect(needsEditScope(run())).toBe(false);
    expect(needsEditScope(run({ recurrencePatternId: 'p1' }))).toBe(true);
  });

  it('hides cancel and move once a run has started (I9, I10, cap 9)', () => {
    expect(canCancelRun(run({ status: 'IN_PROGRESS' }))).toBe(false);
    expect(canMoveRun(run({ status: 'IN_PROGRESS' }))).toBe(false);
    expect(canCancelRun(run({ status: 'CANCELLED' }))).toBe(false);
    expect(canCancelRun(run({ status: 'CLAIMED' }))).toBe(true);
    expect(canMoveRun(run({ status: 'OPEN' }))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Copy (§7)
// ---------------------------------------------------------------------------

/**
 * Every user-visible sentence this screen owns, including the built ones.
 *
 * The functions in `COPY` take either a count or a name, so each is called with
 * both shapes and whatever it ignores comes out harmless — the point is to reach
 * every sentence, not to render it the way the screen will.
 */
function sentencesOf(source: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const value of Object.values(source)) {
    if (typeof value === 'string') {
      out.push(value);
      continue;
    }
    if (typeof value !== 'function') continue;
    const build = value as (arg: unknown) => unknown;
    for (const arg of [1, 2, 'Karen']) {
      const produced = build(arg);
      if (typeof produced === 'string') out.push(produced);
    }
  }
  return out;
}

describe('copy', () => {
  const sentences = sentencesOf(COPY);

  it('uses no forbidden word', () => {
    for (const sentence of sentences) {
      for (const word of FORBIDDEN_IN_COPY) {
        expect(sentence.toLowerCase()).not.toContain(word);
      }
    }
  });

  it('never says the truck is picked here', () => {
    // The one sentence that mentions a truck says the driver picks it (I8). No
    // sentence may ask staff for one.
    const aboutTrucks = sentences.filter((sentence) => sentence.toLowerCase().includes('truck'));
    expect(aboutTrucks).toHaveLength(1);
    expect(aboutTrucks[0]).toContain('driver picks the truck');
  });

  it('says a run can exist with no driver (PRD cap 4)', () => {
    expect(COPY.publishHint).toContain('no driver');
    expect(COPY.assignHint).toContain('does not need a driver');
  });

  it('keeps S1.6’s two edit labels verbatim', () => {
    expect(COPY.editThisDate).toBe('Edit just this date');
    expect(COPY.editThePattern).toBe('Edit the weekly pattern');
  });

  it('names the consequence on every destructive confirm (§6)', () => {
    for (const consequence of [
      COPY.cancelRunConsequence,
      COPY.clearDriverConsequence,
      COPY.terminateConsequence,
      COPY.routeRemoveConsequence,
      COPY.editScopeConsequence,
    ]) {
      expect(consequence.length).toBeGreaterThan(20);
    }
  });
});
