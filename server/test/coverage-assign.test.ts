// Staff assign / unassign — I20's exemption, PRD cap 6's fallback path, S1.6.
//
// This is the file where the two rules that look like one come apart.
//
//   self-select     `eligible()` is a GATE. An ineligible driver cannot claim.
//   staff-assign    `eligible()` is ADVISORY. Staff sees a warning, confirms
//                   explicitly, and the assignment goes through anyway — "deliberate
//                   override authority for the fallback path" (I20 note).
//
// The override is not silent: the resulting run is flagged (`assigned_over_conflict`,
// migration 0008) so the driver sees the conflict on S1.3's persistent banner and can
// raise it with Staff. I20's "never overlaps" therefore holds by construction for
// self-select and materialization, and is a soft warning here — exactly as the locked
// doc says.
//
// What the exemption does NOT cover is also pinned here: it names "the driver's
// declared availability or another owned shift", so a deactivated account or a user
// without the Drive duty stays a hard refusal for Staff too.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/index.js';
import {
  assignDriver,
  previewAssignment,
  unassignDriver,
  type CoverageActor,
} from '../src/services/coverage.js';
import {
  makeAvailabilityBlock,
  makeDriver,
  makeShift,
  makeUser,
  resetDatabase,
} from './fixtures.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function at(offsetMs: number): Date {
  return new Date(Date.now() + offsetMs);
}

const staffActor = (id: string): CoverageActor => ({ id, tier: 'STAFF' });

async function readShift(id: string) {
  return db.selectFrom('shift').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
}

beforeEach(resetDatabase);
afterAll(async () => {
  await db.destroy();
  await pool.end().catch(() => undefined);
});

describe('staff assign — the clean case', () => {
  it('sets the same owner field self-select sets, unflagged', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    const driver = await makeDriver();
    const shift = await makeShift({ createdBy: staff.id, startsAt: at(3 * DAY) });

    const result = await assignDriver(staffActor(staff.id), shift.id, {
      driverId: driver.id,
    });

    const row = await readShift(shift.id);
    expect(row.status).toBe('CLAIMED');
    expect(row.owner_id).toBe(driver.id);
    expect(row.updated_by).toBe(staff.id); // I26 — the staff member is the last writer
    expect(row.assigned_over_conflict).toBe(false);
    expect(result.assignedOverConflict).toBe(false);
  });

  it('notifies the driver — "Shift assigned / defaulted to you" (PRD §4)', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    const driver = await makeDriver();
    const shift = await makeShift({ createdBy: staff.id, startsAt: at(3 * DAY) });

    await assignDriver(staffActor(staff.id), shift.id, { driverId: driver.id });

    const rows = await db
      .selectFrom('notification')
      .select(['event', 'recipient_id', 'shift_id'])
      .execute();
    expect(rows).toEqual([
      { event: 'SHIFT_ASSIGNED', recipient_id: driver.id, shift_id: shift.id },
    ]);
  });

  // D33 — the banner names who did it, so the payload has to carry the assigner.
  // Without `who` on the row there is nothing for `renderPush` to name, and the
  // driver is back to "you're on a run" with no idea who put them there.
  it('carries the assigning coordinator’s name on the payload', async () => {
    const staff = await makeUser({ tier: 'STAFF', firstName: 'Dana', lastName: 'Cole' });
    const driver = await makeDriver();
    const shift = await makeShift({ createdBy: staff.id, startsAt: at(3 * DAY) });

    await assignDriver(staffActor(staff.id), shift.id, { driverId: driver.id });

    const row = await db
      .selectFrom('notification')
      .select('payload')
      .executeTakeFirstOrThrow();
    expect(row.payload).toMatchObject({ who: 'Dana Cole' });
  });

  // D33's one omission. A coordinator who also drives can assign a run to
  // themselves, and "Dana Cole put you on a run" addressed to Dana Cole is worse
  // than the nameless sentence — so `who` is left off and the fallback speaks.
  it('leaves the name off when the coordinator assigns the run to themselves', async () => {
    const staff = await makeUser({
      tier: 'STAFF',
      duties: ['DRIVE'],
      firstName: 'Dana',
      lastName: 'Cole',
    });
    const shift = await makeShift({ createdBy: staff.id, startsAt: at(3 * DAY) });

    await assignDriver(staffActor(staff.id), shift.id, { driverId: staff.id });

    const row = await db
      .selectFrom('notification')
      .select('payload')
      .executeTakeFirstOrThrow();
    expect(row.payload).not.toHaveProperty('who');
  });
});

