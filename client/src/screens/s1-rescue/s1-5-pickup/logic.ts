// S1.5 driver pickup execution — every decision the screen makes, as a function
// of plain records.
//
// It is written this way so it can be tested at all: there is no browser or
// component harness in this repo and adding one would be a dependency, which a
// lane may not add (build-plan §3/D5). The JSX beside this file arranges what is
// decided here; what is NOT covered by a test is stated in the wave report.
//
// EVERYTHING BELOW IS COMMUNICATION ONLY. `services/execution.ts` enforces I5,
// I27 and I30 inside a SERIALIZABLE transaction, and refuses the same things
// again when this screen gets one wrong (`architecture.md §4.5`). Hiding an
// action here is a courtesy to a driver in a truck, never the rule itself.

import { toApiError } from '../../../api/index.ts';
import type {
  RunDetail,
  RunStopSummary,
  ShiftStopDisposition,
  TruckSummary,
} from '../../../api/shared.ts';

// ---------------------------------------------------------------------------
// Which of the screen's faces to show
// ---------------------------------------------------------------------------

export type PickupPhase =
  /** `CLAIMED` and mine: the one big step, pick a truck (I8). */
  | { kind: 'start' }
  /** `IN_PROGRESS` and mine: the stop list. */
  | { kind: 'active' }
  /** Nothing here for this driver. Says which, and what to do next (§6). */
  | { kind: 'unavailable'; title: string; next: string };

/**
 * S1.5 is the *owner's* screen for a run they claimed or started. Staff read the
 * same run on S1.3 and the server lets them (`getRun`), so the test here is
 * ownership rather than tier.
 *
 * `COMPLETED` is unreachable in Phase 1 — the receiver's receive-done is the only
 * completion action and it ships in Phase 2 (I11, build-plan D1). The branch is
 * written and left unexercised rather than left out.
 */
export function phaseFor(run: RunDetail, viewerId: string): PickupPhase {
  if (run.status === 'OPEN') {
    return { kind: 'unavailable', title: COPY.notClaimed, next: COPY.notClaimedNext };
  }
  if (run.status === 'CANCELLED') {
    return { kind: 'unavailable', title: COPY.cancelled, next: COPY.cancelledNext };
  }
  if (run.status === 'COMPLETED') {
    return { kind: 'unavailable', title: COPY.finished, next: COPY.finishedNext };
  }
  if (run.ownerId !== viewerId) {
    return { kind: 'unavailable', title: COPY.notYours, next: COPY.notYoursNext };
  }
  return run.status === 'IN_PROGRESS' ? { kind: 'active' } : { kind: 'start' };
}

/**
 * Every action this screen offers, named.
 *
 * There is deliberately no run-closing action in this list and no code path in
 * this folder that writes `Shift.status`: I11 makes the receiver's receive-done
 * the only completion and it ships in Phase 2 (build-plan D1), so a Phase-1 run
 * stays `IN_PROGRESS` after the last stop is resolved and after
 * `pickup_completed_at` is set. A "finish run" button here would be a second
 * completion path that Phase 2 would have to remove again.
 */
export type PickupAction =
  | 'start'
  | 'collect'
  | 'skip'
  | 'reorder'
  | 'stop-note'
  | 'run-note'
  | 'heading-back';

export function actionsFor(run: RunDetail, viewerId: string): PickupAction[] {
  const phase = phaseFor(run, viewerId);
  if (phase.kind === 'unavailable') return [];
  if (phase.kind === 'start') return ['start'];

  const actions: PickupAction[] = ['stop-note'];
  if (nextPendingStop(run.stops) !== null) actions.push('collect', 'skip');
  if (stopsOnThisRun(run.stops).length > 1) actions.push('reorder');
  // The whole-run note lives on the review screen, which is reachable only once
  // the gate is met (S1.5).
  if (canHeadBack(run.stops)) actions.push('heading-back', 'run-note');
  return actions;
}

// ---------------------------------------------------------------------------
// The stop list
// ---------------------------------------------------------------------------

