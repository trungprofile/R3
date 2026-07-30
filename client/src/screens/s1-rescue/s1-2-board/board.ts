// S1.2 — everything about the board that is a RULE rather than a pixel.
//
// Split out from `Board.tsx` so it can be tested without a browser: there is no
// jsdom and no component renderer in this repo, and adding one would be a
// dependency (build-plan §3/D5). What lives here is what a wrong answer would
// silently break — day grouping, the "open floats to the top" order, which row
// offers which action, the at-risk derivation, and every sentence of copy.
//
// Nothing here decides anything. `architecture.md §4.5`: the client repeats the
// server's rules so a volunteer is not offered an action that would be refused,
// and the server checks each of them again on the request that matters.

import { claimRefusedMessage, weekdayLabel } from '../../../api/shared.ts';
import type {
  ClaimSkipReason,
  EligibilityReason,
  ShiftSummary,
  SkippedShift,
} from '../../../api/shared.ts';

// ---------------------------------------------------------------------------
// Copy (`ui-ux-spec.md S1.2`, §6, §7)
//
// Collected in one object so the forbidden-word check in `board.test.ts` can read
// every user-visible sentence the screen owns. §7 forbids: PWA, push
// subscription, session, payload, endpoint, atomic, instance — which is why the
// word here is always "run", never "shift" or "instance".
// ---------------------------------------------------------------------------

export const COPY = {
  /** S1.2, verbatim: header "Pickup runs". */
  header: 'Pickup runs',

  /** The segmented control — S1.2: "a simple segmented control: All · Open · Mine". */
  filterLabel: 'Which runs',
  filterAll: 'All',
  filterOpen: 'Open',
  filterMine: 'Mine',

  /** S1.2, verbatim: Empty "No runs scheduled yet." */
  emptyAll: 'No runs scheduled yet.',
  emptyAllBody: 'The coordinator adds runs here as they are scheduled.',
  /** §6's empty-state example, verbatim, split into title and body. */
  emptyOpen: 'No open runs right now.',
  emptyOpenBody: 'Check back, or set your availability.',
  emptyMine: "You're not on any runs yet.",
  emptyMineBody: 'Tap Open to see what needs a driver.',

  /** S1.2: "owner name (or 'OPEN')". */
  unowned: 'OPEN',
  /** S1.2: 'recurring shift shows a small "repeats weekly" tag'. */
  repeatsTag: 'repeats weekly',

  claim: 'Claim',
  /** Named for a screen reader, which hears the button out of its row's context. */
  claimAria: (routeName: string, when: string) => `Claim ${routeName}, ${when}`,

  /** S1.2's scope prompt, verbatim: "Claim every Tuesday run, or just this one?" */
  scopeQuestion: (weekday: string) => `Claim every ${weekday} run, or just this one?`,
  scopeConsequence:
    'Claiming every one puts you on the runs that fit your schedule, now and in future.',
  scopeOne: 'Just this one',
  scopeSeries: (weekday: string) => `Every ${weekday}`,

  /** S1.2's partial-success summary: "with a link to view which dates were skipped". */
  seeSkipped: 'See which dates',
  skippedTitle: 'Runs that were skipped',
  skippedDone: 'Done',
  dismissSummary: 'Dismiss',

  /** Why one run in a series claim did not go through. Eligibility reasons reuse the
   *  server's own sentence (`shared/src/coverage.ts`) so the two cannot word it
   *  differently; only the lost-race reason needs one of its own. */
  skipReason: (reasons: readonly ClaimSkipReason[]): string => {
    if (reasons.includes('NO_LONGER_OPEN')) return 'Someone else took it first.';
    const eligibility = reasons.filter(
      (reason): reason is EligibilityReason => reason !== 'NO_LONGER_OPEN',
    );
    return claimRefusedMessage(eligibility);
  },
} as const;

// ---------------------------------------------------------------------------
// Calendar slots
//
// A run's day comes from `occurrenceDate` — the `YYYY-MM-DD` PANTRY-LOCAL slot the
// server already resolved against `app_config.timezone` — and never from
// `startsAt`. Grouping by the instant would put a Tuesday-evening run in
// Wednesday's group for anyone whose device sits east of the pantry, and the
// client is explicitly not allowed to do that conversion (`shared/src/schedule.ts`).
// ---------------------------------------------------------------------------

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** `YYYY-MM-DD` → a local `Date` at midnight. Built from the parts rather than
 *  `new Date(string)`, which parses a bare date as UTC and lands on the previous
 *  day for anyone west of Greenwich. */
export function parseCalendarDate(date: string): Date {
  const parts = date.split('-');
  const year = Number(parts[0] ?? NaN);
  const month = Number(parts[1] ?? NaN);
  const day = Number(parts[2] ?? NaN);
  return new Date(year, month - 1, day);
}

