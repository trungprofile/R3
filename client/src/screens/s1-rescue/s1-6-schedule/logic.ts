// S1.6's rules as pure functions — calendar and wall-clock arithmetic, the three
// forms this screen submits, the route builder's ordering, and every sentence it
// renders.
//
// Split out from the components because there is no jsdom and no component
// renderer in this repo, and adding one would be a dependency (build-plan §3/D5).
// What lives here is what a wrong answer would silently break; the components are
// markup over it.
//
// TWO TIME FRAMES, and they are not interchangeable. Getting the direction wrong
// on THIS screen is worse than anywhere else, because this is the screen that
// *chooses* times:
//
//   * `YYYY-MM-DD` / `HH:MM` — pantry-local calendar date and wall clock. This is
//     the frame staff schedule in and the frame the wire carries for a publish, a
//     repeating rule and a terminate range (`shared/src/schedule.ts`). Nothing
//     below ever converts one of these to an instant: the server resolves them
//     once, against `app_config.timezone`. A picker that turned the staff device's
//     9am into an instant would write the wrong moment for a pantry in another
//     zone.
//   * ISO-8601 instants — what `shift.starts_at` / `ends_at` store and what comes
//     back for an existing run. Rendered here in the PANTRY's zone, which the
//     session carries (state A120), never the device's. The device zone survives
//     only as the fallback for the moment before the session has loaded, where
//     there is nothing better to use.
//
// A recurring rule's `startTime` / `endTime` come back as pantry-local `HH:MM`
// already (`data-model.md §5.2` stores `time`, not `timestamptz`) and are printed
// as they arrive. Passing one through an instant formatter would be the same bug
// from the other side.
//
// Client-side checks here are COMMUNICATION ONLY (`CLAUDE.md`): every one is
// enforced again server-side, none of them relaxes anything, and where the server
// owns a limit this file cannot know it shows the server's own sentence instead.

import { toApiError } from '../../../api/index.ts';
import type {
  CreatePatternRequest,
  CreateRouteRequest,
  CreateShiftRequest,
  DonorSummary,
  DuplicateRunWarning,
  EligibilityReason,
  RecurrencePatternSummary,
  RouteDetail,
  RouteStopSummary,
  ShapedUser,
  ShiftSummary,
  UpdatePatternRequest,
  UpdateRouteRequest,
} from '../../../api/shared.ts';
import { hasDuty } from '../../../api/shared.ts';

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

/** ISO weekday order, 1 = Monday … 7 = Sunday — the numbering
 *  `recurrence_pattern.weekdays` uses (`data-model.md §5.2`). */
export const WEEKDAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
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

/** Sunday-first column headers for the day grid (US pantry). */
export const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

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
  return `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
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

/** ISO weekday of a calendar date, 1 = Monday … 7 = Sunday. Pure calendar
 *  arithmetic — which weekday a date falls on involves no zone. */
export function isoWeekdayOf(iso: string): number {
  const date = parseIsoDate(iso);
  if (!date) return 0;
  const dow = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

/**
 * TODAY AT THE PANTRY, as a `YYYY-MM-DD` slot (A120).
 *
 * Not the device's date: staff scheduling from a laptop in another zone would
 * otherwise see a day picker whose "today" is a day off the pantry's, and every
 * date they picked would be evaluated against a calendar they were not looking at.
 * `timeZone` null — only before the session has loaded — falls back to the
 * device's zone, which is all there is at that moment.
 */
export function pantryToday(now: Date, timeZone: string | null): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    ...(timeZone ? { timeZone } : {}),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

/**
 * The pantry's current wall clock as `HH:MM` (A120).
 *
 * Needed by exactly one thing: deciding whether today's occurrence of a new
 * repeating run has already begun, which is what `services/recurrence.ts` filters
 * on when it mints. `hourCycle: 'h23'` rather than `hour12: false`, which renders
 * midnight as "24" in some locales.
 */
export function pantryClock(now: Date, timeZone: string | null): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    ...(timeZone ? { timeZone } : {}),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  return `${pick('hour')}:${pick('minute')}`;
}

/** "Aug 4", with the year only when it is not the year staff is standing in
 *  (§7: short). The form S1.6's own example sentence uses. */
export function formatShortDate(iso: string, today: string): string {
  const date = parseIsoDate(iso);
  if (!date) return iso;
  const month = (MONTH_NAMES[date.month - 1] ?? '').slice(0, 3);
  const base = `${month} ${date.day}`;
  return String(date.year) === today.slice(0, 4) ? base : `${base}, ${date.year}`;
}

/** "Tue, Aug 4" — a run row's date. */
export function formatDayLabel(iso: string, today: string): string {
  const weekday = WEEKDAY_NAMES[isoWeekdayOf(iso) - 1];
  if (weekday === undefined) return iso;
  return `${weekday.slice(0, 3)}, ${formatShortDate(iso, today)}`;
}

/** A day heading over a group of runs. "Today" and "Tomorrow" replace the weekday
 *  where they apply — §1.4 is recognition over recall. */
export function dayHeading(iso: string, today: string): string {
  const short = formatShortDate(iso, today);
  if (iso === today) return `Today, ${short}`;
  if (iso === addDaysIso(today, 1)) return `Tomorrow, ${short}`;
  const weekday = WEEKDAY_NAMES[isoWeekdayOf(iso) - 1] ?? '';
  return `${weekday}, ${short}`;
}

export function formatMonthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1] ?? ''} ${year}`;
}

