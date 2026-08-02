// Release — PRD cap 8, S1.3, `domain-modeling.md §5.3` (`release-one` / `release-range`).
//
// Two rules meet here and only one of them is obvious.
//
// The obvious one: `CLAIMED → OPEN`, before start only, driver's own run only, and the
// series keeps generating (I23 — a per-instance release never mutates the pattern).
//
// The other one is `ck_shift_conflict_flag` (migration 0008). Every statement that
// clears `owner_id` must clear `assigned_over_conflict` in the same statement, or the
// transaction raises. `shift-conflict-flag.test.ts` pins the constraint; this file pins
// the service meeting it — including the case that matters, releasing a run Staff
// assigned over a conflict.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/index.js';
import { releaseShift, type CoverageActor } from '../src/services/coverage.js';
import { makeDriver, makeRoute, makeShift, makeUser, resetDatabase } from './fixtures.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function at(offsetMs: number): Date {
  return new Date(Date.now() + offsetMs);
}

function driverActor(id: string): CoverageActor {
  return { id, tier: 'VOLUNTEER' };
}

function dateOf(value: Date): string {
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
}

async function makePattern(createdBy: string, routeId: string) {
  return db
    .insertInto('recurrence_pattern')
    .values({
      route_id: routeId,
      weekdays: [2],
      start_time: '14:00',
      end_time: '16:00',
      created_by: createdBy,
      owner_default_id: createdBy,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

async function makeClaimedInstance(
  patternId: string,
  routeId: string,
  ownerId: string,
  startsAt: Date,
) {
  return db
    .insertInto('shift')
    .values({
      recurrence_pattern_id: patternId,
      route_id: routeId,
      occurrence_date: dateOf(startsAt),
      starts_at: startsAt,
      ends_at: new Date(startsAt.getTime() + 2 * HOUR),
      status: 'CLAIMED',
      owner_id: ownerId,
      created_by: ownerId,
      updated_by: ownerId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

async function readShift(id: string) {
  return db.selectFrom('shift').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
}

beforeEach(resetDatabase);
afterAll(async () => {
  await db.destroy();
  await pool.end().catch(() => undefined);
});

describe('release-one (§5.3, cap 8)', () => {
  it('returns the run to the board and clears the owner', async () => {
    const driver = await makeDriver();
    const shift = await makeShift({
      createdBy: driver.id,
      ownerId: driver.id,
      status: 'CLAIMED',
      startsAt: at(3 * DAY),
    });

    const result = await releaseShift(driverActor(driver.id), shift.id);

    const row = await readShift(shift.id);
    expect(row.status).toBe('OPEN');
    expect(row.owner_id).toBeNull();
    expect(row.updated_by).toBe(driver.id);
    expect(result.released).toHaveLength(1);
    expect(result.summary).toBe("Run cancelled. It's back on the board.");
  });

  // The one migration 0008 warns about: the flag cannot outlive the owner it warns.
  it('clears the conflict flag with the owner', async () => {
    const driver = await makeDriver();
    const shift = await makeShift({
      createdBy: driver.id,
      ownerId: driver.id,
      status: 'CLAIMED',
      startsAt: at(3 * DAY),
    });
    await db
      .updateTable('shift')
      .set({ assigned_over_conflict: true })
      .where('id', '=', shift.id)
      .execute();

    await releaseShift(driverActor(driver.id), shift.id);

    const row = await readShift(shift.id);
    expect(row.owner_id).toBeNull();
    // Had the UPDATE omitted this column, ck_shift_conflict_flag would have raised and
    // the release above would have thrown instead of reaching here.
    expect(row.assigned_over_conflict).toBe(false);
  });

  it('notifies the coordinator and the eligible drivers, but not the releaser', async () => {
    // "Shift returns to the board as open … Coordinator + eligible drivers" (PRD §4).
    const coordinator = await makeUser({ tier: 'STAFF' });
    const driver = await makeDriver();
    const other = await makeDriver();
    const busy = await makeDriver();
    const shift = await makeShift({
      createdBy: coordinator.id,
      ownerId: driver.id,
      status: 'CLAIMED',
      startsAt: at(3 * DAY),
      endsAt: at(3 * DAY + 2 * HOUR),
    });
    // `busy` already owns an overlapping run, so `eligible()` leaves them out.
    await makeShift({
      createdBy: coordinator.id,
      ownerId: busy.id,
      status: 'CLAIMED',
      startsAt: at(3 * DAY + HOUR),
      endsAt: at(3 * DAY + 3 * HOUR),
    });

    await releaseShift(driverActor(driver.id), shift.id);

    const rows = await db
      .selectFrom('notification')
      .select(['event', 'recipient_id', 'shift_id'])
      .execute();
    const recipients = rows.map((r) => r.recipient_id).sort();
    expect(rows.every((r) => r.event === 'SHIFT_OPENED' && r.shift_id === shift.id)).toBe(
      true,
    );
    expect(recipients).toEqual([coordinator.id, other.id].sort());
  });

  // FIXED BY MIGRATION 0009 — this test previously asserted the opposite.
  //
  // The coverage lane found that `uq_notif_shift_event` was `(event, shift_id,
  // recipient_id)` with no filter on which events it covered, while `0006`'s own
  // comment justified it for "shift-scoped, time-triggered events" only, on the
  // grounds that "event-triggered ones fire once by construction". SHIFT_OPENED is
  // event-triggered and does NOT fire once by construction — release → re-claim →
  // release is an ordinary sequence — so the second fan-out was absorbed by the index
  // and nobody was told the run was back on the board. The lane could not fix it
  // (migrations are lead-owned, build-plan §3) and pinned the broken behaviour here
  // instead, which is the only reason it was ever visible.
  //
  // 0009 restricts the index to `event IN ('SHIFT_REMINDER','SHIFT_AT_RISK')`, so the
  // second release now alerts. The assertion is inverted rather than deleted: it is
  // the same question, and it must keep being asked.
  it('alerts again on a second release of the same run', async () => {
    const coordinator = await makeUser({ tier: 'STAFF' });
    const driver = await makeDriver();
    const shift = await makeShift({
      createdBy: coordinator.id,
      ownerId: driver.id,
      status: 'CLAIMED',
      startsAt: at(3 * DAY),
      endsAt: at(3 * DAY + 2 * HOUR),
    });

    await releaseShift(driverActor(driver.id), shift.id);
    await db
      .updateTable('shift')
      .set({ status: 'CLAIMED', owner_id: driver.id })
      .where('id', '=', shift.id)
      .execute();
    await releaseShift(driverActor(driver.id), shift.id);

    const rows = await db
      .selectFrom('notification')
      .select(['event', 'recipient_id'])
      .where('event', '=', 'SHIFT_OPENED')
      .execute();
    // Two rows for the same (event, shift, recipient) — the pair the old index
    // collapsed into one. The coordinator is told both times the run reopened.
    expect(rows).toEqual([
      { event: 'SHIFT_OPENED', recipient_id: coordinator.id },
      { event: 'SHIFT_OPENED', recipient_id: coordinator.id },
    ]);
  });

  it('answers a double-tap with "already back on the board", not "not yours"', async () => {
    const driver = await makeDriver();
    const shift = await makeShift({
      createdBy: driver.id,
      ownerId: driver.id,
      status: 'CLAIMED',
      startsAt: at(3 * DAY),
    });

    await releaseShift(driverActor(driver.id), shift.id);
    await expect(releaseShift(driverActor(driver.id), shift.id)).rejects.toMatchObject({
      status: 409,
      message: 'That run is already back on the board.',
    });
  });

  it('refuses another driver’s run', async () => {
    const driver = await makeDriver();
    const nosy = await makeDriver();
    const shift = await makeShift({
      createdBy: driver.id,
      ownerId: driver.id,
      status: 'CLAIMED',
      startsAt: at(3 * DAY),
    });

    await expect(releaseShift(driverActor(nosy.id), shift.id)).rejects.toMatchObject({
      status: 403,
    });
    expect((await readShift(shift.id)).owner_id).toBe(driver.id);
  });

  it('refuses a run that has already started (cap 8)', async () => {
    const driver = await makeDriver();
    const shift = await makeShift({
      createdBy: driver.id,
      ownerId: driver.id,
      status: 'IN_PROGRESS',
      startsAt: at(-HOUR),
      endsAt: at(HOUR),
    });

    await expect(releaseShift(driverActor(driver.id), shift.id)).rejects.toMatchObject({
      status: 409,
      message: /already started/,
    });
    expect((await readShift(shift.id)).status).toBe('IN_PROGRESS');
  });

  it('refuses a run whose start time has passed, even if it never started', async () => {
    // Claimed and never started is derived NO_SHOW (`§3.1`), not something to hand back.
    const driver = await makeDriver();
    const shift = await makeShift({
      createdBy: driver.id,
      ownerId: driver.id,
      status: 'CLAIMED',
      startsAt: at(-2 * HOUR),
      endsAt: at(-HOUR),
    });

    await expect(releaseShift(driverActor(driver.id), shift.id)).rejects.toMatchObject({
      status: 409,
      message: /start time has passed/,
    });
  });

  it('never touches the pattern (I23)', async () => {
    const driver = await makeDriver();
    const { route } = await makeRoute();
    const pattern = await makePattern(driver.id, route.id);
    const instance = await makeClaimedInstance(pattern.id, route.id, driver.id, at(7 * DAY));

    await releaseShift(driverActor(driver.id), instance.id);

    const after = await db
      .selectFrom('recurrence_pattern')
      .selectAll()
      .where('id', '=', pattern.id)
      .executeTakeFirstOrThrow();
    // ownerDefault unchanged, end_date unchanged: the series keeps generating and keeps
    // minting to this driver. Releasing coverage is not ending a series (§5.3).
    expect(after.owner_default_id).toBe(driver.id);
    expect(after.end_date).toBeNull();
  });
});

describe('release-range (§5.3, S1.3 "this and future")', () => {
  it('releases the runs inside the range and leaves the rest', async () => {
    const driver = await makeDriver();
    const { route } = await makeRoute();
    const pattern = await makePattern(driver.id, route.id);
    const first = await makeClaimedInstance(pattern.id, route.id, driver.id, at(7 * DAY));
    const second = await makeClaimedInstance(pattern.id, route.id, driver.id, at(14 * DAY));
    const beyond = await makeClaimedInstance(pattern.id, route.id, driver.id, at(21 * DAY));

    const result = await releaseShift(driverActor(driver.id), first.id, {
      scope: 'RANGE',
      fromDate: dateOf(at(7 * DAY)),
      toDate: dateOf(at(14 * DAY)),
    });

    expect(result.released.map((r) => r.shiftId).sort()).toEqual(
      [first.id, second.id].sort(),
    );
    expect(result.summary).toBe("Cancelled 2 runs. They're back on the board.");
    expect((await readShift(beyond.id)).status).toBe('CLAIMED');
    expect((await readShift(first.id)).status).toBe('OPEN');
    expect((await readShift(second.id)).owner_id).toBeNull();
  });

  it('runs open-ended when no end date is given — "this and future"', async () => {
    const driver = await makeDriver();
    const { route } = await makeRoute();
    const pattern = await makePattern(driver.id, route.id);
    const earlier = await makeClaimedInstance(pattern.id, route.id, driver.id, at(3 * DAY));
    const from = await makeClaimedInstance(pattern.id, route.id, driver.id, at(10 * DAY));
    const later = await makeClaimedInstance(pattern.id, route.id, driver.id, at(17 * DAY));

    const result = await releaseShift(driverActor(driver.id), from.id, { scope: 'RANGE' });

    expect(result.released.map((r) => r.shiftId).sort()).toEqual([from.id, later.id].sort());
    // Earlier than the run the driver tapped, so outside "this and future".
    expect((await readShift(earlier.id)).status).toBe('CLAIMED');
  });

  it('leaves the pattern generating beyond the range (I23/§5.3)', async () => {
    const driver = await makeDriver();
    const { route } = await makeRoute();
    const pattern = await makePattern(driver.id, route.id);
    const one = await makeClaimedInstance(pattern.id, route.id, driver.id, at(7 * DAY));

    await releaseShift(driverActor(driver.id), one.id, { scope: 'RANGE' });

    const after = await db
      .selectFrom('recurrence_pattern')
      .selectAll()
      .where('id', '=', pattern.id)
      .executeTakeFirstOrThrow();
    expect(after.owner_default_id).toBe(driver.id);
    expect(after.end_date).toBeNull();
  });

  it('is release, not termination — every affected run is OPEN, never CANCELLED', async () => {
    const driver = await makeDriver();
    const { route } = await makeRoute();
    const pattern = await makePattern(driver.id, route.id);
    const one = await makeClaimedInstance(pattern.id, route.id, driver.id, at(7 * DAY));
    const two = await makeClaimedInstance(pattern.id, route.id, driver.id, at(14 * DAY));

    await releaseShift(driverActor(driver.id), one.id, { scope: 'RANGE' });

    const rows = await db.selectFrom('shift').select(['id', 'status']).execute();
    expect(rows.map((r) => r.status)).toEqual(['OPEN', 'OPEN']);
    expect(rows.map((r) => r.id).sort()).toEqual([one.id, two.id].sort());
  });

  it('leaves another driver’s runs in the same series alone', async () => {
    const driver = await makeDriver();
    const other = await makeDriver();
    const { route } = await makeRoute();
    const pattern = await makePattern(driver.id, route.id);
    const mine = await makeClaimedInstance(pattern.id, route.id, driver.id, at(7 * DAY));
    const theirs = await makeClaimedInstance(pattern.id, route.id, other.id, at(14 * DAY));

    const result = await releaseShift(driverActor(driver.id), mine.id, { scope: 'RANGE' });

    expect(result.released).toHaveLength(1);
    expect((await readShift(theirs.id)).owner_id).toBe(other.id);
  });

  it('refuses a range on a one-off run', async () => {
    const driver = await makeDriver();
    const shift = await makeShift({
      createdBy: driver.id,
      ownerId: driver.id,
      status: 'CLAIMED',
      startsAt: at(3 * DAY),
    });

    await expect(
      releaseShift(driverActor(driver.id), shift.id, { scope: 'RANGE' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects a range that ends before it starts', async () => {
    const driver = await makeDriver();
    const { route } = await makeRoute();
    const pattern = await makePattern(driver.id, route.id);
    const one = await makeClaimedInstance(pattern.id, route.id, driver.id, at(7 * DAY));

    await expect(
      releaseShift(driverActor(driver.id), one.id, {
        scope: 'RANGE',
        fromDate: dateOf(at(14 * DAY)),
        toDate: dateOf(at(7 * DAY)),
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
