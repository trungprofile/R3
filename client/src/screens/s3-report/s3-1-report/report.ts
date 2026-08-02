// S3.1 report generation — every decision the screen makes, as a function of
// plain records.
//
// Written this way so it can be tested at all: there is no browser or component
// harness in this repo and adding one would be a dependency no lane may add
// (`phase-3-build-plan.md §3`). The JSX beside this file arranges what is decided
// here.
//
// EVERYTHING BELOW IS COMMUNICATION ONLY. `services/report.ts` computes the union
// of `domain-modeling.md §6` (locked), decides `readyToExport`, and refuses the
// export while a category carrying weight is unmapped — inside a SERIALIZABLE
// transaction for the writes. Nothing here re-derives any of that. Hiding the
// Export button on a blocked week is a courtesy to a Reporter at a desktop, never
// the rule (`CLAUDE.md`).
//
// THREE RULES THIS FILE HOLDS, none of them cosmetic:
//
//   1. A weight is a decimal string from the moment it arrives to the moment it
//      goes back (A165). `numeric(8,2)` is exact and a float is not, and this is
//      the column the food bank reads. Every function here does string work, and
//      the one that adds weights up adds integer cents (`phase-3-build-plan.md
//      §1.3`) rather than routing anything through a JS float.
//   2. `reportedTotal` and `intakeTotal` are never conflated. PRD §3 insists they
//      stay two distinct, clearly labelled numbers everywhere, and this is the
//      screen most likely to blur them — so they arrive through one function that
//      always emits all three figures with their own words.
//   3. Unmapped weight is surfaced, never dropped (D12). A short report is
//      invisible at the far end, which is the "lost-sheet misreporting" failure
//      Success Metric 4 exists to kill.

import { toApiError } from '../../../api/index.ts';
import {
  isCurrentWeek,
  isoWeekday,
  previousWeek,
  weekStartOf,
} from '../../../app/week.ts';
import { EXPORT_BLOCKED_MESSAGE } from '../../../api/shared.ts';
import type {
  ExportRow,
  NtfbCategory,
  ReportEntry,
  ReportLine,
  UnmappedCategory,
  WeeklyReport,
} from '../../../api/shared.ts';

// ---------------------------------------------------------------------------
// The week (A178 — Monday to Sunday)
//
// The server decides which week an anchor date falls in; these functions only
// move the anchor around and say the range out loud. `weekStartOf` mirrors the
// server's Monday-start so "This week" is not a round trip to find out where the
// Reporter already is.
//
// All arithmetic is done in UTC on a `YYYY-MM-DD` civil date. That is not a
// timezone decision — a civil date has no zone, and UTC is simply the arithmetic
// that never crosses a daylight-saving boundary on the way to the answer.
// ---------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** Monday first, matching the week the report is cut on (A178). */
const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

function utcOf(iso: string): Date | null {
  if (!ISO_DATE.test(iso)) return null;
  const time = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(time) ? null : new Date(time);
}

function isoOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Week arithmetic moved to `app/week.ts` when S1.2's board started defaulting to
// "this week" and needed the same Monday. Re-exported here so this module stays
// the one import a report screen needs, and so there is exactly one definition of
// where a week starts on the client.
export {
  addDaysIso,
  isCurrentWeek,
  isoWeekday,
  nextWeek,
  previousWeek,
  weekEndOf,
  weekStartOf,
} from '../../../app/week.ts';

/** A week that has not started yet. Navigating into one is allowed — it shows an
 *  empty week, which is a true answer — but the screen says so rather than
 *  letting a Reporter read "0 lb" as a bad week. */
export function isFutureWeek(weekStart: string, today: string): boolean {
  const current = weekStartOf(today);
  return ISO_DATE.test(weekStart) && ISO_DATE.test(current) && weekStart > current;
}

/** "Jul 27" — the short form the rest of the app uses. */
export function formatShortDate(iso: string): string {
  const date = utcOf(iso);
  if (!date) return iso;
  const month = MONTH_NAMES[date.getUTCMonth()] ?? '';
  return `${month} ${date.getUTCDate()}`;
}