/** ISO weekday, 1 = Monday … 7 = Sunday — the numbering `recurrence_pattern.weekdays`
 *  uses (`data-model.md §5.2`), so `weekdayLabel()` can name it. */
export function isoWeekday(date: string): number {
  const day = parseCalendarDate(date).getDay();
  return day === 0 ? 7 : day;
}

/** "Tuesday" — the word S1.2's claim prompt is built from. */
export function weekdayName(date: string): string {
  return weekdayLabel([isoWeekday(date)]);
}

/** Today by the DEVICE's clock. A121 chose this because the client had no access to
 *  `app_config.timezone` — which stopped being true when A120 put the pantry's zone on
 *  the session. Kept only as the fallback inside `app/pantry-day.ts`'s `todayInZone`,
 *  and as the default for callers holding no session; the screen passes the pantry's
 *  day (A138). Do not reach for this one. */
export function todayCalendarDate(now: Date = new Date()): string {
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function addDays(date: string, days: number): string {
  const shifted = parseCalendarDate(date);
  shifted.setDate(shifted.getDate() + days);
  return todayCalendarDate(shifted);
}

/**
 * A day heading. "Today" and "Tomorrow" replace the weekday where they apply —
 * §1 principle 4 is recognition over recall, and a volunteer reads "Today" faster
 * than they map "Tuesday" onto the calendar.
 */
export function dayHeading(date: string, today: string = todayCalendarDate()): string {
  const parsed = parseCalendarDate(date);
  const monthDay = `${MONTHS[parsed.getMonth()] ?? ''} ${parsed.getDate()}`;
  if (date === today) return `Today, ${monthDay}`;
  if (date === addDays(today, 1)) return `Tomorrow, ${monthDay}`;
  return `${weekdayName(date)}, ${monthDay}`;
}

/** "9:00 AM – 11:00 AM" in the PANTRY's zone (A120), which the session carries.
 *  A run's window is a pantry-local fact: the 9am run is 9am at the pantry, not on
 *  whatever device is reading it. Left undefined the device's own zone is used —
 *  correct only for the moment before the session has loaded, since there is
 *  nothing better to fall back to. */
export function timeRange(startsAt: string, endsAt: string, timeZone?: string): string {
  const format = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  });
  return `${format.format(new Date(startsAt))} – ${format.format(new Date(endsAt))}`;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/** S1.2: "Filter is a simple segmented control: All · Open · Mine (no dropdown)." */
export const BOARD_FILTERS = ['ALL', 'OPEN', 'MINE'] as const;
export type BoardFilter = (typeof BOARD_FILTERS)[number];

/**
 * What the viewer may do with one row.
 *
 * S1.2 states them: "Primary action: on an Open row, **Claim**. On a Mine row, the
 * row opens S1.3." and, for the rest, "no action from the board".
 */
export type RowAction = 'CLAIM' | 'DETAIL' | 'NONE';

/** Just enough of the signed-in user to decide what to offer. Both comparisons are
 *  resolved by the caller from `app/access.ts`, where I1 (hierarchical) and I2 (set
 *  membership) are kept apart. */
export interface BoardViewer {
  id: string;
  /** Tier >= STAFF (I1). Gates the at-risk chip — S1.2 calls it "staff view". */
  isStaff: boolean;
  /** Holds the Drive duty (I2). Claiming is `anyDuty: ['DRIVE']` server-side. */
  canDrive: boolean;
}

export interface BoardRow {
  shift: ShiftSummary;
  /** The ownership overlay of §3 — not a status. Only changes the CLAIMED chip. */
  mine: boolean;
  /** Derived at read time and never stored (I7). */
  atRisk: boolean;
  action: RowAction;
  repeats: boolean;
}

export interface DayGroup {
  /** `YYYY-MM-DD`, pantry-local. */
  date: string;
  heading: string;
  rows: BoardRow[];
}

/**
 * "At-risk alert, 1 day before an unclaimed shift" (`architecture.md §4.4`), which
 * `services/coverage.ts` fixes as `AT_RISK_LEAD_MS`. The chip on the board is the
 * same fact the sweep alerts on, so it uses the same offset.
 */
export const AT_RISK_LEAD_MS = 24 * 60 * 60 * 1000;

/** I7: `MISSED`/at-risk is derived at read time, never a stored status — so it
 *  arrives here as a computation over `status` and `startsAt`, not off the wire. */
