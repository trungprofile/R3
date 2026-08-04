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

import { toApiError } from '../../../api/index.ts';
import { claimRefusedMessage, weekdayLabel } from '../../../api/shared.ts';
import type {
  ClaimSkipReason,
  EligibilityReason,
  ShiftSummary,
  SkippedShift,
} from '../../../api/shared.ts';

// The board's week is `app/week.ts`'s week, which is `weekBounds()`'s week on the
// server (A178). Re-exported here so the screen keeps one import, and so nothing in
// this folder can grow a second answer to "which Monday?" — S3.1's report cuts the
// same seven days and staff read the two side by side.
//
// `isoWeekday` is deliberately NOT re-exported: this file already has one of its
// own for `weekdayLabel`, and two names would be one too many.
export { isCurrentWeek, nextWeek, previousWeek, weekEndOf, weekStartOf } from '../../../app/week.ts';

// ---------------------------------------------------------------------------
// Copy (`ui-ux-spec.md S1.2`, §6, §7)
//
// Collected in one object so the forbidden-word check in `board.test.ts` can read
// every user-visible sentence the screen owns. §7 forbids: PWA, push
// subscription, session, payload, endpoint, atomic, instance — which is why the
// word here is always "run", never "shift" or "instance".
// ---------------------------------------------------------------------------

