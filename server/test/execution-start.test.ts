// Starting a run: `CLAIMED → IN_PROGRESS`, the truck (I8), and the I5 snapshot.
//
// Against the MIGRATED database (CLAUDE.md). `ck_shift_truck` and
// `uq_shift_stop_donor` are tier-1 facts that exist only as real DDL, and the start
// transition is a tier-2 conditional-UPDATE predicate — none of the three survives a
// fixture schema or a mock.
//
// The shift arrives already `CLAIMED` from the fixture factory: this lane needs a
// claimed shift, not the claim path, which the coverage lane owns
// (`phase-1-build-plan.md §2`).

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/index.js';
import { getRun, startRun } from '../src/services/execution.js';
import {
  makeClaimedShift,
  makeDonor,
  makeDriver,
  makeRoute,
  makeShift,
  makeTruck,
  resetDatabase,
} from './fixtures.js';

const DRIVER = (id: string) => ({ id, tier: 'VOLUNTEER' as const });

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await db.destroy();
  await pool.end().catch(() => undefined);
});

describe('startRun', () => {
  it('moves CLAIMED to IN_PROGRESS, records the truck, and snapshots the route', async () => {
    const { route, donors } = await makeRoute(3);
    const { shift, ownerId } = await makeClaimedShift({ routeId: route.id });
    const truck = await makeTruck('Blue Van');

    const run = await startRun(DRIVER(ownerId), shift.id, { truckId: truck.id });

    expect(run.status).toBe('IN_PROGRESS');
    expect(run.truckId).toBe(truck.id);
    expect(run.truckName).toBe('Blue Van');

    // I5 — a frozen snapshot of the route's ordered RouteStops, taken at start.
    expect(run.stops.map((s) => s.donorId)).toEqual(donors.map((d) => d.id));
    expect(run.stops.map((s) => s.position)).toEqual([0, 1, 2]);
    expect(run.stops.every((s) => s.disposition === 'PENDING')).toBe(true);
  });

  it('creates no ShiftStop rows before the run starts (I5)', async () => {
    const { shift } = await makeClaimedShift();
    const before = await db
      .selectFrom('shift_stop')
      .select('id')
      .where('shift_id', '=', shift.id)
      .execute();
    expect(before).toEqual([]);
  });

  it('keeps a live Donor FK rather than copying donor details (I5)', async () => {
    const { route, donors } = await makeRoute(1);
    const { shift, ownerId } = await makeClaimedShift({ routeId: route.id });
    const truck = await makeTruck();
    await startRun(DRIVER(ownerId), shift.id, { truckId: truck.id });

    // The snapshot froze WHICH donors in WHAT order; the donor's own fields are read
    // live, so a corrected address reaches a run already under way.
    await db
      .updateTable('donor')
      .set({ address: '99 Corrected Ave', note: 'Use the loading dock' })
      .where('id', '=', donors[0]!.id)
      .execute();

    const run = await getRun(DRIVER(ownerId), shift.id);
    expect(run.stops[0]).toMatchObject({
      donorAddress: '99 Corrected Ave',
      donorNote: 'Use the loading dock',
    });

    // And no donor detail was copied onto the stop row itself.
    const columns = await db
      .selectFrom('shift_stop')
      .selectAll()
      .where('shift_id', '=', shift.id)
      .executeTakeFirstOrThrow();
    expect(Object.keys(columns).sort()).toEqual([
      'disposition',
      'donor_id',
      'id',
      'note',
      'position',
      'shift_id',
    ]);
  });

  it('never re-reads the template: editing the route leaves a started run alone (I6)', async () => {
    const { route, donors } = await makeRoute(2);
    const { shift, ownerId } = await makeClaimedShift({ routeId: route.id });
    const truck = await makeTruck();
    await startRun(DRIVER(ownerId), shift.id, { truckId: truck.id });

    // Template gains a stop and loses one. The run in flight must not notice.
    const late = await makeDonor('Late Addition');
    await db
      .insertInto('route_stop')
      .values({ route_id: route.id, donor_id: late.id, position: 2 })
      .execute();
    await db
      .deleteFrom('route_stop')
      .where('route_id', '=', route.id)
      .where('donor_id', '=', donors[0]!.id)
      .execute();

    const stops = await db
      .selectFrom('shift_stop')
      .select(['donor_id', 'position'])
      .where('shift_id', '=', shift.id)
      .orderBy('position')
      .execute();
    expect(stops.map((s) => s.donor_id)).toEqual(donors.map((d) => d.id));
  });

  it('refuses a second start — the tier-2 predicate is the optimistic check', async () => {
    const { shift, ownerId } = await makeClaimedShift();
    const truck = await makeTruck();
    await startRun(DRIVER(ownerId), shift.id, { truckId: truck.id });

    await expect(
      startRun(DRIVER(ownerId), shift.id, { truckId: truck.id }),
    ).rejects.toMatchObject({ status: 409 });

    // And no second snapshot: I28's uq_shift_stop_donor would have raised, but the
    // predicate stopped it before the insert was ever attempted.
    const stops = await db
      .selectFrom('shift_stop')
      .select('id')
      .where('shift_id', '=', shift.id)
      .execute();
    expect(stops).toHaveLength(2);
  });

  it('refuses a driver who does not own the run', async () => {
    const { shift } = await makeClaimedShift();
    const other = await makeDriver();
    const truck = await makeTruck();

    await expect(
      startRun(DRIVER(other.id), shift.id, { truckId: truck.id }),
    ).rejects.toMatchObject({ status: 403 });

    const row = await db
      .selectFrom('shift')
      .select(['status', 'truck_id'])
      .where('id', '=', shift.id)
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({ status: 'CLAIMED', truck_id: null });
  });

  it('refuses to start an OPEN run', async () => {
    const shift = await makeShift({ status: 'OPEN' });
    const driver = await makeDriver();
    const truck = await makeTruck();
    await expect(
      startRun(DRIVER(driver.id), shift.id, { truckId: truck.id }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('refuses a deactivated truck (I21 — hidden from new use, not deleted)', async () => {
    const { shift, ownerId } = await makeClaimedShift();
    const truck = await makeTruck();
    await db
      .updateTable('truck')
      .set({ deactivated_at: new Date() })
      .where('id', '=', truck.id)
      .execute();

    await expect(
      startRun(DRIVER(ownerId), shift.id, { truckId: truck.id }),
    ).rejects.toMatchObject({ status: 409 });

    const row = await db
      .selectFrom('shift')
      .select('status')
      .where('id', '=', shift.id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('CLAIMED');
  });

  it('refuses an unknown truck', async () => {
    const { shift, ownerId } = await makeClaimedShift();
    await expect(
      startRun(DRIVER(ownerId), shift.id, {
        truckId: '00000000-0000-0000-0000-000000000000',
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('I8 is a database CHECK, not a convention: no truck before IN_PROGRESS', async () => {
    // `ck_shift_truck` — the constraint exists as real DDL, so even a direct INSERT
    // that bypasses this lane's service cannot park a truck on a CLAIMED shift.
    const truck = await makeTruck();
    const driver = await makeDriver();
    await expect(
      makeShift({ status: 'CLAIMED', ownerId: driver.id, truckId: truck.id }),
    ).rejects.toMatchObject({ constraint: 'ck_shift_truck' });
  });
});
