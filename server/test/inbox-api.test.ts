// The notification routes through the REAL default-deny gate (`architecture.md §4.3`).
//
// `buildRouter(notificationRoutes)` rather than the whole app: the gate reads the
// DECLARATION table it is handed, not what Express registered, so building this lane's
// own list exercises exactly the mechanism the mounted app uses.
//
// What the route layer owes, and all it owes: a declared tier/duty, parsing, shaping.
// "Whose inbox is this" needs the row's recipient, so it is asserted here only as an
// outcome — it lives in `services/inbox.ts`.

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/index.js';
import { writeTransaction } from '../src/db/transaction.js';
import { errorHandler } from '../src/middleware/error.js';
import { notificationRoutes } from '../src/routes/notifications.js';
import { buildRouter } from '../src/routes/registry.js';
import {
  enqueueNotification,
  type NotificationDraft,
} from '../src/services/notification.js';
import { makeDriver, makeShift, resetDatabase } from './fixtures.js';

/** Identity as `middleware/auth.ts` resolves it — tier and duties from the database —
 *  but keyed off a header, because this file is about the gate, not about login. */
function attachTestActor(): express.RequestHandler {
  return (req, _res, next) => {
    const id = req.header('x-test-user');
    if (!id) return next();
    void (async () => {
      const user = await db
        .selectFrom('app_user')
        .select(['id', 'username', 'tier'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (!user) return next();
      const duties = await db
        .selectFrom('user_duty')
        .select('duty')
        .where('user_id', '=', id)
        .execute();
      req.actor = {
        id: user.id,
        username: user.username,
        tier: user.tier,
        duties: duties.map((d) => d.duty),
        sessionId: 'test-session',
        expiresAt: new Date(Date.now() + 3600_000),
        sharedDevice: false,
      };
      next();
    })().catch(next);
  };
}

let server: Server;
let base: string;

interface Res {
  status: number;
  body: any;
}

async function call(
  method: string,
  path: string,
  options: { as?: string } = {},
): Promise<Res> {
  const headers: Record<string, string> = {};
  if (options.as) headers['x-test-user'] = options.as;
  const res = await fetch(base + path, { method, headers });
  const text = await res.text();
  return { status: res.status, body: text.length > 0 ? JSON.parse(text) : null };
}

async function enqueue(draft: NotificationDraft): Promise<string> {
  const id = await writeTransaction((tx) => enqueueNotification(tx, draft));
  if (id === null) throw new Error('the dedupe index absorbed a fixture row');
  return id;
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  const router = buildRouter(notificationRoutes);
  // Registered on the router but absent from the declaration list. The gate must
  // reject it here as much as in the mounted app (§4.3).
  router.get('/notifications/undeclared-probe', (_req, res) => {
    res.json({ reached: true });
  });
  app.use('/api', attachTestActor(), router);
  app.use(errorHandler);

  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.destroy();
  await pool.end().catch(() => undefined);
});

beforeEach(async () => {
  await resetDatabase();
});

describe('access declarations', () => {
  it('rejects an anonymous caller with 401, not 403', async () => {
    expect((await call('GET', '/api/notifications')).status).toBe(401);
    expect((await call('GET', '/api/notifications/unread-count')).status).toBe(401);
    expect((await call('POST', '/api/notifications/read-all')).status).toBe(401);
  });

  it('admits any signed-in user, with no duty', async () => {
    // I1 — every account is at least a Volunteer, and the inbox is not a driver
    // surface: a coordinator receives the unavailability and at-risk events.
    const anyone = await makeDriver();
    expect((await call('GET', '/api/notifications', { as: anyone.id })).status).toBe(200);
  });

  it('rejects a route that was registered but not declared', async () => {
    const driver = await makeDriver();
    const res = await call('GET', '/api/notifications/undeclared-probe', { as: driver.id });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'UNDECLARED_ROUTE' });
  });
});

