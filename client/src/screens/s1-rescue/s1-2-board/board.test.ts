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
  COPY,
  actionFor,
  dayHeading,
  groupByDay,
  isAtRisk,
  isoWeekday,
  skippedLines,
  timeRange,
  todayCalendarDate,
  weekdayName,
  withOptimisticClaim,
} from './board.ts';
import type { BoardViewer } from './board.ts';
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
      'You already have a run at that time — cancel it first.',
    );
    expect(skippedLines([skipped(['AVAILABILITY_BLOCK'])])[0]?.reason).toBe(
      "You marked yourself away then — clear that first if you can make it.",
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
    expect(COPY.header).toBe('Pickup runs');
    expect(COPY.emptyAll).toBe('No runs scheduled yet.');
    expect(COPY.emptyOpen).toBe('No open runs right now.');
    expect(COPY.emptyOpenBody).toBe('Check back, or set your availability.');
    expect(COPY.repeatsTag).toBe('repeats weekly');
    expect(COPY.scopeQuestion('Tuesday')).toBe('Claim every Tuesday run, or just this one?');
  });

  it('offers exactly the three filters S1.2 names', () => {
    expect([COPY.filterAll, COPY.filterOpen, COPY.filterMine]).toEqual(['All', 'Open', 'Mine']);
  });
});
