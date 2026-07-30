// S1.3 shift detail — every decision the screen makes, as a function of plain
// records.
//
// Split out from the JSX so it can be tested at all: there is no jsdom and no
// component renderer in this repo, and adding one would be a dependency a lane may
// not add (build-plan §3/D5). What lives here is what a wrong answer would
// silently break — which of the screen's two faces a viewer gets, whether Release
// is on screen, which stops may be moved, and every sentence of copy.
//
// EVERYTHING BELOW IS COMMUNICATION ONLY. `services/coverage.ts` and
// `services/execution.ts` enforce the release edge, I20's conflict flag and I30
// inside a SERIALIZABLE transaction and refuse the same things again when this
// screen gets one wrong (`architecture.md §4.5`). A hidden button is a courtesy to
// the person holding the phone, never the rule itself.

import { toApiError } from '../../../api/index.ts';
import type {
  PlannedStop,
  RunDetail,
  RunStopSummary,
  ShiftDetail,
  ShiftStopDisposition,
  ShiftSummary,
} from '../../../api/shared.ts';

// ---------------------------------------------------------------------------
// Copy (`ui-ux-spec.md S1.3`, §6, §7)
//
// One object, so the forbidden-word check in `detail.test.ts` can read every
// user-visible sentence this screen owns. §7 forbids: PWA, push subscription,
// session, payload, endpoint, atomic, instance — which is why the word is always
// "run", and why the recurring release talks about "this and future" rather than
// about instances of a series.
// ---------------------------------------------------------------------------

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
  // --- the run itself -----------------------------------------------------
  whenLabel: 'When',
  routeLabel: 'Route',
  truckLabel: 'Truck',
  /** I8: the truck is picked by the driver at the start, never set at scheduling. */
  truckUnset: 'The driver picks one when they start.',
  driverLabel: 'Driver',
  noDriver: 'Nobody yet',
  repeatsTag: 'repeats weekly',
  loading: 'Loading this run',

  // --- the conflict flag (I20's staff-assign exemption) -------------------
  /** S1.3, verbatim. Informational only — it never blocks pickup execution. */
  conflictBanner:
    "This run conflicts with your declared availability — contact staff if that's a problem.",

  // --- the coordinator -> driver note (cap 11, channel 1) -----------------
  /** The driver's heading for it. Same words as S1.5, which shows the same note. */
  staffNoteLabel: 'From staff',
  /** The staff heading for the same field: they are writing it, not reading it. */
  staffNoteEditLabel: 'Note for the driver',
  staffNoteEmpty: 'No note for the driver yet.',
  addStaffNote: 'Add a note for the driver',
  editStaffNote: 'Edit note',
  saveStaffNote: 'Save note',
  staffNoteSaved: 'Note saved.',
  cancel: 'Cancel',

  // --- stops --------------------------------------------------------------
  stopsLabel: 'Stops',
  /** Before the run starts there are no stop rows yet (I5) — what is on screen is
   *  the route as staff built it. Said plainly, because staff may still change it. */
  stopsPlanned: "The route as planned. It becomes the driver's list when they start.",
  stopsLive: "The driver's list, in the order they are working it.",
  noStops: 'This route has no stores yet.',
  noStopsBody: 'Staff add stores to a route on the schedule screen.',
  /** A started run whose route was empty. Its list is frozen (I5), so telling
   *  anyone to go and add a store would be false — it could not reach this run. */
  noStopsLive: 'This run started with no stores on its route.',
  noStopsLiveBody: 'There is nothing to pick up, and nothing to move.',
  storeNoteLabel: 'Store note',
  stopNoteLabel: 'Note for the pantry',
  statusToDo: 'To do',
  statusPickedUp: 'Picked up',
  statusSkipped: 'Skipped',
  statusMoved: 'Moved to another driver',

  // --- on to the run (S1.5) ----------------------------------------------
  startRun: 'Start this run',
  openRun: 'Open my run',

  // --- release (PRD cap 8) ------------------------------------------------
  release: 'Release run',
  /** §3's own example of a destructive confirm, verbatim. */
  releaseQuestion: 'Release this run?',
  releaseConsequence: 'It goes back to the board for others.',
  /** S1.3, verbatim, for a run that repeats. */
  releaseScopeQuestion: 'Release just this one, or this and future?',
  releaseScopeLabel: 'How much to release',
  releaseScopeOne: 'Just this one',
  releaseScopeFuture: 'This and future',
  releaseRangeLabel: 'How far ahead',
  releaseRangeAll: 'Every future run',
  releaseRangeThrough: (day: string) => `Through ${day}`,
  /** The series keeps generating past whatever is released (I23) — the driver is
   *  handing runs back, not ending the repeat. Staff's bulk-terminate is a
   *  separate, staff-only action and is deliberately not on this screen. */
  releaseFutureConsequence:
    'Each one you release goes back to the board for others. Your weekly run keeps coming after that.',
  releaseConfirmOne: 'Release run',
  releaseConfirmMany: 'Release these runs',

  // --- reassign a stop (PRD cap 10 / I30, staff only) --------------------
  reassign: 'Reassign',
  reassignAria: (store: string) => `Reassign ${store} to another driver`,
  reassignQuestion: (store: string) => `Move ${store} to another driver?`,
  reassignIntro: 'Pick who picks it up instead.',
  reassignConsequence:
    'It comes off this run and goes to the end of their stop list. This run keeps the store struck through.',
  reassignConfirm: 'Move the stop',
  reassignPick: 'Pick a driver first.',
  reassignEmpty: 'No other driver is out today.',
  reassignEmptyBody:
    'A stop can only move to a run that has already started. Try again once someone is out.',
  reassignNotStarted: 'Has not started yet',
  reassignDone: (driver: string) => `Moved to ${driver}.`,
  reassignedHint: 'Moved to another driver.',
  driversLabel: 'Drivers out today',

  // --- nothing to show ----------------------------------------------------
  cancelled: 'This run was cancelled.',
  cancelledBody: 'Check the board for other runs.',
} as const;

