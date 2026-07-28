// Sessions and the device registry (`architecture.md §4.2`).
//
// Server-side sessions in Postgres, not JWT: nearly every session requirement in
// `ui-ux-spec.md §5` is a REVOCATION requirement — logout on the shared tablet,
// idle timeout, admin deactivation (I21), a tier change taking effect now. A
// stateless token satisfies none of them without per-request reissue, which is
// session tracking in disguise.
//
// The device registry lives here rather than in its own service because it exists
// for exactly one reason: `session.device_id` decides which lifetime policy a
// session gets (§4.2 "Device classification"). Membership in `device` IS the
// shared-device marker; an unregistered browser is personal.

import { randomBytes } from 'node:crypto';
import { tierAtLeast } from '../../../shared/src/index.js';
import { db } from '../db/index.js';
import { writeTransaction, type Tx } from '../db/transaction.js';
import type { Duty, Tier } from '../db/types.js';

/**
 * The identity a request acts under, resolved by lookup on every request.
 *
 * `sessionId` is here because logout needs it; it is a credential-equivalent and
 * must never be logged (`architecture.md §5.4`).
 */
export interface Actor {
  id: string;
  username: string;
  tier: Tier;
  duties: Duty[];
  sessionId: string;
  expiresAt: Date;
  /** True when this session runs on a registered (therefore shared) device. */
  sharedDevice: boolean;
}

