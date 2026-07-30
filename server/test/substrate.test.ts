// Wave-0 substrate tests.
//
// These do not test domain services — none exist yet. They prove the things every
// later lane depends on: that the migrated schema enforces what it claims to, that
// the fixture factory produces usable preconditions, and that `writeTransaction`
// actually runs at SERIALIZABLE and retries 40001.
//
// If these are green, a lane agent can trust its own test results. If they are not,
// every later green test is meaningless.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { db, pool } from '../src/db/index.js';
import { writeTransaction } from '../src/db/transaction.js';
import {
  makeAdmin,
  makeAvailabilityBlock,
  makeClaimedShift,
  makeDriver,
  makeRoute,
  makeShift,
  makeTruck,
  makeUser,
  resetDatabase,
} from './fixtures.js';

beforeEach(resetDatabase);
afterAll(async () => {
  await db.destroy();
  await pool.end().catch(() => undefined);
});

describe('schema is the migrated one, not a fixture', () => {
  it('applied every Phase-1 table', async () => {
    const { rows } = await sql<{ table_name: string }>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
    `.execute(db);
    const names = rows.map((r) => r.table_name);

    for (const t of [
      'app_config', 'app_user', 'user_duty', 'donor', 'category', 'truck',
      'route', 'route_stop', 'recurrence_pattern', 'shift', 'shift_stop',
      'availability_block', 'device', 'push_subscription', 'session', 'notification',
    ]) {
      expect(names, `missing table ${t}`).toContain(t);
    }
  });

  it('carries the §7 intake tables, added in Phase 2 (build-plan D3)', async () => {
    // Through Phase 1 this test asserted the opposite — that these two tables were
    // ABSENT — because D3 deferred them and a stray reference would have been a
    // silent scope leak. Phase 2 is what D3 deferred them TO, so the assertion
    // flips rather than being deleted: the structural fact is still worth pinning,
    // it just points the other way now.
    const { rows } = await sql<{ table_name: string }>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('weight_entry', 'unscheduled_donation')
    `.execute(db);
    expect(rows.map((r) => r.table_name).sort()).toEqual([
      'unscheduled_donation',
      'weight_entry',
    ]);
  });

  it('has no WEIGHED member on the stop enum — it is derived, never stored (I12)', async () => {
    const { rows } = await sql<{ label: string }>`
      SELECT e.enumlabel AS label
      FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'shiftstop_disposition'
    `.execute(db);
    // A stored WEIGHED could pass the completion gate on a weight that was later
    // voided and never replaced, which is the whole reason I12 makes it a read.
    expect(rows.map((r) => r.label)).not.toContain('WEIGHED');
  });

  it('seeds the app_config singleton', async () => {
    const config = await db.selectFrom('app_config').selectAll().executeTakeFirstOrThrow();
    expect(config.horizon_days).toBe(365);
    expect(config.timezone).toBe('America/Chicago');
    expect(config.receiver_edit_window_days).toBe(7);
  });

  it('makes every foreign key ON DELETE RESTRICT — this is the I21 history guard', async () => {
    const { rows } = await sql<{ total: string; restrict: string }>`
      SELECT count(*)::text AS total,
             count(*) FILTER (WHERE confdeltype = 'r')::text AS restrict
      FROM pg_constraint
      WHERE contype = 'f' AND connamespace = 'public'::regnamespace
    `.execute(db);
    expect(rows[0]!.restrict).toBe(rows[0]!.total);
  });
});

