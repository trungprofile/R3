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
//     comes back on the wire. A RUN's hours are now rendered in the PANTRY's zone,
//     which the session carries (A120): "is this run today?" and "what time is it?"
//     are pantry-calendar questions, and a device one zone east answered both wrong
//     after its own midnight. The original note here — "the pantry's zone is not
//     exposed to the browser by any endpoint" — stopped being true when A120 landed.
//     Availability blocks are the one thing still read in the device's zone: their
//     all-day detection is day arithmetic on instants (`describeBlock`), not a
//     format, and moving it is a larger change than D49 asked for. Recorded rather
//     than left to be rediscovered.
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
import {
  MONTH_NAMES,
  addDaysIso,
  compareIso,
  isoOf,
  parseIsoDate,
  weekdayIndex,
} from '../shared/calendar.ts';

// ---------------------------------------------------------------------------
// Calendar dates — `YYYY-MM-DD` text, never a `Date`
// ---------------------------------------------------------------------------
//
// The grid arithmetic moved to `../shared/calendar.ts` when S1.6's calendar (D73)
// became a fourth caller of the same six-week grid. Re-exported here so this
// screen's own callers still read one module, and so the away picker's imports did
// not have to move with it.

export type { CalendarDate, MonthCell } from '../shared/calendar.ts';
export {
  WEEKDAY_INITIALS,
  addDaysIso,
  compareIso,
  formatMonthLabel,
  isoOf,
  monthGrid,
  nextMonth,
  parseIsoDate,
  previousMonth,
} from '../shared/calendar.ts';

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/** The device's current calendar day. Pure over its argument so tests can pin it. */
export function todayIso(now: Date): string {
  return isoOf({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() });
}

export function daysBetweenIso(from: string, to: string): number {
  const a = parseIsoDate(from);
  const b = parseIsoDate(to);
  if (!a || !b) return 0;
  const ms = Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day);
  return Math.round(ms / 86_400_000);
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

/**
 * An instant as a wall clock.
 *
 * `timeZone` is the PANTRY's (A120), which the session carries — a run's window is a
 * pantry-local fact, so "9:00 AM" means nine at the pantry and not nine on whatever
 * device is reading it. Left undefined it falls back to the device's own zone, which
 * is correct only for the moment before the session has arrived and for the
 * availability blocks below, whose day arithmetic is still device-local.
 *
 * Same construction as `board.ts`'s `timeRange`, deliberately: two screens showing
 * one run's hours must not be able to disagree about them.
 */
export function formatInstantTime(iso: string, timeZone?: string | null): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  if (!timeZone) {
    return formatTimeLabel(
      `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`,
    );
  }
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(at);
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

export interface RunBands {
  /** The run(s) the driver is standing in front of. One large card each. */
  today: ShiftSummary[];
  /** The rest of this pantry week, completed and upcoming alike, in calendar
   *  order. Compact rows — a summary, not the focus. */
  week: ShiftSummary[];
  /** Runs this driver owns OUTSIDE the week on screen. Not rendered as a band —
   *  only counted, so the screen can point at where they are (the board's Mine
   *  filter has a week control; this page does not). Dropping them silently would
   *  lose a run a driver claimed for next Tuesday. */
  laterCount: number;
}

/**
 * Today, then the rest of the week (D49).
 *
 * This replaces the old "Coming up / Earlier" split, which answered the wrong
 * question. A driver opening this screen is usually standing in the pantry car park
 * about to do the run, so what matters is TODAY, big, and then enough of the week to
 * plan around — including the days already done, because "did I do Monday?" is a
 * question this screen should answer without a second screen.
 *
 * THE DAY IS THE PANTRY'S, NOT THE DEVICE'S. Both bounds are `YYYY-MM-DD` calendar
 * slots and every run is placed by its own `occurrenceDate` — the pantry-local slot
 * the server already resolved (`shared/src/schedule.ts`). The clock is never
 * consulted. That is the whole fix: the old panel asked `new Date()`, so a phone one
 * zone east of the pantry moved today's run into yesterday after its own midnight,
 * and "is this run today?" is a pantry-calendar question, not a device one.
 *
 * A Phase-1 run never reaches `COMPLETED` (build-plan D1), so an old `IN_PROGRESS`
 * run sitting in the week band is expected and not a stuck row: nothing here treats
 * a status as a proxy for "over".
 */
