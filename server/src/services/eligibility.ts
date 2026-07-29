// `eligible()` — the eligible-driver algorithm (`domain-modeling.md §5.2`).
//
// Five call sites read this file and nothing else decides the question: claim,
// availability declaration, recurrence materialization, staff-assign-as-warning,
// and notification fan-out (`phase-1-build-plan.md §2`). It is a tier-3 rule
// (`architecture.md §4.1`) — code, holding only because every write path goes
// through the one service function that consults it — which is why the predicate
// lives here once instead of being restated per call site.
//
// Everything here READS. There is no write in this file and therefore no
// transaction: `architecture.md §4.1` allows read-only queries at the default
// isolation, and the reads that must be part of a gate take the caller's
// transaction handle instead (see `Reader`). A gate's read and its write share a
// transaction or the gate is decoration.
//
// The five call sites and what each one wants:
//
//   claim                 `eligible()` — a hard gate; an ineligible driver cannot claim.
//   availability declare  `conflictingOwnedShifts()` — §5.2's second bullet checks
//                         owned shifts ONLY, not the driver's other blocks and not
//                         the Drive duty. A narrower question, same overlap.
//   materialization       `eligible()` per instance, before the row exists — hence
//                         `shift.id` is optional (I25: born CLAIMED only if eligible).
//   staff-assign          `evaluateEligibility()` — advisory, so it must return the
//                         REASON. I20's exemption warns and confirms, never blocks.
//   notification fan-out  `eligibleDriverIds()` — the set, computed at send time
//                         (`product-requirement.md §4`), as one query rather than
//                         N round trips.

import type { Kysely } from 'kysely';
import type { DB, ShiftStatus } from '../db/types.js';
import type {
  EligibilityReason,
  EligibilitySummary,
} from '../../../shared/src/availability.js';

/**
 * Any Kysely handle. `Transaction<DB>` is assignable to `Kysely<DB>`, so a caller
 * inside `writeTransaction` passes its `tx` and the gate's read joins that
 * transaction — which is the whole reason the parameter exists rather than this
 * module reaching for the global `db`.
 */
export type Reader = Kysely<DB>;

/** A half-open interval `[startsAt, endsAt)` in absolute time (`§5.2`). */
export interface TimeWindow {
  startsAt: Date;
  endsAt: Date;
}

/**
 * §5.2: `overlap(A,B) := A.start < B.end AND B.start < A.end`.
 *
 * Half-open, so windows that merely touch — one ending exactly when the next
 * begins — do NOT overlap. A driver whose block ends at 10:00 is eligible for the
 * 10:00 run. Strict `<` on both sides is the whole rule; `<=` on either would make
 * every back-to-back pair a conflict.
 *
 * The SQL predicates below are this same expression, written the same way round,
 * and the test table drives both so they cannot drift.
 */
export function overlaps(a: TimeWindow, b: TimeWindow): boolean {
  return a.startsAt.getTime() < b.endsAt.getTime() && b.startsAt.getTime() < a.endsAt.getTime();
}

/**
 * The shift states that occupy a driver (I20: "an owned CLAIMED/IN_PROGRESS shift").
 * COMPLETED and CANCELLED are excluded by the filter — §5.2 says availability may
 * freely overlap them.
 *
 * Build-plan D1 consequence, deliberately not worked around: a Phase-1 run never
 * reaches COMPLETED, because I11 makes the receiver's receive-done the only
 * completion action and the receiver ships in Phase 2. An old IN_PROGRESS run
 * therefore stays in this set permanently and keeps excluding its driver from
 * overlapping shifts. That is I20 holding, not a bug.
 */
export const OCCUPYING_SHIFT_STATUSES: readonly ShiftStatus[] = ['CLAIMED', 'IN_PROGRESS'];

/** The shift being asked about. `id` is absent when the row does not exist yet —
 *  materialization evaluates eligibility *before* the insert (§5.3). */
export interface ShiftWindow extends TimeWindow {
  id?: string | undefined;
}

export interface OwnedShiftConflict {
  shiftId: string;
  status: ShiftStatus;
  startsAt: Date;
  endsAt: Date;
  routeName: string;
}

/**
 * The driver's own CLAIMED / IN_PROGRESS shifts overlapping `window`.
 *
 * `§5.2`'s `S ≠ shift` is `excludeShiftId`: a shift never disqualifies itself, which
 * matters at claim time (the row being claimed is OPEN, so it cannot match anyway)
 * and at reschedule (where it can).
 */
export async function conflictingOwnedShifts(
  reader: Reader,
  driverId: string,
  window: TimeWindow,
  options: { excludeShiftId?: string | undefined } = {},
): Promise<OwnedShiftConflict[]> {
  let query = reader
    .selectFrom('shift')
    .innerJoin('route', 'route.id', 'shift.route_id')
    .select([
      'shift.id as shiftId',
      'shift.status as status',
      'shift.starts_at as startsAt',
      'shift.ends_at as endsAt',
      'route.name as routeName',
    ])
    .where('shift.owner_id', '=', driverId)
    .where('shift.status', 'in', [...OCCUPYING_SHIFT_STATUSES])
    // I20 / §5.2 overlap, half-open and in that order.
    .where('shift.starts_at', '<', window.endsAt)
    .where('shift.ends_at', '>', window.startsAt)
    .orderBy('shift.starts_at');

  if (options.excludeShiftId !== undefined) {
    query = query.where('shift.id', '<>', options.excludeShiftId);
  }

  return query.execute();
}

export interface BlockConflict {
  blockId: string;
  startsAt: Date;
  endsAt: Date;
}

