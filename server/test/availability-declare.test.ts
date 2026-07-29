// Declaring, withdrawing and reading availability — `product-requirement.md` cap 7,
// `ui-ux-spec.md S1.4`, and `domain-modeling.md §5.2`'s declaration gate.
//
// The gate is the point of this file: a block that overlaps a shift the driver owns
// in CLAIMED or IN_PROGRESS is REJECTED, and the owned shift is never auto-released
// to make room for it (I20 — "this mirrors I20/I2: an owned shift never overlaps
// availability, by construction, never by auto-release").

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { db, pool } from '../src/db/index.js';
import { AppError } from '../src/middleware/error.js';
import {
  declareAvailability,
  expandDeclaration,
  listAvailability,
  localToInstant,
  withdrawAvailability,
} from '../src/services/availability.js';
import { eligible } from '../src/services/eligibility.js';
import {
  makeAdmin,
  makeDriver,
  makeShift,
  makeUser,
  resetDatabase,
} from './fixtures.js';

// The pantry zone. `app_config.timezone` is seeded to this by migration 0001 and
// `resetDatabase` deliberately leaves the singleton alone; pinned here so the
// expected instants below are a statement about the conversion, not about a default.
const ZONE = 'America/Chicago';

beforeAll(async () => {
  await sql`UPDATE app_config SET timezone = ${ZONE}`.execute(db);
});

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await db.destroy();
  await pool.end().catch(() => undefined);
});

function driverActor(user: { id: string }) {
  return { id: user.id, tier: 'VOLUNTEER' as const };
}

/** The refusal an operation produced. Fails the test if it did not refuse — a
 *  gate that quietly permits is exactly what these cases are looking for. */
async function refusal(operation: Promise<unknown>): Promise<AppError> {
  try {
    await operation;
  } catch (err) {
    return err as AppError;
  }
  throw new Error('expected the operation to be refused, but it succeeded');
}

// ---------------------------------------------------------------------------
// Pantry-local expansion (§5.2 — "half-open, pantry-local time")
// ---------------------------------------------------------------------------

describe('expanding a declaration into blocks', () => {
  it('turns a whole-day range into one contiguous block, midnight to midnight local', () => {
    const [block, ...rest] = expandDeclaration(
      { kind: 'DATES', fromDate: '2026-08-04', toDate: '2026-08-06' },
      ZONE,
      365,
    );
    expect(rest).toHaveLength(0);
    // CDT is UTC-5 in August: local midnight is 05:00Z, and the range runs to the
    // start of the day AFTER toDate because the window is half-open.
    expect(block?.startsAt.toISOString()).toBe('2026-08-04T05:00:00.000Z');
    expect(block?.endsAt.toISOString()).toBe('2026-08-07T05:00:00.000Z');
  });

  it('turns a clock window into one block per date', () => {
    const blocks = expandDeclaration(
      {
        kind: 'WINDOW',
        fromDate: '2026-08-04',
        toDate: '2026-08-06',
        startTime: '09:00',
        endTime: '12:30',
      },
      ZONE,
      365,
    );
    expect(blocks).toHaveLength(3);
    expect(blocks.map((b) => b.startsAt.toISOString())).toEqual([
      '2026-08-04T14:00:00.000Z',
      '2026-08-05T14:00:00.000Z',
      '2026-08-06T14:00:00.000Z',
    ]);
    for (const block of blocks) {
      expect(block.endsAt.getTime() - block.startsAt.getTime()).toBe(3.5 * 3600_000);
    }
  });

  it('is DST-aware: a range across the fall-back is 25 hours longer than the clock says', () => {
    // 2026-11-01 is the US fall-back. `data-model.md §2` requires an IANA zone
    // precisely so this is not a fixed offset: two calendar days here are 49 hours.
    const [block] = expandDeclaration(
      { kind: 'DATES', fromDate: '2026-10-31', toDate: '2026-11-01' },
      ZONE,
      365,
    );
    expect(block?.startsAt.toISOString()).toBe('2026-10-31T05:00:00.000Z');
    expect(block?.endsAt.toISOString()).toBe('2026-11-02T06:00:00.000Z');
    expect((block!.endsAt.getTime() - block!.startsAt.getTime()) / 3600_000).toBe(49);
  });

  it('holds a clock window at the same wall time across a DST change', () => {
    const blocks = expandDeclaration(
      {
        kind: 'WINDOW',
        fromDate: '2026-10-31',
        toDate: '2026-11-01',
        startTime: '09:00',
        endTime: '11:00',
      },
      ZONE,
      365,
    );
    // Same local 09:00 both days; different UTC instants, because the offset moved.
    expect(blocks.map((b) => b.startsAt.toISOString())).toEqual([
      '2026-10-31T14:00:00.000Z',
      '2026-11-01T15:00:00.000Z',
    ]);
  });

  it('rejects the shapes S1.4 cannot produce', () => {
    const base = { fromDate: '2026-08-04', toDate: '2026-08-06' };
    expect(() => expandDeclaration({ kind: 'WINDOW', ...base }, ZONE, 365)).toThrow(
      /startTime and endTime/,
    );
    expect(() =>
      expandDeclaration(
        { kind: 'WINDOW', ...base, startTime: '12:00', endTime: '09:00' },
        ZONE,
        365,
      ),
    ).toThrow(/later in the day/);
    expect(() =>
      expandDeclaration(
        { kind: 'WINDOW', ...base, startTime: '09:00', endTime: '09:00' },
        ZONE,
        365,
      ),
    ).toThrow(/later in the day/);
    expect(() =>
      expandDeclaration({ kind: 'DATES', ...base, startTime: '09:00' }, ZONE, 365),
    ).toThrow(/no start or end time/);
    expect(() =>
      expandDeclaration(
        { kind: 'DATES', fromDate: '2026-08-06', toDate: '2026-08-04' },
        ZONE,
        365,
      ),
    ).toThrow(/on or after/);
    expect(() =>
      expandDeclaration({ kind: 'DATES', fromDate: '2026-02-31', toDate: '2026-03-01' }, ZONE, 365),
    ).toThrow(/not a real date/);
    expect(() =>
      expandDeclaration({ kind: 'DATES', fromDate: '2026-8-4', toDate: '2026-08-06' }, ZONE, 365),
    ).toThrow(/YYYY-MM-DD/);
  });

  it('refuses a declaration longer than the materialization horizon', () => {
    expect(() =>
      expandDeclaration(
        { kind: 'DATES', fromDate: '2026-01-01', toDate: '2027-01-01' },
        ZONE,
        365,
      ),
    ).toThrow(/at most 365 days/);
  });

  it('resolves a local wall time to the instant, both sides of a DST change', () => {
    expect(localToInstant({ year: 2026, month: 1, day: 15, hour: 9, minute: 0 }, ZONE)
      .toISOString()).toBe('2026-01-15T15:00:00.000Z'); // CST, UTC-6
    expect(localToInstant({ year: 2026, month: 7, day: 15, hour: 9, minute: 0 }, ZONE)
      .toISOString()).toBe('2026-07-15T14:00:00.000Z'); // CDT, UTC-5
  });
});

