// Types and enum values shared between client and server.
//
// RULE: zero runtime dependencies. Nothing here may import from `server` or pull
// in a runtime module — this package exists so a type-only import from the client
// can never drag the Kysely pool into the browser bundle.
//
// Contents: API request/response shapes, enum values mirroring the native Postgres
// enums (`data-model.md §1`), and the pure comparison helpers those enums need so
// both halves order tiers the same way. Nothing else — no I/O, no imports.
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

// ---------------------------------------------------------------------------
// Tier ordering and duty membership
//
// The two comparisons are different kinds of comparison and are easy to write as
// equality by accident, so neither is left to each call site: I1 makes tiers
// hierarchical, I2 makes duties a set. Pure functions, no imports — the
// zero-runtime-dependency rule above still holds.
// ---------------------------------------------------------------------------

/** Rank of each tier. I1: VOLUNTEER ⊂ STAFF ⊂ ADMIN. */
export const TIER_RANK: Record<Tier, number> = {
  VOLUNTEER: 0,
  STAFF: 1,
  ADMIN: 2,
};

/** I1 — hierarchical: requiring STAFF admits ADMIN. Never an equality test. */
export function tierAtLeast(actual: Tier, required: Tier): boolean {
  return TIER_RANK[actual] >= TIER_RANK[required];
}

/** I2 — set membership: holding REPORT implies nothing about DRIVE. */
export function hasDuty(held: readonly Duty[], required: Duty): boolean {
  return held.includes(required);
}

/** I2 — true when the holder has at least one of `required`. */
export function hasAnyDuty(held: readonly Duty[], required: readonly Duty[]): boolean {
  return required.some((duty) => held.includes(duty));
}

// ---------------------------------------------------------------------------
// Credentials (`architecture.md §4.2`)
// ---------------------------------------------------------------------------

/** Which credential an account uses. Derived from tier, never stored. */
export const CREDENTIAL_KINDS = ['PIN', 'PASSWORD'] as const;
export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];

/** Volunteers use a 4-digit PIN, Staff/Admin a password (`architecture.md §4.2`). */
export function credentialKindFor(tier: Tier): CredentialKind {
  return tier === 'VOLUNTEER' ? 'PIN' : 'PASSWORD';
}

export const PIN_LENGTH = 4;
export const MIN_PASSWORD_LENGTH = 8;

// ---------------------------------------------------------------------------
// API shapes — identity
//
// Dates cross the wire as ISO-8601 strings; the server parses at its edge.
// ---------------------------------------------------------------------------

/**
 * A user as it leaves the server. `phone` / `address` are ABSENT (not null) when
 * the viewer may not see them — `server/src/pii.ts` removes them on the way out,
 * and is the only path a user record takes to a response.
 */
export interface ShapedUser {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  tier: Tier;
  duties: Duty[];
  active: boolean;
  phone?: string | null;
  address?: string | null;
}

/**
 * One entry of the login screen's name list (`ui-ux-spec.md §5`). Names are
 * public-within-org by design (`product-requirement.md §2`), and the roster is
 * published deliberately — `architecture.md §4.2` defends the PIN by throttling,
 * not by hiding usernames.
 */
export interface RosterEntry {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  credentialKind: CredentialKind;
}

export interface LoginRequest {
  username: string;
  credential: string;
}

/** `expiresAt` is server-authoritative; the "Still here?" prompt renders it. */
export interface SessionResponse {
  user: ShapedUser;
  expiresAt: string;
  sharedDevice: boolean;
}

/** 401 body on a bad credential. `triesLeft` is the S1.1 inline count. */
export interface LoginRejected {
  error: 'INVALID_CREDENTIAL';
  triesLeft: number;
}

/** 429 body while the soft lock holds. Always self-clearing — no admin unlock. */
export interface LoginLocked {
  error: 'LOCKED';
  retryAfterSeconds: number;
}

export interface CreateUserRequest {
  firstName: string;
  lastName: string;
  tier: Tier;
  duties?: Duty[];
  phone?: string | null;
  address?: string | null;
  /** Optional for a Volunteer (defaults to the last 4 of the phone). */
  credential?: string;
}

/** Username is absent by construction: it is immutable after creation (I3). */
export interface UpdateUserRequest {
  firstName?: string;
  lastName?: string;
  tier?: Tier;
  duties?: Duty[];
  phone?: string | null;
  address?: string | null;
  /** Required when a tier change crosses the PIN/password boundary. */
  credential?: string;
}

export interface SetCredentialRequest {
  credential: string;
}

/** I21: hard delete only with zero referencing history, else deactivate. */
export interface RemoveUserResponse {
  outcome: 'DELETED' | 'DEACTIVATED';
}

export interface RegisterDeviceRequest {
  label: string;
}

export interface DeviceSummary {
  id: string;
  label: string;
  createdAt: string;
}

/** Error envelope. `correlationId` is for the operator reading logs (§5.5). */
export interface ApiError {
  error: string;
  message: string;
  correlationId?: string;
}
