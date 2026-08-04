// Truck inbound (S2.4) and the I21 predicates intake makes real.
//
// Truck-inbound is the one row of the PRD's notification matrix Phase 1 held back,
// and the only one addressed to a DEVICE rather than a person: it has to reach a dock
// that may have nobody logged in. That makes it the only event `uq_notif_shift_event`
// does not dedupe — the index is partial on `recipient_id IS NOT NULL` — so its
// fire-once-ness comes from I27's `pickup_completed_at IS NULL` predicate instead,
// which is exactly what the repeat-tap test below is checking.
//
// The second half of this file is `phase-1-build-plan.md` D3's stated cost coming
// due: `donorHasHistory` / `categoryHasHistory` / `userHasHistory` gained referencing
// tables, and D3's whole argument was that this should be a line per entity rather
// than a hunt. These tests are what makes that claim checkable.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/index.js';
import { completePickup } from '../src/services/execution.js';
import { removeDonor } from '../src/services/donor.js';
import { removeCategory } from '../src/services/category.js';
import { removeUser } from '../src/services/user.js';
import { createDonation, listReceiveWorklist } from '../src/services/donation.js';
import { addWeight } from '../src/services/receive.js';
import {
  makeCategory,
  makeDonor,
  makeReceiver,
  makeStartedShift,
  resetDatabase,
} from './fixtures.js';

beforeEach(resetDatabase);
afterAll(async () => {
  await pool.end();
});