/** "Mon, Jul 27" — a day heading in the drill-in. */
export function formatDayLabel(iso: string): string {
  const weekday = WEEKDAY_NAMES[isoWeekday(iso) - 1];
  if (weekday === undefined) return iso;
  return `${weekday}, ${formatShortDate(iso)}`;
}

/**
 * The week said plainly: "Mon, Jul 27 – Sun, Aug 2, 2026".
 *
 * The weekday is spelled out at both ends on purpose. A178 chose Monday-to-Sunday
 * with no doc to lean on, so the range has to say which boundary it used rather
 * than leave a Reporter to work it out from two numbers.
 */
export function formatWeekRange(weekStart: string, weekEnd: string): string {
  const start = utcOf(weekStart);
  const end = utcOf(weekEnd);
  if (!start || !end) return `${weekStart} – ${weekEnd}`;

  const startLabel = formatDayLabel(weekStart);
  const endLabel = formatDayLabel(weekEnd);
  const startYear = start.getUTCFullYear();
  const endYear = end.getUTCFullYear();

  if (startYear === endYear) return `${startLabel} – ${endLabel}, ${endYear}`;
  return `${startLabel}, ${startYear} – ${endLabel}, ${endYear}`;
}

/**
 * "This week" / "Last week" / "A week that has not happened yet", or null for an
 * ordinary past week that the date range already names.
 *
 * §1.4 is recognition over recall: a Reporter should read where they are, not
 * work it out by comparing two dates against today's.
 */
export function weekLabel(weekStart: string, today: string): string | null {
  if (isCurrentWeek(weekStart, today)) return COPY.thisWeekHeading;
  if (weekStart === previousWeek(weekStartOf(today))) return COPY.lastWeekHeading;
  if (isFutureWeek(weekStart, today)) return COPY.futureWeekHeading;
  return null;
}

// ---------------------------------------------------------------------------
// Weights — decimal strings, never a JS number (A165)
// ---------------------------------------------------------------------------

/** `numeric(8,2)`: six whole digits and two decimals (`data-model.md §7.1`). The
 *  server guards the same shape; this exists so the keypad stops at the seventh
 *  digit rather than letting a Reporter type a number that is refused on save. */
export const MAX_WHOLE_DIGITS = 6;
export const MAX_DECIMALS = 2;

/** The coarse cap `NumericKeypad` takes; the per-part limits above are the rule. */
export const KEYPAD_MAX_DIGITS = MAX_WHOLE_DIGITS + MAX_DECIMALS;

const WEIGHT_PATTERN = /^\d{1,6}(\.\d{1,2})?$/;
const PARTIAL_PATTERN = /^\d*(\.\d*)?$/;

/**
 * A weight as a person reads it: `"1222.35"` → `"1222.35"`, `"293.00"` → `"293"`,
 * `"12.50"` → `"12.5"`.
 *
 * String surgery only. Anything that is not a plain decimal is shown exactly as
 * it arrived rather than guessed at — a number on this screen is never invented.
 */
export function formatWeight(value: string): string {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return trimmed;

  const [whole = '0', fraction] = trimmed.split('.');
  const lead = whole.replace(/^0+(?=\d)/, '');
  if (fraction === undefined) return lead;

  const kept = fraction.replace(/0+$/, '');
  return kept === '' ? lead : `${lead}.${kept}`;
}

/** §7: "Units always shown ('lb')." */
export function weightWithUnit(value: string): string {
  return `${formatWeight(value)} ${COPY.unit}`;
}

function toCents(value: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = (match[2] ?? '').padEnd(2, '0');
  if (!Number.isSafeInteger(whole)) return null;
  return whole * 100 + Number(fraction);
}

function fromCents(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const fraction = `${cents % 100}`.padStart(2, '0');
  return `${whole}.${fraction}`;
}

