// Alert registration, end to end (`ui-ux-spec.md §5` onboarding, PRD cap 13).
//
// Over real HTTP against a real router built by `buildRouter`, so the default-deny
// gate in front of these routes is the one that ships (`architecture.md §4.3`). The
// router is assembled here rather than in `routes/index.ts` because that file is
// this wave's shared seam — three lanes need a line in it and none may write it, so
// the lead adds the import at merge. `buildRouter(pushRoutes)` exercises the same
// gate the shared list would.
//
// Against the MIGRATED database (CLAUDE.md): `ck_push_owner` and `uq_push_endpoint`
// are tier-1 constraints that exist only as real DDL, and half of what is asserted
// below is those two constraints holding.

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { db, pool } from '../src/db/index.js';
import { attachActor } from '../src/middleware/auth.js';
import { errorHandler } from '../src/middleware/error.js';
import { authRoutes } from '../src/routes/auth.js';
import { deviceRoutes } from '../src/routes/devices.js';
import { pushRoutes } from '../src/routes/push.js';
import { buildRouter } from '../src/routes/registry.js';
import { writeTransaction } from '../src/db/transaction.js';
import { enqueueNotification } from '../src/services/notification.js';
import { runPushDispatch, type PushTransport } from '../src/jobs/push-dispatch.js';
import { registerSubscription, vapidPublicKey } from '../src/services/push-subscription.js';
import { resetLoginThrottle } from '../src/services/auth.js';
import { createUser, setCredential } from '../src/services/user.js';
import { makeAdmin, resetDatabase } from './fixtures.js';

// ---------------------------------------------------------------------------
// A cookie-aware client. `fetch` keeps no jar, and both things under test here —
// the session and the device marker — ARE cookies.
// ---------------------------------------------------------------------------

interface Res {
  status: number;
  body: any;
}

function client(base: string, jar = new Map<string, string>()) {
  return {
    jar,
    async request(method: string, path: string, payload?: unknown): Promise<Res> {
      const headers: Record<string, string> = {};
      if (payload !== undefined) headers['content-type'] = 'application/json';
      if (jar.size > 0) headers['cookie'] = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

      const res = await fetch(base + path, {
        method,
        headers,
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });

      for (const raw of res.headers.getSetCookie()) {
        const pair = raw.split(';')[0] ?? '';
        const eq = pair.indexOf('=');
        if (eq === -1) continue;
        const name = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1);
        if (value === '') jar.delete(name);
        else jar.set(name, value);
      }

      const text = await res.text();
      return { status: res.status, body: text.length > 0 ? JSON.parse(text) : null };
    },
    get(path: string) {
      return this.request('GET', path);
    },
    post(path: string, payload?: unknown) {
      return this.request('POST', path, payload ?? {});
    },
  };
}

let server: Server;
let base: string;
const originalVapid = process.env['VAPID_PUBLIC_KEY'];

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', attachActor, buildRouter([...authRoutes, ...deviceRoutes, ...pushRoutes]));
  app.use(errorHandler);

  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (originalVapid === undefined) delete process.env['VAPID_PUBLIC_KEY'];
  else process.env['VAPID_PUBLIC_KEY'] = originalVapid;
  await new Promise((resolve) => server.close(resolve));
  await db.destroy();
  await pool.end().catch(() => undefined);
});

beforeEach(async () => {
  await resetDatabase();
  resetLoginThrottle();
});

// ---------------------------------------------------------------------------

const PIN = '1234';
const PASSWORD = 'a-real-password';

let seq = 0;

/** A real account through the real service, so the session under test is real. */
async function account() {
  seq += 1;
  const created = await createUser({
    firstName: `Push${seq}`,
    lastName: `Tester${seq}`,
    tier: 'VOLUNTEER',
    duties: ['DRIVE'],
    phone: '5550001111',
    credential: PIN,
  });
  await setCredential(created.user.id, PIN);
  return { user: created.user, credential: PIN };
}

/** Admin accounts are never created directly (`phase-1-state.md` A30) — the tier is
 *  reached by promotion — so this one comes from the fixture factory, which
 *  arranges preconditions rather than exercising a path under test. */
async function adminAccount() {
  const user = await makeAdmin();
  await setCredential(user.id, PASSWORD);
  return { user, credential: PASSWORD };
}

async function signIn(jar?: Map<string, string>) {
  const { user, credential } = await account();
  const c = client(base, jar);
  const res = await c.post('/api/auth/login', { username: user.username, credential });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { c, user };
}

/** Register this browser as a shared device the way an admin actually does it —
 *  `POST /api/devices` sets the signed `r3_device` cookie on the response (A28). */
async function markAsSharedDevice(): Promise<string> {
  const { user, credential } = await adminAccount();
  const admin = client(base);
  const login = await admin.post('/api/auth/login', {
    username: user.username,
    credential,
  });
  expect(login.status, JSON.stringify(login.body)).toBe(200);

  const res = await admin.post('/api/devices', { label: 'receiver tablet' });
  expect(res.status, JSON.stringify(res.body)).toBe(201);

  const marker = admin.jar.get('r3_device');
  expect(marker, 'POST /api/devices must set the device marker').toBeTruthy();
  return marker as string;
}