export interface MonthCell {
  iso: string;
  day: number;
  /** False for the leading/trailing days that only fill the grid out. */
  inMonth: boolean;
}

/** A month as six weeks of seven cells, Sunday first — the shape a grid renders. */
export function monthGrid(year: number, month: number): MonthCell[][] {
  const first = isoOf({ year, month, day: 1 });
  // `isoWeekdayOf` is Monday-first; the grid is Sunday-first.
  const lead = isoWeekdayOf(first) % 7;
  const start = addDaysIso(first, -lead);

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

export function monthOf(iso: string, fallback: { year: number; month: number }) {
  const date = parseIsoDate(iso);
  return date ? { year: date.year, month: date.month } : fallback;
}

// ---------------------------------------------------------------------------
// Wall clock
// ---------------------------------------------------------------------------

/** Half-hour steps, 5:00am to 10:00pm — the hours a food-rescue run falls in.
 *  A visible grid of big buttons, not a dropdown or a multi-step picker (§1.5).
 *  Same grid S1.4 offers for availability, so the two screens agree on what a
 *  pickup hour is. */
export function timeOptions(): string[] {
  const options: string[] = [];
  for (let minutes = 5 * 60; minutes <= 22 * 60; minutes += 30) {
    options.push(
      `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`,
    );
  }
  return options;
}

export function minutesOfTime(value: string): number {
  const [hour, minute] = value.split(':');
  return Number(hour) * 60 + Number(minute);
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

/** A repeating rule's own window. Both ends are already pantry-local `HH:MM`
 *  (`data-model.md §5.2`) — putting them through an instant formatter would
 *  convert a wall clock that was never an instant. */
export function formatClockRange(startTime: string, endTime: string): string {
  return `${formatTimeLabel(startTime)} – ${formatTimeLabel(endTime)}`;
}

/**
 * An existing run's window, rendered in the PANTRY's zone (A120).
 *
 * A run time is a pantry-local fact: the 9am run is 9am at the pantry, not on
 * whatever machine is reading it. `timeZone` undefined uses the device's zone,
 * correct only for the moment before the session loads.
 */
export function formatInstantRange(
  startsAt: string,
  endsAt: string,
  timeZone?: string | undefined,
): string {
  const format = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  });
  return `${format.format(new Date(startsAt))} – ${format.format(new Date(endsAt))}`;
}

// ---------------------------------------------------------------------------
// Copy (§7: plain, short, second person)
// ---------------------------------------------------------------------------

/** Forbidden in any UI string (`ui-ux-spec.md §7`). Pinned by a test rather than
 *  by good intentions — which is why the word below is always "run". */
export const FORBIDDEN_IN_COPY = [
  'pwa',
  'push subscription',
  'session',
  'payload',
  'endpoint',
  'atomic',
  'instance',
] as const;

