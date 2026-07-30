// S1.7's rules as pure functions — the calendar, the wall clock, the form that
// moves a run, and every sentence the screen renders.
//
// Split out from the components because there is no jsdom and no component
// renderer in this repo, and adding one would be a dependency (build-plan §3/D5).
// What lives here is what a wrong answer would silently break.
//
// TIME FRAMES, AND THE DIRECTION EACH CONVERSION RUNS. This is the whole risk on
// this screen: it is the one screen that *enters* a run time, so a picker that
// writes the device's 9am writes the wrong instant for a pantry in another zone.
//
//   * `YYYY-MM-DD` + `HH:MM` — pantry-local calendar date and wall clock. This is
//     the frame staff schedule in and the ONLY frame that goes out on the wire
//     (`shared/src/schedule.ts`: "The client never converts"). `POST
//     /shifts/:id/reschedule` takes exactly these three strings and resolves them
//     against `app_config.timezone` itself.
//   * ISO-8601 instants — what `shift.starts_at` / `ends_at` hold and what comes
//     back on `GET /shifts/:id`. Read into the form the other way: instant →
//     pantry-local `HH:MM`, formatted against `useSession().timezone` (A120) and
//     never against the device's zone.
//
// So: instants come IN and are converted once, to prefill; nothing goes OUT but
// text. `occurrenceDate` is already the pantry-local calendar slot and is used
// verbatim — converting it would be the day-drift bug `shared/src/schedule.ts`
// names.
//
// Client-side checks below are COMMUNICATION ONLY (`CLAUDE.md`): the service
// re-runs every one of them inside the transaction, and none of them relaxes
// anything. Where the server owns the answer — which conflicts the owner has, and
// the sentence naming them — this file does not guess; it renders what the server
// sent.

import { toApiError } from '../../../api/index.ts';
import type { RescheduleShiftRequest, ShiftStatus, ShiftSummary } from '../../../api/shared.ts';

// ---------------------------------------------------------------------------
// Copy (`ui-ux-spec.md S1.7`, §6, §7)
//
// Collected in one object so the forbidden-word check in `reschedule.test.ts` can
// read every user-visible sentence this screen owns. §7 forbids: PWA, push
// subscription, session, payload, endpoint, atomic, instance — so the word here is
// always "run", never "shift" or "instance".
//
// The conflict warning is NOT here. It is the server's own sentence, built by
// `rescheduleConflictMessage()` in `shared/src/schedule.ts` and delivered on the
// 409, so that the two halves cannot word S1.7's specified copy differently.
// ---------------------------------------------------------------------------

export const COPY = {
  /** The screen. §7: plain, short, second person — "move", not "reschedule". */
  header: 'Move this run',
  /** S1.7's primary action, verbatim. */
  confirm: 'Confirm new time',
  cancel: 'Back to the run',

  nowHeading: 'Right now',
  newHeading: 'Move it to',
  dateLabel: 'Which day',
  startLabel: 'From',
  endLabel: 'Until',
  unowned: 'OPEN',

  /** S1.7: "Owner kept by default." Said out loud, because the default is the
   *  thing a coordinator would otherwise have to assume. */
  ownerKept: (owner: string) => `${owner} keeps this run.`,
  noOwner: 'No driver has taken this run yet.',

  dayHint: 'Pick the new day.',
  timeHint: "The pantry's clock, not your own.",

  endBeforeStart: 'The end time has to be later in the day than the start time.',
  unchanged: 'Pick a different day or time first.',

  /** After the move. Two outcomes, and they are not the same event. */
  movedKept: (owner: string) => `Moved. ${owner} still has this run.`,
  movedUnowned: 'Moved.',
  movedReleased: (owner: string) => `Moved. ${owner} is off this run and it is open again.`,

  /**
   * The confirm that releases the owner (§6: "Cancel is the calm default; the
   * destructive button is red", §7: question + consequence).
   *
   * The consequence sentence itself comes from the server. The line below only adds
   * S1.7's last clause — "System never auto-picks a replacement" — which the spec
   * states as a rule and gives no copy for: a coordinator who is not told this will
   * assume someone was found.
   */
  releaseQuestion: 'Move it anyway?',
  releaseNoReplacement:
    'Nobody is picked to take over — it goes back on the board as open for a driver to claim.',
  /** "Release" is the word S1.3 already uses for a run going back to the board, so
   *  the button says what happens rather than merely agreeing. */
  releaseConfirm: 'Move it and release the run',

  /** Runs that cannot be moved at all. The server refuses each of these with a 409;
   *  these are the same refusal said before the trip (§3 prefers hiding an action
   *  over offering one that will be turned down). */
  startedTitle: 'This run has already started.',
  startedBody:
    "A run on the road can't be moved. Its stops can be handed to another driver instead.",
  cancelledTitle: 'This run was cancelled.',
  cancelledBody: 'Cancelled runs stay cancelled. Publish a new run for the day you want.',
  finishedTitle: 'This run is finished.',
  finishedBody: 'There is nothing left to move.',
} as const;

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

