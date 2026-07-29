// The master-data API over real HTTP, through the real default-deny gate.
//
// The router is built here from these routes alone (`buildRouter`), not from
// `routes/index.ts`: that file is this wave's shared seam and the lead adds each
// lane's line at merge. Building it directly still exercises the genuine gate —
// `accessGate` compiles the declarations it is handed, so a missing or wrong
// declaration fails here exactly as it would in the mounted app.

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/index.js';
import { attachActor } from '../src/middleware/auth.js';
import { errorHandler } from '../src/middleware/error.js';
import { authRoutes } from '../src/routes/auth.js';
import { categoryRoutes } from '../src/routes/categories.js';
import { donorRoutes } from '../src/routes/donors.js';
import { truckRoutes } from '../src/routes/trucks.js';
import { buildRouter } from '../src/routes/registry.js';
import { resetLoginThrottle } from '../src/services/auth.js';
import { createUser, setCredential } from '../src/services/user.js';
import { makeAdmin, makeRoute, resetDatabase } from './fixtures.js';

// A cookie-aware client: `fetch` keeps no jar and the session IS a cookie.
function client(base: string) {
  const jar = new Map<string, string>();

  async function request(
    method: string,
    path: string,
    payload?: unknown,
  ): Promise<{ status: number; body: any }> {
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
    return { status: res.status, body: text.length > 0 ? JSON.parse(text) : null };
  }

  return {
    get: (path: string) => request('GET', path),
    post: (path: string, payload?: unknown) => request('POST', path, payload ?? {}),
    patch: (path: string, payload?: unknown) => request('PATCH', path, payload ?? {}),
    put: (path: string, payload?: unknown) => request('PUT', path, payload ?? {}),
    del: (path: string) => request('DELETE', path),
  };
}

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(
    '/api',
    attachActor,
    buildRouter([...authRoutes, ...donorRoutes, ...truckRoutes, ...categoryRoutes]),
  );
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
  resetLoginThrottle();
});

async function signIn(username: string, credential: string) {
  const c = client(base);
  const res = await c.post('/api/auth/login', { username, credential });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return c;
}

async function asAdmin() {
  const admin = await makeAdmin();
  await setCredential(admin.id, 'a-real-password');
  return signIn(admin.username, 'a-real-password');
}

async function asStaff() {
  const staff = await createUser({
    firstName: 'Clark',
    lastName: 'Coord',
    tier: 'STAFF',
    credential: 'a-real-password',
  });
  return signIn(staff.user.username, 'a-real-password');
}

async function asVolunteer() {
  const driver = await createUser({
    firstName: 'Karen',
    lastName: 'Driver',
    tier: 'VOLUNTEER',
    duties: ['DRIVE'],
    phone: '5550001111',
    credential: '1234',
  });
  return signIn(driver.user.username, '1234');
}

describe('default-deny (§4.3)', () => {
  it('rejects an undeclared method on a declared path', async () => {
    const admin = await asAdmin();
    // No PUT is declared anywhere in this lane. 403 from the gate, not 404 from
    // Express, and not a silently-served handler.
    const res = await admin.put('/api/donors');
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'UNDECLARED_ROUTE' });
  });

  it('answers 401 to an anonymous read of a declared route', async () => {
    const anon = client(base);
    for (const path of ['/api/donors', '/api/trucks', '/api/categories']) {
      const res = await anon.get(path);
      expect(res.status, path).toBe(401);
      expect(res.body).toMatchObject({ error: 'UNAUTHENTICATED' });
    }
  });
});

describe('tier declarations', () => {
  it('lets any signed-in user read all three lists', async () => {
    const volunteer = await asVolunteer();
    for (const path of ['/api/donors', '/api/trucks', '/api/categories']) {
      expect((await volunteer.get(path)).status, path).toBe(200);
    }
  });

  it('refuses master-data writes below Admin', async () => {
    // `product-requirement.md §2`: donor & truck master data (and cap 17's
    // categories) are the Admin-only delta; Staff explicitly cannot create or
    // delete permanent donors.
    const staff = await asStaff();
    expect((await staff.post('/api/donors', { name: 'Aldi' })).status).toBe(403);
    expect((await staff.post('/api/trucks', { truckName: 'Van' })).status).toBe(403);
    expect((await staff.post('/api/categories', { name: 'Dry' })).status).toBe(403);

    const volunteer = await asVolunteer();
    expect((await volunteer.post('/api/donors', { name: 'Aldi' })).status).toBe(403);
  });
});

