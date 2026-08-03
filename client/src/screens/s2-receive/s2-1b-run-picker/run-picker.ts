// S2.1b — everything about the run picker that is a RULE rather than a pixel.
//
// Split out from `RunPickerScreen.tsx` so it can be tested without a browser:
// there is no jsdom and no component renderer in this repo, and adding one would
// be a dependency (build-plan §3/D5). What lives here is what a wrong answer would
// silently break — the order of the list, the "N of M done" count, which stop a tap
// opens, which runs offer **Receive done** instead, the status-dot mapping, the
// three list states, and every sentence of copy.
//
// Nothing here decides anything. `architecture.md §4.5`: the client repeats the
// server's rules so a receiver is not offered an action that would be refused, and
// the server checks each of them again on the request that matters.
//
// ---------------------------------------------------------------------------
// THE DATE RULE, which is the one thing this file exists to get right
// ---------------------------------------------------------------------------
//
// Every date on this screen comes from `run.occurrenceDate` — the pantry-local
// `YYYY-MM-DD` slot the server already resolved — and NEVER from the device's
// clock. S2.1b states the reason: a Tuesday-night run finally received at 12:30am
// Wednesday is still bucketed to Tuesday by the report (`data-model.md §8`,
// `report_day = shift.occurrence_date`), so showing the shift's own date is what
// makes what the receiver sees agree with what the report will show.
//
// `app/pantry-day.ts` is used for ONE thing and one only: which band a run falls
// into (`D38`). It answers "what is today for the pantry", which is a different
// question from "when is this run" — the rule S2.1b states is that no LABEL may be
// relative. So every date the receiver reads is still the run's own
// `occurrenceDate`, spelled out ("Tuesday, April 21"), and the pantry's today is
// never printed, only compared against. A band heading names what the group is
// ("Still to weigh"), never when it is, so nothing on this screen states a fact
// about a clock.
//
// It is `todayInZone(timezone)` and never `new Date()`: the device's date is simply
// the wrong calendar near midnight, which is the case S2.1b was written for — a
// Tuesday run received at 12:30am Wednesday must not fall out of the band the
// receiver is working. The fetch still sends no date bound at all (A162).

import { RECEIVE_RESOLVED_STATES } from '../../../api/shared.ts';
import type {
  ReceiveRunSummary,
  ReceiveStopState,
  ReceiveStopSummary,
} from '../../../api/shared.ts';
import type { RouteParams, ScreenId } from '../../../app/index.ts';

// ---------------------------------------------------------------------------
// Copy (`ui-ux-spec.md` S2.1b, §6, §7)
//
// Collected in one object so the forbidden-word check in `run-picker.test.ts` can
// read every user-visible sentence the screen owns.
// ---------------------------------------------------------------------------

/** Forbidden in any UI string (`ui-ux-spec.md §7`). Pinned by a test rather than
 *  by good intentions. "instance" is the one this screen would reach for by
 *  accident — the user's word for one occurrence of a repeating run is "run". */
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
  /** S2.1b, verbatim. */
  header: 'Which run are you receiving?',

  /** §6: empty states are instructive — "say what to do next, not just nothing
   *  here". A run appears here when its driver starts it, so the honest next step
   *  is either "wait" or "this arrived on its own", and both are named. */
  emptyTitle: 'No runs to weigh right now.',
  emptyBody:
    'A run shows up here once its driver starts it. If food arrived on its own, use Unscheduled donation below.',

  /** The card's own line. `N of M done` is S2.1b's wording. */
  doneCount: (done: number, total: number) => `${done} of ${total} done`,
  /** A run whose route has no stops on it. It can never be finished from here —
   *  the completion gate needs at least one resolved stop (I12) — so the row says
   *  so instead of offering a tap that goes nowhere. */
  noStops: 'No stops on this run yet.',

  /** The stop-status dots. Three are S2.1b's own (pending / weighed / skipped);
   *  "moved" is the fourth stored disposition, which is resolved but is neither of
   *  the other two (I30). */
  statePending: 'pending',
  stateWeighed: 'weighed',
  stateSkipped: 'skipped',
  stateMoved: 'moved',

  /** What the tap does, said on the card so it is not a guess. */
  nextStop: (donorName: string) => `Next: ${donorName}`,
  /** S2.2b's name, verbatim — the same words on the button that leads there. */
  receiveDone: 'Receive done',
  receiveDoneHint: 'All stops done',

  /** S2.1b: "[ Unscheduled donation ] (goes to S2.3, no run needed)". */
  unscheduled: 'Unscheduled donation',

  /** `D38`'s three bands.
   *
   *  Each heading names what the group IS, never when it is. "Ready to finish" is
   *  not "finished": those runs have every stop resolved and are still waiting on
   *  the one tap that closes them (I11), and a heading reading "Finished" would
   *  say a thing about the run that is not yet true. */
  bandExpected: 'Still to weigh',
  bandFinished: 'Ready to finish',
  bandLater: 'Later this week',
  /** The disclosure's own label. The count is on it because a closed disclosure
   *  with nothing on the outside is a thing nobody opens. */
  bandLaterCount: (count: number) => `Later this week (${count})`,

  /** Read out when a screen reader reaches the row, which it hears without the
   *  surrounding card. */
  runAria: (label: string, when: string, count: string, action: string) =>
    `${label}. ${when}. ${count}. ${action}`,

  loading: 'Loading runs',
  /** The list's own name, for a screen reader counting rows. */
  listLabel: 'Runs waiting to be weighed',
} as const;

