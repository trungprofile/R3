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
//      always emits BOTH with their own words. D34 cut the third figure and every
//      caption; the labels carry the distinction now, which is why they name it in
//      full rather than shortening to "Total".
//   3. Unmapped weight is surfaced, never dropped (D12). A short report is
//      invisible at the far end, which is the "lost-sheet misreporting" failure
//      Success Metric 4 exists to kill.
//   4. Nothing here decides whether a receipt has been filed into Meal Connect
//      (D35). That is stored (migration 0018) because two reporters ask it about
//      the same range; these functions only say what the server's answer means.

import { toApiError } from '../../../api/index.ts';
import {
  isCurrentWeek,
  isoWeekday,
  previousWeek,
  weekEndOf,
  weekStartOf,
} from '../../../app/week.ts';
import { EXPORT_BLOCKED_MESSAGE } from '../../../api/shared.ts';
import type {
  Receipt,
  ReceiptLine,
  ReceiptNote,
  ReceiptNoteRole,
  ReportEntry,
  ReportExport,
  UnmappedCategory,
  UnreportedDonation,
  WeeklyReport,
} from '../../../api/shared.ts';

// ---------------------------------------------------------------------------
// The window: a From/To range, defaulting to this week (D41, A178)
//
// D41 replaced the week picker with two date fields. The DEFAULT did not change
// and is the load-bearing half: the Monday-to-Sunday week containing the pantry's
// today (A178), which is the same boundary `weekBounds()` cuts on the server,
// S1.2's board defaults to, and — since D39 — Admin metrics defaults to. All four
// read `app/week.ts` or its server mirror, so no two screens can disagree about
// what "this week" means.
//
// The reporter who asked for this was catching up on a fortnight. A range is
// simply more receipts: a receipt is keyed `(pickup date, donor)`, D28 rounds at
// the receipt line and D27 deducts per receipt, so nothing about the arithmetic
// notices the window's length.
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

// ---------------------------------------------------------------------------
// The range (D41)
// ---------------------------------------------------------------------------

export interface DateRange {
  /** `YYYY-MM-DD`, inclusive. */
  from: string;
  to: string;
}

/** What the screen opens on with nothing chosen: this week, Monday to Sunday
 *  (A178). The same answer the server gives an empty query, so the first paint
 *  and the first response agree rather than agreeing by luck. */
export function defaultRange(today: string): DateRange {
  const from = weekStartOf(today);
  return { from, to: weekEndOf(from) };
}

/** Whether the range is one the server will take. Communication only — the server
 *  refuses a backwards range itself, and this exists so a Reporter sees the typo
 *  in the field they made it in rather than in a toast. */
export function rangeError(range: DateRange): string | null {
  if (!ISO_DATE.test(range.from) || !ISO_DATE.test(range.to)) return COPY.rangeIncomplete;
  return range.from > range.to ? COPY.rangeBackwards : null;
}

export function isValidRange(range: DateRange): boolean {
  return rangeError(range) === null;
}

/** True when the range IS the current Monday-to-Sunday week, which is what lets
 *  the screen offer "This week" only when it would change something. */
export function isThisWeek(range: DateRange, today: string): boolean {
  const current = defaultRange(today);
  return range.from === current.from && range.to === current.to;
}

/**
 * The range said plainly, and named where it has a name.
 *
 * "This week" when it is one, otherwise the two dates. §1.4 is recognition over
 * recall: a Reporter should read where they are rather than compare two dates
 * against today's — and now that any two dates are reachable, most ranges have no
 * name and the dates are the whole answer.
 */
