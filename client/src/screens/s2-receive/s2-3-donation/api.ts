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

/** One donation, by id — what `/donations/:id/weigh` opens on (`D76`).
 *
 * The row is fetched rather than handed over by the screen that linked here, so a
 * reload on a docked tablet lands on the same donation instead of on nothing. It
 * is also the fresher answer: on a shared tablet the row may already have been
 * confirmed at the other counter, and a 404 here is how this screen finds out.
 */
export function fetchDonation(id: string, signal: AbortSignal): Promise<DonationSummary> {
  return api.get<DonationSummary>(donationPath(id), { signal });
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
  /** The driver's row being weighed, or null on `/donations/new`. */
  donation: DonationSummary | null;
  categories: CategorySummary[];
  donors: DonorSummary[];
}

/**
 * Everything the screen opens with, in one hook's worth of loading.
 *
 * Separate requests rather than one endpoint, because the master lists are shared
 * with S1.8 and S2.2 and are cheap; `Promise.all` keeps them to a single round
 * trip's latency and a single skeleton (§6).
 *
 * The donors are fetched even on a driver's row, where the picker is not shown:
 * the list is small, and a screen whose request shape changes with its mode is one
 * more thing to get wrong for no measurable gain.
 */
export async function fetchDonationScreen(
  donationId: string | null,
  signal: AbortSignal,
): Promise<DonationScreenData> {
  const [donation, categories, donors] = await Promise.all([
    donationId ? fetchDonation(donationId, signal) : Promise.resolve(null),
    fetchCategories(signal),
    fetchDonors(signal),
  ]);
  return { donation, categories, donors };
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
