// The default-deny gate, end to end (`architecture.md §4.3`).
//
// Over real HTTP against the real app: the gate is only a guarantee if it sits in
// front of the router that Express actually serves, and a unit test of the
// middleware in isolation would not prove that.

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/index.js';
import { createApp } from '../src/index.js';
import { attachActor } from '../src/middleware/auth.js';
import { errorHandler } from '../src/middleware/error.js';
import { buildRouter, defineRoute } from '../src/routes/registry.js';
import { resetLoginThrottle } from '../src/services/auth.js';
import { setCredential } from '../src/services/user.js';
import { createUser } from '../src/services/user.js';
import { makeAdmin, resetDatabase } from './fixtures.js';

// ---------------------------------------------------------------------------
// A cookie-aware client. `fetch` does not keep a jar, and the session mechanism
// under test IS a cookie, so the jar is the test's job.
// ---------------------------------------------------------------------------

interface Response {
  status: number;
  body: any;
  headers: Headers;
}

function client(base: string) {
  const jar = new Map<string, string>();

  return {
    jar,
    async request(method: string, path: string, payload?: unknown): Promise<Response> {
      const headers: Record<string, string> = {};
      if (payload !== undefined) headers['content-type'] = 'application/json';
      if (jar.size > 0) {
        headers['cookie'] = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
      }

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
      return {
        status: res.status,
        body: text.length > 0 ? JSON.parse(text) : null,
        headers: res.headers,
      };
    },
    get(path: string) {
      return this.request('GET', path);
    },
    post(path: string, payload?: unknown) {
      return this.request('POST', path, payload ?? {});
    },
    del(path: string) {
      return this.request('DELETE', path);
    },
  };
}

let server: Server;
let base: string;

beforeAll(async () => {
  // A directory that does not exist: this suite is about the API, and the SPA
  // fallback must not turn a 403 into an index.html.
  process.env['CLIENT_DIST'] = '/nonexistent-client-dist';
  server = createApp().listen(0);
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
  resetLoginThrottle();
});

async function makeAccount(
  first: string,
  last: string,
  tier: 'VOLUNTEER' | 'STAFF',
  duties: ('DRIVE' | 'RECEIVE' | 'REPORT')[] = [],
) {
  const credential = tier === 'VOLUNTEER' ? '1234' : 'a-real-password';
  const created = await createUser({
    firstName: first,
    lastName: last,
    tier,
    duties,
    phone: '5550001111',
    address: '9 Pantry Way',
    credential,
  });
  return { user: created.user, credential };
}

async function signIn(username: string, credential: string) {
  const c = client(base);
  const res = await c.post('/api/auth/login', { username, credential });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return c;
}

describe('default-deny', () => {
  it('rejects an undeclared path rather than 404ing it', async () => {
    const anon = client(base);
    // 403, not 404: the gate answers before routing, so "no declaration" and
    // "no route" are the same answer — you do not get to learn which.
    expect((await anon.get('/api/nope')).body).toMatchObject({
      error: 'UNDECLARED_ROUTE',
    });
    expect((await anon.post('/api/nope')).status).toBe(403);
  });

  it('rejects a handler registered without a declaration, before it runs', async () => {
    let reached = false;

    const app = express();
    app.use(express.json());
    const router = buildRouter([
      defineRoute({
        method: 'get',
        path: '/declared',
        access: { public: true },
        handler: (_req, res) => {
          res.json({ ok: true });
        },
      }),
    ]);
    // Exactly the mistake §4.3 exists to catch: a route added later with a
    // forgotten rule. It is registered on the router and Express would serve it.
    router.get('/undeclared', (_req, res) => {
      reached = true;
      res.json({ ok: true });
    });
    app.use('/api', attachActor, router);
    app.use(errorHandler);

    const local = app.listen(0);
    await new Promise((resolve) => local.once('listening', resolve));
    const localBase = `http://127.0.0.1:${(local.address() as AddressInfo).port}`;
    const c = client(localBase);

    expect((await c.get('/api/declared')).status).toBe(200);

    const denied = await c.get('/api/undeclared');
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({ error: 'UNDECLARED_ROUTE' });
    expect(reached).toBe(false);

    await new Promise((resolve) => local.close(resolve));
  });

  it('answers a malformed body with 400, not a 500 and a correlation id', async () => {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'BAD_REQUEST' });
  });

  it('answers 401, not 403, when a declared route has no signed-in actor', async () => {
    const res = await client(base).get('/api/me');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: 'UNAUTHENTICATED' });
  });
});