/**
 * I27's gate: the dispositions that count as driver-resolved.
 *
 * `REASSIGNED` counts as resolved *for this run* — the stop is no longer this
 * driver's to resolve (I30), and the locked doc was amended to say so. Reading it
 * the other way would freeze the very run the reassignment existed to rescue.
 */
const RESOLVED_FOR_HANDOFF: readonly ShiftStopDisposition[] = [
  'COLLECTED',
  'SKIPPED',
  'REASSIGNED',
];

export function orderedStops(stops: readonly RunStopSummary[]): RunStopSummary[] {
  return [...stops].sort((a, b) => a.position - b.position);
}

/** Stops still on this run. A `REASSIGNED` stop is another driver's now (I30):
 *  shown struck-through so a stop never silently vanishes mid-run, but out of the
 *  count, out of the drag order, and out of every action. */
export function stopsOnThisRun(stops: readonly RunStopSummary[]): RunStopSummary[] {
  return orderedStops(stops).filter((stop) => stop.disposition !== 'REASSIGNED');
}

/** The next unchecked stop — "visually the focus" (S1.5, primary action). */
export function nextPendingStop(stops: readonly RunStopSummary[]): RunStopSummary | null {
  return orderedStops(stops).find((stop) => stop.disposition === 'PENDING') ?? null;
}

/** I27's gate, as the driver sees it: **no `PENDING` stop left**. A run with no
 *  stops at all passes it vacuously, which is what the server does too — a route
 *  with zero stops snapshots to an empty list (A93). */
export function canHeadBack(stops: readonly RunStopSummary[]): boolean {
  return stops.every((stop) => RESOLVED_FOR_HANDOFF.includes(stop.disposition));
}

export interface Progress {
  done: number;
  total: number;
}

/** Counted over the stops still on this run: a moved stop is not this driver's
 *  work, so it is neither done nor outstanding here (I30). */
export function progressOf(stops: readonly RunStopSummary[]): Progress {
  const mine = stopsOnThisRun(stops);
  return {
    done: mine.filter((stop) => stop.disposition !== 'PENDING').length,
    total: mine.length,
  };
}

export function progressLabel(stops: readonly RunStopSummary[]): string {
  const { done, total } = progressOf(stops);
  return `${done} of ${total} done`;
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
  // `WEIGHED` is not in this enum and cannot arrive here: it is a read-time
  // projection over non-voided WeightEntry rows (I12), never a stored
  // disposition, and `weight_entry` is a Phase-2 table anyway (build-plan D3).
}

/**
 * A stop the driver can still resolve.
 *
 * Only out of `PENDING`: `domain-modeling.md §3.2` gives the driver two edges and
 * both start there. `COLLECTED → SKIPPED` is the receiver's ("nothing came"),
 * `REASSIGNED` is terminal and staff-only (I30), and the machine has no edge back
 * to `PENDING` — so there is no un-check to offer (A83).
 */
export function canResolve(stop: RunStopSummary): boolean {
  return stop.disposition === 'PENDING';
}

/** The receiver reads a stop's note whether the stop was collected or skipped, so
 *  the field outlives the check-off. A moved stop's note would describe a visit
 *  this driver is no longer making (A87). */
export function canEditNote(stop: RunStopSummary): boolean {
  return stop.disposition !== 'REASSIGNED';
}

// ---------------------------------------------------------------------------
// Reordering (S1.5: "changing order never loses check state")
// ---------------------------------------------------------------------------

/**
 * Move one stop one place up (-1) or down (+1) among the stops still on this run.
 *
 * Only `position` changes — never a disposition and never a note, which is S1.5's
 * edge case stated as code. An out-of-range move returns the list unchanged
 * rather than wrapping.
 *
 * `REASSIGNED` rows are pushed to the end and renumbered last, matching what
 * `reorderStops` does server-side, so the optimistic list and the response agree.
 */
