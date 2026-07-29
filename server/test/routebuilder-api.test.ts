// The route-builder endpoints over real HTTP.
//
// The router is built here with `buildRouter(pickupRouteRoutes)` rather than
// through `routes/index.ts`: that list is this wave's shared seam and no lane
// edits it. This still exercises the REAL default-deny gate — `buildRouter` mounts
// it ahead of the handlers from the same declarations the app would use
// (`architecture.md §4.3`).

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/index.js';
import { attachActor } from '../src/middleware/auth.js';
import { SESSION_COOKIE, signCookieValue } from '../src/middleware/cookies.js';
import { errorHandler } from '../src/middleware/error.js';
import { buildRouter } from '../src/routes/registry.js';
import { pickupRouteRoutes } from '../src/routes/pickup-routes.js';
import { newSessionId } from '../src/services/session.js';
import { makeDonor, makeUser, resetDatabase } from './fixtures.js';

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', attachActor, buildRouter(pickupRouteRoutes));
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

beforeEach(resetDatabase);

/**
 * A signed-in caller. The session row is inserted directly — arranging a
 * precondition, never the operation under test — so this suite does not drag the
 * whole login flow in to prove a tier gate.
 */
async function callerAt(tier: 'VOLUNTEER' | 'STAFF' | 'ADMIN') {
  const user = await makeUser({ tier });
  const sessionId = newSessionId();
  await db
    .insertInto('session')
    .values({
      id: sessionId,
      user_id: user.id,
      device_id: null,
      expires_at: new Date(Date.now() + 60 * 60_000),
    })
    .execute();
  return `${SESSION_COOKIE}=${signCookieValue(sessionId)}`;
}

async function call(
  method: string,
  path: string,
  opts: { cookie?: string; payload?: unknown } = {},
) {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers['cookie'] = opts.cookie;
  if (opts.payload !== undefined) headers['content-type'] = 'application/json';

  const res = await fetch(base + path, {
    method,
    headers,
    body: opts.payload === undefined ? undefined : JSON.stringify(opts.payload),
  });
  const text = await res.text();
  return { status: res.status, body: text.length > 0 ? JSON.parse(text) : null };
}

describe('access (architecture.md §4.3)', () => {
  it('refuses an anonymous caller', async () => {
    const res = await call('GET', '/api/routes');
    expect(res.status).toBe(401);
  });

  it('refuses a Volunteer — cap 4 gives routes to Staff', async () => {
    const cookie = await callerAt('VOLUNTEER');
    expect((await call('GET', '/api/routes', { cookie })).status).toBe(403);
    expect(
      (await call('POST', '/api/routes', { cookie, payload: { name: 'x', stops: [] } }))
        .status,
    ).toBe(403);
  });

  it('admits Staff, and Admin by the same declaration (I1 is hierarchical)', async () => {
    expect((await call('GET', '/api/routes', { cookie: await callerAt('STAFF') })).status)
      .toBe(200);
    expect((await call('GET', '/api/routes', { cookie: await callerAt('ADMIN') })).status)
      .toBe(200);
  });

  it('rejects an undeclared path on this router rather than serving it', async () => {
    const cookie = await callerAt('ADMIN');
    const res = await call('GET', '/api/routes/anything/else', { cookie });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'UNDECLARED_ROUTE' });
  });
});

