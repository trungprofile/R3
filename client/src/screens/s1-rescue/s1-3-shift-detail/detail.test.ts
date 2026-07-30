// S1.3's rules, tested without a browser.
//
// There is no jsdom and no component renderer in this repo, and adding one would be
// a dependency (build-plan §3/D5) — so nothing here renders anything. What is
// covered is what `detail.ts` exists for: which viewer gets which actions, when
// Release is on screen, which source the stop list comes from, which stops may be
// reassigned, who is offered as a destination, the release range, and the copy. The
// report says plainly what that leaves uncovered.
//
// Run: npx vitest run --root client

import { describe, expect, it } from 'vitest';
import {
  COPY,
  FORBIDDEN_IN_COPY,
  MOVABLE_DISPOSITIONS,
  RANGE_OPEN_ENDED,
  capabilitiesFor,
  dayHeading,
  monthDay,
  reassignCandidates,
  releaseConfirmLabel,
  releaseRangeOptions,
  stopLines,
  stopStatusLabel,
  timeRange,
  todayCalendarDate,
  todayInZone,
} from './detail.ts';
import type { DetailViewer } from './detail.ts';
import type {
  RunDetail,
  RunStopSummary,
  ShiftDetail,
  ShiftStopDisposition,
  ShiftSummary,
} from '../../../api/shared.ts';

const OWNER = 'driver-1';
const NOW = Date.parse('2026-08-04T12:00:00Z');

const owner: DetailViewer = { id: OWNER, isStaff: false, canDrive: true };
const coordinator: DetailViewer = { id: 'staff-1', isStaff: true, canDrive: false };
const otherDriver: DetailViewer = { id: 'driver-2', isStaff: false, canDrive: true };

function shift(over: Partial<ShiftDetail> = {}): ShiftDetail {
  return {
    id: 'shift-1',
    routeId: 'route-1',
    routeName: 'Riverside',
    occurrenceDate: '2026-08-04',
    startsAt: '2026-08-04T13:00:00Z',
    endsAt: '2026-08-04T15:00:00Z',
    status: 'CLAIMED',
    ownerId: OWNER,
    ownerName: 'Karen Diaz',
    truckName: null,
    recurrencePatternId: null,
    assignedOverConflict: false,
    staffNote: null,
    note: null,
    pickupCompletedAt: null,
    plannedStops: [
      { donorId: 'donor-1', donorName: 'Grocer A', donorAddress: '1 Main St', position: 0 },
      { donorId: 'donor-2', donorName: 'Grocer B', donorAddress: null, position: 1 },
    ],
    ...over,
  };
}

function summary(over: Partial<ShiftSummary> = {}): ShiftSummary {
  const { plannedStops: _plannedStops, ...rest } = shift();
  return { ...rest, ...over };
}