export const COPY = {
  title: 'Schedule',

  tabRuns: 'Runs',
  tabRepeating: 'Repeating runs',
  tabRoutes: 'Routes',
  tabsLabel: 'Runs, repeating runs and routes',

  // --- Publish one run (S1.6: "Publish shift: date/time, route") -----------
  publishHeading: 'Publish a run',
  publishRoute: 'Which route?',
  publishDate: 'Which day?',
  publishStart: 'Starts',
  publishEnd: 'Ends',
  publishNote: 'Note for the driver (optional)',
  publish: 'Publish',
  published: 'Run published — it’s on the board.',
  /** No truck field, and no driver field, stated where staff would look for them.
   *  The driver picks the truck at start (I8) and a run exists with no driver at
   *  all (PRD cap 4). */
  publishHint:
    'The driver picks the truck when they start. A run can go up with no driver — anyone can claim it from the board.',

  noRoute: 'Pick a route.',
  noDate: 'Pick a day.',
  noTimes: 'Pick a start time and an end time.',
  endBeforeStart: 'The end time has to be later in the day than the start time.',
  noWeekday: 'Pick at least one day of the week.',

  // --- Repeating runs (S1.6's recurring builder) ---------------------------
  repeatHeading: 'Add a repeating run',
  repeatEditHeading: 'Edit the weekly pattern',
  repeatWeekdays: 'Which days?',
  repeatEnds: 'When does it stop?',
  repeatNoEnd: 'No end',
  repeatEndOn: 'Ends on a date',
  /** COMPUTED AND READ-ONLY. A repeating run has no stored start date: it begins
   *  when it is created, and this sentence tells staff which date that works out
   *  to (`domain-modeling.md §5.3`, `ui-ux-spec.md S1.6`). */
  startingLabel: 'This repeating run will make',
  repeatSave: 'Save the repeating run',
  repeatCreated: (count: number) =>
    count === 1 ? 'Saved — 1 run added to the board.' : `Saved — ${count} runs added to the board.`,
  repeatUpdated: 'Saved.',
  repeatEmpty: 'No repeating runs yet.',
  repeatEmptyBody: 'Add one above and it fills the board out as far as runs are built.',
  /** The pattern edit's three outcomes, which the server reports separately
   *  because they are three different facts about already-published runs. */
  repeatMoved: (count: number) =>
    count === 1 ? '1 open run moved to the new time.' : `${count} open runs moved to the new time.`,
  repeatOwned: (count: number) =>
    count === 1
      ? '1 run already has a driver and was left where it is — move it yourself if it needs to change.'
      : `${count} runs already have drivers and were left where they are — move them yourself if they need to change.`,
  repeatOffPattern: (count: number) =>
    count === 1
      ? '1 run is no longer on this pattern and stays on the board. Cancel it below if it should not happen.'
      : `${count} runs are no longer on this pattern and stay on the board. Cancel them below if they should not happen.`,
  repeatCancel: 'Stop using this',
  editThisDate: 'Edit just this date',
  editThePattern: 'Edit the weekly pattern',
  editScopeQuestion: 'Edit just this date, or the weekly pattern?',
  editScopeConsequence:
    'Editing just this date leaves the rest of the repeating run alone. Editing the pattern changes every open run still to come.',

  // --- Bulk terminate ------------------------------------------------------
  terminate: 'Cancel a stretch of dates',
  terminateHeading: 'Cancel a stretch of dates',
  terminateHint:
    'Pick the first and last day to cancel. Runs in between are cancelled for good — this is not the same as putting them back on the board.',
  terminateConfirm: 'Cancel these runs?',
  terminateConsequence:
    'They cannot be brought back, and no one can claim them. The repeating run keeps making runs after the last day you picked unless you also give it an end date.',
  terminateGo: 'Cancel them',
  terminated: (count: number) =>
    count === 1 ? '1 run cancelled.' : `${count} runs cancelled.`,
  terminateNoRange: 'Pick a first and last day.',

  // --- Runs list -----------------------------------------------------------
  runsHeading: 'Runs coming up',
  runsEmpty: 'No runs scheduled yet.',
  runsEmptyBody: 'Publish one above, or add a repeating run.',
  repeatsTag: 'repeats weekly',
  conflictTag: 'assigned over a conflict',
  unowned: 'No driver yet',
  runNote: 'Note for the driver',
  saveNote: 'Save',
  noteSaved: 'Saved.',
  moveDateTime: 'Move the date or time',
  cancelRun: 'Cancel this run',
  cancelRunQuestion: 'Cancel this run?',
  cancelRunConsequence:
    'It comes off the board and no one can claim it. This cannot be undone.',
  cancelRunGo: 'Cancel the run',
  cancelledRun: 'Run cancelled.',
  closeEditor: 'Done',

  // --- Assign (PRD cap 6's fallback, I20's staff exemption) ----------------
  assign: 'Set a driver',
  assignHeading: 'Who is driving?',
  assignHint: 'A run does not need a driver — leave it open and anyone can claim it.',
  assignAnyway: 'Assign anyway',
  assigned: (name: string) => `${name} is on this run.`,
  clearDriver: 'Take the driver off',
  clearDriverQuestion: 'Take the driver off this run?',
  clearDriverConsequence: 'It goes back on the board as open, and anyone can claim it.',
  clearDriverGo: 'Take them off',
  driverCleared: 'Run is back on the board.',
  noDrivers: 'No one can drive yet.',
  noDriversBody: 'An admin adds the drive duty to an account in Admin.',
  checkingDriver: 'Checking…',

  // --- Route builder (S1.6: "an ordered list of stores") -------------------
  routesHeading: 'Routes',
  routeNew: 'New route',
  routeName: 'Route name',
  routeStops: 'Stores, in the order the driver drives them',
  routeAdd: 'Add a store',
  routeSave: 'Save the route',
  routeSaved: 'Route saved.',
  routeEmpty: 'No routes yet.',
  routeEmptyBody: 'Build one from your stores — a run needs a route before you can publish it.',
  routeNoStops: 'Add at least one store.',
  routeNoName: 'Give the route a name.',
  routeStopsEmpty: 'No stores on this route yet.',
  routeAddEmpty: 'Every store is already on this route.',
  routeGoneStore: 'This store was removed — swap it out.',
  dragHint:
    'Drag a store to reorder it, or focus its handle and press the up and down arrow keys.',
  /** The handle is the whole reorder control now, so it carries the instructions
   *  a screen-reader user would otherwise have got from two named buttons. */
  reorderHandle: (name: string, position: number, total: number) =>
    `Reorder ${name}, ${position} of ${total}. Press the up and down arrow keys to move it.`,
  removeStop: 'Remove',
  removeStopFor: (name: string) => `Remove ${name} from the route`,
  routeArchived: 'Archived',
  routeShowArchived: 'Show archived routes',
  routeHideArchived: 'Hide archived routes',
  routeRestore: 'Use this route again',
  routeRestored: 'Route is back in use.',
  routeRemove: 'Delete this route',
  routeRemoveQuestion: 'Delete this route?',
  routeRemoveConsequence:
    'If any run has ever used it, it is archived instead and kept for the records.',
  routeRemoveGo: 'Delete it',
  routeDeleted: 'Route deleted.',
  routeArchivedToast: 'Route archived — past runs still show it.',
  stopCount: (count: number) => (count === 1 ? '1 store' : `${count} stores`),

  // --- The soft duplicate check (never a refusal) --------------------------
  duplicate: (count: number) =>
    count === 1
      ? 'There is already a run on that route at that time. This one was still published — check you meant both.'
      : `There are already ${count} runs on that route at those times. These were still published — check you meant both.`,
} as const;

