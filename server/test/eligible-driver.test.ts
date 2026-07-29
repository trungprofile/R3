// `eligible()`'s non-arithmetic clauses (`domain-modeling.md §5.2`): the Drive duty,
// which shift states occupy a driver, whose shifts count, and what the predicate
// reports back when it says no.
//
// The overlap matrix itself is `eligible-overlap.test.ts`. This file is about
// everything the overlap is applied TO.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/index.js';
import { writeTransaction } from '../src/db/transaction.js';
import {
  conflictingOwnedShifts,
  eligible,
  eligibleDriverIds,
  evaluateEligibility,
} from '../src/services/eligibility.js';
import {
  makeAdmin,
  makeAvailabilityBlock,
  makeDriver,
  makeShift,
  makeUser,
  resetDatabase,
} from './fixtures.js';

const SHIFT = {
  startsAt: new Date('2026-08-04T10:00:00.000Z'),
  endsAt: new Date('2026-08-04T12:00:00.000Z'),
};

/** Overlaps SHIFT, whatever the state under test is. */
const OVERLAPPING = {
  startsAt: new Date('2026-08-04T11:00:00.000Z'),
  endsAt: new Date('2026-08-04T13:00:00.000Z'),
};

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await db.destroy();
  await pool.end().catch(() => undefined);
});

describe('the Drive duty clause', () => {
  it('admits a driver holding Drive, whatever their tier', async () => {
    const volunteer = await makeDriver();
    const admin = await makeAdmin(); // ADMIN, holds all three duties

    expect(await eligible(db, volunteer.id, SHIFT)).toBe(true);
    expect(await eligible(db, admin.id, SHIFT)).toBe(true);
  });

  it('refuses a user without Drive, however senior', async () => {
    // I2 is set membership: holding RECEIVE says nothing about DRIVE, and I1's
    // hierarchy does not reach across — a Staff tier is not a duty.
    const receiver = await makeUser({ duties: ['RECEIVE', 'REPORT'] });
    const staff = await makeUser({ tier: 'STAFF', duties: [] });

    expect(await eligible(db, receiver.id, SHIFT)).toBe(false);
    expect((await evaluateEligibility(db, receiver.id, SHIFT)).reasons).toEqual([
      'NO_DRIVE_DUTY',
    ]);
    expect(await eligible(db, staff.id, SHIFT)).toBe(false);
  });

  it('refuses a deactivated driver, and leaves them out of the fan-out set', async () => {
    // I21 — a soft-deleted account is hidden from new use.
    const gone = await makeDriver({ deactivated: true });
    const here = await makeDriver();

    expect((await evaluateEligibility(db, gone.id, SHIFT)).reasons).toEqual([
      'DEACTIVATED',
    ]);
    expect(await eligibleDriverIds(db, SHIFT)).toEqual([here.id]);
  });

  it('refuses an id that is nobody', async () => {
    const result = await evaluateEligibility(
      db,
      '00000000-0000-0000-0000-000000000000',
      SHIFT,
    );
    expect(result.eligible).toBe(false);
    expect(result.reasons).toEqual(['UNKNOWN_USER']);
  });
});

