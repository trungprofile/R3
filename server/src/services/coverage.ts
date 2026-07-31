// Shift coverage — who owns a run, and how ownership moves.
//
// Four operations, all of them transitions on `shift` (`domain-modeling.md §3.1`):
//
//   claim          OPEN → CLAIMED, driver self-select.   PRD cap 6, S1.2
//   release        CLAIMED → OPEN, driver-initiated.     PRD cap 8, S1.3
//   staff-assign   OPEN|CLAIMED → CLAIMED, staff sets the owner.  PRD cap 6, S1.6
//   staff-unassign CLAIMED → OPEN, staff clears it.      PRD cap 6 / cap 13 matrix
//
// THREE RULES THIS FILE EXISTS TO HOLD, and they are easy to confuse with each other.
//
// 1. **I20 gates self-select, not staff-assign.** `eligible()` is a hard gate at claim
//    time — an ineligible driver cannot claim. At staff-assign it is *advisory*: I20's
//    exemption is deliberate override authority for the fallback path, so Staff sees a
//    warning, confirms explicitly, and the assignment goes through anyway. The shift is
//    then flagged (`assigned_over_conflict`) so the driver sees the conflict (S1.3's
//    persistent banner). Same predicate, two different powers.
//
// 2. **Claim atomicity is a conditional UPDATE, not a lock.** `data-model.md §9`: no
//    version column, no `SELECT ... FOR UPDATE`. The state predicate IS the optimistic
//    check and zero matched rows means "lost race / stale state", which surfaces as
//    §6's "That run was just taken by Karen." Under SERIALIZABLE the more common shape
//    of that race is a 40001, which `writeTransaction` retries — and the retry re-reads
//    a board where the run is already taken, producing the same sentence.
//
// 3. **Any statement clearing `owner_id` must clear `assigned_over_conflict` too**
//    (migration 0008, `data-model.md §9`). `ck_shift_conflict_flag` does not clear the
//    flag for you; it makes forgetting to clear it fail. Release, release-range and
//    staff-unassign each carry that second SET.
//
// Per-instance claim, release and cancel never touch the `RecurrencePattern` (I23).
// The single exception is `claim-all`, which §5.3 defines as setting `ownerDefault` —
// that is the driver's explicit pattern-level act (I24), not a side effect of covering
// one run.
//
// Every write goes through `writeTransaction` (SERIALIZABLE + 40001 retry) and every
// gate's read is taken inside that transaction: a gate whose read is outside its write
// is decoration (`architecture.md §4.1`).

import { sql } from 'kysely';
import { TIERS, tierAtLeast, type Tier } from '../../../shared/src/index.js';
import type {
  EligibilityReason,
  EligibilitySummary,
} from '../../../shared/src/availability.js';
import {
  assignWarningMessage,
  claimRefusedMessage,
  claimSummary,
  releaseSummary,
  shiftUnavailableMessage,
  weekdayLabel,
  type AssignResult,
  type ClaimResult,
  type ClaimScope,
  type ClaimSkipReason,
  type CoveredShift,
  type EligibilityPreviewResponse,
  type ReleaseResult,
  type ReleaseScope,
  type SkippedShift,
  type UnassignResult,
} from '../../../shared/src/coverage.js';
import { db } from '../db/index.js';
import { writeTransaction, type Tx } from '../db/transaction.js';
import { badRequest, conflict, forbidden, notFound } from '../middleware/error.js';
import { formatRange, parseDate } from '../time.js';
import { dispatchNow } from '../jobs/push-dispatch.js';
import { enqueueNotifications } from './notification.js';
import { eligibleDriverIds, evaluateEligibility, type Reader } from './eligibility.js';

/** The acting user. Services take the actor for provenance (I26) and for the two
 *  tier-dependent *domain* rules R3 has — one of which is I20's staff-assign
 *  exemption (`architecture.md §4.3`). Permission itself was settled at the route. */
export interface CoverageActor {
  id: string;
  tier: Tier;
}

/** Coordinator = every Staff-tier-and-above user (`product-requirement.md §2`).
 *  Derived from the hierarchy (I1), never an equality test, which would drop Admin. */
const COORDINATOR_TIERS: Tier[] = TIERS.filter((tier) => tierAtLeast(tier, 'STAFF'));