describe('staff assign — I20’s exemption', () => {
  it('warns instead of writing when the driver is away, until Staff confirms', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    const karen = await makeDriver({ firstName: 'Karen' });
    const shift = await makeShift({
      createdBy: staff.id,
      startsAt: at(3 * DAY),
      endsAt: at(3 * DAY + 2 * HOUR),
    });
    await makeAvailabilityBlock(karen.id, at(3 * DAY - HOUR), at(3 * DAY + HOUR));

    const err = await assignDriver(staffActor(staff.id), shift.id, {
      driverId: karen.id,
    }).catch((e: Error) => e);

    // S1.6: "Karen marked herself away then — assign anyway?"
    expect(err).toMatchObject({
      status: 409,
      message: 'Karen marked themselves away then — assign anyway?',
      details: { error: 'ASSIGN_CONFLICT' },
    });
    // Nothing was written: the warning comes BEFORE the assignment, not after it.
    const row = await readShift(shift.id);
    expect(row.status).toBe('OPEN');
    expect(row.owner_id).toBeNull();
  });

  it('goes through on confirmation and flags the run for the driver', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    const karen = await makeDriver({ firstName: 'Karen' });
    const shift = await makeShift({
      createdBy: staff.id,
      startsAt: at(3 * DAY),
      endsAt: at(3 * DAY + 2 * HOUR),
    });
    await makeAvailabilityBlock(karen.id, at(3 * DAY - HOUR), at(3 * DAY + HOUR));

    const result = await assignDriver(staffActor(staff.id), shift.id, {
      driverId: karen.id,
      confirmConflict: true,
    });

    const row = await readShift(shift.id);
    expect(row.owner_id).toBe(karen.id);
    expect(row.status).toBe('CLAIMED');
    // The flag is the whole of "the shift is flagged so the driver sees the conflict"
    // (I20 note) and drives S1.3's persistent banner.
    expect(row.assigned_over_conflict).toBe(true);
    expect(result.assignedOverConflict).toBe(true);
  });

  it('assigns over another owned run — the second confirmable conflict', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    const driver = await makeDriver({ firstName: 'Sam' });
    await makeShift({
      createdBy: staff.id,
      ownerId: driver.id,
      status: 'CLAIMED',
      startsAt: at(3 * DAY),
      endsAt: at(3 * DAY + 2 * HOUR),
    });
    const wanted = await makeShift({
      createdBy: staff.id,
      startsAt: at(3 * DAY + HOUR),
      endsAt: at(3 * DAY + 3 * HOUR),
    });

    await expect(
      assignDriver(staffActor(staff.id), wanted.id, { driverId: driver.id }),
    ).rejects.toMatchObject({ message: 'Sam already has a run at that time — assign anyway?' });

    const result = await assignDriver(staffActor(staff.id), wanted.id, {
      driverId: driver.id,
      confirmConflict: true,
    });
    expect(result.assignedOverConflict).toBe(true);

    // I20's guarantee is knowingly broken here, which is what the exemption is for:
    // both runs are now owned by one driver and their windows overlap.
    const owned = await db
      .selectFrom('shift')
      .select('id')
      .where('owner_id', '=', driver.id)
      .where('status', '=', 'CLAIMED')
      .execute();
    expect(owned).toHaveLength(2);
  });

  it('clears the flag when the run is reassigned to someone unconflicted', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    const karen = await makeDriver({ firstName: 'Karen' });
    const free = await makeDriver();
    const shift = await makeShift({
      createdBy: staff.id,
      startsAt: at(3 * DAY),
      endsAt: at(3 * DAY + 2 * HOUR),
    });
    await makeAvailabilityBlock(karen.id, at(3 * DAY - HOUR), at(3 * DAY + HOUR));
    await assignDriver(staffActor(staff.id), shift.id, {
      driverId: karen.id,
      confirmConflict: true,
    });

    await assignDriver(staffActor(staff.id), shift.id, { driverId: free.id });

    const row = await readShift(shift.id);
    expect(row.owner_id).toBe(free.id);
    // A banner about Karen's conflict must not survive onto the next driver's screen.
    expect(row.assigned_over_conflict).toBe(false);
  });
});

describe('staff assign — what the exemption does not cover', () => {
  it('refuses a user without the Drive duty, confirmation or not', async () => {
    // I20's exemption names availability and owned shifts. A user with no Drive duty
    // (I2 — set membership) is not a driver at all, which is not a conflict to override.
    const staff = await makeUser({ tier: 'STAFF' });
    const receiver = await makeUser({ duties: ['RECEIVE'] });
    const shift = await makeShift({ createdBy: staff.id, startsAt: at(3 * DAY) });

    await expect(
      assignDriver(staffActor(staff.id), shift.id, {
        driverId: receiver.id,
        confirmConflict: true,
      }),
    ).rejects.toMatchObject({ status: 409, details: { error: 'DRIVER_UNAVAILABLE' } });

    expect((await readShift(shift.id)).status).toBe('OPEN');
  });

  it('refuses a deactivated account, confirmation or not (I21)', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    const gone = await makeDriver({ deactivated: true });
    const shift = await makeShift({ createdBy: staff.id, startsAt: at(3 * DAY) });

    await expect(
      assignDriver(staffActor(staff.id), shift.id, {
        driverId: gone.id,
        confirmConflict: true,
      }),
    ).rejects.toMatchObject({ status: 409, message: 'That account is switched off.' });
  });

  it('refuses a run that is already under way (I30 moves stops, not shifts)', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    const driver = await makeDriver();
    const other = await makeDriver();
    const shift = await makeShift({
      createdBy: staff.id,
      ownerId: driver.id,
      status: 'IN_PROGRESS',
      startsAt: at(-HOUR),
      endsAt: at(HOUR),
    });

    await expect(
      assignDriver(staffActor(staff.id), shift.id, { driverId: other.id }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await readShift(shift.id)).owner_id).toBe(driver.id);
  });
});

