// The requests S2.2 makes, and no others.
//
// All of them go through the typed fetch layer (`client/src/api/client.ts`),
// which carries the sign-in cookie, turns every failure into one plain message
// (§6) and raises the blocking offline banner. A raw `fetch` from a screen would
// miss all three.
//
// EVERY MUTATION RETURNS THE WHOLE SHEET. `ReceiveStopDetail` is the response of
// add, revise, remove and skip alike, so this screen re-renders from the server's
// answer instead of patching a local copy. That is not laziness: two receivers
// may work different stops of the same run at once (S2.1b), and a subtotal
// patched locally would drift from the `SUM(non-voided)`-on-read totals (I13) the
// moment someone else touched the same stop.
//
// NOTHING HERE QUEUES OR RETRIES. Offline support is an explicit non-goal
// (`architecture.md §4.5`), and §6 makes retry a visible affordance the receiver
// taps rather than a silent loop.

import {
  ApiError,
  api,
  isOnline,
  kindForStatus,
  reportActivity,
  reportNetworkFailure,
  reportNetworkSuccess,
} from '../../../api/index.ts';
import type {
  AddWeightRequest,
  ReceiveStopDetail,
  ReceiveStopSummary,
  ReviseWeightRequest,
  SkipStopRequest,
} from '../../../api/shared.ts';

const RUNS = '/receive/runs';

function runPath(shiftId: string): string {
  return `${RUNS}/${encodeURIComponent(shiftId)}`;
}

function stopPath(shiftId: string, stopId: string): string {
  return `${runPath(shiftId)}/stops/${encodeURIComponent(stopId)}`;
}

function weightPath(shiftId: string, stopId: string, entryId: string): string {
  return `${stopPath(shiftId, stopId)}/weights/${encodeURIComponent(entryId)}`;
}

/** The sheet for one stop of one run: the live active-category tiles, their
 *  entries, their subtotals, and the three read-only note channels. */
export function fetchStopSheet(
  shiftId: string,
  stopId: string,
  signal: AbortSignal,
): Promise<ReceiveStopDetail> {
  return api.get<ReceiveStopDetail>(stopPath(shiftId, stopId), { signal });
}

/** The stop strip — every stop on this run with its projected state (I12). Read
 *  separately from the sheet because it spans stops and the sheet is one stop. */
export function fetchRunStops(shiftId: string, signal: AbortSignal): Promise<ReceiveStopSummary[]> {
  return api.get<ReceiveStopSummary[]>(`${runPath(shiftId)}/stops`, { signal });
}

/** "Add weight". Confirms immediately — there is no draft row and no sign-off at
 *  the entry level (PRD cap 14). */
export function addWeight(
  shiftId: string,
  stopId: string,
  body: AddWeightRequest,
): Promise<ReceiveStopDetail> {
  return api.post<ReceiveStopDetail>(`${stopPath(shiftId, stopId)}/weights`, { body });
}

/**
 * The ✎ overwrite.
 *
 * One request, not delete-then-add: the server voids the old row and inserts the
 * new one in a single transaction with a conditional void, so two receivers
 * correcting the same number produce one void and one refusal rather than two
 * rows and a doubled total (I13). Splitting it here would give that guarantee
 * away.
 */
export function reviseWeight(
  shiftId: string,
  stopId: string,
  entryId: string,
  body: ReviseWeightRequest,
): Promise<ReceiveStopDetail> {
  return put<ReceiveStopDetail>(weightPath(shiftId, stopId, entryId), body);
}

/** Take a number off the sheet. The server voids the row and retains it (I13);
 *  to the receiver it is simply gone, which is the only vocabulary S2.2 uses. */
export function removeWeight(
  shiftId: string,
  stopId: string,
  entryId: string,
): Promise<ReceiveStopDetail> {
  return api.delete<ReceiveStopDetail>(weightPath(shiftId, stopId, entryId));
}

/** "Skip stop" — nothing came from this store (`domain-modeling.md §3.2`,
 *  receiver branch). The server refuses it once weights exist. */
export function skipStop(
  shiftId: string,
  stopId: string,
  body: SkipStopRequest = {},
): Promise<ReceiveStopDetail> {
  return api.post<ReceiveStopDetail>(`${stopPath(shiftId, stopId)}/skip`, { body });
}

// ---------------------------------------------------------------------------
// PUT, until the shared client has one
// ---------------------------------------------------------------------------

/**
 * `api` exposes get/post/patch/delete and no `put`, while the revise route is
 * registered as a PUT (`routes/receive.ts`: "a PUT, not a PATCH, because the
 * entry is replaced rather than merged"). This lane may not edit
 * `client/src/api/client.ts`, so the verb is bridged here.
 *
 * It behaves identically to `client.ts`'s own `send` and reuses that module's
 * exported primitives rather than re-deciding anything: same cookie mode, same
 * `ApiError` shape (§6), same offline reporting that raises the blocking banner,
 * same activity ping on an accepted request. **The intended fix is a one-line
 * `put` on `api`**, after which this function and its one call site collapse to
 * `api.put` — reported to the lead rather than made here.
 */
async function put<T>(path: string, body: unknown): Promise<T> {
  if (!isOnline()) throw new ApiError('offline');

  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    reportNetworkFailure();
    throw new ApiError('offline');
  }

  reportNetworkSuccess();
  // A request the server accepted slid the sign-in clock; a refused one did not.
  if (response.ok) reportActivity();

  if (!response.ok) {
    const detail = await readMessage(response);
    throw new ApiError(kindForStatus(response.status), {
      status: response.status,
      ...(detail === null ? {} : { detail }),
    });
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError('server', { status: response.status });
  }
}

/** The server's own sentence for a refusal, if it sent one. Never the code and
 *  never the correlation identifier (§6). */
async function readMessage(response: Response): Promise<string | null> {
  try {
    const parsed: unknown = await response.json();
    if (parsed !== null && typeof parsed === 'object' && 'message' in parsed) {
      const message = (parsed as { message?: unknown }).message;
      if (typeof message === 'string') return message;
    }
  } catch {
    // No body, or not JSON. The per-kind message covers it.
  }
  return null;
}
