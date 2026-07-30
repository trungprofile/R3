// The requests S2.3 makes, and no others.
//
// All of them go through the typed fetch layer (`client/src/api/client.ts`),
// which carries the sign-in cookie, turns every failure into one plain message
// (§6) and raises the blocking offline banner. A raw `fetch` from a screen would
// miss all three.
//
// NOTHING HERE QUEUES OR RETRIES. Offline is an explicit non-goal
// (`architecture.md §4.5`), and §6 makes retry a visible affordance the receiver
// taps rather than a silent loop.
//
// WEIGHTS CROSS AS DECIMAL STRINGS (A165). `numeric(8,2)` is exact and a JS
// number is not; this column feeds the NTFB report, so nothing in this file ever
// parses or re-serialises one.

import { api } from '../../../api/index.ts';
import type {
  CategorySummary,
  ConfirmDonationRequest,
  CreateDonationRequest,
  DonationSummary,
  DonorSummary,
} from '../../../api/shared.ts';

function donationPath(id: string): string {
  return `/donations/${encodeURIComponent(id)}`;
}

/**
 * The worklist: every row awaiting confirmation, plus the recently confirmed
 * ones so a correction is reachable without hunting for it.
 *
 * The recency window is the server's (7 days, A166) and is deliberately not
 * mirrored here — a second copy of an invented number is a drift hazard for no
 * gain.
 */
export function fetchWorklist(signal: AbortSignal): Promise<DonationSummary[]> {
  return api.get<DonationSummary[]>('/donations', { signal });
}

/** What one driver flagged on one run. Used when S2.3 is opened in the context of
 *  a run being weighed, so the receiver sees that run's prefills rather than the
 *  whole pantry's. */
export function fetchShiftDonations(
  shiftId: string,
  signal: AbortSignal,
): Promise<DonationSummary[]> {
  return api.get<DonationSummary[]>(`/shifts/${encodeURIComponent(shiftId)}/donations`, {
    signal,
  });
}

/** Active categories — the tile set renders from live data, never a hardcoded
 *  list (S1.8/S2.2), so an archived category disappears from new entry while its
 *  history keeps resolving. `/categories` returns the active set by default. */
export function fetchCategories(signal: AbortSignal): Promise<CategorySummary[]> {
  return api.get<CategorySummary[]>('/categories', { signal });
}

/** The master donor list for the picker. Active only, same default. */
export function fetchDonors(signal: AbortSignal): Promise<DonorSummary[]> {
  return api.get<DonorSummary[]>('/donors', { signal });
}

export interface DonationScreenData {
  rows: DonationSummary[];
  categories: CategorySummary[];
  donors: DonorSummary[];
}

/**
 * Everything the screen opens with, in one hook's worth of loading.
 *
 * Three requests rather than one endpoint, because the master lists are shared
 * with S1.8 and S2.2 and are cheap; `Promise.all` keeps them to a single round
 * trip's latency and a single skeleton (§6).
 */
export async function fetchDonationScreen(
  shiftId: string | null,
  signal: AbortSignal,
): Promise<DonationScreenData> {
  const [rows, categories, donors] = await Promise.all([
    shiftId ? fetchShiftDonations(shiftId, signal) : fetchWorklist(signal),
    fetchCategories(signal),
    fetchDonors(signal),
  ]);
  return { rows, categories, donors };
}

/** Record a donation from scratch — a walk-in or a relayed store call. Born
 *  `CONFIRMED`, so a weight is required (I16a) and attribution is required unless
 *  the report toggle is off (I16b). Never carries a shift: a receiver-authored
 *  donation is off-plan by definition (build-plan D10). */
export function createDonation(body: CreateDonationRequest): Promise<DonationSummary> {
  return api.post<DonationSummary>('/donations', { body });
}

/** Confirm a driver's prefill: `SUGGESTED → CONFIRMED`. The driver's donor and
 *  category are a prefill, not a commitment — the receiver is the one who sees
 *  the food and may correct either. */
export function confirmDonation(
  id: string,
  body: ConfirmDonationRequest,
): Promise<DonationSummary> {
  return api.post<DonationSummary>(`${donationPath(id)}/confirm`, { body });
}

/** The report flag on its own — a plain field edit, last write wins (PRD cap 15),
 *  and not the void-and-reinsert path a weight takes. */
export function setReportable(id: string, reportable: boolean): Promise<DonationSummary> {
  return api.patch<DonationSummary>(`${donationPath(id)}/reportable`, {
    body: { reportable },
  });
}

/** Throw away a prefill that was not a real pickup. `SUGGESTED` only — a
 *  confirmed row is intake and is never deleted. */
export function discardSuggestion(id: string): Promise<void> {
  return api.delete<void>(donationPath(id));
}
