// The two calls S1.2 makes. Both go through the typed fetch layer — a raw `fetch`
// would miss the sign-in cookie, the one error shape (§6) and the offline banner
// all at once (`api/client.ts`).
//
// Shapes come from `client/src/api/shared.ts`, the client's door into `shared/src`,
// and never from the package specifier: inside a git worktree that resolves to the
// main checkout's copy (build-plan §3), so it would typecheck a lane's client
// against a different file than the one the lane is writing (A34 / A78).

import { api } from '../../../api/index.ts';
import type { ClaimResult, ClaimScope, ShiftSummary } from '../../../api/shared.ts';
import type { BoardFilter } from './board.ts';

/**
 * The board (`GET /api/shifts`).
 *
 * `open` and `mine` are the server's own names for S1.2's segmented control, so the
 * filter is applied once, in the query, rather than fetched whole and sieved here.
 * `CANCELLED` runs are off the board by default and stay that way — I10 makes the
 * state terminal and S1.2 has no cancelled row.
 *
 * `from` bounds the board to today forward. There is no `to`: how far ahead runs
 * exist is already bounded by `app_config.horizon_days` at materialization.
 */
export function fetchBoard(
  filter: BoardFilter,
  fromDate: string,
  signal?: AbortSignal,
): Promise<ShiftSummary[]> {
  return api.get<ShiftSummary[]>('/shifts', {
    query: {
      from: fromDate,
      ...(filter === 'OPEN' ? { open: true } : {}),
      ...(filter === 'MINE' ? { mine: true } : {}),
    },
    ...(signal ? { signal } : {}),
  });
}

/**
 * Claim (`POST /api/shifts/:id/claim`).
 *
 * `SERIES` is §5.3's `claim-all` and is offered only on a repeating run. Either
 * scope can answer 409: `SHIFT_UNAVAILABLE` when the run moved on first (§6's
 * revert) or `NOT_ELIGIBLE` when I20's gate refused. Both arrive as an `ApiError`
 * carrying the server's own sentence in `detail`, which the screen shows verbatim
 * rather than inventing a parallel wording.
 */
export function claimRun(shiftId: string, scope: ClaimScope): Promise<ClaimResult> {
  return api.post<ClaimResult>(`/shifts/${encodeURIComponent(shiftId)}/claim`, {
    body: { scope },
  });
}
