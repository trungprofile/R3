// S3.2 Admin metrics — everything the screen DECIDES, apart from how it is drawn.
//
// PURE ON PURPOSE, the same shape as S1.2's `board.ts` and S1.8's `logic.ts`:
// nothing here touches React, `window` or the network. There is no browser or
// component harness in this repo and adding one would be a dependency no lane may
// add (`phase-3-build-plan.md §3`), so everything on this screen that is a RULE
// rather than a pixel lives here and is covered by `metrics.test.ts`.
//
// Three things this file exists to get right, each of which yields a plausible
// wrong answer if it is got wrong somewhere else:
//
//   1. INTAKE ≠ NTFB-REPORTED. PRD §3 calls this the key data boundary and S3.2
//      repeats it as the screen's "Key:". They are two labelled numbers here and
//      on screen, and no function in this file ever adds or collapses them.
//   2. `previousIntake: null` IS NOT ZERO. A store with no prior period has no
//      trend, not a 100% collapse (`shared/src/metrics.ts`). `trendFor` answers
//      `NO_HISTORY` and states no percentage at all.
//   3. UNCLAIMED and NO_SHOW STAY SPLIT. Rolled together a count says nothing
//      about what to do; split, it is either a scheduling problem or a
//      conversation with one person (I7, and the type's own comment). Nothing
//      below returns their sum as a headline figure.
//
// Weights arrive as `numeric(8,2)` DECIMAL STRINGS and are printed as text.
// `weightAsNumber` exists for geometry and comparison only — a figure that
// round-trips through a JS float can pick up a rounding error in the column that
// feeds the food-bank report (A165).

import { toApiError } from '../../../../api/index.ts';
// D39 — the week boundary is IMPORTED, never re-derived. S3.1 cuts its report on
// it (A178), S1.2's board defaults to it, and now so does this screen; three
// copies of "which Monday" is three chances for two screens to disagree about
// what "this week" means while an admin has both open.
import { weekEndOf, weekStartOf } from '../../../../app/week.ts';
import type {
  CoverageFailure,
  CoverageMetrics,
  CoverageQuery,
  DriverCoverage,
  IntakeMetrics,
  MissedRun,
  RouteCoverage,
  ShapedUser,
  StoreIntake,
} from '../../../../api/shared.ts';

// ---------------------------------------------------------------------------
// Weights
//
// `formatWeight` / `weightWithUnit` are duplicated from S2.2b rather than
// imported: no screen folder imports another's logic (the folders are the unit of
// ownership), and this one is four lines of string surgery. What must not drift is
// the RULE — never arithmetic on a displayed figure — and both copies state it.
// ---------------------------------------------------------------------------

/**
 * A `numeric(8,2)` decimal string as a person reads it: `"2192.00"` → `"2192"`,
 * `"12.50"` → `"12.5"`, `"12.05"` → `"12.05"`.
 *
 * String surgery, never arithmetic. `Number("1222.35")` is already not 1222.35.
 */
export function formatWeight(value: string): string {
  const trimmed = value.trim();
  const [whole = '0', fraction] = trimmed.split('.');
  if (fraction === undefined) return whole;
  const kept = fraction.replace(/0+$/, '');
  return kept === '' ? whole : `${whole}.${kept}`;
}

/** The same figure with its unit. §7: "Units always shown ('lb')." */
export function weightWithUnit(value: string): string {
  return `${formatWeight(value)} lb`;
}

/**
 * A weight as a float, for GEOMETRY AND COMPARISON ONLY.
 *
 * Legitimate uses: how wide a bar is, and which of two periods was larger. Never
 * a number that reaches the screen — those are formatted from the string the
 * server sent. A malformed or missing figure reads as 0 rather than NaN, so one
 * odd row cannot blank the whole chart.
 */
