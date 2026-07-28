// Accounts: username generation (`domain-modeling.md §5.1`), tier/duty assignment,
// and removal under I21.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/index.js';
import { login, resetLoginThrottle, verifyCredential } from '../src/services/auth.js';
import {
  createUser,
  listUsers,
  normalizeNamePart,
  removeUser,
  setCredential,
  updateUser,
  usernameBase,
} from '../src/services/user.js';
import { makeAdmin, makeShift, makeUser, resetDatabase } from './fixtures.js';

beforeEach(async () => {
  await resetDatabase();
  resetLoginThrottle();
});

afterAll(async () => {
  await db.destroy();
  await pool.end().catch(() => undefined);
});

const IP = '203.0.113.11';

async function volunteer(first: string, last: string, credential = '1234') {
  return createUser({ firstName: first, lastName: last, tier: 'VOLUNTEER', credential });
}

describe('normalize (§5.1)', () => {
  it('strips diacritics, case, and punctuation', () => {
    expect(normalizeNamePart('José')).toBe('jose');
    expect(normalizeNamePart("O'Brien-Núñez")).toBe('obriennunez');
    expect(normalizeNamePart('  Mary Anne ')).toBe('maryanne');
  });

  it('falls back to "user" when nothing survives', () => {
    expect(usernameBase('...', '!!!')).toBe('user');
    expect(usernameBase('林', '安')).toBe('user');
  });
});

describe('generate_username', () => {
  it('assembles first + last', async () => {
    const created = await volunteer('John', 'Smith');
    expect(created.user.username).toBe('johnsmith');
  });

  it('suffixes in creation order, checking the FULL assembled string', async () => {
    expect((await volunteer('John', 'Smith')).user.username).toBe('johnsmith');
    expect((await volunteer('John', 'Smith')).user.username).toBe('johnsmith2');
    expect((await volunteer('John', 'Smith')).user.username).toBe('johnsmith3');
  });

  it('shares the namespace with a literal collision', async () => {
    // If `johnsmith2` already exists — literally, not generated — the next John
    // Smith becomes `johnsmith3`. The suffix is not a private counter.
    await makeUser({ firstName: 'John', lastName: 'Smith' });
    await db
      .updateTable('app_user')
      .set({ username: 'johnsmith2' })
      .where('username', 'like', 'fixture%')
      .execute();
    await volunteer('John', 'Smith'); // takes johnsmith
    expect((await volunteer('John', 'Smith')).user.username).toBe('johnsmith3');
  });

  it('keeps a deactivated user\'s handle reserved (I3)', async () => {
    const first = await volunteer('Jane', 'Doe');
    // Give the account history so removal must soft-delete.
    await makeShift({ createdBy: first.user.id });
    expect(await removeUser(first.user.id)).toBe('DEACTIVATED');

    // No reuse, no renumber.
    expect((await volunteer('Jane', 'Doe')).user.username).toBe('janedoe2');
  });

  it('frees the handle of a hard-deleted zero-history account', async () => {
    const first = await volunteer('Zero', 'History');
    expect(await removeUser(first.user.id)).toBe('DELETED');
    expect((await volunteer('Zero', 'History')).user.username).toBe('zerohistory');
  });
});