// ---------------------------------------------------------------------------
// Calendar slots and clock times
//
// A run's DAY comes from `occurrenceDate` — the `YYYY-MM-DD` pantry-local slot the
// server already resolved — and never from `startsAt`, which would land east of the
// pantry on the wrong day. A run's TIME is formatted in the pantry's zone (A120),
// which the session carries: "the 9am run" is 9am at the pantry, not on whatever
// device is reading it.
//
// Written here rather than imported from another screen's folder: each S1.x folder
// owns its own copy of these two, the way `s1-5-pickup` owns `timeOfDay`.
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

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/** `YYYY-MM-DD` → a local `Date` at midnight. Built from the parts rather than
 *  `new Date(string)`, which parses a bare date as UTC and lands on the previous
 *  day for anyone west of Greenwich. */
export function parseCalendarDate(date: string): Date {
  const parts = date.split('-');
  return new Date(Number(parts[0] ?? NaN), Number(parts[1] ?? NaN) - 1, Number(parts[2] ?? NaN));
}

/** Today, shaped like a calendar slot. The device's own date: it only bounds which
 *  runs are fetched for the driver picker and decides nothing. */
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
 * Today as a PANTRY-local calendar slot (A120), which is the frame every
 * `occurrenceDate` is stated in.
 *
 * The device's date is not interchangeable with it. Two places on this screen would
 * be wrong without this: the day heading, which would read "Tomorrow" for the
 * pantry's today to anyone whose phone has already rolled over; and the reassign
 * picker, which bounds a fetch by day and would ask for the wrong day's runs
 * outright. Falls back to the device only when no zone has arrived yet, since there
 * is nothing else to use.
 */
export function todayInZone(timeZone?: string, now: Date = new Date()): string {
  if (!timeZone) return todayCalendarDate(now);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: string): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  const year = part('year');
  const month = part('month');
  const day = part('day');
  if (year === '' || month === '' || day === '') return todayCalendarDate(now);
  return `${year}-${month}-${day}`;
}

/** "August 4" — the short form used inside a sentence. */
export function monthDay(date: string): string {
  const parsed = parseCalendarDate(date);
  return `${MONTHS[parsed.getMonth()] ?? ''} ${parsed.getDate()}`;
}

/** "Today, August 4" / "Tomorrow, August 4" / "Tuesday, August 4" — the same
 *  heading the board uses, because a driver arrives here from it (§1 principle 4:
 *  the same fact reads the same in both places). */
export function dayHeading(date: string, today: string = todayCalendarDate()): string {
  if (date === today) return `Today, ${monthDay(date)}`;
  if (date === addDays(today, 1)) return `Tomorrow, ${monthDay(date)}`;
  const parsed = parseCalendarDate(date);
  return `${WEEKDAYS[parsed.getDay()] ?? ''}, ${monthDay(date)}`;
}