/**
 * I20's exemption is scoped: it names "the driver's declared availability or another
 * owned shift" and nothing else. The remaining reasons are not conflicts Staff has
 * authority to override — a deactivated account cannot sign in to drive the run, and a
 * user without the Drive duty (I2 — set membership) has no driver view to run it in.
 * Those stay hard refusals for Staff as much as for self-select.
 */
const CONFIRMABLE_REASONS: readonly EligibilityReason[] = [
  'AVAILABILITY_BLOCK',
  'OWNED_SHIFT_OVERLAP',
];

// ---------------------------------------------------------------------------
// Reading one run
// ---------------------------------------------------------------------------

interface ShiftRow {
  id: string;
  status: string;
  ownerId: string | null;
  startsAt: Date;
  endsAt: Date;
  occurrenceDate: Date | string;
  patternId: string | null;
  routeName: string;
}

async function loadShift(reader: Reader, shiftId: string): Promise<ShiftRow | undefined> {
  return reader
    .selectFrom('shift')
    .innerJoin('route', 'route.id', 'shift.route_id')
    .select([
      'shift.id as id',
      'shift.status as status',
      'shift.owner_id as ownerId',
      'shift.starts_at as startsAt',
      'shift.ends_at as endsAt',
      'shift.occurrence_date as occurrenceDate',
      'shift.recurrence_pattern_id as patternId',
      'route.name as routeName',
    ])
    .where('shift.id', '=', shiftId)
    .executeTakeFirst();
}

/**
 * `occurrence_date` is a `date` column — a calendar slot, not an instant
 * (`data-model.md §5.3`). `pg` hands it back as a Date at local midnight, so the
 * calendar fields are read off directly rather than through `toISOString()`, which
 * would shift the day in any zone east of UTC.
 */
function toDateString(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10);
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
}

function toCoveredShift(row: ShiftRow): CoveredShift {
  return {
    shiftId: row.id,
    occurrenceDate: toDateString(row.occurrenceDate),
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    routeName: row.routeName,
  };
}

// ---------------------------------------------------------------------------
// "That run was just taken by Karen."
// ---------------------------------------------------------------------------

/**
 * Raised inside the transaction when a run is no longer in the state the caller found
 * it in. It carries only the id, because the name of whoever took it cannot be read
 * from *this* transaction: SERIALIZABLE gives it a snapshot in which the run is still
 * the way it was. The message is therefore resolved after the transaction ends, by
 * `asShiftUnavailable` below.
 */
class ShiftMovedOn extends Error {
  constructor(readonly shiftId: string) {
    super('shift moved on');
    this.name = 'ShiftMovedOn';
  }
}

/** Turn a moved-on run into §6's revert toast, reading the *current* owner outside the
 *  failed transaction. Read-only, so the default isolation is right (§4.1). */
async function asShiftUnavailable(shiftId: string): Promise<Error> {
  const row = await db
    .selectFrom('shift')
    .leftJoin('app_user', 'app_user.id', 'shift.owner_id')
    .select(['shift.status as status', 'app_user.first_name as firstName'])
    .where('shift.id', '=', shiftId)
    .executeTakeFirst();

  if (!row) return notFound('That run no longer exists.');
  return conflict(shiftUnavailableMessage(row.status, row.firstName), {
    error: 'SHIFT_UNAVAILABLE',
  });
}