// ---------------------------------------------------------------------------
// Publish one run (S1.6, PRD cap 4)
// ---------------------------------------------------------------------------

/**
 * No truck field and no driver field, by construction rather than by omission:
 * the driver picks the truck at start (I8) and a shift exists independently of any
 * driver (PRD cap 4), so staff setting either here would contradict the domain.
 */
export interface PublishForm {
  routeId: string | null;
  /** `YYYY-MM-DD`, pantry-local. */
  date: string | null;
  /** `HH:MM`, pantry-local. */
  startTime: string | null;
  endTime: string | null;
  staffNote: string;
}

export const EMPTY_PUBLISH: PublishForm = {
  routeId: null,
  date: null,
  startTime: null,
  endTime: null,
  staffNote: '',
};

/** Communication only. Each line mirrors a check `services/schedule.ts` makes
 *  again — a missing route, a missing day, and `ck_shift_window`'s intra-day
 *  rule. Nothing here is relaxed. */
export function validatePublish(form: PublishForm): string | null {
  if (form.routeId === null) return COPY.noRoute;
  if (form.date === null) return COPY.noDate;
  if (form.startTime === null || form.endTime === null) return COPY.noTimes;
  if (minutesOfTime(form.endTime) <= minutesOfTime(form.startTime)) return COPY.endBeforeStart;
  return null;
}

/** The request body, or null when the form is not ready. Dates and times only —
 *  the server resolves them against the pantry's zone. */
export function buildPublish(form: PublishForm): CreateShiftRequest | null {
  if (validatePublish(form) !== null) return null;
  if (form.routeId === null || form.date === null) return null;
  if (form.startTime === null || form.endTime === null) return null;
  const note = form.staffNote.trim();
  return {
    routeId: form.routeId,
    date: form.date,
    startTime: form.startTime,
    endTime: form.endTime,
    ...(note === '' ? {} : { staffNote: note }),
  };
}

