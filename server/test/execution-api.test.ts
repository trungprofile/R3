// The execution routes through the REAL default-deny gate (`architecture.md §4.3`).
//
// `buildRouter(executionRoutes)` is called directly rather than booting the app:
// `routes/index.ts` is this wave's shared seam and no lane edits it (the lead adds
// each import at merge). The gate reads the DECLARATION table it is handed, not what
// Express registered, so building it from this lane's own list exercises exactly what
// the mounted app would.
//
// What the route layer owes, and all it owes (§4.3): a declared tier/duty, parsing,
// and shaping. Ownership needs the row and therefore lives in the service; it appears
// here only as an outcome.

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/index.js';
import { errorHandler } from '../src/middleware/error.js';
import { executionRoutes } from '../src/routes/execution.js';
import { buildRouter } from '../src/routes/registry.js';
import { startRun } from '../src/services/execution.js';
import {
  makeClaimedShift,
  makeRoute,
  makeTruck,
  makeUser,
  resetDatabase,
} from './fixtures.js';

/** Identity resolved the way `middleware/auth.ts` resolves it — tier and duties from
 *  the database — but keyed off a header, because sessions are the identity lane's
 *  and this file is about the gate. */
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

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  const router = buildRouter(executionRoutes);
  // Registered but never declared. The gate must reject it.
  router.get('/shifts/undeclared-probe', (_req, res) => {
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

/** A claimed run plus a truck, with the owner holding DRIVE. */
async function claimed() {
  const { route } = await makeRoute(2);
  const owner = await makeUser({ duties: ['DRIVE'] });
  const { shift } = await makeClaimedShift({ routeId: route.id, ownerId: owner.id });
  const truck = await makeTruck();
  return { shift, owner, truck };
}

describe('access declarations', () => {
  it('rejects an anonymous caller with 401, not 403', async () => {
    const { shift } = await claimed();
    expect((await call('GET', `/api/shifts/${shift.id}/run`)).status).toBe(401);
    expect((await call('POST', `/api/shifts/${shift.id}/start`)).status).toBe(401);
  });

  it('rejects a signed-in user without the Drive duty', async () => {
    // I2 — set membership. Holding RECEIVE says nothing about DRIVE.
    const { shift, truck } = await claimed();
    const receiver = await makeUser({ duties: ['RECEIVE'] });
    const res = await call('POST', `/api/shifts/${shift.id}/start`, {
      as: receiver.id,
      body: { truckId: truck.id },
    });
    expect(res.status).toBe(403);
  });

  it('rejects a Staff user without the Drive duty from starting a run', async () => {
    // Tier is hierarchical, duty is a set, and seniority never confers a duty.
    const { shift, truck } = await claimed();
    const staff = await makeUser({ tier: 'STAFF', duties: [] });
    expect(
      (
        await call('POST', `/api/shifts/${shift.id}/start`, {
          as: staff.id,
          body: { truckId: truck.id },
        })
      ).status,
    ).toBe(403);
  });

  it('rejects a Volunteer driver from reassigning a stop — I30 is staff-only', async () => {
    const { shift, owner, truck } = await claimed();
    const run = await startRun({ id: owner.id, tier: 'VOLUNTEER' }, shift.id, {
      truckId: truck.id,
    });
    const res = await call(
      'POST',
      `/api/shifts/${shift.id}/stops/${run.stops[0]!.id}/reassign`,
      { as: owner.id, body: { toShiftId: shift.id } },
    );
    expect(res.status).toBe(403);
  });

  it('rejects a route that was registered but not declared', async () => {
    const user = await makeUser({ duties: ['DRIVE'] });
    const res = await call('GET', '/api/shifts/undeclared-probe', { as: user.id });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'UNDECLARED_ROUTE' });
  });
});

describe('the driver run', () => {
  it('starts, resolves, reorders, notes, and heads back', async () => {
    const { shift, owner, truck } = await claimed();

    const started = await call('POST', `/api/shifts/${shift.id}/start`, {
      as: owner.id,
      body: { truckId: truck.id },
    });
    expect(started.status).toBe(200);
    expect(started.body.status).toBe('IN_PROGRESS');
    expect(started.body.stops).toHaveLength(2);

    const [first, second] = started.body.stops;

    const reordered = await call('POST', `/api/shifts/${shift.id}/stops/order`, {
      as: owner.id,
      body: { stopIds: [second.id, first.id] },
    });
    expect(reordered.status).toBe(200);
    expect(reordered.body.map((s: { id: string }) => s.id)).toEqual([second.id, first.id]);

    const noted = await call('PATCH', `/api/shifts/${shift.id}/stops/${first.id}`, {
      as: owner.id,
      body: { note: 'Back door' },
    });
    expect(noted.body.note).toBe('Back door');

    // The gate is real: heading back before every stop is resolved is refused.
    const tooEarly = await call('POST', `/api/shifts/${shift.id}/pickup-complete`, {
      as: owner.id,
    });
    expect(tooEarly.status).toBe(409);

    for (const stop of [first, second]) {
      const res = await call(
        'POST',
        `/api/shifts/${shift.id}/stops/${stop.id}/resolve`,
        { as: owner.id, body: { disposition: 'COLLECTED' } },
      );
      expect(res.status).toBe(200);
    }

    const done = await call('POST', `/api/shifts/${shift.id}/pickup-complete`, {
      as: owner.id,
      body: { note: 'Heavy day' },
    });
    expect(done.status).toBe(200);
    expect(done.body.pickupCompletedAt).not.toBeNull();
    // D1 / I27: the milestone does not complete the run.
    expect(done.body.status).toBe('IN_PROGRESS');
    expect(done.body.note).toBe('Heavy day');
  });

  it('answers a malformed start with 400 and an unknown run with 404', async () => {
    const { shift, owner } = await claimed();
    expect(
      (await call('POST', `/api/shifts/${shift.id}/start`, { as: owner.id, body: {} }))
        .status,
    ).toBe(400);
    expect(
      (
        await call('GET', '/api/shifts/00000000-0000-0000-0000-000000000000/run', {
          as: owner.id,
        })
      ).status,
    ).toBe(404);
  });

  it('lets Staff read a run they do not own, and refuses another volunteer', async () => {
    const { shift } = await claimed();
    const staff = await makeUser({ tier: 'STAFF' });
    const nosy = await makeUser({ duties: ['DRIVE'] });

    expect((await call('GET', `/api/shifts/${shift.id}/run`, { as: staff.id })).status).toBe(
      200,
    );
    expect((await call('GET', `/api/shifts/${shift.id}/run`, { as: nosy.id })).status).toBe(
      403,
    );
  });
});

describe('staff reassignment over the wire', () => {
  it('moves a stop between two runs', async () => {
    const a = await claimed();
    const b = await claimed();
    const staff = await makeUser({ tier: 'STAFF' });

    const runA = await startRun({ id: a.owner.id, tier: 'VOLUNTEER' }, a.shift.id, {
      truckId: a.truck.id,
    });
    await startRun({ id: b.owner.id, tier: 'VOLUNTEER' }, b.shift.id, {
      truckId: b.truck.id,
    });

    const res = await call(
      'POST',
      `/api/shifts/${a.shift.id}/stops/${runA.stops[0]!.id}/reassign`,
      { as: staff.id, body: { toShiftId: b.shift.id } },
    );

    expect(res.status).toBe(200);
    expect(res.body.from.disposition).toBe('REASSIGNED');
    expect(res.body.to.disposition).toBe('PENDING');
  });
});