export function weightAsNumber(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

// ---------------------------------------------------------------------------
// The period, shared by both tabs (D39 — which ANSWERS A179)
//
// A179 recorded the 28-day default as a GUESS the docs never settled: four whole
// weeks, chosen so the previous-period comparison would be like-for-like rather
// than a ragged month, with three presets (1 / 4 / 12 weeks) behind a segmented
// control. **D39 answers it.** The default is now THIS WEEK — the same
// Monday-to-Sunday week S3.1 reports on (A178) and S1.2's board opens on — and the
// presets are gone in favour of two date fields, because an admin who wants four
// weeks can now say so exactly and an admin who wants three days no longer cannot.
//
// `services/metrics.ts` moved its own 28-day fallback at the same time, so the
// first paint here matches what the server would have chosen on its own. If the
// two ever drift, the screen shows one window and labels it with another.
//
// WHAT SURVIVED, and it is the load-bearing half: a period is still held and
// stepped as a LENGTH, not as a "last N". `periodFor` takes a number of days, and
// Earlier/Later move by the window's OWN length so consecutive views are adjacent
// and non-overlapping — the same relationship `previousIntake` is measured
// against, one screen up. A seven-day window therefore compares against the seven
// days before it, which is exactly the like-for-like property A179 wanted; what is
// lost is the four-week default's smoothing, and that is the trade.
//
// Every date here is a `YYYY-MM-DD` PANTRY-LOCAL calendar slot, the same frame
// `occurrenceDate` is stated in — never an instant. The screen gets today from
// `todayInZone()` (A120); this module only ever does calendar arithmetic on it.
// ---------------------------------------------------------------------------

export interface Period {
  /** `YYYY-MM-DD`, inclusive. */
  from: string;
  to: string;
}

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
  return new Date(Number(parts[0] ?? NaN), Number(parts[1] ?? NaN) - 1, Number(parts[2] ?? NaN));
}

export function formatCalendarDate(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function addDays(date: string, days: number): string {
  const shifted = parseCalendarDate(date);
  shifted.setDate(shifted.getDate() + days);
  return formatCalendarDate(shifted);
}

/**
 * The window to ask for: `days` long, ending `stepsBack` whole periods before
 * today.
 *
 * `stepsBack: 0` ends today, which is `defaultRange()`'s own definition on the
 * server. Stepping back moves by the period's OWN length, so consecutive views are
 * adjacent and non-overlapping — the same relationship `previousIntake` measures
 * against, one screen up.
 */
export function periodFor(today: string, days: number, stepsBack: number = 0): Period {
  const to = addDays(today, -days * stepsBack);
  return { from: addDays(to, -(days - 1)), to };
}

/**
 * What the screen opens on: THIS WEEK, Monday to Sunday (D39, answering A179).
 *
 * The same boundary S3.1's report is cut on and S1.2's board defaults to, from
 * the same `app/week.ts` helper, so an admin with the report open in one tab and
 * the metrics in another cannot be shown two different weeks under one word.
 */
export function defaultPeriod(today: string): Period {
  const from = weekStartOf(today);
  return { from, to: weekEndOf(from) };
}

/** How many days a window covers, inclusive. This is what Earlier/Later step by
 *  (D39): the window's OWN length, so consecutive views are adjacent and
 *  non-overlapping, which is the relationship `previousIntake` measures against. */
export function periodLength(period: Period): number {
  const from = parseCalendarDate(period.from).getTime();
  const to = parseCalendarDate(period.to).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return 1;
  return Math.round((to - from) / 86_400_000) + 1;
}

/** The window moved whole lengths of itself. Negative steps go later. */
export function stepPeriod(period: Period, steps: number): Period {
  const days = periodLength(period) * steps;
  return { from: addDays(period.from, days), to: addDays(period.to, days) };
}

/** Later than today is a period with no data in it, so the button is not offered.
 *  Read off the window itself now that there is no step counter to consult. */
export function canGoLater(period: Period, today: string): boolean {
  return period.to < today;
}

/** Whether the two fields describe a window the server will take. Communication
 *  only — `services/metrics.ts` parses both dates itself — and it exists so an
 *  admin sees the typo beside the fields rather than in an empty table. */
export function periodError(period: Period): string | null {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(period.from) || !iso.test(period.to)) return COPY.period.incomplete;
  return period.from > period.to ? COPY.period.backwards : null;
}

export function isValidPeriod(period: Period): boolean {
  return periodError(period) === null;
}

/** True when the window IS the current Monday-to-Sunday week, which is what lets
 *  the screen offer "This week" only when it would change something. */
export function isThisWeek(period: Period, today: string): boolean {
  const current = defaultPeriod(today);
  return period.from === current.from && period.to === current.to;
}