// ---------------------------------------------------------------------------
// The recurring builder (S1.6, `domain-modeling.md §5.3`)
// ---------------------------------------------------------------------------

/**
 * THERE IS NO START DATE FIELD, and that is the whole shape of this form.
 *
 * `domain-modeling.md §5.3` (locked) names `endDate` as the only stop condition
 * and runs its loop over `[now, horizon]`; `data-model.md §5.2` has no
 * `start_date` column. A series begins when it is created. S1.6's "starting __"
 * is therefore a computed read-only display — see `firstOccurrence` — and a date
 * picker in its place would be a lie the next sweep would contradict.
 */
export interface PatternForm {
  /** Set when editing an existing repeating run (I24's pattern-level edit). */
  patternId: string | null;
  routeId: string | null;
  /** ISO weekdays, 1 = Monday … 7 = Sunday. */
  weekdays: number[];
  startTime: string | null;
  endTime: string | null;
  /** `YYYY-MM-DD` or null for open-ended. The only stop condition (§5.3). */
  endDate: string | null;
}

export const EMPTY_PATTERN: PatternForm = {
  patternId: null,
  routeId: null,
  weekdays: [],
  startTime: null,
  endTime: null,
  endDate: null,
};

export function toggleWeekday(weekdays: readonly number[], day: number): number[] {
  return weekdays.includes(day)
    ? weekdays.filter((existing) => existing !== day)
    : [...weekdays, day].sort((a, b) => a - b);
}

/** "Every Tuesday" / "Every Tuesday and Thursday" / "Every Monday, Wednesday and
 *  Friday" / "Every day". S1.6 asks for plain language, so the days are named
 *  rather than collapsed — `shared/src/coverage.ts`'s `weekdayLabel` collapses
 *  three or more because a claim TOAST cannot recite a list; a builder can. */
export function weekdaysSentence(weekdays: readonly number[]): string | null {
  const days = [...new Set(weekdays)].filter((day) => day >= 1 && day <= 7).sort((a, b) => a - b);
  if (days.length === 0) return null;
  if (days.length === 7) return 'Every day';
  const names = days.map((day) => WEEKDAY_NAMES[day - 1] ?? '');
  if (names.length === 1) return `Every ${names[0]}`;
  const last = names[names.length - 1];
  return `Every ${names.slice(0, -1).join(', ')} and ${last}`;
}

/**
 * The date the "starting __" display names: the FIRST occurrence this rule will
 * actually mint, computed from today and the chosen weekdays.
 *
 * Mirrors `services/recurrence.ts` exactly, including the part that is easy to
 * miss — materialization skips an occurrence whose window has already begun
 * (`window.startsAt >= now`), so a Tuesday rule created on a Tuesday afternoon
 * starts the *following* Tuesday, not today. `endDate` bounds the search: a rule
 * whose end date falls before its first occurrence mints nothing, and staff should
 * be told that before they save rather than after.
 *
 * Null when there is nothing to compute yet, or when the rule would mint nothing.
 */
export function firstOccurrence(
  weekdays: readonly number[],
  startTime: string | null,
  today: string,
  nowClock: string,
  endDate: string | null = null,
): string | null {
  const wanted = new Set(weekdays);
  if (wanted.size === 0) return null;

  for (let offset = 0; offset <= 7; offset += 1) {
    const iso = addDaysIso(today, offset);
    if (endDate !== null && compareIso(iso, endDate) > 0) return null;
    if (!wanted.has(isoWeekdayOf(iso))) continue;
    // Today counts only if the window has not already begun — the one filter in
    // `materializeIn` that changes which date this is.
    if (offset === 0 && startTime !== null && minutesOfTime(startTime) < minutesOfTime(nowClock)) {
      continue;
    }
    return iso;
  }
  return null;
}

/**
 * S1.6's sentence, verbatim in shape: "Every Tuesday, starting Aug 4, no end" or
 * an end date. Read-only — it describes what saving will do.
 */
