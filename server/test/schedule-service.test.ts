// Publish, edit, reschedule and cancel a run — `product-requirement.md` caps 4 and 9,
// the staff half of cap 8, `domain-modeling.md §3.1`'s Shift state machine.
//
// Against the MIGRATED database (CLAUDE.md). Three of the rules asserted below exist
// only as real DDL and would pass against anything else:
//
//   * `ck_shift_owner` — OPEN has no owner, CLAIMED has one, CANCELLED has none.
//   * `ck_shift_conflict_flag` — an owner-clearing UPDATE that forgets the flag RAISES
//     (`server/test/shift-conflict-flag.test.ts` pins the constraint itself; this file
//     asserts that cancel and the cap-9 release meet it).
//   * `ck_shift_truck` — I8, no truck before IN_PROGRESS.
//
// D1 is in force: nothing here reaches COMPLETED, and there is no close-run action to
// test, because I11 makes the receiver's receive-done the only completion and the
// receiver ships in Phase 2.

import { sql } from 'kysely';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/index.js';
import { AppError } from '../src/middleware/error.js';
import {
  bulkTerminate,
  cancelShift,
  createShift,
  getShift,
  isoDate,
  listShifts,
  rescheduleShift,
  updateShift,
} from '../src/services/schedule.js';
import { addDays, parseDate } from '../src/time.js';
import {
  makeAdmin,
  makeAvailabilityBlock,
  makeDriver,
  makeRoute,
  makeShift,
  makeTruck,
  makeUser,
  resetDatabase,
} from './fixtures.js';

beforeEach(resetDatabase);

afterAll(async () => {
  await db.destroy();
  await pool.end().catch(() => undefined);
});

/** Pantry-local today, asked of the database the way the service asks it. */
async function pantryToday() {
  const row = await sql<{ today: string }>`
    SELECT to_char((now() AT TIME ZONE (SELECT timezone FROM app_config))::date, 'YYYY-MM-DD')
           AS today
  `.execute(db);
  return parseDate(row.rows[0]!.today, 'today');
}

async function futureDate(days = 7): Promise<string> {
  return isoDate(addDays(await pantryToday(), days));
}

/** The thrown `AppError`, so a test can assert the status and the details envelope
 *  rather than only the message text. */
async function rejection(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected the call to be refused, and it was not');
}