export function rangeHeading(range: DateRange, today: string): string {
  if (isThisWeek(range, today)) return COPY.thisWeekHeading;
  const lastWeek = previousWeek(weekStartOf(today));
  if (range.from === lastWeek && range.to === weekEndOf(lastWeek)) return COPY.lastWeekHeading;
  if (isFutureWeek(range.from, today)) return COPY.futureWeekHeading;
  return formatDateRange(range.from, range.to);
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
 * The range said plainly: "Mon, Jul 27 – Sun, Aug 2, 2026".
 *
 * The weekday is spelled out at both ends on purpose. A178 chose Monday-to-Sunday
 * with no doc to lean on, so a range that IS a week has to say which boundary it
 * used rather than leave a Reporter to work it out from two numbers. Since D41 a
 * range need not be a week at all, which is why this stopped being called
 * `formatWeekRange`: it was named for the only window that used to exist.
 */
export function formatDateRange(from: string, to: string): string {
  const start = utcOf(from);
  const end = utcOf(to);
  if (!start || !end) return `${from} – ${to}`;

  const startLabel = formatDayLabel(from);
  const endLabel = formatDayLabel(to);
  const startYear = start.getUTCFullYear();
  const endYear = end.getUTCFullYear();

  if (startYear === endYear) return `${startLabel} – ${endLabel}, ${endYear}`;
  return `${startLabel}, ${startYear} – ${endLabel}, ${endYear}`;
}

// `weekLabel(weekStart, today)` was here, answering "This week" / "Last week" /
// null for a window that could only ever be a week. D41 made the window a RANGE and
// `rangeHeading` is the same question asked of two dates — it returns the same three
// phrases and falls back to the dates themselves rather than to null, because a
// fortnight has no name and the dates are the whole answer. One function, not two
// that agree until one of them is edited.

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
// The totals landing is GONE (D54)
//
// `totalsView` stood here, and above it a per-NTFB-category table with a drill-in
// hanging off every AGFP line. That was the screen S3.1 opened on, and it is why
// the reporter never found the one thing PRD cap 15 lets them do: after the
// receiver's edit window closes, correcting a weight is theirs alone, and the pencil
// that does it sat two clicks inside a page they read as analysis rather than as
// their job. They reported a built feature as missing.
//
// So the receipts ARE the screen now, and the two corrections moved onto the receipt
// the reporter is already typing into. What went with the landing: `totalsView` and
// its two figures, `ReportTable`, `DrillIn`, `toggleDrillIn`, the per-category
// `drillTotals`/`subtractWeights` arithmetic, and the button that opened the
// receipts.
//
// D34 CUT THE THIRD FIGURE AND THIS CUTS THE OTHER TWO, on the same argument taken
// one step further: intake and NTFB-reported are two clearly labelled numbers on
// Admin metrics, which is the screen for reading numbers. This one is for typing
// them. PRD §3's rule is that the two are never conflated wherever they appear, not
// that they appear here — and `COPY.wholePoundsNote` still explains why this screen
// and metrics can differ by a pound (D28), on the PRINTED receipt since D69, which is
// where a reporter has both numbers in front of them.
//
// The per-receipt trash arithmetic did not need explaining either, which is why
// `drillTotals` went rather than moving. The drill-in showed ONE category, so the
// deduction made its entries and its line disagree with nothing to say why; a
// RECEIPT carries its own Trash line, so what was weighed and what is reported add
// up on the same card.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// The receipt view (D29)
//
// D13 built a rectangular worksheet and a CSV beside it. A submitted receipt and
// screenshots of Meal Connect's three entry screens settled that the far end is a
// FORM, so the export is now a printable mimic of that form — one card per
// `(pickup date, donor)`, read top to bottom while typing — and the CSV is gone
// with its column list. One path cannot disagree with itself.
//
// The card has two halves and they are not the same kind of thing:
//
//   THE PORTAL'S HALF   Pickup Date, Donor, the two checkboxes, the line items as
//                       `Category · Storage · Pounds`, then Number of Items and
//                       Total Pounds. Typed in, field for field.
//   OURS                the AGFP category behind each line, and every note. Marked
//                       as not typed into the portal, because it is a reading aid
//                       for reconciling against the paper log — without it two
//                       identical `Prepared Meal / Frozen` rows are unreadable now
//                       that Description is gone.
//
// Nothing here rebuilds a receipt. The server computes them over the same union it
// refuses a short export on (A186, D12); these functions only say what each field
// is called and read it out.
// ---------------------------------------------------------------------------

/** `2026-03-20` → `03/20/2026`, the way Meal Connect's own Pickup Date reads.
 *  Deliberately NOT the app's `Mar 20`: this line is copied into a field. */
export function formatReceiptDate(iso: string): string {
  if (!ISO_DATE.test(iso)) return iso;
  const [year = '', month = '', day = ''] = iso.split('-');
  return `${month}/${day}/${year}`;
}

/** `H-E-B Food Stores (810)` — name then NTFB's own number, exactly as its donor
 *  picker shows it. No code for a store nobody has recorded one for, and never a
 *  guessed one (D13). */
export function receiptDonorLabel(receipt: Pick<Receipt, 'donorName' | 'donorCode'>): string {
  const code = receipt.donorCode;
  return code === null || code === '' ? receipt.donorName : `${receipt.donorName} (${code})`;
}

/** The glyphs on the two checkboxes. Marks, not prose, so D21's em-dash rule and
 *  the §7 sweep do not reach them; the state is also said in words for anyone who
 *  hears the card rather than sees it. */
export const TICKED = '☑';
export const UNTICKED = '☐';

/** A checkbox said out loud: "Ticked, No Pounds". §3 — never colour or a glyph
 *  alone. */
export function checkboxDescription(ticked: boolean, label: string): string {
  return `${ticked ? COPY.ticked : COPY.notTicked}, ${label}`;
}

/** `Prepared Meal, Frozen, 45 lb` — one line named the way the reading aid below
 *  the card has to name it, since the pair alone cannot tell two `Prepared Meal /
 *  Frozen` rows apart and the pounds can. */
export function receiptLineLabel(line: ReceiptLine): string {
  const storage = line.storage === '' ? COPY.noStorage : line.storage;
  return `${line.ntfbCategory}, ${storage}, ${weightWithUnit(line.pounds)}`;
}

/**
 * What OUR half of the card says about one line: the AGFP category it came from,
 * or, on the Trash line, where it came from instead.
 *
 * The Trash line is the one row on the receipt with no sheet behind it (D27) — a
 * per-store share of bakery, produce and deli weight, computed rather than weighed
 * — so saying only "no category" would send a Reporter looking for a paper log
 * that does not exist.
 */
export function receiptLineSource(line: ReceiptLine): string {
  if (line.computed) return COPY.computedLine;
  return line.agfpCategory === '' ? COPY.noAgfpCategory : line.agfpCategory;
}

/**
 * Why a receipt has no line items, or null when it has some.
 *
 * A not-attempted receipt is EMPTY ON PURPOSE and is the reason `Receipt` exists:
 * a skipped stop and a run nobody worked used to produce no export row at all, so
 * those pickups were invisible to the food bank. An empty table with nothing said
 * over it reads as a load that failed, which is the one impression this card must
 * not give.
 */
export function receiptEmptyText(receipt: Receipt): string | null {
  if (receipt.lines.length > 0) return null;
  if (receipt.notAttempted) return COPY.notAttemptedBody;
  if (receipt.noPounds) return COPY.noPoundsBody;
  return COPY.noLinesBody;
}

/**
 * A note's channel in a volunteer's words (`shared/src/report.ts`,
 * `ReceiptNoteRole`).
 *
 * The role names the CHANNEL, not the writer's tier — two of these are the same
 * person, and the writer is `author`. `STOP` is kept apart from `DRIVER` because
 * "the back gate was locked" belongs to a store and "the truck broke down" belongs
 * to a run.
 */
export function noteRoleLabel(role: ReceiptNoteRole): string {
  switch (role) {
    case 'COORDINATOR':
      return COPY.roleCoordinator;
    case 'DRIVER':
      return COPY.roleDriver;
    case 'STOP':
      return COPY.roleStop;
    case 'RECEIVER':
      return COPY.roleReceiver;
    case 'DONATION':
      return COPY.roleDonation;
  }
}

/** "Driver (Karen)" — the channel, and who wrote it where anyone did. A
 *  coordinator note stores no author and inventing one from whoever last touched
 *  the shift would name the wrong person. */
export function noteAuthorLabel(note: ReceiptNote): string {
  const role = noteRoleLabel(note.role);
  return note.author === null || note.author === '' ? role : `${role} (${note.author})`;
}

/** A stable identity for a card. `(pickup date, donor)` IS the receipt's key — the
 *  server groups on exactly that pair — and the index guards the walk-in labels,
 *  which are free text and have no donor row to be unique by. */
export function receiptKey(receipt: Receipt, index: number): string {
  return `${receipt.pickupDate}:${receipt.donorName}:${index}`;
}

// ---------------------------------------------------------------------------
// The check-off: which receipts are already in Meal Connect (D35)
//
// THE PROBLEM. The portal takes one submission at a time and has no import (D13),
// so a fifteen-store range is fifteen separate typing sessions. Halfway through
// one, the only question that matters is which stores are already filed — and it
// is a question a SECOND reporter asks about the same range. So the answer is
// stored (migration 0018) rather than held on this screen, and everything below
// only says what the server's answer means.
//
// Nothing here decides whether a receipt is submitted, and nothing here writes.
// ---------------------------------------------------------------------------

/** Whether this receipt can be ticked at all.
 *
 *  False for a free-text walk-in label, which has no `donor` row for the check-off
 *  to key on — the same store Meal Connect's own picker cannot be pointed at
 *  either. The screen says so rather than offering a control that would fail. */
export function canMarkSubmitted(receipt: Receipt): boolean {
  return receipt.donorId !== null;
}

/**
 * When a receipt was filed, in the PANTRY's zone.
 *
 * A submission is an instant, and the pantry's day is what a reporter means by
 * "yesterday" — a desktop in another zone must not shift it (A120). Left
 * undefined the machine's own zone is used, which is only correct for the moment
 * before the pantry's zone has arrived, since there is nothing better to fall
 * back on.
 */
export function formatSubmittedAt(iso: string, timeZone?: string | undefined): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  }).format(parsed);
}

