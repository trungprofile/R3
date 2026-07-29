// The coverage routes through the REAL default-deny gate (`architecture.md §4.3`).
//
// `buildRouter(coverageRoutes)` is called directly rather than booting the whole app:
// `routes/index.ts` is this wave's shared seam and no lane edits it (the lead adds each
// import at merge), and building the router from this lane's own list exercises the same
// gate the mounted app would — the gate reads the DECLARATION table it is handed, not
// what Express registered.
//
// What the route layer owes, and all it owes (§4.3): a declared tier/duty, parsing, and
// shaping. The two comparisons are different kinds and this file separates them: claim
// and release need the **Drive duty** (set membership, I2 — a Staff coordinator without
// it is refused), assign and unassign need **Staff tier** (hierarchical, I1 — Admin
// passes without being named).

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/index.js';
import { errorHandler } from '../src/middleware/error.js';
import { coverageRoutes } from '../src/routes/coverage.js';
import { buildRouter } from '../src/routes/registry.js';
import {
  makeAvailabilityBlock,
  makeDriver,
  makeShift,
  makeUser,
  resetDatabase,
} from './fixtures.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function at(offsetMs: number): Date {
  return new Date(Date.now() + offsetMs);
}

/** Identity resolved the way `middleware/auth.ts` resolves it — tier and duties from
 *  the database — but keyed off a header, because sessions belong to another lane and
 *  this file is about the gate. */
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
        expiresAt: new Date(Date.now() + HOUR),
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
  options: { as?: string; body?: unknown } = {},
): Promise<Res> {
  const headers: Record<string, string> = {};
  if (options.as) headers['x-test-user'] = options.as;
  if (options.body !== undefined) headers['content-type'] = 'application/json';

  const res = await fetch(base + path, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await res.text();
  return { status: res.status, body: text.length > 0 ? JSON.parse(text) : null };
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  const router = buildRouter(coverageRoutes);
  // Registered on the router but absent from the declaration list. The gate must
  // reject it here as much as in the mounted app.
  router.post('/shifts/undeclared-probe', (_req, res) => {
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

beforeEach(resetDatabase);

describe('access declarations', () => {
  it('rejects an anonymous caller with 401, not 403', async () => {
    const driver = await makeDriver();
    const shift = await makeShift({ createdBy: driver.id, startsAt: at(3 * DAY) });
    expect((await call('POST', `/api/shifts/${shift.id}/claim`)).status).toBe(401);
    expect((await call('POST', `/api/shifts/${shift.id}/assign`)).status).toBe(401);
  });

  it('refuses a signed-in user without the Drive duty', async () => {
    const receiver = await makeUser({ duties: ['RECEIVE'] });
    const shift = await makeShift({ createdBy: receiver.id, startsAt: at(3 * DAY) });
    const res = await call('POST', `/api/shifts/${shift.id}/claim`, { as: receiver.id });
    expect(res.status).toBe(403);
    // Nothing was written: the gate runs before the handler.
    const row = await db
      .selectFrom('shift')
      .selectAll()
      .where('id', '=', shift.id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('OPEN');
  });

  it('refuses a Staff user without the Drive duty — tier never substitutes', async () => {
    const staff = await makeUser({ tier: 'STAFF', duties: [] });
    const shift = await makeShift({ createdBy: staff.id, startsAt: at(3 * DAY) });
    expect(
      (await call('POST', `/api/shifts/${shift.id}/claim`, { as: staff.id })).status,
    ).toBe(403);
  });

  it('refuses a Volunteer driver on the staff-only assign', async () => {
    const driver = await makeDriver();
    const shift = await makeShift({ createdBy: driver.id, startsAt: at(3 * DAY) });
    const res = await call('POST', `/api/shifts/${shift.id}/assign`, {
      as: driver.id,
      body: { driverId: driver.id },
    });
    expect(res.status).toBe(403);
  });

  it('admits an Admin wherever Staff is required (I1 — hierarchical)', async () => {
    const admin = await makeUser({ tier: 'ADMIN' });
    const driver = await makeDriver();
    const shift = await makeShift({ createdBy: admin.id, startsAt: at(3 * DAY) });

    const res = await call('POST', `/api/shifts/${shift.id}/assign`, {
      as: admin.id,
      body: { driverId: driver.id },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ driverId: driver.id, assignedOverConflict: false });
  });

  it('rejects a route that was registered but not declared', async () => {
    const driver = await makeDriver();
    const res = await call('POST', '/api/shifts/undeclared-probe', { as: driver.id });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'UNDECLARED_ROUTE' });
  });
});

describe('POST /shifts/:id/claim', () => {
  it('claims an open run and answers with S1.2’s toast', async () => {
    const driver = await makeDriver();
    const shift = await makeShift({ createdBy: driver.id, startsAt: at(3 * DAY) });

    const res = await call('POST', `/api/shifts/${shift.id}/claim`, { as: driver.id });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      scope: 'ONE',
      partial: false,
      summary: "You're on this run.",
    });
    expect(res.body.claimed[0]).toMatchObject({ shiftId: shift.id });
  });

  it('answers the second claimant with the revert toast, not a 500', async () => {
    const karen = await makeDriver({ firstName: 'Karen' });
    const other = await makeDriver();
    const shift = await makeShift({ createdBy: karen.id, startsAt: at(3 * DAY) });

    await call('POST', `/api/shifts/${shift.id}/claim`, { as: karen.id });
    const res = await call('POST', `/api/shifts/${shift.id}/claim`, { as: other.id });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      error: 'SHIFT_UNAVAILABLE',
      message: 'That run was just taken by Karen.',
    });
  });

  it('answers an ineligible claim with the reasons attached', async () => {
    const driver = await makeDriver();
    const shift = await makeShift({
      createdBy: driver.id,
      startsAt: at(3 * DAY),
      endsAt: at(3 * DAY + 2 * HOUR),
    });
    await makeAvailabilityBlock(driver.id, at(3 * DAY - HOUR), at(3 * DAY + HOUR));

    const res = await call('POST', `/api/shifts/${shift.id}/claim`, { as: driver.id });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('NOT_ELIGIBLE');
    expect(res.body.eligibility.reasons).toEqual(['AVAILABILITY_BLOCK']);
  });

  it('rejects an unknown scope', async () => {
    const driver = await makeDriver();
    const shift = await makeShift({ createdBy: driver.id, startsAt: at(3 * DAY) });
    const res = await call('POST', `/api/shifts/${shift.id}/claim`, {
      as: driver.id,
      body: { scope: 'EVERYTHING' },
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /shifts/:id/release', () => {
  it('releases the caller’s own run', async () => {
    const driver = await makeDriver();
    const shift = await makeShift({
      createdBy: driver.id,
      ownerId: driver.id,
      status: 'CLAIMED',
      startsAt: at(3 * DAY),
    });

    const res = await call('POST', `/api/shifts/${shift.id}/release`, { as: driver.id });
    expect(res.status).toBe(200);
    expect(res.body.released).toHaveLength(1);
  });

  it('refuses another driver’s run with 403', async () => {
    const driver = await makeDriver();
    const nosy = await makeDriver();
    const shift = await makeShift({
      createdBy: driver.id,
      ownerId: driver.id,
      status: 'CLAIMED',
      startsAt: at(3 * DAY),
    });

    expect(
      (await call('POST', `/api/shifts/${shift.id}/release`, { as: nosy.id })).status,
    ).toBe(403);
  });
});

describe('POST /shifts/:id/assign — the confirm round trip (S1.6)', () => {
  it('warns first, then assigns and flags on confirmation', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    const karen = await makeDriver({ firstName: 'Karen' });
    const shift = await makeShift({
      createdBy: staff.id,
      startsAt: at(3 * DAY),
      endsAt: at(3 * DAY + 2 * HOUR),
    });
    await makeAvailabilityBlock(karen.id, at(3 * DAY - HOUR), at(3 * DAY + HOUR));

    const warned = await call('POST', `/api/shifts/${shift.id}/assign`, {
      as: staff.id,
      body: { driverId: karen.id },
    });
    expect(warned.status).toBe(409);
    expect(warned.body.error).toBe('ASSIGN_CONFLICT');
    expect(warned.body.message).toMatch(/assign anyway\?$/);

    const confirmed = await call('POST', `/api/shifts/${shift.id}/assign`, {
      as: staff.id,
      body: { driverId: karen.id, confirmConflict: true },
    });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.assignedOverConflict).toBe(true);
  });

  it('requires a driverId', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    const shift = await makeShift({ createdBy: staff.id, startsAt: at(3 * DAY) });
    expect(
      (await call('POST', `/api/shifts/${shift.id}/assign`, { as: staff.id, body: {} }))
        .status,
    ).toBe(400);
  });
});