describe('publish a one-off run (cap 4, S1.6)', () => {
  it('creates it OPEN, with no owner and no truck', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    const { route } = await makeRoute(3);
    const date = await futureDate();

    const created = await createShift({ id: staff.id }, {
      routeId: route.id,
      date,
      startTime: '09:00',
      endTime: '11:00',
    });

    const shift = created.shift.shift;
    // Cap 4: "shifts exist independently of any driver". I8: truck is null before
    // IN_PROGRESS — there is no truck field to send.
    expect(shift.status).toBe('OPEN');
    expect(shift.owner_id).toBeNull();
    expect(shift.truck_name).toBeNull();
    expect(shift.occurrence_date).toBe(date);
    // I4 — bound to exactly one route, at schedule time.
    expect(shift.route_id).toBe(route.id);
    // A one-off is `recurrence_pattern_id IS NULL` (`data-model.md §5.3`).
    expect(shift.recurrence_pattern_id).toBeNull();
    expect(created.duplicates).toEqual([]);
  });

  it('resolves the wall clock against the pantry zone, not the process zone', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    const { route } = await makeRoute();

    const created = await createShift({ id: staff.id }, {
      routeId: route.id,
      date: '2026-08-04',
      startTime: '09:00',
      endTime: '11:00',
    });

    // 09:00 America/Chicago on 2026-08-04 is CDT (UTC-5) = 14:00Z. The conversion is
    // `time.ts`'s and is DST-aware; a fixed offset would put this an hour out in
    // winter.
    const shift = created.shift.shift;
    expect(shift.starts_at.toISOString()).toBe('2026-08-04T14:00:00.000Z');
    expect(shift.ends_at.toISOString()).toBe('2026-08-04T16:00:00.000Z');
    // The calendar slot is the pantry's date, carried as text so no zone can move it.
    expect(shift.occurrence_date).toBe('2026-08-04');
  });

  it('carries the planned stops from the ROUTE — I5 means the shift has none yet', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    const { route, donors } = await makeRoute(3);

    const created = await createShift({ id: staff.id }, {
      routeId: route.id,
      date: await futureDate(),
      startTime: '09:00',
      endTime: '11:00',
    });

    expect(created.shift.plannedStops.map((s) => s.donor_id)).toEqual(
      donors.map((d) => d.id),
    );
    // I5: `shift_stop` rows exist only from IN_PROGRESS onward.
    const snapshots = await db
      .selectFrom('shift_stop')
      .selectAll()
      .where('shift_id', '=', created.shift.shift.id)
      .execute();
    expect(snapshots).toEqual([]);
    // Donor address rides through untrimmed — `pii.ts` gates people, not places.
    expect(created.shift.plannedStops[0]!.donor_address).not.toBeNull();
  });

  it('refuses an overnight window, an archived route, and a route with no stores', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    const { route } = await makeRoute();
    const date = await futureDate();

    // §5.3's intra-day rule. `ck_shift_window` only knows `ends_at > starts_at`, which
    // an overnight window satisfies, so the service is what holds this.
    await expect(
      createShift({ id: staff.id }, {
        routeId: route.id,
        date,
        startTime: '22:00',
        endTime: '02:00',
      }),
    ).rejects.toThrow(/later in the day/);

    // I21 — archived is hidden from new use, and scheduling is new use.
    const archived = await makeRoute();
    await db
      .updateTable('route')
      .set({ deactivated_at: new Date() })
      .where('id', '=', archived.route.id)
      .execute();
    await expect(
      createShift({ id: staff.id }, {
        routeId: archived.route.id,
        date,
        startTime: '09:00',
        endTime: '11:00',
      }),
    ).rejects.toThrow(/archived/);

    // `domain-modeling.md §2.2`: a Route contains 1..N RouteStops, so a run against an
    // empty one would start into an empty snapshot.
    const empty = await makeRoute(0);
    await expect(
      createShift({ id: staff.id }, {
        routeId: empty.route.id,
        date,
        startTime: '09:00',
        endTime: '11:00',
      }),
    ).rejects.toThrow(/no stores/);
  });

  it('warns about a duplicate run from a different pattern, and never blocks it', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    const admin = await makeAdmin();
    const { route } = await makeRoute(2);

    // A pattern-minted run in the same slot, same window, same stop set. That is
    // `data-model.md §5.3`'s `real_conflict`, which is a SOFT check.
    const pattern = await db
      .insertInto('recurrence_pattern')
      .values({
        route_id: route.id,
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        start_time: '09:00',
        end_time: '11:00',
        created_by: admin.id,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await db
      .insertInto('shift')
      .values({
        recurrence_pattern_id: pattern.id,
        route_id: route.id,
        occurrence_date: '2026-08-04',
        starts_at: new Date('2026-08-04T14:00:00Z'),
        ends_at: new Date('2026-08-04T16:00:00Z'),
        created_by: admin.id,
        updated_by: admin.id,
      })
      .execute();

    const created = await createShift({ id: staff.id }, {
      routeId: route.id,
      date: '2026-08-04',
      startTime: '09:00',
      endTime: '11:00',
    });

    // Warned...
    expect(created.duplicates).toHaveLength(1);
    expect(created.duplicates[0]!.occurrenceDate).toBe('2026-08-04');
    // ...and written anyway. There is no unique index behind this, deliberately:
    // cross-pattern overlapping runs are legitimate.
    expect(created.shift.shift.id).toBeDefined();
  });

  it('does not call two one-offs a duplicate — §5.3 is IS DISTINCT FROM', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    const { route } = await makeRoute(2);
    const date = await futureDate();
    const params = { routeId: route.id, date, startTime: '09:00', endTime: '11:00' };

    await createShift({ id: staff.id }, params);
    const second = await createShift({ id: staff.id }, params);

    // `NULL IS DISTINCT FROM NULL` is false, so a one-off never conflicts with another
    // one-off — staff published each deliberately. It is also why PG's default
    // NULLS DISTINCT on `uq_shift_occurrence` must not become NULLS NOT DISTINCT.
    expect(second.duplicates).toEqual([]);
    expect(await listShifts({ fromDate: date, toDate: date })).toHaveLength(2);
  });
});