export const COPY = {
  /** S1.2. Was verbatim "Pickup runs" until `D49` split the driver's two pages:
   *  this one is the shared board, and `/my-shifts` is the driver's own runs.
   *  Two pages both headed "Pickup runs" would be the confusion `D49` set out
   *  to remove, so the heading takes the nav entry's own words — the same
   *  "the heading matches the entry that led here" rule S1.4 follows. */
  header: 'Shift board',

  /** D49's tab row. "Board" is the word the nav and the notification copy already
   *  use ("Tap to see it on the board."), so the tab is not new vocabulary, and
   *  "When I'm away" is S1.4's own label carried across unchanged. */
  tabsLabel: 'The board and my time away',
  tabBoard: 'Board',
  tabAway: "When I'm away",

  /** The segmented control — S1.2: "a simple segmented control: All · Open · Mine". */
  filterLabel: 'Which runs',
  filterAll: 'All',
  filterOpen: 'Open',
  filterMine: 'Mine',

  /** The week control. S3.1's words, not new ones: it is the same control over the
   *  same Monday-to-Sunday week, and two spellings of one idea is two things to
   *  learn. */
  weekNavLabel: 'Move between weeks',
  previousWeek: 'Previous week',
  nextWeek: 'Next week',
  thisWeek: 'This week',

  /** S1.2, verbatim: Empty "No runs scheduled yet." */
  emptyAll: 'No runs scheduled yet.',
  /** The board is one week wide, so an empty one usually means the wrong week
   *  rather than an empty calendar — which is the part the title cannot say. */
  emptyAllBody: 'Try another week, or ask the coordinator.',
  /** §6's empty-state example, verbatim, split into title and body. */
  emptyOpen: 'No open runs right now.',
  emptyOpenBody: 'Check back, or set your availability.',
  emptyMine: "You're not on any runs yet.",
  emptyMineBody: 'Claim one from Open.',

  /** S1.2: "owner name (or 'OPEN')". */
  unowned: 'OPEN',
  /** S1.2: 'recurring shift shows a small "repeats weekly" tag'. */
  repeatsTag: 'repeats weekly',

  claim: 'Claim',
  /** Named for a screen reader, which hears the button out of its row's context. */
  claimAria: (routeName: string, when: string) => `Claim ${routeName}, ${when}`,

  /** D52. The refusal sentence is the SERVER's — `claimRefusedMessage` already
   *  composes it — so the row prefixes it with nothing and invents nothing. This
   *  label is only the accessible name of the block that carries it. */
  refusedLabel: 'Why that claim did not go through',

  /** S1.2's scope prompt, verbatim: "Claim every Tuesday run, or just this one?" */
  scopeQuestion: (weekday: string) => `Claim every ${weekday} run, or just this one?`,
  scopeConsequence:
    'Claiming every one puts you on the runs that fit your schedule, now and in future.',
  /** Which run was tapped. The prompt is the reason a repeating run sends nothing on
   *  the first tap, so it has to name what it is asking about — "I pressed Claim and
   *  nothing happened" was round 4's reading of a prompt that did not. */
  scopeRun: (routeName: string, when: string) => `${routeName}, ${when}`,
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
// The tabs (D30, reshaped by D49)
//
// D30 mounted the whole of S1.4 here as a `mine` tab, which left a driver meeting
// TWO nested tab rows: `?tab=board|mine` out here, and `runs|away` inside S1.4. The
// inner row was local `useState`, so it reset on every remount and `?tab=mine` could
// never link to "When I'm away" at all. That nesting was the top complaint of the
// round-4 pass.
//
// D49 flattens it into two sibling pages, each with at most ONE tab row:
//
//   /my-shifts  "Today's pickup" (D64) — today, then the rest of this week. No tabs.
//   /board      "Shift board"          — this row: the claimable board, and time away.
//
// So the `mine` tab is gone, not renamed: a driver's own runs are the other PAGE
// now, and the half of S1.4 that has nowhere else to live — the availability
// declaration, which §4 gives no nav entry of its own — is the second tab here.
//
// SAME PATTERN AS S1.8, deliberately: the tab lives in the URL under `?tab=`, so
// "set your time away" is a link someone can send and a reload lands where it left
// off. `logic.ts` in `s1-8-admin/` is where that reasoning was first written down;
// this is the second screen to need it and not a second answer to it.
// ---------------------------------------------------------------------------

export type BoardTab = 'board' | 'away';

export const BOARD_TABS: readonly { value: BoardTab; label: string }[] = [
  { value: 'board', label: COPY.tabBoard },
  { value: 'away', label: COPY.tabAway },
];

/** What `/board` shows when the URL names no tab: the run board. It is what a
 *  driver opens without a specific record in mind — the same reading D18 made for
 *  S1.8's Metrics. */
export const DEFAULT_BOARD_TAB: BoardTab = 'board';

/** The query key the tab lives under. Matches S1.8's `PANEL_QUERY_KEY` so the two
 *  screens spell one idea one way. */
export const BOARD_TAB_QUERY_KEY = 'tab';

/**
 * Which tab a URL asks for.
 *
 * An unknown or absent value is the default rather than an error: a stale bookmark
 * should land somewhere useful, not on a 404 (S1.8's rule, unchanged).
 *
 * `canDrive` collapses it. A staff coordinator who does not drive is offered no tab
 * row at all — one tab is noise — so a `?tab=away` link forwarded to them resolves
 * to the board rather than to a panel with nothing in it. Duty is set membership,
 * never implied by a tier (I2), and the server refuses S1.4's own routes again; this
 * is communication (`architecture.md §4.5`).
 */
export function boardTabFromQuery(value: string | undefined, canDrive: boolean): BoardTab {
  if (!canDrive) return DEFAULT_BOARD_TAB;
  const known = BOARD_TABS.find((tab) => tab.value === value);
  return known ? known.value : DEFAULT_BOARD_TAB;
}

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

/** "Aug 9" — the short form, for the week control, where two dates share the line
 *  with two buttons and the full month name would push them onto a third row. */
function shortMonthDay(date: string): string {
  const parsed = parseCalendarDate(date);
  const month = MONTHS[parsed.getMonth()];
  // An unparseable date shows itself rather than "undefined NaN": the week control
  // is navigation, and a wrong-looking label beats a broken one.
  if (month === undefined || Number.isNaN(parsed.getDate())) return date;
  return `${month.slice(0, 3)} ${parsed.getDate()}`;
}

/** "Aug 3 – Aug 9" — which week the board is showing. The dash is a range glyph,
 *  not prose. */
export function formatWeekRange(weekStart: string, weekEnd: string): string {
  return `${shortMonthDay(weekStart)} – ${shortMonthDay(weekEnd)}`;
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
  // "On a Mine row, the row opens S1.3" — S1.2's "who may open a row" rule, which
  // is about ownership, not status. The states list's "no action for a driver" is
  // about someone ELSE's in-progress run; your own opens S1.3, which is the only
  // link to S1.5 (A139) and so the board's way back into a run you left.
  if (mine && (shift.status === 'CLAIMED' || shift.status === 'IN_PROGRESS')) return 'DETAIL';
  // S1.3 names staff as one of its two users, and the board is the only screen that
  // links there (see the report's `Assumed:`).
  return viewer.isStaff ? 'DETAIL' : 'NONE';
}

/* D63: `canEditRun` used to live here, gating a per-row Edit link into S1.6. The
 * board browses and Schedule manages, so the link is gone — with it the one control
 * on this screen that addressed the viewer as staff rather than as someone looking
 * for a run. Nothing replaced it: S1.6 is a nav entry away. */

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

// ---------------------------------------------------------------------------
// A refused claim (D52)
//
// The optimistic overlay above is only half of §6: "revert with a clear toast". A
// toast is a transient signal, and the refusal a driver actually meets is I20's
// overlapping-claim gate — 409 `NOT_ELIGIBLE`, "You already have a run at that
// time. Cancel it first." — which is a fact ABOUT THAT ROW that stays true until
// they do something about it. Round 4 found the toast scrolling past and the driver
// reading the outcome as "the Claim button is broken".
//
// So the row keeps the reason as well. The sentence is never written here: the
// server composes it (`shared/src/coverage.ts`'s `claimRefusedMessage`, thrown by
// `services/coverage.ts`) and it arrives in `detail`. A second wording on the client
// is a second rule to keep in step with the first.
// ---------------------------------------------------------------------------

export interface ClaimRefusal {
  shiftId: string;
  /** The server's own sentence, or §6's plain fallback when it sent none. */
  reason: string;
}

/**
 * What a refused claim leaves on the row.
 *
 * `detail` is the server's sentence; `message` is the plain, code-free §6 line the
 * error shape already carries per kind. Falling back to `message` rather than to a
 * new string is what stops this from becoming a third place refusal copy lives — it
 * is exactly what the toast shows, so row and toast can never disagree.
 */
export function claimRefusal(error: unknown, shiftId: string): ClaimRefusal {
  const apiError = toApiError(error);
  return { shiftId, reason: apiError.detail ?? apiError.message };
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
