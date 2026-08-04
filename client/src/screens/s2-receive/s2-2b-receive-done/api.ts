// The three requests S2.2b makes, and no others. Two reads and the one write.
//
// All go through the typed fetch layer (`client/src/api/client.ts`) so they
// carry the sign-in cookie, turn every failure into one plain message (§6) and
// raise the blocking offline banner. A raw `fetch` from a screen misses all three.
//
// NOTHING HERE RETRIES. §6 makes retry a visible affordance the receiver taps,
// and this screen's one write is irreversible (I11) — a silent second attempt is
// the last thing it should do.

import { api } from '../../../api/index.ts';
import type { ReceiveDoneSummary, ReceiveRunSummary } from '../../../api/shared.ts';

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
 * The same run as the picker sees it, or `null` if the picker no longer sees it
 * at all (`D37`).
 *
 * The summary above cannot answer "is this run still open?" — it carries
 * `readyForReceiveDone`, which stays true after the run closes, so a receiver who
 * came back to a finished run was offered **Receive done** a second time and got a
 * refusal for their trouble.
 *
 * `GET /receive/runs` can answer it, because `listReceivableRuns()` returns
 * `IN_PROGRESS` shifts and nothing else (A162). A shift missing from that list is
 * one the server will not accept a receiver's write on — which is the same guard it
 * applies before every weight change, so the screen is reading the existing rule
 * rather than inventing a second one.
 *
 * Being IN_PROGRESS is only *half* that guard; the other half is the day-based edit
 * window. That gap is CLOSED as of `D47` — `readReceiveDone` now surfaces the
 * server's own evaluation of the window as `editWindowOpen` on `ReceiveDoneSummary`,
 * and `canEditWeights` takes both halves. This read still answers only the first,
 * and still errs toward offering when it cannot answer at all.
 *
 * A courtesy, never the rule. If this read fails the screen behaves exactly as it
 * did before (`architecture.md §4.5`) — the run is closed by `receiveDone()` inside
 * a SERIALIZABLE transaction that checks I11 and I12 for itself.
 */
export interface OpenRunAnswer {
  /** The run, or null because the server no longer lists it as receivable. The
   *  answer is wrapped so that "not loaded yet" and "loaded, and it is closed" are
   *  two different values rather than both being `null` in `useAsyncData`. */
  run: ReceiveRunSummary | null;
}

export function fetchOpenRun(shiftId: string, signal: AbortSignal): Promise<OpenRunAnswer> {
  return api
    .get<ReceiveRunSummary[]>('/receive/runs', { signal })
    .then((runs) => ({ run: runs.find((each) => each.shiftId === shiftId) ?? null }));
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