describe('which owned shifts occupy a driver (I20)', () => {
  it('counts CLAIMED and IN_PROGRESS', async () => {
    for (const status of ['CLAIMED', 'IN_PROGRESS'] as const) {
      const driver = await makeDriver();
      await makeShift({
        ownerId: driver.id,
        status,
        startsAt: OVERLAPPING.startsAt,
        endsAt: OVERLAPPING.endsAt,
      });
      expect(await eligible(db, driver.id, SHIFT), status).toBe(false);
    }
  });

  it('does not count a COMPLETED shift — availability may overlap it freely', async () => {
    // §5.2: "COMPLETED / CANCELLED owned shifts are excluded by the state filter."
    const driver = await makeDriver();
    await makeShift({
      ownerId: driver.id,
      status: 'COMPLETED',
      startsAt: OVERLAPPING.startsAt,
      endsAt: OVERLAPPING.endsAt,
    });
    expect(await eligible(db, driver.id, SHIFT)).toBe(true);
  });

  it('does not count a CANCELLED shift — which cannot even keep its owner', async () => {
    // `ck_shift_owner` is tier 1: cancelling clears `owner_id`, so a CANCELLED row
    // is not "owned" at all. Asserted through the constraint rather than described.
    const driver = await makeDriver();
    await expect(
      makeShift({
        ownerId: driver.id,
        status: 'CANCELLED',
        startsAt: OVERLAPPING.startsAt,
        endsAt: OVERLAPPING.endsAt,
      }),
    ).rejects.toThrow(/ck_shift_owner/);

    await makeShift({
      ownerId: null,
      status: 'CANCELLED',
      startsAt: OVERLAPPING.startsAt,
      endsAt: OVERLAPPING.endsAt,
    });
    expect(await eligible(db, driver.id, SHIFT)).toBe(true);
  });

  it('keeps excluding on an old IN_PROGRESS run, which in Phase 1 never ends', async () => {
    // Build-plan D1: I11 makes receive-done the only completion action and the
    // receiver ships in Phase 2, so a started run stays IN_PROGRESS permanently and
    // stays in I20's counted set. Correct per the invariant, not a gap to work
    // around — this test exists so nobody "fixes" it.
    const driver = await makeDriver();
    await makeShift({
      ownerId: driver.id,
      status: 'IN_PROGRESS',
      startsAt: new Date('2026-08-04T09:00:00.000Z'),
      endsAt: new Date('2026-08-04T11:00:00.000Z'),
    });

    const result = await evaluateEligibility(db, driver.id, SHIFT);
    expect(result.eligible).toBe(false);
    expect(result.reasons).toEqual(['OWNED_SHIFT_OVERLAP']);
  });

  it('ignores another driver’s overlapping shift', async () => {
    const mine = await makeDriver();
    const theirs = await makeDriver();
    await makeShift({
      ownerId: theirs.id,
      status: 'CLAIMED',
      startsAt: OVERLAPPING.startsAt,
      endsAt: OVERLAPPING.endsAt,
    });
    expect(await eligible(db, mine.id, SHIFT)).toBe(true);
  });

  it('ignores an unowned OPEN shift in the same window', async () => {
    const driver = await makeDriver();
    await makeShift({
      status: 'OPEN',
      startsAt: OVERLAPPING.startsAt,
      endsAt: OVERLAPPING.endsAt,
    });
    expect(await eligible(db, driver.id, SHIFT)).toBe(true);
  });

  it('never lets a shift disqualify itself (§5.2’s S ≠ shift)', async () => {
    // The reschedule path (PRD cap 9) asks "is the owner still eligible for their
    // own shift?" — without the exclusion the answer is always no.
    const driver = await makeDriver();
    const shift = await makeShift({
      ownerId: driver.id,
      status: 'CLAIMED',
      startsAt: SHIFT.startsAt,
      endsAt: SHIFT.endsAt,
    });

    expect(
      await eligible(db, driver.id, {
        id: shift.id,
        startsAt: shift.starts_at,
        endsAt: shift.ends_at,
      }),
    ).toBe(true);
    // Without the exclusion it is its own conflict, which is the bug this guards.
    expect(
      await eligible(db, driver.id, { startsAt: shift.starts_at, endsAt: shift.ends_at }),
    ).toBe(false);
    expect(await eligibleDriverIds(db, { id: shift.id, ...SHIFT })).toContain(driver.id);
  });
});

describe('what the predicate reports', () => {
  it('reports every failing clause, not just the first', async () => {
    // Staff-assign is advisory (I20’s exemption) and must be able to say what the
    // conflict is, so the clauses are all evaluated even once one has failed.
    const driver = await makeDriver();
    await makeAvailabilityBlock(driver.id, OVERLAPPING.startsAt, OVERLAPPING.endsAt);
    const shift = await makeShift({
      ownerId: driver.id,
      status: 'CLAIMED',
      startsAt: OVERLAPPING.startsAt,
      endsAt: OVERLAPPING.endsAt,
    });

    const result = await evaluateEligibility(db, driver.id, SHIFT);
    expect(result.reasons).toEqual(['AVAILABILITY_BLOCK', 'OWNED_SHIFT_OVERLAP']);
    expect(result.conflictingShiftIds).toEqual([shift.id]);
    expect(result.conflictingBlockIds).toHaveLength(1);
    expect(result.driverId).toBe(driver.id);
  });

  it('names the route on an owned-shift conflict, for the S1.4 message', async () => {
    const driver = await makeDriver();
    await makeShift({
      ownerId: driver.id,
      status: 'CLAIMED',
      startsAt: OVERLAPPING.startsAt,
      endsAt: OVERLAPPING.endsAt,
    });

    const [conflict] = await conflictingOwnedShifts(db, driver.id, SHIFT);
    expect(conflict?.routeName).toBe('Test Route');
    expect(conflict?.status).toBe('CLAIMED');
  });
});

describe('the gate reads inside the caller’s transaction', () => {
  it('sees a block written earlier in the same transaction', async () => {
    // The reason `eligible()` takes a handle rather than reaching for the global
    // `db`: a tier-3 gate is sound only when its read and its write share a
    // transaction (`architecture.md §4.1`). A gate reading outside would miss what
    // its own transaction just wrote and, worse, miss what a concurrent one did.
    const driver = await makeDriver();

    const insideResult = await writeTransaction(async (tx) => {
      await tx
        .insertInto('availability_block')
        .values({
          user_id: driver.id,
          starts_at: OVERLAPPING.startsAt,
          ends_at: OVERLAPPING.endsAt,
        })
        .execute();
      return eligible(tx, driver.id, SHIFT);
    });

    expect(insideResult).toBe(false);
    expect(await eligible(db, driver.id, SHIFT)).toBe(false);
  });
});
