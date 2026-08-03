// Who may reach the report routes, and whether the two export formats can drift.
//
// Over real HTTP, through the real default-deny gate (`middleware/authorize.ts`).
// The router is built from `reportRoutes` alone rather than from `routes/index.ts`,
// which still exercises the genuine gate: `accessGate` compiles the declarations it
// is handed, so a missing or wrong `access` fails here exactly as it would in the
// mounted app.
//
// TWO THINGS ARE UNDER TEST AND THEY ARE BOTH ABOUT SOMETHING BEING FORGOTTEN.
//
//   1. D17 moved the AGFP→NTFB mapping from the Report screen to Admin, which was
//      "a route-access change and a screen move". The route-access half is six
//      `access` fields, and a change of that shape passes a typecheck, passes every
//      service test, and is invisible until somebody who should not have it edits
//      the mapping. The report routes themselves deliberately did NOT move: an
//      Admin without the REPORT duty is not a Reporter, and a Volunteer with it is
//      (I2, set membership).
//
//   2. D29 removed the CSV and left ONE export path, which serves the Meal Connect
//      receipts as JSON. The refusal is what survives from D16's pair of formats:
//      a week with weight in an unmapped category is refused rather than emitted
//      short, because a short submission is invisible at the far end — the failure
//      Success Metric 4 exists to kill. A186 records that this export is server-built
//      precisely so it CAN refuse, so the refusal is asserted here over real HTTP.

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/index.js';
import { attachActor } from '../src/middleware/auth.js';
import { errorHandler } from '../src/middleware/error.js';
import { authRoutes } from '../src/routes/auth.js';
import { reportRoutes } from '../src/routes/report.js';
import { buildRouter } from '../src/routes/registry.js';
import { resetLoginThrottle } from '../src/services/auth.js';
import { setCredential } from '../src/services/user.js';
import { createNtfbCategory, setMapping } from '../src/services/report.js';
import { addWeight } from '../src/services/receive.js';
import { makeCategory, makeStartedShift, makeUser, resetDatabase } from './fixtures.js';

/** The fixture shift sits on 2026-08-04, a Tuesday. Its week is Mon 3rd–Sun 9th. */
const WEEK = '2026-08-04';

/** A cookie-aware client: `fetch` keeps no jar and the session IS a cookie. Returns
 *  the raw body too, so a refusal can be read even when it is not JSON. */
function client(base: string) {
  const jar = new Map<string, string>();

  async function request(
    method: string,
    path: string,
    payload?: unknown,
  ): Promise<{ status: number; text: string; body: any; headers: Headers }> {
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
    let body: any = null;
    try {
      body = text.length > 0 ? JSON.parse(text) : null;
    } catch {
      body = null; // not JSON, which is the point of keeping `text`
    }
    return { status: res.status, text, body, headers: res.headers };
  }

  return {
    get: (path: string) => request('GET', path),
    post: (path: string, payload?: unknown) => request('POST', path, payload ?? {}),
    patch: (path: string, payload?: unknown) => request('PATCH', path, payload ?? {}),
    put: (path: string, payload?: unknown) => request('PUT', path, payload ?? {}),
    // A body on DELETE: the check-off's key is `(pickup date, donor)` and there is
    // no id to put in a path (D35, migration 0018).
    del: (path: string, payload?: unknown) => request('DELETE', path, payload),
  };
}

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', attachActor, buildRouter([...authRoutes, ...reportRoutes]));
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
  expect(res.status, res.text).toBe(200);
  return c;
}

/** A Volunteer holding the REPORT duty. The person S3.1 is for, and the person who
 *  no longer maintains the mapping. */
async function asReporter() {
  const user = await makeUser({ tier: 'VOLUNTEER', duties: ['REPORT'] });
  await setCredential(user.id, '1234');
  return signIn(user.username, '1234');
}

/** An Admin who does NOT hold the REPORT duty. `createUser` refuses to make an admin
 *  directly (a tier is raised, never created), so the fixture writes the row. */
async function asAdminWithoutReportDuty() {
  const user = await makeUser({ tier: 'ADMIN', duties: [] });
  await setCredential(user.id, 'a-real-password');
  return signIn(user.username, 'a-real-password');
}

/** Staff sit between the two: above a Volunteer, below an Admin. */
async function asStaffReporter() {
  const user = await makeUser({ tier: 'STAFF', duties: ['REPORT'] });
  await setCredential(user.id, 'a-real-password');
  return signIn(user.username, 'a-real-password');
}

const MAPPING_READS = ['/api/report/ntfb-categories', '/api/report/mappings'];