describe('edit one instance (§5.3 edit-one, I23)', () => {
  it('sets and clears the staff note', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    const shift = await makeShift();

    const noted = await updateShift({ id: staff.id }, shift.id, {
      staffNote: 'Gate code 4417.',
    });
    // PRD cap 11 channel 1: coordinator→driver, its own column, sharing storage with
    // none of the other three note channels.
    expect(noted.staff_note).toBe('Gate code 4417.');
    expect(noted.note).toBeNull();

    const cleared = await updateShift({ id: staff.id }, shift.id, { staffNote: null });
    expect(cleared.staff_note).toBeNull();
    // Last writer stamped (I26).
    expect(
      (await db
        .selectFrom('shift')
        .select('updated_by')
        .where('id', '=', shift.id)
        .executeTakeFirstOrThrow()).updated_by,
    ).toBe(staff.id);
  });

  it('refuses an unknown run and an empty edit', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    const shift = await makeShift();

    expect(
      (await rejection(
        updateShift({ id: staff.id }, '00000000-0000-0000-0000-000000000000', {
          staffNote: 'x',
        }),
      )).status,
    ).toBe(404);
    expect((await rejection(updateShift({ id: staff.id }, shift.id, {}))).status).toBe(400);
    // A malformed id is a thing that does not exist, not a 500 from PG's 22P02.
    expect(
      (await rejection(updateShift({ id: staff.id }, 'not-an-id', { staffNote: 'x' })))
        .status,
    ).toBe(404);
  });
});

