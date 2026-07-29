// The overlap case matrix for `eligible()` (`domain-modeling.md §5.2`).
//
// Overlap arithmetic is where this breaks, and it breaks quietly: a `<=` for a `<`
// costs a driver every back-to-back run and nothing throws. So the cases are a TABLE,
// written so a reader sees the matrix rather than a pile of assertions, and every row
// is asserted four ways against the same fixed reference window:
//
//   1. the pure predicate            `overlaps()`
//   2. the AvailabilityBlock clause  SQL, against the migrated database
//   3. the owned-shift clause        SQL, against the migrated database
//   4. the fan-out set query         SQL, the second copy of the same four clauses
//
// (2)-(4) are separate SQL, and (4) is a deliberate re-expression of (1)-(3) as NOT
// EXISTS for the notification fan-out. Driving all four from one table is what stops
// them drifting apart — the failure this file exists to prevent is one clause being
// fixed and the other three not.
//
// Tests run against the migrated database, never a fixture schema (CLAUDE.md).

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/index.js';
import {
  eligibleDriverIds,
  evaluateEligibility,
  overlaps,
} from '../src/services/eligibility.js';
import {
  makeAdmin,
  makeAvailabilityBlock,
  makeDriver,
  makeRoute,
  makeShift,
  resetDatabase,
} from './fixtures.js';

/** The window every case is measured against: 10:00–12:00 on 2026-08-04. */
const SHIFT = {
  startsAt: new Date('2026-08-04T10:00:00.000Z'),
  endsAt: new Date('2026-08-04T12:00:00.000Z'),
};

interface Case {
  /** What the case is, in the terms §5.2 uses. */
  name: string;
  other: [string, string];
  /** Does it overlap the reference window? */
  conflicts: boolean;
}

/**
 * `overlap(A,B) := A.start < B.end AND B.start < A.end`, half-open `[start, end)`.
 *
 * The four rows that decide whether the implementation is right are the boundary
 * ones: a window that ends exactly when the shift starts, one that starts exactly
 * when the shift ends, and the two a millisecond either side of each. Touching is
 * NOT overlapping — a driver free at 10:00 can take the 10:00 run.
 */
const CASES: Case[] = [
  // ---- disjoint, with room to spare -------------------------------------
  { name: 'entirely before, with a gap', other: ['2026-08-04T06:00:00.000Z', '2026-08-04T08:00:00.000Z'], conflicts: false },
  { name: 'entirely after, with a gap', other: ['2026-08-04T14:00:00.000Z', '2026-08-04T16:00:00.000Z'], conflicts: false },

  // ---- the boundaries ----------------------------------------------------
  { name: 'ends exactly when the shift starts (touching, not overlapping)', other: ['2026-08-04T08:00:00.000Z', '2026-08-04T10:00:00.000Z'], conflicts: false },
  { name: 'starts exactly when the shift ends (touching, not overlapping)', other: ['2026-08-04T12:00:00.000Z', '2026-08-04T14:00:00.000Z'], conflicts: false },
  { name: 'ends one millisecond before the shift starts', other: ['2026-08-04T08:00:00.000Z', '2026-08-04T09:59:59.999Z'], conflicts: false },
  { name: 'starts one millisecond after the shift ends', other: ['2026-08-04T12:00:00.001Z', '2026-08-04T14:00:00.000Z'], conflicts: false },
  { name: 'ends one millisecond after the shift starts', other: ['2026-08-04T08:00:00.000Z', '2026-08-04T10:00:00.001Z'], conflicts: true },
  { name: 'starts one millisecond before the shift ends', other: ['2026-08-04T11:59:59.999Z', '2026-08-04T14:00:00.000Z'], conflicts: true },

  // ---- identity and containment, both directions -------------------------
  { name: 'identical window', other: ['2026-08-04T10:00:00.000Z', '2026-08-04T12:00:00.000Z'], conflicts: true },
  { name: 'strictly contains the shift', other: ['2026-08-04T09:00:00.000Z', '2026-08-04T13:00:00.000Z'], conflicts: true },
  { name: 'strictly contained by the shift', other: ['2026-08-04T10:30:00.000Z', '2026-08-04T11:00:00.000Z'], conflicts: true },

  // ---- partial overlap at each edge --------------------------------------
  { name: 'overlaps the leading edge', other: ['2026-08-04T09:00:00.000Z', '2026-08-04T11:00:00.000Z'], conflicts: true },
  { name: 'overlaps the trailing edge', other: ['2026-08-04T11:00:00.000Z', '2026-08-04T13:00:00.000Z'], conflicts: true },
  { name: 'shares the start instant, ends earlier', other: ['2026-08-04T10:00:00.000Z', '2026-08-04T11:00:00.000Z'], conflicts: true },
  { name: 'shares the end instant, starts later', other: ['2026-08-04T11:00:00.000Z', '2026-08-04T12:00:00.000Z'], conflicts: true },
  { name: 'starts earlier, shares the end instant', other: ['2026-08-04T09:00:00.000Z', '2026-08-04T12:00:00.000Z'], conflicts: true },
  { name: 'shares the start instant, ends later', other: ['2026-08-04T10:00:00.000Z', '2026-08-04T13:00:00.000Z'], conflicts: true },

  // ---- same clock time, wrong day ----------------------------------------
  { name: 'same clock time the day before', other: ['2026-08-03T10:00:00.000Z', '2026-08-03T12:00:00.000Z'], conflicts: false },
  { name: 'same clock time the day after', other: ['2026-08-05T10:00:00.000Z', '2026-08-05T12:00:00.000Z'], conflicts: false },
];

