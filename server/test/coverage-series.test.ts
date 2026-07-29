// Claim-all — `domain-modeling.md §5.3`'s `claim-all`, PRD cap 6, S1.2.
//
//   claim-all   set ownerDefault = driver; set owner on existing future OPEN instances
//               → CLAIMED (eligible() checked per instance; overlapping conflicts
//               skipped, not claimed)
//
// The rule this file exists to pin is **partial success, never force-claim**: a run
// that conflicts with the driver's own schedule is skipped and reported, and the
// driver is told which. Everything else about the series is untouched (I23/I24) except
// `ownerDefault`, which §5.3 makes claim-all's job.
//
// Recurring rows are inserted here rather than through the fixture factory: `makeShift`
// has no pattern parameter, and the schedule lane that mints them is a sibling worktree
// this one cannot import from. These inserts arrange preconditions only — the claim
// under test still goes through the service.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/index.js';
import { claimShift, type CoverageActor } from '../src/services/coverage.js';
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

/** `YYYY-MM-DD` from a Date's local calendar fields — `occurrence_date` is a calendar
 *  slot, not an instant (`data-model.md §5.3`). */
function dateOf(value: Date): string {
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
}

async function makePattern(createdBy: string, routeId: string, weekdays = [2]) {
  return db
    .insertInto('recurrence_pattern')
    .values({
      route_id: routeId,
      weekdays,
      start_time: '14:00',
      end_time: '16:00',
      created_by: createdBy,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

interface InstanceOptions {
  status?: 'OPEN' | 'CLAIMED';
  ownerId?: string | null;
  occurrenceDate?: string;
}

async function makeInstance(
  patternId: string,
  routeId: string,
  createdBy: string,
  startsAt: Date,
  options: InstanceOptions = {},
) {
  return db
    .insertInto('shift')
    .values({
      recurrence_pattern_id: patternId,
      route_id: routeId,
      occurrence_date: options.occurrenceDate ?? dateOf(startsAt),
      starts_at: startsAt,
      ends_at: new Date(startsAt.getTime() + 2 * HOUR),
      status: options.status ?? 'OPEN',
      owner_id: options.ownerId ?? null,
      created_by: createdBy,
      updated_by: createdBy,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

beforeEach(resetDatabase);
afterAll(async () => {
  await db.destroy();
  await pool.end().catch(() => undefined);
});

describe('claim-all', () => {
  it('claims every future open run in the series and sets the pattern default', async () => {
    const driver = await makeDriver();
    const { route } = await makeRoute();
    const pattern = await makePattern(driver.id, route.id);
    const weeks = [7, 14, 21].map((d) => at(d * DAY));
    const instances = [];
    for (const startsAt of weeks) {
      instances.push(await makeInstance(pattern.id, route.id, driver.id, startsAt));
    }

    const result = await claimShift(driverActor(driver.id), instances[0]!.id, 'SERIES');

    expect(result.scope).toBe('SERIES');
    expect(result.claimed).toHaveLength(3);
    expect(result.skipped).toEqual([]);
    expect(result.partial).toBe(false);
    expect(result.seriesLabel).toBe('Tuesday');
    // S1.2: a full-success claim shows the ordinary toast, not the partial summary.
    expect(result.summary).toBe("You're on all 3 Tuesday runs.");

    const rows = await db.selectFrom('shift').selectAll().orderBy('starts_at').execute();
    expect(rows.every((r) => r.status === 'CLAIMED' && r.owner_id === driver.id)).toBe(true);

    // §5.3: "claim-all set ownerDefault = driver". This is the one pattern write a
    // per-run action makes, and I24 admits it because claiming every Tuesday run IS an
    // explicit pattern-level statement.
    const after = await db
      .selectFrom('recurrence_pattern')
      .selectAll()
      .where('id', '=', pattern.id)
      .executeTakeFirstOrThrow();
    expect(after.owner_default_id).toBe(driver.id);
  });

  it('skips the runs that conflict and reports which — never force-claims them', async () => {
    const driver = await makeDriver();
    const { route } = await makeRoute();
    const pattern = await makePattern(driver.id, route.id);
    const first = await makeInstance(pattern.id, route.id, driver.id, at(7 * DAY));
    const blocked = await makeInstance(pattern.id, route.id, driver.id, at(14 * DAY));
    const third = await makeInstance(pattern.id, route.id, driver.id, at(21 * DAY));

    // The driver already told us they are away for the middle one (I19/I20).
    await makeAvailabilityBlock(driver.id, at(14 * DAY - HOUR), at(14 * DAY + HOUR));

    const result = await claimShift(driverActor(driver.id), first.id, 'SERIES');

    expect(result.claimed.map((c) => c.shiftId).sort()).toEqual([first.id, third.id].sort());
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toMatchObject({
      shiftId: blocked.id,
      reasons: ['AVAILABILITY_BLOCK'],
    });
    expect(result.partial).toBe(true);
    // S1.2's partial summary, in its exact shape.
    expect(result.summary).toBe(
      'Claimed 2 of 3 Tuesday runs — 1 skipped (conflicts with your schedule).',
    );

    const untouched = await db
      .selectFrom('shift')
      .selectAll()
      .where('id', '=', blocked.id)
      .executeTakeFirstOrThrow();
    expect(untouched.status).toBe('OPEN');
    expect(untouched.owner_id).toBeNull();
  });

  it('skips a run that overlaps one it claimed earlier in the same pass', async () => {
    // The loop evaluates I20 per run against this transaction's own writes. Batching
    // the gate up front would let claim-all be the one path that breaks I20 against
    // itself: two overlapping runs of one series would both come out CLAIMED.
    const driver = await makeDriver();
    const { route } = await makeRoute();
    const pattern = await makePattern(driver.id, route.id);
    const base = at(7 * DAY);
    const first = await makeInstance(pattern.id, route.id, driver.id, base);
    const overlapping = await makeInstance(
      pattern.id,
      route.id,
      driver.id,
      new Date(base.getTime() + HOUR),
      // A distinct calendar slot, because `uq_shift_occurrence` is per (pattern, date);
      // the windows still overlap in absolute time, which is what I20 reads.
      { occurrenceDate: dateOf(new Date(base.getTime() + DAY)) },
    );

    const result = await claimShift(driverActor(driver.id), first.id, 'SERIES');

    expect(result.claimed).toHaveLength(1);
    expect(result.skipped[0]).toMatchObject({
      shiftId: overlapping.id,
      reasons: ['OWNED_SHIFT_OVERLAP'],
    });
  });

  it('leaves runs owned by someone else out of the set entirely', async () => {
    const driver = await makeDriver();
    const other = await makeDriver();
    const { route } = await makeRoute();
    const pattern = await makePattern(driver.id, route.id);
    const open = await makeInstance(pattern.id, route.id, driver.id, at(7 * DAY));
    const theirs = await makeInstance(pattern.id, route.id, driver.id, at(14 * DAY), {
      status: 'CLAIMED',
      ownerId: other.id,
    });

    const result = await claimShift(driverActor(driver.id), open.id, 'SERIES');

    // Not claimed, not skipped: §5.3 says claim-all touches OPEN instances, so a run
    // another driver holds was never a candidate and does not belong in the count.
    expect(result.requested).toBe(1);
    expect(result.skipped).toEqual([]);
    const row = await db
      .selectFrom('shift')
      .selectAll()
      .where('id', '=', theirs.id)
      .executeTakeFirstOrThrow();
    expect(row.owner_id).toBe(other.id);
  });

  it('leaves past runs alone but always includes the run that was tapped', async () => {
    const driver = await makeDriver();
    const { route } = await makeRoute();
    const pattern = await makePattern(driver.id, route.id);
    const past = await makeInstance(pattern.id, route.id, driver.id, at(-7 * DAY));
    const soon = await makeInstance(pattern.id, route.id, driver.id, at(7 * DAY));

    const result = await claimShift(driverActor(driver.id), soon.id, 'SERIES');

    expect(result.requested).toBe(1);
    expect(result.claimed[0]?.shiftId).toBe(soon.id);
    const stale = await db
      .selectFrom('shift')
      .selectAll()
      .where('id', '=', past.id)
      .executeTakeFirstOrThrow();
    expect(stale.status).toBe('OPEN');
  });

  it('reports a series where nothing could be claimed', async () => {
    const driver = await makeDriver();
    const { route } = await makeRoute();
    const pattern = await makePattern(driver.id, route.id);
    const only = await makeInstance(pattern.id, route.id, driver.id, at(7 * DAY));
    await makeAvailabilityBlock(driver.id, at(7 * DAY - HOUR), at(7 * DAY + HOUR));

    const result = await claimShift(driverActor(driver.id), only.id, 'SERIES');

    expect(result.claimed).toEqual([]);
    expect(result.partial).toBe(true);
    expect(result.summary).toMatch(/^No Tuesday run could be claimed/);
    // ownerDefault is still set: §5.3 sets it unconditionally, and materialization
    // gates each future run on its own (I25).
    const pattern2 = await db
      .selectFrom('recurrence_pattern')
      .selectAll()
      .where('id', '=', pattern.id)
      .executeTakeFirstOrThrow();
    expect(pattern2.owner_default_id).toBe(driver.id);
  });

  it('names both days when the series repeats twice a week', async () => {
    const driver = await makeDriver();
    const { route } = await makeRoute();
    const pattern = await makePattern(driver.id, route.id, [2, 5]);
    const one = await makeInstance(pattern.id, route.id, driver.id, at(7 * DAY));

    const result = await claimShift(driverActor(driver.id), one.id, 'SERIES');
    expect(result.seriesLabel).toBe('Tuesday and Friday');
  });

  it('refuses a series claim on a one-off run', async () => {
    const driver = await makeDriver();
    const shift = await makeShift({ createdBy: driver.id, startsAt: at(7 * DAY) });

    await expect(
      claimShift(driverActor(driver.id), shift.id, 'SERIES'),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('refuses when the tapped run is already gone, before touching the series', async () => {
    const driver = await makeDriver();
    const karen = await makeDriver({ firstName: 'Karen' });
    const { route } = await makeRoute();
    const pattern = await makePattern(driver.id, route.id);
    const taken = await makeInstance(pattern.id, route.id, driver.id, at(7 * DAY), {
      status: 'CLAIMED',
      ownerId: karen.id,
    });
    await makeInstance(pattern.id, route.id, driver.id, at(14 * DAY));

    await expect(
      claimShift(driverActor(driver.id), taken.id, 'SERIES'),
    ).rejects.toMatchObject({ status: 409 });

    // The pattern default is untouched too — the whole transaction rolled back.
    const after = await db
      .selectFrom('recurrence_pattern')
      .selectAll()
      .where('id', '=', pattern.id)
      .executeTakeFirstOrThrow();
    expect(after.owner_default_id).toBeNull();
  });

  it('refuses a series claim from a driver who is not eligible for the tapped run', async () => {
    const receiver = await makeUser({ duties: ['RECEIVE'] });
    const { route } = await makeRoute();
    const pattern = await makePattern(receiver.id, route.id);
    const one = await makeInstance(pattern.id, route.id, receiver.id, at(7 * DAY));

    const result = await claimShift(driverActor(receiver.id), one.id, 'SERIES');
    // Not an exception: a series claim reports skips rather than failing outright, and
    // "no Drive duty" skips every run in it.
    expect(result.claimed).toEqual([]);
    expect(result.skipped[0]?.reasons).toContain('NO_DRIVE_DUTY');
  });
});
