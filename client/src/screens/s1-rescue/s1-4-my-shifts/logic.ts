// S1.4's rules as pure functions — grouping, calendar arithmetic, the request the
// "When I'm away" form builds, and the sentences the screen renders.
//
// Everything a wrong answer would silently break lives here rather than inside a
// component, because there is no browser test harness in this repo (no jsdom, and
// adding one would be a dependency — build-plan §3/D5). What is testable is
// therefore what is separable.
//
// TIME FRAMES, and they are not interchangeable:
//
//   * `YYYY-MM-DD` / `HH:MM` — pantry-local calendar date and wall clock. This is
//     what a declaration is expressed in and what the server converts against
//     `app_config.timezone` (`shared/src/availability.ts`, state A55). The client
//     NEVER converts one to an instant; it only ever assembles the strings.
//   * ISO-8601 instants — what `availability_block` and `shift` store and what
//     comes back on the wire. Rendered here in the device's own zone, because the
//     pantry's zone is not exposed to the browser by any endpoint (see report
//     `Assumed:`). A driver's phone standing in the pantry's zone — the ordinary
//     case — reads exactly what the server stored.
//
// Client-side checks below are COMMUNICATION ONLY (`CLAUDE.md`): every one of them
// is enforced again server-side, and none of them relaxes anything. Where the
// server owns a limit this file does not know (the horizon bound on a declaration),
// it deliberately does not guess — the server's own sentence is shown instead.

import { toApiError } from '../../../api/index.ts';
import type {
  AvailabilityBlockSummary,
  DeclareAvailabilityRequest,
  ShiftSummary,
} from '../../../api/shared.ts';

// ---------------------------------------------------------------------------
// Calendar dates — `YYYY-MM-DD` text, never a `Date`
// ---------------------------------------------------------------------------