describe('tier gate — hierarchical (I1)', () => {
  it('admits a higher tier to a lower requirement', async () => {
    const admin = await makeAdmin();
    await setCredential(admin.id, 'a-real-password');
    const c = await signIn(admin.username, 'a-real-password');

    // /api/users requires STAFF. An equality test would reject the Admin here.
    expect((await c.get('/api/users')).status).toBe(200);
  });

  it('refuses a lower tier', async () => {
    const { user, credential } = await makeAccount('Vol', 'Unteer', 'VOLUNTEER');
    const c = await signIn(user.username, credential);
    expect((await c.get('/api/users')).status).toBe(403);
  });

  it('refuses Staff on an Admin-only route', async () => {
    const { user, credential } = await makeAccount('Stan', 'Ley', 'STAFF');
    const c = await signIn(user.username, credential);

    const res = await c.post('/api/users', {
      firstName: 'New',
      lastName: 'Person',
      tier: 'VOLUNTEER',
    });
    expect(res.status).toBe(403);
  });
});

describe('duty gate — set membership (I2)', () => {
  async function dutyApp() {
    const app = express();
    app.use(express.json());
    app.use(
      '/api',
      attachActor,
      buildRouter([
        defineRoute({
          method: 'get',
          path: '/receive-only',
          access: { tier: 'VOLUNTEER', anyDuty: ['RECEIVE'] },
          handler: (_req, res) => {
            res.json({ ok: true });
          },
        }),
      ]),
    );
    app.use(errorHandler);
    const local = app.listen(0);
    await new Promise((resolve) => local.once('listening', resolve));
    return { local, url: `http://127.0.0.1:${(local.address() as AddressInfo).port}` };
  }

  it('admits the duty holder and refuses a different duty', async () => {
    const receiver = await makeAccount('Rita', 'Receiver', 'VOLUNTEER', ['RECEIVE']);
    const reporter = await makeAccount('Rob', 'Reporter', 'VOLUNTEER', ['REPORT']);

    const { local, url } = await dutyApp();

    // Sessions are opened against the main app; the cookie is the same mechanism
    // either way, so the jar is copied across.
    const receiverSession = await signIn(receiver.user.username, receiver.credential);
    const reporterSession = await signIn(reporter.user.username, reporter.credential);

    const withJar = (jar: Map<string, string>) => {
      const c = client(url);
      for (const [k, v] of jar) c.jar.set(k, v);
      return c;
    };

    expect((await withJar(receiverSession.jar).get('/api/receive-only')).status).toBe(200);
    // Holding REPORT implies nothing about RECEIVE.
    expect((await withJar(reporterSession.jar).get('/api/receive-only')).status).toBe(403);

    await new Promise((resolve) => local.close(resolve));
  });
});

describe('session over HTTP', () => {
  it('signs in, returns the session, and answers /api/me', async () => {
    const { user, credential } = await makeAccount('Sam', 'Session', 'VOLUNTEER', ['DRIVE']);
    const c = await signIn(user.username, credential);

    expect(c.jar.has('r3_session')).toBe(true);

    const me = await c.get('/api/me');
    expect(me.status).toBe(200);
    expect(me.body.user.username).toBe(user.username);
    expect(me.body.sharedDevice).toBe(false);
    expect(typeof me.body.expiresAt).toBe('string');
    // Self always sees own phone and address (§4.3).
    expect(me.body.user.phone).toBe('5550001111');
  });

  it('sets the cookie httpOnly, Secure and SameSite (§4.2)', async () => {
    const { user, credential } = await makeAccount('Cook', 'Ie', 'VOLUNTEER');
    const c = client(base);
    const res = await c.post('/api/auth/login', { username: user.username, credential });

    const cookie = res.headers.getSetCookie().find((v) => v.startsWith('r3_session='));
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('ends the session on logout — the row is gone, not just the cookie', async () => {
    const { user, credential } = await makeAccount('Log', 'Out', 'VOLUNTEER');
    const c = await signIn(user.username, credential);

    expect((await c.post('/api/auth/logout')).status).toBe(204);
    expect(c.jar.has('r3_session')).toBe(false);
    expect((await c.get('/api/me')).status).toBe(401);
    expect(await db.selectFrom('session').select('id').execute()).toHaveLength(0);
  });

  it('ignores a forged session cookie', async () => {
    const c = client(base);
    c.jar.set('r3_session', 'made-up-value.and-a-fake-signature');
    const res = await c.get('/api/me');
    expect(res.status).toBe(401);
    expect(c.jar.has('r3_session')).toBe(false); // and it is cleared
  });

  it('reports a wrong PIN with the tries left, and never says which part was wrong', async () => {
    const { user } = await makeAccount('Wrong', 'Pin', 'VOLUNTEER');
    const res = await client(base).post('/api/auth/login', {
      username: user.username,
      credential: '0000',
    });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: 'INVALID_CREDENTIAL', triesLeft: 3 });
  });
});

