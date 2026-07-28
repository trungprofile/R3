// Session lifetimes, revocation, and the device registry (`architecture.md §4.2`).

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/index.js';
import { resetLoginThrottle } from '../src/services/auth.js';
import {
  computeExpiry,
  destroySession,
  findDevice,
  listDevices,
  purgeExpiredSessions,
  registerDevice,
  resolveSession,
  type LifetimeConfig,
} from '../src/services/session.js';
import { createUser } from '../src/services/user.js';
import { login } from '../src/services/auth.js';
import { makeUser, resetDatabase } from './fixtures.js';

beforeEach(async () => {
  await resetDatabase();
  resetLoginThrottle();
});

afterAll(async () => {
  await db.destroy();
  await pool.end().catch(() => undefined);
});

/** The values `architecture.md §4.2` fixes, as migration 0001 seeds them. */
const CONFIG: LifetimeConfig = {
  idleSharedMinutes: 30,
  absoluteSharedHours: 12,
  idlePersonalVolunteerDays: 30,
  idlePersonalStaffDays: 7,
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('computeExpiry', () => {
  const created = new Date('2026-07-28T08:00:00Z');

  it('gives a shared device 30 minutes of idle', () => {
    const now = new Date('2026-07-28T09:00:00Z');
    const expiry = computeExpiry({
      now,
      createdAt: created,
      sharedDevice: true,
      tier: 'VOLUNTEER',
      config: CONFIG,
    });
    expect(expiry.getTime()).toBe(now.getTime() + 30 * MINUTE);
  });

  it('caps a shared device at 12 hours regardless of activity', () => {
    // The cap is what guarantees the tablet is logged out by morning.
    const now = new Date('2026-07-28T19:50:00Z');
    const expiry = computeExpiry({
      now,
      createdAt: created,
      sharedDevice: true,
      tier: 'STAFF',
      config: CONFIG,
    });
    expect(expiry.getTime()).toBe(created.getTime() + 12 * HOUR);
  });

  it('gives a volunteer on a personal phone 30 rolling days', () => {
    const now = new Date('2026-07-28T09:00:00Z');
    const expiry = computeExpiry({
      now,
      createdAt: created,
      sharedDevice: false,
      tier: 'VOLUNTEER',
      config: CONFIG,
    });
    expect(expiry.getTime()).toBe(now.getTime() + 30 * DAY);
  });

  it('gives staff — and admin, hierarchically — the shorter 7-day window (I1)', () => {
    const now = new Date('2026-07-28T09:00:00Z');
    for (const tier of ['STAFF', 'ADMIN'] as const) {
      const expiry = computeExpiry({
        now,
        createdAt: created,
        sharedDevice: false,
        tier,
        config: CONFIG,
      });
      expect(expiry.getTime(), tier).toBe(now.getTime() + 7 * DAY);
    }
  });
});

describe('resolveSession', () => {
  async function volunteerSession() {
    const created = await createUser({
      firstName: 'Sess',
      lastName: 'Ion',
      tier: 'VOLUNTEER',
      duties: ['DRIVE'],
      credential: '1111',
    });
    const result = await login({
      username: created.user.username,
      credential: '1111',
      deviceId: null,
      clientIp: '203.0.113.4',
    });
    return { user: created.user, sessionId: result.sessionId };
  }

  it('resolves identity and slides last_seen_at', async () => {
    const { user, sessionId } = await volunteerSession();
    const before = await db
      .selectFrom('session')
      .select(['last_seen_at', 'expires_at'])
      .where('id', '=', sessionId)
      .executeTakeFirstOrThrow();

    const later = new Date(before.last_seen_at.getTime() + 5 * MINUTE);
    const actor = await resolveSession(sessionId, later);

    expect(actor?.id).toBe(user.id);
    expect(actor?.duties).toEqual(['DRIVE']);
    expect(actor?.sharedDevice).toBe(false);

    const after = await db
      .selectFrom('session')
      .select(['last_seen_at', 'expires_at'])
      .where('id', '=', sessionId)
      .executeTakeFirstOrThrow();
    expect(after.last_seen_at.getTime()).toBe(later.getTime());
    expect(after.expires_at.getTime()).toBeGreaterThan(before.expires_at.getTime());
  });

  it('reads tier and duties fresh, so a change takes effect on the next request', async () => {
    // The JWT column of §4.2's table: a stateless token would hold a stale
    // authorization snapshot until it expired.
    const { user, sessionId } = await volunteerSession();
    await db.updateTable('app_user').set({ tier: 'STAFF' }).where('id', '=', user.id).execute();
    await db.insertInto('user_duty').values({ user_id: user.id, duty: 'RECEIVE' }).execute();

    const actor = await resolveSession(sessionId);
    expect(actor?.tier).toBe('STAFF');
    expect(actor?.duties.sort()).toEqual(['DRIVE', 'RECEIVE']);
  });

  it('refuses an expired session and removes the row', async () => {
    const { sessionId } = await volunteerSession();
    await db
      .updateTable('session')
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where('id', '=', sessionId)
      .execute();

    expect(await resolveSession(sessionId)).toBeNull();
    const rows = await db.selectFrom('session').selectAll().where('id', '=', sessionId).execute();
    expect(rows).toHaveLength(0);
  });

  it('kills the session of a deactivated account on its next request (I21)', async () => {
    const { user, sessionId } = await volunteerSession();
    await db
      .updateTable('app_user')
      .set({ deactivated_at: new Date() })
      .where('id', '=', user.id)
      .execute();

    expect(await resolveSession(sessionId)).toBeNull();
  });

  it('returns null for a logged-out session — deleting the row is the point', async () => {
    const { sessionId } = await volunteerSession();
    await destroySession(sessionId);
    expect(await resolveSession(sessionId)).toBeNull();
  });

  it('returns null for a session id that was never issued', async () => {
    expect(await resolveSession('not-a-session')).toBeNull();
  });
});

describe('device classification', () => {
  it('marks a session on a registered device as shared, with the short lifetime', async () => {
    const tablet = await registerDevice('receiver tablet');
    const created = await createUser({
      firstName: 'Reece',
      lastName: 'Iver',
      tier: 'VOLUNTEER',
      duties: ['RECEIVE'],
      credential: '2222',
    });

    const at = new Date('2026-07-28T10:00:00Z');
    const result = await login({
      username: created.user.username,
      credential: '2222',
      deviceId: tablet.id,
      clientIp: '203.0.113.5',
      now: at,
    });

    expect(result.sharedDevice).toBe(true);
    expect(result.expiresAt.getTime()).toBe(at.getTime() + 30 * MINUTE);

    const row = await db
      .selectFrom('session')
      .select('device_id')
      .where('id', '=', result.sessionId)
      .executeTakeFirstOrThrow();
    expect(row.device_id).toBe(tablet.id);
  });

  it('treats an unregistered browser as personal — the unenumerated default', async () => {
    expect(await findDevice('00000000-0000-4000-8000-000000000000')).toBeNull();
    expect(await findDevice('garbage')).toBeNull();
  });

  it('lists what has been registered', async () => {
    await registerDevice('receiver tablet');
    await registerDevice('reporter desktop');
    expect((await listDevices()).map((d) => d.label)).toEqual([
      'receiver tablet',
      'reporter desktop',
    ]);
  });
});

describe('purgeExpiredSessions', () => {
  it('deletes what has expired and leaves what has not', async () => {
    const user = await makeUser();
    const now = new Date('2026-07-28T12:00:00Z');

    await db
      .insertInto('session')
      .values([
        { id: 'dead-1', user_id: user.id, expires_at: new Date(now.getTime() - HOUR) },
        { id: 'dead-2', user_id: user.id, expires_at: new Date(now.getTime() - 1000) },
        { id: 'alive', user_id: user.id, expires_at: new Date(now.getTime() + HOUR) },
      ])
      .execute();

    expect(await purgeExpiredSessions(now)).toBe(2);
    const left = await db.selectFrom('session').select('id').execute();
    expect(left.map((r) => r.id)).toEqual(['alive']);
  });

  it('is a sweep, not a timer: running it twice is harmless', async () => {
    // §4.4 — every job asks "what is due and unhandled?", so a missed tick
    // self-heals and a repeated one costs nothing.
    const user = await makeUser();
    await db
      .insertInto('session')
      .values({ id: 'dead', user_id: user.id, expires_at: new Date(Date.now() - 1000) })
      .execute();

    expect(await purgeExpiredSessions()).toBe(1);
    expect(await purgeExpiredSessions()).toBe(0);
  });
});
