// PII shaping — the sole path by which an `app_user` record reaches a response.
//
// Rule (`architecture.md §4.3`, `product-requirement.md §2`): phone and address are
// visible when `viewer.tier >= STAFF` OR `viewer.id === subject.id`. Name is never
// gated — names are public-within-org by design, shown on the login screen and the
// shared shift board.
//
// Fields are removed on the way OUT, not by per-viewer queries. Per-viewer queries
// would keep PII out of process memory but multiply query variants and leak the
// moment one is missed. This holds one rule in one place — and is safe ONLY because
// it is the single exit path. Every response carrying a user record calls through
// here.
//
// SCOPE, deliberately: "PII" in R3 means phone and address on a *person*. Donor
// `address` and `contact` (`data-model.md §90-91`) are NOT PII and must NOT be
// trimmed — the donor address is the pickup location drivers navigate to, and it
// renders live through the shift-stop snapshot's FK (`data-model.md §233`).
// Anything filed here that is not app_user gating is misfiled.

import { tierAtLeast, type ShapedUser } from '../../shared/src/index.js';
import type { Duty, Tier } from './db/types.js';

/** The `app_user` columns any caller must supply. A row read from the database
 *  satisfies this structurally, so no caller has to reshape before shaping. */
export interface UserRecord {
  id: string;
  username: string;
  first_name: string;
  last_name: string;
  tier: Tier;
  phone: string | null;
  address: string | null;
  deactivated_at: Date | null;
}

/** Who is looking. `null` is an unauthenticated viewer (the login roster). */
export interface Viewer {
  id: string;
  tier: Tier;
}

/**
 * The sole exit path for an `app_user` record.
 *
 * Phone and address are visible when `viewer.tier >= STAFF` OR
 * `viewer.id === subject.id` (`architecture.md §4.3`, `product-requirement.md §2`).
 * The tier half is hierarchical — Admin passes a Staff requirement — which is why
 * it goes through `tierAtLeast` (I1) rather than an equality test.
 *
 * Invisible fields are DELETED from the object, not nulled: a null phone is a real
 * state (no phone on file, which is why §4.2 falls back to four random digits), and
 * collapsing "hidden" into "absent value" would make the two indistinguishable to
 * the admin screen that has to decide whether to show an empty field.
 */
export function shapeUser(
  subject: UserRecord,
  duties: readonly Duty[],
  viewer: Viewer | null,
): ShapedUser {
  const shaped: ShapedUser = {
    id: subject.id,
    username: subject.username,
    // Name is never gated: public-within-org by design, shown on the shared login
    // screen and the shift board.
    firstName: subject.first_name,
    lastName: subject.last_name,
    tier: subject.tier,
    duties: [...duties],
    // I21 soft-delete: a deactivated account is preserved everywhere it is
    // referenced, so the flag travels with the record rather than the row vanishing.
    active: subject.deactivated_at === null,
  };

  const maySeePii =
    viewer !== null && (tierAtLeast(viewer.tier, 'STAFF') || viewer.id === subject.id);

  if (maySeePii) {
    shaped.phone = subject.phone;
    shaped.address = subject.address;
  }

  return shaped;
}