describe('GET /shifts/:id/eligibility', () => {
  it('previews the warning for staff', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    const karen = await makeDriver({ firstName: 'Karen' });
    const shift = await makeShift({
      createdBy: staff.id,
      startsAt: at(3 * DAY),
      endsAt: at(3 * DAY + 2 * HOUR),
    });
    await makeAvailabilityBlock(karen.id, at(3 * DAY - HOUR), at(3 * DAY + HOUR));

    const res = await call(
      'GET',
      `/api/shifts/${shift.id}/eligibility?driverId=${karen.id}`,
      { as: staff.id },
    );
    expect(res.status).toBe(200);
    expect(res.body.warning).toMatch(/Karen/);
    expect(res.body.eligibility.eligible).toBe(false);
  });

  it('needs a driverId', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    const shift = await makeShift({ createdBy: staff.id, startsAt: at(3 * DAY) });
    expect(
      (await call('GET', `/api/shifts/${shift.id}/eligibility`, { as: staff.id })).status,
    ).toBe(400);
  });
});

describe('POST /shifts/:id/unassign', () => {
  it('puts the run back on the board', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    const driver = await makeDriver();
    const shift = await makeShift({
      createdBy: staff.id,
      ownerId: driver.id,
      status: 'CLAIMED',
      startsAt: at(3 * DAY),
    });

    const res = await call('POST', `/api/shifts/${shift.id}/unassign`, { as: staff.id });
    expect(res.status).toBe(200);
    expect(res.body.shift).toMatchObject({ shiftId: shift.id });

    const row = await db
      .selectFrom('shift')
      .selectAll()
      .where('id', '=', shift.id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('OPEN');
  });
});
