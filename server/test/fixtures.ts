// Fixture factory for tests.
//
// Tests run against a MIGRATED database, never a fixture schema (CLAUDE.md): the
// tier-1 and tier-2 invariants exist only as real DDL, and I20's write-skew case
// needs two genuinely concurrent SERIALIZABLE transactions. Neither survives a mock.
//
// These builders exist so a lane agent working on, say, pickup execution can get a
// CLAIMED shift in one line instead of reimplementing the claim path it is not
// building. They insert rows directly and deliberately BYPASS the service layer —
// that is safe only because they are arranging preconditions, never asserting
// behavior. Never use a fixture to perform the operation under test.

import { sql } from 'kysely';
import { db } from '../src/db/index.js';
import type { Duty, Tier } from '../src/db/types.js';

/**
 * Truncate every table between tests. `app_config` is excluded: it is a singleton
 * seeded by migration 0001, and wiping it would remove the horizon and session
 * lifetimes the application reads.
 *
 * CASCADE is safe here only because the list is the whole schema — every FK is
 * ON DELETE RESTRICT, so a partial truncate would fail rather than cascade.
 */
export async function resetDatabase(): Promise<void> {
  await sql`
    TRUNCATE TABLE
      weight_entry, unscheduled_donation,
      notification, session, push_subscription, availability_block,
      shift_stop, shift, recurrence_pattern, route_stop, route, device,
      truck, category, donor, user_duty, app_user
    RESTART IDENTITY CASCADE
  `.execute(db);
}

let userSeq = 0;

export interface MakeUserOptions {
  tier?: Tier;
  duties?: Duty[];
  firstName?: string;
  lastName?: string;
  phone?: string | null;
  address?: string | null;
  deactivated?: boolean;
}

/**
 * Insert a user. `username` is generated here as a unique-but-arbitrary string —
 * it is NOT the §5.1 algorithm, which is a service function under test elsewhere.
 * A fixture that reimplemented it would let a bug in the real generator pass.
 */
