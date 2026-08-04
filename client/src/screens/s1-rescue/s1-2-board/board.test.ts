// S1.2's rules, tested without a browser.
//
// There is no jsdom and no component renderer in this repo, and adding one would
// be a dependency (build-plan §3/D5) — so nothing here renders anything. What is
// covered is what `board.ts` exists for: the day grouping, the "open floats to the
// top" order, which row offers which action, the at-risk derivation, the
// optimistic-claim overlay, and the copy. The report says plainly what that leaves
// uncovered.
//
// Run: npx vitest run --root client

import { describe, expect, it } from 'vitest';
import {
  AT_RISK_LEAD_MS,
  BOARD_TABS,
  COPY,
  DEFAULT_BOARD_TAB,
  actionFor,
  boardTabFromQuery,
  claimRefusal,
  dayHeading,
  formatWeekRange,
  groupByDay,
  isAtRisk,
  isoWeekday,
  skippedLines,
  timeRange,
  todayCalendarDate,
  weekEndOf,
  weekStartOf,
  weekdayName,
  withOptimisticClaim,
} from './board.ts';
import type { BoardViewer } from './board.ts';
import { statusChipLook } from '../../../components/StatusChip.tsx';
import { ApiError } from '../../../api/index.ts';
import type { ShiftStatus, ShiftSummary, SkippedShift } from '../../../api/shared.ts';

const ME = 'driver-1';

const driver: BoardViewer = { id: ME, isStaff: false, canDrive: true };
const coordinator: BoardViewer = { id: 'staff-1', isStaff: true, canDrive: false };
const receiver: BoardViewer = { id: 'user-2', isStaff: false, canDrive: false };

