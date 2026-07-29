// S1.4's four calls, all through the typed fetch layer.
//
// Nothing here invents a filter the server does not offer: `GET /api/shifts`
// takes `?mine=true` (`server/src/routes/shifts.ts`) and answers with this
// driver's runs, cancelled ones already off the list. Availability reads default
// to the caller's own rows when `?userId=` is absent, which is exactly what this
// screen wants — a driver may only see their own anyway
// (`services/availability.ts`, state A62).
//
// `fetch` is never called directly: a raw call would miss the session cookie, the
// one error shape (§6) and the offline banner all at once.

import { api } from '../../../api/index.ts';
import type {
  AvailabilityListResponse,
  DeclareAvailabilityRequest,
  DeclareAvailabilityResponse,
  ShiftSummary,
} from '../../../api/shared.ts';

/** This driver's runs, every date. Grouping into past and upcoming is the
 *  screen's (`logic.ts`), because "past" is a clock fact, not a filter the
 *  server offers. */
export function fetchMyRuns(signal: AbortSignal): Promise<ShiftSummary[]> {
  return api.get<ShiftSummary[]>('/shifts', { query: { mine: 'true' }, signal });
}

export function fetchMyTimeAway(signal: AbortSignal): Promise<AvailabilityListResponse> {
  return api.get<AvailabilityListResponse>('/availability', { signal });
}

/**
 * Declare unavailability. Calendar dates and clock times, never instants — the
 * server converts against `app_config.timezone` (state A55), and a 409 here is
 * I20's declaration gate refusing the whole declaration.
 */
export function declareTimeAway(
  request: DeclareAvailabilityRequest,
): Promise<DeclareAvailabilityResponse> {
  return api.post<DeclareAvailabilityResponse>('/availability', { body: request });
}

/** Withdraw one block. 204, and no notification is sent (state A64) — the copy
 *  around this must not imply one. */
export function withdrawTimeAway(blockId: string): Promise<void> {
  return api.delete<void>(`/availability/${encodeURIComponent(blockId)}`);
}
