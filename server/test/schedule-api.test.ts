// The scheduling routes through the REAL default-deny gate (`architecture.md §4.3`).
//
// `buildRouter(shiftRoutes)` is called directly rather than booting the whole app:
// `routes/index.ts` is this wave's shared seam and no lane edits it (three lanes each
// add a route module, and three lanes editing one array is a guaranteed conflict —
// the lead adds each import at merge). Building the router from this lane's own list
// exercises the same gate the mounted app would, because the gate reads the
// DECLARATION table it is handed rather than what Express registered.
//
// What the route layer owes, and all it owes: a declared tier/duty, parsing, and
// shaping. Every domain rule below is asserted only as an outcome — it lives in the
// service, and `schedule-service.test.ts` / `recurrence-materialization.test.ts` are
// where it is actually pinned.

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/index.js';
import { errorHandler } from '../src/middleware/error.js';
import { shiftRoutes } from '../src/routes/shifts.js';
import { buildRouter } from '../src/routes/registry.js';
import { isoDate } from '../src/services/schedule.js';
import { addDays, parseDate } from '../src/time.js';
import {
  makeAvailabilityBlock,
  makeDriver,
  makeRoute,
  makeShift,
  makeUser,
  resetDatabase,
} from './fixtures.js';

/** Identity resolved the way `middleware/auth.ts` resolves it — tier and duties read
 *  from the database — but keyed off a header, because sessions are the identity
 *  lane's and this file is about the gate. */
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
  const router = buildRouter(shiftRoutes);
  // Registered on the router but absent from the declaration list. The gate must
  // reject it — §4.3's whole point.
  //
  // Three segments, so it matches no declaration: the only three-segment rules here
  // are POST `/shifts/:id/reschedule` and POST `/patterns/:id/terminate`, and the
  // gate matches on method AND path. A two-segment probe would have matched the
  // declared GET `/shifts/:id` and been let through legitimately.
  router.get('/shifts/probe/undeclared', (_req, res) => {
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
  await db.updateTable('app_config').set({ horizon_days: 365 }).execute();
  await db.destroy();
  await pool.end().catch(() => undefined);
});

beforeEach(async () => {
  await resetDatabase();
  // A fortnight, so a pattern create in these tests mints a readable number of rows
  // rather than a year of them. `horizon_days` is an ops knob (`data-model.md §2`).
  await db.updateTable('app_config').set({ horizon_days: 14 }).execute();
});

async function futureDate(days = 7): Promise<string> {
  const row = await sql<{ today: string }>`
    SELECT to_char((now() AT TIME ZONE (SELECT timezone FROM app_config))::date, 'YYYY-MM-DD')
           AS today
  `.execute(db);
  return isoDate(addDays(parseDate(row.rows[0]!.today, 'today'), days));
}