// ---------------------------------------------------------------------------
// Stops
// ---------------------------------------------------------------------------

/** The visual tone of one status dot. S2.1b names three; `moved` is the fourth,
 *  because `REASSIGNED` counts as resolved (I12) but is neither weighed nor
 *  skipped, and drawing it as either would state something untrue. */
export type StopTone = 'pending' | 'weighed' | 'skipped' | 'moved';

/**
 * `ReceiveStopState` → dot.
 *
 * `COLLECTED` shares the pending dot with `PENDING`: the driver picked the food up
 * but nobody has weighed it, so it still blocks receive-done (I12 admits only
 * `{WEIGHED, SKIPPED, REASSIGNED}`). To the receiver those two are one thing — work
 * still to do — and S2.1b draws exactly one "pending" dot.
 */
export function stopTone(state: ReceiveStopState): StopTone {
  switch (state) {
    case 'WEIGHED':
      return 'weighed';
    case 'SKIPPED':
      return 'skipped';
    case 'REASSIGNED':
      return 'moved';
    default:
      return 'pending';
  }
}

/** The word beside the dot. Colour is never the only carrier (§1: big and clear,
 *  and a dot alone fails anyone who cannot separate the two). */
export function stopStateLabel(state: ReceiveStopState): string {
  switch (stopTone(state)) {
    case 'weighed':
      return COPY.stateWeighed;
    case 'skipped':
      return COPY.stateSkipped;
    case 'moved':
      return COPY.stateMoved;
    default:
      return COPY.statePending;
  }
}

/** I12's resolved set, read off `shared/src/receive.ts` rather than restated —
 *  a second copy of the list is a second thing to keep in step. */
export function isResolved(state: ReceiveStopState): boolean {
  return RECEIVE_RESOLVED_STATES.includes(state);
}

/** Stops in the order the driver drives them. `position` is the server's ordering
 *  and the only one that means anything to a receiver holding the sheet. */
export function orderStops(stops: readonly ReceiveStopSummary[]): ReceiveStopSummary[] {
  return [...stops].sort(
    (a, b) => a.position - b.position || a.donorName.localeCompare(b.donorName),
  );
}

/** The stop a tap opens: the FIRST unresolved one, in route order (S2.1b). */
export function firstUnresolvedStop(
  stops: readonly ReceiveStopSummary[],
): ReceiveStopSummary | null {
  return orderStops(stops).find((stop) => !isResolved(stop.state)) ?? null;
}

// ---------------------------------------------------------------------------
// Calendar slots and clock times
//
// The date is parsed from its parts, never with `new Date('2026-04-23')`, which
// reads a bare date as UTC midnight and lands on the previous day for anyone west
// of Greenwich — the same mistake the date rule above exists to prevent, arriving
// through the back door.
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

