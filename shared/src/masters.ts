// Master-data API shapes: Donor, Truck, Category.
//
// `product-requirement.md` caps 2, 3 and 17; the Donors / Trucks / Categories tabs
// of `ui-ux-spec.md S1.8`.
//
// RULE (same as `index.ts`): zero runtime dependencies. Types and plain data only.
//
// Three entities, one shape family, because `domain-modeling.md §3.3` gives all
// three the same single lifecycle toggle and `data-model.md §0` stores it as one
// physical bit (`deactivated_at`). The labels differ per entity in the UI
// (DEACTIVATED / INACTIVE / ARCHIVED) and nowhere else, so the wire carries
// `active` and the screen supplies the word.

// ---------------------------------------------------------------------------
// Donor — cap 2
// ---------------------------------------------------------------------------

/**
 * `address` and `contact` are NOT trimmed on the way out and must never be added
 * to `pii.ts`: PII in R3 means phone/address on a *person*, and a donor's address
 * is the place a driver is navigating to (`CLAUDE.md`, `pii.ts` scope note).
 */
export interface DonorSummary {
  id: string;
  name: string;
  address: string | null;
  /** Free text — phone, email, or a person. No fixed shape (`data-model.md §4`). */
  contact: string | null;
  /** The admin's permanent per-store note (`domain-modeling.md §2.3`, cap 11 channel 4). */
  note: string | null;
  /** I21 soft-delete: a deactivated donor is preserved everywhere it is referenced,
   *  so the flag travels with the record rather than the row vanishing. */
  active: boolean;
  createdAt: string;
}

export interface CreateDonorRequest {
  name: string;
  address?: string | null;
  contact?: string | null;
  note?: string | null;
}

/** I21: field edits are always allowed, including on a deactivated donor —
 *  soft-delete governs removal only. `active` is §3.3's ACTIVE ⇄ DEACTIVATED
 *  toggle, the one field here that is not an ordinary edit. */
export interface UpdateDonorRequest {
  name?: string;
  address?: string | null;
  contact?: string | null;
  note?: string | null;
  active?: boolean;
}

// ---------------------------------------------------------------------------
// Truck — cap 3
// ---------------------------------------------------------------------------

/** Identity and attribution only: no telemetry, mileage, or maintenance (cap 3).
 *  No exclusivity either (I22) — nothing here ties a truck to a time window. */
export interface TruckSummary {
  id: string;
  truckName: string;
  plate: string | null;
  /** §3.3 ACTIVE ⇄ INACTIVE; inactive trucks are hidden from driver selection. */
  active: boolean;
  createdAt: string;
}

export interface CreateTruckRequest {
  truckName: string;
  plate?: string | null;
}

export interface UpdateTruckRequest {
  truckName?: string;
  plate?: string | null;
  active?: boolean;
}

// ---------------------------------------------------------------------------
// Category — cap 17 (ships in Phase 1: build-plan D2)
// ---------------------------------------------------------------------------

/** Name only. Nothing consumes a category until Phase 2's weight entry, where the
 *  active set renders the S2.2 keypad tiles. */
export interface CategorySummary {
  id: string;
  name: string;
  /** §3.3 ACTIVE ⇄ ARCHIVED; archived is hidden from new entry and preserved in
   *  history and reports. */
  active: boolean;
  createdAt: string;
}

export interface CreateCategoryRequest {
  name: string;
}

export interface UpdateCategoryRequest {
  name?: string;
  active?: boolean;
}

// ---------------------------------------------------------------------------
// Removal
// ---------------------------------------------------------------------------

/**
 * I21 — which removal actually happened. Referencing history means the master was
 * deactivated and every reference to it still resolves; no history means the row
 * is gone (the escape hatch for a mistaken create). The caller does not choose,
 * and the client is told which happened so the screen can say so.
 */
export type RemovalOutcome = 'DELETED' | 'DEACTIVATED';

export interface RemoveMasterResponse {
  outcome: RemovalOutcome;
}
