// The availability routes through the REAL default-deny gate (`architecture.md §4.3`).
//
// `buildRouter(availabilityRoutes)` is called directly rather than booting the whole
// app: `routes/index.ts` is this wave's shared seam and no lane edits it (the lead
// adds each import at merge), and building the router from this lane's own list
// exercises the same gate the mounted app would — the gate reads the DECLARATION
// table it is handed, not what Express registered.
//
// What the route layer owes, and all it owes (§4.3): a declared tier/duty, parsing,
// and shaping. The ownership rule ("whose availability may you read") needs the row's
// owner, so it is asserted here only as an outcome — it lives in the service.

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/index.js';
import { errorHandler } from '../src/middleware/error.js';
import { availabilityRoutes } from '../src/routes/availability.js';
import { buildRouter, defineRoute } from '../src/routes/registry.js';
import {
  declareAvailability,
  type DeclareAvailabilityInput,
} from '../src/services/availability.js';
import { makeDriver, makeShift, makeUser, resetDatabase } from './fixtures.js';

/**
 * Identity, resolved the way `middleware/auth.ts` resolves it — tier and duties read
 * from the database — but keyed off a header instead of a session, because sessions
 * are the identity lane's and this file is about the gate, not about login.
 */
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

const DAY: DeclareAvailabilityInput = {
  kind: 'DATES',
  fromDate: '2026-08-04',
  toDate: '2026-08-04',
};

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  const router = buildRouter(availabilityRoutes);
  // A route registered on the router but absent from the declaration list. The gate
  // must reject it, here as much as in the mounted app.
  router.get('/availability/undeclared-probe', (_req, res) => {
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
    expect((await call('POST', '/api/availability', { body: DAY })).status).toBe(401);
    expect((await call('GET', '/api/availability')).status).toBe(401);
  });

  it('rejects a signed-in user without the Drive duty', async () => {
    // I2 — set membership. Holding RECEIVE says nothing about DRIVE.
    const receiver = await makeUser({ duties: ['RECEIVE'] });
    const res = await call('POST', '/api/availability', { as: receiver.id, body: DAY });
    expect(res.status).toBe(403);
    expect(await db.selectFrom('availability_block').selectAll().execute()).toEqual([]);
  });

  it('rejects a Staff user without the Drive duty — tier does not substitute', async () => {
    // The easy bug §4.3 names: tier is hierarchical, duty is a set, and seniority
    // never confers a duty.
    const staff = await makeUser({ tier: 'STAFF', duties: [] });
    expect(
      (await call('POST', '/api/availability', { as: staff.id, body: DAY })).status,
    ).toBe(403);
  });

  it('rejects a route that was registered but not declared', async () => {
    const driver = await makeDriver();
    const res = await call('GET', '/api/availability/undeclared-probe', { as: driver.id });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'UNDECLARED_ROUTE' });
  });
});

describe('POST /availability', () => {
  it('creates the blocks for a driver', async () => {
    const driver = await makeDriver();
    const res = await call('POST', '/api/availability', {
      as: driver.id,
      body: {
        kind: 'WINDOW',
        fromDate: '2026-08-04',
        toDate: '2026-08-05',
        startTime: '09:00',
        endTime: '11:00',
      },
    });

    expect(res.status).toBe(201);
    expect(res.body.blocks).toHaveLength(2);
    expect(res.body.blocks[0]).toMatchObject({ userId: driver.id });
  });

  it('answers a conflicting declaration with 409 and the run in the way', async () => {
    const driver = await makeDriver();
    const shift = await makeShift({
      ownerId: driver.id,
      status: 'CLAIMED',
      startsAt: new Date('2026-08-04T15:00:00.000Z'),
      endsAt: new Date('2026-08-04T17:00:00.000Z'),
    });

    const res = await call('POST', '/api/availability', { as: driver.id, body: DAY });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('AVAILABILITY_CONFLICT');
    expect(res.body.message).toMatch(/Cancel it first/);
    expect(res.body.conflicts).toMatchObject([{ shiftId: shift.id, releasable: true }]);
  });

  it('answers a malformed declaration with 400', async () => {
    const driver = await makeDriver();
    expect(
      (await call('POST', '/api/availability', { as: driver.id, body: { kind: 'DATES' } }))
        .status,
    ).toBe(400);
    expect(
      (
        await call('POST', '/api/availability', {
          as: driver.id,
          body: { ...DAY, kind: 'SOMETIMES' },
        })
      ).status,
    ).toBe(400);
  });
});

describe('GET /availability', () => {
  it('returns the caller’s own blocks', async () => {
    const driver = await makeDriver();
    await declareAvailability({ id: driver.id, tier: 'VOLUNTEER' }, DAY);

    const res = await call('GET', '/api/availability', { as: driver.id });
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(driver.id);
    expect(res.body.blocks).toHaveLength(1);
  });

  it('lets Staff read a driver’s and refuses another volunteer', async () => {
    const driver = await makeDriver();
    const staff = await makeUser({ tier: 'STAFF' });
    const nosy = await makeDriver();
    await declareAvailability({ id: driver.id, tier: 'VOLUNTEER' }, DAY);

    const asStaff = await call('GET', `/api/availability?userId=${driver.id}`, {
      as: staff.id,
    });
    expect(asStaff.status).toBe(200);
    expect(asStaff.body.blocks).toHaveLength(1);

    const asVolunteer = await call('GET', `/api/availability?userId=${driver.id}`, {
      as: nosy.id,
    });
    expect(asVolunteer.status).toBe(403);
  });
});

describe('DELETE /availability/:id', () => {
  it('withdraws the caller’s own block', async () => {
    const driver = await makeDriver();
    const [block] = await declareAvailability(
      { id: driver.id, tier: 'VOLUNTEER' },
      DAY,
    );

    const res = await call('DELETE', `/api/availability/${block!.id}`, { as: driver.id });
    expect(res.status).toBe(204);
    expect(await db.selectFrom('availability_block').selectAll().execute()).toEqual([]);
  });

  it('refuses another driver’s block', async () => {
    const driver = await makeDriver();
    const other = await makeDriver();
    const [block] = await declareAvailability(
      { id: driver.id, tier: 'VOLUNTEER' },
      DAY,
    );

    const res = await call('DELETE', `/api/availability/${block!.id}`, { as: other.id });
    expect(res.status).toBe(403);
    expect(await db.selectFrom('availability_block').selectAll().execute()).toHaveLength(1);
  });
});

/** A declaration list that omits `access` does not compile. Kept as a type-level
 *  assertion, since `defineRoute`'s required field is half of §4.3's two mechanisms. */
const _accessIsRequired = () =>
  // @ts-expect-error — a route without an access declaration is not a route.
  defineRoute({ method: 'get', path: '/nope', handler: (_req, res) => res.end() });
