// API shapes for the pickup route builder (`ui-ux-spec.md S1.6`, PRD cap 4).
//
// Same rule as `index.ts`: zero runtime dependencies, types and plain values only.
// Nothing here imports from `server`.
//
// "Route" in this file always means the reusable TEMPLATE — a `Route` and its
// ordered `RouteStop`s (`domain-modeling.md §1`). Shifts are materialized from it
// elsewhere and are not part of these shapes; editing a template never reaches an
// already-started shift's stops (I6).
//
// Vocabulary note: the domain calls them Donors, the UI calls them stores
// (`ui-ux-spec.md S1.6`, "a route is an ordered list of stores"). Field names here
// follow the domain; user-facing strings follow the UI.

/** One stop on the template, with the donor fields the builder list renders.
 *  `donorAddress` is operational data, not PII — `pii.ts` gates people, not
 *  places (`CLAUDE.md`), so it is never trimmed on the way out. */
export interface RouteStopSummary {
  id: string;
  donorId: string;
  donorName: string;
  donorAddress: string | null;
  /** False once the store is deactivated (I21). The stop is preserved; the
   *  builder shows it flagged so staff can swap it out. */
  donorActive: boolean;
  /** Contiguous from 0, ascending. A reorder renumbers the whole route. */
  position: number;
}

export interface RouteSummary {
  id: string;
  name: string;
  /**
   * D19 — a note that seeds `shift.staff_note` when a run is published on this
   * route, editable before the run is saved. `null` means the route has none.
   *
   * A DEFAULT, not a fifth note channel. PRD cap 11 and the locked
   * `domain-modeling.md` enumerate exactly four channels and say none share
   * storage; this one lands in channel 2 (coordinator to driver) at create time
   * and stops mattering afterwards, the same way
   * `recurrence_pattern.owner_default_id` defaults an owner. Editing the route
   * never rewrites a run that is already published.
   */
  defaultStaffNote: string | null;
  /** False when archived (`domain-modeling.md §3.3`): hidden from the route
   *  picker, never removed. */
  active: boolean;
  stopCount: number;
  createdAt: string;
}

export interface RouteDetail extends RouteSummary {
  stops: RouteStopSummary[];
}

/**
 * Create a route. `stops` is an ordered list of donor ids — the ORDER carries the
 * ordering, and the server assigns positions, so a client can never submit a
 * sparse or colliding sequence. At least one stop is required
 * (`domain-modeling.md §2.2`: a route has 1..N stops).
 */
export interface CreateRouteRequest {
  name: string;
  stops: string[];
  defaultStaffNote?: string | null;
}

/**
 * Edit a route. `stops`, when present, REPLACES the whole ordered list — one
 * payload covers add, remove and drag-and-drop reorder, which is how S1.6 saves.
 * Omit it to rename without touching the stops.
 */
export interface UpdateRouteRequest {
  name?: string;
  stops?: string[];
  defaultStaffNote?: string | null;
}

/** Which removal actually happened (`domain-modeling.md §3.3`, Route row:
 *  hard-delete only with zero referencing history, else archive). */
export interface RemoveRouteResponse {
  outcome: 'DELETED' | 'ARCHIVED';
}