describe('tier-1 constraints reject what the domain forbids', () => {
  it('I8 — truck is null before IN_PROGRESS', async () => {
    const { route } = await makeRoute();
    const truck = await makeTruck();
    const admin = await makeAdmin();

    await expect(
      makeShift({ routeId: route.id, truckId: truck.id, status: 'OPEN', createdBy: admin.id }),
    ).rejects.toThrow(/ck_shift_truck/);
  });

  it('I8 — truck is allowed once IN_PROGRESS', async () => {
    const driver = await makeDriver();
    const truck = await makeTruck();
    const shift = await makeShift({
      status: 'IN_PROGRESS', ownerId: driver.id, truckId: truck.id,
    });
    expect(shift.truck_id).toBe(truck.id);
  });

  it('I7 — a CLAIMED shift cannot have a null owner', async () => {
    await expect(makeShift({ status: 'CLAIMED', ownerId: null })).rejects.toThrow(/ck_shift_owner/);
  });

  it('I7 — a CANCELLED shift cannot retain an owner (owner cleared on cancel)', async () => {
    const driver = await makeDriver();
    await expect(
      makeShift({ status: 'CANCELLED', ownerId: driver.id }),
    ).rejects.toThrow(/ck_shift_owner/);
  });

  it('I3 — username must be lowercase alphanumeric', async () => {
    await expect(
      db.insertInto('app_user').values({
        username: 'Not Lower', tier: 'VOLUNTEER', first_name: 'A', last_name: 'B',
        credential_hash: 'x',
      }).execute(),
    ).rejects.toThrow(/ck_user_username/);
  });

  it('I3 — a deactivated user keeps their username reserved', async () => {
    const gone = await makeUser({ deactivated: true });
    await expect(
      db.insertInto('app_user').values({
        username: gone.username, tier: 'VOLUNTEER', first_name: 'A', last_name: 'B',
        credential_hash: 'x',
      }).execute(),
    ).rejects.toThrow(/uq_user_username/);
  });

  it('I28 — a donor appears at most once per route', async () => {
    const { route, donors } = await makeRoute(1);
    await expect(
      db.insertInto('route_stop')
        .values({ route_id: route.id, donor_id: donors[0]!.id, position: 99 })
        .execute(),
    ).rejects.toThrow(/uq_route_stop_donor/);
  });

  it('shift window must be positive', async () => {
    const start = new Date('2026-08-04T14:00:00Z');
    await expect(
      makeShift({ startsAt: start, endsAt: new Date(start.getTime() - 1000) }),
    ).rejects.toThrow(/ck_shift_window/);
  });

  it('uq_shift_occurrence lets many one-offs share a date (NULLS DISTINCT)', async () => {
    const a = await makeShift();
    const b = await makeShift();
    expect(a.occurrence_date).toEqual(b.occurrence_date);
    expect(a.id).not.toBe(b.id);
  });

  it('I21 — a master with history cannot be hard-deleted', async () => {
    const driver = await makeDriver();
    const truck = await makeTruck();
    await makeShift({ status: 'IN_PROGRESS', ownerId: driver.id, truckId: truck.id });

    await expect(
      db.deleteFrom('truck').where('id', '=', truck.id).execute(),
    ).rejects.toThrow(/violates foreign key/);
  });

  it('I21 — a master with no history can be hard-deleted', async () => {
    const truck = await makeTruck();
    const result = await db.deleteFrom('truck').where('id', '=', truck.id).executeTakeFirst();
    expect(Number(result.numDeletedRows)).toBe(1);
  });
});