function windowOf(c: Case) {
  return { startsAt: new Date(c.other[0]), endsAt: new Date(c.other[1]) };
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await db.destroy();
  await pool.end().catch(() => undefined);
});

describe('overlap arithmetic (§5.2)', () => {
  it('the pure predicate matches the case table, in both argument orders', () => {
    for (const c of CASES) {
      const other = windowOf(c);
      expect(overlaps(other, SHIFT), c.name).toBe(c.conflicts);
      // Symmetric by construction; asserted because an asymmetric overlap test
      // would still pass every one-directional case above.
      expect(overlaps(SHIFT, other), `${c.name} (reversed)`).toBe(c.conflicts);
    }
  });

  it('an AvailabilityBlock excludes the driver on exactly the overlapping cases', async () => {
    for (const c of CASES) {
      const driver = await makeDriver();
      const w = windowOf(c);
      await makeAvailabilityBlock(driver.id, w.startsAt, w.endsAt);

      const result = await evaluateEligibility(db, driver.id, SHIFT);
      expect(result.eligible, c.name).toBe(!c.conflicts);
      expect(result.reasons, c.name).toEqual(c.conflicts ? ['AVAILABILITY_BLOCK'] : []);
      expect(result.conflictingBlockIds.length, c.name).toBe(c.conflicts ? 1 : 0);
    }
  });

  it('an owned CLAIMED shift excludes the driver on exactly the overlapping cases', async () => {
    for (const c of CASES) {
      const driver = await makeDriver();
      const w = windowOf(c);
      await makeShift({
        ownerId: driver.id,
        status: 'CLAIMED',
        startsAt: w.startsAt,
        endsAt: w.endsAt,
      });

      const result = await evaluateEligibility(db, driver.id, SHIFT);
      expect(result.eligible, c.name).toBe(!c.conflicts);
      expect(result.reasons, c.name).toEqual(c.conflicts ? ['OWNED_SHIFT_OVERLAP'] : []);
      expect(result.conflictingShiftIds.length, c.name).toBe(c.conflicts ? 1 : 0);
    }
  });

  it('the fan-out set query agrees with the per-driver gate on every case', async () => {
    // Every case as one cohort, then one query: the notification fan-out
    // (`product-requirement.md §4`) re-expresses the same four clauses as NOT
    // EXISTS, and this is what proves the two readings are the same reading.
    // The publishing admin holds every duty including Drive and owns nothing, so
    // they are legitimately in the set. Named here rather than filtered out later:
    // an unexplained extra id in a fan-out assertion is how a real bug hides.
    const author = await makeAdmin();
    const { route } = await makeRoute(1);
    const expected: string[] = [author.id];

    for (const c of CASES) {
      const w = windowOf(c);

      const blocked = await makeDriver();
      await makeAvailabilityBlock(blocked.id, w.startsAt, w.endsAt);
      if (!c.conflicts) expected.push(blocked.id);

      const busy = await makeDriver();
      await makeShift({
        ownerId: busy.id,
        status: 'CLAIMED',
        startsAt: w.startsAt,
        endsAt: w.endsAt,
        routeId: route.id,
        createdBy: author.id,
      });
      if (!c.conflicts) expected.push(busy.id);
    }

    const eligibleIds = await eligibleDriverIds(db, SHIFT);
    expect([...eligibleIds].sort()).toEqual([...expected].sort());
  });

  it('a zero-length window cannot exist to be tested — the database refuses it', async () => {
    // `ck_ab_window` / `ck_shift_window` are tier-1 (`architecture.md §4.1`), so the
    // degenerate `start == end` case the half-open test would answer "never
    // overlaps" for is unreachable rather than merely unhandled.
    const driver = await makeDriver();
    const instant = new Date('2026-08-04T10:00:00.000Z');
    await expect(
      makeAvailabilityBlock(driver.id, instant, instant),
    ).rejects.toThrow(/ck_ab_window/);
  });
});