describe('GET /notifications', () => {
  it('returns the caller’s rows newest first, with the bell’s count', async () => {
    const driver = await makeDriver();
    const shift = await makeShift({ ownerId: driver.id, status: 'CLAIMED' });
    const older = await enqueue({ event: 'SHIFT_ASSIGNED', recipientId: driver.id });
    const newer = await enqueue({
      event: 'SHIFT_OPENED',
      recipientId: driver.id,
      shiftId: shift.id,
    });

    const res = await call('GET', '/api/notifications', { as: driver.id });
    expect(res.status).toBe(200);
    expect(res.body.items.map((item: { id: string }) => item.id)).toEqual([newer, older]);
    expect(res.body.unreadCount).toBe(2);
    expect(res.body.items[0].url).toBe(`/shifts/${shift.id}`);
  });

  it('never shows one user another’s inbox', async () => {
    const mine = await makeDriver();
    const theirs = await makeDriver();
    await enqueue({ event: 'SHIFT_ASSIGNED', recipientId: theirs.id });

    const res = await call('GET', '/api/notifications', { as: mine.id });
    expect(res.body).toEqual({ items: [], unreadCount: 0 });
  });

  it('honours ?unread=true and ?limit=', async () => {
    const driver = await makeDriver();
    await enqueue({ event: 'SHIFT_ASSIGNED', recipientId: driver.id });
    const second = await enqueue({ event: 'SHIFT_OPENED', recipientId: driver.id });

    const limited = await call('GET', '/api/notifications?limit=1', { as: driver.id });
    expect(limited.body.items).toHaveLength(1);
    expect(limited.body.items[0].id).toBe(second);

    await call('POST', `/api/notifications/${second}/read`, { as: driver.id });
    const unread = await call('GET', '/api/notifications?unread=true', { as: driver.id });
    expect(unread.body.items).toHaveLength(1);
    expect(unread.body.items[0].id).not.toBe(second);
  });
});

describe('GET /notifications/unread-count', () => {
  it('answers with the count alone', async () => {
    const driver = await makeDriver();
    await enqueue({ event: 'SHIFT_ASSIGNED', recipientId: driver.id });
    const res = await call('GET', '/api/notifications/unread-count', { as: driver.id });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ unreadCount: 1 });
  });
});

describe('POST /notifications/:id/read', () => {
  it('marks one read and returns the new count', async () => {
    const driver = await makeDriver();
    const id = await enqueue({ event: 'SHIFT_ASSIGNED', recipientId: driver.id });
    await enqueue({ event: 'SHIFT_OPENED', recipientId: driver.id });

    const res = await call('POST', `/api/notifications/${id}/read`, { as: driver.id });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
    expect(res.body.unreadCount).toBe(1);
  });

  it('answers another user’s row with 404, not 403', async () => {
    const mine = await makeDriver();
    const theirs = await makeDriver();
    const id = await enqueue({ event: 'SHIFT_ASSIGNED', recipientId: theirs.id });

    const res = await call('POST', `/api/notifications/${id}/read`, { as: mine.id });
    expect(res.status).toBe(404);
    // Plain, no code, and it does not admit that the row exists (`ui-ux-spec.md §6`).
    expect(res.body.message).toBe('That alert is no longer in your inbox.');
  });

  it('answers a malformed id with 404 rather than a 500', async () => {
    const driver = await makeDriver();
    const res = await call('POST', '/api/notifications/not-a-uuid/read', { as: driver.id });
    expect(res.status).toBe(404);
  });
});

describe('POST /notifications/read-all', () => {
  it('clears the caller’s bell', async () => {
    const driver = await makeDriver();
    await enqueue({ event: 'SHIFT_ASSIGNED', recipientId: driver.id });
    await enqueue({ event: 'SHIFT_OPENED', recipientId: driver.id });

    const res = await call('POST', '/api/notifications/read-all', { as: driver.id });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ marked: 2, unreadCount: 0 });
  });
});
