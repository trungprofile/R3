// Credentials and login (`architecture.md §4.2`).
//
// Volunteers use a 4-digit PIN, Staff/Admin a password. The split is a UI
// constraint (`ui-ux-spec.md §1` principle 5 requires a large numeric keypad, and
// a password on a keypad is unusable for the target users), not a security
// judgement. A 4-digit space cannot be made strong by hashing: the hash limits
// damage from database disclosure, and THROTTLING limits online guessing. Both
// halves live in this file because they are one operation — the throttle is
// checked before the credential comparison, never after.
//
// scrypt from `node:crypto`. No dependency is added for this
// (`phase-1-build-plan.md §3`), and a memory-hard KDF in the standard library is
// exactly the "slow KDF" §4.2 asks for.

import { randomInt, scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { credentialKindFor, MIN_PASSWORD_LENGTH, PIN_LENGTH } from '../../../shared/src/index.js';
import { writeTransaction } from '../db/transaction.js';
import type { Duty, Tier } from '../db/types.js';
import { AppError, badRequest } from '../middleware/error.js';
import { createSessionIn } from './session.js';
import type { UserRecord } from '../pii.js';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

// Cost parameters. N=16384 keeps one hash near 50-100 ms on the pantry's box —
// slow enough to matter against an offline attack on a 4-digit space, fast enough
// that a login on the shared tablet feels instant.
const SCRYPT = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

/** `scrypt$N$r$p$salt$key`, all base64url. Self-describing so the cost parameters
 *  can be raised later without invalidating existing hashes. */
export async function hashCredential(plaintext: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await scryptAsync(plaintext, salt, KEY_LENGTH, SCRYPT);
  return [
    'scrypt',
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

/** Constant-time comparison. Returns false — never throws — on a malformed or
 *  placeholder hash, so a bad row cannot become a 500 on the login screen. */
export async function verifyCredential(
  stored: string,
  supplied: string,
): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  const salt = Buffer.from(parts[4]!, 'base64url');
  const expected = Buffer.from(parts[5]!, 'base64url');
  if (salt.length === 0 || expected.length === 0) return false;

  const actual = await scryptAsync(supplied, salt, expected.length, {
    N,
    r,
    p,
    maxmem: SCRYPT.maxmem,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * A credential must match the shape its tier logs in with. Rejecting a 4-digit
 * "password" for a Staff account is the point: §4.2 gives Staff/Admin a real
 * password because those accounts are worth more, and a tier promotion that
 * silently kept a PIN would quietly undo that.
 */
export function assertCredentialShape(tier: Tier, credential: string): void {
  if (credentialKindFor(tier) === 'PIN') {
    if (!new RegExp(`^\\d{${PIN_LENGTH}}$`).test(credential)) {
      throw badRequest(`A volunteer PIN is exactly ${PIN_LENGTH} digits.`);
    }
    return;
  }
  if (credential.length < MIN_PASSWORD_LENGTH) {
    throw badRequest(
      `A staff password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  }
}

/**
 * The PIN an admin gets by default at account creation: the last four digits of
 * the volunteer's phone, or four random digits where no phone is on file (§4.2).
 * PINs are not unique and uniqueness is never checked — login is name-first, so
 * the account is identified before the PIN is compared.
 */
export function defaultPin(phone: string | null | undefined): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length >= PIN_LENGTH) return digits.slice(-PIN_LENGTH);
  return String(randomInt(0, 10 ** PIN_LENGTH)).padStart(PIN_LENGTH, '0');
}

// ---------------------------------------------------------------------------
// Brute-force defense (`architecture.md §4.2`)
//
// Two counters stopping two different attacks:
//   per account  repeated guessing against one volunteer
//   per client IP CREDENTIAL SPRAYING — the roster is published by design, so one
//                likely PIN can be tried against all ~40 accounts, each recording
//                a single failure. Per-account counting is structurally blind to it.
//
// Progressive delay plus a short auto-expiring soft lock, never a hard lockout:
// public names make hard lockout a trivial denial of service, and a bounded
// self-clearing lock guarantees a confused volunteer is never blocked on a human.
// There is no unlock action, and `ui-ux-spec.md S1.1`'s copy says so.
//
// State is in process memory, not a table: `server/migrations/` is Wave-0-owned
// and R3 runs as ONE process (§4.5), so there is no second reader to share it
// with. A restart clears the counters, which is a real weakening an attacker
// cannot trigger; sessions are in Postgres precisely because losing THEM on
// deploy is not acceptable, and losing a 15-minute lock is.
// ---------------------------------------------------------------------------

/** Account lock after this many failures. The first failure therefore reports
 *  "3 tries left", matching `ui-ux-spec.md S1.1`'s copy exactly. */
const ACCOUNT_MAX_FAILURES = 4;
/** Per-IP ceiling, sized for spraying across a ~40-account roster rather than for
 *  one account. The pantry's own users share an IP, so it cannot be small. */
const IP_MAX_FAILURES = 20;
const LOCK_MS = 15 * 60_000;
/** Failures older than this are forgotten, so the counters self-clear. */
const WINDOW_MS = 15 * 60_000;
const DELAY_BASE_MS = 250;
const DELAY_CAP_MS = 2_000;

interface Counter {
  failures: number;
  lastFailureAt: number;
  lockedUntil: number;
}

const accountCounters = new Map<string, Counter>();
const ipCounters = new Map<string, Counter>();

function currentCounter(store: Map<string, Counter>, key: string, now: number): Counter {
  const existing = store.get(key);
  if (!existing) return { failures: 0, lastFailureAt: 0, lockedUntil: 0 };
  if (existing.lockedUntil > now) return existing;
  // A lapsed lock or a stale window resets the count. This is the "self-clears"
  // half of the design: nobody has to intervene.
  if (existing.lockedUntil !== 0 || now - existing.lastFailureAt > WINDOW_MS) {
    store.delete(key);
    return { failures: 0, lastFailureAt: 0, lockedUntil: 0 };
  }
  return existing;
}

function recordFailure(
  store: Map<string, Counter>,
  key: string,
  now: number,
  max: number,
): Counter {
  const counter = currentCounter(store, key, now);
  counter.failures += 1;
  counter.lastFailureAt = now;
  if (counter.failures >= max) counter.lockedUntil = now + LOCK_MS;
  store.set(key, counter);
  return counter;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Test-only. The counters are module state and must not leak between cases. */
export function resetLoginThrottle(): void {
  accountCounters.clear();
  ipCounters.clear();
}

export interface LoginParams {
  username: string;
  credential: string;
  /** The registered device this browser claims to be, or null for personal. */
  deviceId: string | null;
  /** Real client IP — see §4.2's note on CF-Connecting-IP behind the tunnel. */
  clientIp: string;
  now?: Date;
}

export interface LoginResult {
  user: UserRecord;
  duties: Duty[];
  sessionId: string;
  expiresAt: Date;
  sharedDevice: boolean;
}

/**
 * Authenticate and open a session. One service function, one transaction
 * (`architecture.md §4.1`): the credential check and the session it produces are
 * one use case.
 *
 * The throttle is evaluated BEFORE the credential comparison. The UI's "3 tries
 * left" copy is communication, never enforcement — an attacker sends requests
 * directly and never loads the app.
 */
export async function login(params: LoginParams): Promise<LoginResult> {
  const now = params.now ?? new Date();
  const ts = now.getTime();
  const accountKey = params.username.toLowerCase();

  const account = currentCounter(accountCounters, accountKey, ts);
  const ip = currentCounter(ipCounters, params.clientIp, ts);
  const lockedUntil = Math.max(account.lockedUntil, ip.lockedUntil);

  if (lockedUntil > ts) {
    // Attempts during the lock do not extend it (`ui-ux-spec.md S1.1`), so no
    // failure is recorded here.
    logAuthFailure('locked', accountKey, params.clientIp);
    throw new AppError(429, 'LOCKED', 'Too many tries. Try again in 15 minutes.', {
      retryAfterSeconds: Math.ceil((lockedUntil - ts) / 1000),
    });
  }

  // Progressive delay, outside any transaction: never hold one open sleeping.
  if (account.failures > 0) {
    await sleep(Math.min(DELAY_BASE_MS * 2 ** (account.failures - 1), DELAY_CAP_MS));
  }

  const result = await writeTransaction(async (tx) => {
    // Explicit columns: the hash is read here and goes no further. Nothing outside
    // this transaction ever holds it.
    const user = await tx
      .selectFrom('app_user')
      .select([
        'id',
        'username',
        'first_name',
        'last_name',
        'tier',
        'phone',
        'address',
        'deactivated_at',
        'credential_hash',
      ])
      .where('username', '=', accountKey)
      .executeTakeFirst();

    // I21 — a deactivated account cannot log in. Its username stays reserved (I3),
    // which is why this is a state check and not a missing row.
    if (!user || user.deactivated_at !== null) return null;

    const ok = await verifyCredential(user.credential_hash, params.credential);
    if (!ok) return null;

    const session = await createSessionIn(tx, {
      userId: user.id,
      tier: user.tier,
      deviceId: params.deviceId,
      now,
    });

    const duties = await tx
      .selectFrom('user_duty')
      .select('duty')
      .where('user_id', '=', user.id)
      .execute();

    const { credential_hash: _hash, ...record } = user;
    return { user: record satisfies UserRecord, duties: duties.map((d) => d.duty), session };
  });

  if (!result) {
    const failed = recordFailure(accountCounters, accountKey, ts, ACCOUNT_MAX_FAILURES);
    recordFailure(ipCounters, params.clientIp, ts, IP_MAX_FAILURES);
    // §5.4 requires this log line: the account and the client IP, never the
    // credential.
    logAuthFailure('invalid_credential', accountKey, params.clientIp);

    if (failed.lockedUntil > ts) {
      throw new AppError(429, 'LOCKED', 'Too many tries. Try again in 15 minutes.', {
        retryAfterSeconds: Math.ceil((failed.lockedUntil - ts) / 1000),
      });
    }
    throw new AppError(401, 'INVALID_CREDENTIAL', 'That did not match. Try again.', {
      triesLeft: Math.max(0, ACCOUNT_MAX_FAILURES - failed.failures),
    });
  }

  // A clean login clears the account counter. The IP counter is deliberately NOT
  // cleared: a sprayer who owns one valid account would otherwise reset the very
  // counter that sees them. It expires on its own window instead.
  accountCounters.delete(accountKey);

  return {
    user: result.user,
    duties: result.duties,
    sessionId: result.session.id,
    expiresAt: result.session.expiresAt,
    sharedDevice: result.session.sharedDevice,
  };
}

function logAuthFailure(reason: string, account: string, clientIp: string): void {
  console.warn(
    JSON.stringify({ event: 'auth_failure', reason, account, clientIp }),
  );
}
