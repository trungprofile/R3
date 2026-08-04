// The two calls S2.1b makes. Both go through the typed fetch layer — a raw
// `fetch` would miss the sign-in cookie, the one error shape (§6) and the offline
// banner all at once (`api/client.ts`).
//
// Shapes come from `client/src/api/shared.ts`, the client's door into `shared/src`,
// and never from the `@r3/shared` specifier: inside a git worktree that resolves to
// the MAIN checkout's copy (build-plan §3), so it would typecheck this lane's
// client against a different file than the one the lane is writing (A34 / A78).

import { api } from '../../../api/index.ts';
import type {
  ReceiveDonationSummary,
  ReceiveRunSummary,
  ReceiveStopSummary,
} from '../../../api/shared.ts';

/**
 * The picker's list (`GET /api/receive/runs`).
 *
 * No filter is sent, and none is offered: `listReceivableRuns()` answers with every
 * `IN_PROGRESS` shift and nothing else (A162). Both halves of that matter here —
 *
 *   - a fully-weighed run STAYS on the list, because S2.2b is reached "from S2.1b
 *     once a run shows all stops done"; dropping it the moment its last stop was
 *     weighed would make receive-done unreachable and the run unclosable (I11);
 *   - the list is NOT bounded to today, because receiving legitimately lags past
 *     midnight and a Tuesday run received at 12:30am Wednesday must stay reachable.
 *
 * Which is why this screen never sends a date and never compares one against the
 * device's clock. Each row states the run's own `occurrenceDate` instead (S2.1b).
 *
 * `D66` did not change any of that. The edit window arrives as a per-row flag on
 * each summary, not as a filter: still no date is sent, still nothing is dropped,
 * and a lapsed run is banded differently rather than hidden — hiding it would
 * strand it, since `receiveDone` is not window-gated and this list is its only
 * route.
 */
export function fetchReceivableRuns(signal?: AbortSignal): Promise<ReceiveRunSummary[]> {
  return api.get<ReceiveRunSummary[]>('/receive/runs', { ...(signal ? { signal } : {}) });
}

/**
 * One run's stops, re-read (`GET /api/receive/runs/:id/stops`).
 *
 * S2.1b: "Multiple receivers can work the same run's different stops
 * independently." The list a receiver is looking at is therefore a snapshot, and
 * the stop it names as next may have been weighed by the person at the other end of
 * the counter since it loaded. Re-reading on the tap is what stops two receivers
 * landing on the same store.
 *
 * A courtesy, not a rule: if this call fails the screen opens the stop it already
 * had, and the server decides what may happen there (`architecture.md §4.5`).
 */
/**
 * The unscheduled-donation card's counts (`GET /api/receive/donations/summary`,
 * `D67`).
 *
 * Its own call rather than a widening of the run list: a walk-in has no run, so it
 * is not a row of that list, and a failure to count donations must not empty the
 * screen a receiver came here to use. The card renders with its title alone if this
 * never answers — it is the only route to S2.3.
 */
export function fetchDonationSummary(signal?: AbortSignal): Promise<ReceiveDonationSummary> {
  return api.get<ReceiveDonationSummary>('/receive/donations/summary', {
    ...(signal ? { signal } : {}),
  });
}

export function fetchRunStops(
  shiftId: string,
  signal?: AbortSignal,
): Promise<ReceiveStopSummary[]> {
  return api.get<ReceiveStopSummary[]>(`/receive/runs/${encodeURIComponent(shiftId)}/stops`, {
    ...(signal ? { signal } : {}),
  });
}