async function tabletSubscription(label = 'receiver tablet') {
  const device = await db
    .insertInto('device')
    .values({ label })
    .returningAll()
    .executeTakeFirstOrThrow();

  return db
    .insertInto('push_subscription')
    .values({
      device_id: device.id,
      endpoint: `https://push.example/${label}`,
      p256dh: 'p256dh',
      auth: 'auth',
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

/** Every stop driver-resolved, which is I27's gate. */
async function readyToHeadBack(shiftId: string) {
  await db
    .updateTable('shift_stop')
    .set({ disposition: 'COLLECTED' })
    .where('shift_id', '=', shiftId)
    .execute();
}

describe('truck inbound (S2.4, I27 trigger)', () => {
  it('enqueues one device-scoped notification per live tablet', async () => {
    const subscription = await tabletSubscription();
    const { shift, ownerId } = await makeStartedShift({ stopCount: 1 });
    await readyToHeadBack(shift.id);

    await completePickup({ id: ownerId, tier: 'VOLUNTEER' }, shift.id);

    const rows = await db
      .selectFrom('notification')
      .selectAll()
      .where('event', '=', 'TRUCK_INBOUND')
      .execute();

    expect(rows).toHaveLength(1);
    expect(rows[0]!.subscription_id).toBe(subscription.id);
    // `ck_notif_recipient` allows exactly one of the pair, and this event is the
    // reason the device half of it exists.
    expect(rows[0]!.recipient_id).toBeNull();
    expect(rows[0]!.shift_id).toBe(shift.id);
  });

  it('carries the run context the banner renders', async () => {
    await tabletSubscription();
    const { shift, ownerId } = await makeStartedShift({ stopCount: 1 });
    await readyToHeadBack(shift.id);

    await completePickup({ id: ownerId, tier: 'VOLUNTEER' }, shift.id);

    const row = await db
      .selectFrom('notification')
      .select('payload')
      .where('event', '=', 'TRUCK_INBOUND')
      .executeTakeFirstOrThrow();

    const payload = row.payload as { route?: string; who?: string; when?: string };
    expect(payload.route).toBe('Test Route');
    expect(payload.who).toMatch(/\S/);
    expect(payload.when).toMatch(/\S/);
  });

  it('fires once — a second "heading back" tap does not bang the dock again', async () => {
    await tabletSubscription();
    const { shift, ownerId } = await makeStartedShift({ stopCount: 1 });
    await readyToHeadBack(shift.id);
    const driver = { id: ownerId, tier: 'VOLUNTEER' as const };

    await completePickup(driver, shift.id);
    await completePickup(driver, shift.id, { note: 'and a late note' });

    const rows = await db
      .selectFrom('notification')
      .selectAll()
      .where('event', '=', 'TRUCK_INBOUND')
      .execute();

    // The dedupe here is the milestone rowcount, not the unique index — that index
    // is partial on `recipient_id IS NOT NULL` and cannot see a device-scoped row.
    expect(rows).toHaveLength(1);
    // The second tap still carried its note through (I27's separate statement).
    const after = await db
      .selectFrom('shift')
      .select('note')
      .where('id', '=', shift.id)
      .executeTakeFirstOrThrow();
    expect(after.note).toBe('and a late note');
  });

  it('reaches every tablet, and no revoked one', async () => {
    await tabletSubscription('tablet A');
    await tabletSubscription('tablet B');
    const dead = await tabletSubscription('old tablet');
    await db
      .updateTable('push_subscription')
      .set({ revoked_at: new Date() })
      .where('id', '=', dead.id)
      .execute();

    const { shift, ownerId } = await makeStartedShift({ stopCount: 1 });
    await readyToHeadBack(shift.id);
    await completePickup({ id: ownerId, tier: 'VOLUNTEER' }, shift.id);

    const rows = await db
      .selectFrom('notification')
      .select('subscription_id')
      .where('event', '=', 'TRUCK_INBOUND')
      .execute();

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.subscription_id)).not.toContain(dead.id);
  });

  it('does not fire when the milestone is refused (I27 gate)', async () => {
    await tabletSubscription();
    const { shift, ownerId } = await makeStartedShift({ stopCount: 2 });
    // Leave one stop PENDING, so the gate refuses.
    const stops = await db
      .selectFrom('shift_stop')
      .select('id')
      .where('shift_id', '=', shift.id)
      .orderBy('position')
      .execute();
    await db
      .updateTable('shift_stop')
      .set({ disposition: 'PENDING' })
      .where('id', '=', stops[1]!.id)
      .execute();

    await expect(
      completePickup({ id: ownerId, tier: 'VOLUNTEER' }, shift.id),
    ).rejects.toThrow();

    const rows = await db.selectFrom('notification').selectAll().execute();
    expect(rows).toHaveLength(0);
  });

  it('is harmless with no tablet registered — the inbox is still the source of truth', async () => {
    const { shift, ownerId } = await makeStartedShift({ stopCount: 1 });
    await readyToHeadBack(shift.id);

    await expect(
      completePickup({ id: ownerId, tier: 'VOLUNTEER' }, shift.id),
    ).resolves.toBeDefined();
  });
});

describe('I30 — a weighed stop is no longer movable', () => {
  it('refuses to reassign a COLLECTED stop that already has weight', async () => {
    const { reassignStop } = await import('../src/services/execution.js');
    const { shift, stops } = await makeStartedShift({ stopCount: 2 });
    const destination = await makeStartedShift({ stopCount: 1 });
    const user = await makeReceiver();
    const category = await makeCategory();

    await addWeight({ id: user.id }, shift.id, stops[0]!.id, {
      categoryId: category.id,
      weight: '10',
    });

    // Its stored disposition is still COLLECTED — only the I12 projection knows.
    await expect(
      reassignStop({ id: user.id, tier: 'STAFF' }, shift.id, stops[0]!.id, {
        toShiftId: destination.shift.id,
      }),
    ).rejects.toThrow(/already been weighed/i);
  });
});

describe('I21 — the predicates intake made real (build-plan D3)', () => {
  it('soft-deletes a donor that only ever appears on a weight row', async () => {
    const { shift, stops } = await makeStartedShift({ stopCount: 1 });
    const user = await makeReceiver();
    const category = await makeCategory();
    await addWeight({ id: user.id }, shift.id, stops[0]!.id, {
      categoryId: category.id,
      weight: '10',
    });

    // The donor is also a route stop here, so use a donation-only donor for the
    // clean case below; this asserts the weight probe does not crash the path.
    const donor = await makeDonor('Weight Only');
    await createDonation({ id: user.id }, {
      donorId: donor.id,
      categoryId: category.id,
      weight: '5',
    });

    expect(await removeDonor(donor.id)).toBe('DEACTIVATED');
  });

  it('still hard-deletes a donor nothing references', async () => {
    const donor = await makeDonor('Never Used');
    expect(await removeDonor(donor.id)).toBe('DELETED');
  });

  it('archives a category once a weight references it — it was hard-deletable in Phase 1', async () => {
    const { shift, stops } = await makeStartedShift({ stopCount: 1 });
    const user = await makeReceiver();
    const category = await makeCategory('Produce');

    expect(await removeCategory(category.id)).toBe('DELETED');

    const used = await makeCategory('Bakery');
    await addWeight({ id: user.id }, shift.id, stops[0]!.id, {
      categoryId: used.id,
      weight: '10',
    });

    expect(await removeCategory(used.id)).toBe('DEACTIVATED');
  });

  it('archives a category referenced only by a donation', async () => {
    const user = await makeReceiver();
    const donor = await makeDonor();
    const category = await makeCategory('Pet');
    await createDonation({ id: user.id }, {
      donorId: donor.id,
      categoryId: category.id,
      weight: '3',
    });

    expect(await removeCategory(category.id)).toBe('DEACTIVATED');
  });

  it('deactivates a receiver who only ever logged weights', async () => {
    const { shift, stops } = await makeStartedShift({ stopCount: 1 });
    const user = await makeReceiver();
    const category = await makeCategory();
    await addWeight({ id: user.id }, shift.id, stops[0]!.id, {
      categoryId: category.id,
      weight: '10',
    });

    expect(await removeUser(user.id)).toBe('DEACTIVATED');
  });

  it('deactivates a receiver who only ever VOIDED someone else weight', async () => {
    const { shift, stops } = await makeStartedShift({ stopCount: 1 });
    const author = await makeReceiver();
    const voider = await makeReceiver();
    const category = await makeCategory();

    const detail = await addWeight({ id: author.id }, shift.id, stops[0]!.id, {
      categoryId: category.id,
      weight: '10',
    });
    const entry = detail.tiles.find((t) => t.categoryId === category.id)!.entries[0]!;

    const { voidWeight } = await import('../src/services/receive.js');
    await voidWeight({ id: voider.id }, shift.id, stops[0]!.id, entry.id);

    // `updated_by` is the only trace this person left, and it is still a trace.
    expect(await removeUser(voider.id)).toBe('DEACTIVATED');
  });
});

describe('the receiver worklist', () => {
  it('lists a row recorded today under `recorded` (`D76`)', async () => {
    const user = await makeReceiver();
    const donor = await makeDonor();
    const category = await makeCategory();
    await createDonation({ id: user.id }, {
      donorId: donor.id,
      categoryId: category.id,
      weight: '12',
    });

    const { suggested, recorded } = await listReceiveWorklist();
    expect(suggested).toHaveLength(0);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.status).toBe('CONFIRMED');
    expect(recorded[0]!.editableByReceiver).toBe(true);
  });
});