export function isAtRisk(shift: ShiftSummary, viewer: BoardViewer, nowMs: number): boolean {
  if (!viewer.isStaff) return false; // S1.2: "At-risk (warning chip, staff view)"
  if (shift.status !== 'OPEN') return false;
  const startsAt = Date.parse(shift.startsAt);
  if (Number.isNaN(startsAt)) return false;
  return startsAt > nowMs && startsAt - nowMs <= AT_RISK_LEAD_MS;
}

export function actionFor(shift: ShiftSummary, viewer: BoardViewer, mine: boolean): RowAction {
  // An open run's one action is Claim (S1.2). Offered only to a driver: claiming is
  // `anyDuty: ['DRIVE']` on the server and duty is set membership, never implied by
  // a tier (I2).
  if (shift.status === 'OPEN') {
    if (viewer.canDrive) return 'CLAIM';
    return viewer.isStaff ? 'DETAIL' : 'NONE';
  }
  // "On a Mine row, the row opens S1.3." Mine is the CLAIMED overlay (§3); an
  // IN_PROGRESS run of your own is explicitly "no action from the board".
  if (mine && shift.status === 'CLAIMED') return 'DETAIL';
  // S1.3 names staff as one of its two users, and the board is the only screen that
  // links there (see the report's `Assumed:`).
  return viewer.isStaff ? 'DETAIL' : 'NONE';
}

export function toRow(shift: ShiftSummary, viewer: BoardViewer, nowMs: number): BoardRow {
  const mine = shift.ownerId !== null && shift.ownerId === viewer.id;
  return {
    shift,
    mine,
    atRisk: isAtRisk(shift, viewer, nowMs),
    action: actionFor(shift, viewer, mine),
    repeats: shift.recurrencePatternId !== null,
  };
}

/**
 * S1.2: "vertical list of big rows grouped by day", and "Open runs float to the top
 * of each day."
 *
 * Days ascend; inside a day open runs come first and the rest follow their start
 * time. The route name breaks a tie so the order is stable across reloads rather
 * than however the two rows happened to arrive.
 */
export function groupByDay(
  shifts: readonly ShiftSummary[],
  viewer: BoardViewer,
  nowMs: number = Date.now(),
  /** The pantry's today (A138). Defaults to the device's only for callers with no
   *  session in hand; the screen always passes the real one. */
  today: string = todayCalendarDate(),
): DayGroup[] {
  const byDate = new Map<string, BoardRow[]>();

  for (const shift of shifts) {
    const rows = byDate.get(shift.occurrenceDate);
    if (rows) rows.push(toRow(shift, viewer, nowMs));
    else byDate.set(shift.occurrenceDate, [toRow(shift, viewer, nowMs)]);
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, rows]) => ({
      date,
      heading: dayHeading(date, today),
      rows: rows.sort(compareRows),
    }));
}

function compareRows(a: BoardRow, b: BoardRow): number {
  const openFirst = Number(b.shift.status === 'OPEN') - Number(a.shift.status === 'OPEN');
  if (openFirst !== 0) return openFirst;
  const byStart = a.shift.startsAt.localeCompare(b.shift.startsAt);
  if (byStart !== 0) return byStart;
  return a.shift.routeName.localeCompare(b.shift.routeName);
}

// ---------------------------------------------------------------------------
// Optimistic claim (§6)
// ---------------------------------------------------------------------------

/**
 * "Optimistic claim: claiming a shift updates instantly. If lost (someone claimed
 * first), revert with a clear toast." (§6)
 *
 * This is the "updates instantly" half: the row the driver tapped is re-rendered as
 * theirs before the server has answered. It is a display overlay and nothing more —
 * the write that counts is the conditional UPDATE in `services/coverage.ts`, whose
 * zero-row result is what produces "That run was just taken by Karen."
 */
export function withOptimisticClaim(
  shifts: readonly ShiftSummary[],
  shiftId: string,
  viewer: { id: string; name: string },
): ShiftSummary[] {
  return shifts.map((shift) =>
    shift.id === shiftId && shift.status === 'OPEN'
      ? { ...shift, status: 'CLAIMED' as const, ownerId: viewer.id, ownerName: viewer.name }
      : shift,
  );
}

/** One line of the "which dates were skipped" list (S1.2's partial-success link). */
export interface SkippedLine {
  shiftId: string;
  when: string;
  routeName: string;
  reason: string;
}

/** I20 refuses a conflicting run rather than force-claiming it, so a series claim
 *  reports what it skipped instead of pretending it took everything (PRD cap 6). */
export function skippedLines(
  skipped: readonly SkippedShift[],
  today: string = todayCalendarDate(),
): SkippedLine[] {
  return skipped.map((run) => ({
    shiftId: run.shiftId,
    when: dayHeading(run.occurrenceDate, today),
    routeName: run.routeName,
    reason: COPY.skipReason(run.reasons),
  }));
}