/**
 * Adds decimal weights **exactly**, in integer cents.
 *
 * `phase-3-build-plan.md §1.3` names summing in JavaScript as one of the three
 * ways to compute this phase wrong: `0.1 + 0.2` is not `0.3` in a float and the
 * error lands in the column the food bank reads. Every total the *server* sends
 * is already a SQL `sum()`; this exists only for the drill-in's own subtotal,
 * which no endpoint returns.
 *
 * Returns `null` when any value is not a plain decimal, so a malformed figure
 * shows nothing rather than a total that is quietly short — the same reasoning
 * D12 applies to unmapped weight.
 */
export function addWeights(values: readonly string[]): string | null {
  let cents = 0;
  for (const value of values) {
    const parsed = toCents(value);
    if (parsed === null) return null;
    cents += parsed;
  }
  return fromCents(cents);
}

/**
 * The keypad's proposed value, accepted or refused.
 *
 * `NumericKeypad` holds nothing; it hands the screen the value it *would* have
 * and this decides. Refusing returns the current value unchanged, so an over-long
 * entry stops growing instead of flashing an error.
 */
export function acceptKeypadValue(current: string, proposed: string): string {
  if (proposed === '') return '';
  if (!PARTIAL_PATTERN.test(proposed)) return current;

  const cleaned = proposed.replace(/^0+(?=\d)/, '');
  const [whole = '', fraction] = cleaned.split('.');
  if (whole.length > MAX_WHOLE_DIGITS) return current;
  if (fraction !== undefined && fraction.length > MAX_DECIMALS) return current;
  return cleaned;
}

/** What goes on the wire — what was typed, tidied, never reparsed. `12.` is what
 *  the keypad holds mid-typing and is not a number the server takes. */
export function normalizeWeight(raw: string): string {
  const trimmed = raw.trim();
  const withoutTrailingPoint = trimmed.endsWith('.') ? trimmed.slice(0, -1) : trimmed;
  return withoutTrailingPoint.replace(/^0+(?=\d)/, '');
}

/** Whether Save does anything. `0` is left alone: refusing it would be a rule this
 *  screen invented, and the server takes it. */
export function canSaveWeight(raw: string): boolean {
  return WEIGHT_PATTERN.test(normalizeWeight(raw));
}

/** The inline message under the keypad, or null while there is nothing to say. */
export function weightError(raw: string, attempted: boolean): string | null {
  if (!attempted) return null;
  if (normalizeWeight(raw) === '') return COPY.weightRequired;
  return canSaveWeight(raw) ? null : COPY.weightTooLong;
}

// ---------------------------------------------------------------------------
// The two totals, never conflated (PRD §3)
// ---------------------------------------------------------------------------

export interface TotalView {
  key: 'reported' | 'unreported' | 'intake';
  label: string;
  /** The decimal string, unchanged. Formatting happens at render. */
  value: string;
  /**
   * One sentence saying what this number is and is NOT, or null when the label
   * already says it.
   *
   * Null only for `reported` (D21): its label names the food bank and the Export
   * button sits directly below it, so "this is the figure the export file will
   * carry" was the control restating itself. The other two keep theirs and are not
   * negotiable — `domain-modeling.md §6` is locked and defines intake and
   * NTFB-reported as different unions, so the one place the difference is stated in
   * words stays stated.
   */
  note: string | null;
  /** The one number the export file will contain. Rendered with emphasis. */
  primary: boolean;
}

/**
 * All three figures, always together and always with their own words.
 *
 * They are emitted as one list rather than read off `WeeklyReport` field by field
 * because that is what stops the screen showing one of them alone: PRD §3 keeps
 * intake and reported distinct "everywhere", and a lone big number with no label
 * is exactly how they get conflated. `unreportedTotal` sits between them because
 * it is the difference — stated by the server rather than worked out here.
 */