/**
 * "March 3 – 30, 2026". The month is repeated only when it changes and the year
 * only when the range crosses one, because the shorter line is the one an admin
 * can read at a glance (§1.7, strip the surface).
 */
export function rangeLabel(from: string, to: string): string {
  const start = parseCalendarDate(from);
  const end = parseCalendarDate(to);
  const startMonth = MONTHS[start.getMonth()] ?? '';
  const endMonth = MONTHS[end.getMonth()] ?? '';

  if (start.getFullYear() !== end.getFullYear()) {
    return `${startMonth} ${start.getDate()}, ${start.getFullYear()} – ${endMonth} ${end.getDate()}, ${end.getFullYear()}`;
  }
  if (start.getMonth() === end.getMonth()) {
    return `${startMonth} ${start.getDate()} – ${end.getDate()}, ${end.getFullYear()}`;
  }
  return `${startMonth} ${start.getDate()} – ${endMonth} ${end.getDate()}, ${end.getFullYear()}`;
}

export function periodRangeLabel(period: Period): string {
  return rangeLabel(period.from, period.to);
}

/** One day, for a row in the missed-runs table. */
export function dayLabel(date: string): string {
  const parsed = parseCalendarDate(date);
  return `${MONTHS[parsed.getMonth()] ?? ''} ${parsed.getDate()}, ${parsed.getFullYear()}`;
}

/**
 * The time a run was due to start, in the PANTRY's zone.
 *
 * A run's window is a pantry-local fact: the 9am run is 9am at the pantry, not on
 * whatever machine is reading the metrics. Left undefined the machine's own zone
 * is used, which is only correct for the moment before the pantry's zone has
 * arrived, since there is nothing better to fall back to.
 */
export function startTimeLabel(startsAt: string, timeZone?: string | undefined): string {
  const parsed = new Date(startsAt);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  }).format(parsed);
}

// ---------------------------------------------------------------------------
// Intake — trend
// ---------------------------------------------------------------------------

/**
 * Which way a store went against the previous equal-length period.
 *
 * `NO_HISTORY` is the one that matters. `previousIntake` is null when there is no
 * prior data, and `shared/src/metrics.ts` says in as many words that this "is
 * different from zero and must not render as a 100% drop" — a store that did not
 * exist last period has no trend, not a catastrophic one. It gets a dash and a
 * plain phrase, never a number and never a red arrow.
 */
export type TrendDirection = 'UP' | 'DOWN' | 'LEVEL' | 'NO_HISTORY';

export interface Trend {
  direction: TrendDirection;
  /** Whole percent change, or null when there is no percentage to state — no
   *  prior period at all, or a prior period of zero to divide by. */
  percent: number | null;
  /** What the cell reads. Plain and non-judgemental (§7). */
  label: string;
}

export function trendFor(intake: string, previousIntake: string | null): Trend {
  // No prior period. NOT a drop — there is nothing to have dropped from.
  if (previousIntake === null) {
    return { direction: 'NO_HISTORY', percent: null, label: COPY.intake.trendNone };
  }

  const now = weightAsNumber(intake);
  const before = weightAsNumber(previousIntake);

  // A prior period of exactly nothing. The change is real but a percentage of
  // zero is not a number, so it is said in words instead of invented.
  if (before === 0) {
    if (now === 0) return { direction: 'LEVEL', percent: 0, label: COPY.intake.trendLevel };
    return { direction: 'UP', percent: null, label: COPY.intake.trendUpFromNothing };
  }

  if (now === before) return { direction: 'LEVEL', percent: 0, label: COPY.intake.trendLevel };

  const percent = Math.round(((now - before) / before) * 100);
  const up = now > before;
  if (percent === 0) {
    // Moved, but by less than half a percent. Saying "0%" would read as no change.
    return {
      direction: up ? 'UP' : 'DOWN',
      percent: 0,
      label: up ? COPY.intake.trendUpTiny : COPY.intake.trendDownTiny,
    };
  }
  return {
    direction: up ? 'UP' : 'DOWN',
    percent,
    label: up ? `up ${percent}%` : `down ${Math.abs(percent)}%`,
  };
}

