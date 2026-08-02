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
//   2. D16 added a second output format to `/report/export`. The CSV refuses a week
//      with unmapped weight carrying food (D12) because a short file is invisible at
//      the far end — the failure Success Metric 4 exists to kill. A second format
//      that forgot the refusal would be a second, silent way to produce that short
//      report, so the two are asserted to refuse together and to carry byte-identical
//      rows.

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EXPORT_COLUMNS } from '../../shared/src/report.js';
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
 *  the raw body too, because one of these routes answers with a CSV. */
function client(base: string) {
  const jar = new Map<string, string>();

  async function request(
    method: string,
    path: string,
    payload?: unknown,
  ): Promise<{ status: number; text: string; body: any }> {
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
      body = null; // a CSV, which is the point of keeping `text`
    }
    return { status: res.status, text, body };
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
// D16 — two formats, one refusal
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
}

/** The CSV back as cells, minus the header. Quoting is RFC 4180 with every field
 *  quoted (`routes/report.ts`), so a naive split on `","` is exact here. */
function csvCells(text: string): string[][] {
  return text
    .trim()
    .split('\r\n')
    .slice(1)
    .map((line) => line.slice(1, -1).split('","').map((cell) => cell.replace(/""/g, '"')));
}

describe('the export refuses identically in both formats (D16, D12)', () => {
  it('refuses the printed sheet exactly where it refuses the file', async () => {
    // THE HIGHEST-VALUE ASSERTION IN THIS FILE. A186 records that S3.1's export is
    // server-built *precisely so it can refuse to emit a short one*. `?format=json`
    // is a branch below a single `exportRows()` call for that reason, and if anyone
    // ever moves the branch above it, this is what says so.
    await weighAWeek({ mapped: false });
    const reporter = await asReporter();

    const csv = await reporter.get(`/api/report/export?week=${WEEK}`);
    const json = await reporter.get(`/api/report/export?week=${WEEK}&format=json`);

    expect(csv.status).toBe(409);
    expect(json.status).toBe(409);
    expect(json.status).toBe(csv.status);
    // The same sentence, not merely the same code: the screen shows the server's
    // own words (§6), so a second refusal with different wording would be a second
    // explanation of one rule.
    expect(json.body.message).toMatch(/not matched/i);
    expect(json.body.message).toBe(csv.body.message);
  });

  it('carries the same rows, in the same order, once the week is exportable', async () => {
    await weighAWeek({ mapped: true });
    const reporter = await asReporter();

    const csv = await reporter.get(`/api/report/export?week=${WEEK}`);
    const json = await reporter.get(`/api/report/export?week=${WEEK}&format=json`);

    expect(csv.status).toBe(200);
    expect(json.status).toBe(200);
    expect(json.body.weekStart).toBe('2026-08-03');
    expect(json.body.weekEnd).toBe('2026-08-09');
    expect(json.body.columns).toEqual([...EXPORT_COLUMNS]);

    // D13's grain and order: one row per line item, `Receipt Items` and `Receipt
    // Total (lb)` repeated on every row of a receipt, and no `NTFB Code`.
    expect(json.body.rows).toHaveLength(1);
    expect(json.body.rows[0]).toMatchObject({
      day: '2026-08-04',
      ntfbCategory: 'Produce',
      storage: 'Refrigeration',
      agfpCategory: 'Produce',
      weightLb: '70.00',
      receiptItems: '1',
      receiptTotal: '70.00',
    });

    // And the same values in the same column positions. The failure this catches is
    // a field added to one output and not the other, which shifts every value right
    // of it into a neighbouring column — a corruption nothing downstream would
    // notice, because every cell still holds a plausible value.
    const fromCsv = csvCells(csv.text);
    const fromJson = json.body.rows.map((row: Record<string, string>) => [
      row['day'],
      row['donor'],
      row['donorCode'],
      row['ntfbCategory'],
      row['storage'],
      row['agfpCategory'],
      row['weightLb'],
      row['receiptItems'],
      row['receiptTotal'],
    ]);
    expect(fromCsv).toEqual(fromJson);
    expect(fromCsv[0]).toHaveLength(EXPORT_COLUMNS.length);
  });

  it('still answers a CSV to a caller that asks for no format', async () => {
    // `format` is an addition, not a replacement (D16): the file stays, and a
    // Reporter who prefers the spreadsheet keeps it.
    await weighAWeek({ mapped: true });
    const reporter = await asReporter();

    const csv = await reporter.get(`/api/report/export?week=${WEEK}`);
    expect(csv.status).toBe(200);
    expect(csv.text.startsWith(`"${EXPORT_COLUMNS[0]}"`)).toBe(true);
  });

  it('treats an unrecognised format as the file, never as an error', async () => {
    // Nothing in the app sends one, so this is about a stale bookmark or a typed
    // URL. Answering a 400 would turn a harmless query parameter into a dead end.
    await weighAWeek({ mapped: true });
    const reporter = await asReporter();

    const odd = await reporter.get(`/api/report/export?week=${WEEK}&format=pdf`);
    expect(odd.status).toBe(200);
    expect(odd.text.startsWith(`"${EXPORT_COLUMNS[0]}"`)).toBe(true);
  });
});