describe('staff assign — the pre-confirm preview (S1.6)', () => {
  it('returns the warning Staff has to confirm, without writing anything', async () => {
    const karen = await makeDriver({ firstName: 'Karen' });
    const shift = await makeShift({
      createdBy: karen.id,
      startsAt: at(3 * DAY),
      endsAt: at(3 * DAY + 2 * HOUR),
    });
    await makeAvailabilityBlock(karen.id, at(3 * DAY - HOUR), at(3 * DAY + HOUR));

    const preview = await previewAssignment(shift.id, karen.id);

    expect(preview.eligibility.eligible).toBe(false);
    expect(preview.eligibility.reasons).toEqual(['AVAILABILITY_BLOCK']);
    expect(preview.warning).toMatch(/assign anyway\?$/);
    expect((await readShift(shift.id)).status).toBe('OPEN');
  });

  it('has nothing to warn about for a free driver', async () => {
    const driver = await makeDriver();
    const shift = await makeShift({ createdBy: driver.id, startsAt: at(3 * DAY) });

    const preview = await previewAssignment(shift.id, driver.id);
    expect(preview.eligibility.eligible).toBe(true);
    expect(preview.warning).toBeNull();
  });
});

describe('staff unassign', () => {
  it('returns the run to the board and clears both the owner and the flag', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    const karen = await makeDriver({ firstName: 'Karen' });
    const shift = await makeShift({
      createdBy: staff.id,
      startsAt: at(3 * DAY),
      endsAt: at(3 * DAY + 2 * HOUR),
    });
    await makeAvailabilityBlock(karen.id, at(3 * DAY - HOUR), at(3 * DAY + HOUR));
    await assignDriver(staffActor(staff.id), shift.id, {
      driverId: karen.id,
      confirmConflict: true,
    });

    await unassignDriver(staffActor(staff.id), shift.id);

    const row = await readShift(shift.id);
    expect(row.status).toBe('OPEN');
    expect(row.owner_id).toBeNull();
    expect(row.assigned_over_conflict).toBe(false);
    expect(row.updated_by).toBe(staff.id);
  });

  it('tells the eligible drivers — including the one removed — and the other coordinators', async () => {
    // The matrix lists staff unassign under "Shift returns to the board as open →
    // Coordinator + eligible drivers". The ex-owner is eligible again the moment the
    // run leaves them, and unlike a release they did not do this themselves, so they
    // hear about it. The coordinator who performed the unassign does not: nobody is
    // told about their own action.
    const staff = await makeUser({ tier: 'STAFF' });
    const otherCoordinator = await makeUser({ tier: 'ADMIN' });
    const driver = await makeDriver();
    const shift = await makeShift({
      createdBy: staff.id,
      ownerId: driver.id,
      status: 'CLAIMED',
      startsAt: at(3 * DAY),
      endsAt: at(3 * DAY + 2 * HOUR),
    });

    await unassignDriver(staffActor(staff.id), shift.id);

    const rows = await db
      .selectFrom('notification')
      .select(['event', 'recipient_id'])
      .execute();
    expect(rows.every((r) => r.event === 'SHIFT_OPENED')).toBe(true);
    expect(rows.map((r) => r.recipient_id).sort()).toEqual(
      [otherCoordinator.id, driver.id].sort(),
    );
  });

  it('never cancels — the matrix says open, and CANCELLED is terminal', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    const driver = await makeDriver();
    const shift = await makeShift({
      createdBy: staff.id,
      ownerId: driver.id,
      status: 'CLAIMED',
      startsAt: at(3 * DAY),
    });

    await unassignDriver(staffActor(staff.id), shift.id);
    expect((await readShift(shift.id)).status).toBe('OPEN');
  });

  it('refuses a run with no driver to remove', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    const shift = await makeShift({ createdBy: staff.id, startsAt: at(3 * DAY) });

    await expect(unassignDriver(staffActor(staff.id), shift.id)).rejects.toMatchObject({
      status: 409,
      message: 'That run has no driver to remove.',
    });
  });

  it('refuses a run that is already under way', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    const driver = await makeDriver();
    const shift = await makeShift({
      createdBy: staff.id,
      ownerId: driver.id,
      status: 'IN_PROGRESS',
      startsAt: at(-HOUR),
      endsAt: at(HOUR),
    });

    await expect(unassignDriver(staffActor(staff.id), shift.id)).rejects.toMatchObject({
      status: 409,
    });
    expect((await readShift(shift.id)).owner_id).toBe(driver.id);
  });
});