// ---------------------------------------------------------------------------
// Intake — bars
//
// S3.2: "Simple bar/line, no heavy dashboard." Hand-rolled CSS widths, no chart
// library — Phase 3 added no dependency (`phase-3-build-plan.md §3`) and a
// charting package for eleven horizontal bars would be the heavy dashboard the
// spec rules out in the same sentence.
//
// The bar is SPLIT the way the table is: the part that flows to the food bank and
// the part that does not, in one length. That is the "key data boundary" (PRD §3)
// drawn rather than restated — a reader can see at a glance that a store's tall
// bar is mostly unreported, which is the pattern the screen exists to surface.
// ---------------------------------------------------------------------------

export interface StoreBar {
  key: string;
  donorName: string;
  /** 0–100: this store's intake against the largest in the period. */
  widthPercent: number;
  /** 0–100 OF THE BAR'S OWN WIDTH: the part that went to the food bank. */
  reportedPercent: number;
}

/** A stable key for a store row. Donations carrying a free-text label have no
 *  `donorId` (and the anonymous walk-ins collapse into one bucket), so the name
 *  is the fallback — it is what the server grouped them by. */
export function storeKey(store: Pick<StoreIntake, 'donorId' | 'donorName'>): string {
  return store.donorId ?? `label:${store.donorName}`;
}

function roundPercent(value: number): number {
  return Math.round(value * 10) / 10;
}

/** The tallest bar's figure. 0 when there is nothing, which every scale below
 *  survives by drawing nothing rather than dividing by it. */
export function maxIntake(stores: readonly StoreIntake[]): number {
  return stores.reduce((largest, store) => Math.max(largest, weightAsNumber(store.intake)), 0);
}

export function barFor(store: StoreIntake, max: number): StoreBar {
  const intake = weightAsNumber(store.intake);
  const reported = weightAsNumber(store.reported);
  return {
    key: storeKey(store),
    donorName: store.donorName,
    widthPercent: max <= 0 ? 0 : roundPercent(Math.min(100, (intake / max) * 100)),
    reportedPercent: intake <= 0 ? 0 : roundPercent(Math.min(100, (reported / intake) * 100)),
  };
}

/** Every bar, tallest first — the order that makes "which store gives most" and
 *  "which store gives least" both readable without hunting. */
export function barsFor(stores: readonly StoreIntake[]): StoreBar[] {
  const max = maxIntake(stores);
  return [...stores]
    .sort(compareByIntake)
    .map((store) => barFor(store, max));
}

/** Largest intake first, name ascending to break a tie so the order is stable
 *  across reloads rather than however the two rows happened to arrive. */
export function compareByIntake(a: StoreIntake, b: StoreIntake): number {
  const byIntake = weightAsNumber(b.intake) - weightAsNumber(a.intake);
  if (byIntake !== 0) return byIntake;
  return a.donorName.localeCompare(b.donorName);
}

export function storesByIntake(stores: readonly StoreIntake[]): StoreIntake[] {
  return [...stores].sort(compareByIntake);
}

// ---------------------------------------------------------------------------
// Coverage
//
// I7: `MISSED` is not a stored state. It arrives derived on every request, split
// UNCLAIMED (window passed, nobody took it — a SCHEDULING problem) and NO_SHOW
// (someone committed and did not turn up — a PERSON problem). Nothing here adds
// them: their sum is the number that says nothing about what to do.
//
// A182: a CANCELLED run is neither, by construction. It never reaches this file.
// ---------------------------------------------------------------------------

export function failureLabel(failure: CoverageFailure): string {
  return failure === 'UNCLAIMED' ? COPY.coverage.unclaimed : COPY.coverage.noShow;
}

/** What the word means, in one line. §7: define an unavoidable term inline. */
export function failureExplainer(failure: CoverageFailure): string {
  return failure === 'UNCLAIMED'
    ? COPY.coverage.unclaimedMeans
    : COPY.coverage.noShowMeans;
}

/** `n thing` / `n things`, so no caller writes "1 no-shows". */
export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The denominator that turns a count into a rate (`CoverageMetrics.scheduledCount`).
 *
 * "3 of 21 scheduled runs" rather than "14%": at these volumes a percentage
 * implies a precision the count does not have, and the two raw numbers are what an
 * admin repeats out loud. Null when nothing was scheduled at all — there is no
 * rate to state, and "0 of 0" reads like a fault.
 */