function shift(over: Partial<ShiftSummary> = {}): ShiftSummary {
  return {
    id: 's1',
    routeId: 'r1',
    routeName: 'Riverside',
    occurrenceDate: '2026-08-04',
    startsAt: '2026-08-04T13:00:00.000Z',
    endsAt: '2026-08-04T15:00:00.000Z',
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

describe('calendar slots', () => {
  it('reads a YYYY-MM-DD slot as a local day, never as UTC midnight', () => {
    // `new Date('2026-08-04')` is UTC midnight, which is 2026-08-03 for anyone west
    // of Greenwich. The whole point of parsing the parts is that this cannot happen.
    expect(weekdayName('2026-08-04')).toBe('Tuesday');
    expect(isoWeekday('2026-08-04')).toBe(2);
    expect(isoWeekday('2026-08-09')).toBe(7); // Sunday is 7, not 0
  });

  it('names today and tomorrow instead of their weekday', () => {
    expect(dayHeading('2026-08-04', '2026-08-04')).toBe('Today, August 4');
    expect(dayHeading('2026-08-05', '2026-08-04')).toBe('Tomorrow, August 5');
    expect(dayHeading('2026-08-06', '2026-08-04')).toBe('Thursday, August 6');
  });

  it('rolls tomorrow over a month boundary', () => {
    expect(dayHeading('2026-09-01', '2026-08-31')).toBe('Tomorrow, September 1');
  });

  it('formats today as the calendar slot the server compares against', () => {
    expect(todayCalendarDate(new Date(2026, 7, 4, 23, 30))).toBe('2026-08-04');
    expect(todayCalendarDate(new Date(2026, 0, 9, 0, 5))).toBe('2026-01-09');
  });

  it('renders a time range with units a volunteer reads, not an instant', () => {
    expect(timeRange('2026-08-04T13:00:00.000Z', '2026-08-04T15:00:00.000Z', 'UTC')).toBe(
      '1:00 PM – 3:00 PM',
    );
  });
});

describe('grouping and order (S1.2)', () => {
  it('groups by the pantry-local occurrence date, ascending', () => {
    const groups = groupByDay(
      [
        shift({ id: 'b', occurrenceDate: '2026-08-06' }),
        shift({ id: 'a', occurrenceDate: '2026-08-04' }),
        shift({ id: 'c', occurrenceDate: '2026-08-04', startsAt: '2026-08-04T16:00:00.000Z' }),
      ],
      driver,
    );
    expect(groups.map((group) => group.date)).toEqual(['2026-08-04', '2026-08-06']);
    expect(groups[0]?.rows).toHaveLength(2);
  });

  it('floats open runs to the top of each day', () => {
    const groups = groupByDay(
      [
        // Earlier, but claimed — it must still sort below the later open run.
        shift({
          id: 'claimed-early',
          status: 'CLAIMED',
          ownerId: 'other',
          ownerName: 'Karen Holt',
          startsAt: '2026-08-04T09:00:00.000Z',
        }),
        shift({ id: 'open-late', startsAt: '2026-08-04T17:00:00.000Z' }),
      ],
      driver,
    );
    expect(groups[0]?.rows.map((row) => row.shift.id)).toEqual(['open-late', 'claimed-early']);
  });

  it('orders the rest by start time, then by route name for a stable board', () => {
    const groups = groupByDay(
      [
        shift({ id: '2', status: 'CLAIMED', ownerId: 'x', startsAt: '2026-08-04T15:00:00.000Z' }),
        shift({
          id: '1b',
          status: 'CLAIMED',
          ownerId: 'x',
          routeName: 'Westside',
          startsAt: '2026-08-04T09:00:00.000Z',
        }),
        shift({
          id: '1a',
          status: 'CLAIMED',
          ownerId: 'x',
          routeName: 'Eastside',
          startsAt: '2026-08-04T09:00:00.000Z',
        }),
      ],
      driver,
    );
    expect(groups[0]?.rows.map((row) => row.shift.id)).toEqual(['1a', '1b', '2']);
  });

  it('marks a run the viewer owns as theirs — the §3 ownership overlay', () => {
    const groups = groupByDay(
      [
        shift({ id: 'mine', status: 'CLAIMED', ownerId: ME, ownerName: 'Sam Reed' }),
        shift({ id: 'theirs', status: 'CLAIMED', ownerId: 'other', ownerName: 'Karen Holt' }),
      ],
      driver,
    );
    const rows = Object.fromEntries(groups[0]!.rows.map((row) => [row.shift.id, row]));
    expect(rows['mine']?.mine).toBe(true);
    expect(rows['theirs']?.mine).toBe(false);
  });

  it('tags a run minted from a pattern as repeating', () => {
    const groups = groupByDay([shift({ recurrencePatternId: 'p1' })], driver);
    expect(groups[0]?.rows[0]?.repeats).toBe(true);
    expect(groupByDay([shift()], driver)[0]?.rows[0]?.repeats).toBe(false);
  });
});

describe('at-risk is derived, never stored (I7)', () => {
  const now = Date.parse('2026-08-04T12:00:00.000Z');
  const soon = shift({ startsAt: '2026-08-05T09:00:00.000Z' }); // 21h away
  const later = shift({ startsAt: '2026-08-07T09:00:00.000Z' });

  it('flags an open run inside the one-day lead — staff view (§4.4)', () => {
    expect(isAtRisk(soon, coordinator, now)).toBe(true);
    expect(isAtRisk(later, coordinator, now)).toBe(false);
  });

  it('uses the same lead the at-risk sweep does', () => {
    const edge = shift({ startsAt: new Date(now + AT_RISK_LEAD_MS).toISOString() });
    const past = shift({ startsAt: new Date(now + AT_RISK_LEAD_MS + 1000).toISOString() });
    expect(isAtRisk(edge, coordinator, now)).toBe(true);
    expect(isAtRisk(past, coordinator, now)).toBe(false);
  });

  it('never shows it to a driver — S1.2 makes it a staff chip', () => {
    expect(isAtRisk(soon, driver, now)).toBe(false);
  });

  it('never flags a run that already has an owner', () => {
    const claimed = shift({
      status: 'CLAIMED',
      ownerId: 'other',
      startsAt: '2026-08-05T09:00:00.000Z',
    });
    expect(isAtRisk(claimed, coordinator, now)).toBe(false);
  });

  it('never flags a run whose start has already passed', () => {
    expect(isAtRisk(shift({ startsAt: '2026-08-04T09:00:00.000Z' }), coordinator, now)).toBe(
      false,
    );
  });
});

describe('what each row offers (S1.2 states)', () => {
  it('offers Claim on an open row, to a driver', () => {
    expect(actionFor(shift(), driver, false)).toBe('CLAIM');
  });

  it('offers no claim to someone without the drive duty — I2 is set membership', () => {
    // A Staff coordinator outranks a driver (I1) and still may not claim: the server
    // declares `anyDuty: ['DRIVE']`, and a tier never confers a duty.
    expect(actionFor(shift(), coordinator, false)).toBe('DETAIL');
    expect(actionFor(shift(), receiver, false)).toBe('NONE');
  });

  it('opens the detail from a row the viewer owns', () => {
    expect(actionFor(shift({ status: 'CLAIMED', ownerId: ME }), driver, true)).toBe('DETAIL');
  });

  it('gives a claimed-by-other row no action', () => {
    expect(actionFor(shift({ status: 'CLAIMED', ownerId: 'other' }), driver, false)).toBe('NONE');
  });

  it('opens the viewer own in-progress row into S1.3 — the board way back into a run', () => {
    // S1.2's "who may open a row" rule is about ownership, not status. Left dead,
    // a driver who navigates away mid-run finds nothing on the board, which is the
    // screen they look at first.
    expect(actionFor(shift({ status: 'IN_PROGRESS', ownerId: ME }), driver, true)).toBe('DETAIL');
  });

  it('still gives a driver no action on someone else in-progress row', () => {
    expect(actionFor(shift({ status: 'IN_PROGRESS', ownerId: 'other' }), driver, false)).toBe(
      'NONE',
    );
  });

  it('gives a Done row no action — read-only, and unreachable in Phase 1 (D1)', () => {
    // There is no COMPLETED transition in Phase 1: the receiver's receive-done is
    // the only completion action (I11) and ships in Phase 2. Built and styled here,
    // deliberately unexercised by anything that can actually produce the state.
    expect(actionFor(shift({ status: 'COMPLETED', ownerId: ME }), driver, true)).toBe('NONE');
  });

  it('lets staff open any row — S1.3 names staff as one of its users', () => {
    expect(actionFor(shift({ status: 'IN_PROGRESS', ownerId: 'other' }), coordinator, false)).toBe(
      'DETAIL',
    );
  });
});

describe('optimistic claim (§6)', () => {
  const board = [shift({ id: 'a' }), shift({ id: 'b' })];

  it('shows the tapped run as the viewer own, instantly', () => {
    const after = withOptimisticClaim(board, 'a', { id: ME, name: 'Sam Reed' });
    expect(after[0]).toMatchObject({ status: 'CLAIMED', ownerId: ME, ownerName: 'Sam Reed' });
    expect(after[1]).toEqual(board[1]);
  });

  it('leaves a run that is no longer open alone', () => {
    const taken = [shift({ id: 'a', status: 'CLAIMED', ownerId: 'other', ownerName: 'Karen' })];
    expect(withOptimisticClaim(taken, 'a', { id: ME, name: 'Sam Reed' })).toEqual(taken);
  });

  it('never mutates the fetched board', () => {
    withOptimisticClaim(board, 'a', { id: ME, name: 'Sam Reed' });
    expect(board[0]?.status).toBe('OPEN');
  });
});

describe('partial success (S1.2, PRD cap 6)', () => {
  function skipped(reasons: SkippedShift['reasons']): SkippedShift {
    return {
      shiftId: 'x',
      occurrenceDate: '2026-08-11',
      startsAt: '2026-08-11T13:00:00.000Z',
      endsAt: '2026-08-11T15:00:00.000Z',
      routeName: 'Riverside',
      reasons,
    };
  }

  it('says why each run was skipped, in the server own words where it has them', () => {
    expect(skippedLines([skipped(['OWNED_SHIFT_OVERLAP'])])[0]?.reason).toBe(
      'You already have a run at that time. Cancel it first.',
    );
    expect(skippedLines([skipped(['AVAILABILITY_BLOCK'])])[0]?.reason).toBe(
      "You marked yourself away then. Clear that first if you can make it.",
    );
  });

  it('has its own sentence for the lost race, which is not an eligibility fact', () => {
    expect(skippedLines([skipped(['NO_LONGER_OPEN'])])[0]?.reason).toBe(
      'Someone else took it first.',
    );
  });

  it('names the date of each skipped run', () => {
    expect(skippedLines([skipped(['AVAILABILITY_BLOCK'])])[0]?.when).toContain('August 11');
  });
});

describe('the week on screen', () => {
  it('opens on the Monday-to-Sunday week the report cuts (A178)', () => {
    // A Wednesday. Both screens have to answer this the same way or a coordinator
    // cross-checking the board against S3.1 is comparing different seven days.
    const start = weekStartOf('2026-08-05');
    expect(start).toBe('2026-08-03');
    expect(weekEndOf(start)).toBe('2026-08-09');
  });

  it('names the window in the short form, both ends', () => {
    expect(formatWeekRange('2026-08-03', '2026-08-09')).toBe('Aug 3 – Aug 9');
  });

  it('spans a month boundary without either end losing its month', () => {
    expect(formatWeekRange('2026-08-31', '2026-09-06')).toBe('Aug 31 – Sep 6');
  });

  it('shows an unparseable bound rather than "undefined NaN"', () => {
    expect(formatWeekRange('not-a-date', '2026-08-09')).toBe('not-a-date – Aug 9');
  });
});

describe('D63 — the board browses, Schedule manages', () => {
  it('gives staff no per-row management control, whatever the run', () => {
    // The Edit link into S1.6 is gone, and with it `canEditRun` and `COPY.edit`.
    // A staff row's one action is still to open S1.3.
    const [group] = groupByDay([shift({ status: 'OPEN' })], coordinator, Date.now(), '2026-08-04');
    const row = group?.rows[0];
    expect(row?.action).toBe('DETAIL');
    expect(Object.keys(row ?? {})).not.toContain('canEdit');
    expect(Object.keys(COPY)).not.toContain('edit');
    expect(Object.keys(COPY)).not.toContain('editAria');
  });

  it('leaves the driver row untouched — it never had the control', () => {
    const [group] = groupByDay([shift({ status: 'OPEN' })], driver, Date.now(), '2026-08-04');
    expect(group?.rows[0]?.action).toBe('CLAIM');
  });
});

describe('the tabs (D30, reshaped by D49)', () => {
  it('opens on the run board when the URL names no tab', () => {
    expect(boardTabFromQuery(undefined, true)).toBe('board');
    expect(boardTabFromQuery('', true)).toBe('board');
  });

  it('lands a stale or mistyped tab on the board rather than on nothing', () => {
    expect(boardTabFromQuery('metrics', true)).toBe('board');
    expect(boardTabFromQuery('AWAY', true)).toBe('board');
  });

  it("honours a link to When I'm away, which is the point of putting it in the URL", () => {
    // The old inner `runs|away` row was local `useState`, so this link could not
    // exist at all. That it does is the whole of D49's URL half.
    expect(boardTabFromQuery('away', true)).toBe('away');
  });

  it('no longer answers the retired `mine` tab, which is a page of its own now (D49)', () => {
    // `/board?tab=mine` was D30's driver runs panel. D49 moved that to `/my-shifts`,
    // so an old link lands on the board rather than on a tab that is not there.
    expect(boardTabFromQuery('mine', true)).toBe('board');
  });

  it('collapses to the board for someone who does not drive (I2)', () => {
    // Duty is set membership, so a Staff coordinator does not get the driver's tab
    // by being senior. They are offered no tab row at all, and a `?tab=away` link
    // forwarded to them must not open a panel that is not theirs.
    expect(boardTabFromQuery('away', false)).toBe('board');
    expect(boardTabFromQuery(undefined, false)).toBe('board');
  });

  it('offers two tabs, with the run board first', () => {
    expect(BOARD_TABS.map((tab) => tab.value)).toEqual(['board', 'away']);
    expect(BOARD_TABS[0]?.value).toBe(DEFAULT_BOARD_TAB);
    expect(BOARD_TABS[1]?.label).toBe("When I'm away");
  });
});

describe('a refused claim sticks to its row (D52)', () => {
  it("carries the server's own sentence, not a second wording of the rule", () => {
    // I20's overlapping-claim gate. `services/coverage.ts` throws 409 NOT_ELIGIBLE
    // with `claimRefusedMessage(reasons)` as the detail; the row shows that string
    // and composes nothing.
    const refused = new ApiError('conflict', {
      status: 409,
      code: 'NOT_ELIGIBLE',
      detail: 'You already have a run at that time. Cancel it first.',
    });
    expect(claimRefusal(refused, 's1')).toEqual({
      shiftId: 's1',
      reason: 'You already have a run at that time. Cancel it first.',
    });
  });

  it('names the row that was refused, so the reason cannot land on another run', () => {
    expect(claimRefusal(new ApiError('conflict'), 'shift-9').shiftId).toBe('shift-9');
  });

  it("falls back to §6's plain line only when the payload carried none", () => {
    // Same fallback the toast takes, so the two can never say different things.
    expect(claimRefusal(new ApiError('conflict'), 's1').reason).toBe(
      'Someone changed this just now. Try again.',
    );
    expect(claimRefusal(new Error('boom'), 's1').reason).toBe(
      'Something went wrong. Tap to try again.',
    );
  });

  it('never puts a correlation id on screen', () => {
    const withId = new ApiError('server', { status: 500, correlationId: 'abc-123' });
    expect(claimRefusal(withId, 's1').reason).not.toContain('abc-123');
  });
});

describe('the status chip (D48, D53)', () => {
  it('reads Returning once the driver has confirmed heading back', () => {
    // I27 is a MILESTONE inside IN_PROGRESS: `services/execution.ts` deliberately
    // leaves `status` alone, and there is no RETURNING status to add. The chip is
    // the only thing that changes.
    expect(
      statusChipLook({ status: 'IN_PROGRESS', pickupCompletedAt: '2026-08-04T15:10:00.000Z' }),
    ).toEqual({ label: 'Returning', modifier: 'in-progress' });
  });

  it('still reads In progress while the run is out', () => {
    expect(statusChipLook({ status: 'IN_PROGRESS', pickupCompletedAt: null }).label).toBe(
      'In progress',
    );
    expect(statusChipLook({ status: 'IN_PROGRESS' }).label).toBe('In progress');
  });

  it('does not let the milestone leak onto any other status', () => {
    // Nothing but an IN_PROGRESS run can carry it, and a stale timestamp on a row
    // that has moved on must not rewrite that row's word.
    const at = '2026-08-04T15:10:00.000Z';
    expect(statusChipLook({ status: 'CLAIMED', pickupCompletedAt: at }).label).toBe('Claimed');
    expect(statusChipLook({ status: 'COMPLETED', pickupCompletedAt: at }).label).toBe('Done');
    expect(statusChipLook({ status: 'OPEN', pickupCompletedAt: at }).label).toBe('Open');
  });

  it('keeps the overlays ahead of it, and each other', () => {
    expect(statusChipLook({ status: 'CLAIMED', mine: true }).label).toBe('Mine');
    expect(statusChipLook({ status: 'OPEN', atRisk: true }).label).toBe('At risk');
    // The ownership overlay is only over CLAIMED (§3, stated explicitly).
    expect(statusChipLook({ status: 'IN_PROGRESS', mine: true }).label).toBe('In progress');
  });

  it('keeps a chip on every row that has no Claim button (D53)', () => {
    // D53 drops the CHIP, never the status: a row without a Claim button has only
    // the chip to carry it, so every one of these still has a word.
    for (const status of ['CLAIMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const) {
      expect(statusChipLook({ status }).label.length).toBeGreaterThan(0);
    }
  });
});

describe('microcopy (§7)', () => {
  /** §7's forbidden list, verbatim. "instance" is the one this screen would reach
   *  for by accident — the user's word for a run in a series is "run". */
  const FORBIDDEN = [
    'pwa',
    'push subscription',
    'session',
    'payload',
    'endpoint',
    'atomic',
    'instance',
  ];

  const sentences: string[] = [
    ...Object.values(COPY).flatMap((value) => (typeof value === 'string' ? [value] : [])),
    COPY.claimAria('Riverside', '1:00 PM – 3:00 PM'),
    COPY.scopeQuestion('Tuesday'),
    COPY.scopeSeries('Tuesday'),
    COPY.scopeRun('Riverside', '1:00 PM – 3:00 PM'),
    COPY.skipReason(['NO_LONGER_OPEN']),
    COPY.skipReason(['AVAILABILITY_BLOCK']),
  ];

  it('uses none of the forbidden words', () => {
    for (const sentence of sentences) {
      for (const word of FORBIDDEN) {
        expect(sentence.toLowerCase()).not.toContain(word);
      }
    }
  });

  it('keeps S1.2 fixed copy verbatim', () => {
    expect(COPY.header).toBe('Shift board');
    expect(COPY.emptyAll).toBe('No runs scheduled yet.');
    expect(COPY.emptyOpen).toBe('No open runs right now.');
    expect(COPY.emptyOpenBody).toBe('Check back, or set your availability.');
    expect(COPY.repeatsTag).toBe('repeats weekly');
    expect(COPY.scopeQuestion('Tuesday')).toBe('Claim every Tuesday run, or just this one?');
  });

  it('offers exactly the three filters S1.2 names', () => {
    expect([COPY.filterAll, COPY.filterOpen, COPY.filterMine]).toEqual(['All', 'Open', 'Mine']);
  });

  it('names the week control in S3.1 words, not new ones', () => {
    // The same control over the same week on two screens; one spelling of it.
    expect([COPY.previousWeek, COPY.nextWeek, COPY.thisWeek]).toEqual([
      'Previous week',
      'Next week',
      'This week',
    ]);
  });

  it('puts no em dash in anything this screen writes (D21)', () => {
    // `skipReason` is left out on purpose: those sentences belong to
    // `shared/src/coverage.ts` and still carry an em dash. That is shared copy the
    // server sends verbatim, not this screen's to rewrite.
    const own = [
      ...Object.values(COPY).flatMap((value) => (typeof value === 'string' ? [value] : [])),
      COPY.claimAria('Riverside', '1:00 PM – 3:00 PM'),
      COPY.scopeQuestion('Tuesday'),
      COPY.scopeSeries('Tuesday'),
      COPY.scopeRun('Riverside', '1:00 PM – 3:00 PM'),
    ];
    for (const sentence of own) {
      expect(sentence, sentence).not.toContain('—');
    }
  });

  it('gives every empty state a body that says what to do next (§6)', () => {
    for (const body of [COPY.emptyAllBody, COPY.emptyOpenBody, COPY.emptyMineBody]) {
      expect(body.length).toBeGreaterThan(0);
    }
  });
});