describe('reschedule (cap 9, S1.7)', () => {
  it('moves an unowned run with no ceremony', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    const shift = await makeShift({ status: 'OPEN' });

    const moved = await rescheduleShift({ id: staff.id }, shift.id, {
      date: '2026-09-15',
      startTime: '07:30',
      endTime: '09:30',
    });

    expect(moved.released).toBe(false);
    expect(moved.shift.occurrence_date).toBe('2026-09-15');
    expect(moved.shift.starts_at.toISOString()).toBe('2026-09-15T12:30:00.000Z');
    expect(moved.shift.status).toBe('OPEN');
  });

  it('keeps the owner when the new window is clear — cap 9’s default', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    const driver = await makeDriver();
    const shift = await makeShift({ status: 'CLAIMED', ownerId: driver.id });

    const moved = await rescheduleShift({ id: staff.id }, shift.id, {
      date: '2026-09-15',
      startTime: '07:30',
      endTime: '09:30',
    });

    expect(moved.released).toBe(false);
    expect(moved.shift.status).toBe('CLAIMED');
    expect(moved.shift.owner_id).toBe(driver.id);
  });

  it('refuses an unconfirmed move onto the owner’s declared unavailability', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    const driver = await makeDriver({ firstName: 'Karen', lastName: 'Diaz' });
    const shift = await makeShift({ status: 'CLAIMED', ownerId: driver.id });
    await makeAvailabilityBlock(
      driver.id,
      new Date('2026-09-15T00:00:00Z'),
      new Date('2026-09-16T00:00:00Z'),
    );

    const error = await rejection(
      rescheduleShift({ id: staff.id }, shift.id, {
        date: '2026-09-15',
        startTime: '07:30',
        endTime: '09:30',
      }),
    );

    expect(error.status).toBe(409);
    // S1.7's copy, built in `shared/` so the server and the client cannot word it
    // differently. Third person plural — the schema stores no gender.
    expect(error.message).toBe(
      'Karen Diaz marked themselves away then. Moving this releases their run back to the board.',
    );
    expect(error.details).toMatchObject({ error: 'RESCHEDULE_CONFLICT' });
    expect((error.details!['conflicts'] as unknown[])).toHaveLength(1);

    // Refused means nothing moved.
    const after = await getShift(shift.id);
    expect(after!.shift.occurrence_date).not.toBe('2026-09-15');
    expect(after!.shift.owner_id).toBe(driver.id);
  });

  it('reports the owner’s other owned run as a conflict, excluding the run being moved', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    const driver = await makeDriver();
    const shift = await makeShift({ status: 'CLAIMED', ownerId: driver.id });
    const other = await makeShift({
      status: 'CLAIMED',
      ownerId: driver.id,
      startsAt: new Date('2026-09-15T13:00:00Z'),
      endsAt: new Date('2026-09-15T15:00:00Z'),
    });

    const error = await rejection(
      rescheduleShift({ id: staff.id }, shift.id, {
        date: '2026-09-15',
        startTime: '07:30',
        endTime: '09:30',
      }),
    );

    // I20's second clause. `S ≠ shift` — a run never disqualifies itself, which is why
    // moving a run onto a window it already overlaps is not a conflict with itself.
    const conflicts = error.details!['conflicts'] as { kind: string; shiftId?: string }[];
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.kind).toBe('OWNED_SHIFT');
    expect(conflicts[0]!.shiftId).toBe(other.id);
  });

  it('on confirm: moves the run, releases the owner, and clears the conflict flag with it', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    const driver = await makeDriver();
    const shift = await makeShift({ status: 'CLAIMED', ownerId: driver.id });
    // Staff had assigned this driver through a conflict (I20's exemption), so the row
    // carries the banner flag. Releasing must take it down in the SAME statement or
    // `ck_shift_conflict_flag` raises.
    await db
      .updateTable('shift')
      .set({ assigned_over_conflict: true })
      .where('id', '=', shift.id)
      .execute();
    await makeAvailabilityBlock(
      driver.id,
      new Date('2026-09-15T00:00:00Z'),
      new Date('2026-09-16T00:00:00Z'),
    );

    const moved = await rescheduleShift({ id: staff.id }, shift.id, {
      date: '2026-09-15',
      startTime: '07:30',
      endTime: '09:30',
      confirmRelease: true,
    });

    expect(moved.released).toBe(true);
    // "the owner is released and the shift returns to the board" (cap 9).
    expect(moved.shift.status).toBe('OPEN');
    expect(moved.shift.owner_id).toBeNull();
    expect(moved.shift.assigned_over_conflict).toBe(false);
    expect(moved.shift.occurrence_date).toBe('2026-09-15');
    // "The system never auto-selects a replacement person."
    expect(
      await db
        .selectFrom('shift')
        .select('owner_id')
        .where('id', '=', shift.id)
        .executeTakeFirstOrThrow(),
    ).toEqual({ owner_id: null });
  });

  it('notifies the coordinator and the eligible drivers when the release reopens it', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    const driver = await makeDriver();
    const bystander = await makeDriver();
    const shift = await makeShift({ status: 'CLAIMED', ownerId: driver.id });
    await makeAvailabilityBlock(
      driver.id,
      new Date('2026-09-15T00:00:00Z'),
      new Date('2026-09-16T00:00:00Z'),
    );

    await rescheduleShift({ id: staff.id }, shift.id, {
      date: '2026-09-15',
      startTime: '07:30',
      endTime: '09:30',
      confirmRelease: true,
    });

    const notified = await db
      .selectFrom('notification')
      .select(['event', 'recipient_id', 'shift_id'])
      .where('shift_id', '=', shift.id)
      .execute();

    // "Shift returns to the board as open — release (cap 8), reschedule conflict
    // (cap 9), or staff unassign → Coordinator + eligible drivers" (§4 matrix).
    expect(notified.every((row) => row.event === 'SHIFT_OPENED')).toBe(true);
    const recipients = notified.map((row) => row.recipient_id);
    expect(recipients).toContain(staff.id);
    expect(recipients).toContain(bystander.id);
    // The released driver is away then, so they are not an eligible driver for it.
    expect(recipients).not.toContain(driver.id);
  });

  it('refuses to move a started or terminal run', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    const driver = await makeDriver();
    const truck = await makeTruck();
    const started = await makeShift({
      status: 'IN_PROGRESS',
      ownerId: driver.id,
      truckId: truck.id,
    });
    const cancelled = await makeShift({ status: 'CANCELLED' });
    const move = { date: '2026-09-15', startTime: '07:30', endTime: '09:30' };

    // A started run has a truck, a snapshot and a driver mid-route (I5/I8); a terminal
    // one is terminal (I10).
    expect((await rejection(rescheduleShift({ id: staff.id }, started.id, move))).status)
      .toBe(409);
    expect((await rejection(rescheduleShift({ id: staff.id }, cancelled.id, move))).status)
      .toBe(409);
  });
});