describe('access declarations (§4.3 default-deny)', () => {
  it('rejects an anonymous caller with 401, not 403', async () => {
    expect((await call('GET', '/api/shifts')).status).toBe(401);
    expect((await call('POST', '/api/shifts', { body: {} })).status).toBe(401);
    expect((await call('GET', '/api/patterns')).status).toBe(401);
  });

  it('rejects a route that was registered but not declared', async () => {
    const driver = await makeDriver();
    const res = await call('GET', '/api/shifts/probe/undeclared', { as: driver.id });
    // Not open by being registered first: an undeclared route does not exist as far
    // as the gate is concerned.
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'UNDECLARED_ROUTE' });

    // The method is half of the declaration. `/shifts/:id/reschedule` is declared for
    // POST only, so a GET to the same path is undeclared, not merely unhandled.
    const staff = await makeUser({ tier: 'STAFF' });
    const shift = await makeShift();
    const wrongMethod = await call('GET', `/api/shifts/${shift.id}/reschedule`, {
      as: staff.id,
    });
    expect(wrongMethod.status).toBe(403);
    expect(wrongMethod.body).toMatchObject({ error: 'UNDECLARED_ROUTE' });
  });

  it('lets any signed-in user read the board (cap 5) — including a non-driver', async () => {
    // The board is the shared, collaborative surface, and names on it are
    // public-within-org. Requiring the Drive duty would lock out a Staff coordinator
    // who does not drive.
    const receiver = await makeUser({ duties: ['RECEIVE'] });
    expect((await call('GET', '/api/shifts', { as: receiver.id })).status).toBe(200);
  });

  it('refuses every mutation below Staff, and admits Admin by the same declaration', async () => {
    const driver = await makeDriver();
    const { route } = await makeRoute();
    const date = await futureDate();
    const publish = { routeId: route.id, date, startTime: '09:00', endTime: '11:00' };

    // Caps 4 and 9 are Staff capabilities. Duty never substitutes for tier, and the
    // Drive duty is not seniority.
    expect((await call('POST', '/api/shifts', { as: driver.id, body: publish })).status)
      .toBe(403);
    expect((await call('GET', '/api/patterns', { as: driver.id })).status).toBe(403);

    const shift = await makeShift();
    expect(
      (await call('PATCH', `/api/shifts/${shift.id}`, {
        as: driver.id,
        body: { staffNote: 'no' },
      })).status,
    ).toBe(403);
    expect((await call('DELETE', `/api/shifts/${shift.id}`, { as: driver.id })).status)
      .toBe(403);
    expect(
      (await call('POST', `/api/shifts/${shift.id}/reschedule`, {
        as: driver.id,
        body: { date, startTime: '09:00', endTime: '11:00' },
      })).status,
    ).toBe(403);

    // I1 — hierarchical. Requiring STAFF admits ADMIN, by the one declaration.
    const admin = await makeUser({ tier: 'ADMIN' });
    expect((await call('POST', '/api/shifts', { as: admin.id, body: publish })).status)
      .toBe(201);

    // Nothing was written by any of the refusals.
    expect(await db.selectFrom('shift').select('id').execute()).toHaveLength(2);
  });
});

describe('POST /shifts', () => {
  it('publishes a run and shapes it for the wire', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    const { route } = await makeRoute(2);
    const date = await futureDate();

    const res = await call('POST', '/api/shifts', {
      as: staff.id,
      body: { routeId: route.id, date, startTime: '09:00', endTime: '11:00' },
    });

    expect(res.status).toBe(201);
    expect(res.body.shift).toMatchObject({
      status: 'OPEN',
      ownerId: null,
      ownerName: null,
      truckName: null,
      occurrenceDate: date,
      recurrencePatternId: null,
      assignedOverConflict: false,
    });
    // Instants on the wire, calendar slot as text (`shared/src/schedule.ts`).
    expect(res.body.shift.startsAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(res.body.shift.plannedStops).toHaveLength(2);
    // Donor address is operational data a driver needs — never trimmed.
    expect(res.body.shift.plannedStops[0].donorAddress).not.toBeNull();
    expect(res.body.duplicates).toEqual([]);
  });

  it('answers a missing field with 400 and a bad window with 400', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    const { route } = await makeRoute();
    const date = await futureDate();

    expect(
      (await call('POST', '/api/shifts', { as: staff.id, body: { routeId: route.id } }))
        .status,
    ).toBe(400);
    expect(
      (await call('POST', '/api/shifts', {
        as: staff.id,
        body: { routeId: route.id, date, startTime: '22:00', endTime: '02:00' },
      })).status,
    ).toBe(400);
  });
});