export function rateLabel(count: number, scheduledCount: number): string | null {
  if (scheduledCount <= 0) return null;
  return `${count} of ${plural(scheduledCount, 'scheduled run', 'scheduled runs')}`;
}

/** Most no-shows first, name ascending to break a tie. The server already sorts;
 *  this makes the order the screen's own guarantee rather than an assumption
 *  about a response, and pins the tie-break a count alone cannot decide. */
export function driversByNoShows(drivers: readonly DriverCoverage[]): DriverCoverage[] {
  return [...drivers].sort((a, b) => {
    const byCount = b.noShows - a.noShows;
    return byCount !== 0 ? byCount : a.ownerName.localeCompare(b.ownerName);
  });
}

/** Both failures counted per route, because "this route keeps going unclaimed" and
 *  "this route keeps being flaked on" are different sentences about it. */
export function routeFailureTotal(route: RouteCoverage): number {
  return route.unclaimed + route.noShows;
}

export function routesByFailures(routes: readonly RouteCoverage[]): RouteCoverage[] {
  return [...routes].sort((a, b) => {
    const byTotal = routeFailureTotal(b) - routeFailureTotal(a);
    return byTotal !== 0 ? byTotal : a.routeName.localeCompare(b.routeName);
  });
}

/**
 * A driver's line. STATES THE COUNT AND STOPS.
 *
 * Naming a volunteer's no-shows on a screen is a real thing to do carefully. §7
 * wants plain, second-person, non-judgemental copy, so this says "2 no-shows" and
 * never "unreliable", never a warning colour, never a rank badge. What it means is
 * the admin's call and the conversation is theirs to have.
 */
export function driverLine(driver: DriverCoverage): string {
  return plural(driver.noShows, 'no-show', 'no-shows');
}

/** A route's line. The two failures stay side by side and are never summed —
 *  "3 unclaimed" asks for a schedule change, "3 no-shows" asks for a phone call. */
export function routeLine(route: RouteCoverage): string {
  return `${plural(route.unclaimed, 'unclaimed', 'unclaimed')} · ${plural(route.noShows, 'no-show', 'no-shows')}`;
}

/** Who a missed run belonged to. Null owner is UNCLAIMED by construction — an
 *  OPEN shift has no owner — so the cell says nobody took it rather than "—". */
export function runOwnerLabel(run: Pick<MissedRun, 'ownerName'>): string {
  return run.ownerName ?? COPY.coverage.nobodyClaimed;
}

// ---------------------------------------------------------------------------
// Filters
//
// S3.2: the runs table is "filterable by driver, route, and period". §1.5 rules
// out a dropdown where a visible list fits, and this deployment has under ten
// users and a handful of routes, so both filters are a segmented row.
// ---------------------------------------------------------------------------

/** The "no filter" choice. `CoverageQuery` says absent means "no filter", so this
 *  value is dropped on the way to the query rather than sent. */
export const ANY_FILTER = 'ANY';

export interface FilterOption {
  value: string;
  label: string;
}

/**
 * The driver picker.
 *
 * Filtered to the Drive duty — duty is set membership (I2), never implied by a
 * tier. DEACTIVATED accounts are kept: I21 preserves the account and its history,
 * and a no-show from three weeks ago is exactly the history someone would come
 * here to look up. Hiding them would make a run in the table below unfilterable.
 */