export function moveStop(
  stops: readonly RunStopSummary[],
  stopId: string,
  delta: -1 | 1,
): RunStopSummary[] {
  const ordered = orderedStops(stops);
  const movable = ordered.filter((stop) => stop.disposition !== 'REASSIGNED');
  const index = movable.findIndex((stop) => stop.id === stopId);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= movable.length) return ordered;

  const next = [...movable];
  const moved = next[index]!;
  next[index] = next[target]!;
  next[target] = moved;

  return [...next, ...ordered.filter((stop) => stop.disposition === 'REASSIGNED')].map(
    (stop, position) => ({ ...stop, position }),
  );
}

/** The reorder request body: every stop still on this run, exactly once, in the
 *  order shown. A `REASSIGNED` stop is not on the run and must not be sent — the
 *  server refuses a list that names one (A84). */
export function reorderPayload(stops: readonly RunStopSummary[]): string[] {
  return stopsOnThisRun(stops).map((stop) => stop.id);
}

export function canMoveUp(stops: readonly RunStopSummary[], stopId: string): boolean {
  const movable = stopsOnThisRun(stops);
  return movable.length > 1 && movable.some((s) => s.id === stopId) && movable[0]?.id !== stopId;
}

export function canMoveDown(stops: readonly RunStopSummary[], stopId: string): boolean {
  const movable = stopsOnThisRun(stops);
  return (
    movable.length > 1 &&
    movable.some((s) => s.id === stopId) &&
    movable[movable.length - 1]?.id !== stopId
  );
}

// ---------------------------------------------------------------------------
// Heading back (I27)
// ---------------------------------------------------------------------------

export interface HeadingBackState {
  /** On screen at all: no `PENDING` stop remains (I27's gate). */
  offered: boolean;
  /** `pickup_completed_at` is already set. A second confirm keeps the first
   *  timestamp (A89), so this changes the copy, not the availability. */
  confirmed: boolean;
  /** Local-time reading of the milestone, for the confirmed line. */
  confirmedAt: string | null;
}

export function headingBackState(run: RunDetail): HeadingBackState {
  return {
    offered: canHeadBack(run.stops),
    confirmed: run.pickupCompletedAt !== null,
    confirmedAt: run.pickupCompletedAt === null ? null : timeOfDay(run.pickupCompletedAt),
  };
}

/**
 * A Phase-1 run stays `IN_PROGRESS` — before the milestone and after it. I27 sets
 * a timestamp and deliberately does not touch `status` (build-plan D1), so this
 * is the whole of "is this run still the driver's screen".
 */
export function runIsStillInProgress(run: RunDetail): boolean {
  return run.status === 'IN_PROGRESS';
}