describe('cancel (staff removes — §3.1) and bulk-terminate (§5.3)', () => {
  it('cancels an OPEN run', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    const shift = await makeShift({ status: 'OPEN' });

    const cancelled = await cancelShift({ id: staff.id }, shift.id);

    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.owner_id).toBeNull();
  });

  it('cancels a CLAIMED run, clearing the owner and the flag in one statement', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    const driver = await makeDriver();
    const shift = await makeShift({ status: 'CLAIMED', ownerId: driver.id });
    await db
      .updateTable('shift')
      .set({ assigned_over_conflict: true })
      .where('id', '=', shift.id)
      .execute();

    const cancelled = await cancelShift({ id: staff.id }, shift.id);

    // `domain-modeling.md §2.2` (LOCKED): cancel clears `owner_id`; the prior owner's
    // identity is deliberately NOT retained on the row. `ck_shift_conflict_flag` then
    // requires the flag to go in the same UPDATE, or the transaction raises.
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.owner_id).toBeNull();
    expect(cancelled.assigned_over_conflict).toBe(false);
    // `updated_by` is the canceller, possibly staff (`data-model.md §5.3`) — the only
    // record left of who bumped the driver, since the row does not keep the driver.
    expect(
      (await db
        .selectFrom('shift')
        .select('updated_by')
        .where('id', '=', shift.id)
        .executeTakeFirstOrThrow()).updated_by,
    ).toBe(staff.id);
  });

  it('refuses to cancel from IN_PROGRESS (I9) or a second time (I10)', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    const driver = await makeDriver();
    const truck = await makeTruck();
    const started = await makeShift({
      status: 'IN_PROGRESS',
      ownerId: driver.id,
      truckId: truck.id,
    });

    // The predicate carries I9. The refusal is a sentence, not a constraint violation.
    const error = await rejection(cancelShift({ id: staff.id }, started.id));
    expect(error.status).toBe(409);
    expect(error.message).toMatch(/already started or finished/);

    const open = await makeShift({ status: 'OPEN' });
    await cancelShift({ id: staff.id }, open.id);
    // I10 — CANCELLED is terminal, so the second cancel matches no row.
    expect((await rejection(cancelShift({ id: staff.id }, open.id))).status).toBe(409);
  });

  it('sends no notification — the matrix has no cancelled-run event', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    const driver = await makeDriver();
    await makeDriver();
    const shift = await makeShift({ status: 'CLAIMED', ownerId: driver.id });

    await cancelShift({ id: staff.id }, shift.id);

    // "Never from CANCELLED, which is terminal" (§4 matrix, board-reopened row).
    expect(await db.selectFrom('notification').selectAll().execute()).toEqual([]);
  });

  it('takes a cancelled run off the board unless it is asked for', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    const shift = await makeShift({ status: 'OPEN' });
    await cancelShift({ id: staff.id }, shift.id);

    // S1.2's state list has no cancelled chip and I10 makes the state terminal.
    expect(await listShifts()).toEqual([]);
    expect(await listShifts({ includeCancelled: true })).toHaveLength(1);
  });

  it('bulk-terminate skips the rows I9/I10 forbid rather than failing the batch', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    const admin = await makeAdmin();
    const driver = await makeDriver();
    const truck = await makeTruck();
    const { route } = await makeRoute();
    const pattern = await db
      .insertInto('recurrence_pattern')
      .values({
        route_id: route.id,
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        start_time: '09:00',
        end_time: '11:00',
        created_by: admin.id,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const dates = ['2026-08-04', '2026-08-05', '2026-08-06'];
    const rows = [];
    for (const [index, date] of dates.entries()) {
      rows.push(
        await db
          .insertInto('shift')
          .values({
            recurrence_pattern_id: pattern.id,
            route_id: route.id,
            occurrence_date: date,
            starts_at: new Date(`${date}T14:00:00Z`),
            ends_at: new Date(`${date}T16:00:00Z`),
            // The middle one is already running and must survive (I9).
            status: index === 1 ? 'IN_PROGRESS' : 'OPEN',
            owner_id: index === 1 ? driver.id : null,
            truck_id: index === 1 ? truck.id : null,
            created_by: admin.id,
            updated_by: admin.id,
          })
          .returningAll()
          .executeTakeFirstOrThrow(),
      );
    }

    const cancelled = await bulkTerminate(
      { id: staff.id },
      pattern.id,
      '2026-08-04',
      '2026-08-06',
    );

    expect(cancelled).toBe(2);
    const after = await db
      .selectFrom('shift')
      .select(['id', 'status'])
      .where('recurrence_pattern_id', '=', pattern.id)
      .orderBy('occurrence_date')
      .execute();
    expect(after.map((row) => row.status)).toEqual([
      'CANCELLED',
      'IN_PROGRESS',
      'CANCELLED',
    ]);
  });

  it('bulk-terminate refuses a backwards range and an unknown pattern', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    expect(
      (await rejection(
        bulkTerminate(
          { id: staff.id },
          '00000000-0000-0000-0000-000000000000',
          '2026-08-06',
          '2026-08-04',
        ),
      )).status,
    ).toBe(400);
    expect(
      (await rejection(
        bulkTerminate(
          { id: staff.id },
          '00000000-0000-0000-0000-000000000000',
          '2026-08-04',
          '2026-08-06',
        ),
      )).status,
    ).toBe(404);
  });
});