function stop(over: Partial<RunStopSummary> = {}): RunStopSummary {
  return {
    id: 'stop-1',
    donorId: 'donor-1',
    donorName: 'Grocer A',
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
    routeName: 'Riverside',
    startsAt: '2026-08-04T13:00:00Z',
    endsAt: '2026-08-04T15:00:00Z',
    ownerId: OWNER,
    truckId: 'truck-1',
    truckName: 'Blue van',
    note: null,
    staffNote: null,
    pickupCompletedAt: null,
    assignedOverConflict: false,
    stops: [stop()],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Release — "owner sees Release run (red). Before-start only."
// ---------------------------------------------------------------------------

describe('release', () => {
  it('is offered to the owner of a claimed run that has not started', () => {
    expect(capabilitiesFor(shift(), owner, NOW).canRelease).toBe(true);
  });

  it('is hidden once the run is in progress', () => {
    expect(capabilitiesFor(shift({ status: 'IN_PROGRESS' }), owner, NOW).canRelease).toBe(false);
  });

  it('is hidden once the start time has passed', () => {
    const past = Date.parse('2026-08-04T14:00:00Z');
    expect(capabilitiesFor(shift(), owner, past).canRelease).toBe(false);
  });

  it('is not offered to staff — releasing is the driver own capability (cap 8)', () => {
    // Staff clearing someone else's run is `unassign`, a different operation with a
    // different notification, and it lives on S1.6.
    expect(capabilitiesFor(shift(), coordinator, NOW).canRelease).toBe(false);
  });

  it('is not offered to another driver', () => {
    expect(capabilitiesFor(shift(), otherDriver, NOW).canRelease).toBe(false);
  });

  it('has nothing to release on an open run', () => {
    const open = shift({ status: 'OPEN', ownerId: null, ownerName: null });
    expect(capabilitiesFor(open, owner, NOW).canRelease).toBe(false);
  });

  it('asks the scope question only when the run repeats', () => {
    expect(capabilitiesFor(shift(), owner, NOW).releaseRepeats).toBe(false);
    expect(
      capabilitiesFor(shift({ recurrencePatternId: 'pattern-1' }), owner, NOW).releaseRepeats,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The staff note and the conflict banner
// ---------------------------------------------------------------------------

describe('the coordinator note', () => {
  it('is editable by staff and read-only to the driver', () => {
    expect(capabilitiesFor(shift(), coordinator, NOW).canEditStaffNote).toBe(true);
    expect(capabilitiesFor(shift(), owner, NOW).canEditStaffNote).toBe(false);
  });

  it('is editable by an admin without naming the tier — I1 is hierarchical', () => {
    const admin: DetailViewer = { id: 'admin-1', isStaff: true, canDrive: false };
    expect(capabilitiesFor(shift(), admin, NOW).canEditStaffNote).toBe(true);
  });
});

describe('the conflict flag (I20 staff-assign exemption)', () => {
  it('shows the owner a banner when staff assigned them over a conflict', () => {
    const flagged = shift({ assignedOverConflict: true });
    expect(capabilitiesFor(flagged, owner, NOW).showConflictBanner).toBe(true);
  });

  it('shows nothing when the flag is not set', () => {
    expect(capabilitiesFor(shift(), owner, NOW).showConflictBanner).toBe(false);
  });

  it('never blocks the run — the flagged run still offers its normal actions', () => {
    // S1.3: "Informational only; does not block pickup execution."
    const flagged = capabilitiesFor(shift({ assignedOverConflict: true }), owner, NOW);
    expect(flagged.canRelease).toBe(true);
    expect(flagged.openRun).toBe('START');
  });
});

// ---------------------------------------------------------------------------
// The way on to S1.5
// ---------------------------------------------------------------------------

describe('opening the run', () => {
  it('offers the owner the start step on a claimed run', () => {
    expect(capabilitiesFor(shift(), owner, NOW).openRun).toBe('START');
  });

  it('offers the owner their started run', () => {
    expect(capabilitiesFor(shift({ status: 'IN_PROGRESS' }), owner, NOW).openRun).toBe('CONTINUE');
  });

  it('offers nothing to a coordinator who does not drive — duty is set membership (I2)', () => {
    // The pickup route requires the Drive duty, so the link would be a dead end.
    expect(capabilitiesFor(shift({ ownerId: 'staff-1' }), coordinator, NOW).openRun).toBeNull();
  });

  it('offers nothing on a run the viewer does not own', () => {
    expect(capabilitiesFor(shift(), otherDriver, NOW).openRun).toBeNull();
  });

  it('offers nothing on a cancelled run', () => {
    expect(capabilitiesFor(shift({ status: 'CANCELLED' }), owner, NOW).openRun).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The stop list
// ---------------------------------------------------------------------------

describe('the stop list', () => {
  it('is the route template before the run starts — I5 puts no stop rows on it yet', () => {
    const view = stopLines(shift(), null, { canReassignStops: false });
    expect(view.source).toBe('TEMPLATE');
    expect(view.lines.map((line) => line.donorName)).toEqual(['Grocer A', 'Grocer B']);
    expect(view.lines.every((line) => line.stopId === null)).toBe(true);
    expect(view.lines.every((line) => line.disposition === null)).toBe(true);
  });

  it('numbers the lines from 1 while position stays the server 0-based order', () => {
    const view = stopLines(shift(), null, { canReassignStops: false });
    expect(view.lines.map((line) => line.number)).toEqual([1, 2]);
  });

  it('sorts by position rather than trusting arrival order', () => {
    const detail = shift({
      plannedStops: [
        { donorId: 'donor-2', donorName: 'Grocer B', donorAddress: null, position: 1 },
        { donorId: 'donor-1', donorName: 'Grocer A', donorAddress: null, position: 0 },
      ],
    });
    const view = stopLines(detail, null, { canReassignStops: false });
    expect(view.lines.map((line) => line.donorName)).toEqual(['Grocer A', 'Grocer B']);
  });

  it('is the run snapshot once the run has started', () => {
    const started = shift({ status: 'IN_PROGRESS' });
    const view = stopLines(started, run(), { canReassignStops: true });
    expect(view.source).toBe('SNAPSHOT');
    expect(view.lines[0]?.stopId).toBe('stop-1');
    expect(view.lines[0]?.disposition).toBe('PENDING');
  });

  it('stays on the frozen snapshot when a started run has no stops (I5)', () => {
    // The route may have gained a store after the run started. That edit cannot
    // reach these rows, so falling back to the template would show the driver
    // stops they never had.
    const started = shift({ status: 'IN_PROGRESS' });
    const view = stopLines(started, run({ stops: [] }), { canReassignStops: true });
    expect(view.source).toBe('SNAPSHOT');
    expect(view.lines).toEqual([]);
  });

  it('falls back to the template when the run itself could not be read', () => {
    // A viewer who is neither the owner nor staff still sees what the route is.
    const started = shift({ status: 'IN_PROGRESS' });
    const view = stopLines(started, null, { canReassignStops: false });
    expect(view.source).toBe('TEMPLATE');
    expect(view.lines).toHaveLength(2);
  });

  it('keeps a moved stop on the list, struck through and out of every action', () => {
    const started = shift({ status: 'IN_PROGRESS' });
    const view = stopLines(started, run({ stops: [stop({ disposition: 'REASSIGNED' })] }), {
      canReassignStops: true,
    });
    expect(view.lines[0]?.moved).toBe(true);
    expect(view.lines[0]?.canReassign).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Reassign (I30)
// ---------------------------------------------------------------------------

describe('reassign', () => {
  const started = shift({ status: 'IN_PROGRESS' });

  it('is staff-only', () => {
    expect(capabilitiesFor(started, coordinator, NOW).canReassignStops).toBe(true);
    expect(capabilitiesFor(started, owner, NOW).canReassignStops).toBe(false);
  });

  it('is offered only on a run that has started', () => {
    expect(capabilitiesFor(shift(), coordinator, NOW).canReassignStops).toBe(false);
  });

  it('acts on an unresolved stop only — PENDING or not-yet-weighed COLLECTED', () => {
    const cases: Array<[ShiftStopDisposition, boolean]> = [
      ['PENDING', true],
      ['COLLECTED', true],
      ['SKIPPED', false],
      ['REASSIGNED', false],
    ];
    for (const [disposition, expected] of cases) {
      const view = stopLines(started, run({ stops: [stop({ disposition })] }), {
        canReassignStops: true,
      });
      expect(view.lines[0]?.canReassign, disposition).toBe(expected);
    }
  });

  it('matches the movable set the server enforces', () => {
    expect([...MOVABLE_DISPOSITIONS]).toEqual(['PENDING', 'COLLECTED']);
  });

  it('offers no action at all when the viewer is not staff', () => {
    const view = stopLines(started, run(), { canReassignStops: false });
    expect(view.lines[0]?.canReassign).toBe(false);
  });
});

describe('the reassign driver picker', () => {
  const today: ShiftSummary[] = [
    summary({ id: 'shift-1', status: 'IN_PROGRESS' }),
    summary({
      id: 'shift-2',
      status: 'IN_PROGRESS',
      ownerId: 'driver-2',
      ownerName: 'Sam Ott',
      routeName: 'Eastside',
      startsAt: '2026-08-04T14:00:00Z',
      endsAt: '2026-08-04T16:00:00Z',
    }),
    summary({
      id: 'shift-3',
      status: 'CLAIMED',
      ownerId: 'driver-3',
      ownerName: 'Ines Roy',
      routeName: 'Northgate',
    }),
    summary({ id: 'shift-4', status: 'OPEN', ownerId: null, ownerName: null }),
    summary({ id: 'shift-5', status: 'CANCELLED', ownerId: 'driver-4', ownerName: 'Jo Kim' }),
  ];

  it('never offers the run being moved from', () => {
    const ids = reassignCandidates(today, 'shift-1').map((candidate) => candidate.shiftId);
    expect(ids).not.toContain('shift-1');
  });

  it('leaves out a run with no driver and a cancelled one', () => {
    const ids = reassignCandidates(today, 'shift-1').map((candidate) => candidate.shiftId);
    expect(ids).toEqual(['shift-2', 'shift-3']);
  });

  it('lists a claimed run but does not let it be picked — it has no stop list yet (I5)', () => {
    const claimed = reassignCandidates(today, 'shift-1').find((c) => c.shiftId === 'shift-3');
    expect(claimed?.selectable).toBe(false);
    expect(claimed?.reason).toBe(COPY.reassignNotStarted);
  });

  it('lets a started run be picked, with nothing to explain', () => {
    const started = reassignCandidates(today, 'shift-1').find((c) => c.shiftId === 'shift-2');
    expect(started?.selectable).toBe(true);
    expect(started?.reason).toBeNull();
    expect(started?.driverName).toBe('Sam Ott');
  });

  it('puts the runs that can receive a stop first', () => {
    const order = reassignCandidates(
      [today[2]!, today[1]!],
      'shift-1',
    ).map((candidate) => candidate.shiftId);
    expect(order).toEqual(['shift-2', 'shift-3']);
  });

  it('reads the destination window in the pantry zone, not the device one', () => {
    const [first] = reassignCandidates(today, 'shift-1', 'America/Chicago');
    expect(first?.when).toBe('9:00 AM – 11:00 AM');
  });
});

// ---------------------------------------------------------------------------
// Release range (§5.3 release-range)
// ---------------------------------------------------------------------------

describe('the release range', () => {
  const repeating = summary({ recurrencePatternId: 'pattern-1' });
  const series: ShiftSummary[] = [
    repeating,
    summary({
      id: 'shift-2',
      recurrencePatternId: 'pattern-1',
      occurrenceDate: '2026-08-11',
      startsAt: '2026-08-11T13:00:00Z',
      endsAt: '2026-08-11T15:00:00Z',
    }),
    summary({
      id: 'shift-3',
      recurrencePatternId: 'pattern-1',
      occurrenceDate: '2026-08-18',
      startsAt: '2026-08-18T13:00:00Z',
      endsAt: '2026-08-18T15:00:00Z',
    }),
  ];

  it('always offers the open-ended "this and future" first', () => {
    const options = releaseRangeOptions(repeating, series);
    expect(options[0]).toEqual({ value: RANGE_OPEN_ENDED, label: COPY.releaseRangeAll });
  });

  it('offers the days that exist, ascending, and not this run own day', () => {
    const options = releaseRangeOptions(repeating, series).slice(1);
    expect(options.map((option) => option.value)).toEqual(['2026-08-11', '2026-08-18']);
    expect(options[0]?.label).toBe(`Through ${monthDay('2026-08-11')}`);
  });

  it('leaves out a run that is no longer this driver claimed one', () => {
    const withOthers = [
      ...series,
      summary({
        id: 'shift-9',
        recurrencePatternId: 'pattern-1',
        occurrenceDate: '2026-08-25',
        status: 'OPEN',
        ownerId: null,
      }),
    ];
    const options = releaseRangeOptions(repeating, withOthers).slice(1);
    expect(options.map((option) => option.value)).toEqual(['2026-08-11', '2026-08-18']);
  });

  it('offers nothing but the open-ended choice when the days cannot be read', () => {
    expect(releaseRangeOptions(repeating, [])).toHaveLength(1);
  });

  it('never labels a "this and future" release as one run', () => {
    // The days come from a second request. When it fails there is nothing to count,
    // and a singular button in front of a release that hands back every run ahead
    // is the one wrong answer worth pinning: the scope decides the words.
    expect(releaseConfirmLabel('ONE')).toBe(COPY.releaseConfirmOne);
    expect(releaseConfirmLabel('FUTURE')).toBe(COPY.releaseConfirmMany);
    expect(releaseConfirmLabel('FUTURE')).not.toBe(COPY.releaseConfirmOne);
  });
});

// ---------------------------------------------------------------------------
// Times and days (A120)
// ---------------------------------------------------------------------------

describe('when a run is', () => {
  it('reads a window in the pantry zone rather than the device one', () => {
    // 13:00Z is 8am in Chicago and 9am in New York. The pantry decides, not the
    // phone: "the 9am run" is 9am at the pantry.
    expect(timeRange(shift().startsAt, shift().endsAt, 'America/New_York')).toBe(
      '9:00 AM – 11:00 AM',
    );
    expect(timeRange(shift().startsAt, shift().endsAt, 'America/Chicago')).toBe(
      '8:00 AM – 10:00 AM',
    );
  });

  it('names today and tomorrow rather than a weekday', () => {
    expect(dayHeading('2026-08-04', '2026-08-04')).toBe('Today, August 4');
    expect(dayHeading('2026-08-05', '2026-08-04')).toBe('Tomorrow, August 5');
    expect(dayHeading('2026-08-11', '2026-08-04')).toBe('Tuesday, August 11');
  });

  it('reads a calendar slot as a local day, never as UTC midnight', () => {
    // `new Date('2026-08-04')` is UTC midnight and lands on August 3 west of
    // Greenwich, which would show the wrong day to half the users.
    expect(monthDay('2026-08-04')).toBe('August 4');
  });

  it('shapes today like the calendar slots the server sends', () => {
    expect(todayCalendarDate(new Date(2026, 7, 4))).toBe('2026-08-04');
  });

  it('reads today in the pantry zone, not the device one (A120)', () => {
    // 03:00 UTC on the 5th is still 23:00 on the 4th at the pantry. A device that
    // has rolled over must not make the pantry's today read as yesterday — the day
    // heading and the "out today" driver picker both hang off this.
    const justAfterUtcMidnight = new Date('2026-08-05T03:00:00Z');
    expect(todayInZone('America/New_York', justAfterUtcMidnight)).toBe('2026-08-04');
    expect(todayInZone('UTC', justAfterUtcMidnight)).toBe('2026-08-05');
  });

  it('falls back to the device day only when no zone has arrived', () => {
    expect(todayInZone(undefined, new Date(2026, 7, 4))).toBe('2026-08-04');
  });
});

// ---------------------------------------------------------------------------
// Copy (§7)
// ---------------------------------------------------------------------------

describe('copy', () => {
  const sentences: string[] = Object.values(COPY).flatMap((value) =>
    typeof value === 'string' ? [value] : [value('Grocer A'), value('Karen')],
  );

  it('uses none of the forbidden words (§7)', () => {
    for (const sentence of sentences) {
      for (const word of FORBIDDEN_IN_COPY) {
        expect(sentence.toLowerCase(), sentence).not.toContain(word);
      }
    }
  });

  it('says "run", never "shift"', () => {
    // §7: the user's word for the thing is "run".
    for (const sentence of sentences) {
      expect(sentence.toLowerCase(), sentence).not.toContain('shift');
    }
  });

  it('quotes S1.3 conflict banner exactly', () => {
    expect(COPY.conflictBanner).toBe(
      "This run conflicts with your declared availability — contact staff if that's a problem.",
    );
  });

  it('asks S1.3 recurring release question exactly', () => {
    expect(COPY.releaseScopeQuestion).toBe('Release just this one, or this and future?');
  });

  it('names the consequence of a release rather than asking "are you sure"', () => {
    expect(COPY.releaseQuestion).toBe('Release this run?');
    expect(COPY.releaseConsequence).toBe('It goes back to the board for others.');
  });

  it('never says the run is finished, closed or completed', () => {
    // I11 / build-plan D1: a Phase-1 run never reaches COMPLETED, and nothing on
    // this screen may imply otherwise.
    for (const sentence of sentences) {
      const lower = sentence.toLowerCase();
      expect(lower, sentence).not.toContain('complete');
      expect(lower, sentence).not.toContain('finished');
      expect(lower, sentence).not.toContain('close the run');
    }
  });

  it('never offers to end a repeating run — that is staff bulk-terminate, not this', () => {
    for (const sentence of sentences) {
      const lower = sentence.toLowerCase();
      expect(lower, sentence).not.toContain('terminate');
      expect(lower, sentence).not.toContain('delete');
      expect(lower, sentence).not.toContain('cancel the');
    }
  });

  it('labels every stop state a person can see', () => {
    const labels: ShiftStopDisposition[] = ['PENDING', 'COLLECTED', 'SKIPPED', 'REASSIGNED'];
    for (const disposition of labels) {
      expect(stopStatusLabel(disposition).length).toBeGreaterThan(0);
    }
  });
});