export function totalsView(report: WeeklyReport): TotalView[] {
  return [
    {
      key: 'reported',
      label: COPY.reportedLabel,
      value: report.reportedTotal,
      note: null,
      primary: true,
    },
    {
      key: 'unreported',
      label: COPY.unreportedLabel,
      value: report.unreportedTotal,
      note: COPY.unreportedNote,
      primary: false,
    },
    {
      key: 'intake',
      label: COPY.intakeLabel,
      value: report.intakeTotal,
      note: COPY.intakeNote,
      primary: false,
    },
  ];
}

// ---------------------------------------------------------------------------
// The export decision — S3.1's three states
// ---------------------------------------------------------------------------

/** S3.1: "States: incomplete week (show what is missing), ready, exported." */
export type ReportState = 'INCOMPLETE' | 'READY' | 'EXPORTED';

/**
 * Which of the three the screen is in.
 *
 * `readyToExport` is the SERVER's answer and the only one trusted here — it is
 * computed over the same union that produces the file, and re-deriving it from
 * `unmapped.length` would be a second implementation of the one rule this screen
 * exists to respect. `exported` is the Reporter's own local fact: nothing is
 * stored about having downloaded a file (A181's mapping is read-time all the way
 * down), so it lasts as long as they stay on the week.
 */
export function reportState(report: WeeklyReport, exported: boolean): ReportState {
  if (!report.readyToExport) return 'INCOMPLETE';
  return exported ? 'EXPORTED' : 'READY';
}

/** Whether Export is offered at all. Not disabled — absent (§3: "prefer hiding
 *  over disabling"), because a button that fails is not an interaction. */
export function canExport(report: WeeklyReport): boolean {
  return report.readyToExport;
}

/** The sentence the block leads with. Shared with the server that refuses the
 *  same export, so the two cannot drift (`shared/src/report.ts`). */
export const BLOCKED_MESSAGE = EXPORT_BLOCKED_MESSAGE;

/**
 * The unmapped categories named out loud, with what they are carrying.
 *
 * Named rather than counted: "3 categories" tells a Reporter there is a problem,
 * and the names tell them which rows of the matching list to go and fix. D12 is
 * the whole reason this state exists.
 */
export function unmappedSummary(unmapped: readonly UnmappedCategory[]): string | null {
  if (unmapped.length === 0) return null;
  const names = unmapped.map((row) => row.categoryName).join(', ');
  const noun = unmapped.length === 1 ? COPY.oneCategory : COPY.manyCategories;
  return `${unmapped.length} ${noun} ${COPY.unmappedTail} ${names}.`;
}

/** A run's status in the Reporter's words. `openRuns` carries the raw status as a
 *  string; unknown values fall back to the plain sentence rather than showing a
 *  database word on screen (§7). */
export function runStatusWord(status: string): string {
  switch (status) {
    case 'OPEN':
      return COPY.runOpen;
    case 'CLAIMED':
      return COPY.runClaimed;
    case 'IN_PROGRESS':
      return COPY.runInProgress;
    default:
      return COPY.runUnfinished;
  }
}

/** "Tue AM run, Tue, Jul 28, nobody has claimed it". One line of the incomplete
 *  block, composed from data and therefore swept by the §7 copy test. Commas
 *  rather than an em dash (D21). */
export function openRunLabel(run: WeeklyReport['openRuns'][number]): string {
  return `${run.routeName}, ${formatDayLabel(run.occurrenceDate)}, ${runStatusWord(run.status)}`;
}

/**
 * What the open-run block says, or null when there is nothing outstanding.
 *
 * A184: an open run is **surfaced but does not block**. The file would merely be
 * early, and only the Reporter knows whether the week is really over — deciding
 * for them would be the screen overreaching.
 */
export function openRunsNotice(openRuns: WeeklyReport['openRuns']): string | null {
  if (openRuns.length === 0) return null;
  const noun = openRuns.length === 1 ? COPY.oneRun : COPY.manyRuns;
  return `${openRuns.length} ${noun} ${COPY.openRunsTail}`;
}

/** Everything the week is missing, in one list, for the incomplete state. The
 *  order matters: the blocking problem first, the informational one second. */