describe('the board query (cap 5, S1.2)', () => {
  it('filters by window, owner, open-only and pattern, ordered by start', async () => {
    const driver = await makeDriver();
    const early = await makeShift({
      startsAt: new Date('2026-08-04T14:00:00Z'),
      endsAt: new Date('2026-08-04T16:00:00Z'),
    });
    const late = await makeShift({
      status: 'CLAIMED',
      ownerId: driver.id,
      startsAt: new Date('2026-08-06T14:00:00Z'),
      endsAt: new Date('2026-08-06T16:00:00Z'),
    });

    expect((await listShifts()).map((s) => s.id)).toEqual([early.id, late.id]);
    expect(
      (await listShifts({ fromDate: '2026-08-05', toDate: '2026-08-07' })).map((s) => s.id),
    ).toEqual([late.id]);
    expect((await listShifts({ ownerId: driver.id })).map((s) => s.id)).toEqual([late.id]);
    expect((await listShifts({ openOnly: true })).map((s) => s.id)).toEqual([early.id]);
  });

  it('carries the owner’s name — public-within-org, never PII-shaped', async () => {
    const driver = await makeDriver({ firstName: 'Karen', lastName: 'Diaz' });
    await makeShift({ status: 'CLAIMED', ownerId: driver.id });

    const [shift] = await listShifts();
    // `product-requirement.md §2`: names are shown on the shared board by design so
    // drivers see who owns each run. `pii.ts` gates phone and address, not names.
    expect(shift!.owner_first_name).toBe('Karen');
    expect(shift!.owner_last_name).toBe('Diaz');
  });
});
