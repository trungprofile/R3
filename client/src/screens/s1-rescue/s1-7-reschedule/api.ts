// S1.7's two calls, both through the typed fetch layer.
//
// `fetch` is never called directly: a raw call would miss the session cookie, the
// one error shape (§6) and the offline banner all at once.
//
// THERE IS NO THIRD CALL, AND THAT IS THE INTERESTING PART. Cap 9 needs the owner's
// conflicts against the PROPOSED window before staff confirms, and
// `GET /shifts/:id/eligibility?driverId=` cannot answer that: `previewAssignment`
// evaluates the driver against the shift's currently STORED window
// (`services/coverage.ts`), which is the window the owner already works, and takes
// no proposed date/time. The check S1.7 needs is the UNCONFIRMED reschedule below —
// `services/schedule.ts` gathers `ownerConflicts()` and throws 409
// `RESCHEDULE_CONFLICT` before it writes anything, so the transaction rolls the read
// back and the run has not moved when the warning reaches the screen. See the
// report's `Assumed:`.

import { api } from '../../../api/index.ts';
import type {
  RescheduleShiftRequest,
  RescheduleShiftResponse,
  ShiftDetail,
} from '../../../api/shared.ts';

/** The run being moved. `GET /shifts/:id` is `{ tier: 'VOLUNTEER' }` — staff read it
 *  through the same route the board does; the move itself is `{ tier: 'STAFF' }`. */
export function fetchRun(shiftId: string, signal: AbortSignal): Promise<ShiftDetail> {
  return api.get<ShiftDetail>(`/shifts/${encodeURIComponent(shiftId)}`, { signal });
}

/**
 * Move the run. Calendar date and wall-clock times only — the server resolves them
 * against `app_config.timezone` (`shared/src/schedule.ts`).
 *
 * Two outcomes worth naming: with `confirmRelease` absent, a 409 carrying
 * `RESCHEDULE_CONFLICT` means the owner cannot work the new window and NOTHING has
 * changed; with it set, `released: true` in the response means the owner was let go
 * and the run is back on the board as open. Nobody is picked to replace them —
 * cap 9 forbids it, and no code here would know how.
 */
export function moveRun(
  shiftId: string,
  request: RescheduleShiftRequest,
): Promise<RescheduleShiftResponse> {
  return api.post<RescheduleShiftResponse>(
    `/shifts/${encodeURIComponent(shiftId)}/reschedule`,
    { body: request },
  );
}