export function missingItems(report: WeeklyReport): string[] {
  const items: string[] = [];
  const unmapped = unmappedSummary(report.unmapped);
  if (unmapped !== null) items.push(unmapped);
  const runs = openRunsNotice(report.openRuns);
  if (runs !== null) items.push(runs);
  return items;
}

/**
 * "Enter these under agency 026357P, North Texas Food Bank (24)."
 *
 * `ui-ux-spec.md` S3.1 calls this "the one thing the worksheet cannot check for
 * them", so it goes beside the buttons AND at the top of the printed sheet — the
 * printed sheet being the copy that leaves the screen and gets read alone.
 * Composed from data, so the §7 copy sweep covers it. A comma rather than an em
 * dash (D21).
 */
export function mealConnectAccountNote(account: WeeklyReport['mealConnect']): string {
  return `${COPY.exportAccount} ${account.agencyCode}, ${account.foodBank} (${account.foodBankCode}).`;
}

/** Fallback name for the downloaded file, used only when the server sent no
 *  `content-disposition` to read one from. */
export function exportFilename(weekStart: string, weekEnd: string): string {
  return `agfp-ntfb-${weekStart}-to-${weekEnd}.csv`;
}

/**
 * One worksheet row as cells, in `EXPORT_COLUMNS` order.
 *
 * The printed sheet and the CSV are the same worksheet in two media (D16), and
 * they get their rows from the same service call through the same refusal — so the
 * only thing left that could make them disagree is the order the fields are laid
 * out in. This function is that order on the client; `routes/report.ts` holds the
 * matching one for the CSV, and both are pinned to `EXPORT_COLUMNS` by a test at
 * each end.
 *
 * `NTFB Code` is deliberately absent: Meal Connect picks a category by name from a
 * dropdown, and the `MEAT48675888`-style ids on a receipt are its own per-line
 * identifiers, issued on submission (D13).
 */
export function exportCells(row: ExportRow): string[] {
  return [
    row.day,
    row.donor,
    row.donorCode,
    row.ntfbCategory,
    row.storage,
    row.agfpCategory,
    row.weightLb,
    row.receiptItems,
    row.receiptTotal,
  ];
}

// ---------------------------------------------------------------------------
// The report table
// ---------------------------------------------------------------------------

/** Whether the week has anything in it at all. An empty week is not an error —
 *  it is a week nobody has weighed yet, and it gets an instructive empty state
 *  rather than a zero (§6). */
export function isEmptyWeek(report: WeeklyReport): boolean {
  return report.lines.length === 0 && report.unmapped.length === 0;
}

/** "Frozen Meat, Bakery" — the AGFP categories rolled into one NTFB line, named
 *  for the row's accessible label. The visible table lists them with their own
 *  weights; this is the one-line version a screen reader hears first. */
export function rolledUpNames(line: { agfpCategories: readonly { categoryName: string }[] }): string {
  return line.agfpCategories.map((entry) => entry.categoryName).join(', ');
}

/** The drill-in is open for at most one AGFP category at a time — a second open
 *  panel would push the row being checked off screen. Clicking the open one
 *  closes it. */
export function toggleDrillIn(current: string | null, categoryId: string): string | null {
  return current === categoryId ? null : categoryId;
}

// ---------------------------------------------------------------------------
// The drill-in (Success Metric 4 — 100% traceable)
// ---------------------------------------------------------------------------

export interface EntryDay {
  day: string;
  label: string;
  entries: ReportEntry[];
}

/**
 * Entries grouped under their day, oldest first.
 *
 * The day is `report_day` — `shift.occurrence_date` for a weight and
 * `received_date` for a donation (`data-model.md §8`), decided by the server.
 * Never `created_at`: receiving legitimately lags past midnight, and bucketing on
 * the wrong column is the second of the three ways to get this phase wrong.
 */
