// Credentials and brute-force defense (`architecture.md §4.2`).
//
// Against the migrated database, like everything else: `login` opens a real
// SERIALIZABLE transaction and writes a real session row, and a mock would prove
// nothing about either.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/index.js';
import {
  assertCredentialShape,
  defaultPin,
  hashCredential,
  login,
  resetLoginThrottle,
  verifyCredential,
} from '../src/services/auth.js';
import { createUser } from '../src/services/user.js';
import { resetDatabase } from './fixtures.js';

beforeEach(async () => {
  await resetDatabase();
  resetLoginThrottle();
});

afterAll(async () => {
  await db.destroy();
  await pool.end().catch(() => undefined);
});

const IP = '203.0.113.7';

async function makeVolunteer(pin = '1234', first = 'Val', last = 'Unteer') {
  const created = await createUser({
    firstName: first,
    lastName: last,
    tier: 'VOLUNTEER',
    duties: ['DRIVE'],
    phone: '5550001111',
    credential: pin,
  });
  return created.user;
}

describe('credential hashing', () => {
  it('round-trips through scrypt and rejects the wrong secret', async () => {
    const hash = await hashCredential('4821');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(hash).not.toContain('4821');
    expect(await verifyCredential(hash, '4821')).toBe(true);
    expect(await verifyCredential(hash, '4822')).toBe(false);
  });

  it('salts, so two accounts with the same PIN do not share a hash', async () => {
    // PINs are not unique and uniqueness is never checked (§4.2). Equal hashes
    // would leak that two volunteers picked the same one.
    expect(await hashCredential('1234')).not.toBe(await hashCredential('1234'));
  });

  it('returns false rather than throwing on a hash it cannot parse', async () => {
    expect(await verifyCredential('fixture-not-a-real-hash', '1234')).toBe(false);
    expect(await verifyCredential('', '1234')).toBe(false);
  });
});

describe('credential shape', () => {
  it('takes the last four digits of the phone as the default PIN', () => {
    expect(defaultPin('(555) 123-4567')).toBe('4567');
  });

  it('falls back to four random digits with no phone on file', () => {
    expect(defaultPin(null)).toMatch(/^\d{4}$/);
    expect(defaultPin('')).toMatch(/^\d{4}$/);
  });

  it('holds a volunteer to exactly four digits', () => {
    expect(() => assertCredentialShape('VOLUNTEER', '1234')).not.toThrow();
    expect(() => assertCredentialShape('VOLUNTEER', '123')).toThrow(/4 digits/);
    expect(() => assertCredentialShape('VOLUNTEER', '12345')).toThrow(/4 digits/);
    expect(() => assertCredentialShape('VOLUNTEER', 'abcd')).toThrow(/4 digits/);
  });

  it('holds staff and admin to a password, not a PIN', () => {
    // The split exists because Staff/Admin accounts are worth more (§4.2); a
    // 4-digit "password" would quietly undo that.
    expect(() => assertCredentialShape('STAFF', '1234')).toThrow(/at least/);
    expect(() => assertCredentialShape('ADMIN', 'short')).toThrow(/at least/);
    expect(() => assertCredentialShape('STAFF', 'correct-horse')).not.toThrow();
  });
});

