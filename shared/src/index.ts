// Types and enum values shared between client and server.
//
// RULE: zero runtime dependencies. Nothing here may import from `server` or pull
// in a runtime module — this package exists so a type-only import from the client
// can never drag the Kysely pool into the browser bundle.
//
// Contents: API request/response shapes, and enum values mirroring the native
// Postgres enums (`data-model.md §1`). Nothing else.
//
// The value arrays exist so a client can render a set without a second copy of it
// drifting out of sync with the database; the union types derive from those arrays
// rather than being declared alongside them, so adding a value is one edit.
//
// Phase-1 enums only. `donation_status` is Phase 2 (build-plan D3), absent from the
// migrations, and therefore absent here.

/** `tier` — I1. Hierarchical: VOLUNTEER ⊂ STAFF ⊂ ADMIN. Compare by rank with `>=`,
 *  never by equality. */
export const TIERS = ['VOLUNTEER', 'STAFF', 'ADMIN'] as const;
export type Tier = (typeof TIERS)[number];

/** `duty` — I2. Set membership, not a hierarchy: a user holds zero or more. */
export const DUTIES = ['DRIVE', 'RECEIVE', 'REPORT'] as const;
export type Duty = (typeof DUTIES)[number];

/** `shift_status` — I7. MISSED is derived at read time, never stored. */
export const SHIFT_STATUSES = [
  'OPEN',
  'CLAIMED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
] as const;
export type ShiftStatus = (typeof SHIFT_STATUSES)[number];

/** `shiftstop_disposition` — WEIGHED is derived (I12) and never stored;
 *  REASSIGNED is terminal (I30). */
export const SHIFTSTOP_DISPOSITIONS = [
  'PENDING',
  'COLLECTED',
  'SKIPPED',
  'REASSIGNED',
] as const;
export type ShiftStopDisposition = (typeof SHIFTSTOP_DISPOSITIONS)[number];
