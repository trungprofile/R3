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
  CategorySummary,
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

/** The driver's whole-run note (cap 11, channel 3) on its own — used when the
 *  milestone is already set and the driver is only editing the note (A89/A90). */
export function saveRunNote(shiftId: string, note: string | null): Promise<RunDetail> {
  return api.patch<RunDetail>(`${runPath(shiftId)}/note`, { body: { note } });
}

/**
 * "Confirm — heading back" (I27). Sets `Shift.pickup_completed_at` and carries the
 * review screen's last edit of the run note in the same request.
 *
 * The body deliberately has no `status` field and there is nowhere to put one:
 * the milestone does not change the shift's state (I27), and in Phase 1 nothing
 * ever does after start (D1).
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

/** The category list for the flag's picker. Active only, same reason, and the set
 *  is live admin data (S1.8) rather than the 11 seeded names hardcoded. */
export function fetchCategories(signal: AbortSignal): Promise<CategorySummary[]> {
  return api.get<CategorySummary[]>('/categories', { signal });
}

/**
 * Record an ad-hoc pickup mid-run: a `SUGGESTED` UnscheduledDonation that prefills
 * S2.3 for the receiver (PRD cap 12).
 *
 * **No weight.** The driver has no scale; the receiver weighs it later, and I16a
 * only requires a weight once the row is `CONFIRMED`.
 *
 * **A category, though** — `domain-modeling.md §2.3` (locked) makes `Category`
 * required on `UnscheduledDonation` with no `SUGGESTED` exemption, while
 * `ui-ux-spec.md:193` calls this control "just a donor picker … and an optional
 * note". The locked doc wins; build-plan D8 records the conflict and the human
 * escalation. The receiver may correct the pick at confirm time, which is what
 * makes it a prefill rather than a commitment.
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