// ---------------------------------------------------------------------------
// D17 — the mapping is Admin's; the report is still the REPORT duty's
// ---------------------------------------------------------------------------

describe('who may edit the AGFP→NTFB mapping (D17)', () => {
  it('refuses a REPORT-duty non-admin on every mapping route', async () => {
    const reporter = await asReporter();

    for (const path of MAPPING_READS) {
      expect((await reporter.get(path)).status, path).toBe(403);
    }
    expect((await reporter.post('/api/report/ntfb-categories', { name: 'Produce' })).status).toBe(
      403,
    );
    expect(
      (await reporter.patch('/api/report/ntfb-categories/some-id', { name: 'Produce' })).status,
    ).toBe(403);
    expect((await reporter.del('/api/report/ntfb-categories/some-id')).status).toBe(403);
    expect(
      (await reporter.put('/api/report/mappings/some-id', { ntfbCategoryId: null })).status,
    ).toBe(403);
  });

  it('gives the Reporter the check-off, and refuses everyone without the duty (D35)', async () => {
    // The check-off is REPORT-duty like the rest of the report, and not a tier: D17's
    // line holds, and filing a receipt into the portal is the reporter's job. A route
    // declaring nothing would be REJECTED rather than open (§4.3 default-deny), so
    // what is under test is that BOTH halves carry the declaration — the write is the
    // obvious one to remember and the un-tick is the one to forget.
    const donorId = await weighAWeek({ mapped: true });
    const reporter = await asReporter();

    const ticked = await reporter.post('/api/report/submissions', {
      pickupDate: WEEK,
      donorId,
    });
    expect(ticked.status, ticked.text).toBe(204);

    const sheet = await reporter.get(`/api/report/export?week=${WEEK}`);
    expect(sheet.body.receipts[0].submitted).not.toBeNull();
    expect(sheet.body.receipts[0].donorId).toBe(donorId);

    const untick = await reporter.del('/api/report/submissions', {
      pickupDate: WEEK,
      donorId,
    });
    expect(untick.status, untick.text).toBe(204);
    const after = await reporter.get(`/api/report/export?week=${WEEK}`);
    expect(after.body.receipts[0].submitted).toBeNull();

    // An Admin who does not report is not a Reporter (I2, set membership).
    const admin = await asAdminWithoutReportDuty();
    expect(
      (await admin.post('/api/report/submissions', { pickupDate: WEEK, donorId })).status,
    ).toBe(403);
    expect(
      (await admin.del('/api/report/submissions', { pickupDate: WEEK, donorId })).status,
    ).toBe(403);
  });

  it('serves the report over an explicit from/to range (D41)', async () => {
    const reporter = await asReporter();

    const ranged = await reporter.get('/api/report?from=2026-07-27&to=2026-08-09');
    expect(ranged.status).toBe(200);
    expect(ranged.body.from).toBe('2026-07-27');
    expect(ranged.body.to).toBe('2026-08-09');

    // A backwards range is a typo a Reporter can see in two date fields, so it is
    // refused rather than silently swapped.
    const backwards = await reporter.get('/api/report?from=2026-08-09&to=2026-07-27');
    expect(backwards.status).toBe(400);
  });

  it('still gives that same Reporter the report itself', async () => {
    // The half of D17 that did NOT change, and the reason the two declarations sit
    // in one file: reporting is a duty a Volunteer can hold (PRD §2), and moving the
    // mapping to Admin must not quietly take the week's numbers with it.
    const reporter = await asReporter();

    expect((await reporter.get('/api/report')).status).toBe(200);
    expect((await reporter.get(`/api/report?week=${WEEK}`)).status).toBe(200);
    expect((await reporter.get(`/api/report/entries?week=${WEEK}`)).status).toBe(200);
    expect((await reporter.get(`/api/report/export?week=${WEEK}`)).status).toBe(200);
  });

  it('refuses Staff on the mapping too, since the tier comparison is >= ADMIN', async () => {
    // Tier is hierarchical (§4.3). Staff outranks a Volunteer and still does not
    // reach an ADMIN declaration — the easy bug here is writing the comparison as
    // equality and letting nobody through, or as a truthiness check and letting
    // everybody.
    const staff = await asStaffReporter();
    for (const path of MAPPING_READS) {
      expect((await staff.get(path)).status, path).toBe(403);
    }
    expect((await staff.get('/api/report')).status).toBe(200);
  });

  it('lets an Admin edit the mapping without holding the REPORT duty', async () => {
    const admin = await asAdminWithoutReportDuty();

    for (const path of MAPPING_READS) {
      expect((await admin.get(path)).status, path).toBe(200);
    }
    const created = await admin.post('/api/report/ntfb-categories', { name: 'Produce' });
    expect(created.status).toBe(201);

    const categories = await admin.get('/api/report/ntfb-categories');
    expect(categories.body).toHaveLength(1);
  });

  it('does not give that Admin the report, because the duty is not the tier', async () => {
    // The distinction D17 was careful to keep: an Admin without the duty is not a
    // Reporter. Duties are set membership (I2) and no tier implies one.
    const admin = await asAdminWithoutReportDuty();

    expect((await admin.get('/api/report')).status).toBe(403);
    expect((await admin.get(`/api/report/export?week=${WEEK}`)).status).toBe(403);
  });

  it('answers 401, not 403, to an anonymous caller', async () => {
    const anon = client(base);
    for (const path of ['/api/report', ...MAPPING_READS]) {
      const res = await anon.get(path);
      expect(res.status, path).toBe(401);
    }
  });
});

