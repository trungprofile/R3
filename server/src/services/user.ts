// Accounts (`product-requirement.md` cap 1, `ui-ux-spec.md S1.8`).
//
// Owns username generation (`domain-modeling.md §5.1`), account creation, tier and
// duty assignment, credential resets, and removal under I21.

import { DUTIES, TIERS } from '../../../shared/src/index.js';
import { db } from '../db/index.js';
import { writeTransaction, type Tx } from '../db/transaction.js';
import type { Duty, Tier } from '../db/types.js';
import { AppError, badRequest, notFound } from '../middleware/error.js';
import type { UserRecord } from '../pii.js';
import {
  assertCredentialShape,
  defaultPin,
  hashCredential,
} from './auth.js';
import { destroySessionsForUserIn } from './session.js';

export interface UserWithDuties {
  user: UserRecord;
  duties: Duty[];
}

const USER_COLUMNS = [
  'id',
  'username',
  'first_name',
  'last_name',
  'tier',
  'phone',
  'address',
  'deactivated_at',
] as const;

// ---------------------------------------------------------------------------
// Username generation (`domain-modeling.md §5.1`)
// ---------------------------------------------------------------------------

/**
 * NFKD decompose, strip combining marks, lowercase, keep [a-z0-9].
 * "O'Brien-Núñez" -> "obriennunez".
 */