/** "9:00 AM – 11:00 AM" in the PANTRY's zone (A120). Left undefined the device's
 *  own zone is used — correct only for the moment before the session has loaded,
 *  since there is nothing better to fall back to. */
export function timeRange(startsAt: string, endsAt: string, timeZone?: string): string {
  const format = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  });
  return `${format.format(new Date(startsAt))} – ${format.format(new Date(endsAt))}`;
}

// ---------------------------------------------------------------------------
// Who is looking, and what that lets them do
//
// S1.3 is two views of one screen — "owner (phone), staff (desktop)" — and the
// viewer decides which, not the device. A staff coordinator on a phone still gets
// the staff half, and an owner on a desktop still gets theirs.
// ---------------------------------------------------------------------------

export interface DetailViewer {
  id: string;
  /** Tier >= STAFF (I1) — hierarchical, so Admin passes without being named. */
  isStaff: boolean;
  /** Holds the Drive duty (I2) — set membership, never implied by a tier. */
  canDrive: boolean;
}

export interface DetailCapabilities {
  isOwner: boolean;
  /**
   * S1.3: "owner sees **Release run** (red). Before-start only; in-progress/past
   * hide it." `CLAIMED` is the only state with a release edge (`§3.1`), and the
   * server's predicate adds `starts_at > now()` — both are repeated here so the
   * button is absent rather than refused.
   */
  canRelease: boolean;
  /** Staff add/edit the coordinator→driver note here; the driver sees it read-only. */
  canEditStaffNote: boolean;
  /** Staff-only, and only on an `IN_PROGRESS` run's unresolved stops (I30). */
  canReassignStops: boolean;
  /** The release prompt becomes "just this one, or this and future?" (S1.3). */
  releaseRepeats: boolean;
  /** I20's staff-assign exemption: the owner's persistent banner. */
  showConflictBanner: boolean;
  /** The way on to S1.5, which no other screen offers. Null when this viewer has
   *  no run of their own to open here. */
  openRun: 'START' | 'CONTINUE' | null;
}

export function capabilitiesFor(
  shift: ShiftSummary,
  viewer: DetailViewer,
  nowMs: number = Date.now(),
): DetailCapabilities {
  const isOwner = shift.ownerId !== null && shift.ownerId === viewer.id;
  const startsAt = Date.parse(shift.startsAt);
  const beforeStart = Number.isNaN(startsAt) ? false : startsAt > nowMs;

  return {
    isOwner,
    // Not gated on the Drive duty. The server declares `anyDuty: ['DRIVE']` on
    // release and re-checks it, but a driver whose duty was removed after they
    // claimed would otherwise be shown a run they cannot hand back at all — and
    // only staff could rescue it. The refusal is the honest answer there.
    canRelease: isOwner && shift.status === 'CLAIMED' && beforeStart,
    canEditStaffNote: viewer.isStaff,
    canReassignStops: viewer.isStaff && shift.status === 'IN_PROGRESS',
    releaseRepeats: shift.recurrencePatternId !== null,
    // S1.3 gives the banner to the OWNER — its sentence is second-person and about
    // their own declared availability. Staff set the flag themselves and are told
    // nothing new by reading it back.
    showConflictBanner: isOwner && shift.assignedOverConflict,
    // The pickup screen's route requires the Drive duty, so offering the link
    // without it would be a dead end rather than a refusal.
    openRun:
      isOwner && viewer.canDrive
        ? shift.status === 'CLAIMED'
          ? 'START'
          : shift.status === 'IN_PROGRESS'
            ? 'CONTINUE'
            : null
        : null,
  };
}

// ---------------------------------------------------------------------------
// The stop list
//
// Two sources, and which one is showing matters:
//
//   TEMPLATE — before the run starts. I5 puts `shift_stop` rows on a shift only
//     from `IN_PROGRESS` onward, so a scheduled run's list is still the route's.
//     No stop ids, no dispositions, and nothing to reassign.
//   SNAPSHOT — from `IN_PROGRESS` onward: the real `ShiftStop` rows, with the
//     driver's order and dispositions, and the only source Reassign can act on.
// ---------------------------------------------------------------------------

export type StopSource = 'TEMPLATE' | 'SNAPSHOT';

