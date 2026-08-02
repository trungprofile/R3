// The store photo (D20) — the service rule, and the two endpoints that carry it.
//
// Against the MIGRATED database, because the things this file is actually about
// exist only as real DDL: `donor_photo_size`, the `mime` CHECK, the PRIMARY KEY
// that makes a replacement an UPSERT, and the `ON DELETE RESTRICT` that decides
// whether `removeDonor`'s hard-delete escape hatch still works once a donor has a
// photograph attached to it.
//
// The split between the two halves below is `architecture.md §4.1`'s:
//
//   - WHAT COUNTS AS A PHOTO is a domain rule, so it is tested against
//     `services/donor.ts` directly. Size and mime are checked there to produce a
//     readable refusal; the CHECK constraints behind them are the guard that
//     cannot be bypassed, and the last test in that block proves the service is
//     the only thing standing between a caller and a 500.
//   - WHO MAY DO IT is the route's declaration, so it is tested over real HTTP
//     through the genuine default-deny gate (§4.3).

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/index.js';
import { attachActor } from '../src/middleware/auth.js';
import { errorHandler } from '../src/middleware/error.js';
import { authRoutes } from '../src/routes/auth.js';
import { donorRoutes } from '../src/routes/donors.js';
import { buildRouter } from '../src/routes/registry.js';
import { resetLoginThrottle } from '../src/services/auth.js';
import {
  getDonor,
  getDonorPhoto,
  listDonors,
  removeDonor,
  setDonorPhoto,
} from '../src/services/donor.js';
import { createUser, setCredential } from '../src/services/user.js';
import { makeAdmin, makeDonor, makeRoute, resetDatabase } from './fixtures.js';

/** `donor_photo_size`'s ceiling (migration 0014). */
const MAX_PHOTO_BYTES = 400_000;

/** A photo of `size` bytes, as the data URL the wire carries. The service checks
 *  the DECLARED mime and never sniffs the content, so filler bytes are the honest
 *  fixture: a real JPEG would suggest a validation this code does not do. */
function dataUrl(mime: string, size: number, fill = 0xab): string {
  return `data:${mime};base64,${Buffer.alloc(size, fill).toString('base64')}`;
}

async function photoRowCount(donorId: string): Promise<number> {
  const rows = await db
    .selectFrom('donor_photo')
    .select('donor_id')
    .where('donor_id', '=', donorId)
    .execute();
  return rows.length;
}

// ---------------------------------------------------------------------------
// What counts as a photo (`services/donor.ts`)
// ---------------------------------------------------------------------------

