// The calls S1.6 makes. Every one goes through the typed fetch layer — a raw
// `fetch` would miss the sign-in cookie, the one error shape (§6) and the offline
// banner all at once (`api/client.ts`).
//
// Shapes come from `client/src/api/shared.ts`, the client's door into `shared/src`,
// and never from the `@r3/shared` specifier: inside a git worktree that resolves to
// the MAIN checkout's copy (build-plan §3), so a package import would typecheck
// this lane against a different file than the one being written (A34 / A78).
//
// Nothing here is new server surface. Wave 3 built all of it; this file only names
// the endpoints and the bodies they take. Where a body carries a date or a time it
// is pantry-local `YYYY-MM-DD` / `HH:MM` text and is passed through untouched — the
// server resolves it against `app_config.timezone`, once (`shared/src/schedule.ts`).

import { api } from '../../../api/index.ts';
import type {
  AssignResult,
  BulkTerminateRequest,
  BulkTerminateResponse,
  CancelShiftResponse,
  CreatePatternRequest,
  CreatePatternResponse,
  CreateRouteRequest,
  CreateShiftRequest,
  CreateShiftResponse,
  DonorSummary,
  EligibilityPreviewResponse,
  RecurrencePatternSummary,
  RemoveRouteResponse,
  RouteDetail,
  ShapedUser,
  ShiftSummary,
  UnassignResult,
  UpdatePatternRequest,
  UpdatePatternResponse,
  UpdateRouteRequest,
} from '../../../api/shared.ts';

const withSignal = (signal?: AbortSignal) => (signal ? { signal } : {});

// ---------------------------------------------------------------------------
// Runs (caps 4 and 9)
// ---------------------------------------------------------------------------

/** Runs from today forward. No `to`: how far ahead runs exist is already bounded
 *  by `app_config.horizon_days` at materialization. `CANCELLED` runs stay off the
 *  list — I10 makes the state terminal and there is nothing to schedule about one. */
export function fetchRuns(fromDate: string, signal?: AbortSignal): Promise<ShiftSummary[]> {
  return api.get<ShiftSummary[]>('/shifts', {
    query: { from: fromDate },
    ...withSignal(signal),
  });
}

/** Publish one run. `duplicates` in the response is a warning, never a refusal. */
export function publishRun(body: CreateShiftRequest): Promise<CreateShiftResponse> {
  return api.post<CreateShiftResponse>('/shifts', { body });
}

/** "Edit just this date" (S1.6). Date and time are deliberately not here — moving
 *  a run is cap 9's reschedule (S1.7), which owes staff the owner's conflicts
 *  first. I23: this never reaches the pattern. */
export function saveRunNote(shiftId: string, staffNote: string | null): Promise<ShiftSummary> {
  return api.patch<ShiftSummary>(`/shifts/${encodeURIComponent(shiftId)}`, {
    body: { staffNote },
  });
}

/** Staff removes a run. The service's predicate carries I9 and I10 — a run that
 *  has started answers 409, not 200. */
export function cancelRun(shiftId: string): Promise<CancelShiftResponse> {
  return api.delete<CancelShiftResponse>(`/shifts/${encodeURIComponent(shiftId)}`);
}

// ---------------------------------------------------------------------------
// Repeating runs (`domain-modeling.md §5.3`)
// ---------------------------------------------------------------------------

export function fetchPatterns(signal?: AbortSignal): Promise<RecurrencePatternSummary[]> {
  return api.get<RecurrencePatternSummary[]>('/patterns', withSignal(signal));
}

/** Create. Materialization is eager to the horizon, so this immediately mints
 *  every run in range and reports how many. There is no `startDate` to send. */
export function createPattern(body: CreatePatternRequest): Promise<CreatePatternResponse> {
  return api.post<CreatePatternResponse>('/patterns', { body });
}