const ENDPOINT = 'https://push.example.com/registration/abc123';

function registration(endpoint = ENDPOINT, keys?: { p256dh?: string; auth?: string }) {
  return {
    endpoint,
    keys: { p256dh: keys?.p256dh ?? 'BPublicKey_123', auth: keys?.auth ?? 'AuthSecret-9' },
    label: 'Android phone',
  };
}

async function readSubscription(id: string) {
  return db
    .selectFrom('push_subscription')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
}

/** Inspecting the table directly, the way the fixture factory arranges one: an
 *  assertion about stored state, never the operation under test. */
async function liveFor(userId: string): Promise<number> {
  const row = await db
    .selectFrom('push_subscription')
    .select(db.fn.countAll<string>().as('n'))
    .where('user_id', '=', userId)
    .where('revoked_at', 'is', null)
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

async function countSubscriptions(): Promise<number> {
  const row = await db
    .selectFrom('push_subscription')
    .select(db.fn.countAll<string>().as('n'))
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

// ---------------------------------------------------------------------------

describe('the gate in front of alert registration', () => {
  it('refuses an anonymous registration', async () => {
    const anon = client(base);
    const res = await anon.post('/api/push/subscriptions', registration());
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: 'UNAUTHENTICATED' });
    expect(await countSubscriptions()).toBe(0);
  });

  it('refuses an anonymous read of the key', async () => {
    expect((await client(base).get('/api/push/config')).status).toBe(401);
  });

  it('admits any signed-in user — every account is at least a Volunteer (I1)', async () => {
    const { c } = await signIn();
    expect((await c.get('/api/push/config')).status).toBe(200);
  });
});

describe('a personal browser', () => {
  it('registers against the person, not a device', async () => {
    const { c, user } = await signIn();

    const res = await c.post('/api/push/subscriptions', registration());
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.scope).toBe('USER');

    const row = await readSubscription(res.body.id);
    expect(row.user_id).toBe(user.id);
    // ck_push_owner allows exactly one owner, and this is the person's.
    expect(row.device_id).toBeNull();
    expect(row.endpoint).toBe(ENDPOINT);
    expect(row.revoked_at).toBeNull();
    expect(row.label).toBe('Android phone');
  });

  it('re-offering the same registration updates it rather than doubling it', async () => {
    const { c } = await signIn();

    const first = await c.post('/api/push/subscriptions', registration());
    // What the client does on every start: offer the browser's current
    // registration again, so one the server never received heals itself.
    const second = await c.post(
      '/api/push/subscriptions',
      registration(ENDPOINT, { p256dh: 'BRotatedKey_456' }),
    );

    expect(second.body.id).toBe(first.body.id);
    expect(await countSubscriptions()).toBe(1);
    expect((await readSubscription(first.body.id)).p256dh).toBe('BRotatedKey_456');
  });

  it('brings a revoked registration back to live rather than inserting a second row', async () => {
    const { c } = await signIn();
    const first = await c.post('/api/push/subscriptions', registration());

    // What dispatch does on a 410 Gone: revoke, never delete — every FK is
    // ON DELETE RESTRICT (`data-model.md §0`, `architecture.md §4.4`).
    await db
      .updateTable('push_subscription')
      .set({ revoked_at: sql<Date>`now()` })
      .where('id', '=', first.body.id)
      .execute();

    const again = await c.post('/api/push/subscriptions', registration());
    expect(again.body.id).toBe(first.body.id);
    expect(await countSubscriptions()).toBe(1);
    expect((await readSubscription(first.body.id)).revoked_at).toBeNull();
  });

  it('moves the registration to whoever is signed in on that browser', async () => {
    const jar = new Map<string, string>();
    const first = await signIn(jar);
    const created = await first.c.post('/api/push/subscriptions', registration());

    // Same browser, next person. One endpoint belongs to one person at a time.
    const second = await signIn(jar);
    const moved = await second.c.post('/api/push/subscriptions', registration());

    expect(moved.body.id).toBe(created.body.id);
    expect((await readSubscription(moved.body.id)).user_id).toBe(second.user.id);
    expect(await liveFor(first.user.id)).toBe(0);
    expect(await liveFor(second.user.id)).toBe(1);
  });
});

