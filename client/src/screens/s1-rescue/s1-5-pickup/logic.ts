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
import { DONATION_ON_ROUTE_MESSAGE } from '../../../api/shared.ts';
import type {
  DonationSummary,
  DonorSummary,
  FlagAdHocRequest,
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
 * `complete-run` is a LABEL, not a state transition (D23). It posts
 * `pickup_completed_at` and nothing else: I11 (locked) makes the receiver's
 * receive-done the only completion, and I12 needs every stop `WEIGHED` before a
 * shift may reach `COMPLETED` — which a driver has no scale to do. So no action
 * in this list writes `Shift.status`, and the run is still `IN_PROGRESS` on the
 * far side of the one called "complete".
 */
export type PickupAction =
  | 'start'
  | 'collect'
  | 'skip'
  | 'reorder'
  | 'stop-note'
  | 'run-note'
  /** D23: "Complete this run" — the confirm modal, and the milestone behind it
   *  (I27). The driver's work is what completes; the shift is not. */
  | 'complete-run'
  /** Phase 2, cap 12: record a pickup that was never on the planned route. Writes
   *  an UnscheduledDonation and never a ShiftStop (I14), so it closes nothing and
   *  changes no stop's disposition. */
  | 'flag-ad-hoc';

export function actionsFor(run: RunDetail, viewerId: string): PickupAction[] {
  const phase = phaseFor(run, viewerId);
  if (phase.kind === 'unavailable') return [];
  if (phase.kind === 'start') return ['start'];

  // D23: once the driver has completed the run, this screen is a read-only
  // summary. No stop actions, no note edit, and no flag — the last of which is
  // the cost of the choice, so `COPY.summaryNoFlag` says out loud that an extra
  // pickup now needs a phone call. The shift is untouched and still IN_PROGRESS
  // (I27); what closed is the driver's own screen, not the run.
  if (run.pickupCompletedAt !== null) return [];

  // Available for the whole of an in-progress run: the server's only state test is
  // `status === 'IN_PROGRESS'`, and a driver can be handed something extra at any
  // point of the drive.
  const actions: PickupAction[] = ['stop-note', 'flag-ad-hoc'];
  if (nextPendingStop(run.stops) !== null) actions.push('collect', 'skip');
  if (stopsOnThisRun(run.stops).length > 1) actions.push('reorder');
  // The whole-run note lives in the confirm modal, which is reachable only once
  // the gate is met (S1.5, I27) and only until it is confirmed.
  if (canHeadBack(run.stops)) actions.push('complete-run', 'run-note');
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

// ---------------------------------------------------------------------------
// Which stop is open (D21)
// ---------------------------------------------------------------------------

/**
 * The driver's own open/closed choices, by stop id. A stop with no entry follows
 * the default below.
 *
 * PRESENTATION ONLY. Nothing in this section reads or writes a disposition, and
 * every stop stays in the list, in order, whatever this says — the run screen is
 * still "an ordered list of stops" (S1.5), just not four of them open at once.
 */
export type StopExpansion = Readonly<Record<string, boolean>>;

export const NO_STOP_EXPANSION: StopExpansion = {};

/**
 * Whether a stop is shown in full.
 *
 * The default is "the current stop, and only the current stop" — the next
 * `PENDING` one, which S1.5 already makes the visual focus. A driver standing in
 * one store's car park should not be reading four other stores' notes, and on a
 * phone held in one hand that is what an all-expanded list means.
 *
 * A tap overrides the default either way, so every stop is one tap from being
 * fully readable: a collected stop can be reopened to add the note the receiver
 * will read (`canEditNote`), and a moved one to see why it went.
 */
export function isStopExpanded(
  stop: RunStopSummary,
  stops: readonly RunStopSummary[],
  expansion: StopExpansion,
): boolean {
  const chosen = expansion[stop.id];
  if (chosen !== undefined) return chosen;
  return nextPendingStop(stops)?.id === stop.id;
}

export function toggleStopExpansion(
  expansion: StopExpansion,
  stop: RunStopSummary,
  stops: readonly RunStopSummary[],
): StopExpansion {
  return { ...expansion, [stop.id]: !isStopExpanded(stop, stops, expansion) };
}

/**
 * Drop a stop's choice so it follows the default again.
 *
 * Called when a stop resolves: the focus has moved to the next stop, and the
 * finished one closes itself rather than sitting open above the work that is
 * left. Reopening it is still one tap.
 */
export function forgetStopExpansion(
  expansion: StopExpansion,
  stopId: string,
): StopExpansion {
  if (expansion[stopId] === undefined) return expansion;
  const next = { ...expansion };
  delete next[stopId];
  return next;
}

// ---------------------------------------------------------------------------
// Finding the door (D20)
// ---------------------------------------------------------------------------

/** Google Maps' documented search link. Every phone hands it to whichever map app
 *  the driver actually uses; a `geo:` URI does not work on iOS at all. */
const MAP_SEARCH_BASE = 'https://www.google.com/maps/search/?api=1&query=';

/** What a stop needs to be findable, gathered from the two places it lives: the
 *  address rides on the stop, the rest on the donor (D20). */
export interface StopPlace {
  /** `Donor.map_url`. Null is the normal state and means "derive one". */
  mapUrl: string | null;
  address: string | null;
  hasPhoto: boolean;
}

/**
 * The aids for one stop.
 *
 * `RunStopSummary` carries the address and nothing else about the place, so the
 * map link and the photo flag are joined in from the donor list by id. A donor
 * that is not in the list simply has no aids and the stop renders exactly as it
 * did before — a driver never loses a stop because a second request lagged.
 */
export function placeFor(
  stop: RunStopSummary,
  donors: readonly DonorSummary[],
): StopPlace {
  const donor = donors.find((candidate) => candidate.id === stop.donorId);
  return {
    mapUrl: donor?.mapUrl ?? null,
    address: stop.donorAddress,
    hasPhoto: donor?.hasPhoto ?? false,
  };
}

/**
 * Where "Open in Maps" goes, or null when there is nothing to open.
 *
 * An explicit `Donor.map_url` wins: it exists precisely for the store whose
 * address does not resolve to the right door — a dock round the back, a site with
 * several entrances (D20). Otherwise a search for the address.
 */
export function mapLinkFor(place: StopPlace): string | null {
  const explicit = (place.mapUrl ?? '').trim();
  if (explicit !== '') return explicit;

  const address = (place.address ?? '').trim();
  if (address === '') return null;

  return `${MAP_SEARCH_BASE}${encodeURIComponent(address)}`;
}

/**
 * The photo's own endpoint.
 *
 * An `<img>` is the browser's own GET and cannot go through `api/client.ts` — it
 * does not need to either: it carries the same-origin session cookie by itself,
 * and there is no JSON error shape to map, only a broken image to replace with a
 * label. `/api` is the mount point Express serves the SPA from (§4.5).
 */
export function photoUrlFor(donorId: string): string {
  return `/api/donors/${encodeURIComponent(donorId)}/photo`;
}

/** Alt text: what the picture is of, not the fact that it is a picture. */
export function photoAlt(stop: RunStopSummary): string {
  return `${stop.donorName}, as seen on arrival`;
}

/** The toggle's spoken label. The row's own words are the store name and its
 *  status; this says what tapping does, which sighted users get from the chevron
 *  (§3: an icon is never the only label). */
export function stopToggleLabel(stop: RunStopSummary, expanded: boolean): string {
  return `${expanded ? COPY.hideStop : COPY.showStop}: ${stop.donorName}`;
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
 * How loudly a disposition reads, as the chip vocabulary `§3` fixes.
 *
 * A stop still to do carries the MOST weight, because "what is left" is the only
 * question a driver asks this list. Picked up is the success tone, skipped and
 * moved are muted: both are settled, and neither is work.
 *
 * The word is never dropped for the colour (§2, §3): `stopStatusLabel` renders
 * inside the chip in every one of these tones, so the row reads the same in
 * sunlight, in greyscale and out loud.
 */
export type StopStatusTone = 'todo' | 'done' | 'skipped' | 'moved';

export function stopStatusTone(disposition: ShiftStopDisposition): StopStatusTone {
  switch (disposition) {
    case 'PENDING':
      return 'todo';
    case 'COLLECTED':
      return 'done';
    case 'SKIPPED':
      return 'skipped';
    case 'REASSIGNED':
      return 'moved';
  }
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
// Completing the run (I27, D23)
//
// The MILESTONE did not change: `pickup_completed_at`, one gate, one endpoint,
// no `Shift.status` write (I27). Only the driver's word for it did, and this
// section keeps the domain's name so the two never get confused.
// ---------------------------------------------------------------------------

export interface HeadingBackState {
  /** On screen at all: no `PENDING` stop remains (I27's gate). */
  offered: boolean;
  /** `pickup_completed_at` is already set. Since D23 this closes the screen down
   *  to a read-only summary rather than reopening an editable note. */
  confirmed: boolean;
  /** Local-time reading of the milestone, for the summary's heading. */
  confirmedAt: string | null;
}

export function headingBackState(run: RunDetail, timeZone?: string): HeadingBackState {
  return {
    offered: canHeadBack(run.stops),
    confirmed: run.pickupCompletedAt !== null,
    confirmedAt:
      run.pickupCompletedAt === null ? null : timeOfDay(run.pickupCompletedAt, timeZone),
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

/** A milestone's clock time in the PANTRY's zone (A120). Undefined falls back to
 *  the device's, which is right only before the session has loaded. */
export function timeOfDay(iso: string, timeZone?: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return at.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  });
}

/** One line per stop for the confirm modal and the read-only summary: what
 *  happened, plus the note the receiver will read (S1.5: "stop-by-stop
 *  collected/skipped, each stop's note").
 *
 *  The disposition travels raw rather than pre-formatted, so the one component
 *  that renders it (`StopStatusChip`) owns both the word and the tone and the two
 *  cannot drift apart. */
export interface ReviewLine {
  id: string;
  name: string;
  disposition: ShiftStopDisposition;
  note: string | null;
}

export function reviewLines(stops: readonly RunStopSummary[]): ReviewLine[] {
  return orderedStops(stops).map((stop) => ({
    id: stop.id,
    name: stop.donorName,
    disposition: stop.disposition,
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
// "Flag a stop not on my route" (cap 12, I14 / I17 / I29)
// ---------------------------------------------------------------------------

/**
 * Where the food came from, as the two shapes the driver may send.
 *
 * `donor_id` and `donor_label` are mutually exclusive (`ck_ud_source_exclusive`).
 * The third shape the column pair allows — both null, the anonymous row — is no
 * longer offered here (D24): `ck_ud_i16b_source` permits an anonymous row only
 * when it is not reportable, and everything a driver flags is reportable by
 * default (I15). So "Other" now means "type the name", and there is no way to
 * record a pickup from nowhere.
 */
export type AdHocStore =
  | { kind: 'master'; donorId: string }
  | { kind: 'label'; donorLabel: string };

/** What the flag screen holds while the driver fills it in.
 *
 *  `weight` is absent and has nowhere to go: the driver has no scale, and the
 *  receiver weighs it (S1.5). `categoryId` is absent for the same shape of
 *  reason (D24) — a driver at a loading dock cannot know which of eleven
 *  categories a mixed pallet reports under, and the receiver picks it at confirm
 *  time, where it is required. */
export interface AdHocDraft {
  /** Null until the driver picks. Nothing is preselected: with the anonymous
   *  option gone there is no answer that is right by default. */
  store: AdHocStore | null;
  note: string;
}

export const EMPTY_AD_HOC_DRAFT: AdHocDraft = {
  store: null,
  note: '',
};

/** The radio value for the one option that is not a donor id. Prefixed so it can
 *  never collide with a uuid. */
export const AD_HOC_LABEL_CHOICE = '__label__';

/** Empty string for "nothing chosen yet" — no radio in the group matches it, which
 *  is exactly the state the form opens in. */
export function adHocChoiceOf(store: AdHocStore | null): string {
  if (store === null) return '';
  return store.kind === 'label' ? AD_HOC_LABEL_CHOICE : store.donorId;
}

/** The radio's value back into a store. `label` keeps whatever was already typed so
 *  tapping away and back does not clear the box. */
export function adHocStoreFor(choice: string, typedLabel: string): AdHocStore {
  if (choice === AD_HOC_LABEL_CHOICE) return { kind: 'label', donorLabel: typedLabel };
  return { kind: 'master', donorId: choice };
}

/**
 * The stores the picker offers.
 *
 * Active only (I21: a deactivated donor is preserved in history but not offered for
 * new work), and **minus every donor already on this run** — the server refuses
 * those (I29) and the run's stops are already on screen above.
 *
 * Filtered against ALL stops, not just the ones still on this run: the server's
 * guard reads `shift_stop` with no disposition filter, so a stop staff moved to
 * another driver still blocks. Hiding a different set than the server refuses is
 * how a picker starts lying.
 */
export function selectableDonors(
  donors: readonly DonorSummary[],
  stops: readonly RunStopSummary[],
): DonorSummary[] {
  const onRoute = new Set(stops.map((stop) => stop.donorId));
  return donors.filter((donor) => donor.active && !onRoute.has(donor.id));
}

/**
 * The request body, or null when the draft is not ready to send.
 *
 * One thing makes it ready now, and it is not a domain rule this screen owns —
 * the server checks it again: **a store the row can be attributed to**. Either
 * one picked from the master list, or a name typed under "Other". D24 removed
 * the anonymous option, so a blank "Other" box is an unfinished form rather than
 * a third answer, and `adHocStoreProblem` says so where the box is.
 *
 * `donorId` and `donorLabel` are never both present, which is what
 * `ck_ud_source_exclusive` requires and what the server's `resolveSource` refuses.
 */
export function adHocRequest(draft: AdHocDraft): FlagAdHocRequest | null {
  if (draft.store === null) return null;

  const note = draft.note.trim();
  const tail = note === '' ? {} : { note };

  switch (draft.store.kind) {
    case 'master':
      return { donorId: draft.store.donorId, ...tail };
    case 'label': {
      const label = draft.store.donorLabel.trim();
      return label === '' ? null : { donorLabel: label, ...tail };
    }
  }
}

export function adHocReady(draft: AdHocDraft): boolean {
  return adHocRequest(draft) !== null;
}

/**
 * The one sentence the store picker can be wrong in, or null.
 *
 * Only "Other" with nothing typed. Every other unfinished state is "nothing
 * picked yet", which the empty radio group already shows and which a message
 * would only repeat (D21).
 */
export function adHocStoreProblem(draft: AdHocDraft): string | null {
  if (draft.store === null || draft.store.kind !== 'label') return null;
  return draft.store.donorLabel.trim() === '' ? COPY.flagOtherStoreRequired : null;
}

/**
 * One line per pickup the driver flagged on this run.
 *
 * Deliberately NOT a stop and never rendered as one: a driver-add writes no
 * `ShiftStop` (I14), so it has no position, no disposition, and nothing to check
 * off.
 *
 * The store is the whole line since D24: the driver no longer picks a category,
 * so there is none to read back, and a line naming one the receiver has not
 * chosen yet would be inventing it.
 */
export function flaggedLine(donation: DonationSummary): string {
  return donation.donorDisplay;
}

/** The I29 refusal, told apart from every other failure so it can be shown next to
 *  the store picker that caused it instead of as a passing toast. */
export function isOnRouteRefusal(error: unknown): boolean {
  return toApiError(error).detail === DONATION_ON_ROUTE_MESSAGE;
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
 *   - The DRIVER's run may be called complete (D23); the shift may not. I11
 *     (locked) makes the receiver's receive-done the only completion action and
 *     I12 holds `COMPLETED` behind every stop being WEIGHED, so no sentence here
 *     may say the food is done, weighed, or reported.
 *   - Nothing may promise the pantry was told. The truck-inbound alert is the one
 *     piece of cap 13 held back to Phase 2 (PRD §5), and the server deliberately
 *     enqueues nothing, so copy that says "we let them know" would be false.
 *
 * And one rule about what is NOT here (D21): a hint that only restates the
 * control under it is noise on a screen read one-handed in a truck. Several were
 * deleted. What stays is what a driver cannot see for themselves — the
 * consequence of a one-way action, why something is blocked, what a number means.
 *
 * No em dash anywhere below, either (D21). Two sentences, or a comma.
 */
export const COPY = {
  // --- start step ---------------------------------------------------------
  pickTruck: 'Pick your truck',
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
  skipConsequence: 'It stays skipped for the rest of the run. You cannot undo it here.',
  skipConfirm: 'Skip stop',
  moveUp: 'Move up',
  moveDown: 'Move down',
  movedHint: 'Staff moved this stop to another driver. It is off your run.',
  // --- one stop at a time (D21) -------------------------------------------
  showStop: 'Show this stop',
  hideStop: 'Hide this stop',
  // --- finding the door (D20) ---------------------------------------------
  openInMaps: 'Open in Maps',
  storePhotoLabel: 'Store photo',
  // Kept: the driver is looking at a grey box and cannot tell whether the photo
  // is missing, still coming, or broken.
  photoUnavailable: 'The store photo did not load.',
  noStops: 'This run has no stops.',
  noStopsNext: 'There is nothing to pick up, so you can head back whenever you like.',

  // --- completing the run (D23, I27) --------------------------------------
  //
  // "Complete this run" is the human's word, taken as asked and stated once here
  // so nobody reads it as a state change: what completes is the DRIVER's work.
  // The shift stays `IN_PROGRESS` because I11 (locked) makes the receiver's
  // receive-done the only completion action and I12 will not let a shift reach
  // `COMPLETED` until every stop is WEIGHED, which needs a scale the driver does
  // not have. So nothing below may claim the pantry is finished with the food.
  completeRun: 'Complete this run',
  completeQuestion: 'Complete this run?',
  /** The one thing confirming takes away, said before it is taken (§6). */
  completeConsequence:
    'Your note is saved with the run and you cannot change it afterwards. The pantry weighs the food and finishes the run from there.',
  completeConfirm: 'Complete this run',
  completeToast: 'Run completed. The pantry takes it from here.',
  runNoteLabel: 'Note about the whole run',
  backToStops: 'Back to my stops',

  // --- the run afterwards, read only (D23) --------------------------------
  completedTitle: 'You completed this run',
  completedNoteLabel: 'Your note about the run',
  completedNoNote: 'You did not leave a note.',
  /** The way off a read-only, nav-less screen. Not an action on the run. */
  summaryLeave: 'Go home',
  /** The cost of a read-only summary, said out loud rather than discovered: the
   *  flag is gone with every other action, so a driver who remembers an extra
   *  pickup needs a person. */
  summaryNoFlag:
    'You can no longer add an extra pickup here. Phone the pantry if you picked up somewhere that is not on this list.',

  // --- flag a stop not on my route (cap 12) -------------------------------
  // Nothing here may promise anyone was told, for the same reason as above: the
  // flag writes a row the receiver finds on their own screen (S2.3). It sends no
  // alert of its own, and the truck-inbound one belongs to "Heading back".
  flagAdHoc: 'Flag a stop not on my route',
  flagTitle: 'A stop not on my route',
  flagStoreLabel: 'Which store?',
  // Kept: a driver looking for a store that is missing from the list cannot
  // otherwise tell whether it is absent or already handled.
  flagStoreHint: 'Stops already on your route are not listed. Add their food to the stop itself.',
  flagOtherStore: 'Other',
  flagOtherStoreLabel: 'Store name',
  /** D24 took the anonymous option away, so "Other" cannot be finished without a
   *  name. Shown where the empty box is, not as a hint under the label. */
  flagOtherStoreRequired: 'Type the store name to flag this pickup.',
  flagNoteLabel: 'Note for the pantry',
  flagSubmit: 'Flag this pickup',
  flagSuccess: 'Flagged. The pantry weighs it when you get back.',
  flagNoDonors: 'No stores to pick from.',
  flagNoDonorsNext: 'Type the store name instead, or ask an admin to add the store.',
  // I14: a driver-add writes no ShiftStop, so the label has to keep these apart
  // from the route above it. It is the label doing that job now, not a hint under
  // the list repeating it (D21).
  flaggedListLabel: 'Extra pickups you flagged, not stops on your route',
  // Kept: the list really does vanish on reload, and nothing on screen says the
  // rows are safe on the server.
  flaggedListNote: 'This list clears if you reload. The pantry keeps what you flagged.',

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