/** The driver's own AvailabilityBlocks overlapping `window`. Whole-person and
 *  time-only — there is no route scope to filter on (I19). */
export async function conflictingAvailabilityBlocks(
  reader: Reader,
  driverId: string,
  window: TimeWindow,
): Promise<BlockConflict[]> {
  return reader
    .selectFrom('availability_block')
    .select([
      'availability_block.id as blockId',
      'availability_block.starts_at as startsAt',
      'availability_block.ends_at as endsAt',
    ])
    .where('availability_block.user_id', '=', driverId)
    .where('availability_block.starts_at', '<', window.endsAt)
    .where('availability_block.ends_at', '>', window.startsAt)
    .orderBy('availability_block.starts_at')
    .execute();
}

/**
 * `eligible()` with its reasons — §5.2 in full:
 *
 *     eligible(driver, shift) :=
 *         Drive ∈ driver.duties
 *     AND no AvailabilityBlock b of driver with overlap(b, shift.window)
 *     AND no other shift S ≠ shift owned by driver, S.state ∈ {CLAIMED, IN_PROGRESS},
 *         with overlap(S.window, shift.window)
 *
 * Every clause is evaluated even once one has failed, because staff-assign shows the
 * conflict rather than blocking on it (I20's exemption) and "away AND already on a
 * run" is a different sentence from either half alone.
 */
export async function evaluateEligibility(
  reader: Reader,
  driverId: string,
  shift: ShiftWindow,
): Promise<EligibilitySummary> {
  const reasons: EligibilityReason[] = [];

  const person = await reader
    .selectFrom('app_user')
    .select((eb) => [
      'app_user.deactivated_at as deactivatedAt',
      eb
        .exists(
          eb
            .selectFrom('user_duty')
            .select('user_duty.duty')
            .whereRef('user_duty.user_id', '=', 'app_user.id')
            // I2 — set membership. Holding RECEIVE or REPORT says nothing here,
            // and tier says nothing either: driving is a duty, not a rank.
            .where('user_duty.duty', '=', 'DRIVE'),
        )
        .as('drives'),
    ])
    .where('app_user.id', '=', driverId)
    .executeTakeFirst();

  if (!person) {
    return {
      driverId,
      eligible: false,
      reasons: ['UNKNOWN_USER'],
      conflictingShiftIds: [],
      conflictingBlockIds: [],
    };
  }

  if (!person.drives) reasons.push('NO_DRIVE_DUTY');
  // I21 — a soft-deleted account is hidden from new use. §5.2 names only the Drive
  // duty, but a deactivated driver cannot sign in to act on a shift, and putting
  // one in the fan-out set would notify an account that was removed.
  if (person.deactivatedAt !== null) reasons.push('DEACTIVATED');

  const blocks = await conflictingAvailabilityBlocks(reader, driverId, shift);
  if (blocks.length > 0) reasons.push('AVAILABILITY_BLOCK');

  const shifts = await conflictingOwnedShifts(reader, driverId, shift, {
    excludeShiftId: shift.id,
  });
  if (shifts.length > 0) reasons.push('OWNED_SHIFT_OVERLAP');

  return {
    driverId,
    eligible: reasons.length === 0,
    reasons,
    conflictingShiftIds: shifts.map((s) => s.shiftId),
    conflictingBlockIds: blocks.map((b) => b.blockId),
  };
}

/**
 * The gate form: `eligible(driver, shift)` as a boolean (§5.2).
 *
 * Callers that must explain a refusal — staff-assign, and claim-all's "2 skipped"
 * summary (`ui-ux-spec.md S1.2`) — use `evaluateEligibility` instead.
 */
export async function eligible(
  reader: Reader,
  driverId: string,
  shift: ShiftWindow,
): Promise<boolean> {
  return (await evaluateEligibility(reader, driverId, shift)).eligible;
}

/**
 * The fan-out set: every eligible driver for one shift window, in one query.
 *
 * `product-requirement.md §4` defines it as "computed at send time … holding the
 * drive duty AND no unavailability block overlapping … AND not already owning a
 * CLAIMED or IN_PROGRESS shift whose window overlaps", which is `eligible()` over
 * every driver. It is the same three clauses as `evaluateEligibility`, expressed as
 * NOT EXISTS so the whole set costs one round trip — and any change to one must be
 * made to the other, which is why the test table drives both.
 */
export async function eligibleDriverIds(
  reader: Reader,
  shift: ShiftWindow,
): Promise<string[]> {
  const rows = await reader
    .selectFrom('app_user')
    .select('app_user.id as id')
    // I21 — hidden from new use.
    .where('app_user.deactivated_at', 'is', null)
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom('user_duty')
          .select('user_duty.duty')
          .whereRef('user_duty.user_id', '=', 'app_user.id')
          .where('user_duty.duty', '=', 'DRIVE'), // I2 — set membership
      ),
    )
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('availability_block')
            .select('availability_block.id')
            .whereRef('availability_block.user_id', '=', 'app_user.id')
            .where('availability_block.starts_at', '<', shift.endsAt)
            .where('availability_block.ends_at', '>', shift.startsAt),
        ),
      ),
    )
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('shift')
            .select('shift.id')
            .whereRef('shift.owner_id', '=', 'app_user.id')
            .where('shift.status', 'in', [...OCCUPYING_SHIFT_STATUSES])
            .where('shift.starts_at', '<', shift.endsAt)
            .where('shift.ends_at', '>', shift.startsAt)
            .$if(shift.id !== undefined, (qb) =>
              qb.where('shift.id', '<>', shift.id!),
            ),
        ),
      ),
    )
    .orderBy('app_user.username')
    .execute();

  return rows.map((row) => row.id);
}