// ---------------------------------------------------------------------------
// The declaration gate (I20)
// ---------------------------------------------------------------------------

describe('declaring unavailability', () => {
  it('saves the blocks and makes the driver ineligible for that window', async () => {
    const driver = await makeDriver();
    const blocks = await declareAvailability(driverActor(driver), {
      kind: 'WINDOW',
      fromDate: '2026-08-04',
      toDate: '2026-08-05',
      startTime: '09:00',
      endTime: '13:00',
    });

    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.userId).toBe(driver.id);

    // The whole point of the block: the shift board stops offering that run.
    expect(
      await eligible(db, driver.id, {
        startsAt: new Date('2026-08-04T15:00:00.000Z'),
        endsAt: new Date('2026-08-04T17:00:00.000Z'),
      }),
    ).toBe(false);
    // …and only that window. 09:00–13:00 local is 14:00–18:00Z, so a 19:00Z run is
    // untouched.
    expect(
      await eligible(db, driver.id, {
        startsAt: new Date('2026-08-04T19:00:00.000Z'),
        endsAt: new Date('2026-08-04T21:00:00.000Z'),
      }),
    ).toBe(true);
  });

  it('rejects a block overlapping a run the driver owns, and tells them to release it', async () => {
    const driver = await makeDriver();
    await makeShift({
      ownerId: driver.id,
      status: 'CLAIMED',
      startsAt: new Date('2026-08-04T15:00:00.000Z'),
      endsAt: new Date('2026-08-04T17:00:00.000Z'),
    });

    const attempt = declareAvailability(driverActor(driver), {
      kind: 'DATES',
      fromDate: '2026-08-04',
      toDate: '2026-08-04',
    });

    await expect(attempt).rejects.toThrow(/release it first/);
    const error = await refusal(attempt);
    expect(error.status).toBe(409);
    expect(error.details?.['error']).toBe('AVAILABILITY_CONFLICT');
    expect(error.details?.['conflicts']).toMatchObject([
      { status: 'CLAIMED', releasable: true, routeName: 'Test Route' },
    ]);

    // Rejected, never auto-released: the shift is exactly as it was (§5.2).
    const shift = await db.selectFrom('shift').selectAll().executeTakeFirstOrThrow();
    expect(shift.status).toBe('CLAIMED');
    expect(shift.owner_id).toBe(driver.id);
    expect(await db.selectFrom('availability_block').selectAll().execute()).toEqual([]);
  });

  it('says something different when the run is already in progress', async () => {
    // I9 blocks cancelling from IN_PROGRESS, so "release it first" would be advice
    // the driver cannot take. §5.2: the block "simply cannot be declared until the
    // run finishes".
    const driver = await makeDriver();
    await makeShift({
      ownerId: driver.id,
      status: 'IN_PROGRESS',
      startsAt: new Date('2026-08-04T15:00:00.000Z'),
      endsAt: new Date('2026-08-04T17:00:00.000Z'),
    });

    const error = await refusal(
      declareAvailability(driverActor(driver), {
        kind: 'DATES',
        fromDate: '2026-08-04',
        toDate: '2026-08-04',
      }),
    );

    expect(error.message).toMatch(/in progress and can't be released/);
    expect(error.details?.['conflicts']).toMatchObject([
      { status: 'IN_PROGRESS', releasable: false },
    ]);
  });

  it('writes nothing at all when one date of a multi-day window conflicts', async () => {
    // S1.4's Save is one action: all-or-nothing, in one transaction. A partial save
    // would leave the driver believing they had declared five days when they had
    // declared four.
    const driver = await makeDriver();
    await makeShift({
      ownerId: driver.id,
      status: 'CLAIMED',
      startsAt: new Date('2026-08-05T15:00:00.000Z'),
      endsAt: new Date('2026-08-05T17:00:00.000Z'),
    });

    await expect(
      declareAvailability(driverActor(driver), {
        kind: 'WINDOW',
        fromDate: '2026-08-03',
        toDate: '2026-08-07',
        startTime: '09:00',
        endTime: '13:00',
      }),
    ).rejects.toThrow(AppError);

    expect(await db.selectFrom('availability_block').selectAll().execute()).toEqual([]);
  });

  it('ignores shifts that do not count: completed, unowned, and someone else’s', async () => {
    const driver = await makeDriver();
    const other = await makeDriver();
    const window = {
      startsAt: new Date('2026-08-04T15:00:00.000Z'),
      endsAt: new Date('2026-08-04T17:00:00.000Z'),
    };

    await makeShift({ ownerId: driver.id, status: 'COMPLETED', ...window });
    await makeShift({ status: 'OPEN', ...window });
    await makeShift({ ownerId: other.id, status: 'CLAIMED', ...window });

    const blocks = await declareAvailability(driverActor(driver), {
      kind: 'DATES',
      fromDate: '2026-08-04',
      toDate: '2026-08-04',
    });
    expect(blocks).toHaveLength(1);
  });

  it('allows a second, overlapping declaration', async () => {
    // Nothing forbids it and nothing needs to: eligibility reads the union, so a
    // duplicate block changes no answer. Merging them would be a rule no doc states.
    const driver = await makeDriver();
    const day = { kind: 'DATES' as const, fromDate: '2026-08-04', toDate: '2026-08-04' };

    await declareAvailability(driverActor(driver), day);
    await declareAvailability(driverActor(driver), day);

    expect(await db.selectFrom('availability_block').selectAll().execute()).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Notification (PRD §4 matrix: "Driver sets unavailability → Coordinator (Staff) only")
// ---------------------------------------------------------------------------

describe('the coordinator notification', () => {
  it('goes to every active Staff and Admin, and to nobody else', async () => {
    const driver = await makeDriver({ firstName: 'Karen', lastName: 'Diaz' });
    const staff = await makeUser({ tier: 'STAFF' });
    const admin = await makeAdmin(); // I1 is hierarchical: Admin is a coordinator too
    const otherVolunteer = await makeDriver();
    const goneStaff = await makeUser({ tier: 'STAFF', deactivated: true });

    await declareAvailability(driverActor(driver), {
      kind: 'DATES',
      fromDate: '2026-08-04',
      toDate: '2026-08-04',
    });

    const rows = await db.selectFrom('notification').selectAll().execute();
    expect(rows.map((r) => r.recipient_id).sort()).toEqual([staff.id, admin.id].sort());
    expect(rows.every((r) => r.event === 'UNAVAILABILITY_DECLARED')).toBe(true);
    // No subject shift, so the tier-1 dedupe index does not apply and every
    // declaration is its own event.
    expect(rows.every((r) => r.shift_id === null)).toBe(true);
    expect((rows[0]?.payload as { who?: string }).who).toBe('Karen Diaz');
    expect(rows.map((r) => r.recipient_id)).not.toContain(otherVolunteer.id);
    expect(rows.map((r) => r.recipient_id)).not.toContain(goneStaff.id);
  });

  it('sends again on a repeat declaration', async () => {
    const driver = await makeDriver();
    await makeUser({ tier: 'STAFF' });
    const day = { kind: 'DATES' as const, fromDate: '2026-08-04', toDate: '2026-08-04' };

    await declareAvailability(driverActor(driver), day);
    await declareAvailability(driverActor(driver), day);

    expect(await db.selectFrom('notification').selectAll().execute()).toHaveLength(2);
  });

  it('enqueues nothing when the declaration is refused', async () => {
    const driver = await makeDriver();
    await makeUser({ tier: 'STAFF' });
    await makeShift({
      ownerId: driver.id,
      status: 'CLAIMED',
      startsAt: new Date('2026-08-04T15:00:00.000Z'),
      endsAt: new Date('2026-08-04T17:00:00.000Z'),
    });

    await expect(
      declareAvailability(driverActor(driver), {
        kind: 'DATES',
        fromDate: '2026-08-04',
        toDate: '2026-08-04',
      }),
    ).rejects.toThrow(AppError);

    // The outbox row and the business write share a transaction (§4.4), so a
    // refused declaration cannot leave a coordinator with a phantom alert.
    expect(await db.selectFrom('notification').selectAll().execute()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Withdrawal and reading
// ---------------------------------------------------------------------------

describe('withdrawing a block', () => {
  it('removes it, and the driver becomes eligible again', async () => {
    const driver = await makeDriver();
    const [block] = await declareAvailability(driverActor(driver), {
      kind: 'DATES',
      fromDate: '2026-08-04',
      toDate: '2026-08-04',
    });

    const window = {
      startsAt: new Date('2026-08-04T15:00:00.000Z'),
      endsAt: new Date('2026-08-04T17:00:00.000Z'),
    };
    expect(await eligible(db, driver.id, window)).toBe(false);

    await withdrawAvailability(driverActor(driver), block!.id);

    expect(await eligible(db, driver.id, window)).toBe(true);
    expect(await db.selectFrom('availability_block').selectAll().execute()).toEqual([]);
  });

  it('refuses to withdraw someone else’s block', async () => {
    const driver = await makeDriver();
    const other = await makeDriver();
    const [block] = await declareAvailability(driverActor(driver), {
      kind: 'DATES',
      fromDate: '2026-08-04',
      toDate: '2026-08-04',
    });

    const error = await refusal(withdrawAvailability(driverActor(other), block!.id));
    expect(error.status).toBe(403);
    expect(await db.selectFrom('availability_block').selectAll().execute()).toHaveLength(1);
  });

  it('404s an id that is not a block', async () => {
    const driver = await makeDriver();
    const error = await refusal(
      withdrawAvailability(driverActor(driver), '00000000-0000-0000-0000-000000000000'),
    );
    expect(error.status).toBe(404);
  });
});

describe('reading availability', () => {
  it('returns the driver’s own blocks in time order', async () => {
    const driver = await makeDriver();
    await declareAvailability(driverActor(driver), {
      kind: 'WINDOW',
      fromDate: '2026-08-04',
      toDate: '2026-08-06',
      startTime: '09:00',
      endTime: '11:00',
    });

    const blocks = await listAvailability(driverActor(driver));
    expect(blocks.map((b) => b.startsAt)).toEqual([
      '2026-08-04T14:00:00.000Z',
      '2026-08-05T14:00:00.000Z',
      '2026-08-06T14:00:00.000Z',
    ]);
  });

  it('lets Staff and Admin read a driver’s, and refuses another volunteer', async () => {
    // `product-requirement.md §2` gives Staff "operational status across all
    // volunteers (availability, assignments…)". Hierarchical (I1), so Admin passes.
    const driver = await makeDriver();
    const staff = await makeUser({ tier: 'STAFF' });
    const admin = await makeAdmin();
    const nosy = await makeDriver();

    await declareAvailability(driverActor(driver), {
      kind: 'DATES',
      fromDate: '2026-08-04',
      toDate: '2026-08-04',
    });

    expect(await listAvailability({ id: staff.id, tier: 'STAFF' }, driver.id)).toHaveLength(1);
    expect(await listAvailability({ id: admin.id, tier: 'ADMIN' }, driver.id)).toHaveLength(1);

    const error = await refusal(listAvailability(driverActor(nosy), driver.id));
    expect(error.status).toBe(403);
  });
});