const WEEKDAYS_LONG = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** `YYYY-MM-DD` → a local `Date` at midnight, or null if it is not a date. */
function parseCalendarDate(date: string): Date | null {
  const parts = date.split('-');
  if (parts.length !== 3) return null;
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const parsed = new Date(year, month - 1, day);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** "Tue" — the abbreviation S2.1b's run label is built from ("Karen's Tue AM run"). */
export function weekdayShort(occurrenceDate: string): string {
  const parsed = parseCalendarDate(occurrenceDate);
  return parsed ? (WEEKDAYS_SHORT[parsed.getDay()] ?? '') : '';
}

/** "Tuesday, April 23". Spelled out, and never replaced by "Today": the heading
 *  states the RUN's day, not the device's (see the date rule at the top). */
export function calendarDateLabel(occurrenceDate: string): string {
  const parsed = parseCalendarDate(occurrenceDate);
  if (!parsed) return occurrenceDate;
  const weekday = WEEKDAYS_LONG[parsed.getDay()] ?? '';
  const month = MONTHS[parsed.getMonth()] ?? '';
  return `${weekday}, ${month} ${parsed.getDate()}`;
}

/** "9:00 AM" in the PANTRY's zone (A120), which the sign-in carries. A run's window
 *  is a pantry-local fact — the 9am run is 9am at the pantry, not on whatever
 *  device is reading it. With no zone the device's own is used, which is right only
 *  for the moment before the pantry's has arrived. */
export function clockTime(instant: string, timeZone?: string | null): string {
  const at = new Date(instant);
  if (Number.isNaN(at.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  }).format(at);
}

/** "AM" / "PM" for the run label, read out of the pantry-zone clock rather than
 *  guessed from the ISO string's hour, which is UTC. */
export function meridiem(instant: string, timeZone?: string | null): string {
  const at = new Date(instant);
  if (Number.isNaN(at.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    hour12: true,
    ...(timeZone ? { timeZone } : {}),
  }).formatToParts(at);
  const period = parts.find((part) => part.type === 'dayPeriod')?.value ?? '';
  return period.replace(/\./g, '').toUpperCase();
}

// ---------------------------------------------------------------------------
// One run, as a card
// ---------------------------------------------------------------------------

/**
 * "Karen's Tue AM run" — S2.1b's own name for a run, and the same name S2.2 puts
 * in its header, so the receiver sees one label from tap to sheet.
 *
 * The weekday comes from `occurrenceDate` (a business day) and the AM/PM from
 * `startsAt` (an instant) because those are the two different things they are.
 * An unowned run drops the possessive rather than inventing an owner; `routeName`
 * still identifies it on the line below.
 */
export function runLabel(run: ReceiveRunSummary, timeZone?: string | null): string {
  const day = weekdayShort(run.occurrenceDate);
  const half = meridiem(run.startsAt, timeZone);
  const tail = [day, half, 'run'].filter((part) => part !== '').join(' ');
  // "Chris's", not "Chris'" — one rule, so no name is spelled two ways depending
  // on its last letter.
  return run.ownerName ? `${run.ownerName}'s ${tail}` : tail;
}

/** "Riverside · Tuesday, April 23 · 9:00 AM – 11:00 AM". Route, then the run's own
 *  date, then its window. */
export function runSubtitle(run: ReceiveRunSummary, timeZone?: string | null): string {
  const window = `${clockTime(run.startsAt, timeZone)} – ${clockTime(run.endsAt, timeZone)}`;
  return [run.routeName, calendarDateLabel(run.occurrenceDate), window]
    .filter((part) => part.trim() !== '' && part.trim() !== '–')
    .join(' · ');
}

/** S2.1b: "an 'N of M done' count". */
export function doneLabel(run: ReceiveRunSummary): string {
  return COPY.doneCount(run.doneCount, run.totalCount);
}

/**
 * What tapping the card does.
 *
 *   - `RECEIVE_DONE` once the server says the run is ready. `readyForReceiveDone`
 *     is the server's own reading of the completion gate (I12) and is taken at its
 *     word — recomputing it here would be a second implementation of the gate, and
 *     the two would eventually disagree.
 *   - `WEIGH` while any stop is unresolved.
 *   - `NONE` for a run with no stops at all: it can be neither weighed nor closed,
 *     so the card offers no target rather than a tap that leads nowhere.
 */
export type RunAction = 'WEIGH' | 'RECEIVE_DONE' | 'NONE';

export function runAction(run: ReceiveRunSummary): RunAction {
  if (run.readyForReceiveDone) return 'RECEIVE_DONE';
  return firstUnresolvedStop(run.stops) ? 'WEIGH' : 'NONE';
}

/** Where a tap goes, as a screen id plus its params. Kept as data rather than as a
 *  path so the URL stays one edit in `app/routes.ts`; the screen turns it into a
 *  path with `buildPath`. */
export interface RunTarget {
  screen: ScreenId;
  params: RouteParams;
}

export function runTarget(run: ReceiveRunSummary): RunTarget | null {
  if (run.readyForReceiveDone) {
    return { screen: 'receive-done', params: { shiftId: run.shiftId } };
  }
  const next = firstUnresolvedStop(run.stops);
  return next
    ? { screen: 'receive-stop', params: { shiftId: run.shiftId, stopId: next.id } }
    : null;
}

/**
 * The same answer from a freshly re-read stop list (`fetchRunStops`).
 *
 * Used on the tap, when another receiver may have resolved the stop this card was
 * pointing at (S2.1b: they work the same run in parallel). There is no
 * `readyForReceiveDone` in that response, so readiness is I12's own definition —
 * every stop resolved, and at least one stop to resolve.
 */
export function targetForStops(
  shiftId: string,
  stops: readonly ReceiveStopSummary[],
): RunTarget | null {
  const next = firstUnresolvedStop(stops);
  if (next) return { screen: 'receive-stop', params: { shiftId, stopId: next.id } };
  return stops.length > 0 ? { screen: 'receive-done', params: { shiftId } } : null;
}

export interface StopDotView {
  id: string;
  donorName: string;
  tone: StopTone;
  /** The word beside the dot, so colour is never the only signal. */
  label: string;
}

export interface RunCardView {
  run: ReceiveRunSummary;
  /** "Karen's Tue AM run". */
  label: string;
  /** "Riverside · Tuesday, April 23 · 9:00 AM – 11:00 AM". */
  subtitle: string;
  stops: StopDotView[];
  /** "2 of 3 done", or the no-stops sentence. */
  count: string;
  action: RunAction;
  /** What the tap does, in words: "Next: Kroger" / "Receive done". */
  actionLabel: string;
  target: RunTarget | null;
  ariaLabel: string;
}

export function toCard(run: ReceiveRunSummary, timeZone?: string | null): RunCardView {
  const action = runAction(run);
  const next = firstUnresolvedStop(run.stops);
  const label = runLabel(run, timeZone);
  const subtitle = runSubtitle(run, timeZone);
  const count = run.totalCount === 0 ? COPY.noStops : doneLabel(run);
  const actionLabel =
    action === 'RECEIVE_DONE'
      ? COPY.receiveDone
      : action === 'WEIGH' && next
        ? COPY.nextStop(next.donorName)
        : '';

  return {
    run,
    label,
    subtitle,
    stops: orderStops(run.stops).map((stop) => ({
      id: stop.id,
      donorName: stop.donorName,
      tone: stopTone(stop.state),
      label: stopStateLabel(stop.state),
    })),
    count,
    action,
    actionLabel,
    target: runTarget(run),
    ariaLabel: COPY.runAria(label, subtitle, count, actionLabel),
  };
}

// ---------------------------------------------------------------------------
// The order of the list
// ---------------------------------------------------------------------------

/**
 * S2.1b: "the list re-sorts/refreshes as stops resolve."
 *
 * Runs with weighing left to do come first, because that is what the screen's
 * question asks — "which run are you receiving?". A run that is only waiting on the
 * closing tap has no weighing left and sinks below them.
 *
 * Within each group the OLDEST run leads. The list is not bounded to today (A162),
 * so a run left unclosed from last week is a real row; putting it at the bottom
 * would let it sink out of sight, which is how it stays unclosed. Route name breaks
 * the last tie so the order is stable across reloads rather than however two rows
 * happened to arrive.
 */
export function compareRuns(a: ReceiveRunSummary, b: ReceiveRunSummary): number {
  const workFirst = Number(a.readyForReceiveDone) - Number(b.readyForReceiveDone);
  if (workFirst !== 0) return workFirst;
  const byDate = a.occurrenceDate.localeCompare(b.occurrenceDate);
  if (byDate !== 0) return byDate;
  const byStart = a.startsAt.localeCompare(b.startsAt);
  if (byStart !== 0) return byStart;
  return a.routeName.localeCompare(b.routeName);
}

export function orderRuns(runs: readonly ReceiveRunSummary[]): ReceiveRunSummary[] {
  return [...runs].sort(compareRuns);
}

export function toCards(
  runs: readonly ReceiveRunSummary[],
  timeZone?: string | null,
): RunCardView[] {
  return orderRuns(runs).map((run) => toCard(run, timeZone));
}

// ---------------------------------------------------------------------------
// The three bands (`D38`)
// ---------------------------------------------------------------------------

/**
 * Which of `D38`'s three groups a run belongs to.
 *
 *   `EXPECTED`  today or earlier, still has weighing left — the large cards, and
 *               the visual centre of the screen.
 *   `FINISHED`  today or earlier, every stop resolved: waiting only on the tap
 *               that closes it. Still a row, still worth seeing.
 *   `LATER`     dated after the pantry's today. Collapsed behind a disclosure.
 *
 * `today` is `todayInZone(timezone)` — the PANTRY's calendar day, not the device's
 * (see the date rule at the top). Both are `YYYY-MM-DD`, and lexicographic order on
 * that shape *is* calendar order, so the comparison needs no `Date` and therefore
 * cannot pick up a zone on the way through.
 *
 * The cut is `<= today`, not `=== today`, and that is deliberate. A run left
 * unclosed from last Tuesday is not "later this week" by any reading, and the list
 * is not bounded to today (A162) so it is a real row — burying an overdue run in a
 * disclosure that is closed by default is exactly how it stays unclosed, which is
 * the same reason `compareRuns` leads with the oldest.
 */
export type RunBand = 'EXPECTED' | 'FINISHED' | 'LATER';

export function bandFor(run: ReceiveRunSummary, today: string): RunBand {
  if (run.occurrenceDate > today) return 'LATER';
  // I12's gate, as the server answered it — not recomputed here (see `runAction`).
  return run.readyForReceiveDone ? 'FINISHED' : 'EXPECTED';
}

export interface RunBands {
  expected: RunCardView[];
  finished: RunCardView[];
  later: RunCardView[];
}

/** The list, split into `D38`'s bands, each one still in `compareRuns` order so
 *  the oldest run leads inside its own group. */
export function toBands(
  runs: readonly ReceiveRunSummary[],
  today: string,
  timeZone?: string | null,
): RunBands {
  const bands: RunBands = { expected: [], finished: [], later: [] };
  for (const run of orderRuns(runs)) {
    const card = toCard(run, timeZone);
    const band = bandFor(run, today);
    if (band === 'LATER') bands.later.push(card);
    else if (band === 'FINISHED') bands.finished.push(card);
    else bands.expected.push(card);
  }
  return bands;
}

// ---------------------------------------------------------------------------
// The three list states (§3: "every list defines all three")
// ---------------------------------------------------------------------------

/**
 * Which of §3's blocks the list renders.
 *
 * `BLANK` is the fourth, and is not a state the spec names — it is §6's "sub-300ms
 * actions show nothing", i.e. the window before `useAsyncData` admits it is
 * loading. Rendering skeletons there would be the flash the 300ms delay exists to
 * prevent.
 *
 * Rows already on screen outrank both a reload and a failed reload: a receiver
 * mid-shift should not watch the list they are using dissolve into skeletons
 * because a refresh was slow, and a refresh that fails leaves the last good answer
 * up rather than replacing it with an error block.
 */
export type ListState = 'BLANK' | 'LOADING' | 'ERROR' | 'EMPTY' | 'RUNS';

export function listState(
  runs: readonly ReceiveRunSummary[] | null,
  error: unknown,
  showLoading: boolean,
): ListState {
  if (runs !== null && runs.length > 0) return 'RUNS';
  if (error) return 'ERROR';
  if (runs === null) return showLoading ? 'LOADING' : 'BLANK';
  return 'EMPTY';
}