export function patternSentence(
  form: PatternForm,
  today: string,
  nowClock: string,
): string | null {
  const days = weekdaysSentence(form.weekdays);
  if (days === null) return null;
  const first = firstOccurrence(form.weekdays, form.startTime, today, nowClock, form.endDate);
  if (first === null) {
    return `${days}, but the end date you picked is before the first run — pick a later one.`;
  }
  const ending =
    form.endDate === null ? 'no end' : `until ${formatShortDate(form.endDate, today)}`;
  return `${days}, starting ${formatShortDate(first, today)}, ${ending}.`;
}

export function validatePattern(form: PatternForm): string | null {
  if (form.routeId === null) return COPY.noRoute;
  if (form.weekdays.length === 0) return COPY.noWeekday;
  if (form.startTime === null || form.endTime === null) return COPY.noTimes;
  if (minutesOfTime(form.endTime) <= minutesOfTime(form.startTime)) return COPY.endBeforeStart;
  return null;
}

/** Create. No `startDate` field exists to send. */
export function buildPatternCreate(form: PatternForm): CreatePatternRequest | null {
  if (validatePattern(form) !== null) return null;
  if (form.routeId === null || form.startTime === null || form.endTime === null) return null;
  return {
    routeId: form.routeId,
    weekdays: form.weekdays,
    startTime: form.startTime,
    endTime: form.endTime,
    // `null` is meaningful on the wire: it clears an end date rather than leaving
    // it alone, which is the whole reason the edit below is a PATCH.
    endDate: form.endDate,
  };
}

/** I24's explicit pattern-level edit — the only thing that changes a pattern. */
export function buildPatternUpdate(form: PatternForm): UpdatePatternRequest | null {
  if (validatePattern(form) !== null) return null;
  if (form.routeId === null || form.startTime === null || form.endTime === null) return null;
  return {
    routeId: form.routeId,
    weekdays: form.weekdays,
    startTime: form.startTime,
    endTime: form.endTime,
    endDate: form.endDate,
  };
}

export function patternFormOf(pattern: RecurrencePatternSummary): PatternForm {
  return {
    patternId: pattern.id,
    routeId: pattern.routeId,
    weekdays: [...pattern.weekdays],
    startTime: pattern.startTime,
    endTime: pattern.endTime,
    endDate: pattern.endDate,
  };
}

/** One repeating run as one line: "Every Tuesday · 9:00 AM – 11:00 AM · no end". */
export function patternLine(pattern: RecurrencePatternSummary, today: string): string {
  const days = weekdaysSentence(pattern.weekdays) ?? '';
  const window = formatClockRange(pattern.startTime, pattern.endTime);
  const ending =
    pattern.endDate === null
      ? COPY.repeatNoEnd.toLowerCase()
      : `until ${formatShortDate(pattern.endDate, today)}`;
  return `${days} · ${window} · ${ending}`;
}

/** The bulk-terminate range. Staff-only, terminal, and NOT the driver's
 *  release-range: these runs are cancelled, not returned to the board. */
export interface TerminateRange {
  fromDate: string | null;
  toDate: string | null;
}

export function validateTerminate(range: TerminateRange): string | null {
  if (range.fromDate === null || range.toDate === null) return COPY.terminateNoRange;
  if (compareIso(range.fromDate, range.toDate) > 0) return COPY.terminateNoRange;
  return null;
}

/** Two taps make the range: the first sets both ends, the second extends whichever
 *  side it lands on, and a third starts over — so a mis-picked range is one tap from
 *  the right one rather than a hunt for a Clear button. The same two-tap rule S1.4
 *  uses for a time-away range, because staff and drivers should not learn two
 *  calendars. */
export function pickRangeDay(range: TerminateRange, iso: string): TerminateRange {
  if (range.fromDate === null || range.toDate === null) return { fromDate: iso, toDate: iso };
  if (range.fromDate === range.toDate) {
    return compareIso(iso, range.fromDate) < 0
      ? { fromDate: iso, toDate: range.toDate }
      : { fromDate: range.fromDate, toDate: iso };
  }
  return { fromDate: iso, toDate: iso };
}

// ---------------------------------------------------------------------------
// The route builder (S1.6, PRD cap 4)
// ---------------------------------------------------------------------------

/** One row of the builder. Carries the donor fields the list renders, so
 *  reordering does not need a second lookup. */
export interface StopDraft {
  donorId: string;
  donorName: string;
  donorAddress: string | null;
  /** False once the store is deactivated (I21). The stop is kept and flagged so
   *  staff can swap it out — it never silently vanishes from the route. */
  donorActive: boolean;
}

export interface RouteForm {
  /** Null while building a new route. */
  routeId: string | null;
  name: string;
  stops: StopDraft[];
}