export function timeOfDay(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** One line per stop for the review screen: what happened, plus the note the
 *  receiver will read (S1.5: "stop-by-stop collected/skipped, each stop's note"). */
export interface ReviewLine {
  id: string;
  name: string;
  status: string;
  note: string | null;
}

export function reviewLines(stops: readonly RunStopSummary[]): ReviewLine[] {
  return orderedStops(stops).map((stop) => ({
    id: stop.id,
    name: stop.donorName,
    status: stopStatusLabel(stop.disposition),
    note: stop.note,
  }));
}

// ---------------------------------------------------------------------------
// Trucks (the start step)
// ---------------------------------------------------------------------------

/** An inactive truck is hidden from driver selection (`domain-modeling.md §3.3`).
 *  `GET /trucks` already returns the active set; this says it again, because a
 *  driver must never be shown a truck the start would refuse. */
export function selectableTrucks(trucks: readonly TruckSummary[]): TruckSummary[] {
  return trucks.filter((truck) => truck.active);
}

export function truckLabel(truck: TruckSummary): string {
  return truck.plate ? `${truck.truckName} · ${truck.plate}` : truck.truckName;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * What a failed action says. The server writes its refusals to §7's rules
 * ("Finish or skip every stop before you head back."), so when it sent one, that
 * is the sentence — otherwise the plain per-kind message. Never a code and never
 * the correlation identifier (§6).
 */
export function messageFor(error: unknown): string {
  const apiError = toApiError(error);
  return apiError.detail ?? apiError.message;
}

/** Whether a failure means this screen is out of date and should re-read the run
 *  — someone resolved the stop first, or staff moved it off (I30). A repeat of a
 *  disposition the stop already holds is not an error at all: `resolveStop` is
 *  idempotent, so a double-tap on a flaky phone succeeds (A83). */
export function shouldReloadAfter(error: unknown): boolean {
  const kind = toApiError(error).kind;
  return kind === 'conflict' || kind === 'not-found';
}

// ---------------------------------------------------------------------------
// Copy (§7: plain, short, second person; no jargon)
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

/**
 * Every sentence on this screen, in one place.
 *
 * Two constraints beyond §7, both from what this screen is:
 *
 *   - Nothing may say the run is over. `pickup_completed_at` is a handoff signal,
 *     not a completion (I27), and in Phase 1 the run stays `IN_PROGRESS` forever
 *     (D1). "Heading back" is a statement about the driver, not about the run.
 *   - Nothing may promise the pantry was told. The truck-inbound alert is the one
 *     piece of cap 13 held back to Phase 2 (PRD §5), and the server deliberately
 *     enqueues nothing, so copy that says "we let them know" would be false.
 */
export const COPY = {
  // --- start step ---------------------------------------------------------
  pickTruck: 'Pick your truck',
  pickTruckHint: 'Which truck are you taking? Tap it, then start your run.',
  startRun: 'Start run',
  noTrucks: 'No trucks are set up yet.',
  noTrucksNext: 'Ask an admin to add one, then come back and start your run.',

  // --- run header ---------------------------------------------------------
  staffNoteLabel: 'From staff',
  truckLabel: 'Truck',
  stopsLabel: 'Stops',

  // --- stops --------------------------------------------------------------
  statusToDo: 'To do',
  statusPickedUp: 'Picked up',
  statusSkipped: 'Skipped',
  statusMoved: 'Moved to another driver',
  storeNoteLabel: 'Store note',
  stopNoteLabel: 'Note for the pantry',
  addStopNote: 'Add a note for the pantry',
  editStopNote: 'Edit note',
  saveNote: 'Save note',
  noteSaved: 'Note saved.',
  cancel: 'Cancel',
  pickedUp: 'Picked up',
  skip: 'Skip',
  skipQuestion: 'Skip this stop?',
  skipConsequence: 'It stays skipped for the rest of the run — you cannot undo it here.',
  skipConfirm: 'Skip stop',
  moveUp: 'Move up',
  moveDown: 'Move down',
  movedHint: 'Staff moved this stop to another driver. It is off your run.',
  noStops: 'This run has no stops.',
  noStopsNext: 'There is nothing to pick up, so you can head back whenever you like.',

  // --- heading back (I27) -------------------------------------------------
  headingBack: 'Heading back',
  headingBackHint: 'Optional. It records that you finished your stops.',
  headingBackToast: 'Marked as heading back.',
  reviewAgain: 'Review your run',
  reviewTitle: 'Heading back',
  reviewIntro: 'A last look at your run. Anything you write here goes to the pantry with it.',
  runNoteLabel: 'Note about the whole run',
  runNoteHint: 'Last chance to add something before the pantry weighs it.',
  confirmHeadingBack: 'Confirm — heading back',
  saveRunNote: 'Save note',
  backToStops: 'Back to my stops',
  confirmedTitle: "You're marked as heading back",
  confirmedHint: 'Nothing else is needed from you. You can still add notes.',

  // --- nothing to do here -------------------------------------------------
  notClaimed: 'Nobody has claimed this run yet.',
  notClaimedNext: 'Claim it on the board first, then start it here.',
  notYours: 'This run belongs to another driver.',
  notYoursNext: 'Check the board for a run of your own.',
  cancelled: 'This run was cancelled.',
  cancelledNext: 'Check the board for other runs.',
  // I11 / build-plan D1: unreachable in Phase 1. Built, left unexercised.
  finished: 'This run is finished.',
  finishedNext: 'Check the board for other runs.',
  goToBoard: 'Go to the board',
  loadingRun: 'Loading your run',
} as const;