export interface LifetimeConfig {
  idleSharedMinutes: number;
  absoluteSharedHours: number;
  idlePersonalVolunteerDays: number;
  idlePersonalStaffDays: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Resolved expiry: whichever of idle / absolute binds first (`architecture.md §4.2`).
 *
 *   shared device        30 min idle, 12 h absolute cap — the cap applies
 *                        regardless of activity, so the tablet is logged out by
 *                        morning no matter who left it awake
 *   personal, Volunteer  30 days rolling, no cap
 *   personal, Staff+     7 days rolling, no cap — the account is worth more
 *
 * Values come from `app_config` so they are tunable without a redeploy; the key
 * names are `phase-1-state.md` A3's.
 */
export function computeExpiry(params: {
  now: Date;
  createdAt: Date;
  sharedDevice: boolean;
  tier: Tier;
  config: LifetimeConfig;
}): Date {
  const { now, createdAt, sharedDevice, tier, config } = params;

  if (sharedDevice) {
    const idle = now.getTime() + config.idleSharedMinutes * MINUTE;
    const absolute = createdAt.getTime() + config.absoluteSharedHours * HOUR;
    return new Date(Math.min(idle, absolute));
  }

  // Hierarchical, not equality (I1): an Admin gets the Staff window, not the
  // Volunteer one.
  const days = tierAtLeast(tier, 'STAFF')
    ? config.idlePersonalStaffDays
    : config.idlePersonalVolunteerDays;
  return new Date(now.getTime() + days * DAY);
}

/** 256 bits of opaque randomness. The value is the cookie; it is never logged. */
export function newSessionId(): string {
  return randomBytes(32).toString('base64url');
}

async function readLifetimeConfig(tx: Tx | typeof db): Promise<LifetimeConfig> {
  const row = await tx
    .selectFrom('app_config')
    .select([
      'session_idle_shared_minutes',
      'session_absolute_shared_hours',
      'session_idle_personal_volunteer_days',
      'session_idle_personal_staff_days',
    ])
    .executeTakeFirstOrThrow();

  return {
    idleSharedMinutes: row.session_idle_shared_minutes,
    absoluteSharedHours: row.session_absolute_shared_hours,
    idlePersonalVolunteerDays: row.session_idle_personal_volunteer_days,
    idlePersonalStaffDays: row.session_idle_personal_staff_days,
  };
}

export interface CreatedSession {
  id: string;
  expiresAt: Date;
  sharedDevice: boolean;
}

/**
 * Insert a session row. Takes the transaction because login is one use case:
 * the credential check and the session it produces share a transaction
 * (`architecture.md §4.1`), and this is the write half of it.
 *
 * `deviceId` is validated against `device` by the caller; an unknown id is
 * treated as personal rather than rejected, because the marker degrading to
 * "personal" is exactly the §4.2 failure mode — it must not also lock the user
 * out of the tablet.
 */
export async function createSessionIn(
  tx: Tx,
  params: { userId: string; tier: Tier; deviceId: string | null; now: Date },
): Promise<CreatedSession> {
  const { userId, tier, deviceId, now } = params;
  const config = await readLifetimeConfig(tx);
  const sharedDevice = deviceId !== null;

  const expiresAt = computeExpiry({
    now,
    createdAt: now,
    sharedDevice,
    tier,
    config,
  });

  const id = newSessionId();
  await tx
    .insertInto('session')
    .values({
      id,
      user_id: userId,
      device_id: deviceId,
      created_at: now,
      last_seen_at: now,
      expires_at: expiresAt,
    })
    .execute();

  return { id, expiresAt, sharedDevice };
}

/**
 * Resolve identity for one request and slide the idle window.
 *
 * Three ways a session stops working, all checked here because the doc's whole
 * argument for server-side sessions is that they take effect on the NEXT request:
 * expiry, deactivation of the account (I21), and deletion by logout. A tier or
 * duty change needs no check — this reads them fresh every time.
 */
export async function resolveSession(
  sessionId: string,
  now: Date = new Date(),
): Promise<Actor | null> {
  return writeTransaction(async (tx) => {
    const row = await tx
      .selectFrom('session')
      .innerJoin('app_user', 'app_user.id', 'session.user_id')
      .select([
        'session.id as session_id',
        'session.user_id as user_id',
        'session.device_id as device_id',
        'session.created_at as created_at',
        'session.expires_at as expires_at',
        'app_user.username as username',
        'app_user.tier as tier',
        'app_user.deactivated_at as deactivated_at',
      ])
      .where('session.id', '=', sessionId)
      .executeTakeFirst();

    if (!row) return null;

    if (row.expires_at.getTime() <= now.getTime()) {
      await tx.deleteFrom('session').where('id', '=', sessionId).execute();
      return null;
    }

    // I21 — a deactivated account's session dies on its next request. This is the
    // revocation property server-side sessions exist for.
    if (row.deactivated_at !== null) {
      await tx.deleteFrom('session').where('id', '=', sessionId).execute();
      return null;
    }

    const config = await readLifetimeConfig(tx);
    const sharedDevice = row.device_id !== null;
    const expiresAt = computeExpiry({
      now,
      createdAt: row.created_at,
      sharedDevice,
      tier: row.tier,
      config,
    });

    await tx
      .updateTable('session')
      .set({ last_seen_at: now, expires_at: expiresAt })
      .where('id', '=', sessionId)
      .execute();

    const duties = await tx
      .selectFrom('user_duty')
      .select('duty')
      .where('user_id', '=', row.user_id)
      .execute();

    return {
      id: row.user_id,
      username: row.username,
      tier: row.tier,
      duties: duties.map((d) => d.duty),
      sessionId,
      expiresAt,
      sharedDevice,
    };
  });
}

/** Logout. Deleting the row is the whole point of storing it (§4.2). */
export async function destroySession(sessionId: string): Promise<void> {
  await writeTransaction(async (tx) => {
    await tx.deleteFrom('session').where('id', '=', sessionId).execute();
  });
}

/** Every session of one user — used when an admin deactivates the account. */
export async function destroySessionsForUserIn(tx: Tx, userId: string): Promise<void> {
  await tx.deleteFrom('session').where('user_id', '=', userId).execute();
}

/**
 * Delete every session whose resolved expiry has passed.
 *
 * `architecture.md §4.4` schedules this daily. It is a catch-up sweep by shape —
 * it asks "what is expired?" rather than firing at a time — so a missed tick
 * self-heals on the next pass. Correctness never depends on it running:
 * `resolveSession` already refuses an expired row and deletes it in place. This
 * only stops the table growing.
 *
 * Registering it with the scheduler is a Wave-2 one-liner: `server/src/jobs/`
 * belongs to another lane and does not exist in this worktree.
 */
export async function purgeExpiredSessions(now: Date = new Date()): Promise<number> {
  return writeTransaction(async (tx) => {
    const result = await tx
      .deleteFrom('session')
      .where('expires_at', '<=', now)
      .executeTakeFirst();
    return Number(result.numDeletedRows);
  });
}

// ---------------------------------------------------------------------------
// Device registry (`architecture.md §4.2`, "Device classification")
// ---------------------------------------------------------------------------

export interface DeviceRecord {
  id: string;
  label: string;
  createdAt: Date;
}

/**
 * Register a shared device. An admin does this once per physical device, on that
 * device; anything unregistered is personal. The set is small and fixed at two —
 * the receiver tablet and the reporter desktop.
 */
export async function registerDevice(label: string): Promise<DeviceRecord> {
  return writeTransaction(async (tx) => {
    const row = await tx
      .insertInto('device')
      .values({ label })
      .returningAll()
      .executeTakeFirstOrThrow();
    return { id: row.id, label: row.label, createdAt: row.created_at };
  });
}

export async function listDevices(): Promise<DeviceRecord[]> {
  const rows = await db
    .selectFrom('device')
    .selectAll()
    .orderBy('created_at')
    .execute();
  return rows.map((r) => ({ id: r.id, label: r.label, createdAt: r.created_at }));
}

/**
 * Resolve a device marker presented by a browser. Returns null for an unknown or
 * malformed id: a marker that no longer matches a row means the registration was
 * lost, and §4.2 accepts that this degrades the device to "personal" — the loss
 * is made visible by the tablet's push subscription going with it, not by a
 * login failure.
 */
export async function findDevice(deviceId: string): Promise<DeviceRecord | null> {
  if (!/^[0-9a-f-]{36}$/i.test(deviceId)) return null;
  const row = await db
    .selectFrom('device')
    .selectAll()
    .where('id', '=', deviceId)
    .executeTakeFirst();
  return row ? { id: row.id, label: row.label, createdAt: row.created_at } : null;
}