/**
 * What a receipt's row says about its own state: who filed it and when, or that
 * nobody has, or that it cannot be.
 *
 * Named rather than left to a tick alone (§3: never a visual signal by itself),
 * and the NAME is the load-bearing half — "submitted" tells a second reporter the
 * work is done, and "submitted by Karen at 4:12pm" tells them who to ask when the
 * portal disagrees.
 */
export function submittedLabel(
  receipt: Receipt,
  timeZone?: string | undefined,
): string {
  if (receipt.submitted !== null) {
    return `${COPY.submittedBy} ${receipt.submitted.submittedBy}, ${formatSubmittedAt(receipt.submitted.submittedAt, timeZone)}`;
  }
  return canMarkSubmitted(receipt) ? COPY.notSubmitted : COPY.cannotSubmit;
}

/** One line of the compact list: the store, the day, the pounds. Everything a
 *  reporter needs to find the card they are looking for, and nothing they would
 *  have to open the card to read. */
export function receiptRowTitle(receipt: Receipt): string {
  return `${formatReceiptDate(receipt.pickupDate)} · ${receiptDonorLabel(receipt)}`;
}

/** The whole row said in one sentence, for anyone hearing the list rather than
 *  seeing it. Composed from data, so the §7 copy sweep reaches it. */
export function receiptRowDescription(
  receipt: Receipt,
  timeZone?: string | undefined,
): string {
  return `${receiptRowTitle(receipt)}, ${weightWithUnit(receipt.totalPounds)}, ${submittedLabel(receipt, timeZone)}`;
}