/**
 * I30: only an unresolved stop may move — `PENDING`, or `COLLECTED` that has not
 * been weighed yet.
 *
 * S1.3 also says an already-weighed stop has no Reassign action. `WEIGHED` is not
 * a stored disposition at all: it is a read-time projection over non-voided
 * `WeightEntry` rows (I12), and `weight_entry` is a Phase-2 table (build-plan D3).
 * So in Phase 1 no `COLLECTED` stop can be weighed, and that clause has nothing to
 * hide yet — the list below is exactly the server's `MOVABLE_DISPOSITIONS`, and it
 * is where the weighed case will subtract from when Phase 2 lands.
 */
export const MOVABLE_DISPOSITIONS: readonly ShiftStopDisposition[] = ['PENDING', 'COLLECTED'];

export interface StopLine {
  key: string;
  /** Null on a TEMPLATE line — there is no `ShiftStop` row to act on yet (I5). */
  stopId: string | null;
  donorName: string;
  donorAddress: string | null;
  donorNote: string | null;
  /** 1-based, as shown. `position` is 0-based and is the server's business. */
  number: number;
  disposition: ShiftStopDisposition | null;
  statusLabel: string | null;
  /** `ShiftStop.note` — driver→receiver (cap 11, channel 2). Read-only here. */
  note: string | null;
  /** `REASSIGNED`: struck through, and out of every action (I30). */
  moved: boolean;
  canReassign: boolean;
}

export function stopStatusLabel(disposition: ShiftStopDisposition): string {
  switch (disposition) {
    case 'PENDING':
      return COPY.statusToDo;
    case 'COLLECTED':
      return COPY.statusPickedUp;
    case 'SKIPPED':
      return COPY.statusSkipped;
    case 'REASSIGNED':
      return COPY.statusMoved;
  }
}

function templateLine(stop: PlannedStop, index: number): StopLine {
  return {
    key: `${stop.donorId}-${stop.position}`,
    stopId: null,
    donorName: stop.donorName,
    // Donor address is operational data staff and drivers need, never PII —
    // `pii.ts` gates people, not places (`CLAUDE.md`).
    donorAddress: stop.donorAddress,
    donorNote: null,
    number: index + 1,
    disposition: null,
    statusLabel: null,
    note: null,
    moved: false,
    canReassign: false,
  };
}

function snapshotLine(stop: RunStopSummary, index: number, canReassign: boolean): StopLine {
  return {
    key: stop.id,
    stopId: stop.id,
    donorName: stop.donorName,
    donorAddress: stop.donorAddress,
    donorNote: stop.donorNote,
    number: index + 1,
    disposition: stop.disposition,
    statusLabel: stopStatusLabel(stop.disposition),
    note: stop.note,
    moved: stop.disposition === 'REASSIGNED',
    canReassign: canReassign && MOVABLE_DISPOSITIONS.includes(stop.disposition),
  };
}

export interface StopListView {
  source: StopSource;
  lines: StopLine[];
}

/**
 * The stop list as this screen renders it.
 *
 * The run's own stops win whenever there IS a run — not merely when it has stops.
 * I5 freezes the snapshot at start, so a started run with an empty list has an
 * empty list: falling back to the template there would show stores the driver
 * never got, because a route edited after the run started cannot reach those rows.
 * The template is what a not-yet-started run has instead, and it is also the
 * graceful answer for a viewer the run is not readable by.
 */
export function stopLines(
  shift: ShiftDetail,
  run: RunDetail | null,
  capabilities: Pick<DetailCapabilities, 'canReassignStops'>,
): StopListView {
  if (run) {
    const ordered = [...run.stops].sort((a, b) => a.position - b.position);
    return {
      source: 'SNAPSHOT',
      lines: ordered.map((stop, index) =>
        snapshotLine(stop, index, capabilities.canReassignStops),
      ),
    };
  }
  const ordered = [...shift.plannedStops].sort((a, b) => a.position - b.position);
  return { source: 'TEMPLATE', lines: ordered.map(templateLine) };
}

// ---------------------------------------------------------------------------
// Release scope (§5.3's `release-one` / `release-range`)
// ---------------------------------------------------------------------------

export const RELEASE_CHOICES = ['ONE', 'FUTURE'] as const;
export type ReleaseChoice = (typeof RELEASE_CHOICES)[number];

/** The open-ended half of S1.3's "this and future": no end date at all. */
export const RANGE_OPEN_ENDED = 'ALL';

export interface RangeOption {
  /** `ALL`, or the `YYYY-MM-DD` last day to release through. */
  value: string;
  label: string;
}