describe('GET /shifts', () => {
  it('applies S1.2’s Mine and Open filters', async () => {
    const driver = await makeDriver();
    const mine = await makeShift({ status: 'CLAIMED', ownerId: driver.id });
    const open = await makeShift({ status: 'OPEN' });

    const board = await call('GET', '/api/shifts', { as: driver.id });
    expect(board.body).toHaveLength(2);

    const onlyMine = await call('GET', '/api/shifts?mine=true', { as: driver.id });
    expect(onlyMine.body.map((s: { id: string }) => s.id)).toEqual([mine.id]);

    const onlyOpen = await call('GET', '/api/shifts?open=true', { as: driver.id });
    expect(onlyOpen.body.map((s: { id: string }) => s.id)).toEqual([open.id]);
  });

  it('shows the owning driver’s name (cap 5)', async () => {
    const driver = await makeDriver({ firstName: 'Karen', lastName: 'Diaz' });
    await makeShift({ status: 'CLAIMED', ownerId: driver.id });

    const board = await call('GET', '/api/shifts', { as: driver.id });
    expect(board.body[0].ownerName).toBe('Karen Diaz');
    // Phone and address are not on this shape at all — `pii.ts` is the sole exit path
    // for those, and the board never needs them.
    expect(board.body[0].phone).toBeUndefined();
  });

  it('answers an unknown run with 404', async () => {
    const driver = await makeDriver();
    expect(
      (await call('GET', '/api/shifts/00000000-0000-0000-0000-000000000000', {
        as: driver.id,
      })).status,
    ).toBe(404);
  });
});

describe('POST /shifts/:id/reschedule (cap 9)', () => {
  it('answers an unconfirmed conflict with 409 RESCHEDULE_CONFLICT and the conflicts', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    const driver = await makeDriver({ firstName: 'Karen', lastName: 'Diaz' });
    const shift = await makeShift({ status: 'CLAIMED', ownerId: driver.id });
    await makeAvailabilityBlock(
      driver.id,
      new Date('2026-09-15T00:00:00Z'),
      new Date('2026-09-16T00:00:00Z'),
    );
    const move = { date: '2026-09-15', startTime: '07:30', endTime: '09:30' };

    const refused = await call('POST', `/api/shifts/${shift.id}/reschedule`, {
      as: staff.id,
      body: move,
    });

    // The envelope S1.7 renders: the error code is the details' own, not the generic
    // CONFLICT, so the client can tell this apart from a lost race.
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe('RESCHEDULE_CONFLICT');
    expect(refused.body.message).toMatch(/releases their run back to the board/);
    expect(refused.body.conflicts[0]).toMatchObject({ kind: 'AVAILABILITY_BLOCK' });

    const confirmed = await call('POST', `/api/shifts/${shift.id}/reschedule`, {
      as: staff.id,
      body: { ...move, confirmRelease: true },
    });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body).toMatchObject({ released: true });
    expect(confirmed.body.shift).toMatchObject({
      status: 'OPEN',
      ownerId: null,
      occurrenceDate: '2026-09-15',
      assignedOverConflict: false,
    });
  });
});

describe('DELETE /shifts/:id', () => {
  it('cancels, and refuses a second cancel with 409', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    const shift = await makeShift({ status: 'OPEN' });

    const first = await call('DELETE', `/api/shifts/${shift.id}`, { as: staff.id });
    expect(first.status).toBe(200);
    expect(first.body.shift).toMatchObject({ status: 'CANCELLED', ownerId: null });

    // I10 — terminal.
    expect((await call('DELETE', `/api/shifts/${shift.id}`, { as: staff.id })).status)
      .toBe(409);
  });
});