/**
 * How far through the range a reporter is, OVER THE FILEABLE RECEIPTS ONLY (D56).
 *
 * It used to count every receipt, which made "9 of 11" unreachable on a range with
 * two walk-in labels in it: a receipt with no store cannot be ticked (`D35`) and
 * cannot be filed, so counting it in the denominator promises work that has no
 * control to do it with. The second section now holds those, and this counts what
 * section one holds.
 */
export function submittedProgressCounts(sheet: ReportExport): { done: number; total: number } {
  const fileable = fileableReceipts(sheet);
  return {
    done: fileable.filter((r) => r.submitted !== null).length,
    total: fileable.length,
  };
}

/** The progress said as a sentence. The bar beside it is the same fact drawn, and
 *  the sentence is the one that survives being read aloud — §3 does not allow a
 *  visual signal to carry a state on its own, and a bar with no number is not a
 *  status. */
export function submittedProgress(sheet: ReportExport): string {
  const { done, total } = submittedProgressCounts(sheet);
  if (total === 0) return COPY.receiptsEmpty;
  if (done === 0) return `${COPY.progressNoneTail} ${total}.`;
  return `${done} ${COPY.progressOf} ${total} ${COPY.progressTail}`;
}

/** 0–100, for the width of the bar and for nothing else. Rounded, because a bar is
 *  geometry; the sentence beside it carries the exact count. */
export function submittedPercent(sheet: ReportExport): number {
  const { done, total } = submittedProgressCounts(sheet);
  if (total <= 0) return 0;
  return Math.round((done / total) * 100);
}

// ---------------------------------------------------------------------------
// Two sections (D56)
//
// SECTION 1, "To file into Meal Connect": every receipt with a store. This is the
// work, and the progress bar counts exactly this.
//
// SECTION 2, "Not filed to the food bank": two different things that share one
// property — nothing here will ever be typed into the portal.
//
//   1. Receipts with no store. A free-text walk-in label has no `donor` row, so
//      Meal Connect's own picker cannot be pointed at it either (`D35`). Unchanged
//      behaviour; what changed is that they are no longer mixed in with the work.
//   2. Confirmed donations with the switch OFF. These are not in the report union
//      at all (`domain-modeling.md §6`), so they have no receipt and there was
//      nothing on this screen to flip. They arrive on the payload as their own
//      list (`D56`) and flipping one on moves it into section 1 on the next read.
// ---------------------------------------------------------------------------

/** Section 1 — the receipts that can be filed, which is every receipt with a store. */
export function fileableReceipts(sheet: ReportExport): Receipt[] {
  return sheet.receipts.filter((receipt) => canMarkSubmitted(receipt));
}

/**
 * Whether this receipt can be pointed at a real store (D72).
 *
 * True only for a card with NO store and at least one walk-in behind it — the
 * label-only case. The server sends the ids (`labelDonationIds`) rather than the
 * screen inferring them from a name, because the name is free text and two receivers
 * can spell one store two ways.
 *
 * A receipt built only from a scheduled stop always has a store, so it never reaches
 * this; an anonymous walk-in never forms a receipt at all (`I16(b)` keeps it out of
 * the reported union), and the row that carries it says why on its own line in
 * section 2.
 */
export function canAttachDonor(receipt: Receipt): boolean {
  return receipt.donorId === null && receipt.labelDonationIds.length > 0;
}

/** Section 2's first half — the receipts that cannot be filed at all. */
export function unfileableReceipts(sheet: ReportExport): Receipt[] {
  return sheet.receipts.filter((receipt) => !canMarkSubmitted(receipt));
}

/** Whether section 2 has anything in it. Both halves, because an empty heading over
 *  nothing is worse than no heading. */
export function hasUnfiled(sheet: ReportExport): boolean {
  return unfileableReceipts(sheet).length > 0 || sheet.notReported.length > 0;
}

/** One not-reported donation, titled the way a receipt row is: the day, then the
 *  store. Same shape so the two kinds of row in section 2 read as one list. */
export function unreportedRowTitle(row: UnreportedDonation): string {
  return `${formatReceiptDate(row.receivedDate)} · ${row.donorName}`;
}

/**
 * What the row says about itself, and it is the whole point of section 2.
 *
 * An ANONYMOUS walk-in — no donor and no label — cannot be turned on: `I16(b)` says
 * `CONFIRMED ∧ reportable=true ⇒ source non-null`, and `setReportable` refuses it.
 * The server answers that question on the payload (`canReport`), so the row SAYS SO
 * rather than offering a switch that fails, which is the same courtesy `D35` gives
 * a receipt with no store to file it under.
 */