describe('create', () => {
  it('defaults a volunteer PIN to the last four of the phone (§4.2)', async () => {
    const created = await createUser({
      firstName: 'Dee',
      lastName: 'Fault',
      tier: 'VOLUNTEER',
      phone: '(555) 123-9876',
    });
    expect(created.generatedCredential).toBeUndefined();

    const session = await login({
      username: created.user.username,
      credential: '9876',
      deviceId: null,
      clientIp: IP,
    });
    expect(session.sessionId).toBeTruthy();
  });

  it('reports the random PIN it generated when no phone is on file', async () => {
    const created = await createUser({
      firstName: 'No',
      lastName: 'Phone',
      tier: 'VOLUNTEER',
    });
    expect(created.generatedCredential).toMatch(/^\d{4}$/);

    const session = await login({
      username: created.user.username,
      credential: created.generatedCredential!,
      deviceId: null,
      clientIp: IP,
    });
    expect(session.sessionId).toBeTruthy();
  });

  it('will not invent a staff password', async () => {
    await expect(
      createUser({ firstName: 'Stan', lastName: 'Ley', tier: 'STAFF' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('assigns 0..3 duties and collapses duplicates (I2)', async () => {
    const created = await createUser({
      firstName: 'Multi',
      lastName: 'Duty',
      tier: 'VOLUNTEER',
      duties: ['DRIVE', 'RECEIVE', 'DRIVE'],
      credential: '1234',
    });
    expect(created.duties.sort()).toEqual(['DRIVE', 'RECEIVE']);

    const stored = await db
      .selectFrom('user_duty')
      .select('duty')
      .where('user_id', '=', created.user.id)
      .execute();
    expect(stored).toHaveLength(2);
  });

  it('does not mint an admin account (`product-requirement.md` cap 1)', async () => {
    await expect(
      createUser({
        firstName: 'Root',
        lastName: 'User',
        tier: 'ADMIN',
        credential: 'correct-horse',
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('stores a hash, never the credential', async () => {
    const created = await volunteer('Hash', 'Only', '4444');
    const row = await db
      .selectFrom('app_user')
      .select('credential_hash')
      .where('id', '=', created.user.id)
      .executeTakeFirstOrThrow();

    expect(row.credential_hash).not.toContain('4444');
    expect(await verifyCredential(row.credential_hash, '4444')).toBe(true);
  });
});

describe('update', () => {
  it('never changes the username, even when the name changes (I3)', async () => {
    const created = await volunteer('Ann', 'Old');
    const updated = await updateUser(created.user.id, { lastName: 'New' });

    expect(updated.user.last_name).toBe('New');
    expect(updated.user.username).toBe('annold');
  });

  it('replaces the duty set rather than adding to it (I2)', async () => {
    const created = await createUser({
      firstName: 'Switch',
      lastName: 'Duty',
      tier: 'VOLUNTEER',
      duties: ['DRIVE'],
      credential: '1234',
    });
    const updated = await updateUser(created.user.id, { duties: ['REPORT'] });
    expect(updated.duties).toEqual(['REPORT']);
  });

  it('requires a password when promoting a volunteer to staff', async () => {
    const created = await volunteer('Pro', 'Motion');
    await expect(
      updateUser(created.user.id, { tier: 'STAFF' }),
    ).rejects.toMatchObject({ status: 400 });

    const updated = await updateUser(created.user.id, {
      tier: 'STAFF',
      credential: 'a-real-password',
    });
    expect(updated.user.tier).toBe('STAFF');

    const session = await login({
      username: updated.user.username,
      credential: 'a-real-password',
      deviceId: null,
      clientIp: IP,
    });
    expect(session.sessionId).toBeTruthy();
  });

  it('reaches ADMIN by promotion, which is the only path to one', async () => {
    const created = await volunteer('Pro', 'Moted');
    const updated = await updateUser(created.user.id, {
      tier: 'ADMIN',
      credential: 'a-real-password',
    });
    expect(updated.user.tier).toBe('ADMIN');
  });

  it('holds a reset credential to the account\'s current tier', async () => {
    const created = await volunteer('Res', 'Et');
    await expect(setCredential(created.user.id, 'abcd')).rejects.toMatchObject({
      status: 400,
    });
    await setCredential(created.user.id, '9999');

    const session = await login({
      username: created.user.username,
      credential: '9999',
      deviceId: null,
      clientIp: IP,
    });
    expect(session.sessionId).toBeTruthy();
  });
});

describe('remove (I21)', () => {
  it('hard-deletes an account with no referencing history', async () => {
    const created = await volunteer('Mist', 'Ake');
    expect(await removeUser(created.user.id)).toBe('DELETED');
    expect(await listUsers()).toHaveLength(0);
  });

  it('soft-deletes an account that owns a shift', async () => {
    const created = await volunteer('Has', 'History');
    await makeShift({ status: 'CLAIMED', ownerId: created.user.id });

    expect(await removeUser(created.user.id)).toBe('DEACTIVATED');
    const row = await db
      .selectFrom('app_user')
      .select(['username', 'deactivated_at'])
      .where('id', '=', created.user.id)
      .executeTakeFirstOrThrow();
    expect(row.deactivated_at).not.toBeNull();
    expect(row.username).toBe('hashistory'); // preserved everywhere referenced
  });

  it('soft-deletes an account that only left a provenance stamp', async () => {
    const created = await volunteer('Stamp', 'Only');
    await makeShift({ createdBy: created.user.id });
    expect(await removeUser(created.user.id)).toBe('DEACTIVATED');
  });

  it('soft-deletes an account with an availability block', async () => {
    const created = await volunteer('Avail', 'Able');
    await db
      .insertInto('availability_block')
      .values({
        user_id: created.user.id,
        starts_at: new Date('2026-08-01T10:00:00Z'),
        ends_at: new Date('2026-08-01T12:00:00Z'),
      })
      .execute();
    expect(await removeUser(created.user.id)).toBe('DEACTIVATED');
  });

  it('soft-deletes an account holding a push subscription', async () => {
    const created = await volunteer('Push', 'Holder');
    await db
      .insertInto('push_subscription')
      .values({
        user_id: created.user.id,
        endpoint: 'https://push.example/one',
        p256dh: 'k',
        auth: 'a',
      })
      .execute();
    expect(await removeUser(created.user.id)).toBe('DEACTIVATED');
  });

  it('ends every session of the removed account', async () => {
    const created = await volunteer('Sign', 'Out');
    const session = await login({
      username: created.user.username,
      credential: '1234',
      deviceId: null,
      clientIp: IP,
    });

    await removeUser(created.user.id);
    const rows = await db
      .selectFrom('session')
      .select('id')
      .where('id', '=', session.sessionId)
      .execute();
    expect(rows).toHaveLength(0);
  });

  it('refuses to remove an admin account', async () => {
    const admin = await makeAdmin();
    await expect(removeUser(admin.id)).rejects.toMatchObject({ status: 403 });
  });
});