describe('setDonorPhoto — the refusals exist to be readable', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('refuses more than 400 KB, and stores nothing', async () => {
    const donor = await makeDonor();

    await expect(
      setDonorPhoto(donor.id, dataUrl('image/jpeg', MAX_PHOTO_BYTES + 1)),
    ).rejects.toMatchObject({
      status: 400,
      // §6: plain, and it says the number, which is the one thing the admin
      // cannot work out by looking at the screen.
      message: expect.stringContaining('400 KB'),
    });

    expect(await photoRowCount(donor.id)).toBe(0);
  });

  it('accepts the byte immediately under the ceiling', async () => {
    // The boundary in the CHECK is inclusive (`BETWEEN 1 AND 400000`), so the
    // service must not be off by one against it.
    const donor = await makeDonor();
    await setDonorPhoto(donor.id, dataUrl('image/jpeg', MAX_PHOTO_BYTES));

    const photo = await getDonorPhoto(donor.id);
    expect(photo?.bytes.length).toBe(MAX_PHOTO_BYTES);
  });

  it('refuses a mime the column would not store either', async () => {
    const donor = await makeDonor();

    for (const mime of ['image/gif', 'image/svg+xml', 'application/pdf', 'text/plain']) {
      await expect(setDonorPhoto(donor.id, dataUrl(mime, 32))).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/JPEG or a PNG/),
      });
    }

    expect(await photoRowCount(donor.id)).toBe(0);
  });

  it('refuses something that is not a data URL at all', async () => {
    const donor = await makeDonor();

    for (const junk of ['', 'https://example.com/door.jpg', 'data:image/jpeg,notbase64']) {
      await expect(setDonorPhoto(donor.id, junk)).rejects.toMatchObject({ status: 400 });
    }
  });

  it('refuses an empty photo, which the CHECK also refuses', async () => {
    const donor = await makeDonor();
    await expect(setDonorPhoto(donor.id, 'data:image/jpeg;base64,')).rejects.toMatchObject({
      status: 400,
    });
  });

  it('is the only thing between a caller and a constraint violation', async () => {
    // The point of the two blocks above, stated once: strip the service's checks
    // and these same inputs land on `donor_photo_size` / the `mime` CHECK, which
    // `errorHandler` has no choice but to report as a 500 with a correlation id
    // (§5.5). Tier 1 is still the guard; tier 3 is what makes it sayable.
    const donor = await makeDonor();
    await expect(
      db
        .insertInto('donor_photo')
        .values({ donor_id: donor.id, bytes: Buffer.alloc(1), mime: 'image/gif' })
        .execute(),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('refuses a donor that does not exist', async () => {
    await expect(
      setDonorPhoto('00000000-0000-0000-0000-000000000000', dataUrl('image/png', 16)),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('setDonorPhoto — storing, replacing, clearing', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('stores the bytes and the mime the browser will need', async () => {
    const donor = await makeDonor();
    const updated = await setDonorPhoto(donor.id, dataUrl('image/png', 64, 0x11));

    expect(updated.has_photo).toBe(true);

    const photo = await getDonorPhoto(donor.id);
    expect(photo?.mime).toBe('image/png');
    expect(photo?.bytes.equals(Buffer.alloc(64, 0x11))).toBe(true);
  });

  it('replaces rather than accumulates', async () => {
    // `donor_id` is the PRIMARY KEY and the write is an UPSERT, so a store whose
    // door changed has one photo, not two.
    const donor = await makeDonor();
    await setDonorPhoto(donor.id, dataUrl('image/jpeg', 64, 0x11));
    const first = await getDonorPhoto(donor.id);

    await setDonorPhoto(donor.id, dataUrl('image/png', 128, 0x22));
    const second = await getDonorPhoto(donor.id);

    expect(await photoRowCount(donor.id)).toBe(1);
    expect(second?.mime).toBe('image/png');
    expect(second?.bytes.equals(Buffer.alloc(128, 0x22))).toBe(true);
    expect(second!.updatedAt.getTime()).toBeGreaterThanOrEqual(first!.updatedAt.getTime());
  });

  it('clears on null, and clearing nothing is not an error', async () => {
    const donor = await makeDonor();
    await setDonorPhoto(donor.id, dataUrl('image/jpeg', 64));

    expect((await setDonorPhoto(donor.id, null)).has_photo).toBe(false);
    expect(await getDonorPhoto(donor.id)).toBeUndefined();

    // Idempotent: clearing a store that never had one leaves it as it was.
    expect((await setDonorPhoto(donor.id, null)).has_photo).toBe(false);
  });

  it('flips has_photo everywhere a donor is read, and never carries the bytes', async () => {
    const donor = await makeDonor();
    expect((await getDonor(donor.id))?.has_photo).toBe(false);

    await setDonorPhoto(donor.id, dataUrl('image/jpeg', 64));

    const one = await getDonor(donor.id);
    expect(one?.has_photo).toBe(true);
    // D20 — the whole reason the bytes live in their own table. A donor read must
    // stay the size of a donor.
    expect(one).not.toHaveProperty('bytes');

    const listed = (await listDonors()).find((row) => row.id === donor.id);
    expect(listed?.has_photo).toBe(true);
    expect(listed).not.toHaveProperty('bytes');
  });
});

describe('I21 — a photo does not make a donor undeletable', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('hard-deletes a mistaken donor that has a photo', async () => {
    // The RESTRICT interaction, which is the whole reason `removeDonor` clears
    // `donor_photo` inside its own transaction (migration 0014). Every FK in this
    // schema is `ON DELETE RESTRICT` (`data-model.md §0`) and a photo is no
    // exception, so without that DELETE the escape hatch for a mistyped store
    // would fail with a 23503 the admin cannot do anything about.
    const donor = await makeDonor();
    await setDonorPhoto(donor.id, dataUrl('image/jpeg', 64));

    expect(await removeDonor(donor.id)).toBe('DELETED');
    expect(await getDonor(donor.id)).toBeUndefined();
    expect(await photoRowCount(donor.id)).toBe(0);
  });

  it('still soft-deletes one with history, photo and all', async () => {
    // A photo is not history — `donorHasHistory` deliberately does not probe for
    // it — so the branch is decided by the run, exactly as it is without one.
    const donorId = (await makeRoute(1)).donors[0]!.id;
    await setDonorPhoto(donorId, dataUrl('image/jpeg', 64));

    expect(await removeDonor(donorId)).toBe('DEACTIVATED');

    const after = await getDonor(donorId);
    expect(after?.deactivated_at).not.toBeNull();
    // Deactivated, not gone: the driver reading last month's run still sees the
    // door they were looking for.
    expect(after?.has_photo).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Who may do it (`architecture.md §4.3`), over real HTTP
// ---------------------------------------------------------------------------

function client(base: string) {
  const jar = new Map<string, string>();

  function cookies(): Record<string, string> {
    if (jar.size === 0) return {};
    return { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') };
  }

  function keep(res: Awaited<ReturnType<typeof fetch>>): void {
    for (const raw of res.headers.getSetCookie()) {
      const pair = raw.split(';')[0] ?? '';
      const eq = pair.indexOf('=');
      if (eq === -1) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1);
      if (value === '') jar.delete(name);
      else jar.set(name, value);
    }
  }

  async function json(
    method: string,
    path: string,
    payload?: unknown,
  ): Promise<{ status: number; body: any }> {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...cookies(),
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    keep(res);
    const text = await res.text();
    return { status: res.status, body: text.length > 0 ? JSON.parse(text) : null };
  }

  return {
    json,
    post: (path: string, payload?: unknown) => json('POST', path, payload ?? {}),
    put: (path: string, payload?: unknown) => json('PUT', path, payload ?? {}),
    del: (path: string) => json('DELETE', path),
    /** The photo endpoint answers bytes, not JSON, so it needs its own reader. */
    async bytes(path: string) {
      const res = await fetch(base + path, { headers: cookies() });
      keep(res);
      return {
        status: res.status,
        contentType: res.headers.get('content-type'),
        cacheControl: res.headers.get('cache-control'),
        body: Buffer.from(await res.arrayBuffer()),
      };
    },
  };
}

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  // The same cap the mounted app sets (`src/index.ts`). Kept identical on purpose
  // so nothing here passes on a limit production does not have. It reads 600kb
  // rather than the old 64kb because a base64 photo at the schema's 400 KB
  // ceiling needs ~533 KB of body: at 64kb `express.json` refused every real
  // upload before the handler ran, and the service's readable size refusal was
  // unreachable. The oversize case is still asserted at the service level, so
  // this cap is not what proves it.
  app.use(express.json({ limit: '600kb' }));
  app.use('/api', attachActor, buildRouter([...authRoutes, ...donorRoutes]));
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

async function asDriver() {
  const driver = await createUser({
    firstName: 'Karen',
    lastName: 'Driver',
    tier: 'VOLUNTEER',
    duties: ['DRIVE'],
    credential: '1234',
  });
  return signIn(driver.user.username, '1234');
}

describe('the photo endpoints', () => {
  it('serves the bytes to any signed-in user — the driver is the point', async () => {
    const donor = await makeDonor();
    const admin = await asAdmin();

    const set = await admin.put(`/api/donors/${donor.id}/photo`, {
      dataUrl: dataUrl('image/png', 48, 0x33),
    });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(set.body).toMatchObject({ id: donor.id, hasPhoto: true });

    const driver = await asDriver();
    const got = await driver.bytes(`/api/donors/${donor.id}/photo`);

    expect(got.status).toBe(200);
    expect(got.contentType).toContain('image/png');
    expect(got.body.equals(Buffer.alloc(48, 0x33))).toBe(true);
    // Long and private: cached on the phone that will re-read it at the next
    // stop, and never in anything shared, because it sits behind a session.
    expect(got.cacheControl).toContain('private');
    expect(got.cacheControl).toMatch(/max-age=\d{4,}/);
  });

  it('404s when the store has no photo', async () => {
    const donor = await makeDonor();
    const driver = await asDriver();

    const got = await driver.bytes(`/api/donors/${donor.id}/photo`);
    expect(got.status).toBe(404);
  });

  it('clears with null and answers with the flag, not the bytes', async () => {
    const donor = await makeDonor();
    const admin = await asAdmin();

    await admin.put(`/api/donors/${donor.id}/photo`, { dataUrl: dataUrl('image/jpeg', 48) });
    const cleared = await admin.put(`/api/donors/${donor.id}/photo`, { dataUrl: null });

    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({ hasPhoto: false });
    expect(cleared.body).not.toHaveProperty('dataUrl');

    const driver = await asDriver();
    expect((await driver.bytes(`/api/donors/${donor.id}/photo`)).status).toBe(404);
  });

  it('insists the field is present, because absent is not null', async () => {
    const donor = await makeDonor();
    const admin = await asAdmin();

    const res = await admin.put(`/api/donors/${donor.id}/photo`, {});
    expect(res.status).toBe(400);
  });

  it('turns the service refusal into a 400 an admin can read', async () => {
    const donor = await makeDonor();
    const admin = await asAdmin();

    const res = await admin.put(`/api/donors/${donor.id}/photo`, {
      dataUrl: dataUrl('image/gif', 32),
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/JPEG or a PNG/);
    expect(res.body).not.toHaveProperty('correlationId');
  });

  it('is Admin-only to write, like every other donor write', async () => {
    const donor = await makeDonor();
    const driver = await asDriver();

    const res = await driver.put(`/api/donors/${donor.id}/photo`, {
      dataUrl: dataUrl('image/jpeg', 32),
    });
    expect(res.status).toBe(403);
    expect(await photoRowCount(donor.id)).toBe(0);
  });

  it('rejects an undeclared method on the photo path (§4.3)', async () => {
    // No DELETE is declared here — clearing is `PUT { dataUrl: null }`. The gate
    // refuses it from the declaration table, before any handler runs.
    const donor = await makeDonor();
    const admin = await asAdmin();

    const res = await admin.del(`/api/donors/${donor.id}/photo`);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'UNDECLARED_ROUTE' });
  });
});