export function normalizeNamePart(part: string): string {
  return part
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** `first + last`, normalized; "user" when nothing survives normalization
 *  (all-punctuation or non-Latin names). */
export function usernameBase(first: string, last: string): string {
  const base = normalizeNamePart(first) + normalizeNamePart(last);
  return base === '' ? 'user' : base;
}

async function isUsernameTaken(tx: Tx, candidate: string): Promise<boolean> {
  // "Taken" includes deactivated users: a handle stays reserved, no reuse, no
  // renumber (I3 / I21).
  const row = await tx
    .selectFrom('app_user')
    .select('id')
    .where('username', '=', candidate)
    .executeTakeFirst();
  return row !== undefined;
}

/**
 * I3 — unique, immutable after creation, lowercase [a-z0-9], never empty.
 *
 * Collision is resolved on the FINAL assembled string, so the suffix shares the
 * namespace: if `johnsmith2` exists (literally or generated), the next John Smith
 * becomes `johnsmith3`. Creation order falls out automatically.
 *
 * The uniqueness this loop reads is advisory; `uq_user_username` is the actual
 * enforcement (tier 1) and `createUser` retries the whole transaction on its
 * violation, which is §5.1's "enforce uniqueness at the storage layer and retry".
 */
export async function generateUsernameIn(
  tx: Tx,
  first: string,
  last: string,
): Promise<string> {
  const base = usernameBase(first, last);
  if (!(await isUsernameTaken(tx, base))) return base;

  let k = 2;
  while (await isUsernameTaken(tx, `${base}${k}`)) k += 1;
  return `${base}${k}`;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function dutiesOf(userIds: string[]): Promise<Map<string, Duty[]>> {
  const byUser = new Map<string, Duty[]>();
  if (userIds.length === 0) return byUser;

  const rows = await db
    .selectFrom('user_duty')
    .select(['user_id', 'duty'])
    .where('user_id', 'in', userIds)
    .execute();

  for (const row of rows) {
    const held = byUser.get(row.user_id) ?? [];
    held.push(row.duty);
    byUser.set(row.user_id, held);
  }
  return byUser;
}

/** Every account, active and deactivated — S1.8's list. Shaping happens at the
 *  route: a Staff viewer sees names, an Admin sees phone and address. */
export async function listUsers(): Promise<UserWithDuties[]> {
  const users = await db
    .selectFrom('app_user')
    .select([...USER_COLUMNS])
    .orderBy('first_name')
    .orderBy('last_name')
    .execute();

  const duties = await dutiesOf(users.map((u) => u.id));
  return users.map((user) => ({ user, duties: duties.get(user.id) ?? [] }));
}

export async function getUser(userId: string): Promise<UserWithDuties | null> {
  const user = await db
    .selectFrom('app_user')
    .select([...USER_COLUMNS])
    .where('id', '=', userId)
    .executeTakeFirst();
  if (!user) return null;

  const duties = await dutiesOf([user.id]);
  return { user, duties: duties.get(user.id) ?? [] };
}

/**
 * The login screen's name list (`ui-ux-spec.md §5`): active accounts only. The
 * roster is published by design (`product-requirement.md §2`) — username
 * enumeration is deliberately not defended, so this endpoint being public is a
 * decision, not an oversight.
 */
export async function listRosterUsers(): Promise<UserWithDuties[]> {
  const users = await db
    .selectFrom('app_user')
    .select([...USER_COLUMNS])
    // I21 — a deactivated account is hidden from new use, so it is not offered on
    // the login screen. Its username stays reserved (I3) all the same.
    .where('deactivated_at', 'is', null)
    .orderBy('first_name')
    .orderBy('last_name')
    .execute();

  const duties = await dutiesOf(users.map((u) => u.id));
  return users.map((user) => ({ user, duties: duties.get(user.id) ?? [] }));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

const UNIQUE_VIOLATION = '23505';

function isUsernameCollision(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === UNIQUE_VIOLATION &&
    String((err as { constraint?: unknown }).constraint ?? '').includes('username')
  );
}

function validName(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw badRequest(`${field} is required.`);
  }
  return value.trim();
}

function validTier(value: unknown): Tier {
  if (typeof value !== 'string' || !(TIERS as readonly string[]).includes(value)) {
    throw badRequest('Pick an access tier.');
  }
  return value as Tier;
}

function validDuties(value: unknown): Duty[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw badRequest('Duties must be a list.');
  const seen = new Set<Duty>();
  for (const duty of value) {
    if (typeof duty !== 'string' || !(DUTIES as readonly string[]).includes(duty)) {
      throw badRequest('Unknown duty.');
    }
    // I2 — a user holds a SET of 0..3 duties, so duplicates collapse rather than
    // becoming a primary-key violation on (user_id, duty).
    seen.add(duty as Duty);
  }
  return [...seen];
}

async function replaceDuties(tx: Tx, userId: string, duties: Duty[]): Promise<void> {
  await tx.deleteFrom('user_duty').where('user_id', '=', userId).execute();
  if (duties.length > 0) {
    await tx
      .insertInto('user_duty')
      .values(duties.map((duty) => ({ user_id: userId, duty })))
      .execute();
  }
}

export interface CreateUserParams {
  firstName: string;
  lastName: string;
  tier: Tier;
  duties?: Duty[];
  phone?: string | null;
  address?: string | null;
  credential?: string;
}

export interface CreateUserResult extends UserWithDuties {
  /** Present only when the server generated the PIN, i.e. no phone was on file.
   *  The admin has no other way to learn it — never logged, shown once. */
  generatedCredential?: string;
}

/**
 * Create an account.
 *
 * Tier is capped at Staff here: `product-requirement.md` cap 1 gives Admin
 * "creates/deletes NON-ADMIN accounts" while also granting tier assignment, so an
 * Admin account is reached by promoting an existing one, never by minting one.
 */
export async function createUser(params: CreateUserParams): Promise<CreateUserResult> {
  const firstName = validName(params.firstName, 'First name');
  const lastName = validName(params.lastName, 'Last name');
  const tier = validTier(params.tier);
  const duties = validDuties(params.duties);
  const phone = params.phone?.trim() || null;
  const address = params.address?.trim() || null;

  if (tier === 'ADMIN') {
    throw new AppError(
      403,
      'FORBIDDEN',
      'Admin accounts are not created directly. Create the account, then raise its tier.',
    );
  }

  let generated: string | undefined;
  let credential = params.credential;
  if (credential === undefined || credential === '') {
    if (tier !== 'VOLUNTEER') {
      throw badRequest('Set a password for a staff account.');
    }
    // §4.2: last four of the phone, or four random digits with no phone on file.
    credential = defaultPin(phone);
    if (phone === null || phone.replace(/\D/g, '').length < 4) generated = credential;
  }
  assertCredentialShape(tier, credential);
  const credentialHash = await hashCredential(credential);

  // §5.1's concurrency note: two simultaneous creates can race for the same `k`.
  // Uniqueness is enforced at the storage layer (uq_user_username, tier 1) and the
  // loser retries the whole transaction — its username scan included.
  for (let attempt = 1; ; attempt++) {
    try {
      const created = await writeTransaction(async (tx) => {
        const username = await generateUsernameIn(tx, firstName, lastName);
        const user = await tx
          .insertInto('app_user')
          .values({
            username,
            tier,
            first_name: firstName,
            last_name: lastName,
            phone,
            address,
            credential_hash: credentialHash,
          })
          .returning([...USER_COLUMNS])
          .executeTakeFirstOrThrow();

        await replaceDuties(tx, user.id, duties);
        return { user, duties };
      });

      return generated === undefined ? created : { ...created, generatedCredential: generated };
    } catch (err) {
      if (attempt >= 3 || !isUsernameCollision(err)) throw err;
    }
  }
}

export interface UpdateUserParams {
  firstName?: string;
  lastName?: string;
  tier?: Tier;
  duties?: Duty[];
  phone?: string | null;
  address?: string | null;
  credential?: string;
}

/**
 * Edit an account. Username is not a parameter: it is immutable after creation
 * (I3), and a later deletion never renumbers anyone.
 *
 * A tier change that crosses the PIN/password boundary must carry a new
 * credential — otherwise a promoted volunteer would keep a 4-digit PIN on a Staff
 * account, quietly undoing §4.2's reason for the split.
 */
export async function updateUser(
  userId: string,
  params: UpdateUserParams,
): Promise<UserWithDuties> {
  return writeTransaction(async (tx) => {
    const existing = await tx
      .selectFrom('app_user')
      .select(['id', 'tier'])
      .where('id', '=', userId)
      .executeTakeFirst();
    if (!existing) throw notFound('No such account.');

    const tier = params.tier === undefined ? existing.tier : validTier(params.tier);
    const crossesCredentialBoundary =
      (tier === 'VOLUNTEER') !== (existing.tier === 'VOLUNTEER');

    let credentialHash: string | undefined;
    if (params.credential !== undefined && params.credential !== '') {
      assertCredentialShape(tier, params.credential);
      credentialHash = await hashCredential(params.credential);
    } else if (crossesCredentialBoundary) {
      throw badRequest(
        tier === 'VOLUNTEER'
          ? 'Set a 4-digit PIN when moving this account to volunteer.'
          : 'Set a password when raising this account to staff or admin.',
      );
    }

    const patch: Record<string, unknown> = {};
    if (params.firstName !== undefined) {
      patch['first_name'] = validName(params.firstName, 'First name');
    }
    if (params.lastName !== undefined) {
      patch['last_name'] = validName(params.lastName, 'Last name');
    }
    if (params.tier !== undefined) patch['tier'] = tier;
    if (params.phone !== undefined) patch['phone'] = params.phone?.trim() || null;
    if (params.address !== undefined) patch['address'] = params.address?.trim() || null;
    if (credentialHash !== undefined) patch['credential_hash'] = credentialHash;

    if (Object.keys(patch).length > 0) {
      await tx
        .updateTable('app_user')
        .set(patch)
        .where('id', '=', userId)
        .execute();
    }

    if (params.duties !== undefined) {
      await replaceDuties(tx, userId, validDuties(params.duties));
    }

    const user = await tx
      .selectFrom('app_user')
      .select([...USER_COLUMNS])
      .where('id', '=', userId)
      .executeTakeFirstOrThrow();
    const duties = await tx
      .selectFrom('user_duty')
      .select('duty')
      .where('user_id', '=', userId)
      .execute();

    return { user, duties: duties.map((d) => d.duty) };
  });
}

/** Admin sets or resets a PIN / password (`ui-ux-spec.md S1.8`). §4.2 has no
 *  forced-change flow: throttling carries that load instead. */
export async function setCredential(userId: string, credential: string): Promise<void> {
  await writeTransaction(async (tx) => {
    const user = await tx
      .selectFrom('app_user')
      .select(['id', 'tier'])
      .where('id', '=', userId)
      .executeTakeFirst();
    if (!user) throw notFound('No such account.');

    assertCredentialShape(user.tier, credential);
    const credentialHash = await hashCredential(credential);
    await tx
      .updateTable('app_user')
      .set({ credential_hash: credentialHash })
      .where('id', '=', userId)
      .execute();
  });
}

/**
 * I21's "has referencing history" predicate for User.
 *
 * ONE function per entity, deliberately (`phase-1-build-plan.md D3`): Phase 2 adds
 * `weight_entry` and `unscheduled_donation` (`created_by` / `updated_by`), and
 * extending this must be a one-line change rather than a hunt.
 *
 * `domain-modeling.md §2.3` scopes "referencing history" for a User to owned
 * shifts, provenance stamps, and intake rows, and sends auth/session mechanics to
 * `architecture.md §4.2` — so `user_duty` and `session` are excluded here and
 * deleted alongside the account instead. Every other reference counts, because
 * every FK is ON DELETE RESTRICT: a predicate narrower than the FK set would turn
 * a soft-delete decision into a foreign-key error.
 */
export async function userHasHistory(tx: Tx, userId: string): Promise<boolean> {
  const shift = await tx
    .selectFrom('shift')
    .select('id')
    .where((eb) =>
      eb.or([
        eb('owner_id', '=', userId),
        eb('created_by', '=', userId),
        eb('updated_by', '=', userId),
      ]),
    )
    .executeTakeFirst();
  if (shift) return true;

  const block = await tx
    .selectFrom('availability_block')
    .select('id')
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (block) return true;

  const pattern = await tx
    .selectFrom('recurrence_pattern')
    .select('id')
    .where((eb) =>
      eb.or([eb('created_by', '=', userId), eb('owner_default_id', '=', userId)]),
    )
    .executeTakeFirst();
  if (pattern) return true;

  const notification = await tx
    .selectFrom('notification')
    .select('id')
    .where('recipient_id', '=', userId)
    .executeTakeFirst();
  if (notification) return true;

  const subscription = await tx
    .selectFrom('push_subscription')
    .select('id')
    .where('user_id', '=', userId)
    .executeTakeFirst();
  return subscription !== undefined;
}

export type RemoveUserOutcome = 'DELETED' | 'DEACTIVATED';

/**
 * I21 — soft-delete when the account has referencing history, hard-delete when it
 * has none (fixing a mistaken create). A deactivated user's username stays
 * reserved either way for the soft case (I3); a hard-deleted zero-history account
 * frees its username, which is harmless because nothing referenced it.
 *
 * `product-requirement.md` cap 1 and `ui-ux-spec.md S1.8`: Admin removes NON-ADMIN
 * accounts only.
 */
export async function removeUser(userId: string): Promise<RemoveUserOutcome> {
  return writeTransaction(async (tx) => {
    const user = await tx
      .selectFrom('app_user')
      .select(['id', 'tier', 'deactivated_at'])
      .where('id', '=', userId)
      .executeTakeFirst();
    if (!user) throw notFound('No such account.');

    if (user.tier === 'ADMIN') {
      throw new AppError(403, 'FORBIDDEN', 'An admin account cannot be removed here.');
    }

    // Sessions go regardless of which branch runs: §4.2's whole argument for
    // server-side sessions is that admin deactivation kills them instantly.
    await destroySessionsForUserIn(tx, userId);

    if (await userHasHistory(tx, userId)) {
      await tx
        .updateTable('app_user')
        .set({ deactivated_at: new Date() })
        .where('id', '=', userId)
        .execute();
      return 'DEACTIVATED';
    }

    await tx.deleteFrom('user_duty').where('user_id', '=', userId).execute();
    await tx.deleteFrom('app_user').where('id', '=', userId).execute();
    return 'DELETED';
  });
}