describe('donors (cap 2)', () => {
  it('never trims a donor address or contact — PII gates people, not places', async () => {
    const admin = await asAdmin();
    const created = await admin.post('/api/donors', {
      name: "Sam's Club",
      address: '4400 N Freeway',
      contact: 'Dock — 555-0143',
      note: 'Ring the side bell.',
    });
    expect(created.status).toBe(201);

    // A Volunteer driver sees the whole record: the address is where they drive
    // and the contact is who they call (`CLAUDE.md`, `pii.ts` scope note).
    const volunteer = await asVolunteer();
    const listed = await volunteer.get('/api/donors');
    expect(listed.body).toEqual([
      expect.objectContaining({
        name: "Sam's Club",
        address: '4400 N Freeway',
        contact: 'Dock — 555-0143',
        note: 'Ring the side bell.',
        active: true,
      }),
    ]);
  });

  it('archives, hides from the default list, and restores', async () => {
    const admin = await asAdmin();
    const donor = (await admin.post('/api/donors', { name: 'Walmart' })).body;

    expect((await admin.patch(`/api/donors/${donor.id}`, { active: false })).body).toMatchObject(
      { active: false },
    );
    expect((await admin.get('/api/donors')).body).toEqual([]);
    expect((await admin.get('/api/donors?includeInactive=true')).body).toHaveLength(1);

    await admin.patch(`/api/donors/${donor.id}`, { active: true });
    expect((await admin.get('/api/donors')).body).toHaveLength(1);
  });

  it('I21 — reports which removal happened', async () => {
    const admin = await asAdmin();

    const unused = (await admin.post('/api/donors', { name: 'Mistyped' })).body;
    expect((await admin.del(`/api/donors/${unused.id}`)).body).toEqual({
      outcome: 'DELETED',
    });

    const { donors } = await makeRoute(1);
    const used = donors[0]!;
    expect((await admin.del(`/api/donors/${used.id}`)).body).toEqual({
      outcome: 'DEACTIVATED',
    });
    expect((await admin.get(`/api/donors/${used.id}`)).body).toMatchObject({
      active: false,
    });
  });

  it('rejects a malformed patch with 400, not a 500', async () => {
    const admin = await asAdmin();
    const donor = (await admin.post('/api/donors', { name: 'Aldi' })).body;

    expect((await admin.patch(`/api/donors/${donor.id}`, { active: 'false' })).status).toBe(
      400,
    );
    expect((await admin.patch(`/api/donors/${donor.id}`, { name: null })).status).toBe(400);
    expect((await admin.post('/api/donors', {})).status).toBe(400);
  });
});

describe('trucks (cap 3)', () => {
  it('creates, edits, and reports a hard delete', async () => {
    const admin = await asAdmin();
    const created = await admin.post('/api/trucks', {
      truckName: 'Box Truck',
      plate: 'TX 8842',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ truckName: 'Box Truck', plate: 'TX 8842' });

    const edited = await admin.patch(`/api/trucks/${created.body.id}`, { plate: null });
    expect(edited.body.plate).toBeNull();

    expect((await admin.del(`/api/trucks/${created.body.id}`)).body).toEqual({
      outcome: 'DELETED',
    });
  });

  it('hides an inactive truck from the driver picker', async () => {
    const admin = await asAdmin();
    const truck = (await admin.post('/api/trucks', { truckName: 'Old Van' })).body;
    await admin.patch(`/api/trucks/${truck.id}`, { active: false });

    const volunteer = await asVolunteer();
    expect((await volunteer.get('/api/trucks')).body).toEqual([]);
  });
});

describe('categories (cap 17, build-plan D2)', () => {
  it('adds and archives, which is what the S1.8 Categories tab does', async () => {
    const admin = await asAdmin();
    const created = await admin.post('/api/categories', { name: 'Frz Non Meat' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'Frz Non Meat', active: true });

    const renamed = await admin.patch(`/api/categories/${created.body.id}`, {
      name: 'Frozen Non-Meat',
    });
    expect(renamed.body.name).toBe('Frozen Non-Meat');

    await admin.patch(`/api/categories/${created.body.id}`, { active: false });
    // Hidden from new entry, preserved for the admin list.
    expect((await admin.get('/api/categories')).body).toEqual([]);
    expect((await admin.get('/api/categories?includeInactive=true')).body).toHaveLength(1);
  });

  it('404s a category that is not there', async () => {
    const admin = await asAdmin();
    const res = await admin.get('/api/categories/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });
});