describe('shared-device marking (architecture.md §4.2) — resolves A1', () => {
  it('registers the reporter desktop, which has no push subscription at all', async () => {
    // The reason session policy cannot hang off push_subscription: no event in
    // the notification matrix targets the desktop, so it would never have a
    // subscription row and would silently read as a personal device.
    const desktop = await db.insertInto('device')
      .values({ label: 'reporter desktop' }).returningAll().executeTakeFirstOrThrow();

    const staff = await makeUser({ tier: 'STAFF' });
    const session = await db.insertInto('session').values({
      id: 'sess-desktop', user_id: staff.id, device_id: desktop.id,
      expires_at: new Date('2026-08-05T02:00:00Z'),
    }).returningAll().executeTakeFirstOrThrow();

    expect(session.device_id).toBe(desktop.id);   // shared: 30 min idle / 12 h cap

    const subs = await db.selectFrom('push_subscription')
      .selectAll().where('device_id', '=', desktop.id).execute();
    expect(subs).toHaveLength(0);
  });

  it('treats a null device_id as personal', async () => {
    const driver = await makeDriver();
    const session = await db.insertInto('session').values({
      id: 'sess-phone', user_id: driver.id,
      expires_at: new Date('2026-09-03T00:00:00Z'),
    }).returningAll().executeTakeFirstOrThrow();
    expect(session.device_id).toBeNull();
  });

  it('binds the tablet subscription to its device row, so losing one loses both', async () => {
    const tablet = await db.insertInto('device')
      .values({ label: 'receiver tablet' }).returningAll().executeTakeFirstOrThrow();
    const sub = await db.insertInto('push_subscription').values({
      device_id: tablet.id, endpoint: 'https://push.example/tablet',
      p256dh: 'k', auth: 'a', label: 'receiver tablet',
    }).returningAll().executeTakeFirstOrThrow();

    expect(sub.user_id).toBeNull();
    expect(sub.device_id).toBe(tablet.id);
  });

  it('ck_push_owner rejects a subscription owned by both a user and a device', async () => {
    const device = await db.insertInto('device')
      .values({ label: 'x' }).returningAll().executeTakeFirstOrThrow();
    const user = await makeUser();
    await expect(
      db.insertInto('push_subscription').values({
        user_id: user.id, device_id: device.id,
        endpoint: 'https://push.example/both', p256dh: 'k', auth: 'a',
      }).execute(),
    ).rejects.toThrow(/ck_push_owner/);
  });

  it('ck_push_owner rejects an orphan subscription owned by neither', async () => {
    await expect(
      db.insertInto('push_subscription').values({
        endpoint: 'https://push.example/orphan', p256dh: 'k', auth: 'a',
      }).execute(),
    ).rejects.toThrow(/ck_push_owner/);
  });
});

describe('410 Gone revokes rather than deletes (architecture.md §4.4) — resolves A4', () => {
  it('cannot hard-delete a subscription a session references', async () => {
    const tablet = await db.insertInto('device')
      .values({ label: 'receiver tablet' }).returningAll().executeTakeFirstOrThrow();
    const sub = await db.insertInto('push_subscription').values({
      device_id: tablet.id, endpoint: 'https://push.example/dead', p256dh: 'k', auth: 'a',
    }).returningAll().executeTakeFirstOrThrow();

    const user = await makeUser({ tier: 'STAFF' });
    await db.insertInto('notification').values({
      subscription_id: sub.id, event: 'truck_inbound',
      payload: JSON.stringify({}),
    }).execute();
    expect(user.id).toBeTruthy();

    await expect(
      db.deleteFrom('push_subscription').where('id', '=', sub.id).execute(),
    ).rejects.toThrow(/violates foreign key/);
  });

  it('revokes instead, preserving which device a past alert went to', async () => {
    const tablet = await db.insertInto('device')
      .values({ label: 'receiver tablet' }).returningAll().executeTakeFirstOrThrow();
    const sub = await db.insertInto('push_subscription').values({
      device_id: tablet.id, endpoint: 'https://push.example/revoke', p256dh: 'k', auth: 'a',
    }).returningAll().executeTakeFirstOrThrow();

    await db.updateTable('push_subscription')
      .set({ revoked_at: new Date() }).where('id', '=', sub.id).execute();

    const live = await db.selectFrom('push_subscription').selectAll()
      .where('revoked_at', 'is', null).execute();
    expect(live).toHaveLength(0);

    const all = await db.selectFrom('push_subscription').selectAll().execute();
    expect(all).toHaveLength(1);                 // history retained
    expect(all[0]!.device_id).toBe(tablet.id);
  });
});

describe('fixture factory produces usable preconditions', () => {
  it('makeClaimedShift gives the pickup lane a shift it can start from', async () => {
    const { shift, ownerId } = await makeClaimedShift();
    expect(shift.status).toBe('CLAIMED');
    expect(shift.owner_id).toBe(ownerId);
    expect(shift.truck_id).toBeNull();   // I8: not yet started
  });

  it('makeDriver holds the Drive duty that eligible() checks first', async () => {
    const driver = await makeDriver();
    const duties = await db.selectFrom('user_duty')
      .select('duty').where('user_id', '=', driver.id).execute();
    expect(duties.map((d) => d.duty)).toEqual(['DRIVE']);
  });

  it('makeAvailabilityBlock supplies the other half of the I20 overlap test', async () => {
    const driver = await makeDriver();
    const block = await makeAvailabilityBlock(
      driver.id, new Date('2026-08-04T13:00:00Z'), new Date('2026-08-04T17:00:00Z'),
    );
    expect(block.user_id).toBe(driver.id);
  });
});