export function unreportedRowDescription(row: UnreportedDonation): string {
  const parts = [
    unreportedRowTitle(row),
    row.categoryName,
    weightWithUnit(row.weight),
    `${COPY.loggedByPrefix} ${row.receiverName}`,
    row.canReport ? COPY.notReportedState : COPY.cannotReportState,
  ];
  return parts.join(', ');
}

/** The confirm a tick asks for BEFORE it writes. `ConfirmModal` requires a
 *  consequence (§3) and this is a real one: a tick tells the next reporter not to
 *  file this store, so a wrong one is a receipt the food bank never gets. It is
 *  undoable, and saying so is what keeps the confirm from reading as a warning. */
export function markSubmittedQuestion(receipt: Receipt): string {
  return `${COPY.markQuestion} ${receiptRowTitle(receipt)}?`;
}

/** A range with nothing on it AT ALL — no receipts and nothing held back (D56).
 *  Not an error: an empty range is a true answer, and it gets a sentence rather
 *  than a card with nothing in it (§6). A range with only unreported donations in
 *  it is NOT empty, because there is something for the reporter to decide. */
export function isEmptyExport(sheet: ReportExport): boolean {
  return sheet.receipts.length === 0 && sheet.notReported.length === 0;
}

/**
 * The class the body carries WHILE the receipts are on screen, and only then.
 *
 * The print stylesheet hides the whole page and promotes the receipts, which is
 * the only way to print one section without this file knowing the shell's class
 * names. Left unscoped, that rule outlives the screen: `report.css` is loaded
 * once and never unloaded, so after one visit to the report every OTHER screen
 * printed blank. QA round 2 found exactly that. Every print rule now sits behind
 * this class, which `ReportScreen` adds on mount and removes on unmount, so a
 * page with no receipts on it cannot be hidden by them.
 */
export const PRINT_BODY_CLASS = 's31-print-mode';

// ---------------------------------------------------------------------------
// The corrections, now on the receipt (D54, D55 — Success Metric 4)
//
// PRD cap 15 gives the REPORT duty the only remaining way to correct a weight once
// the receiver's edit window has closed, and neither correction is window-gated
// (D14). What changed is WHERE they render, not what they do: they used to hang off
// a per-category drill-in on a totals page, and they now sit on the receipt the
// reporter has open in front of the portal.
//
//   - A WEIGHT is immutable and corrects by void-old + insert-new (I13). To the
//     reporter it is a plain overwrite: the prior value is shown so they see what
//     they are replacing, and there is no undo and no history UI. The void trail is
//     the server's business and never appears here (§6, PRD).
//   - A DONATION'S REPORT SWITCH is a plain field edit, last write wins (cap 15).
//     Only a DONATION carries one — I15 makes scheduled intake reportable by
//     construction, so a WEIGHT has no flag to flip.
//
// `groupEntriesByDay` went with the drill-in: a receipt IS one day, so grouping the
// entries under it by day would put every row under one heading.
// ---------------------------------------------------------------------------

/** A receipt's identity, as the SERVER keys it: `(pickup date, donor)`, falling back
 *  to the free-text label when there is no donor row (`services/report.ts`,
 *  `receiptKey`). Written twice on purpose — the client cannot import the server —
 *  and it has to agree, or a correction is offered under the wrong card. */
const KEY_SEP = '\u0000';

export function receiptKeyOf(
  row: { donorId: string | null; donorName: string },
  day: string,
): string {
  return [day, row.donorId ?? `label${KEY_SEP}${row.donorName}`].join(KEY_SEP);
}

/**
 * The entries behind ONE receipt, in the order its line items read.
 *
 * The range's entries arrive once and are sifted here rather than fetched per
 * receipt: a fortnight is a few hundred rows, and a request per card would put a
 * spinner between a reporter and the number they came to fix.
 *
 * A donation with the switch OFF still appears under its receipt when the store has
 * other intake that day. That is deliberate: it is the row cap 15 lets them turn
 * back on, and it is marked (`entryDescription`) rather than hidden. It is not on
 * the card's line items, because it is not in the report union (§6).
 */
export function entriesForReceipt(
  entries: readonly ReportEntry[],
  receipt: Pick<Receipt, 'donorId' | 'donorName' | 'pickupDate'>,
): ReportEntry[] {
  const key = receiptKeyOf(receipt, receipt.pickupDate);
  return entries
    .filter((entry) => receiptKeyOf(entry, entry.day) === key)
    .sort(
      (a, b) =>
        a.categoryName.localeCompare(b.categoryName) ||
        a.donorName.localeCompare(b.donorName),
    );
}

/** What the entries on screen add up to, for checking against the card above them.
 *  Exact (integer cents); null if any figure is malformed, in which case the screen
 *  shows no subtotal rather than a wrong one. */
export function entriesTotal(entries: readonly ReportEntry[]): string | null {
  return addWeights(entries.map((entry) => entry.weight));
}

/** What the card's line items were built from: the reportable half only. A donation
 *  with the switch off is listed and marked, but it never reached a line above, so
 *  counting it here would make the two disagree by exactly the thing the reporter is
 *  being shown. */