/** "Edit the weekly pattern" — I24's explicit pattern-level edit. */
export function updatePattern(
  patternId: string,
  body: UpdatePatternRequest,
): Promise<UpdatePatternResponse> {
  return api.patch<UpdatePatternResponse>(`/patterns/${encodeURIComponent(patternId)}`, { body });
}

/** Staff's bulk-terminate: `CANCELLED`, terminal, over a date range. NOT the
 *  driver's release-range, which returns runs to the board. */
export function terminatePattern(
  patternId: string,
  body: BulkTerminateRequest,
): Promise<BulkTerminateResponse> {
  return api.post<BulkTerminateResponse>(
    `/patterns/${encodeURIComponent(patternId)}/terminate`,
    { body },
  );
}

// ---------------------------------------------------------------------------
// Routes and stores (PRD cap 4)
// ---------------------------------------------------------------------------

export function fetchRoutes(
  includeArchived: boolean,
  signal?: AbortSignal,
): Promise<RouteDetail[]> {
  return api.get<RouteDetail[]>('/routes', {
    ...(includeArchived ? { query: { includeArchived: true } } : {}),
    ...withSignal(signal),
  });
}

export function createRoute(body: CreateRouteRequest): Promise<RouteDetail> {
  return api.post<RouteDetail>('/routes', { body });
}

export function updateRoute(routeId: string, body: UpdateRouteRequest): Promise<RouteDetail> {
  return api.patch<RouteDetail>(`/routes/${encodeURIComponent(routeId)}`, { body });
}

/** I21 decides which removal happened; the response says which, and the screen
 *  reports it rather than asking staff to choose. */
export function removeRoute(routeId: string): Promise<RemoveRouteResponse> {
  return api.delete<RemoveRouteResponse>(`/routes/${encodeURIComponent(routeId)}`);
}

export function restoreRoute(routeId: string): Promise<RouteDetail> {
  return api.post<RouteDetail>(`/routes/${encodeURIComponent(routeId)}/restore`);
}

/** The store list the builder adds from. Donor `address` is operational data and
 *  arrives whole — `pii.ts` gates people, not places. */
export function fetchDonors(signal?: AbortSignal): Promise<DonorSummary[]> {
  return api.get<DonorSummary[]>('/donors', withSignal(signal));
}

// ---------------------------------------------------------------------------
// Assign (PRD cap 6's fallback path)
// ---------------------------------------------------------------------------

/** The account list, filtered to drivers client-side: the Drive duty is set
 *  membership (I2) and the server sends `duties` on every row. */
export function fetchUsers(signal?: AbortSignal): Promise<ShapedUser[]> {
  return api.get<ShapedUser[]>('/users', withSignal(signal));
}

/** Staff's pre-confirm check. Read-only, and the same evaluation runs again inside
 *  the assigning transaction — this exists so the warning is on screen BEFORE
 *  staff confirms (S1.6). */
export function checkEligibility(
  shiftId: string,
  driverId: string,
  signal?: AbortSignal,
): Promise<EligibilityPreviewResponse> {
  return api.get<EligibilityPreviewResponse>(
    `/shifts/${encodeURIComponent(shiftId)}/eligibility`,
    { query: { driverId }, ...withSignal(signal) },
  );
}

/**
 * Assign a driver. `confirmConflict` is I20's staff-assign exemption made
 * explicit: without it a conflicting assignment answers 409 `ASSIGN_CONFLICT`
 * carrying the warning, and with it the assignment goes through and the run is
 * flagged for the driver. The assignment is never blocked by a conflict staff has
 * seen and confirmed.
 */
export function assignDriver(
  shiftId: string,
  driverId: string,
  confirmConflict: boolean,
): Promise<AssignResult> {
  return api.post<AssignResult>(`/shifts/${encodeURIComponent(shiftId)}/assign`, {
    body: { driverId, confirmConflict },
  });
}

/** Staff clears the owner; the run goes back on the board as open. */
export function unassignDriver(shiftId: string): Promise<UnassignResult> {
  return api.post<UnassignResult>(`/shifts/${encodeURIComponent(shiftId)}/unassign`);
}