describe('a registered shared device', () => {
  it('owns the registration itself, whoever is signed in', async () => {
    const marker = await markAsSharedDevice();
    const jar = new Map<string, string>([['r3_device', marker]]);
    const { c, user } = await signIn(jar);

    const res = await c.post('/api/push/subscriptions', registration());
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    // PRD §2: the tablet's is "a notification endpoint, not a login", and it fires
    // regardless of who is logged in — so a driver signing in at the pantry tablet
    // must not turn it into a delivery point for their own runs.
    expect(res.body.scope).toBe('DEVICE');

    const row = await readSubscription(res.body.id);
    expect(row.user_id).toBeNull();
    expect(row.device_id).not.toBeNull();
    expect(await liveFor(user.id)).toBe(0);
  });

  it('treats an unknown marker as personal rather than rejecting it', async () => {
    // `architecture.md §4.2`: a lost or forged marker degrades to personal. The
    // marker is only trusted after it is confirmed against the `device` table.
    const jar = new Map<string, string>([['r3_device', 'not-a-signed-marker']]);
    const { c, user } = await signIn(jar);

    const res = await c.post('/api/push/subscriptions', registration());
    expect(res.body.scope).toBe('USER');
    expect((await readSubscription(res.body.id)).user_id).toBe(user.id);
  });
});

describe('what a registration must look like', () => {
  it('refuses a non-https endpoint', async () => {
    const { c } = await signIn();
    const res = await c.post(
      '/api/push/subscriptions',
      registration('http://push.example.com/registration/abc'),
    );
    expect(res.status).toBe(400);
    expect(await countSubscriptions()).toBe(0);
  });

  it('refuses a missing key set', async () => {
    const { c } = await signIn();
    const res = await c.post('/api/push/subscriptions', { endpoint: ENDPOINT });
    expect(res.status).toBe(400);
  });

  it('refuses a key that is not base64url', async () => {
    const { c } = await signIn();
    const res = await c.post(
      '/api/push/subscriptions',
      registration(ENDPOINT, { auth: 'has spaces and /' }),
    );
    expect(res.status).toBe(400);
  });

  it('never names the field it refused — §7 forbids that vocabulary in copy', async () => {
    const { c } = await signIn();
    const res = await c.post('/api/push/subscriptions', { endpoint: ENDPOINT });
    const message = String(res.body.message).toLowerCase();
    for (const forbidden of ['endpoint', 'payload', 'subscription', 'p256dh']) {
      expect(message).not.toContain(forbidden);
    }
  });
});

describe('the key the browser needs', () => {
  it('hands out the configured public key', async () => {
    process.env['VAPID_PUBLIC_KEY'] = 'BTestPublicKey';
    const { c } = await signIn();
    expect((await c.get('/api/push/config')).body).toEqual({ publicKey: 'BTestPublicKey' });
  });

  it('answers null on a box with no keys, rather than failing', async () => {
    delete process.env['VAPID_PUBLIC_KEY'];
    const { c } = await signIn();
    // An unconfigured box loses the alerting layer and nothing else: the in-app
    // inbox is the source of truth (PRD channel strategy).
    expect((await c.get('/api/push/config')).body).toEqual({ publicKey: null });
    expect(vapidPublicKey()).toBeNull();
  });
});

describe('what dispatch does with what was registered', () => {
  interface FakeTransport extends PushTransport {
    sent: string[];
  }

  function fakeTransport(): FakeTransport {
    const sent: string[] = [];
    return {
      sent,
      async send(target) {
        sent.push(target.endpoint);
      },
    };
  }

  it('delivers an alert to the browser its recipient registered', async () => {
    const { c, user } = await signIn();
    await c.post('/api/push/subscriptions', registration());

    await writeTransaction((tx) =>
      enqueueNotification(tx, { event: 'SHIFT_ASSIGNED', recipientId: user.id }),
    );

    const transport = fakeTransport();
    await runPushDispatch({ transport });
    expect(transport.sent).toEqual([ENDPOINT]);
  });

  it('leaves a shared device out of a personal alert', async () => {
    const marker = await markAsSharedDevice();
    const jar = new Map<string, string>([['r3_device', marker]]);
    const { c, user } = await signIn(jar);
    await c.post('/api/push/subscriptions', registration());

    await writeTransaction((tx) =>
      enqueueNotification(tx, { event: 'SHIFT_ASSIGNED', recipientId: user.id }),
    );

    const transport = fakeTransport();
    await runPushDispatch({ transport });
    // No Phase-1 event is device-scoped (truck-inbound is Phase 2), and a
    // device-owned registration is nobody's personal endpoint.
    expect(transport.sent).toEqual([]);
  });

  it('skips a revoked registration', async () => {
    const { c, user } = await signIn();
    const created = await c.post('/api/push/subscriptions', registration());
    await db
      .updateTable('push_subscription')
      .set({ revoked_at: sql<Date>`now()` })
      .where('id', '=', created.body.id)
      .execute();

    await writeTransaction((tx) =>
      enqueueNotification(tx, { event: 'SHIFT_REMINDER', recipientId: user.id }),
    );

    const transport = fakeTransport();
    await runPushDispatch({ transport });
    expect(transport.sent).toEqual([]);
  });
});

describe('the service refuses what the route would have passed', () => {
  it('rejects an empty endpoint without touching the table', async () => {
    const { user } = await account();
    await expect(
      registerSubscription({
        userId: user.id,
        deviceId: null,
        endpoint: '',
        p256dh: 'BKey',
        auth: 'AKey',
      }),
    ).rejects.toThrow();
    expect(await countSubscriptions()).toBe(0);
  });
});
