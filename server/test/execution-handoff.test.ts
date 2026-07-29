// The two things that happen at the end of a run, neither of which ends it:
//
//   I27  `pickup_completed_at` — a handoff signal ("heading back"), gated on every
//        stop being driver-resolved, and explicitly NOT a state change.
//   I30  mid-run reassignment — staff moving an unresolved stop to another driver,
//        as close-old + insert-new, never an in-place `shift_id` update.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/index.js';
import {
  completePickup,
  getRun,
  reassignStop,
  reorderStops,
  resolveStop,
  startRun,
} from '../src/services/execution.js';
import {
  makeClaimedShift,
  makeDriver,
  makeRoute,
  makeTruck,
  makeUser,
  resetDatabase,
} from './fixtures.js';

const DRIVER = (id: string) => ({ id, tier: 'VOLUNTEER' as const });
const STAFF = (id: string) => ({ id, tier: 'STAFF' as const });

async function startedRun(stopCount = 2, startsAt?: Date) {
  const { route, donors } = await makeRoute(stopCount);
  const { shift, ownerId } = await makeClaimedShift({
    routeId: route.id,
    ...(startsAt ? { startsAt } : {}),
  });
  const truck = await makeTruck();
  const run = await startRun(DRIVER(ownerId), shift.id, { truckId: truck.id });
  return { shift, ownerId, donors, run };
}

/** A run in flight on an EXISTING route — two runs off one route share donors, which
 *  is what makes I28's destination clash reachable. */
async function startedRunOn(routeId: string, startsAt?: Date) {
  const { shift, ownerId } = await makeClaimedShift({
    routeId,
    ...(startsAt ? { startsAt } : {}),
  });
  const truck = await makeTruck();
  const run = await startRun(DRIVER(ownerId), shift.id, { truckId: truck.id });
  return { shift, ownerId, run };
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await db.destroy();
  await pool.end().catch(() => undefined);
});

describe('completePickup (I27)', () => {
  it('refuses while any stop is still PENDING', async () => {
    const { shift, ownerId, run } = await startedRun(2);
    await resolveStop(DRIVER(ownerId), shift.id, run.stops[0]!.id, {
      disposition: 'COLLECTED',
    });

    await expect(completePickup(DRIVER(ownerId), shift.id)).rejects.toMatchObject({
      status: 409,
    });

    const row = await db
      .selectFrom('shift')
      .select('pickup_completed_at')
      .where('id', '=', shift.id)
      .executeTakeFirstOrThrow();
    expect(row.pickup_completed_at).toBeNull();
  });

  it('sets the milestone once every stop is COLLECTED or SKIPPED, and does NOT complete the shift', async () => {
    const { shift, ownerId, run } = await startedRun(2);
    await resolveStop(DRIVER(ownerId), shift.id, run.stops[0]!.id, {
      disposition: 'COLLECTED',
    });
    await resolveStop(DRIVER(ownerId), shift.id, run.stops[1]!.id, {
      disposition: 'SKIPPED',
    });

    const after = await completePickup(DRIVER(ownerId), shift.id);

    expect(after.pickupCompletedAt).not.toBeNull();
    // I27: it does NOT change the shift's state. The run stays IN_PROGRESS until the
    // receiver's receive-done, which is Phase 2 (build-plan D1).
    expect(after.status).toBe('IN_PROGRESS');
  });

  it('counts a REASSIGNED stop as resolved (§3.2 driver-side gate)', async () => {
    const source = await startedRun(2);
    const destination = await startedRun(1);
    const staff = await makeUser({ tier: 'STAFF' });

    await resolveStop(DRIVER(source.ownerId), source.shift.id, source.run.stops[0]!.id, {
      disposition: 'COLLECTED',
    });
    await reassignStop(STAFF(staff.id), source.shift.id, source.run.stops[1]!.id, {
      toShiftId: destination.shift.id,
    });

    // The moved stop is terminal on this shift and excluded from its gate, so the
    // driver may head back without ever resolving it themselves.
    const after = await completePickup(DRIVER(source.ownerId), source.shift.id);
    expect(after.pickupCompletedAt).not.toBeNull();
    expect(after.status).toBe('IN_PROGRESS');
  });

  it('keeps the first timestamp on a second confirm, and takes a late note edit', async () => {
    const { shift, ownerId, run } = await startedRun(1);
    await resolveStop(DRIVER(ownerId), shift.id, run.stops[0]!.id, {
      disposition: 'COLLECTED',
    });

    const first = await completePickup(DRIVER(ownerId), shift.id, { note: 'Quiet run' });
    const second = await completePickup(DRIVER(ownerId), shift.id, {
      note: 'Quiet run — one pallet left behind',
    });

    expect(second.pickupCompletedAt).toBe(first.pickupCompletedAt);
    expect(second.note).toBe('Quiet run — one pallet left behind');
  });

  it('enqueues nothing: the Receiver alert is truck-inbound, held to Phase 2', async () => {
    const { shift, ownerId, run } = await startedRun(1);
    await resolveStop(DRIVER(ownerId), shift.id, run.stops[0]!.id, {
      disposition: 'SKIPPED',
    });
    await completePickup(DRIVER(ownerId), shift.id);

    // PRD §5: Phase 1 is "caps 1–11, 13 minus truck-inbound"; the truck-inbound
    // notification arrives in Phase 2 and reuses this mechanism. S1.9 says the same
    // ("truck inbound (tablet only, Phase 2)"). The milestone is still written.
    const notifications = await db.selectFrom('notification').selectAll().execute();
    expect(notifications).toEqual([]);
  });

  it('refuses a driver who does not own the run', async () => {
    const { shift, ownerId, run } = await startedRun(1);
    await resolveStop(DRIVER(ownerId), shift.id, run.stops[0]!.id, {
      disposition: 'COLLECTED',
    });
    const other = await makeDriver();
    await expect(completePickup(DRIVER(other.id), shift.id)).rejects.toMatchObject({
      status: 403,
    });
  });
});