export function bandRuns(
  runs: readonly ShiftSummary[],
  today: string,
  weekStart: string,
  weekEnd: string,
): RunBands {
  const bands: RunBands = { today: [], week: [], laterCount: 0 };

  for (const run of runs) {
    const date = run.occurrenceDate;
    if (date === today) bands.today.push(run);
    else if (compareIso(date, weekStart) >= 0 && compareIso(date, weekEnd) <= 0) {
      bands.week.push(run);
    } else bands.laterCount += 1;
  }

  // Both ascending. Today's runs are done in the order they start; the week reads
  // Monday to Sunday, which is how the driver holds the week in their head and how
  // the board and S3.1 already cut it (A178).
  bands.today.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  bands.week.sort(
    (a, b) =>
      compareIso(a.occurrenceDate, b.occurrenceDate) || a.startsAt.localeCompare(b.startsAt),
  );
  return bands;
}

/** "Tue, Aug 4 · 9:00 AM – 12:00 PM". The date comes from `occurrenceDate`, the
 *  pantry-local calendar slot, so it can never drift a day against the board; the
 *  hours come from the pantry's zone for the same reason (A120). */
export function formatRunWhen(run: ShiftSummary, now: Date, timeZone?: string | null): string {
  return `${formatDayLabel(run.occurrenceDate, now)} · ${formatInstantTime(run.startsAt, timeZone)} – ${formatInstantTime(run.endsAt, timeZone)}`;
}

/** Just the hours, for the Today card — the card's own heading already says the
 *  day, and repeating "Tue, Aug 4" under it would be the doubled label D53 is
 *  removing elsewhere. */
export function formatRunHours(run: ShiftSummary, timeZone?: string | null): string {
  return `${formatInstantTime(run.startsAt, timeZone)} – ${formatInstantTime(run.endsAt, timeZone)}`;
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
  /** D49's page heading. It is the nav entry and the Home card's own words ("Pick
   *  up food"), because a heading that renames the place you just tapped makes the
   *  tap feel like it went somewhere else. The old "My shifts" went with the tab. */
  pageTitle: "Today's pickup",

  /** The two bands. "Today" is the focus; "This week" is the summary around it. */
  todayHeading: 'Today',
  weekHeading: 'This week',

  /** No run today is the ordinary case, not an error — most days a driver has
   *  none — so it says where work is rather than apologising. */
  noneToday: 'Nothing to pick up today.',
  noneTodayBody: 'Open runs are on the board.',
  seeBoard: 'See open runs',

  /** Nothing at all, all week and every week. */
  noRuns: "You're not on any runs yet.",
  noRunsBody: 'Open runs are on the board.',

  /** Nothing else THIS week, but the driver does own runs beyond it. This page has
   *  no week control on purpose — it is about now — so it says where the rest are
   *  instead of hiding them. */
  restOfWeekEmpty: 'Nothing else this week.',
  laterElsewhere: 'Your later runs are on the board, under Mine.',

  /** The Today card's one action. "Open" rather than "Start": starting is S1.5's
   *  own step behind S1.3, and a card that says Start and then does not start is a
   *  promise broken on the tap. */
  openRun: 'Open this run',

  /** `ui-ux-spec.md S1.4`, in the driver's verb (S1.3's cancel-this-run). */
  explain:
    "Telling us you're away helps the coordinator fill runs. It won't cancel runs you already own. You'll need to cancel those yourself first.",
  noDays: "Pick the days you'll be away.",
  noTimes: 'Pick a start time and an end time.',
  endBeforeStart: 'The end time has to be later in the day than the start time.',
  saved: 'Saved. The coordinator can see it.',
  removed: "Removed. You're available then again.",
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