export const EMPTY_ROUTE: RouteForm = { routeId: null, name: '', stops: [] };

export function routeFormOf(route: RouteDetail): RouteForm {
  return {
    routeId: route.id,
    name: route.name,
    stops: [...route.stops]
      .sort((a, b) => a.position - b.position)
      .map((stop: RouteStopSummary) => ({
        donorId: stop.donorId,
        donorName: stop.donorName,
        donorAddress: stop.donorAddress,
        donorActive: stop.donorActive,
      })),
  };
}

/**
 * Move one store one place up (-1) or down (+1).
 *
 * The keyboard half of the reorder — arrow keys on the drag handle. An
 * out-of-range move returns the list unchanged rather than wrapping, so holding
 * ArrowUp at the top does nothing rather than sending the first store to the end.
 */
export function moveStop(stops: readonly StopDraft[], index: number, delta: -1 | 1): StopDraft[] {
  const target = index + delta;
  if (index < 0 || index >= stops.length || target < 0 || target >= stops.length) {
    return [...stops];
  }
  const next = [...stops];
  const moved = next[index]!;
  next[index] = next[target]!;
  next[target] = moved;
  return next;
}

/** Drop `from` at `to`, closing the gap — the drag-and-drop half of the reorder.
 *  Same result as `moveStop` for adjacent positions, which is what keeps the two
 *  affordances honest about being one operation. */
export function moveStopTo(stops: readonly StopDraft[], from: number, to: number): StopDraft[] {
  if (from === to || from < 0 || from >= stops.length || to < 0 || to >= stops.length) {
    return [...stops];
  }
  const next = [...stops];
  const [moved] = next.splice(from, 1);
  if (!moved) return [...stops];
  next.splice(to, 0, moved);
  return next;
}

export function removeStop(stops: readonly StopDraft[], donorId: string): StopDraft[] {
  return stops.filter((stop) => stop.donorId !== donorId);
}

export function addStop(stops: readonly StopDraft[], donor: DonorSummary): StopDraft[] {
  if (stops.some((stop) => stop.donorId === donor.id)) return [...stops];
  return [
    ...stops,
    {
      donorId: donor.id,
      donorName: donor.name,
      donorAddress: donor.address,
      donorActive: donor.active,
    },
  ];
}

/** Stores not already on the route. Deactivated ones are not offered — I21 hides
 *  a soft-deleted record from NEW use while preserving it where it is referenced. */
