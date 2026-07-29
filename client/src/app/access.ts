// Tier and duty comparisons, in one place.
//
// The two comparisons are different KINDS and are easy to write as equality by
// accident (`architecture.md §4.3`):
//   - tier is HIERARCHICAL (I1) — VOLUNTEER ⊂ STAFF ⊂ ADMIN, so requiring Staff
//     admits an Admin. Compare rank with `>=`.
//   - duty is SET MEMBERSHIP (I2) — holding `report` implies nothing about
//     `drive`. Compare by inclusion.
//
// Everything here is COMMUNICATION, not enforcement (`architecture.md §4.5`):
// it decides what to show a user, so they are not offered actions that would be
// refused. The server checks the same rule again on every request, and that
// check is the one that matters.

import { TIERS } from '../api/shared.ts';
import type { Duty, Tier } from '../api/shared.ts';
import type { Access } from './routes.ts';
import type { CurrentUser } from '../api/session.ts';

/** Rank comes from the order of `TIERS`, which mirrors the database enum
 *  (I1) — so adding a tier never needs a second table kept in step. */
export function tierRank(tier: Tier): number {
  return TIERS.indexOf(tier);
}

export function atLeastTier(user: CurrentUser, minimum: Tier): boolean {
  return tierRank(user.tier) >= tierRank(minimum);
}

export function hasDuty(user: CurrentUser, duty: Duty): boolean {
  return user.duties.includes(duty);
}

export function hasAnyDuty(user: CurrentUser, duties: readonly Duty[]): boolean {
  return duties.some((duty) => hasDuty(user, duty));
}

/** Both conditions must hold when both are stated: tier floor AND one of the
 *  duties. A route with no `requires` is visible to any signed-in user — which
 *  is NOT the server's default. There, a route declaring nothing is rejected,
 *  not open (`architecture.md §4.3`). */
export function canSee(user: CurrentUser, access: Access | undefined): boolean {
  if (!access) return true;
  if (access.tier && !atLeastTier(user, access.tier)) return false;
  if (access.anyDuty && !hasAnyDuty(user, access.anyDuty)) return false;
  return true;
}
