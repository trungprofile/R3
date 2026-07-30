// The requests S1.3 makes, and no others.
//
// Every one goes through the typed fetch layer (`client/src/api/client.ts`), which
// carries the sign-in cookie, turns each failure into one plain message (§6) and
// raises the blocking offline banner. A raw `fetch` from a screen would miss all
// three.
//
// Nothing here queues or retries. Offline support is an explicit non-goal
// (`architecture.md §4.5`) and §6 makes retry a visible affordance the user taps.
//
// Two things this file deliberately does NOT have:
//
//   - a call that closes, completes or finishes a run. The receiver's receive-done
//     is the only completion action and it ships in Phase 2 (I11, build-plan D1).
//   - staff's bulk-terminate. S1.3 is the DRIVER's release — `CLAIMED → OPEN`, the
//     runs go back on the board, the series keeps generating (I23). Terminating
//     part of a series is `POST /patterns/:id/terminate`, staff-only, and belongs
//     to S1.6. Putting both on one screen is exactly the confusion S1.3 warns of.
//
// The coordinator→driver note is written through `PATCH /shifts/:id` with a
// `staffNote` field, NOT through `PATCH /shifts/:id/note` — that second route is
// the DRIVER's whole-run note (`Shift.note`, cap 11 channel 3) and is declared
// `anyDuty: ['DRIVE']`. Two different note fields, two different writers
// (`services/schedule.ts` vs `services/execution.ts`).

import { api } from '../../../api/index.ts';
import type {
  ReassignStopResponse,
  ReleaseRequest,
  ReleaseResult,
  RunDetail,
  ShiftDetail,
  ShiftSummary,
} from '../../../api/shared.ts';

function shiftPath(shiftId: string): string {
  return `/shifts/${encodeURIComponent(shiftId)}`;
}

/** The run: its window, owner, truck, both note channels, the conflict flag, and
 *  the ROUTE's stops. I5 means a not-yet-started run's list is still the
 *  template's, which is why this and `fetchRun` are two calls. */
export function fetchShift(shiftId: string, signal: AbortSignal): Promise<ShiftDetail> {
  return api.get<ShiftDetail>(shiftPath(shiftId), { signal });
}

/** The live stop list — real `ShiftStop` rows with ids and dispositions. Empty
 *  before the run starts (I5), so the screen only asks once it is `IN_PROGRESS`. */
export function fetchRun(shiftId: string, signal: AbortSignal): Promise<RunDetail> {
  return api.get<RunDetail>(`${shiftPath(shiftId)}/run`, { signal });
}

/** Every run on a single day — the source for the reassign driver picker. */
export function fetchShiftsOn(date: string, signal: AbortSignal): Promise<ShiftSummary[]> {
  return api.get<ShiftSummary[]>('/shifts', { query: { from: date, to: date }, signal });
}

/** This driver's own runs in one repeating series, from this run's day forward —
 *  the days S1.3's "this and future" range can end on. */
export function fetchSeriesRuns(
  patternId: string,
  fromDate: string,
  signal: AbortSignal,
): Promise<ShiftSummary[]> {
  return api.get<ShiftSummary[]>('/shifts', {
    query: { patternId, from: fromDate, mine: 'true' },
    signal,
  });
}

/** The coordinator→driver note (cap 11, channel 1). `null` clears it; the server
 *  reads absent as "leave it alone", so the field is always sent. */
export function saveStaffNote(shiftId: string, staffNote: string | null): Promise<ShiftSummary> {
  return api.patch<ShiftSummary>(shiftPath(shiftId), { body: { staffNote } });
}

/** Release: `CLAIMED → OPEN`, back on the board, coordinator and eligible drivers
 *  told (PRD cap 8). `RANGE` with no `toDate` is S1.3's open-ended "this and
 *  future"; the pattern itself is untouched either way (I23). */
export function releaseRun(shiftId: string, request: ReleaseRequest): Promise<ReleaseResult> {
  return api.post<ReleaseResult>(`${shiftPath(shiftId)}/release`, { body: request });
}

/** Move one unresolved stop to another driver's started run (I30). Never an
 *  in-place move: the server marks this stop `REASSIGNED` and inserts a new
 *  `PENDING` row at the end of the destination's list. */
export function reassignStop(
  shiftId: string,
  stopId: string,
  toShiftId: string,
): Promise<ReassignStopResponse> {
  return api.post<ReassignStopResponse>(
    `${shiftPath(shiftId)}/stops/${encodeURIComponent(stopId)}/reassign`,
    { body: { toShiftId } },
  );
}