export function addableDonors(
  donors: readonly DonorSummary[],
  stops: readonly StopDraft[],
): DonorSummary[] {
  const taken = new Set(stops.map((stop) => stop.donorId));
  return donors
    .filter((donor) => donor.active && !taken.has(donor.id))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function validateRoute(form: RouteForm): string | null {
  if (form.name.trim() === '') return COPY.routeNoName;
  // `domain-modeling.md §2.2`: a route has 1..N stops. The server refuses an
  // empty one too ("That route has no stores on it yet.").
  if (form.stops.length === 0) return COPY.routeNoStops;
  return null;
}

/** The ORDER of `stops` carries the ordering; the server assigns positions, so a
 *  client can never submit a sparse or colliding sequence. */
export function buildRouteCreate(form: RouteForm): CreateRouteRequest | null {
  if (validateRoute(form) !== null) return null;
  return { name: form.name.trim(), stops: form.stops.map((stop) => stop.donorId) };
}

/** A present `stops` REPLACES the whole ordered list — one save covers add,
 *  remove and reorder together. */
export function buildRouteUpdate(form: RouteForm): UpdateRouteRequest | null {
  if (validateRoute(form) !== null) return null;
  return { name: form.name.trim(), stops: form.stops.map((stop) => stop.donorId) };
}

/** Routes a run can be published on. An archived route is hidden from new use
 *  (I21) but kept wherever it is already referenced. */
export function schedulableRoutes(routes: readonly RouteDetail[]): RouteDetail[] {
  return routes
    .filter((route) => route.active && route.stops.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Runs list
// ---------------------------------------------------------------------------

export interface RunGroup {
  /** `YYYY-MM-DD`, pantry-local. */
  date: string;
  heading: string;
  runs: ShiftSummary[];
}

/** Grouped by the run's own calendar slot — `occurrenceDate`, which the server
 *  already resolved against `app_config.timezone` — and never by `startsAt`.
 *  Grouping by the instant would file an evening run under the next day for
 *  anyone east of the pantry. */
export function groupRunsByDay(runs: readonly ShiftSummary[], today: string): RunGroup[] {
  const byDate = new Map<string, ShiftSummary[]>();
  for (const run of runs) {
    const existing = byDate.get(run.occurrenceDate);
    if (existing) existing.push(run);
    else byDate.set(run.occurrenceDate, [run]);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => compareIso(a, b))
    .map(([date, group]) => ({
      date,
      heading: dayHeading(date, today),
      runs: group.sort(
        (a, b) => a.startsAt.localeCompare(b.startsAt) || a.routeName.localeCompare(b.routeName),
      ),
    }));
}

/**
 * Whether opening this run has to ask "just this date, or the weekly pattern?".
 *
 * PRD cap 4: editing a single recurring instance must not break the pattern. The
 * question is what keeps the two apart, and I23/I24 are what make the answer
 * meaningful — a per-run edit never reaches the pattern, and only the explicit
 * pattern edit changes it.
 */
export function needsEditScope(run: ShiftSummary): boolean {
  return run.recurrencePatternId !== null;
}

/** Mirrors `assignDriver`'s own gate: a run under way cannot change hands
 *  wholesale, and CANCELLED/COMPLETED are terminal (I10). Communication only. */
export function canSetDriver(run: ShiftSummary): boolean {
  return run.status === 'OPEN' || run.status === 'CLAIMED';
}

/** I9/I10 — a run that has started cannot be cancelled, and a cancelled one is
 *  terminal. The server's predicate is the enforcement; this hides a button that
 *  would be refused (§3 prefers hiding over disabling). */
export function canCancelRun(run: ShiftSummary): boolean {
  return run.status === 'OPEN' || run.status === 'CLAIMED';
}

/** Cap 9's reschedule: "Only a run that has not started can be moved." */
export function canMoveRun(run: ShiftSummary): boolean {
  return run.status === 'OPEN' || run.status === 'CLAIMED';
}

/** The soft duplicate-run check (`data-model.md §5.3`). A warning shown to the
 *  staff member standing there, never a refusal — the run was published. */
export function duplicateNotice(duplicates: readonly DuplicateRunWarning[]): string | null {
  return duplicates.length === 0 ? null : COPY.duplicate(duplicates.length);
}

// ---------------------------------------------------------------------------
// Assign (PRD cap 6's fallback path, I20's staff-assign exemption)
// ---------------------------------------------------------------------------

/**
 * Reasons Staff may confirm THROUGH. Mirrors `CONFIRMABLE_REASONS` in
 * `services/coverage.ts`, which is where the rule is enforced: I20's exemption
 * covers the temporal half of `eligible()` — the driver is away, or already has a
 * run then — and nothing else. Missing the Drive duty (I2) or a deactivated
 * account (I21) stay hard refusals for Staff as much as for self-select.
 */
const CONFIRMABLE_REASONS: readonly EligibilityReason[] = [
  'AVAILABILITY_BLOCK',
  'OWNED_SHIFT_OVERLAP',
];

/** True when nothing staff can confirm would get this assignment through, so the
 *  screen states the reason and offers no confirm. The server refuses it again
 *  with `DRIVER_UNAVAILABLE`. */
export function assignIsBlocked(reasons: readonly EligibilityReason[]): boolean {
  return reasons.some((reason) => !CONFIRMABLE_REASONS.includes(reason));
}

/** Drivers staff may pick from: the Drive duty is SET MEMBERSHIP (I2), never
 *  implied by a tier, and a deactivated account is hidden from new use (I21). */
export function driverChoices(users: readonly ShapedUser[]): ShapedUser[] {
  return users
    .filter((user) => user.active && hasDuty(user.duties, 'DRIVE'))
    .sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`));
}

export function fullName(user: Pick<ShapedUser, 'firstName' | 'lastName'>): string {
  return `${user.firstName} ${user.lastName}`.trim();
}

// ---------------------------------------------------------------------------
// Failures
// ---------------------------------------------------------------------------

/**
 * What to show when a save is refused.
 *
 * The server has already written the sentence for every refusal that matters here
 * — the archived route, the route with no stores, the run that has already
 * started, I20's assign warning — so it is rendered verbatim rather than
 * re-derived from a copy of the rule that could drift out of step with it.
 */
export function failureMessage(error: unknown): string {
  const apiError = toApiError(error);
  return apiError.detail ?? apiError.message;
}
