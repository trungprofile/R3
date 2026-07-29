// Claim — I20's hard gate and `data-model.md §9`'s claim atomicity.
//
// Against the MIGRATED database (CLAUDE.md), because both rules only exist there:
// `ck_shift_owner` and `ck_shift_conflict_flag` are real DDL, and the claim race needs
// two genuinely concurrent SERIALIZABLE transactions. A mock would pass every assertion
// below while the deployed database behaved differently.
//
// Windows are relative to `Date.now()` rather than a fixed calendar date: release and
// the at-risk sweep both compare against the database clock, so a test pinned to a
// literal date would start failing on its own the day that date passed.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { db, pool } from '../src/db/index.js';
import { AppError } from '../src/middleware/error.js';
import { claimShift, claimShiftIn, type CoverageActor } from '../src/services/coverage.js';
import {
  makeAvailabilityBlock,
  makeDriver,
  makeRoute,
  makeShift,
  makeUser,
  resetDatabase,
} from './fixtures.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function at(offsetMs: number): Date {
  return new Date(Date.now() + offsetMs);
}

function driverActor(id: string): CoverageActor {
  return { id, tier: 'VOLUNTEER' };
}

beforeEach(resetDatabase);
afterAll(async () => {
  await db.destroy();
  await pool.end().catch(() => undefined);
});

async function readShift(id: string) {
  return db.selectFrom('shift').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
}

describe('claim — the transition (§3.1: OPEN → CLAIMED)', () => {
  it('sets the owner, the status and the provenance stamp', async () => {
    const driver = await makeDriver();
    const shift = await makeShift({
      createdBy: driver.id,
      startsAt: at(3 * DAY),
      endsAt: at(3 * DAY + 2 * HOUR),
    });

    const result = await claimShift(driverActor(driver.id), shift.id);

    const row = await readShift(shift.id);
    expect(row.status).toBe('CLAIMED');
    expect(row.owner_id).toBe(driver.id);
    expect(row.updated_by).toBe(driver.id); // I26 — last writer
    // Self-select is gated by eligible(), so it can never assign over a conflict and
    // never raises S1.3's banner (migration 0008).
    expect(row.assigned_over_conflict).toBe(false);

    expect(result.scope).toBe('ONE');
    expect(result.claimed).toHaveLength(1);
    expect(result.partial).toBe(false);
    expect(result.summary).toBe("You're on this run.");
  });

  it('notifies nobody — the matrix has no row for a driver claiming their own run', async () => {
    // "Shift assigned / defaulted to you" is the staff-assign path (PRD §4 matrix);
    // telling a driver what they just did themselves is not in it.
    const driver = await makeDriver();
    const shift = await makeShift({ createdBy: driver.id, startsAt: at(3 * DAY) });

    await claimShift(driverActor(driver.id), shift.id);

    expect(await db.selectFrom('notification').selectAll().execute()).toEqual([]);
  });

  it('leaves the run alone when the claim is refused', async () => {
    const driver = await makeUser({ duties: ['RECEIVE'] });
    const shift = await makeShift({ createdBy: driver.id, startsAt: at(3 * DAY) });

    await expect(claimShift(driverActor(driver.id), shift.id)).rejects.toBeInstanceOf(
      AppError,
    );

    const row = await readShift(shift.id);
    expect(row.status).toBe('OPEN');
    expect(row.owner_id).toBeNull();
  });
});

