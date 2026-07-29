// Truck master data (cap 3), I21's removal branch, and I22's absence of one.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/index.js';
import {
  createTruck,
  getTruck,
  listTrucks,
  removeTruck,
  updateTruck,
} from '../src/services/truck.js';
import { makeDriver, makeShift, makeTruck, resetDatabase } from './fixtures.js';

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await db.destroy();
  await pool.end().catch(() => undefined);
});

/** A shift that has actually taken a truck. `ck_shift_truck` (I8) forbids a truck
 *  before IN_PROGRESS, so the fixture must be started and owned. */
async function startedShiftWith(truckId: string) {
  const driver = await makeDriver();
  return makeShift({ status: 'IN_PROGRESS', ownerId: driver.id, truckId });
}

describe('create + edit (cap 3)', () => {
  it('stores a name and an optional plate', async () => {
    const truck = await createTruck({ truckName: '  Box Truck  ', plate: 'TX 8842' });
    expect(truck.truck_name).toBe('Box Truck');
    expect(truck.plate).toBe('TX 8842');

    const plateless = await createTruck({ truckName: 'Van' });
    expect(plateless.plate).toBeNull();
  });

  it('rejects a name that is only whitespace', async () => {
    await expect(createTruck({ truckName: ' ' })).rejects.toMatchObject({ status: 400 });
  });

  it('clears a plate when the patch sends null', async () => {
    const truck = await createTruck({ truckName: 'Van', plate: 'TX 1' });
    expect((await updateTruck(truck.id, { plate: null })).plate).toBeNull();
  });

  it('404s an unknown truck', async () => {
    const missing = '00000000-0000-0000-0000-000000000000';
    await expect(updateTruck(missing, { truckName: 'x' })).rejects.toMatchObject({
      status: 404,
    });
    await expect(removeTruck(missing)).rejects.toMatchObject({ status: 404 });
  });
});

describe('active toggle (§3.3 ACTIVE ⇄ INACTIVE)', () => {
  it('hides an inactive truck from driver selection and restores it', async () => {
    const kept = await createTruck({ truckName: 'Box Truck' });
    const retired = await createTruck({ truckName: 'Old Van' });

    await updateTruck(retired.id, { active: false });
    expect((await listTrucks()).map((t) => t.id)).toEqual([kept.id]);
    expect(await listTrucks({ includeInactive: true })).toHaveLength(2);

    await updateTruck(retired.id, { active: true });
    expect(await listTrucks()).toHaveLength(2);
  });

  it('I21 — field edits are allowed on an inactive truck', async () => {
    const truck = await createTruck({ truckName: 'Old Van' });
    await updateTruck(truck.id, { active: false });

    const edited = await updateTruck(truck.id, { plate: 'TX 9001' });
    expect(edited.plate).toBe('TX 9001');
    expect(edited.deactivated_at).not.toBeNull();
  });
});

describe('I21 — remove: soft with history, hard without', () => {
  it('hard-deletes a truck that never ran', async () => {
    const truck = await createTruck({ truckName: 'Mistyped' });
    expect(await removeTruck(truck.id)).toBe('DELETED');
    expect(await getTruck(truck.id)).toBeUndefined();
  });

  it('deactivates a truck a shift has used', async () => {
    const truck = await makeTruck('Box Truck');
    await startedShiftWith(truck.id);

    expect(await removeTruck(truck.id)).toBe('DEACTIVATED');
    expect((await getTruck(truck.id))?.deactivated_at).not.toBeNull();
  });

  it('the FK RESTRICT is the real guard, not the predicate', async () => {
    const truck = await makeTruck('Box Truck');
    await startedShiftWith(truck.id);
    await expect(
      db.deleteFrom('truck').where('id', '=', truck.id).execute(),
    ).rejects.toMatchObject({ code: '23503' });
  });
});

describe('I22 — no truck exclusivity', () => {
  it('lets two concurrent shifts hold the same truck', async () => {
    // Double-booking is allowed (soft, low-impact). Nothing in this service, and
    // no constraint in `data-model.md §4`, ties a truck to a time window — so a
    // second started shift on the same truck must simply succeed.
    const truck = await makeTruck('Box Truck');
    const window = {
      startsAt: new Date('2026-08-04T14:00:00Z'),
      endsAt: new Date('2026-08-04T16:00:00Z'),
    };
    const a = await makeShift({
      status: 'IN_PROGRESS',
      ownerId: (await makeDriver()).id,
      truckId: truck.id,
      ...window,
    });
    const b = await makeShift({
      status: 'IN_PROGRESS',
      ownerId: (await makeDriver()).id,
      truckId: truck.id,
      ...window,
    });

    expect(a.truck_id).toBe(truck.id);
    expect(b.truck_id).toBe(truck.id);
    expect(await removeTruck(truck.id)).toBe('DEACTIVATED');
  });
});