export function correctionsTotal(entries: readonly ReportEntry[]): string | null {
  return addWeights(entries.filter((entry) => entry.reportable).map((entry) => entry.weight));
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

/**
 * True for the entries that carry the ✎, and it is NOT every entry.
 *
 * `PUT /report/weights/:id` is `reviseReportedWeight`, which voids and re-inserts a
 * `weight_entry` row (I13). A DONATION's id is an `unscheduled_donation` id, so the
 * lookup finds nothing and the save comes back "No such entry." The drill-in offered
 * the button on every row and that call could only ever fail — a defect the move onto
 * the receipt surfaced rather than introduced.
 *
 * A walk-in's correction path is the report switch beside it (cap 15) and, for the
 * weight itself, S2.3 while the receiver's window is open.
 */
export function hasWeightEdit(entry: ReportEntry): boolean {
  return entry.kind === 'WEIGHT';
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
// `ntfbLabel` and `reportLineTitle` went with the report table (D54)
//
// They named a food bank line the way its Meal Connect line item would read, for a
// per-category table that no longer exists. The receipt names its own lines
// (`receiptLineLabel`), which is the same naming done where a reporter is typing it
// rather than where they were reading it. The matching EDITOR has its own copy in
// `screens/s1-rescue/s1-8-admin/mapping/` (D17, then D40) and always did — no screen
// in this repo imports another one.
// ---------------------------------------------------------------------------

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
  title: 'Report',
  loading: 'Loading the report',
  unit: 'lb',

  // --- picking the range (D41) ---------------------------------------------
  rangeLabel: 'Which dates',
  fromLabel: 'From',
  toLabel: 'To',
  dateHint: 'Year, month, day.',
  thisWeek: 'This week',
  thisWeekHeading: 'This week',
  lastWeekHeading: 'Last week',
  futureWeekHeading: 'A week that has not happened yet',
  rangeIncomplete: 'Fill in both dates.',
  rangeBackwards: 'The first date has to be on or before the second.',
  /* D21 cut `futureWeekNote`. The range picker already says which dates are on
     screen and `futureWeekHeading` already calls it one that has not happened;
     a third sentence saying the same thing is one more thing to read. */

  /* THE FIGURES AND THE TABLE ARE GONE (D54). D21 cut the captions, D34 cut the
     third figure, and this cuts the landing they sat on: `totalsLabel`,
     `intakeLabel`, `reportedLabel`, `tableLabel`, `rolledUpLabel`, `lineTotalLabel`,
     `emptyWeekTitle`/`emptyWeekBody`, and the whole drill-in vocabulary
     (`drillLabel`, `drillLoading`, `drillEmpty*`, `drillTotalLabel`, the three
     trash lines and `close`). The reporter reads numbers on Admin metrics; this
     screen is where they TYPE them. `wholePoundsNote` did NOT go either — D69 moved
     it onto the printed receipt, where the gap between this screen and metrics is
     still worth a sentence. */
  /* D21 cut `tableHint`. Every one of our categories under a line is a button
     with `aria-expanded` on it, and it opens on click; a sentence telling
     somebody to click the buttons restates the buttons. */
  rolledUpLabel: 'Our categories counted under it',
  lineTotalLabel: 'Line total',
  emptyWeekTitle: 'Nothing was received in these dates.',
  emptyWeekBody: 'Try other dates, or check that the runs in them have been weighed.',

  // --- correcting a weight on the receipt (D54, PRD cap 15) ----------------
  /** The heading over the corrections block on an open receipt. It names what the
   *  block is FOR rather than what it contains: after the receiver's window closes
   *  this is the only way left to fix a number (cap 15), and a reporter who does
   *  not know that reads a list of weights as decoration. */
  correctionsLabel: 'Change a weight on this pickup',
  /* D69 cut `correctionsHint` ("These are the weights behind the lines above. Change
     one here if it is wrong."). The heading above already says what the block is for
     and every row carries its own Change weight button; the sentence restated both. */
  correctionsLoading: 'Loading the weights',
  correctionsEmpty: 'No weights were logged under this pickup.',
  correctionsTotalLabel: 'These weights add up to',
  colReceiver: 'Logged by',
  loggedByPrefix: 'logged by',
  walkIn: 'Walk-in donation',

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
  blockedTitle: 'This cannot be reported yet',
  blockedLabel: 'What is missing',
  /** The matching moved to Admin (D17), so this stopped being a button on this
   *  screen and became a sentence about somewhere else. A Reporter with no Admin
   *  tier cannot fix the block themselves any more, and saying who can is the
   *  least this screen owes them — hiding the fact would leave them re-reading a
   *  block with nothing to act on. D40 merged that tab into Categories, so the
   *  sentence names where the matching is today rather than where it was. */
  matchingIsInAdmin:
    'An admin matches our categories to the food bank’s, under Admin, on the Categories tab.',
  unmappedLabel: 'Carrying weight with nowhere to report it',
  oneCategory: 'category',
  manyCategories: 'categories',
  unmappedTail: 'have no food bank category yet:',

  // --- open runs (surfaced, never blocking — A184) -------------------------
  openRunsLabel: 'Runs still open in these dates',
  oneRun: 'run',
  manyRuns: 'runs',
  /** D69 kept the COUNT and cut the three sentences after it ("…are not finished. You
   *  can still report. Anything they bring in will not be on the receipts."). How many
   *  runs are still open is a fact a reporter needs before filing; the tail was a
   *  lecture on a screen they read every week. A184 is untouched — an open run is still
   *  surfaced and still does not block. */
  openRunsTail: 'still open in these dates.',
  runOpen: 'nobody has claimed it',
  runClaimed: 'claimed, not started',
  runInProgress: 'out on the road',
  runUnfinished: 'not finished',

  // --- the one way out: the receipts, on screen and on paper (D29, D54) -----
  /* THE BUTTON IS GONE (D54). D34 had already cut two buttons to one — "Export for
     Meal Connect" and "Print or save as PDF" — and made it the screen's primary
     action. There is nothing left for it to open: the receipts ARE the screen, and
     a button that reveals what is already on screen is a step between a reporter
     and their job. `COPY.export` went with it. */
  /* D69 cut `exportHint` ("One card per store per day, in the order Meal Connect
     takes them. Check Number of Items and Total Pounds against what it shows you.").
     The cards are on screen in that order, each one headed with a date and a store,
     and `Number of Items` / `Total Pounds` are printed on every card under Meal
     Connect's own names — the sentence described what the reporter was looking at. */
  /** The pantry asked for "PDF". D5 forbids the dependency and D13 says the far
   *  end is not a document anyway, so this is the same cards laid out for paper
   *  and handed to the browser's own dialogue, where "Save as PDF" is one of the
   *  destinations. Reachable from INSIDE the report view (D34), where the cards
   *  are, rather than from a screen that has none on it yet. */
  print: 'Print or save as PDF',
  /* D34 cut `exportedNote` ("These are built from what is in R3 right now. Export
     again after anything changes."). Every figure on this screen is computed on
     read and always was; saying so under a button told a reporter something true
     of the whole app and asked them to act on it. What replaced it is the
     check-off, which answers the question the sentence was gesturing at — which
     of these have I already filed — with a fact instead of a warning. */

  // --- the receipts ---------------------------------------------------------
  receiptsLabel: 'Receipts to enter in Meal Connect',
  receiptsTitle: 'Receipts to enter in Meal Connect',
  receiptsWeek: 'Dates',
  receiptsEmpty: 'Nothing to enter for these dates.',
  /* `backToTotals` is gone with the totals it went back to (D54). There is nothing
     behind this screen any more, so there is nothing to go back to. */
  /**
   * D28's note — ON THE PRINTED RECEIPT ONLY since D69.
   *
   * D69 took four standing paragraphs off this screen and this was the one with a
   * cost: it is the only thing explaining why S3.1 and Admin metrics show two similar
   * numbers a pound or two apart, and deleting it outright leaves that gap with
   * nothing to say why. So it survives where a reporter is actually comparing figures
   * against the portal — on paper.
   *
   * The precedent is D57, which already diverges screen from print on this same card:
   * an unticked Meal Connect checkbox is hidden on screen and drawn on paper, because
   * the printout is a mirror of the portal's own form. Same element, two stylesheets,
   * never two markup paths — see `.s31-receipts__note--print` in `report.css`.
   */
  wholePoundsNote:
    'Whole pounds, the way the food bank takes them. Admin metrics shows the exact weight, so the two can differ by a pound or two.',

  // --- the check-off (D35) --------------------------------------------------
  receiptListLabel: 'Receipts in these dates',
  /** One store at a time is how the portal takes them, so it is how the list
   *  offers them. */
  openReceipt: 'Open',
  submitted: 'Submitted',
  submittedBy: 'Submitted by',
  notSubmitted: 'Not submitted yet',
  /** A free-text walk-in has no store record, so there is nothing for the food
   *  bank's own donor picker to be pointed at and nothing to tick here.
   *
   *  It says BOTH halves because the first half is the one that gets doubted.
   *  Flipping a label-only donation on with `reportItNow` does exactly what it
   *  says — the pounds join the reported total — but the row cannot move to
   *  section 1, because filing needs a real store and a typed-in name is not one.
   *  QA watched that read as "the button did nothing". Saying only "no store"
   *  would leave a reporter believing the food is missing from the report when it
   *  is in it. */
  cannotSubmit: 'In the report, but no store to file it under',
  mark: 'Mark as submitted to Meal Connect',
  unmark: 'Not submitted after all',
  markQuestion: 'Mark as submitted:',
  /** §3 requires a `consequence`, not "are you sure", and this is a real one: a
   *  tick tells the next reporter not to file the store. That it is reversible is
   *  said in the same breath, in plain words rather than the word "undo" — nothing
   *  on this screen offers an undo on a WEIGHT (I13's void trail is the server's
   *  business), and one sentence using the word would make the other look like it
   *  might too. */
  markConsequence:
    'This tells everyone else the store is already filed, so nobody enters it twice. You can change it back.',
  markConfirm: 'Mark as submitted',
  marked: 'Marked as submitted.',
  unmarked: 'No longer marked as submitted.',
  progressOf: 'of',
  progressTail: 'receipts are submitted.',
  progressNoneTail: 'None submitted yet, out of',
  /** The bar is the same fact drawn. Named for anyone who hears the screen rather
   *  than sees it, because §3 does not let a visual signal carry a state alone. */
  progressBarLabel: 'How many receipts are submitted',

  // --- the two sections (D56) -----------------------------------------------
  /** Section 1: the work. The progress bar counts exactly this list. */
  fileableHeading: 'To file into Meal Connect',
  /** Section 2: everything that will never be typed into the portal, for two
   *  different reasons. Named for the FACT rather than for the reason, because the
   *  two reasons are said on the rows themselves. */
  unfiledHeading: 'Not filed to the food bank',
  unfiledHint:
    'None of this goes to the food bank. Pickups with no store, and donations somebody marked as not reported.',
  /** A row in section 2 that is a donation rather than a receipt. */
  notReportedState: 'Not reported',
  /** I16b: an anonymous walk-in has no store and no name, so there is nothing for
   *  the food bank to attribute the food to and the switch would be refused. The
   *  row says so rather than offering it — the same courtesy D35 gives a receipt
   *  with no store to file under. */
  cannotReportState: 'No store or name on this donation, so it cannot be reported',
  reportItNow: 'Put this in the report',
  pickAReceipt: 'Pick a receipt on the left to start typing it in.',

  // --- pointing a label at a real store (D72) -------------------------------
  /** The way out of `cannotSubmit`. A receiver typed a store name instead of picking
   *  a store, which `I16(b)` accepts and Meal Connect's donor picker does not — so
   *  the pounds are in the report and the receipt can never be ticked. Nothing used
   *  to re-point it once the store WAS added to our list, and those pounds then sat
   *  outside the food bank permanently. */
  attach: 'File this under a store',
  attachQuestion: 'Which store was this?',
  attachHint: 'Pick the store this walk-in really came from. It joins that store’s receipt.',
  /** WHERE THE TYPED NAME GOES, said plainly, because it does move.
   *
   *  `ck_ud_source_exclusive` (migration 0011) is `donor_id IS NULL OR donor_label IS
   *  NULL` — a pickup has a store OR a written-down name, never both — so choosing a
   *  store clears the name. It is not lost: it is written into the pickup's note,
   *  which shows in this receipt's own notes. A reporter who is about to see the name
   *  move needs to be told it will. */
  attachKeepsLabel: 'The name that was written down moves into the notes on this pickup.',
  attachLoading: 'Loading the stores',
  attachEmpty: 'No stores to pick from.',
  /** Donors are admin master data (I21). A reporter picks from the list and never
   *  adds to it, so the row says who can rather than offering a field. */
  attachAskAdmin: 'If the store is not here, ask an admin to add it.',
  attached: 'Filed under that store.',

  /* Meal Connect's own field names, spelled as its form spells them. These are
     the one place in R3 where somebody else's words beat ours: a Reporter is
     matching a label on screen to a label on a web page, and renaming `Storage
     Requirement` to something plainer would break the match. */
  pickupDate: 'Pickup Date',
  donor: 'Donor',
  notAttemptedBox: 'Scheduled Pickup Not Attempted',
  noPoundsBox: 'No Pounds',
  colCategory: 'Category',
  colStorage: 'Storage Requirement',
  colPounds: 'Pounds',
  itemCount: 'Number of Items',
  totalPounds: 'Total Pounds',
  ticked: 'Ticked',
  notTicked: 'Not ticked',
  noStorage: 'no storage requirement yet',

  /* Everything below the line on a card is OURS and is never typed in. Said once
     per card, over the block it applies to. */
  oursTitle: 'Our own notes on this pickup',
  oursNote: 'None of this goes into Meal Connect.',
  oursLineLabel: 'Where each line came from',
  computedLine: 'Worked out from bakery, produce and deli weight. Nothing was weighed into it.',
  noAgfpCategory: 'No category of ours',
  notesTitle: 'Notes',
  notesHint:
    'Meal Connect has one free-text box. Decide which of these belong on the submission.',
  notesEmpty: 'Nobody wrote anything about this pickup.',
  roleCoordinator: 'Coordinator',
  roleDriver: 'Driver',
  roleStop: 'At the stop',
  roleReceiver: 'Receiver',
  roleDonation: 'Walk-in',

  /* An empty card is the point of the receipt view, not a failure of it: a
     skipped stop and a run nobody worked produced no export row at all before
     D29, so the food bank never heard about them. */
  notAttemptedBody: 'Nobody picked this up, so there are no line items to enter.',
  noPoundsBody: 'The pickup happened and brought nothing back.',
  noLinesBody: 'Nothing was weighed under this pickup.',

} as const;