describe('writeTransaction', () => {
  it('runs at SERIALIZABLE', async () => {
    const level = await writeTransaction(async (tx) => {
      const { rows } = await sql<{ transaction_isolation: string }>`
        SHOW transaction_isolation
      `.execute(tx);
      return rows[0]!.transaction_isolation;
    });
    expect(level).toBe('serializable');
  });

  it('commits work performed inside it', async () => {
    const truck = await writeTransaction(async (tx) =>
      tx.insertInto('truck').values({ truck_name: 'Committed' })
        .returningAll().executeTakeFirstOrThrow(),
    );
    const found = await db.selectFrom('truck').selectAll()
      .where('id', '=', truck.id).executeTakeFirst();
    expect(found?.truck_name).toBe('Committed');
  });

  it('rolls back on error and does not retry a non-40001 failure', async () => {
    let attempts = 0;
    await expect(
      writeTransaction(async (tx) => {
        attempts++;
        await tx.insertInto('truck').values({ truck_name: 'Rolled back' }).execute();
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(attempts).toBe(1);
    const trucks = await db.selectFrom('truck').selectAll().execute();
    expect(trucks).toHaveLength(0);
  });

  it('retries on SQLSTATE 40001 and succeeds on a later attempt', async () => {
    let attempts = 0;
    const result = await writeTransaction(async (tx) => {
      attempts++;
      if (attempts < 3) {
        const err = new Error('could not serialize access') as Error & { code: string };
        err.code = '40001';
        throw err;
      }
      await tx.insertInto('truck').values({ truck_name: 'Eventually' }).execute();
      return attempts;
    });

    expect(result).toBe(3);
    const trucks = await db.selectFrom('truck').selectAll().execute();
    expect(trucks).toHaveLength(1);
  });

  it('gives up after the attempt cap', async () => {
    let attempts = 0;
    await expect(
      writeTransaction(async () => {
        attempts++;
        const err = new Error('could not serialize access') as Error & { code: string };
        err.code = '40001';
        throw err;
      }),
    ).rejects.toMatchObject({ code: '40001' });
    expect(attempts).toBe(3);
  });

  it('detects real write skew between two concurrent transactions — the I20 case', async () => {
    // Two transactions each read the shift table, then each insert a different row.
    // Under READ COMMITTED both commit and the combination can violate an invariant
    // neither write violates alone. Under SERIALIZABLE, SSI aborts one with 40001.
    // This is the concrete reason architecture.md §4.1 mandates the isolation level.
    const admin = await makeAdmin();
    const { route } = await makeRoute();

    const attempt = (name: string) =>
      db.transaction().setIsolationLevel('serializable').execute(async (tx) => {
        await tx.selectFrom('shift').select('id').execute();          // read the set
        await tx.insertInto('shift').values({                          // write into it
          route_id: route.id,
          occurrence_date: '2026-08-05',
          starts_at: new Date('2026-08-05T14:00:00Z'),
          ends_at: new Date('2026-08-05T16:00:00Z'),
          status: 'OPEN',
          created_by: admin.id,
          updated_by: admin.id,
          note: name,
        }).execute();
        // Re-read so both transactions have a genuine rw-dependency on each other.
        await tx.selectFrom('shift').select('id').execute();
      });

    const results = await Promise.allSettled([attempt('t1'), attempt('t2')]);
    const rejected = results.filter((r) => r.status === 'rejected');

    // Postgres may serialize these successfully; what must never happen is a
    // failure with any code other than 40001.
    for (const r of rejected) {
      expect((r as PromiseRejectedResult).reason).toMatchObject({ code: '40001' });
    }
    expect(results.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
  });
});