describe('claim — I20 as a hard gate (§5.2, "an ineligible driver cannot claim")', () => {
  it('refuses a user without the Drive duty', async () => {
    // I2 is set membership: holding RECEIVE says nothing about DRIVE.
    const receiver = await makeUser({ duties: ['RECEIVE'] });
    const shift = await makeShift({ createdBy: receiver.id, startsAt: at(3 * DAY) });

    await expect(claimShift(driverActor(receiver.id), shift.id)).rejects.toMatchObject({
      status: 409,
      details: { error: 'NOT_ELIGIBLE' },
    });
  });

  it('refuses a Staff user without the Drive duty — tier never confers a duty', async () => {
    const staff = await makeUser({ tier: 'STAFF', duties: [] });
    const shift = await makeShift({ createdBy: staff.id, startsAt: at(3 * DAY) });

    await expect(
      claimShift({ id: staff.id, tier: 'STAFF' }, shift.id),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('refuses a deactivated driver (I21 — hidden from new use)', async () => {
    const driver = await makeDriver({ deactivated: true });
    const author = await makeUser({ tier: 'ADMIN' });
    const shift = await makeShift({ createdBy: author.id, startsAt: at(3 * DAY) });

    await expect(claimShift(driverActor(driver.id), shift.id)).rejects.toMatchObject({
      status: 409,
    });
  });

  it('refuses a run overlapping the driver’s declared availability', async () => {
    const driver = await makeDriver();
    const shift = await makeShift({
      createdBy: driver.id,
      startsAt: at(3 * DAY),
      endsAt: at(3 * DAY + 2 * HOUR),
    });
    await makeAvailabilityBlock(driver.id, at(3 * DAY - HOUR), at(3 * DAY + HOUR));

    const err = await claimShift(driverActor(driver.id), shift.id).catch((e: AppError) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).details).toMatchObject({
      eligibility: { reasons: ['AVAILABILITY_BLOCK'] },
    });
    expect((err as AppError).message).toMatch(/marked yourself away/);
  });

  it('refuses a run overlapping another owned CLAIMED run', async () => {
    const driver = await makeDriver();
    const route = await makeRoute();
    await makeShift({
      createdBy: driver.id,
      routeId: route.route.id,
      ownerId: driver.id,
      status: 'CLAIMED',
      startsAt: at(3 * DAY),
      endsAt: at(3 * DAY + 2 * HOUR),
    });
    const wanted = await makeShift({
      createdBy: driver.id,
      startsAt: at(3 * DAY + HOUR),
      endsAt: at(3 * DAY + 3 * HOUR),
    });

    await expect(claimShift(driverActor(driver.id), wanted.id)).rejects.toMatchObject({
      details: { eligibility: { reasons: ['OWNED_SHIFT_OVERLAP'] } },
    });
  });

  // Build-plan D1, stated there as a consequence to expect in this lane: nothing in
  // Phase 1 reaches COMPLETED, so an old IN_PROGRESS run stays in I20's occupying set
  // forever and keeps excluding its driver from overlapping runs. That is the invariant
  // holding, not a bug to work around.
  it('refuses a run overlapping an old IN_PROGRESS run (D1)', async () => {
    const driver = await makeDriver();
    await makeShift({
      createdBy: driver.id,
      ownerId: driver.id,
      status: 'IN_PROGRESS',
      startsAt: at(-30 * DAY),
      endsAt: at(-30 * DAY + 2 * HOUR),
    });
    const wanted = await makeShift({
      createdBy: driver.id,
      startsAt: at(-30 * DAY + HOUR),
      endsAt: at(-30 * DAY + 3 * HOUR),
    });

    await expect(claimShift(driverActor(driver.id), wanted.id)).rejects.toMatchObject({
      details: { eligibility: { reasons: ['OWNED_SHIFT_OVERLAP'] } },
    });
  });

  it('allows a run that only touches an owned run — the window is half-open', async () => {
    const driver = await makeDriver();
    await makeShift({
      createdBy: driver.id,
      ownerId: driver.id,
      status: 'CLAIMED',
      startsAt: at(3 * DAY),
      endsAt: at(3 * DAY + 2 * HOUR),
    });
    const next = await makeShift({
      createdBy: driver.id,
      startsAt: at(3 * DAY + 2 * HOUR),
      endsAt: at(3 * DAY + 4 * HOUR),
    });

    await claimShift(driverActor(driver.id), next.id);
    expect((await readShift(next.id)).owner_id).toBe(driver.id);
  });

  it('ignores a CANCELLED run of the driver’s own (§5.2 excludes it by state)', async () => {
    const driver = await makeDriver();
    await makeShift({
      createdBy: driver.id,
      status: 'CANCELLED',
      startsAt: at(3 * DAY),
      endsAt: at(3 * DAY + 2 * HOUR),
    });
    const wanted = await makeShift({
      createdBy: driver.id,
      startsAt: at(3 * DAY),
      endsAt: at(3 * DAY + 2 * HOUR),
    });

    await claimShift(driverActor(driver.id), wanted.id);
    expect((await readShift(wanted.id)).owner_id).toBe(driver.id);
  });
});

describe('claim — stale state (§9: rowcount 0 means the run moved on)', () => {
  it('answers a run someone else already holds with §6’s revert toast', async () => {
    const karen = await makeDriver({ firstName: 'Karen' });
    const other = await makeDriver();
    const shift = await makeShift({
      createdBy: karen.id,
      ownerId: karen.id,
      status: 'CLAIMED',
      startsAt: at(3 * DAY),
    });

    const err = await claimShift(driverActor(other.id), shift.id).catch((e: AppError) => e);
    expect((err as AppError).status).toBe(409);
    expect((err as AppError).details).toMatchObject({ error: 'SHIFT_UNAVAILABLE' });
    expect((err as AppError).message).toBe('That run was just taken by Karen.');
  });

  it('tells a driver who double-taps that the run is already theirs', async () => {
    const driver = await makeDriver();
    const shift = await makeShift({
      createdBy: driver.id,
      ownerId: driver.id,
      status: 'CLAIMED',
      startsAt: at(3 * DAY),
    });

    await expect(claimShift(driverActor(driver.id), shift.id)).rejects.toMatchObject({
      status: 409,
      message: 'That run is already yours.',
    });
  });

  it('names cancellation rather than a person when the run was pulled', async () => {
    const driver = await makeDriver();
    const shift = await makeShift({
      createdBy: driver.id,
      status: 'CANCELLED',
      startsAt: at(3 * DAY),
    });

    await expect(claimShift(driverActor(driver.id), shift.id)).rejects.toMatchObject({
      message: 'That run was cancelled.',
    });
  });

  it('404s a run that no longer exists', async () => {
    const driver = await makeDriver();
    await expect(
      claimShift(driverActor(driver.id), '00000000-0000-0000-0000-000000000000'),
    ).rejects.toMatchObject({ status: 404 });
  });
});

// ---------------------------------------------------------------------------
// Concurrency
//
// `architecture.md §4.1` names one canonical case for the whole SERIALIZABLE decision:
// "A driver double-taps Claim on two overlapping runs; both transactions read 'no
// overlapping owned shift' — true when each reads it — both update a DIFFERENT shift
// row that is legitimately OPEN, and both commit. Tier 2 passed, tier 1 cannot express
// a relationship spanning two rows in two transactions, and the tier-3 gate was true
// when read."
//
// The barrier below is what makes that interleaving real rather than hoped for: each
// transaction takes its snapshot, both wait, and only then does either write. Without
// it the two claims would usually serialize by luck and the test would pass while
// proving nothing.
// ---------------------------------------------------------------------------

function barrier(parties: number): () => Promise<void> {
  let arrived = 0;
  const waiting: Array<() => void> = [];
  return () =>
    new Promise<void>((resolve) => {
      waiting.push(resolve);
      if (++arrived >= parties) for (const release of waiting.splice(0)) release();
    });
}

/** One claim in its own real SERIALIZABLE transaction, holding at the barrier between
 *  taking a snapshot and running the service's transactional core. */
async function concurrentClaim(
  wait: () => Promise<void>,
  actor: CoverageActor,
  shiftId: string,
): Promise<unknown> {
  return db
    .transaction()
    .setIsolationLevel('serializable')
    .execute(async (tx) => {
      // First statement fixes this transaction's snapshot.
      await sql`SELECT 1`.execute(tx);
      await wait();
      return claimShiftIn(tx, actor, shiftId);
    });
}

function isSerializationFailure(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === '40001';
}

describe('claim — two genuinely concurrent SERIALIZABLE transactions', () => {
  it('lets exactly one of two drivers take the same open run', async () => {
    const first = await makeDriver();
    const second = await makeDriver();
    const shift = await makeShift({ createdBy: first.id, startsAt: at(3 * DAY) });

    const wait = barrier(2);
    const settled = await Promise.allSettled([
      concurrentClaim(wait, driverActor(first.id), shift.id),
      concurrentClaim(wait, driverActor(second.id), shift.id),
    ]);

    expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

    const row = await readShift(shift.id);
    expect(row.status).toBe('CLAIMED');
    expect([first.id, second.id]).toContain(row.owner_id);

    // The loser lost at the database, not at a read: with both snapshots taken before
    // either wrote, the second UPDATE meets a row a committed transaction has changed
    // ("could not serialize access due to concurrent update"). `writeTransaction` turns
    // that into a retry, which is what the public-path test below covers.
    const rejected = settled.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(isSerializationFailure(rejected.reason)).toBe(true);
  });

  it('holds I20 when one driver claims two overlapping runs at once (write skew)', async () => {
    const driver = await makeDriver();
    const early = await makeShift({
      createdBy: driver.id,
      startsAt: at(3 * DAY),
      endsAt: at(3 * DAY + 2 * HOUR),
    });
    const late = await makeShift({
      createdBy: driver.id,
      startsAt: at(3 * DAY + HOUR),
      endsAt: at(3 * DAY + 3 * HOUR),
    });

    const wait = barrier(2);
    const settled = await Promise.allSettled([
      concurrentClaim(wait, driverActor(driver.id), early.id),
      concurrentClaim(wait, driverActor(driver.id), late.id),
    ]);

    // Both gates read "no overlapping owned shift" and both were right when they read
    // it; the two rows written are different, so no row lock and no tier-2 predicate
    // sees a problem. Only SSI can catch what the two writes together mean — and it
    // does, with "could not serialize access due to read/write dependencies among
    // transactions". This assertion is the reason §4.1 chose SERIALIZABLE.
    expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = settled.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(isSerializationFailure(rejected.reason)).toBe(true);

    const owned = await db
      .selectFrom('shift')
      .select('id')
      .where('owner_id', '=', driver.id)
      .where('status', 'in', ['CLAIMED', 'IN_PROGRESS'])
      .execute();
    expect(owned).toHaveLength(1);
  });

  it('turns the retried loser into "that run was just taken", through the public path', async () => {
    // Same race, but through `claimShift`, where `writeTransaction` retries the 40001
    // and the retry re-reads a board on which the run is already gone.
    const karen = await makeDriver({ firstName: 'Karen' });
    const other = await makeDriver();
    const shift = await makeShift({ createdBy: karen.id, startsAt: at(3 * DAY) });

    const settled = await Promise.allSettled([
      claimShift(driverActor(karen.id), shift.id),
      claimShift(driverActor(other.id), shift.id),
    ]);

    expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = settled.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(AppError);
    expect((rejected.reason as AppError).status).toBe(409);
    expect((rejected.reason as AppError).message).toMatch(/no longer available|just taken/);
  });
});