describe('patterns (S1.6’s recurring builder)', () => {
  it('creates one, reports what it minted, and lists it', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    const { route } = await makeRoute();

    const created = await call('POST', '/api/patterns', {
      as: staff.id,
      body: {
        routeId: route.id,
        weekdays: [3, 1],
        startTime: '09:00',
        endTime: '11:00',
      },
    });

    expect(created.status).toBe(201);
    // Ascending, de-duplicated (`ck_rp_weekdays`).
    expect(created.body.pattern.weekdays).toEqual([1, 3]);
    expect(created.body.pattern.startTime).toBe('09:00');
    expect(created.body.pattern.endDate).toBeNull();
    // No owner default at create — that is claim-all / staff-assign (cap 6).
    expect(created.body.pattern.ownerDefaultId).toBeNull();
    // Eager to the horizon (§5.3).
    expect(created.body.materialized).toBeGreaterThan(0);

    const listed = await call('GET', '/api/patterns', { as: staff.id });
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0].id).toBe(created.body.pattern.id);

    // The minted instances carry the pattern id, which is what drives S1.2's
    // "repeats weekly" tag.
    const board = await call('GET', `/api/shifts?patternId=${created.body.pattern.id}`, {
      as: staff.id,
    });
    expect(board.body).toHaveLength(created.body.materialized);
    expect(board.body.every((s: { recurrencePatternId: string }) =>
      s.recurrencePatternId === created.body.pattern.id)).toBe(true);
  });

  it('edits the pattern and reports what moved, what did not, and what it minted', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    const { route } = await makeRoute();
    const created = await call('POST', '/api/patterns', {
      as: staff.id,
      body: { routeId: route.id, weekdays: [1], startTime: '09:00', endTime: '11:00' },
    });
    const patternId = created.body.pattern.id;

    const edited = await call('PATCH', `/api/patterns/${patternId}`, {
      as: staff.id,
      body: { weekdays: [1, 2, 3, 4, 5, 6, 7], startTime: '13:00', endTime: '15:00' },
    });

    expect(edited.status).toBe(200);
    expect(edited.body.pattern.weekdays).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // The Mondays already on the board moved onto the new window...
    expect(edited.body.moved).toBe(created.body.materialized);
    expect(edited.body.ownedInstances).toEqual([]);
    expect(edited.body.offPatternInstances).toEqual([]);
    // ...and the newly-added weekdays were minted.
    expect(edited.body.materialized).toBeGreaterThan(0);
  });

  it('clears the end date with an explicit null and leaves it alone when absent', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    const { route } = await makeRoute();
    const endDate = await futureDate(5);
    const created = await call('POST', '/api/patterns', {
      as: staff.id,
      body: {
        routeId: route.id,
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        startTime: '09:00',
        endTime: '11:00',
        endDate,
      },
    });
    expect(created.body.pattern.endDate).toBe(endDate);

    // Absent leaves it alone.
    const touched = await call('PATCH', `/api/patterns/${created.body.pattern.id}`, {
      as: staff.id,
      body: { startTime: '10:00', endTime: '12:00' },
    });
    expect(touched.body.pattern.endDate).toBe(endDate);

    // `null` reopens an open-ended series — §5.3's only stop condition, released.
    const reopened = await call('PATCH', `/api/patterns/${created.body.pattern.id}`, {
      as: staff.id,
      body: { endDate: null },
    });
    expect(reopened.body.pattern.endDate).toBeNull();
    expect(reopened.body.materialized).toBeGreaterThan(0);
  });

  it('bulk-terminates a range without ending the series', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    const { route } = await makeRoute();
    const created = await call('POST', '/api/patterns', {
      as: staff.id,
      body: {
        routeId: route.id,
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        startTime: '09:00',
        endTime: '11:00',
      },
    });

    const from = await futureDate(2);
    const to = await futureDate(4);
    const terminated = await call(
      `POST`,
      `/api/patterns/${created.body.pattern.id}/terminate`,
      { as: staff.id, body: { fromDate: from, toDate: to } },
    );

    expect(terminated.status).toBe(200);
    expect(terminated.body.cancelled).toBe(3);
    // §5.3: the pattern keeps generating beyond the range unless staff also sets
    // `endDate`, so this is not the same action as ending the series.
    const pattern = await call('GET', `/api/patterns/${created.body.pattern.id}`, {
      as: staff.id,
    });
    expect(pattern.body.endDate).toBeNull();
    // The cancelled runs are off the board.
    const board = await call(
      `GET`,
      `/api/shifts?patternId=${created.body.pattern.id}&from=${from}&to=${to}`,
      { as: staff.id },
    );
    expect(board.body).toEqual([]);
  });

  it('answers an unknown pattern with 404', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    const missing = '00000000-0000-0000-0000-000000000000';
    expect((await call('GET', `/api/patterns/${missing}`, { as: staff.id })).status)
      .toBe(404);
    expect(
      (await call('PATCH', `/api/patterns/${missing}`, {
        as: staff.id,
        body: { startTime: '10:00' },
      })).status,
    ).toBe(404);
  });
});
