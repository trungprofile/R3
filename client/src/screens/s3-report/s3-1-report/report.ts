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
import { EXPORT_BLOCKED_MESSAGE } from '../../../api/shared.ts';
import type {
  CategoryMapping,
  NtfbCategory,
  RemovalOutcome,
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

/** `iso` shifted by whole days. Returns `iso` untouched if it is not a date —
 *  guessing a date the server did not send would be worse than showing what
 *  arrived. */
export function addDaysIso(iso: string, days: number): string {
  const date = utcOf(iso);
  if (!date) return iso;
  date.setUTCDate(date.getUTCDate() + days);
  return isoOf(date);
}

/** Monday = 1 … Sunday = 7. */
export function isoWeekday(iso: string): number {
  const date = utcOf(iso);
  if (!date) return 0;
  return ((date.getUTCDay() + 6) % 7) + 1;
}

/** The Monday of the week `iso` falls in (A178). */
export function weekStartOf(iso: string): string {
  const weekday = isoWeekday(iso);
  if (weekday === 0) return iso;
  return addDaysIso(iso, -(weekday - 1));
}

export function previousWeek(weekStart: string): string {
  return addDaysIso(weekStart, -7);
}

export function nextWeek(weekStart: string): string {
  return addDaysIso(weekStart, 7);
}

export function isCurrentWeek(weekStart: string, today: string): boolean {
  return weekStart === weekStartOf(today);
}

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
  /** One sentence saying what this number is and is not. */
  note: string;
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
      note: COPY.reportedNote,
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

/** "Tue AM run — Tue, Jul 28, nobody has claimed it". One line of the incomplete
 *  block, composed from data and therefore swept by the §7 copy test. */
export function openRunLabel(run: WeeklyReport['openRuns'][number]): string {
  return `${run.routeName} — ${formatDayLabel(run.occurrenceDate)}, ${runStatusWord(run.status)}`;
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

/** "Enter these under agency 026357P — North Texas Food Bank (24)." Composed from
 *  data, so the §7 copy sweep covers it. */
export function mealConnectAccountNote(account: WeeklyReport['mealConnect']): string {
  return `${COPY.exportAccount} ${account.agencyCode} — ${account.foodBank} (${account.foodBankCode}).`;
}

/** Fallback name for the downloaded file, used only when the server sent no
 *  `content-disposition` to read one from. */
export function exportFilename(weekStart: string, weekEnd: string): string {
  return `agfp-ntfb-${weekStart}-to-${weekEnd}.csv`;
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
 *  who logged it, weight — Success Metric 4's four facts in the order S3.1 names
 *  them. Composed from data, so the §7 copy test sweeps it too. */
export function entryDescription(entry: ReportEntry): string {
  const parts = [
    entry.donorName,
    formatDayLabel(entry.day),
    `${COPY.loggedByPrefix} ${entry.receiverName}`,
    weightWithUnit(entry.weight),
  ];
  if (hasReportToggle(entry) && !entry.reportable) parts.push(COPY.notReported);
  return parts.join(' — ');
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
// The mapping editor (D11 — it lives here, not in Admin)
// ---------------------------------------------------------------------------

export interface MappingRow {
  categoryId: string;
  categoryName: string;
  /** The NTFB category it reports under, or null while unmatched. */
  ntfbCategoryId: string | null;
  ntfbCategoryName: string | null;
  /** The Storage value that goes beside the category on a Meal Connect line item
   *  — `Frozen`, `Dry`, `Refrigeration` on the receipt we have. Null is a gap
   *  worth naming but not a blocker: the weight still lands in the right
   *  category, and only one of the form's four fields is left blank. */
  storage: string | null;
  /** The AGFP category itself is archived (§3.3). Still shown: archived
   *  categories keep resolving in history and reports. */
  archived: boolean;
  /** Non-null when this category carries weight in the week on screen with
   *  nowhere to report it — the row that is blocking the export. */
  blockingWeight: string | null;
}

/**
 * The matching list, ordered so the Reporter's problem is at the top.
 *
 * A Reporter arrives here from the blocked export, so the categories actually
 * holding the week up come first, then the rest of the unmatched ones, then the
 * matched. Sorting alphabetically instead would bury the two rows they came to
 * fix somewhere in the middle of eleven.
 */
export function mappingRows(
  mappings: readonly CategoryMapping[],
  unmapped: readonly UnmappedCategory[],
): MappingRow[] {
  const blocking = new Map(unmapped.map((row) => [row.categoryId, row.total]));

  const rows: MappingRow[] = mappings.map((mapping) => ({
    categoryId: mapping.categoryId,
    categoryName: mapping.categoryName,
    ntfbCategoryId: mapping.ntfbCategoryId,
    ntfbCategoryName: mapping.ntfbCategoryName,
    storage: mapping.storage,
    archived: !mapping.categoryActive,
    blockingWeight: blocking.get(mapping.categoryId) ?? null,
  }));

  const rank = (row: MappingRow): number => {
    if (row.blockingWeight !== null) return 0;
    if (row.ntfbCategoryId === null) return 1;
    return 2;
  };

  return rows.sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    return a.categoryName.localeCompare(b.categoryName);
  });
}

/**
 * What a matching row says on its right-hand side.
 *
 * Category and storage together, because together they are one Meal Connect line
 * item — "Produce · Refrigeration" is what the Reporter will actually type, and
 * showing only half of it hides half the mapping.
 */
export function mappingTargetLabel(row: MappingRow): string {
  if (row.ntfbCategoryName === null) return COPY.notMatched;
  if (row.storage === null || row.storage === '') return row.ntfbCategoryName;
  return `${row.ntfbCategoryName} · ${row.storage}`;
}

/** Named on the row rather than left to be discovered at the far end: a mapped
 *  category with no storage still exports, but leaves the Reporter guessing at
 *  one of the four fields the form asks for. */
export function storageGapNote(row: MappingRow): string | null {
  if (row.ntfbCategoryId === null) return null;
  return row.storage === null || row.storage === '' ? COPY.storageMissing : null;
}

/** The picker's options: the food bank categories still in use, by name, plus the
 *  explicit "leave it unmatched". Archived ones are left out — pointing a live
 *  category at an archived bucket would build the next unmapped block by hand. */
export function pickerOptions(
  categories: readonly NtfbCategory[],
): { id: string | null; label: string }[] {
  const active = categories
    .filter((category) => category.active)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((category) => ({ id: category.id as string | null, label: ntfbLabel(category) }));
  return [...active, { id: null, label: COPY.leaveUnmatched }];
}

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

/** How many AGFP categories report under one food bank category — the I21
 *  delete/archive hint, said as a sentence rather than a bare count. */
export function mappedCountLabel(category: NtfbCategory): string {
  if (category.mappedCount === 0) return COPY.nothingMapped;
  if (category.mappedCount === 1) return COPY.oneMapped;
  return `${category.mappedCount} ${COPY.manyMapped}`;
}

/** In-use categories first, archived ones after, each alphabetical. Archived stay
 *  visible so one archived by mistake can be put back (§3.3's reverse arrow). */
export function sortNtfbCategories(categories: readonly NtfbCategory[]): NtfbCategory[] {
  return categories.slice().sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/** Required, and nothing else. A duplicate-name rule is not written down
 *  anywhere, and inventing one here would refuse a name the server accepts. */
export function ntfbNameError(raw: string, attempted: boolean): string | null {
  if (!attempted) return null;
  return raw.trim() === '' ? COPY.ntfbNameRequired : null;
}

/** An empty optional field is *absent*, not `""` — `ntfb_category.code` and
 *  `category.ntfb_storage` are both nullable exactly so an unknown stays unknown
 *  rather than becoming an empty string that reads as an answer (D13). */
export function normalizeOptional(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/** I21's answer, reported rather than predicted: the domain decides whether a
 *  removal archived or destroyed, and this says which happened. */
export function ntfbRemovalText(name: string, outcome: RemovalOutcome): string {
  return outcome === 'DELETED'
    ? `${name} is gone. Nothing reported under it.`
    : `${name} is archived. Past reports still resolve it.`;
}

/** What the toast says once a category is pointed somewhere (or nowhere). */
export function mappingSavedText(categoryName: string, ntfbName: string | null): string {
  return ntfbName === null
    ? `${categoryName} is not matched to anything. It will hold up the export while it carries weight.`
    : `${categoryName} reports under ${ntfbName}.`;
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
  futureWeekNote: 'This week is still ahead. Anything here will fill in as runs are weighed.',

  // --- the two panels ------------------------------------------------------
  tabsLabel: 'Report or category matching',
  tabReport: 'Report',
  tabMapping: 'Category matching',

  // --- the totals ----------------------------------------------------------
  totalsLabel: 'The week in numbers',
  reportedLabel: 'Reported to North Texas Food Bank',
  reportedNote: 'This is the figure the export file will carry.',
  unreportedLabel: 'Received but not reported',
  unreportedNote: 'Donations switched off for reporting. They still count in our own totals.',
  intakeLabel: 'Everything received',
  intakeNote: 'Reported and not-reported added together. Never the same figure as the reported one.',

  // --- the table -----------------------------------------------------------
  tableLabel: 'North Texas Food Bank categories',
  tableHint: 'Pick one of our categories to see every entry behind its weight.',
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
  goToMatching: 'Match the categories',
  unmappedLabel: 'Carrying weight with nowhere to report it',
  oneCategory: 'category',
  manyCategories: 'categories',
  unmappedTail: 'have no food bank category yet:',

  // --- open runs (surfaced, never blocking — A184) -------------------------
  openRunsLabel: 'Runs still open this week',
  oneRun: 'run',
  manyRuns: 'runs',
  openRunsTail:
    'this week are not finished. You can still export — anything they bring in will not be in the file.',
  runOpen: 'nobody has claimed it',
  runClaimed: 'claimed, not started',
  runInProgress: 'out on the road',
  runUnfinished: 'not finished',

  // --- the one primary action ----------------------------------------------
  export: 'Export for Meal Connect',
  /** Meal Connect has no file upload — the Reporter types receipts into it by
   *  hand — so this sentence says what the file is FOR rather than implying it
   *  gets sent anywhere (D13). One row per line item, in the order the receipts
   *  are entered. */
  exportHint:
    'Downloads a spreadsheet laid out the way Meal Connect asks for it: one row per line item, grouped by pickup date and store. Work down it as you enter each receipt, and check the last two columns against the totals Meal Connect shows you before you submit.',
  exportDone: 'Report downloaded.',
  /** Prefix for the account line above Export. The one thing a worksheet cannot
   *  check for the Reporter is whether they are signed in to the right Meal
   *  Connect account, so the codes off the pantry's own receipts are printed
   *  where they will look before they start typing. */
  exportAccount: 'Enter these under agency',
  exportedTitle: 'Downloaded',
  exportedNote:
    'You downloaded this week’s file. Exporting again is fine — it is rebuilt from what is in R3 right now.',

  // --- the matching editor -------------------------------------------------
  mappingHeading: 'Which food bank category does each of ours report under?',
  mappingIntro:
    'Our categories are on the left. Point each one at the North Texas Food Bank category it belongs to, and say which storage it goes under. Two of ours can share one of theirs — under different storage if that is what they are.',
  mappingLabel: 'Our categories',
  mappingEmptyTitle: 'No categories of our own yet.',
  mappingEmptyBody: 'An admin adds ours under Admin → Categories. Nothing can be reported until they do.',
  notMatched: 'Not matched yet',
  archivedCategory: 'Archived',
  blockingTail: 'this week, with nowhere to report it',
  pickerLabel: 'Report this under',
  pickerCurrent: 'Chosen now',
  pickerHint: 'Pick one, or leave it unmatched.',
  leaveUnmatched: 'Leave it unmatched',
  back: 'Back',
  /** Storage is the other half of a Meal Connect line item, so it is chosen in the
   *  same breath as the category rather than on a screen of its own. Free text and
   *  three examples, not a fixed list: those three are what one receipt showed, and
   *  the pantry's form is the authority on the rest (migration 0013). */
  storageField: 'Storage (optional)',
  storageHint:
    'The Storage the food bank’s form asks for beside the category — usually Frozen, Dry or Refrigeration. Copy their wording.',
  storageMissing: 'No storage set',
  /** A181, said out loud where the remapping happens. Every week is computed on
   *  read, so a mapping changed today changes what an already-exported week
   *  *would* say if exported again. That is correct — a mapping states what a
   *  category is, not what it was — but it is not obvious, and the Reporter is
   *  the person it surprises. */
  remapNotice:
    'Matching applies to every week, not just this one. A week you already exported would come out differently if you exported it again.',

  ntfbHeading: 'North Texas Food Bank categories',
  ntfbIntro:
    'These are the food bank’s own names, so R3 ships without them — nobody here can invent them without getting the report wrong. Add the ones on your submission form.',
  ntfbLabel: 'Food bank categories',
  ntfbEmptyTitle: 'No food bank categories yet.',
  ntfbEmptyBody:
    'Add the categories from your North Texas Food Bank submission form. Nothing can be reported until at least one is here.',
  ntfbLoading: 'Loading the categories',
  addNtfb: 'Add a category',
  createNtfbTitle: 'Add a food bank category',
  editNtfbTitle: 'Edit food bank category',
  ntfbNameField: 'Category name',
  ntfbNameHint: 'Exactly as the food bank writes it.',
  ntfbCodeField: 'Code (optional)',
  ntfbCodeHint: 'Only if your submission form uses a code. Leave it empty if you are not sure.',
  ntfbNameRequired: 'Type the category name.',
  saveNtfb: 'Save',
  createNtfb: 'Add category',
  removeNtfb: 'Remove',
  removeQuestion: 'Remove this category?',
  removeConsequence:
    'If any of our categories still report under it, it is archived instead. Past reports keep working either way.',
  /** Archiving happens through Remove, where I21 decides; only the way back is a
   *  plain field edit (`shared/src/report.ts`, `UpdateNtfbCategoryRequest`). */
  reactivate: 'Put back in use',
  reactivated: 'Back in use.',
  ntfbSaved: 'Saved.',
  nothingMapped: 'Nothing reports under this yet',
  oneMapped: 'One of our categories reports under this',
  manyMapped: 'of our categories report under this',
} as const;