/** Short weekday headers for the day picker, Sunday first (US pantry). */
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
  const mm = String(date.month).padStart(2, '0');
  const dd = String(date.day).padStart(2, '0');
  return `${date.year}-${mm}-${dd}`;
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

/** Day-of-week index, 0 = Sunday. Calendar arithmetic only — no zone involved. */
function weekdayIndex(date: CalendarDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

/** "Tuesday, August 11". The heading a coordinator reads back before confirming,
 *  spelled out rather than abbreviated because this is the fact they are changing. */
export function formatDayLabel(iso: string): string {
  const date = parseIsoDate(iso);
  if (!date) return iso;
  const weekday = WEEKDAY_NAMES[weekdayIndex(date)] ?? '';
  const month = MONTH_NAMES[date.month - 1] ?? '';
  return `${weekday}, ${month} ${date.day}`;
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
  const first: CalendarDate = { year, month, day: 1 };
  const start = addDaysIso(isoOf(first), -weekdayIndex(first));

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

/** The month a `YYYY-MM-DD` sits in, for the picker's opening view. */
export function monthOf(iso: string): { year: number; month: number } {
  const date = parseIsoDate(iso);
  return date === null ? { year: 1970, month: 1 } : { year: date.year, month: date.month };
}

// ---------------------------------------------------------------------------
// The pantry's zone — every conversion on this screen, in one place
// ---------------------------------------------------------------------------

/**
 * An instant as the calendar day it falls on in a given zone.
 *
 * Assembled from `formatToParts` rather than a locale pattern, so no locale's date
 * order can turn `YYYY-MM-DD` into something else.
 */
function dateInZone(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const find = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${find('year')}-${find('month')}-${find('day')}`;
}

/**
 * Today, as the PANTRY's calendar reads it (A120).
 *
 * Not the device's date. A coordinator working late from a laptop one zone east of
 * the pantry would otherwise be offered a "today" the pantry has not reached, and
 * refused the day it is actually standing in.
 */
export function todayInZone(now: Date, timeZone: string): string {
  return dateInZone(now, timeZone);
}

/**
 * An ISO instant as a pantry-local `HH:MM` (A120) — the one instant→local
 * conversion this screen makes, and the value the form is prefilled from.
 *
 * 24-hour internally so it sorts and compares as text; `formatTimeLabel` is what a
 * human reads. Midnight is normalised to `00:00`, because a `hour12: false`
 * formatter can resolve to the h24 cycle and answer `24:00` for it, which is not a
 * `HH:MM` the server accepts.
 */
export function localTimeOf(iso: string, timeZone: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at);
  const find = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const hour = find('hour') === '24' ? '00' : find('hour').padStart(2, '0');
  return `${hour}:${find('minute').padStart(2, '0')}`;
}

/** The pantry-local calendar day an instant falls on. Only used to notice that a
 *  stored window crosses pantry midnight (see `currentWindow`). */
export function localDateOf(iso: string, timeZone: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return dateInZone(at, timeZone);
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

/** "9:00 AM – 11:00 AM", in the PANTRY's zone (A120). */
export function formatWindow(startsAt: string, endsAt: string, timeZone: string): string {
  return `${formatTimeLabel(localTimeOf(startsAt, timeZone))} – ${formatTimeLabel(localTimeOf(endsAt, timeZone))}`;
}

/** "Tuesday, August 11 · 9:00 AM – 11:00 AM". The date is `occurrenceDate`, the
 *  pantry-local slot the server already resolved, so it cannot drift a day against
 *  the board. */
export function formatWhen(run: ShiftSummary, timeZone: string): string {
  return `${formatDayLabel(run.occurrenceDate)} · ${formatWindow(run.startsAt, run.endsAt, timeZone)}`;
}

// ---------------------------------------------------------------------------
// Wall clock options
// ---------------------------------------------------------------------------

/**
 * Half-hour steps, 5:00am to 10:00pm — the hours a food-rescue run can fall in. A
 * finer grid is a fragile control (§1.5) and a coarser one cannot express a 9:30
 * run.
 *
 * `include` adds times the grid does not carry, which is what lets a run already
 * standing at 9:15 be moved to another day WITHOUT its own time silently becoming
 * unselectable — and therefore without the form quietly changing a window the
 * coordinator never touched.
 */
export function timeOptions(include: readonly string[] = []): string[] {
  const minutes = new Set<number>();
  for (let step = 5 * 60; step <= 22 * 60; step += 30) minutes.add(step);
  for (const time of include) {
    const parsed = minutesOfTime(time);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 24 * 60) minutes.add(parsed);
  }
  return [...minutes]
    .sort((a, b) => a - b)
    .map((total) => {
      const hh = String(Math.floor(total / 60)).padStart(2, '0');
      const mm = String(total % 60).padStart(2, '0');
      return `${hh}:${mm}`;
    });
}

// ---------------------------------------------------------------------------
// Which runs can be moved at all
// ---------------------------------------------------------------------------

export interface MoveRefusal {
  title: string;
  body: string;
}

/**
 * Why this run cannot be moved, or null.
 *
 * `services/schedule.ts` allows `OPEN` and `CLAIMED` only: a started run has a
 * truck, a stop snapshot and a driver mid-route (I5/I8), and a `CANCELLED` one is
 * terminal (I10). This says the same thing before the request rather than after it.
 *
 * `COMPLETED` is unreachable in Phase 1 — the receiver's receive-done is the only
 * completion action and ships in Phase 2 (build-plan D1, I11). It is answered here
 * anyway so the branch is total, and it is expected to stay unexercised.
 */
export function moveRefusal(status: ShiftStatus): MoveRefusal | null {
  switch (status) {
    case 'OPEN':
    case 'CLAIMED':
      return null;
    case 'IN_PROGRESS':
      return { title: COPY.startedTitle, body: COPY.startedBody };
    case 'CANCELLED':
      return { title: COPY.cancelledTitle, body: COPY.cancelledBody };
    case 'COMPLETED':
      return { title: COPY.finishedTitle, body: COPY.finishedBody };
  }
}

// ---------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------

export interface MoveForm {
  /** `YYYY-MM-DD`, pantry-local. Goes out on the wire exactly as it stands. */
  date: string;
  /** `HH:MM`, pantry-local wall clock. Also verbatim. */
  startTime: string;
  endTime: string;
}

/**
 * The run's window as the form's starting point.
 *
 * S1.7 is "move date/time", not "set date/time": the coordinator is changing one of
 * three values, so the other two have to already be right. `occurrenceDate` is
 * used as-is (already pantry-local); the two times are converted from their
 * instants against the PANTRY's zone.
 *
 * A window whose end lands on the next pantry day cannot be expressed by this form
 * — the server builds both instants from one `date` (`resolveWindow`) — so the end
 * is clamped to the last minute of the day and the coordinator picks a real one.
 * `resolveWindow` refuses `endTime <= startTime`, so nothing wrong can be sent
 * silently.
 */
export function currentWindow(run: ShiftSummary, timeZone: string): MoveForm {
  const startTime = localTimeOf(run.startsAt, timeZone);
  const endTime = localTimeOf(run.endsAt, timeZone);
  const sameDay = localDateOf(run.startsAt, timeZone) === localDateOf(run.endsAt, timeZone);
  return {
    date: run.occurrenceDate,
    startTime,
    endTime: sameDay && minutesOfTime(endTime) > minutesOfTime(startTime) ? endTime : '23:59',
  };
}

export function sameWindow(a: MoveForm, b: MoveForm): boolean {
  return a.date === b.date && a.startTime === b.startTime && a.endTime === b.endTime;
}

/**
 * Picking a start that is at or past the current end drags the end along, to the
 * first offered time later than the new start.
 *
 * Not a validation — `resolveWindow` refuses `endTime <= startTime` and would say so.
 * It is the §3 preference for not leaving a control holding a value the screen has
 * already stopped offering: the "Until" grid only lists times later than the start,
 * so an end left behind would show as nothing selected at all.
 */
export function withStartTime(form: MoveForm, startTime: string): MoveForm {
  if (minutesOfTime(form.endTime) > minutesOfTime(startTime)) return { ...form, startTime };
  const later = timeOptions([startTime, form.endTime]).find(
    (time) => minutesOfTime(time) > minutesOfTime(startTime),
  );
  return { ...form, startTime, endTime: later ?? form.endTime };
}

/**
 * Which days the picker offers.
 *
 * Today forward in the PANTRY's zone, plus the run's own current day so a run that
 * has slipped into the past still shows where it stands. The server accepts a past
 * date and this does not pretend otherwise — it is a courtesy, since a run in a day
 * that has gone cannot be filled either way (see the report's `Assumed:`).
 */
export function isDayOffered(iso: string, today: string, currentDate: string): boolean {
  return iso === currentDate || compareIso(iso, today) >= 0;
}

/**
 * What is wrong with the form, in the coordinator's words, or null.
 *
 * Communication only. `resolveWindow` re-checks the end-after-start rule inside the
 * transaction and answers 400 with its own sentence; the "nothing changed" line has
 * no server counterpart because moving a run onto its own window is legal, merely
 * pointless.
 */
export function validateMove(form: MoveForm, current: MoveForm): string | null {
  if (minutesOfTime(form.endTime) <= minutesOfTime(form.startTime)) return COPY.endBeforeStart;
  if (sameWindow(form, current)) return COPY.unchanged;
  return null;
}

/**
 * The request body. Three strings and a flag — no instants, ever.
 *
 * `confirmRelease` is the second half of cap 9's two-step flow: left off, the
 * service refuses a move onto a window the owner cannot work and attaches the
 * conflicts; set, it moves the run AND releases the owner
 * (`services/schedule.ts`).
 */
export function buildRequest(form: MoveForm, confirmRelease: boolean): RescheduleShiftRequest {
  return {
    date: form.date,
    startTime: form.startTime,
    endTime: form.endTime,
    ...(confirmRelease ? { confirmRelease: true } : {}),
  };
}

/** The read-back above the primary action (§7: say the consequence). S1.7's "owner
 *  kept by default" is a promise, so the screen states it rather than leaving the
 *  coordinator to assume either way. */
export function moveSummary(form: MoveForm, run: ShiftSummary): string {
  const when = `${formatDayLabel(form.date)} · ${formatTimeLabel(form.startTime)} – ${formatTimeLabel(form.endTime)}`;
  const owner = run.ownerName;
  return `${when}. ${owner === null ? COPY.noOwner : COPY.ownerKept(owner)}`;
}

/** The toast after a move that went through. Three outcomes, because "the owner was
 *  released" is a different event from "the owner came along". */
export function movedMessage(run: ShiftSummary, released: boolean): string {
  const owner = run.ownerName;
  if (owner === null) return COPY.movedUnowned;
  return released ? COPY.movedReleased(owner) : COPY.movedKept(owner);
}

// ---------------------------------------------------------------------------
// Failures
// ---------------------------------------------------------------------------

/**
 * The pre-confirm conflict, and how it arrives.
 *
 * There is no dry-run read for a PROPOSED window: `GET /shifts/:id/eligibility`
 * evaluates a driver against the shift's currently STORED window, which is the
 * window the owner already works, so it cannot answer S1.7's question (see the
 * report's `Assumed:`). The unconfirmed `POST /shifts/:id/reschedule` is the check
 * — its transaction rolls back on the 409, so nothing has moved when the warning
 * appears, and only the second, explicitly-labelled press releases anybody.
 */
export function isReleaseConflict(error: unknown): boolean {
  return toApiError(error).code === 'RESCHEDULE_CONFLICT';
}

/**
 * Whether a refusal means the RUN changed rather than the request being wrong.
 *
 * "Only a run that has not started can be moved.", "That run just changed. Reload and
 * try again." and a 404 all describe a row that no longer matches what is on screen,
 * so the screen re-reads it. A 400 from `resolveWindow` describes the form instead —
 * re-reading then would throw away nothing and fetch for no reason.
 */
export function runMayHaveChanged(error: unknown): boolean {
  const kind = toApiError(error).kind;
  return kind === 'conflict' || kind === 'not-found';
}

/**
 * What to show when a move is refused.
 *
 * S1.7 fixes the conflict wording, and `rescheduleConflictMessage()` in
 * `shared/src/schedule.ts` is where it is written — once, for both halves. So this
 * renders the server's sentence rather than re-deriving it from a second copy of a
 * rule that could drift out of step.
 */
export function failureMessage(error: unknown): string {
  const apiError = toApiError(error);
  return apiError.detail ?? apiError.message;
}