export function groupEntriesByDay(entries: readonly ReportEntry[]): EntryDay[] {
  const days = new Map<string, ReportEntry[]>();
  for (const entry of entries) {
    const bucket = days.get(entry.day);
    if (bucket) bucket.push(entry);
    else days.set(entry.day, [entry]);
  }
  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, dayEntries]) => ({ day, label: formatDayLabel(day), entries: dayEntries }));
}

/** What the entries on screen add up to, for checking against the row above them.
 *  Exact (integer cents); null if any figure is malformed, in which case the
 *  screen shows no subtotal rather than a wrong one. */
export function entriesTotal(entries: readonly ReportEntry[]): string | null {
  return addWeights(entries.map((entry) => entry.weight));
}

/** A walk-in has no shift by construction (`domain-modeling.md §6`), so its
 *  "where from" is the donation itself rather than a route. */
export function entrySource(entry: ReportEntry): string {
  return entry.routeName ?? COPY.walkIn;
}

/** True for the entries that carry the report toggle. A `WEIGHT` never does —
 *  I15 makes scheduled intake reportable by construction, so there is no flag on
 *  it to flip. */
export function hasReportToggle(entry: ReportEntry): boolean {
  return entry.kind === 'DONATION';
}

/** The one-line description a screen reader gets for an entry row: store, day,
 *  who logged it, weight. Success Metric 4's four facts in the order S3.1 names
 *  them, joined by commas rather than em dashes (D21) — a screen reader announces
 *  a dash, and four of them in one label is noise. Composed from data, so the §7
 *  copy test sweeps it too. */
export function entryDescription(entry: ReportEntry): string {
  const parts = [
    entry.donorName,
    formatDayLabel(entry.day),
    `${COPY.loggedByPrefix} ${entry.receiverName}`,
    weightWithUnit(entry.weight),
  ];
  if (hasReportToggle(entry) && !entry.reportable) parts.push(COPY.notReported);
  return parts.join(', ');
}

/** The words on the report switch. A plain field edit, last write wins (cap 15) —
 *  not the void-and-insert an edited weight goes through. */
export function reportableChoices(): { value: 'on' | 'off'; label: string }[] {
  return [
    { value: 'on', label: COPY.reportOn },
    { value: 'off', label: COPY.reportOff },
  ];
}

/** What the toast says after a toggle. Names the consequence rather than saying
 *  "saved", because which side of the report the donation landed on is the whole
 *  point of the switch. */
export function reportableSavedText(donorName: string, reportable: boolean): string {
  return reportable
    ? `${donorName} is in the report now.`
    : `${donorName} is out of the report. It still counts in our own totals.`;
}

// ---------------------------------------------------------------------------
// Naming a food bank category on the report line
//
// The matching EDITOR moved to Admin (D17, overriding D11) and took its own copy,
// its own requests and its own row logic with it — see
// `screens/s1-rescue/s1-8-admin/mapping/`. What stays here is only what the report
// TABLE needs to name a line: the same "name (code)" rule, kept local rather than
// imported, because no screen in this repo imports another one.
// ---------------------------------------------------------------------------

/** "Produce (14)" — the code shown beside the name when Meal Connect has one.
 *  Null stays absent rather than printing "null" or a guessed code (D13). */
export function ntfbLabel(category: Pick<NtfbCategory, 'name' | 'code'>): string {
  return category.code === null || category.code === '' ? category.name : `${category.name} (${category.code})`;
}

/**
 * "Produce (14) · Refrigeration" — one report line named the way its Meal Connect
 * line item will be.
 *
 * Storage belongs in the title rather than beside it because the pair IS the line
 * item: the same food bank category under two storage requirements is two rows
 * here and two rows on the receipt, and a title that omitted storage would show
 * the Reporter two cards with identical headings.
 */