export async function makeUser(opts: MakeUserOptions = {}) {
  const n = ++userSeq;
  const user = await db
    .insertInto('app_user')
    .values({
      username: `fixture${n}`,
      tier: opts.tier ?? 'VOLUNTEER',
      first_name: opts.firstName ?? `First${n}`,
      last_name: opts.lastName ?? `Last${n}`,
      phone: opts.phone ?? '5550000000',
      address: opts.address ?? '1 Test St',
      credential_hash: 'fixture-not-a-real-hash',
      deactivated_at: opts.deactivated ? new Date() : null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  const duties = opts.duties ?? [];
  if (duties.length > 0) {
    await db
      .insertInto('user_duty')
      .values(duties.map((duty) => ({ user_id: user.id, duty })))
      .execute();
  }

  return user;
}

/** A user holding the Drive duty — the precondition `eligible()` checks first (I20). */
export async function makeDriver(opts: Omit<MakeUserOptions, 'duties'> = {}) {
  return makeUser({ ...opts, duties: ['DRIVE'] });
}

export async function makeAdmin() {
  return makeUser({ tier: 'ADMIN', duties: ['DRIVE', 'RECEIVE', 'REPORT'] });
}

let donorSeq = 0;

export async function makeDonor(name?: string) {
  const n = ++donorSeq;
  return db
    .insertInto('donor')
    .values({ name: name ?? `Donor ${n}`, address: `${n} Market St` })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function makeTruck(name?: string) {
  return db
    .insertInto('truck')
    .values({ truck_name: name ?? 'Box Truck' })
    .returningAll()
    .executeTakeFirstOrThrow();
}

/** A route with `stopCount` donors in order. I28 holds: one stop per donor. */
export async function makeRoute(stopCount = 2, name = 'Test Route') {
  const route = await db
    .insertInto('route')
    .values({ name })
    .returningAll()
    .executeTakeFirstOrThrow();

  const donors = [];
  for (let i = 0; i < stopCount; i++) {
    const donor = await makeDonor();
    await db
      .insertInto('route_stop')
      .values({ route_id: route.id, donor_id: donor.id, position: i })
      .execute();
    donors.push(donor);
  }

  return { route, donors };
}

export interface MakeShiftOptions {
  routeId?: string;
  ownerId?: string | null;
  status?: 'OPEN' | 'CLAIMED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  startsAt?: Date;
  endsAt?: Date;
  truckId?: string | null;
  createdBy?: string;
}

/**
 * Insert a shift in whatever state the test needs.
 *
 * `ck_shift_owner` and `ck_shift_truck` are real CHECKs, so an inconsistent
 * combination here fails at the database rather than producing a row the
 * application could never have created. That is the point: fixtures cannot
 * manufacture states the schema forbids.
 */
export async function makeShift(opts: MakeShiftOptions = {}) {
  const author = opts.createdBy ?? (await makeAdmin()).id;
  const routeId = opts.routeId ?? (await makeRoute()).route.id;
  const startsAt = opts.startsAt ?? new Date('2026-08-04T14:00:00Z');
  const endsAt = opts.endsAt ?? new Date(startsAt.getTime() + 2 * 60 * 60 * 1000);
  const status = opts.status ?? 'OPEN';

  return db
    .insertInto('shift')
    .values({
      route_id: routeId,
      occurrence_date: startsAt.toISOString().slice(0, 10),
      starts_at: startsAt,
      ends_at: endsAt,
      status,
      owner_id: opts.ownerId ?? null,
      truck_id: opts.truckId ?? null,
      created_by: author,
      updated_by: author,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

/**
 * A shift already owned by a driver — the precondition for everything in the
 * pickup-execution lane, which does not care how the shift got claimed.
 */
export async function makeClaimedShift(opts: MakeShiftOptions = {}) {
  const owner = opts.ownerId ?? (await makeDriver()).id;
  const shift = await makeShift({ ...opts, ownerId: owner, status: 'CLAIMED' });
  return { shift, ownerId: owner };
}

let categorySeq = 0;

/**
 * A food category.
 *
 * Made per-test rather than relying on migration 0010's launch seed, because
 * `resetDatabase` truncates `category` along with everything else — a suite wants a
 * known world, not a usable one (`scripts/dev-seed.ts` makes the opposite trade for
 * the opposite reason).
 */
export async function makeCategory(name?: string) {
  const n = ++categorySeq;
  return db
    .insertInto('category')
    .values({ name: name ?? `Category ${n}` })
    .returningAll()
    .executeTakeFirstOrThrow();
}

/**
 * A run the receiver can actually work on: `IN_PROGRESS`, with the route snapshotted
 * into `shift_stop` rows exactly as `startRun` would leave it (I5).
 *
 * The snapshot is written here directly rather than by calling `startRun`, per this
 * file's own rule: a fixture arranges preconditions and never performs the operation
 * under test. Receiving tests are about what happens *after* a run has started.
 */
export async function makeStartedShift(
  opts: MakeShiftOptions & { stopCount?: number } = {},
) {
  const owner = opts.ownerId ?? (await makeDriver()).id;
  const truck = opts.truckId ?? (await makeTruck()).id;
  const built = opts.routeId ? null : await makeRoute(opts.stopCount ?? 2);
  const routeId = opts.routeId ?? built!.route.id;

  const shift = await makeShift({
    ...opts,
    routeId,
    ownerId: owner,
    truckId: truck,
    status: 'IN_PROGRESS',
  });

  const routeStops = await db
    .selectFrom('route_stop')
    .select(['donor_id', 'position'])
    .where('route_id', '=', routeId)
    .orderBy('position')
    .execute();

  const stops = await db
    .insertInto('shift_stop')
    .values(
      routeStops.map((rs) => ({
        shift_id: shift.id,
        donor_id: rs.donor_id,
        position: rs.position,
        disposition: 'COLLECTED' as const,
      })),
    )
    .returningAll()
    .execute();

  return { shift, ownerId: owner, stops, donors: built?.donors ?? [] };
}

/** A receiver — the duty every S2.x route declares (I2, set membership). */
export async function makeReceiver(opts: Omit<MakeUserOptions, 'duties'> = {}) {
  return makeUser({ ...opts, duties: ['RECEIVE'] });
}

/** An availability block for a driver — the other half of the I20 overlap test. */
export async function makeAvailabilityBlock(
  userId: string,
  startsAt: Date,
  endsAt: Date,
) {
  return db
    .insertInto('availability_block')
    .values({ user_id: userId, starts_at: startsAt, ends_at: endsAt })
    .returningAll()
    .executeTakeFirstOrThrow();
}