describe('the builder, end to end (S1.6)', () => {
  it('creates a route from an ordered list of stores', async () => {
    const cookie = await callerAt('STAFF');
    const a = await makeDonor('Alpha');
    const b = await makeDonor('Bravo');

    const created = await call('POST', '/api/routes', {
      cookie,
      payload: { name: 'Tuesday North', stops: [b.id, a.id] },
    });

    expect(created.status).toBe(201);
    expect(created.body.name).toBe('Tuesday North');
    expect(created.body.active).toBe(true);
    expect(created.body.stopCount).toBe(2);
    expect(created.body.stops.map((s: { donorId: string }) => s.donorId)).toEqual([
      b.id,
      a.id,
    ]);
    // Donor address is operational data, not PII — never trimmed on the way out.
    expect(created.body.stops[0].donorName).toBe('Bravo');
    expect(created.body.stops[0].donorAddress).not.toBeNull();
    expect(created.body.stops[0].position).toBe(0);
  });

  it('saves a drag-and-drop reorder as one replacement list', async () => {
    const cookie = await callerAt('STAFF');
    const a = await makeDonor('Alpha');
    const b = await makeDonor('Bravo');
    const c = await makeDonor('Charlie');
    const created = await call('POST', '/api/routes', {
      cookie,
      payload: { name: 'R', stops: [a.id, b.id, c.id] },
    });

    const patched = await call('PATCH', `/api/routes/${created.body.id}`, {
      cookie,
      payload: { stops: [c.id, a.id, b.id] },
    });

    expect(patched.status).toBe(200);
    expect(patched.body.stops.map((s: { donorId: string }) => s.donorId)).toEqual([
      c.id,
      a.id,
      b.id,
    ]);
    expect(patched.body.stops.map((s: { position: number }) => s.position)).toEqual([
      0, 1, 2,
    ]);
  });

  it('renames without disturbing the stops', async () => {
    const cookie = await callerAt('STAFF');
    const a = await makeDonor('Alpha');
    const created = await call('POST', '/api/routes', {
      cookie,
      payload: { name: 'Old', stops: [a.id] },
    });

    const patched = await call('PATCH', `/api/routes/${created.body.id}`, {
      cookie,
      payload: { name: 'New' },
    });
    expect(patched.body.name).toBe('New');
    expect(patched.body.stops).toHaveLength(1);
  });

  it('answers a duplicate store with a sentence, not a constraint violation (I28)', async () => {
    const cookie = await callerAt('STAFF');
    const a = await makeDonor('Alpha');

    const res = await call('POST', '/api/routes', {
      cookie,
      payload: { name: 'R', stops: [a.id, a.id] },
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/only appear once/i);
    expect(res.body.message).not.toMatch(/constraint|uq_/i);
  });

  it('refuses a route with no stops', async () => {
    const cookie = await callerAt('STAFF');
    const res = await call('POST', '/api/routes', {
      cookie,
      payload: { name: 'Empty', stops: [] },
    });
    expect(res.status).toBe(400);
  });

  it('reports which removal happened, and restores an archived route', async () => {
    const cookie = await callerAt('STAFF');
    const a = await makeDonor('Alpha');
    const created = await call('POST', '/api/routes', {
      cookie,
      payload: { name: 'R', stops: [a.id] },
    });

    const removed = await call('DELETE', `/api/routes/${created.body.id}`, { cookie });
    expect(removed.body).toEqual({ outcome: 'DELETED' });
    expect((await call('GET', `/api/routes/${created.body.id}`, { cookie })).status).toBe(
      404,
    );
  });

  it('lists archived routes only when asked', async () => {
    const cookie = await callerAt('STAFF');
    const a = await makeDonor('Alpha');
    const created = await call('POST', '/api/routes', {
      cookie,
      payload: { name: 'R', stops: [a.id] },
    });
    // Archive it by hand: a route with no history hard-deletes, and this test is
    // about the listing, not about which branch DELETE takes.
    await db
      .updateTable('route')
      .set({ deactivated_at: new Date() })
      .where('id', '=', created.body.id)
      .execute();

    expect((await call('GET', '/api/routes', { cookie })).body).toHaveLength(0);
    expect(
      (await call('GET', '/api/routes?includeArchived=true', { cookie })).body,
    ).toHaveLength(1);

    const restored = await call('POST', `/api/routes/${created.body.id}/restore`, {
      cookie,
    });
    expect(restored.body.active).toBe(true);
    expect((await call('GET', '/api/routes', { cookie })).body).toHaveLength(1);
  });

  it('answers a malformed id with 404, never a 500', async () => {
    const cookie = await callerAt('STAFF');
    expect((await call('GET', '/api/routes/not-a-uuid', { cookie })).status).toBe(404);
    expect((await call('DELETE', '/api/routes/not-a-uuid', { cookie })).status).toBe(404);
  });
});