export interface CalendarDate {
  year: number;
  /** 1-12. */
  month: number;
  day: number;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const MONTH_NAMES = [
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

export function parseIsoDate(value: string): CalendarDate | null {
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

export function isoOf(date: CalendarDate): string {
  const mm = String(date.month).padStart(2, '0');
  const dd = String(date.day).padStart(2, '0');
  return `${date.year}-${mm}-${dd}`;
}

/** The device's current calendar day. Pure over its argument so tests can pin it. */
export function todayIso(now: Date): string {
  return isoOf({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() });
}

export function addDaysIso(iso: string, days: number): string {
  const date = parseIsoDate(iso);
  if (!date) return iso;
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return isoOf({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  });
}

/** ISO date strings sort lexicographically; this only names why. */
export function compareIso(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function daysBetweenIso(from: string, to: string): number {
  const a = parseIsoDate(from);
  const b = parseIsoDate(to);
  if (!a || !b) return 0;
  const ms = Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day);
  return Math.round(ms / 86_400_000);
}

/** Day-of-week index, 0 = Sunday. Calendar arithmetic only — no zone involved. */
function weekdayIndex(date: CalendarDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

/**
 * "Tue, Aug 4". The year is added only when it is not the year the viewer is
 * standing in, so an ordinary next-week run does not carry noise (§7: short).
 */
export function formatDayLabel(iso: string, now: Date): string {
  const date = parseIsoDate(iso);
  if (!date) return iso;
  const weekday = WEEKDAY_NAMES[weekdayIndex(date)] ?? '';
  const month = MONTH_NAMES[date.month - 1] ?? '';
  const base = `${weekday.slice(0, 3)}, ${month.slice(0, 3)} ${date.day}`;
  return date.year === now.getFullYear() ? base : `${base}, ${date.year}`;
}

export function formatMonthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1] ?? ''} ${year}`;
}

/** Short weekday headers for the day picker, Sunday first (US pantry). */
export const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

export interface MonthCell {
  iso: string;
  day: number;
  /** False for the leading/trailing days that only fill the grid out. */
  inMonth: boolean;
}

/** A month as six weeks of seven cells, Sunday first — the shape a grid renders. */
export function monthGrid(year: number, month: number): MonthCell[][] {
  const first: CalendarDate = { year, month, day: 1 };
  const lead = weekdayIndex(first);
  const start = addDaysIso(isoOf(first), -lead);

  const weeks: MonthCell[][] = [];
  for (let week = 0; week < 6; week += 1) {
    const cells: MonthCell[] = [];
    for (let index = 0; index < 7; index += 1) {
      const iso = addDaysIso(start, week * 7 + index);
      const date = parseIsoDate(iso);
      cells.push({
        iso,
        day: date?.day ?? 1,
        inMonth: date?.month === month && date.year === year,
      });
    }
    weeks.push(cells);
  }
  return weeks;
}

export function nextMonth(year: number, month: number): { year: number; month: number } {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

export function previousMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

// ---------------------------------------------------------------------------
// Wall clock
// ---------------------------------------------------------------------------

/** Half-hour steps, 5:00am to 10:00pm — the hours a food-rescue run can fall in.
 *  A finer grid is a fragile control (§1.5) and a coarser one cannot express a
 *  9:30 run. */
export function timeOptions(): string[] {
  const options: string[] = [];
  for (let minutes = 5 * 60; minutes <= 22 * 60; minutes += 30) {
    const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
    const mm = String(minutes % 60).padStart(2, '0');
    options.push(`${hh}:${mm}`);
  }
  return options;
}

/** `HH:MM` → "9:00 AM". 12-hour, because that is how the pantry says it. */
export function formatTimeLabel(value: string): string {
  const [rawHour, rawMinute] = value.split(':');
  const hour = Number(rawHour);
  const minute = Number(rawMinute);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return value;
  const suffix = hour < 12 ? 'AM' : 'PM';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${String(minute).padStart(2, '0')} ${suffix}`;
}

export function minutesOfTime(value: string): number {
  const [hour, minute] = value.split(':');
  return Number(hour) * 60 + Number(minute);
}

/** An instant as a wall clock in the DEVICE's zone. See the header note. */
export function formatInstantTime(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return formatTimeLabel(
    `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`,
  );
}

function instantDayIso(iso: string): string {
  const at = new Date(iso);
  return isoOf({ year: at.getFullYear(), month: at.getMonth() + 1, day: at.getDate() });
}

function isLocalMidnight(iso: string): boolean {
  const at = new Date(iso);
  return at.getHours() === 0 && at.getMinutes() === 0;
}

// ---------------------------------------------------------------------------
// "My runs"
// ---------------------------------------------------------------------------

export interface RunGroups {
  upcoming: ShiftSummary[];
  past: ShiftSummary[];
}

/**
 * Past/future, split on the run's END, not its start: a run you are standing in
 * the middle of belongs with what is coming up, not with history.
 *
 * A Phase-1 run never reaches `COMPLETED` (build-plan D1) — an old `IN_PROGRESS`
 * run whose window has passed is expected here and is not a bug, so nothing below
 * treats a status as a proxy for "over".
 */
export function groupRuns(runs: readonly ShiftSummary[], nowMs: number): RunGroups {
  const upcoming: ShiftSummary[] = [];
  const past: ShiftSummary[] = [];

  for (const run of runs) {
    if (new Date(run.endsAt).getTime() <= nowMs) past.push(run);
    else upcoming.push(run);
  }

  upcoming.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  past.sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  return { upcoming, past };
}

/** "Tue, Aug 4 · 9:00 AM – 12:00 PM". The date comes from `occurrenceDate`, the
 *  pantry-local calendar slot, so it can never drift a day against the board. */
export function formatRunWhen(run: ShiftSummary, now: Date): string {
  return `${formatDayLabel(run.occurrenceDate, now)} · ${formatInstantTime(run.startsAt)} – ${formatInstantTime(run.endsAt)}`;
}

// ---------------------------------------------------------------------------
// "When I'm away" — reading blocks back
// ---------------------------------------------------------------------------

export interface BlockView {
  id: string;
  /** Whole days: midnight to midnight (`services/availability.ts`, `DATES`). */
  allDay: boolean;
  /** "All day · Mon, Aug 3 – Wed, Aug 5" or "Mon, Aug 3 · 9:00 AM – 12:00 PM". */
  label: string;
  startMs: number;
  endMs: number;
}

/**
 * One stored block as one line.
 *
 * A `WINDOW` declaration is stored as one row PER DATE (state A58), so five days
 * of "9 to 12" list as five lines and each is withdrawn on its own. That is the
 * stored shape, not a display choice — merging them here would offer a Remove
 * that deletes rows the driver was never shown.
 *
 * `endsAt` is exclusive (`domain-modeling.md §5.2`, half-open), so a whole-day
 * block ending at midnight is named by the day before it.
 */
export function describeBlock(block: AvailabilityBlockSummary, now: Date): BlockView {
  const startMs = new Date(block.startsAt).getTime();
  const endMs = new Date(block.endsAt).getTime();
  const firstDay = instantDayIso(block.startsAt);
  const allDay = isLocalMidnight(block.startsAt) && isLocalMidnight(block.endsAt);

  let label: string;
  if (allDay) {
    const lastDay = addDaysIso(instantDayIso(block.endsAt), -1);
    label =
      compareIso(firstDay, lastDay) === 0
        ? `All day · ${formatDayLabel(firstDay, now)}`
        : `All day · ${formatDayLabel(firstDay, now)} – ${formatDayLabel(lastDay, now)}`;
  } else {
    const endDay = instantDayIso(block.endsAt);
    label =
      compareIso(firstDay, endDay) === 0
        ? `${formatDayLabel(firstDay, now)} · ${formatInstantTime(block.startsAt)} – ${formatInstantTime(block.endsAt)}`
        : `${formatDayLabel(firstDay, now)} ${formatInstantTime(block.startsAt)} – ${formatDayLabel(endDay, now)} ${formatInstantTime(block.endsAt)}`;
  }

  return { id: block.id, allDay, label, startMs, endMs };
}

export interface BlockGroups {
  upcoming: BlockView[];
  past: BlockView[];
}

/** Same split as the runs list, on the same reasoning: a block you are inside of
 *  is still in force. */
export function groupBlocks(
  blocks: readonly AvailabilityBlockSummary[],
  now: Date,
): BlockGroups {
  const views = blocks.map((block) => describeBlock(block, now));
  const nowMs = now.getTime();
  return {
    upcoming: views.filter((view) => view.endMs > nowMs).sort((a, b) => a.startMs - b.startMs),
    past: views.filter((view) => view.endMs <= nowMs).sort((a, b) => b.startMs - a.startMs),
  };
}

// ---------------------------------------------------------------------------
// "When I'm away" — the form
// ---------------------------------------------------------------------------

export interface AwayForm {
  /** `YYYY-MM-DD`, pantry-local as the driver reads the calendar. */
  fromDate: string | null;
  toDate: string | null;
  /** S1.4: "pick a date range OR a time window within dates". */
  kind: 'DATES' | 'WINDOW';
  startTime: string | null;
  endTime: string | null;
}

export const EMPTY_FORM: AwayForm = {
  fromDate: null,
  toDate: null,
  kind: 'DATES',
  startTime: null,
  endTime: null,
};

/**
 * Two taps make a range: the first sets both ends, the second extends whichever
 * side it lands on. No mode switch and no "now pick the end date" step — §1.5
 * rules out multi-step pickers.
 */
export function pickDay(form: AwayForm, iso: string): AwayForm {
  if (form.fromDate === null || form.toDate === null) {
    return { ...form, fromDate: iso, toDate: iso };
  }
  if (form.fromDate === form.toDate) {
    return compareIso(iso, form.fromDate) < 0
      ? { ...form, fromDate: iso }
      : { ...form, toDate: iso };
  }
  // A third tap starts over, so a driver who picked the wrong range is one tap
  // from the right one rather than hunting for a Clear button.
  return { ...form, fromDate: iso, toDate: iso };
}

export function isDayInRange(form: AwayForm, iso: string): boolean {
  if (form.fromDate === null || form.toDate === null) return false;
  return compareIso(iso, form.fromDate) >= 0 && compareIso(iso, form.toDate) <= 0;
}

export const COPY = {
  /** `ui-ux-spec.md S1.4`, in the driver's verb (S1.3's cancel-this-run). */
  explain:
    "Telling us you're away helps the coordinator fill runs. It won't cancel runs you already own — you'll need to cancel those yourself first.",
  noDays: "Pick the days you'll be away.",
  noTimes: 'Pick a start time and an end time.',
  endBeforeStart: 'The end time has to be later in the day than the start time.',
  saved: 'Saved — the coordinator can see it.',
  removed: "Removed — you're available then again.",
  removeQuestion: 'Remove this time away?',
  removeConsequence: 'Runs in that window can be offered to you again.',
} as const;

/**
 * What is wrong with the form, in the driver's words, or null.
 *
 * Communication only. Each line mirrors a rule the service enforces again:
 * `expandDeclaration` rejects `toDate` before `fromDate`, a `WINDOW` missing
 * either time, and an end time not later in the day than the start (intra-day,
 * state A57). Nothing here is relaxed, and the one limit the client cannot know —
 * how many days one declaration may span, which is `app_config.horizon_days` — is
 * deliberately left to the server so that its own sentence is what shows.
 */
export function validateForm(form: AwayForm): string | null {
  if (form.fromDate === null || form.toDate === null) return COPY.noDays;
  if (compareIso(form.fromDate, form.toDate) > 0) return COPY.noDays;
  if (form.kind === 'WINDOW') {
    if (form.startTime === null || form.endTime === null) return COPY.noTimes;
    if (minutesOfTime(form.endTime) <= minutesOfTime(form.startTime)) {
      return COPY.endBeforeStart;
    }
  }
  return null;
}

/** The request body, or null when the form is not ready. Dates and times only —
 *  the server resolves them against the pantry's zone (state A55). */
export function buildDeclaration(form: AwayForm): DeclareAvailabilityRequest | null {
  if (validateForm(form) !== null) return null;
  if (form.fromDate === null || form.toDate === null) return null;

  if (form.kind === 'DATES') {
    return { kind: 'DATES', fromDate: form.fromDate, toDate: form.toDate };
  }
  if (form.startTime === null || form.endTime === null) return null;
  return {
    kind: 'WINDOW',
    fromDate: form.fromDate,
    toDate: form.toDate,
    startTime: form.startTime,
    endTime: form.endTime,
  };
}

/** The sentence above Save, so the driver reads back what they are about to send
 *  instead of trusting a highlighted grid (§7: say the consequence). */
export function summarySentence(form: AwayForm, now: Date): string | null {
  if (validateForm(form) !== null) return null;
  if (form.fromDate === null || form.toDate === null) return null;

  const from = formatDayLabel(form.fromDate, now);
  const to = formatDayLabel(form.toDate, now);
  const oneDay = form.fromDate === form.toDate;

  if (form.kind === 'DATES') {
    return oneDay
      ? `You'll be away all day on ${from}.`
      : `You'll be away all day, ${from} to ${to}.`;
  }

  const window = `${formatTimeLabel(form.startTime ?? '')} – ${formatTimeLabel(form.endTime ?? '')}`;
  return oneDay
    ? `You'll be away ${window} on ${from}.`
    : `You'll be away ${window} on every day from ${from} to ${to}.`;
}

// ---------------------------------------------------------------------------
// Failures
// ---------------------------------------------------------------------------

/**
 * What to show when a save or a withdrawal is refused.
 *
 * A 409 here is I20's declaration gate: the driver owns a CLAIMED or IN_PROGRESS
 * run inside the window they just asked to be away for. S1.4 gives that refusal
 * two different sentences depending on whether the run can still be released, and
 * `services/availability.ts` already chooses between them and sends the chosen one
 * as `message` — so this renders the server's sentence rather than deciding again
 * from a copy of the rule that could drift out of step with it.
 */
export function failureMessage(error: unknown): string {
  const apiError = toApiError(error);
  return apiError.detail ?? apiError.message;
}