/**
 * S1.3's "date-range option for bulk", built from the runs that actually exist
 * rather than from a date field: §1.5 rules out fragile pickers, and §1.4 asks for
 * recognition — a driver choosing how far ahead to hand back can see the days.
 *
 * Only their own still-claimed future runs in this series can be released
 * (`releaseRangeTargets`), so those are the only days offered.
 */
export function releaseRangeOptions(
  shift: ShiftSummary,
  seriesRuns: readonly ShiftSummary[],
): RangeOption[] {
  const days = seriesRuns
    .filter(
      (run) =>
        run.id !== shift.id &&
        run.status === 'CLAIMED' &&
        run.ownerId === shift.ownerId &&
        run.recurrencePatternId === shift.recurrencePatternId &&
        run.occurrenceDate > shift.occurrenceDate,
    )
    .map((run) => run.occurrenceDate)
    .sort((a, b) => a.localeCompare(b));

  const unique = [...new Set(days)];
  return [
    { value: RANGE_OPEN_ENDED, label: COPY.releaseRangeAll },
    ...unique.map((day) => ({ value: day, label: COPY.releaseRangeThrough(monthDay(day)) })),
  ];
}

/**
 * The confirm button's words, keyed to the SCOPE and never to a count.
 *
 * A count would have to come from the second request that reads the series' days,
 * and when that request fails the count reads as 1 — so a "this and future" release
 * would offer a button saying "Release run" and then hand back every run ahead of
 * it. That is the one outcome worth ruling out on a destructive confirm, and the
 * scope is known locally and always right. Which days are involved is already on
 * screen: the range control lists them.
 */
export function releaseConfirmLabel(choice: ReleaseChoice): string {
  return choice === 'ONE' ? COPY.releaseConfirmOne : COPY.releaseConfirmMany;
}

// ---------------------------------------------------------------------------
// The reassign driver picker (S1.3, staff only)
// ---------------------------------------------------------------------------

export interface ReassignCandidate {
  shiftId: string;
  driverName: string;
  routeName: string;
  when: string;
  status: ShiftSummary['status'];
  /**
   * A stop can only be appended to a run that HAS a stop list, and a shift gets
   * its rows at start (I5) — so `reassignStop` refuses a destination that is not
   * `IN_PROGRESS`. S1.3's picker names "any driver with an open or in-progress
   * shift today", so a claimed-but-not-started run is still listed, with the
   * reason it cannot be picked; hiding it would read as the driver being absent.
   */
  selectable: boolean;
  reason: string | null;
}

/**
 * S1.3: "a driver picker (any driver with an open or in-progress shift today)".
 *
 * An `OPEN` run has no driver at all, so "open" is read as the run a driver is
 * holding but has not started — `CLAIMED`. Unowned and cancelled runs, and this
 * run itself, are not candidates.
 */
export function reassignCandidates(
  shifts: readonly ShiftSummary[],
  currentShiftId: string,
  timeZone?: string,
): ReassignCandidate[] {
  return shifts
    .filter(
      (shift) =>
        shift.id !== currentShiftId &&
        shift.ownerId !== null &&
        (shift.status === 'CLAIMED' || shift.status === 'IN_PROGRESS'),
    )
    .sort((a, b) => {
      const started = Number(b.status === 'IN_PROGRESS') - Number(a.status === 'IN_PROGRESS');
      if (started !== 0) return started;
      return a.startsAt.localeCompare(b.startsAt);
    })
    .map((shift) => ({
      shiftId: shift.id,
      // Names are public-within-org (`product-requirement.md §2`), never PII.
      driverName: shift.ownerName ?? COPY.noDriver,
      routeName: shift.routeName,
      when: timeRange(shift.startsAt, shift.endsAt, timeZone),
      status: shift.status,
      selectable: shift.status === 'IN_PROGRESS',
      reason: shift.status === 'IN_PROGRESS' ? null : COPY.reassignNotStarted,
    }));
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** What a failed action says. The server writes its refusals to §7's rules ("That
 *  run has already started — it can't be released."), so when it sent one, that is
 *  the sentence. Never a code and never the correlation identifier (§6). */
export function messageFor(error: unknown): string {
  const apiError = toApiError(error);
  return apiError.detail ?? apiError.message;
}

/** Whether a failure means this screen is out of date and should re-read the run —
 *  the driver resolved the stop first, someone else released it, the run started. */
export function shouldReloadAfter(error: unknown): boolean {
  const kind = toApiError(error).kind;
  return kind === 'conflict' || kind === 'not-found';
}