/** Run a coverage transaction, translating the moved-on signal on the way out. */
async function inCoverageTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await writeTransaction(fn);
  } catch (err) {
    if (err instanceof ShiftMovedOn) throw await asShiftUnavailable(err.shiftId);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Claim (PRD cap 6, S1.2)
// ---------------------------------------------------------------------------

/**
 * `data-model.md §9`'s claim predicate, verbatim in structure:
 *
 *   UPDATE shift SET owner_id=:me, status='CLAIMED', updated_by=:me, updated_at=now()
 *   WHERE id=:id AND status='OPEN' AND owner_id IS NULL;   -- 0 rows => no longer available
 *
 * The predicate *is* the optimistic check — there is no version column and no
 * `SELECT ... FOR UPDATE` anywhere in R3. `assigned_over_conflict` is deliberately not
 * touched: `ck_shift_conflict_flag` plus I7's `ck_shift_owner` mean an OPEN row cannot
 * be carrying the flag in the first place, and self-select can never set it — it is
 * gated by `eligible()`, so it never assigns over a conflict.
 */
async function claimRow(tx: Tx, shiftId: string, driverId: string): Promise<boolean> {
  const result = await tx
    .updateTable('shift')
    .set({
      owner_id: driverId,
      status: 'CLAIMED',
      updated_by: driverId,
      updated_at: sql<Date>`now()`,
    })
    .where('id', '=', shiftId)
    .where('status', '=', 'OPEN')
    .where('owner_id', 'is', null)
    .executeTakeFirst();

  return Number(result.numUpdatedRows) === 1;
}

/**
 * Claim one run, or every run in its series.
 *
 * The transactional core is exported separately (`claimShiftIn`) so a test can drive
 * two genuinely concurrent SERIALIZABLE transactions with a barrier between the gate's
 * read and its write. That interleaving is the whole of I20's write-skew case and
 * cannot be produced through this wrapper, whose retry hides it (`CLAUDE.md`: tests run
 * against a migrated database because this is not testable against a mock).
 */
export async function claimShift(
  actor: CoverageActor,
  shiftId: string,
  scope: ClaimScope = 'ONE',
): Promise<ClaimResult> {
  return inCoverageTransaction((tx) => claimShiftIn(tx, actor, shiftId, scope));
}

export async function claimShiftIn(
  tx: Tx,
  actor: CoverageActor,
  shiftId: string,
  scope: ClaimScope = 'ONE',
): Promise<ClaimResult> {
  const shift = await loadShift(tx, shiftId);
  if (!shift) throw notFound('That run no longer exists.');

  // Whichever scope was asked for, the run the driver actually tapped must still be
  // open. A SERIES claim that silently skipped its own starting point would report a
  // partial success for a claim that never had a chance.
  if (shift.status !== 'OPEN') {
    // A double-tap on a run the caller already holds is not a lost race, and telling
    // them it "was just taken by" themselves would be nonsense.
    if (shift.ownerId === actor.id) throw conflict('That run is already yours.');
    throw new ShiftMovedOn(shift.id);
  }

  return scope === 'SERIES'
    ? claimSeries(tx, actor, shift)
    : claimOne(tx, actor, shift);
}

async function claimOne(
  tx: Tx,
  actor: CoverageActor,
  shift: ShiftRow,
): Promise<ClaimResult> {
  // I20, gate form: an ineligible driver cannot claim. Read inside this transaction,
  // so a block declared or a shift claimed between the check and the write is caught
  // by SSI rather than slipping through the middle of it (`architecture.md §4.1`).
  const eligibility = await evaluateEligibility(tx, actor.id, {
    id: shift.id,
    startsAt: shift.startsAt,
    endsAt: shift.endsAt,
  });

  if (!eligibility.eligible) {
    throw conflict(claimRefusedMessage(eligibility.reasons), {
      error: 'NOT_ELIGIBLE',
      eligibility,
    });
  }

  if (!(await claimRow(tx, shift.id, actor.id))) throw new ShiftMovedOn(shift.id);

  const claimed = [toCoveredShift(shift)];
  return withSummary({
    scope: 'ONE',
    claimed,
    skipped: [],
    requested: 1,
    partial: false,
    seriesLabel: null,
  });
}

/**
 * §5.3 `claim-all`:
 *
 *   claim-all   set ownerDefault = driver; set owner on existing future OPEN instances
 *               → CLAIMED (eligible() checked per instance; overlapping conflicts
 *               skipped, not claimed)
 *
 * **Partial success, never force-claim** (PRD cap 6, S1.2). `ownerDefault` is set
 * unconditionally — it is what the driver asked for and what makes *future* runs mint
 * to them — while each existing run passes I20's gate on its own. Runs minted later
 * are gated again at materialization (I25), which is the schedule lane's, not this
 * one's.
 *
 * The loop is sequential on purpose: each `eligible()` call reads this transaction's
 * own uncommitted writes, so a run overlapping one claimed a moment earlier in the same
 * loop is skipped rather than claimed. Evaluating the batch up front would let
 * claim-all be the one path that violates I20 against itself.
 */
async function claimSeries(
  tx: Tx,
  actor: CoverageActor,
  shift: ShiftRow,
): Promise<ClaimResult> {
  if (shift.patternId === null) {
    throw badRequest('That run does not repeat.');
  }

  const pattern = await tx
    .selectFrom('recurrence_pattern')
    .select(['id', 'weekdays'])
    .where('id', '=', shift.patternId)
    .executeTakeFirstOrThrow();

  // I23 forbids a per-instance action mutating the pattern; §5.3 makes claim-all the
  // named exception, because "claim every Tuesday run" IS a pattern-level statement —
  // it is what I24 calls an explicit pattern-level edit.
  await tx
    .updateTable('recurrence_pattern')
    .set({ owner_default_id: actor.id })
    .where('id', '=', pattern.id)
    .execute();

  const candidates = await tx
    .selectFrom('shift')
    .innerJoin('route', 'route.id', 'shift.route_id')
    .select([
      'shift.id as id',
      'shift.status as status',
      'shift.owner_id as ownerId',
      'shift.starts_at as startsAt',
      'shift.ends_at as endsAt',
      'shift.occurrence_date as occurrenceDate',
      'shift.recurrence_pattern_id as patternId',
      'route.name as routeName',
    ])
    .where('shift.recurrence_pattern_id', '=', pattern.id)
    .where('shift.status', '=', 'OPEN')
    // "existing future OPEN instances" (§5.3). The run the driver tapped is always in
    // the set, so SERIES is a superset of ONE even if that run starts within the hour.
    .where((eb) =>
      eb.or([eb('shift.starts_at', '>', sql<Date>`now()`), eb('shift.id', '=', shift.id)]),
    )
    .orderBy('shift.starts_at')
    .execute();

  const claimed: CoveredShift[] = [];
  const skipped: SkippedShift[] = [];

  for (const candidate of candidates) {
    const eligibility = await evaluateEligibility(tx, actor.id, {
      id: candidate.id,
      startsAt: candidate.startsAt,
      endsAt: candidate.endsAt,
    });

    if (!eligibility.eligible) {
      skipped.push({ ...toCoveredShift(candidate), reasons: [...eligibility.reasons] });
      continue;
    }

    if (await claimRow(tx, candidate.id, actor.id)) {
      claimed.push(toCoveredShift(candidate));
    } else {
      // The predicate matched nothing: someone else took this one. Skipped, not
      // fatal — the rest of the series is still the driver's to claim.
      const reasons: ClaimSkipReason[] = ['NO_LONGER_OPEN'];
      skipped.push({ ...toCoveredShift(candidate), reasons });
    }
  }

  return withSummary({
    scope: 'SERIES',
    claimed,
    skipped,
    requested: claimed.length + skipped.length,
    partial: skipped.length > 0,
    seriesLabel: weekdayLabel(pattern.weekdays),
  });
}

function withSummary(result: Omit<ClaimResult, 'summary'>): ClaimResult {
  return { ...result, summary: claimSummary(result) };
}

// ---------------------------------------------------------------------------
// Release (PRD cap 8, S1.3)
// ---------------------------------------------------------------------------

export interface ReleaseInput {
  scope?: ReleaseScope;
  fromDate?: string | undefined;
  toDate?: string | null | undefined;
}

/**
 * A driver releases coverage: `CLAIMED → OPEN`, one run or a date range.
 *
 * Cap 8: "at any time before it starts; no approval is required … In-progress and past
 * shifts cannot be released, and there is no minimum-notice floor." Both bounds live in
 * the UPDATE predicate rather than in a prior read, so they hold against a concurrent
 * start as well as against a stale screen.
 *
 * Not deletion and not staff's bulk-terminate: the runs go back on the board and the
 * series keeps generating (§5.3, I23).
 */
export async function releaseShift(
  actor: CoverageActor,
  shiftId: string,
  input: ReleaseInput = {},
): Promise<ReleaseResult> {
  const scope: ReleaseScope = input.scope ?? 'ONE';

  const result = await inCoverageTransaction(async (tx) => {
    const shift = await loadShift(tx, shiftId);
    if (!shift) throw notFound('That run no longer exists.');

    // Ownership is a resource rule: it needs the row, so it is settled here and not at
    // the route (`architecture.md §4.3`). Staff clearing someone else's run is a
    // different operation with a different notification — `unassignDriver` below.
    if (shift.ownerId !== actor.id) {
      // An unowned run is a double-tap, not a permission problem: saying "not yours"
      // to someone who released it a second ago would be both harsh and untrue.
      if (shift.ownerId === null) throw releaseRefusal(shift);
      throw forbidden("That run isn't yours to cancel.");
    }

    const timezone = await readTimezone(tx);
    const targets =
      scope === 'RANGE'
        ? await releaseRangeTargets(tx, actor, shift, input)
        : [shift];

    const released: CoveredShift[] = [];
    for (const target of targets) {
      if (await releaseRow(tx, target.id, actor.id)) {
        released.push(toCoveredShift(target));
        await notifyShiftOpened(tx, target, timezone, actor.id);
      } else if (scope === 'ONE') {
        // A single release that hits nothing is worth an explanation: the run either
        // started, passed, or is no longer this driver's.
        throw releaseRefusal(shift);
      }
      // In a range, a run that moved on since the read is simply not in the result.
    }

    return { scope, released, summary: releaseSummary(released) };
  });

  // Outside the transaction, always (§4.4): a SERIALIZABLE retry would re-send. The
  // minute sweep is what makes delivery correct; this only makes it prompt.
  if (result.released.length > 0) dispatchNow();
  return result;
}

/**
 * The release predicate. Three clauses carry three separate rules:
 *
 *   status='CLAIMED'    §3.1 — release is the CLAIMED→OPEN edge and only that one; an
 *                       IN_PROGRESS run has no release transition and OPEN has nothing
 *                       to release
 *   owner_id=:me        cap 8 — a driver releases *their own* run
 *   starts_at > now()   cap 8 — "before it starts"; a passed run cannot be handed back
 *
 * `assigned_over_conflict = false` rides along because this statement clears
 * `owner_id`, and `ck_shift_conflict_flag` rejects a flagged row with no owner
 * (migration 0008). Omitting it raises rather than leaving the next driver a banner
 * about a conflict that was never theirs.
 */
async function releaseRow(tx: Tx, shiftId: string, driverId: string): Promise<boolean> {
  const result = await tx
    .updateTable('shift')
    .set({
      status: 'OPEN',
      owner_id: null,
      assigned_over_conflict: false,
      updated_by: driverId,
      updated_at: sql<Date>`now()`,
    })
    .where('id', '=', shiftId)
    .where('status', '=', 'CLAIMED')
    .where('owner_id', '=', driverId)
    .where('starts_at', '>', sql<Date>`now()`)
    .executeTakeFirst();

  return Number(result.numUpdatedRows) === 1;
}

function releaseRefusal(shift: ShiftRow): Error {
  if (shift.status === 'IN_PROGRESS') {
    return conflict("That run has already started — it can't be cancelled.");
  }
  if (shift.status !== 'CLAIMED') {
    return conflict('That run is already back on the board.');
  }
  return conflict("That run's start time has passed — it can't be cancelled.");
}

/**
 * §5.3 `release-range`: "CLAIMED → OPEN on instances in [from, to]; ownerDefault
 * unchanged; pattern still generates beyond the range."
 *
 * `fromDate` defaults to this run's own date and `toDate` may be omitted, which is
 * S1.3's "this one, or this and future?" — the open-ended half of the same control.
 * Nothing here touches `recurrence_pattern` (I23).
 */
async function releaseRangeTargets(
  tx: Tx,
  actor: CoverageActor,
  shift: ShiftRow,
  input: ReleaseInput,
): Promise<ShiftRow[]> {
  if (shift.patternId === null) {
    throw badRequest('That run does not repeat, so there is no range to cancel.');
  }

  const from = input.fromDate ?? toDateString(shift.occurrenceDate);
  parseDate(from, 'fromDate');
  const to = input.toDate ?? null;
  if (to !== null) {
    parseDate(to, 'toDate');
    if (to < from) throw badRequest('toDate must be on or after fromDate.');
  }

  let query = tx
    .selectFrom('shift')
    .innerJoin('route', 'route.id', 'shift.route_id')
    .select([
      'shift.id as id',
      'shift.status as status',
      'shift.owner_id as ownerId',
      'shift.starts_at as startsAt',
      'shift.ends_at as endsAt',
      'shift.occurrence_date as occurrenceDate',
      'shift.recurrence_pattern_id as patternId',
      'route.name as routeName',
    ])
    .where('shift.recurrence_pattern_id', '=', shift.patternId)
    .where('shift.owner_id', '=', actor.id)
    .where('shift.status', '=', 'CLAIMED')
    .where('shift.starts_at', '>', sql<Date>`now()`)
    // Cast in SQL rather than passing a JS Date: `occurrence_date` is a calendar slot
    // and a Date parameter would arrive as an instant, comparing off by the pantry's
    // UTC offset at exactly the range's two edges.
    .where('shift.occurrence_date', '>=', sql<Date>`${from}::date`);

  if (to !== null) {
    query = query.where('shift.occurrence_date', '<=', sql<Date>`${to}::date`);
  }

  return query.orderBy('shift.starts_at').execute();
}

// ---------------------------------------------------------------------------
// Staff assign / unassign (PRD cap 6 fallback, S1.6)
// ---------------------------------------------------------------------------

export interface AssignInput {
  driverId: string;
  confirmConflict?: boolean | undefined;
}

/**
 * Staff sets the owner. **Not gated by `eligible()`** — this is I20's exemption, "the
 * deliberate override authority for the fallback path".
 *
 * The sequence the docs fix (I20 note, S1.6, PRD cap 6): evaluate eligibility; if it
 * conflicts, warn and require explicit confirmation; on confirmation write the
 * assignment anyway and **flag the shift**, so the driver sees the conflict on S1.3 and
 * can raise it with Staff. What Staff may confirm through is the temporal half of
 * `eligible()` — see `CONFIRMABLE_REASONS`.
 */
export async function assignDriver(
  actor: CoverageActor,
  shiftId: string,
  input: AssignInput,
): Promise<AssignResult> {
  const result = await inCoverageTransaction(async (tx) => {
    const shift = await loadShift(tx, shiftId);
    if (!shift) throw notFound('That run no longer exists.');

    // A run under way cannot change hands wholesale: I30 moves *stops* to another
    // driver mid-run precisely because the shift itself is not the unit that moves
    // (its truck is picked and its stops are snapshotted, I5/I8). CANCELLED and
    // COMPLETED are terminal (I10).
    if (shift.status !== 'OPEN' && shift.status !== 'CLAIMED') {
      throw conflict("That run has already started — its driver can't be changed.");
    }

    const { eligibility, driver } = await assessDriver(tx, input.driverId, shift);
    const blocking = eligibility.reasons.filter((r) => !CONFIRMABLE_REASONS.includes(r));
    if (blocking.length > 0) {
      throw conflict(blockedAssignMessage(blocking), {
        error: 'DRIVER_UNAVAILABLE',
        eligibility,
      });
    }

    const warning = assignWarningMessage(driver.firstName, eligibility.reasons);
    if (warning !== null && input.confirmConflict !== true) {
      throw conflict(warning, { error: 'ASSIGN_CONFLICT', eligibility });
    }

    const overConflict = warning !== null;
    const updated = await tx
      .updateTable('shift')
      .set({
        owner_id: input.driverId,
        status: 'CLAIMED',
        // I20's exemption made visible. Written on every assignment, not only the
        // conflicting ones: reassigning a flagged run to an unconflicted driver has to
        // clear the banner the previous assignment raised.
        assigned_over_conflict: overConflict,
        updated_by: actor.id,
        updated_at: sql<Date>`now()`,
      })
      .where('id', '=', shift.id)
      .where('status', 'in', ['OPEN', 'CLAIMED'])
      .executeTakeFirst();

    if (Number(updated.numUpdatedRows) !== 1) throw new ShiftMovedOn(shift.id);

    // "Shift assigned / defaulted to you → the owning driver" (PRD §4 matrix).
    const timezone = await readTimezone(tx);
    await enqueueNotifications(tx, [
      {
        event: 'SHIFT_ASSIGNED',
        recipientId: input.driverId,
        shiftId: shift.id,
        payload: {
          route: shift.routeName,
          when: formatRange({ startsAt: shift.startsAt, endsAt: shift.endsAt }, timezone),
        },
      },
    ]);

    return {
      shift: toCoveredShift(shift),
      driverId: input.driverId,
      assignedOverConflict: overConflict,
    };
  });

  dispatchNow();
  return result;
}

/**
 * Staff removes the owner; the run goes back on the board as OPEN.
 *
 * The matrix names this explicitly: "Shift returns to the board as open — release
 * (cap 8), reschedule conflict (cap 9), or **staff unassign**. Never from CANCELLED,
 * which is terminal." So this is a transition to OPEN, not to CANCELLED — killing a run
 * is staff's separate bulk-terminate.
 */
export async function unassignDriver(
  actor: CoverageActor,
  shiftId: string,
): Promise<UnassignResult> {
  const result = await inCoverageTransaction(async (tx) => {
    const shift = await loadShift(tx, shiftId);
    if (!shift) throw notFound('That run no longer exists.');
    if (shift.status !== 'CLAIMED') {
      throw conflict(
        shift.status === 'IN_PROGRESS'
          ? "That run has already started — its driver can't be removed."
          : 'That run has no driver to remove.',
      );
    }

    const updated = await tx
      .updateTable('shift')
      .set({
        status: 'OPEN',
        owner_id: null,
        // Clears with the owner it warned about (migration 0008 / `data-model.md §9`).
        assigned_over_conflict: false,
        updated_by: actor.id,
        updated_at: sql<Date>`now()`,
      })
      .where('id', '=', shift.id)
      .where('status', '=', 'CLAIMED')
      .executeTakeFirst();

    if (Number(updated.numUpdatedRows) !== 1) throw new ShiftMovedOn(shift.id);

    const timezone = await readTimezone(tx);
    await notifyShiftOpened(tx, shift, timezone, actor.id);

    return { shift: toCoveredShift(shift) };
  });

  dispatchNow();
  return result;
}

/**
 * S1.6 surfaces the conflict *before* Staff confirms. Read-only and advisory — the
 * same evaluation `assignDriver` runs again inside its transaction, because a check
 * that is not in the writing transaction decides nothing.
 */
export async function previewAssignment(
  shiftId: string,
  driverId: string,
): Promise<EligibilityPreviewResponse> {
  const shift = await loadShift(db, shiftId);
  if (!shift) throw notFound('That run no longer exists.');

  const { eligibility, driver } = await assessDriver(db, driverId, shift);
  const blocking = eligibility.reasons.filter((r) => !CONFIRMABLE_REASONS.includes(r));

  return {
    shiftId,
    driverId,
    eligibility,
    warning:
      blocking.length > 0
        ? blockedAssignMessage(blocking)
        : assignWarningMessage(driver.firstName, eligibility.reasons),
  };
}

async function assessDriver(
  reader: Reader,
  driverId: string,
  shift: ShiftRow,
): Promise<{ eligibility: EligibilitySummary; driver: { firstName: string } }> {
  const person = await reader
    .selectFrom('app_user')
    .select(['first_name as firstName'])
    .where('id', '=', driverId)
    .executeTakeFirst();

  const eligibility = await evaluateEligibility(reader, driverId, {
    id: shift.id,
    startsAt: shift.startsAt,
    endsAt: shift.endsAt,
  });

  return { eligibility, driver: { firstName: person?.firstName ?? '' } };
}

function blockedAssignMessage(reasons: readonly EligibilityReason[]): string {
  if (reasons.includes('UNKNOWN_USER')) return 'No such person.';
  if (reasons.includes('DEACTIVATED')) return 'That account is switched off.';
  return "That person isn't set up to drive.";
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

async function readTimezone(reader: Reader): Promise<string> {
  const config = await reader
    .selectFrom('app_config')
    .select('timezone')
    .executeTakeFirstOrThrow();
  return config.timezone;
}

/**
 * "Shift returns to the board as open → Coordinator + eligible drivers" (PRD §4
 * matrix). The eligible-driver set is `eligible()` over every driver, computed at send
 * time (`eligibleDriverIds`), which is exactly what the matrix says it is.
 *
 * `exceptId` drops the person who caused it: a driver releasing their own run is,
 * one statement later, an eligible driver for it, and telling them a run needs a
 * driver is noise about their own action. For a staff unassign the actor is Staff, so
 * the ex-owner stays in the set and hears that the run is back on the board.
 *
 * Rows are written inside the caller's business transaction — the `notification` table
 * IS the outbox (§4.4) — and the push goes out after commit, never here.
 */
async function notifyShiftOpened(
  tx: Tx,
  shift: ShiftRow,
  timezone: string,
  exceptId: string,
): Promise<void> {
  const coordinators = await tx
    .selectFrom('app_user')
    .select('id')
    .where('tier', 'in', COORDINATOR_TIERS)
    // A deactivated coordinator cannot read an inbox (I21 — hidden from new use).
    .where('deactivated_at', 'is', null)
    .execute();

  const drivers = await eligibleDriverIds(tx, {
    id: shift.id,
    startsAt: shift.startsAt,
    endsAt: shift.endsAt,
  });

  const recipients = new Set([...coordinators.map((c) => c.id), ...drivers]);
  recipients.delete(exceptId);

  await enqueueNotifications(
    tx,
    [...recipients].map((recipientId) => ({
      event: 'SHIFT_OPENED' as const,
      recipientId,
      shiftId: shift.id,
      payload: {
        route: shift.routeName,
        when: formatRange({ startsAt: shift.startsAt, endsAt: shift.endsAt }, timezone),
      },
    })),
  );
}

// ---------------------------------------------------------------------------
// At-risk sweep (`architecture.md §4.4`)
// ---------------------------------------------------------------------------

/**
 * "At-risk alert, 1 day before an unclaimed shift" (§4.4) — the offset is fixed, like
 * the reminder's hard-coded hour (PRD §4 matrix).
 *
 * The sweep's own bound is the SQL `interval '1 day'` below, evaluated against the
 * database clock rather than a process that may have just restarted; this constant is
 * the same number for anything that needs to reason about the window in JS.
 */
export const AT_RISK_LEAD_MS = 24 * 60 * 60 * 1000;

/**
 * "Shift still open and at-risk (1 day before start) → Coordinator + eligible drivers"
 * (PRD §4 matrix), as a catch-up sweep: it asks **what is due and unhandled**, never
 * "fire at time T" (§4.4). A missed tick or a restart therefore delays the alert
 * instead of losing it.
 *
 * "Unhandled" is a `NOT EXISTS` on the notification rows themselves — the same table
 * the tier-1 index `uq_notif_shift_event` dedupes on, so a sweep racing itself cannot
 * double-send even if the read says otherwise.
 *
 * Runs still open whose start has already passed are excluded: that run is derived
 * MISSED/UNCLAIMED (`§3.1`), and "still open for tomorrow" would be untrue.
 *
 * Called by `jobs/at-risk.ts`, which cannot open a transaction of its own — nothing
 * outside `services/` may (§4.1).
 */
export async function sweepAtRiskShifts(): Promise<number> {
  return writeTransaction(async (tx) => {
    const timezone = await readTimezone(tx);

    const due = await tx
      .selectFrom('shift')
      .innerJoin('route', 'route.id', 'shift.route_id')
      .select([
        'shift.id as id',
        'shift.status as status',
        'shift.owner_id as ownerId',
        'shift.starts_at as startsAt',
        'shift.ends_at as endsAt',
        'shift.occurrence_date as occurrenceDate',
        'shift.recurrence_pattern_id as patternId',
        'route.name as routeName',
      ])
      .where('shift.status', '=', 'OPEN')
      .where('shift.starts_at', '>', sql<Date>`now()`)
      .where('shift.starts_at', '<=', sql<Date>`now() + interval '1 day'`)
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('notification')
              .select('notification.id')
              .whereRef('notification.shift_id', '=', 'shift.id')
              .where('notification.event', '=', 'SHIFT_AT_RISK'),
          ),
        ),
      )
      .orderBy('shift.starts_at')
      .execute();

    for (const shift of due) {
      await notifyAtRisk(tx, shift, timezone);
    }

    return due.length;
  });
}

async function notifyAtRisk(tx: Tx, shift: ShiftRow, timezone: string): Promise<void> {
  const coordinators = await tx
    .selectFrom('app_user')
    .select('id')
    .where('tier', 'in', COORDINATOR_TIERS)
    .where('deactivated_at', 'is', null)
    .execute();

  const drivers = await eligibleDriverIds(tx, {
    id: shift.id,
    startsAt: shift.startsAt,
    endsAt: shift.endsAt,
  });

  const recipients = new Set([...coordinators.map((c) => c.id), ...drivers]);

  await enqueueNotifications(
    tx,
    [...recipients].map((recipientId) => ({
      event: 'SHIFT_AT_RISK' as const,
      recipientId,
      shiftId: shift.id,
      payload: {
        route: shift.routeName,
        when: formatRange({ startsAt: shift.startsAt, endsAt: shift.endsAt }, timezone),
      },
    })),
  );
}