describe('login', () => {
  it('opens a session on the right credential', async () => {
    const user = await makeVolunteer('4321');
    const result = await login({
      username: user.username,
      credential: '4321',
      deviceId: null,
      clientIp: IP,
    });

    expect(result.user.id).toBe(user.id);
    expect(result.duties).toEqual(['DRIVE']);
    expect(result.sharedDevice).toBe(false);

    const stored = await db
      .selectFrom('session')
      .selectAll()
      .where('id', '=', result.sessionId)
      .executeTakeFirstOrThrow();
    expect(stored.user_id).toBe(user.id);
    expect(stored.device_id).toBeNull();
  });

  it('refuses a deactivated account (I21)', async () => {
    const user = await makeVolunteer('4321', 'Gone', 'Away');
    await db
      .updateTable('app_user')
      .set({ deactivated_at: new Date() })
      .where('id', '=', user.id)
      .execute();

    // Indistinguishable from a wrong PIN, and the username stays reserved (I3):
    // the account did not disappear, it stopped working.
    await expect(
      login({ username: user.username, credential: '4321', deviceId: null, clientIp: IP }),
    ).rejects.toMatchObject({ status: 401, code: 'INVALID_CREDENTIAL' });
  });

  it('counts down tries and then soft-locks the account', async () => {
    const user = await makeVolunteer('4321');

    // `ui-ux-spec.md S1.1`: the first wrong PIN reports "3 tries left".
    for (const expected of [3, 2, 1]) {
      await expect(
        login({ username: user.username, credential: '0000', deviceId: null, clientIp: IP }),
      ).rejects.toMatchObject({ status: 401, details: { triesLeft: expected } });
    }

    await expect(
      login({ username: user.username, credential: '0000', deviceId: null, clientIp: IP }),
    ).rejects.toMatchObject({ status: 429, code: 'LOCKED' });

    // The lock holds even against the CORRECT credential — it is a lock on the
    // account, not on the guess.
    await expect(
      login({ username: user.username, credential: '4321', deviceId: null, clientIp: IP }),
    ).rejects.toMatchObject({ status: 429, code: 'LOCKED' });
  }, 30_000);

  it('does not extend the lock when someone keeps trying', async () => {
    const user = await makeVolunteer('4321');
    const now = new Date('2026-07-28T12:00:00Z');
    const attempt = async (
      at: Date,
    ): Promise<{ details?: { retryAfterSeconds?: number } } | undefined> => {
      try {
        await login({
          username: user.username,
          credential: '0000',
          deviceId: null,
          clientIp: IP,
          now: at,
        });
        return undefined;
      } catch (err) {
        return err as { details?: { retryAfterSeconds?: number } };
      }
    };

    for (let i = 0; i < 4; i++) await attempt(now);

    const first = await attempt(new Date(now.getTime() + 60_000));
    const later = await attempt(new Date(now.getTime() + 120_000));

    // Same deadline, so the second attempt bought the attacker nothing and cost
    // the confused volunteer nothing.
    expect(first?.details?.retryAfterSeconds).toBe(14 * 60);
    expect(later?.details?.retryAfterSeconds).toBe(13 * 60);
  }, 30_000);

  it('clears the account counter after a clean login', async () => {
    const user = await makeVolunteer('4321');

    await expect(
      login({ username: user.username, credential: '0000', deviceId: null, clientIp: IP }),
    ).rejects.toMatchObject({ details: { triesLeft: 3 } });

    await login({ username: user.username, credential: '4321', deviceId: null, clientIp: IP });

    await expect(
      login({ username: user.username, credential: '0000', deviceId: null, clientIp: IP }),
    ).rejects.toMatchObject({ details: { triesLeft: 3 } });
  }, 30_000);

  it('locks a spraying IP that never trips any one account (§4.2)', async () => {
    // The roster is public, so one likely PIN can be tried against every account.
    // Each account records a single failure, which per-account counting cannot
    // see — this is what the second counter is for.
    const user = await makeVolunteer('4321');

    for (let i = 0; i < 20; i++) {
      await expect(
        login({
          username: `nobody${i}`,
          credential: '1234',
          deviceId: null,
          clientIp: '198.51.100.9',
        }),
      ).rejects.toMatchObject({ status: 401 });
    }

    await expect(
      login({
        username: user.username,
        credential: '4321',
        deviceId: null,
        clientIp: '198.51.100.9',
      }),
    ).rejects.toMatchObject({ status: 429, code: 'LOCKED' });

    // A different address is unaffected: the lock is on the sprayer, not the app.
    const ok = await login({
      username: user.username,
      credential: '4321',
      deviceId: null,
      clientIp: '203.0.113.99',
    });
    expect(ok.sessionId).toBeTruthy();
  }, 30_000);
});