// ---------------------------------------------------------------------------
// D29 — one export path, and the refusal that has to survive it
// ---------------------------------------------------------------------------

/** A week with one weighed category, mapped or not. */
async function weighAWeek({ mapped }: { mapped: boolean }) {
  const started = await makeStartedShift({ stopCount: 1 });
  const receiver = await makeUser({ duties: ['RECEIVE'] });
  const produce = await makeCategory('Produce');

  if (mapped) {
    const ntfb = await createNtfbCategory({ name: 'Produce', code: 'PRO' });
    await setMapping(produce.id, ntfb.id, 'Refrigeration');
  }

  await addWeight({ id: receiver.id }, started.shift.id, started.stops[0]!.id, {
    categoryId: produce.id,
    weight: '70',
  });

  // The store the receipt is keyed on (D35), returned so the check-off tests do not
  // have to go back to the database to find out which one it was.
  return started.stops[0]!.donor_id;
}

describe('the export refuses rather than emitting a short submission (D29, D12)', () => {
  it('refuses the week over HTTP while a category carrying weight is unmapped', async () => {
    // A186: S3.1's export is server-built PRECISELY so it can refuse to emit a short
    // one. While D16 kept two formats, this test asserted they refused together; with
    // one path left, what still has to hold is that the refusal is reached before any
    // payload is shaped, and that the screen shows the server's own words (§6).
    await weighAWeek({ mapped: false });
    const reporter = await asReporter();

    const refused = await reporter.get(`/api/report/export?week=${WEEK}`);
    expect(refused.status).toBe(409);
    expect(refused.body.message).toMatch(/not matched/i);
    // Nothing partial came back with it.
    expect(refused.body.receipts).toBeUndefined();
  });

  it('serves receipts, not a file, once the week is exportable', async () => {
    await weighAWeek({ mapped: true });
    const reporter = await asReporter();

    const res = await reporter.get(`/api/report/export?week=${WEEK}`);

    expect(res.status).toBe(200);
    // JSON, and no attachment: D29 removed the CSV, so nothing here should be trying
    // to make the browser save a file.
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(res.headers.get('content-disposition')).toBeNull();

    // D41 renamed the window: it is a RANGE now, defaulting to this week, and a
    // field called `weekEnd` holding a date eleven days after `weekStart` would be a
    // field that lies. `?week=` still resolves to that anchor's whole week, which is
    // what this request asks for.
    expect(res.body.from).toBe('2026-08-03');
    expect(res.body.to).toBe('2026-08-09');
    expect(res.body.receipts).toHaveLength(1);
    expect(res.body.receipts[0]).toMatchObject({
      pickupDate: '2026-08-04',
      itemCount: 1,
      totalPounds: '70',
      notAttempted: false,
      noPounds: false,
    });
    expect(res.body.receipts[0].lines[0]).toMatchObject({
      ntfbCategory: 'Produce',
      storage: 'Refrigeration',
      agfpCategory: 'Produce',
      pounds: '70',
      computed: false,
    });
  });

  it('ignores a stale `format` parameter rather than answering an error', async () => {
    // Nothing in the app sends one any more, so this is about a bookmark saved while
    // D16's two formats existed. Answering a 400 would turn a dead query parameter
    // into a dead end.
    await weighAWeek({ mapped: true });
    const reporter = await asReporter();

    const stale = await reporter.get(`/api/report/export?week=${WEEK}&format=json`);
    expect(stale.status).toBe(200);
    expect(stale.body.receipts).toHaveLength(1);
  });
});