describe('reassignStop (I30)', () => {
  it('closes the source stop and inserts a new one on the destination', async () => {
    const source = await startedRun(2);
    const destination = await startedRun(1);
    const staff = await makeUser({ tier: 'STAFF' });
    const moving = source.run.stops[1]!;

    const result = await reassignStop(STAFF(staff.id), source.shift.id, moving.id, {
      toShiftId: destination.shift.id,
    });

    expect(result.from.id).toBe(moving.id);
    expect(result.from.disposition).toBe('REASSIGNED');
    expect(result.to.id).not.toBe(moving.id);
    expect(result.to.disposition).toBe('PENDING');
    expect(result.to.donorId).toBe(moving.donorId);
    // Appended at the end of that driver's current stop list (I30).
    expect(result.to.position).toBe(1);
  });

  it('never re-points shift_id: the source row stays on the source shift (I5)', async () => {
    const source = await startedRun(2);
    const destination = await startedRun(1);
    const staff = await makeUser({ tier: 'STAFF' });
    const moving = source.run.stops[1]!;

    await reassignStop(STAFF(staff.id), source.shift.id, moving.id, {
      toShiftId: destination.shift.id,
    });

    const row = await db
      .selectFrom('shift_stop')
      .select(['shift_id', 'disposition'])
      .where('id', '=', moving.id)
      .executeTakeFirstOrThrow();
    expect(row.shift_id).toBe(source.shift.id);
    expect(row.disposition).toBe('REASSIGNED');

    // Two rows for that donor now exist, one per shift — I28 holds independently on
    // each side and needs no relaxing.
    const rows = await db
      .selectFrom('shift_stop')
      .select(['shift_id'])
      .where('donor_id', '=', moving.donorId)
      .execute();
    expect(rows).toHaveLength(2);
  });

  it('refuses to move a stop the destination already has (I28)', async () => {
    // Two runs off ONE route, so both snapshots hold the same donors. Different
    // drivers and a different day, so I20 is untouched.
    const { route } = await makeRoute(2);
    const source = await startedRunOn(route.id);
    const twin = await startedRunOn(route.id, new Date('2026-09-01T14:00:00Z'));
    const staff = await makeUser({ tier: 'STAFF' });

    await expect(
      reassignStop(STAFF(staff.id), source.shift.id, source.run.stops[0]!.id, {
        toShiftId: twin.shift.id,
      }),
    ).rejects.toMatchObject({ status: 409 });

    // And the source stop was not closed on the way to the refusal.
    const row = await db
      .selectFrom('shift_stop')
      .select('disposition')
      .where('id', '=', source.run.stops[0]!.id)
      .executeTakeFirstOrThrow();
    expect(row.disposition).toBe('PENDING');
  });

  it('refuses a resolved stop — there is nothing left to move', async () => {
    const source = await startedRun(2);
    const destination = await startedRun(1);
    const staff = await makeUser({ tier: 'STAFF' });

    await resolveStop(DRIVER(source.ownerId), source.shift.id, source.run.stops[0]!.id, {
      disposition: 'SKIPPED',
    });

    await expect(
      reassignStop(STAFF(staff.id), source.shift.id, source.run.stops[0]!.id, {
        toShiftId: destination.shift.id,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('moves an unweighed COLLECTED stop (I30 names both unresolved states)', async () => {
    const source = await startedRun(2);
    const destination = await startedRun(1);
    const staff = await makeUser({ tier: 'STAFF' });

    await resolveStop(DRIVER(source.ownerId), source.shift.id, source.run.stops[0]!.id, {
      disposition: 'COLLECTED',
    });

    const result = await reassignStop(
      STAFF(staff.id),
      source.shift.id,
      source.run.stops[0]!.id,
      { toShiftId: destination.shift.id },
    );
    expect(result.from.disposition).toBe('REASSIGNED');
  });

  it('refuses a destination that has not started — it has no stop list yet (I5)', async () => {
    const source = await startedRun(2);
    const { shift: notStarted } = await makeClaimedShift();
    const staff = await makeUser({ tier: 'STAFF' });

    await expect(
      reassignStop(STAFF(staff.id), source.shift.id, source.run.stops[0]!.id, {
        toShiftId: notStarted.id,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('refuses moving a stop onto its own shift', async () => {
    const source = await startedRun(2);
    const staff = await makeUser({ tier: 'STAFF' });
    await expect(
      reassignStop(STAFF(staff.id), source.shift.id, source.run.stops[0]!.id, {
        toShiftId: source.shift.id,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('leaves a REASSIGNED stop at the end of the list on reorder', async () => {
    const source = await startedRun(3);
    const destination = await startedRun(1);
    const staff = await makeUser({ tier: 'STAFF' });

    await reassignStop(STAFF(staff.id), source.shift.id, source.run.stops[0]!.id, {
      toShiftId: destination.shift.id,
    });

    // S1.5 does not show the moved stop, so the driver's drag list cannot name it.
    const remaining = [source.run.stops[2]!.id, source.run.stops[1]!.id];
    const stops = await reorderStops(DRIVER(source.ownerId), source.shift.id, remaining);

    expect(stops.map((s) => s.id)).toEqual([...remaining, source.run.stops[0]!.id]);
    expect(stops.map((s) => s.position)).toEqual([0, 1, 2]);
  });

  it('shows the moved stop struck-through on the source run and pending on the destination', async () => {
    const source = await startedRun(2);
    const destination = await startedRun(1);
    const staff = await makeUser({ tier: 'STAFF' });

    await reassignStop(STAFF(staff.id), source.shift.id, source.run.stops[1]!.id, {
      toShiftId: destination.shift.id,
    });

    const sourceRun = await getRun(STAFF(staff.id), source.shift.id);
    const destinationRun = await getRun(STAFF(staff.id), destination.shift.id);
    expect(sourceRun.stops.map((s) => s.disposition)).toEqual(['PENDING', 'REASSIGNED']);
    expect(destinationRun.stops.map((s) => s.disposition)).toEqual(['PENDING', 'PENDING']);
  });
});
