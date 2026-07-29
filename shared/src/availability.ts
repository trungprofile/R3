// API shapes for driver availability and driver eligibility.
//
// `product-requirement.md` cap 7 (driver availability) and `ui-ux-spec.md S1.4`
// ("My shifts + availability") own the capability; `domain-modeling.md §5.2` owns
// the eligibility predicate these shapes describe the result of.
//
// RULE, inherited from `shared/src/index.ts`: zero runtime dependencies. Nothing
// here imports anything — this package exists so a type-only import from the client
// can never drag the Kysely pool into the browser bundle.
//
// Dates cross the wire as ISO-8601 instants; calendar dates and wall-clock times
// cross as `YYYY-MM-DD` / `HH:MM` in **pantry-local** time, because that is the
// frame `domain-modeling.md §5.2` states the window is expressed in. The server
// resolves them to instants against `app_config.timezone`; the client never does
// the conversion, so a driver in another timezone cannot shift the pantry's day.

// ---------------------------------------------------------------------------
// Declaring unavailability (PRD cap 7, S1.4)
// ---------------------------------------------------------------------------

/**
 * S1.4: "pick a date range OR a time window within dates".
 *
 * - `DATES`  — whole days, `fromDate` 00:00 local through the end of `toDate`.
 * - `WINDOW` — the same clock window on each date in `[fromDate, toDate]`, which
 *   expands to one `AvailabilityBlock` per date. A block is one contiguous
 *   `[starts_at, ends_at)` (`data-model.md §10`), so "9–12, Mon to Fri" is five
 *   rows, not one; the expansion is the server's, and the whole declaration is
 *   saved or refused as a unit.
 */
export const AVAILABILITY_KINDS = ['DATES', 'WINDOW'] as const;
export type AvailabilityKind = (typeof AVAILABILITY_KINDS)[number];

export interface DeclareAvailabilityRequest {
  kind: AvailabilityKind;
  /** `YYYY-MM-DD`, pantry-local, inclusive. */
  fromDate: string;
  /** `YYYY-MM-DD`, pantry-local, inclusive. Equal to `fromDate` for a single day. */
  toDate: string;
  /** `HH:MM`, pantry-local. Required for `WINDOW`, absent for `DATES`. */
  startTime?: string;
  /** `HH:MM`, pantry-local, strictly after `startTime`. Required for `WINDOW`. */
  endTime?: string;
}

/** One stored `availability_block` row as it leaves the server. */
export interface AvailabilityBlockSummary {
  id: string;
  userId: string;
  /** ISO-8601 instant. */
  startsAt: string;
  /** ISO-8601 instant, exclusive — the window is half-open (`§5.2`). */
  endsAt: string;
  createdAt: string;
}

export interface DeclareAvailabilityResponse {
  blocks: AvailabilityBlockSummary[];
}

export interface AvailabilityListResponse {
  userId: string;
  blocks: AvailabilityBlockSummary[];
}

// ---------------------------------------------------------------------------
// The declaration gate's refusal (I20)
// ---------------------------------------------------------------------------

/**
 * One owned shift standing in the way of a declaration. `releasable` is false when
 * the run is already `IN_PROGRESS`: I9 forbids cancelling from there, so the driver
 * cannot clear the conflict and must wait it out — which is why S1.4 has two
 * distinct error strings rather than one.
 */
export interface AvailabilityConflict {
  shiftId: string;
  status: 'CLAIMED' | 'IN_PROGRESS';
  startsAt: string;
  endsAt: string;
  routeName: string;
  releasable: boolean;
}

/** 409 body. The whole declaration is refused, not the conflicting part of it. */
export interface AvailabilityConflictResponse {
  error: 'AVAILABILITY_CONFLICT';
  message: string;
  conflicts: AvailabilityConflict[];
}

/** S1.4's two inline errors, verbatim. Rendered by the client; sent by the server
 *  as `message` so a non-browser caller gets the same sentence. */
export const AVAILABILITY_CONFLICT_RELEASABLE =
  "You own a run in this window — release it first";
export const AVAILABILITY_CONFLICT_IN_PROGRESS =
  "This run is in progress and can't be released — try again once it's done";

// ---------------------------------------------------------------------------
// Eligibility (`domain-modeling.md §5.2`)
// ---------------------------------------------------------------------------

/**
 * Why a driver is not eligible for a shift. The set exists because `eligible()` is
 * a plain gate at four of its five call sites but is **advisory** at staff-assign
 * (the I20 exemption), where staff must be told *what* the conflict is before
 * confirming through it (`ui-ux-spec.md S1.6`: "Karen marked herself away then").
 */
export const ELIGIBILITY_REASONS = [
  /** No `Drive` duty (I2 — set membership, never a tier comparison). */
  'NO_DRIVE_DUTY',
  /** Soft-deleted account: hidden from new use (I21). */
  'DEACTIVATED',
  /** Overlaps one of the driver's own AvailabilityBlocks (I19/I20). */
  'AVAILABILITY_BLOCK',
  /** Overlaps another owned shift in CLAIMED or IN_PROGRESS (I20). */
  'OWNED_SHIFT_OVERLAP',
  /** No such account. */
  'UNKNOWN_USER',
] as const;
export type EligibilityReason = (typeof ELIGIBILITY_REASONS)[number];

export interface EligibilitySummary {
  driverId: string;
  eligible: boolean;
  reasons: EligibilityReason[];
  /** Ids of the driver's own shifts that overlap. Empty unless `OWNED_SHIFT_OVERLAP`. */
  conflictingShiftIds: string[];
  /** Ids of the driver's own blocks that overlap. Empty unless `AVAILABILITY_BLOCK`. */
  conflictingBlockIds: string[];
}