export function reportLineTitle(
  line: Pick<ReportLine, 'ntfbCategoryName' | 'ntfbCode' | 'storage'>,
): string {
  const base = ntfbLabel({ name: line.ntfbCategoryName, code: line.ntfbCode });
  return line.storage === null || line.storage === '' ? base : `${base} · ${line.storage}`;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** The server's own sentence when it sent one (its refusals are written to §7),
 *  otherwise the plain per-kind message. Never a code, never the correlation
 *  identifier (§6). */
export function messageFor(error: unknown): string {
  const apiError = toApiError(error);
  return apiError.detail ?? apiError.message;
}

/** Whether the failure means this screen is out of date — someone else revised a
 *  weight, flipped a toggle, or changed the matching from another desk. All
 *  ordinary, all fixed by a re-read rather than by asking the Reporter to do
 *  anything. */
export function shouldReloadAfter(error: unknown): boolean {
  const kind = toApiError(error).kind;
  return kind === 'conflict' || kind === 'not-found';
}

// ---------------------------------------------------------------------------
// Copy (§7: plain, short, second person; no jargon)
// ---------------------------------------------------------------------------

/** Forbidden in any UI string (`ui-ux-spec.md §7`). Pinned by a test rather than
 *  by good intentions — and the test sweeps the composed sentences above too,
 *  not only this table. */
export const FORBIDDEN_IN_COPY = [
  'pwa',
  'push subscription',
  'session',
  'payload',
  'endpoint',
  'atomic',
  'instance',
] as const;

/**
 * Every sentence on this screen, in one place.
 *
 * Three constraints beyond §7:
 *
 *   - Intake and reported are named in full every time they appear. "Total" on
 *     its own is the word that conflates them (PRD §3).
 *   - The export's column set is described as a guess, because it is one (D13).
 *     Copy that presents it as the Meal Connect format would make the one thing
 *     this repo cannot verify look verified.
 *   - Nothing offers an undo on a weight. Editing is presented as a plain
 *     overwrite (§6); the void trail underneath (I13) is the server's business
 *     and never appears here.
 */
export const COPY = {
  title: 'Weekly report',
  loading: 'Loading this week',
  unit: 'lb',

  // --- picking a week ------------------------------------------------------
  weekNavLabel: 'Move between weeks',
  previousWeek: 'Previous week',
  nextWeek: 'Next week',
  thisWeek: 'This week',
  thisWeekHeading: 'This week',
  lastWeekHeading: 'Last week',
  futureWeekHeading: 'A week that has not happened yet',
  /* D21 cut `futureWeekNote`. The week picker already says which week is on
     screen and `futureWeekHeading` already calls it one that has not happened;
     a third sentence saying the same thing is one more thing to read. */

  // --- the totals ----------------------------------------------------------
  totalsLabel: 'The week in numbers',
  reportedLabel: 'Reported to North Texas Food Bank',
  /* D21 cut `reportedNote` ("This is the figure the export file will carry").
     The label already names it, and the Export button is directly below it.
     `intakeNote` and `unreportedNote` STAY: `domain-modeling.md §6` is locked and
     requires intake and NTFB-reported to stay distinguishable, and those two
     sentences are the only place the difference between the numbers is stated. */
  unreportedLabel: 'Received but not reported',
  unreportedNote: 'Donations switched off for reporting. They still count in our own totals.',
  intakeLabel: 'Everything received',
  intakeNote: 'Reported and not-reported added together. Never the same figure as the reported one.',

  // --- the table -----------------------------------------------------------
  tableLabel: 'North Texas Food Bank categories',
  /* D21 cut `tableHint`. Every one of our categories under a line is a button
     with `aria-expanded` on it, and it opens on click; a sentence telling
     somebody to click the buttons restates the buttons. */
  rolledUpLabel: 'Our categories counted under it',
  lineTotalLabel: 'Line total',
  emptyWeekTitle: 'Nothing was received this week.',
  emptyWeekBody: 'Try another week, or check that this week’s runs have been weighed.',

  // --- the drill-in --------------------------------------------------------
  drillLoading: 'Loading the entries',
  drillLabel: 'Entries behind this weight',
  drillEmptyTitle: 'Nothing behind this number.',
  drillEmptyBody: 'No weights were logged under this category this week.',
  colStore: 'Store',
  colDay: 'Day',
  colReceiver: 'Logged by',
  colWeight: 'Weight',
  loggedByPrefix: 'logged by',
  walkIn: 'Walk-in donation',
  drillTotalLabel: 'These entries add up to',
  close: 'Close',

  // --- editing a weight ----------------------------------------------------
  edit: 'Change weight',
  editTitle: 'Change this weight',
  editHint: 'The new weight replaces the old one. Nothing else changes.',
  editPrior: 'Now',
  editKeypadLabel: 'Weight keypad',
  editNoteLabel: 'Note (optional)',
  editNoteHint: 'Why it changed, if it helps someone reading this later.',
  editSave: 'Save weight',
  editCancel: 'Cancel',
  editSaved: 'Weight changed.',
  weightRequired: 'Type a weight first.',
  weightTooLong: 'Too long. Up to six digits, and two after the point.',

  // --- the report switch ---------------------------------------------------
  reportToggleLabel: 'Report this to North Texas Food Bank',
  reportOn: 'In the report',
  reportOff: 'Not reported',
  notReported: 'not reported',

  // --- the block that stops the export -------------------------------------
  blockedTitle: 'This week cannot be exported yet',
  blockedLabel: 'What is missing',
  /** The matching moved to Admin (D17), so this stopped being a button on this
   *  screen and became a sentence about somewhere else. A Reporter with no Admin
   *  tier cannot fix the block themselves any more, and saying who can is the
   *  least this screen owes them — hiding the fact would leave them re-reading a
   *  block with nothing to act on. */
  matchingIsInAdmin:
    'An admin matches our categories to the food bank’s, under Admin, on the Category matching tab.',
  unmappedLabel: 'Carrying weight with nowhere to report it',
  oneCategory: 'category',
  manyCategories: 'categories',
  unmappedTail: 'have no food bank category yet:',

  // --- open runs (surfaced, never blocking — A184) -------------------------
  openRunsLabel: 'Runs still open this week',
  oneRun: 'run',
  manyRuns: 'runs',
  openRunsTail:
    'this week are not finished. You can still export. Anything they bring in will not be in the file.',
  runOpen: 'nobody has claimed it',
  runClaimed: 'claimed, not started',
  runInProgress: 'out on the road',
  runUnfinished: 'not finished',

  // --- the two ways out: a file, or a printed sheet ------------------------
  export: 'Export for Meal Connect',
  /** Meal Connect has no file upload. The Reporter types receipts into it by
   *  hand, so this sentence says what the file is FOR rather than implying it
   *  gets sent anywhere (D13). Shortened under D21: it was the longest string in
   *  the app and said three times over what the columns already say. */
  exportHint:
    'One row per line item, in receipt order. Check the last two columns against the totals Meal Connect shows you before you submit.',
  exportDone: 'Report downloaded.',
  /** The other way out (D16). The user asked for "PDF"; D5 forbids the
   *  dependency and D13 says the target is not a document anyway, so this is the
   *  same worksheet laid out for paper and handed to the browser's own print
   *  dialogue, where "Save as PDF" is one of the destinations. */
  print: 'Print or save as PDF',
  printing: 'Building the sheet',
  /** Prefix for the account line beside the buttons and at the top of the printed
   *  sheet. The one thing a worksheet cannot check for the Reporter is whether
   *  they are signed in to the right Meal Connect account, so the codes off the
   *  pantry's own receipts are printed where they will look before they start
   *  typing. */
  exportAccount: 'Enter these under agency',
  exportedTitle: 'Downloaded',
  exportedNote:
    'You downloaded this week’s file. Exporting again is fine. It is rebuilt from what is in R3 right now.',

  // --- the printed sheet ----------------------------------------------------
  printLabel: 'Meal Connect worksheet',
  printTitle: 'Meal Connect worksheet',
  printWeek: 'Week of',
  printEmpty: 'Nothing to enter for this week.',

} as const;