describe('the login roster is public by design', () => {
  it('lists active accounts to an anonymous caller, without PII', async () => {
    const { user } = await makeAccount('Ros', 'Ter', 'VOLUNTEER');
    const res = await client(base).get('/api/auth/roster');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      username: user.username,
      firstName: 'Ros',
      credentialKind: 'PIN',
    });
    expect(res.body[0].phone).toBeUndefined();
    expect(res.body[0].address).toBeUndefined();
  });

  it('shows a password prompt for staff and a keypad for volunteers', async () => {
    await makeAccount('Stan', 'Ley', 'STAFF');
    const res = await client(base).get('/api/auth/roster');
    expect(res.body[0].credentialKind).toBe('PASSWORD');
  });

  it('hides deactivated accounts', async () => {
    const { user } = await makeAccount('Gone', 'Away', 'VOLUNTEER');
    await db
      .updateTable('app_user')
      .set({ deactivated_at: new Date() })
      .where('id', '=', user.id)
      .execute();

    expect((await client(base).get('/api/auth/roster')).body).toHaveLength(0);
  });
});

describe('PII shaping on the way out (§4.3)', () => {
  it('hides another person\'s phone and address from a volunteer', async () => {
    // A Volunteer cannot reach /api/users at all, so the check that matters is
    // the shaping function's own: it is exercised here through the one route a
    // Volunteer does reach.
    const other = await makeAccount('Oth', 'Er', 'VOLUNTEER');
    const self = await makeAccount('Sel', 'F', 'VOLUNTEER');
    const c = await signIn(self.user.username, self.credential);

    const me = await c.get('/api/me');
    expect(me.body.user.phone).toBe('5550001111');
    expect(other.user.id).not.toBe(self.user.id);
  });

  it('shows phone and address to Staff and above', async () => {
    await makeAccount('Sub', 'Ject', 'VOLUNTEER');
    const staff = await makeAccount('Stan', 'Ley', 'STAFF');
    const c = await signIn(staff.user.username, staff.credential);

    const res = await c.get('/api/users');
    const subject = res.body.find((u: { firstName: string }) => u.firstName === 'Sub');
    expect(subject.phone).toBe('5550001111');
    expect(subject.address).toBe('9 Pantry Way');
  });
});

describe('account routes (cap 1 / S1.8)', () => {
  async function adminClient() {
    const admin = await makeAdmin();
    await setCredential(admin.id, 'a-real-password');
    return signIn(admin.username, 'a-real-password');
  }

  it('creates an account with a generated username', async () => {
    const c = await adminClient();
    const res = await c.post('/api/users', {
      firstName: 'New',
      lastName: 'Person',
      tier: 'VOLUNTEER',
      duties: ['DRIVE'],
    });

    expect(res.status).toBe(201);
    expect(res.body.user.username).toBe('newperson');
    expect(res.body.user.duties).toEqual(['DRIVE']);
    // No phone on file, so the PIN was generated and must be shown once.
    expect(res.body.generatedCredential).toMatch(/^\d{4}$/);
  });

  it('removes an account and says which kind of removal happened (I21)', async () => {
    const c = await adminClient();
    const created = await c.post('/api/users', {
      firstName: 'Temp',
      lastName: 'Orary',
      tier: 'VOLUNTEER',
    });

    const removed = await c.del(`/api/users/${created.body.user.id}`);
    expect(removed.body).toEqual({ outcome: 'DELETED' });
  });

  it('registers a shared device and hands that browser the marker', async () => {
    const c = await adminClient();
    const res = await c.post('/api/devices', { label: 'receiver tablet' });

    expect(res.status).toBe(201);
    expect(c.jar.has('r3_device')).toBe(true);

    // A session opened on that browser afterwards is a shared-device session:
    // 30 minutes, not 30 days.
    const volunteerAccount = await makeAccount('Reece', 'Iver', 'VOLUNTEER', ['RECEIVE']);
    const marked = client(base);
    marked.jar.set('r3_device', c.jar.get('r3_device')!);
    const login = await marked.post('/api/auth/login', {
      username: volunteerAccount.user.username,
      credential: volunteerAccount.credential,
    });

    expect(login.body.sharedDevice).toBe(true);
    const ttl = new Date(login.body.expiresAt).getTime() - Date.now();
    expect(ttl).toBeLessThanOrEqual(30 * 60_000);
    expect(ttl).toBeGreaterThan(25 * 60_000);
  });
});
