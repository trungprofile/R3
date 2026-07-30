// The two requests S2.2b makes, and no others.
//
// Both go through the typed fetch layer (`client/src/api/client.ts`) so they
// carry the sign-in cookie, turn every failure into one plain message (§6) and
// raise the blocking offline banner. A raw `fetch` from a screen misses all three.
//
// NOTHING HERE RETRIES. §6 makes retry a visible affordance the receiver taps,
// and this screen's one write is irreversible (I11) — a silent second attempt is
// the last thing it should do.

import { api } from '../../../api/index.ts';
import type { ReceiveDoneSummary } from '../../../api/shared.ts';

function donePath(shiftId: string): string {
  return `/receive/runs/${encodeURIComponent(shiftId)}/done`;
}

/**
 * The summary read before the one irreversible tap: every stop, its state, its
 * total, and whether the run is ready at all (I12).
 *
 * `readyForReceiveDone` is the server's answer and the only one this screen
 * trusts — it is computed over the WEIGHED projection (a stop reads as weighed iff
 * a non-voided `weight_entry` exists), which the client cannot see.
 */
export function fetchReceiveDone(
  shiftId: string,
  signal: AbortSignal,
): Promise<ReceiveDoneSummary> {
  return api.get<ReceiveDoneSummary>(donePath(shiftId), { signal });
}

/**
 * What receive-done gives back.
 *
 * Not in `shared/src`: per-endpoint response shapes arrive with the screen they
 * belong to (`client/src/api/index.ts`). `purgedSuggestions` is the count of the
 * driver's unconfirmed ad-hoc flags deleted inline by this transaction (I17) — a
 * prefill nobody weighed is not intake, so it goes rather than lingering as a
 * ghost row on S2.3.
 */
export interface ReceiveDoneResult {
  shiftId: string;
  purgedSuggestions: number;
}

/**
 * Close the run: `IN_PROGRESS → COMPLETED` (I11). The only completion action in
 * the whole product, and it has no undo — which is why the screen confirms first.
 *
 * Deliberately not gated by the receiver edit window (build-plan D9): closing a
 * run is the completion, not an edit, and a window-gated close would leave a
 * lapsed run permanently unclosable.
 */
export function confirmReceiveDone(shiftId: string): Promise<ReceiveDoneResult> {
  return api.post<ReceiveDoneResult>(donePath(shiftId));
}
