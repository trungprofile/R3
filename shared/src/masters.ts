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
  /** D20. An explicit map link for a store whose address does not resolve to the
   *  door — a dock round the back, a site with several entrances. `null` is the
   *  normal state and means "derive one from `address`", which the client does.
   *  Operational data a driver needs, so it is never trimmed (see the note above). */
  mapUrl: string | null;
  /** D20. Whether a photo exists, not the photo. Bytes live in their own table and
   *  come from `GET /donors/:id/photo`, so a donor list never carries images. */
  hasPhoto: boolean;
  /** North Texas Food Bank's own number for this store, as Meal Connect's donor picker
   *  shows it — the `(810)` in `H-E-B Food Stores (810)` (migration 0013). NTFB's to
   *  issue, so `null` is normal. Operational, like `address`: it is what the reporter
   *  types into the portal, so it is never trimmed. */
  ntfbDonorCode: string | null;
  /** D27 — this store's trash rates, as decimal strings so a `numeric(5,4)` never
   *  round-trips through a float. `0.1000` is 10%. `null` means "use the pantry
   *  default" from `app_config`, which is the normal state and is deliberately not
   *  resolved here: a screen that cannot tell an inherited rate from a deliberate one
   *  cannot show the admin which is which. */
  trashRateBakery: string | null;
  trashRateProduce: string | null;
  trashRateDeli: string | null;
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
  mapUrl?: string | null;
  /** Until D27 this column had NO write path anywhere in the app — it was exported on
   *  the report and could only be set with hand-written SQL. */
  ntfbDonorCode?: string | null;
  /** D27. A decimal fraction as a string (`'0.1'`, `'0.1000'`), 0..1 inclusive.
   *  `null`/absent leaves the pantry default in force. Not a percentage: the screen
   *  converts, the wire does not. */
  trashRateBakery?: string | null;
  trashRateProduce?: string | null;
  trashRateDeli?: string | null;
}

/** I21: field edits are always allowed, including on a deactivated donor —
 *  soft-delete governs removal only. `active` is §3.3's ACTIVE ⇄ DEACTIVATED
 *  toggle, the one field here that is not an ordinary edit. */
export interface UpdateDonorRequest {
  name?: string;
  address?: string | null;
  contact?: string | null;
  note?: string | null;
  mapUrl?: string | null;
  ntfbDonorCode?: string | null;
  /** D27. `null` clears the override and returns the store to the pantry default;
   *  absent leaves whatever is there. The two are different edits and the PATCH
   *  distinguishes them, which is why a blank field on the admin form has to send
   *  `null` rather than omit the key. */
  trashRateBakery?: string | null;
  trashRateProduce?: string | null;
  trashRateDeli?: string | null;
  active?: boolean;
}

/**
 * D20 — a store photo, sent as a data URL rather than multipart.
 *
 * Multipart would need a parsing dependency (D5) and a mounted volume; a data URL
 * rides the ordinary JSON body and the bytes land in Postgres, inside `pg_dump`.
 * The client canvas-resizes to ~800px JPEG first, so a real upload is tens of KB
 * against a ceiling the database enforces as a CHECK.
 *
 * `null` clears the photo.
 */
export interface SetDonorPhotoRequest {
  dataUrl: string | null;
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