export function driverOptions(users: readonly ShapedUser[]): FilterOption[] {
  const drivers = users
    .filter((user) => user.duties.includes('DRIVE'))
    .map((user) => ({
      value: user.id,
      label: `${user.firstName} ${user.lastName}`.trim(),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return [{ value: ANY_FILTER, label: COPY.coverage.anyDriver }, ...drivers];
}

/** The route picker. Archived routes stay, for the same reason deactivated
 *  drivers do: a route retired last month can still own a missed run in range. */
export function routeOptions(routes: readonly { id: string; name: string }[]): FilterOption[] {
  const named = [...routes]
    .map((route) => ({ value: route.id, label: route.name }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return [{ value: ANY_FILTER, label: COPY.coverage.anyRoute }, ...named];
}

/** The query the coverage endpoint takes. `ANY_FILTER` is omitted, not sent — the
 *  server reads an absent param as "no filter" and a present one as an id. */
export function coverageQueryFor(period: Period, driverId: string, routeId: string): CoverageQuery {
  return {
    from: period.from,
    to: period.to,
    ...(driverId === ANY_FILTER ? {} : { driverId }),
    ...(routeId === ANY_FILTER ? {} : { routeId }),
  };
}

/** True when a filter is narrowing the table — the empty state has to say so, or
 *  "no missed runs" reads as good news when it is really a filter left on. */
export function isFiltered(driverId: string, routeId: string): boolean {
  return driverId !== ANY_FILTER || routeId !== ANY_FILTER;
}

// ---------------------------------------------------------------------------
// Export
//
// S3.2: "Primary action: none destructive; this is read + export." There is no
// metrics export endpoint — the server's only export is S3.1's Meal Connect file,
// which is a different thing with a different audience (D13). So this is the table
// on screen, written out from data already in hand, with no dependency and no
// second trip to the server.
//
// Weights go out as the STRINGS they arrived as. A CSV opened in Excel is the
// thing most likely to be re-summed by hand, so the figure in the file has to be
// the figure in the column, digit for digit.
// ---------------------------------------------------------------------------

/** RFC 4180 quoting: wrap anything with a comma, quote or newline, and double up
 *  the quotes inside. A store called `Kroger, Elm St` must not become two columns. */
export function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function csvRow(cells: readonly string[]): string {
  return cells.map(csvCell).join(',');
}

/**
 * The intake table as CSV, with the totals row the screen shows.
 *
 * Intake, reported and unreported are three columns and stay three columns — the
 * key data boundary survives the export, or the spreadsheet it lands in becomes
 * the place the two numbers get merged.
 */
export function intakeCsv(metrics: IntakeMetrics): string {
  const lines = [
    csvRow(['Store', 'Intake (lb)', 'Reported to food bank (lb)', 'Not reported (lb)', 'Change']),
    ...storesByIntake(metrics.stores).map((store) =>
      csvRow([
        store.donorName,
        formatWeight(store.intake),
        formatWeight(store.reported),
        formatWeight(store.unreported),
        trendFor(store.intake, store.previousIntake).label,
      ]),
    ),
    csvRow([
      COPY.intake.totalsRow,
      formatWeight(metrics.totalIntake),
      formatWeight(metrics.totalReported),
      formatWeight(metrics.totalUnreported),
      '',
    ]),
  ];
  return `${lines.join('\r\n')}\r\n`;
}

/** The missed runs, one row each, in the order the table shows them. The counts
 *  above the table are a `GROUP BY` of this and are not written twice. */
export function coverageCsv(metrics: CoverageMetrics, timeZone?: string | undefined): string {
  const lines = [
    csvRow(['Date', 'Time', 'Route', 'What happened', 'Driver']),
    ...metrics.runs.map((run) =>
      csvRow([
        run.occurrenceDate,
        startTimeLabel(run.startsAt, timeZone),
        run.routeName,
        failureLabel(run.failure),
        run.ownerName ?? '',
      ]),
    ),
  ];
  return `${lines.join('\r\n')}\r\n`;
}

/** `metrics-intake-2026-03-03-to-2026-03-30.csv` — the period is in the name, so
 *  two downloads in one afternoon do not overwrite each other in Downloads. */
export function csvFilename(kind: 'intake' | 'coverage', period: Period): string {
  return `metrics-${kind}-${period.from}-to-${period.to}.csv`;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** §6: what happened plus what to do, never a code. The server's own sentence
 *  where it sent one, since it is more specific than anything generic. */
export function loadFailureText(cause: unknown): string {
  const error = toApiError(cause);
  return error.detail ?? error.message;
}

// ---------------------------------------------------------------------------
// Copy (`ui-ux-spec.md` S3.2, §6, §7)
//
// Collected here so one test can hold ALL of it — including the sentences
// composed from data above — to §7: plain, short, second person, and none of the
// forbidden vocabulary.
// ---------------------------------------------------------------------------

/** Forbidden in any UI string (`ui-ux-spec.md §7`). Pinned by a test rather than
 *  by good intentions. */
export const FORBIDDEN_IN_COPY = [
  'pwa',
  'push subscription',
  'session',
  'payload',
  'endpoint',
  'atomic',
  'instance',
] as const;

/** S3.2's two tabs. Exactly one panel is rendered at a time (§3's tabs behavior). */
export type TabId = 'intake' | 'coverage';

export const TABS: readonly { value: TabId; label: string }[] = [
  { value: 'intake', label: 'Intake' },
  { value: 'coverage', label: 'Missed runs' },
];

export const COPY = {
  title: 'Metrics',
  tabsLabel: 'Intake and missed runs',

  period: {
    /** D39 — the segmented row of "1 week / 4 weeks / 12 weeks" is gone and so is
     *  the sentence that labelled it. Two date fields say what they are. */
    label: 'Which dates',
    heading: 'Dates',
    from: 'From',
    to: 'To',
    thisWeek: 'This week',
    incomplete: 'Fill in both dates.',
    backwards: 'The first date has to be on or before the second.',
    earlier: 'Earlier',
    later: 'Later',
    /** Named for a screen reader, which hears the button out of its row. Both
     *  step by the window's own length, which is why neither names a number. */
    earlierAria: 'Show the dates before these',
    laterAria: 'Show the dates after these',
  },

  intake: {
    heading: 'What came in',
    /** PRD §3's key data boundary, said once at the top rather than left to be
     *  worked out from two column headings. */
    lede: 'Every pound R3 recorded, and how much of it goes to the food bank. The two are different numbers.',
    loading: 'Loading intake',
    emptyTitle: 'Nothing was recorded in this period.',
    emptyBody: 'Try a wider range of dates, or step back to one where runs had been weighed.',

    colStore: 'Store',
    colIntake: 'Total rescued',
    colReported: 'To the food bank',
    colUnreported: 'Not reported',
    colTrend: 'Change',
    /** The column headings are short; the boundary they draw is not obvious from
     *  four words, so each carries its own line underneath. */
    intakeMeans: 'Everything received from this store.',
    reportedMeans: 'The part that goes on the food-bank report.',
    unreportedMeans: 'The rest. Tracked here, never reported.',
    trendMeans: 'Against the period before this one.',

    totalsRow: 'All stores',
    comparedWith: (from: string, to: string) => `Compared with ${rangeLabel(from, to)}.`,

    trendNone: 'no earlier figure',
    trendLevel: 'no change',
    trendUpFromNothing: 'up from none',
    trendUpTiny: 'up by less than 1%',
    trendDownTiny: 'down by less than 1%',

    chartHeading: 'By store',
    chartLegendReported: 'To the food bank',
    chartLegendUnreported: 'Not reported',
    /** The chart is the table drawn; a screen reader already has the numbers. */
    chartNote: 'The same figures as the table, drawn to scale.',

    export: 'Download this table',
  },

  coverage: {
    heading: 'Runs that never happened',
    lede: 'Two different problems, kept apart. Nothing here can be edited.',
    loading: 'Loading missed runs',

    unclaimed: 'Unclaimed',
    noShow: 'No-show',
    unclaimedMeans: 'The time passed and nobody took the run.',
    noShowMeans: 'Someone took the run and it was never started.',

    byDriverHeading: 'By driver',
    byDriverNote: 'No-shows only. An unclaimed run had no driver to name.',
    byRouteHeading: 'By route',
    byRouteEmpty: 'No route missed a run in this period.',
    byDriverEmpty: 'No driver missed a run they had taken.',

    runsHeading: 'Every missed run',
    colDate: 'Date',
    colTime: 'Due',
    colRoute: 'Route',
    colFailure: 'What happened',
    colDriver: 'Driver',
    nobodyClaimed: 'Nobody took it',

    filterDriverLabel: 'Which driver',
    filterRouteLabel: 'Which route',
    anyDriver: 'Any driver',
    anyRoute: 'Any route',
    clearFilters: 'Show all runs',

    /** Good news, and it should read like it (§6: instructive, never "nothing
     *  here"). Cancelled runs are deliberately not counted — A182. */
    emptyTitle: 'No missed runs in this period.',
    emptyBody: 'Every run was taken and started. A run staff cancelled is not counted here.',
    emptyFilteredTitle: 'No missed runs match these filters.',
    emptyFilteredBody: 'Widen the filters, or step back to earlier dates.',

    export: 'Download these runs',
  },
} as const;
