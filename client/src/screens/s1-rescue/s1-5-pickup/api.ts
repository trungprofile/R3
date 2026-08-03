// The requests S1.5 makes, and no others.
//
// All of them go through the typed fetch layer (`client/src/api/client.ts`),
// which carries the sign-in cookie, turns every failure into one plain message
// (§6) and raises the blocking offline banner. A raw `fetch` from a screen would
// miss all three.
//
// NOTHING HERE QUEUES OR RETRIES. Offline support is an explicit non-goal
// (`architecture.md §4.5`: the service worker is push-only and never cache-first),
// and §6 makes retry a visible affordance the driver taps, not a silent loop. A
// truck with no signal shows the banner and the tap waits — which is the honest
// behaviour, and the one the driver can reason about.
//
// There is no "close the run" call, because there is no such endpoint: the
// receiver's receive-done is the only completion action and it ships in Phase 2
// (I11, build-plan D1).

import { api } from '../../../api/index.ts';
import type {
  DonationSummary,
  DonorSummary,
  DriverResolution,
  FlagAdHocRequest,
  RunDetail,
  RunStopSummary,
  TruckSummary,
} from '../../../api/shared.ts';

function runPath(shiftId: string): string {
  return `/shifts/${encodeURIComponent(shiftId)}`;
}

function stopPath(shiftId: string, stopId: string): string {
  return `${runPath(shiftId)}/stops/${encodeURIComponent(stopId)}`;
}

/** The run: shift, truck, both note channels, and the ordered stops. Empty until
 *  the run starts — stop rows exist only from `IN_PROGRESS` onward (I5). */
export function fetchRun(shiftId: string, signal: AbortSignal): Promise<RunDetail> {
  return api.get<RunDetail>(`${runPath(shiftId)}/run`, { signal });
}

/** The truck list for the start step. Active trucks only — the server's default
 *  (`domain-modeling.md §3.3`). */
export function fetchTrucks(signal: AbortSignal): Promise<TruckSummary[]> {
  return api.get<TruckSummary[]>('/trucks', { signal });
}

/** Start: `CLAIMED → IN_PROGRESS`, truck picked, route snapshotted (I5/I8). One
 *  request, because the server makes them one transaction. */
export function startRun(shiftId: string, truckId: string): Promise<RunDetail> {
  return api.post<RunDetail>(`${runPath(shiftId)}/start`, { body: { truckId } });
}

/** Check off or skip one stop. Idempotent server-side, so a double-tap on a bad
 *  connection is not an error (A83) — and there is no un-check to send, since the
 *  ShiftStop machine has no edge back to `PENDING`. */
export function resolveStop(
  shiftId: string,
  stopId: string,
  disposition: DriverResolution,
): Promise<RunStopSummary> {
  return api.post<RunStopSummary>(`${stopPath(shiftId, stopId)}/resolve`, {
    body: { disposition },
  });
}

/** The driver→receiver note for one stop (cap 11, channel 2). */
export function saveStopNote(
  shiftId: string,
  stopId: string,
  note: string | null,
): Promise<RunStopSummary> {
  return api.patch<RunStopSummary>(stopPath(shiftId, stopId), { body: { note } });
}

/** The new order. The list carries it; the server assigns the numbers. */
export function saveOrder(shiftId: string, stopIds: readonly string[]): Promise<RunStopSummary[]> {
  return api.post<RunStopSummary[]>(`${runPath(shiftId)}/stops/order`, {
    body: { stopIds: [...stopIds] },
  });
}

/**
 * "Complete this run" (I27, D23). Sets `Shift.pickup_completed_at` and carries the
 * confirm modal's run note in the same request.
 *
 * UNCHANGED BY D23 — same endpoint, same body, same effect. What changed is the
 * word on the button and what the screen does afterwards. The body deliberately
 * has no `status` field and there is nowhere to put one: the milestone does not
 * change the shift's state (I27), I11 (locked) makes the receiver's receive-done
 * the only completion, and I12 holds `COMPLETED` behind every stop being WEIGHED.
 *
 * There is no `saveRunNote` beside it any more. The note is written once, with
 * this request, and locks — so a second write path would be a way to edit
 * something the summary says cannot be edited (D23).
 */
export function confirmHeadingBack(shiftId: string, note: string | null): Promise<RunDetail> {
  return api.post<RunDetail>(`${runPath(shiftId)}/pickup-complete`, { body: { note } });
}

// ---------------------------------------------------------------------------
// "Flag a stop not on my route" — the driver's half of cap 12 (Phase 2)
// ---------------------------------------------------------------------------

/** The master store list for the flag's picker. Active only: the server's default
 *  is the active set, and a deactivated donor would be refused on submit (I21).
 *  Donor `address` and `contact` arrive whole — `pii.ts` gates people, not places. */
export function fetchDonors(signal: AbortSignal): Promise<DonorSummary[]> {
  return api.get<DonorSummary[]>('/donors', { signal });
}

/**
 * The same list, for the two things the run payload does not carry: the map link
 * and whether a photo exists (D20).
 *
 * `RunStopSummary` deliberately holds no donor fields beyond the ones it renders
 * (`shared/src/execution.ts`), so the screen joins by donor id rather than the run
 * endpoint growing two columns. It is one small list at ~15 stores.
 *
 * `includeInactive` because a deactivated donor can still be a stop on a run in
 * flight — I21 preserves it everywhere it is referenced — and that driver still
 * has to find its door. The photo bytes are NOT here: `hasPhoto` is a flag, and
 * `GET /donors/:id/photo` is what the `<img>` asks for.
 */
export function fetchDonorPlaces(signal: AbortSignal): Promise<DonorSummary[]> {
  return api.get<DonorSummary[]>('/donors', {
    query: { includeInactive: true },
    signal,
  });
}

/**
 * Record an ad-hoc pickup mid-run: a `SUGGESTED` UnscheduledDonation that prefills
 * S2.3 for the receiver (PRD cap 12).
 *
 * **No weight.** The driver has no scale; the receiver weighs it later, and I16a
 * only requires a weight once the row is `CONFIRMED`.
 *
 * **And no category, since D24.** `domain-modeling.md §2.3` was amended under
 * explicit human authorization so `Category` is required on `CONFIRMED` only, not
 * at creation: a driver at a loading dock cannot know which category a mixed
 * pallet reports under, and the receiver picks it at S2.3 where it is refused
 * without one. This supersedes D8, and makes `ui-ux-spec.md:193`'s "just a donor
 * picker … and an optional note" describe the screen accurately again.
 *
 * This NEVER creates a `ShiftStop` (I14) — there is no stop-shaped field to send —
 * and the server refuses a donor already on this run (I29) with
 * `DONATION_ON_ROUTE_MESSAGE`.
 */
export function flagAdHocPickup(
  shiftId: string,
  request: FlagAdHocRequest,
): Promise<DonationSummary> {
  return api.post<DonationSummary>(`${runPath(shiftId)}/donations`, { body: request });
}
