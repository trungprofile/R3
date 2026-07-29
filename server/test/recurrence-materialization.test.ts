// `domain-modeling.md §5.3` — eager-to-horizon materialization, and I25's born-CLAIMED
// gate.
//
// Against the MIGRATED database (CLAUDE.md), because the two things this file is
// mostly about exist only as real DDL: `uq_shift_occurrence` is what makes the sweep
// idempotent (`data-model.md §9`), and `ck_shift_owner` is what makes "born CLAIMED"
// and "born OPEN" two genuinely different rows rather than two branches of the same
// one. A fixture schema would let a broken gate pass here and fail in production.
//
// The horizon is narrowed to a fortnight for these tests and restored afterwards. It
// is an ops knob by design (`data-model.md §2`: "system config, not domain fields"),
// and a year of instances per pattern would make every assertion below a count nobody
// can read.

import { sql } from 'kysely';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/index.js';
import { materializationJob } from '../src/jobs/materialization.js';
import {
  createPattern,
  isoWeekday,
  materializeDuePatterns,
  materializePattern,
  occurrenceDates,
  updatePattern,
} from '../src/services/recurrence.js';
import { bulkTerminate, cancelShift, isoDate, updateShift } from '../src/services/schedule.js';
import { addDays, parseDate } from '../src/time.js';
import {
  makeAdmin,
  makeAvailabilityBlock,
  makeDriver,
  makeRoute,
  makeUser,
  resetDatabase,
} from './fixtures.js';

const HORIZON_DAYS = 14;

beforeEach(async () => {
  await resetDatabase();
  await db.updateTable('app_config').set({ horizon_days: HORIZON_DAYS }).execute();
});

afterAll(async () => {
  await db.updateTable('app_config').set({ horizon_days: 365 }).execute();
  await db.destroy();
  await pool.end().catch(() => undefined);
});

/** Pantry-local today, asked of the database exactly as the service asks it. */
async function pantryToday(): Promise<{ year: number; month: number; day: number }> {
  const row = await sql<{ today: string }>`
    SELECT to_char((now() AT TIME ZONE (SELECT timezone FROM app_config))::date, 'YYYY-MM-DD')
           AS today
  `.execute(db);
  return parseDate(row.rows[0]!.today, 'today');
}

/**
 * A pattern row written directly, WITHOUT `createPattern`'s eager materialization.
 *
 * This is the fixture the sweep exists for: a pattern the job has never seen. It is
 * also the only honest way to test "a missed tick self-heals" — the alternative,
 * deleting rows a service just wrote, tests the delete.
 */
async function makeUnmaterializedPattern(options: {
  weekdays: number[];
  ownerDefaultId?: string | null;
  endDate?: string | null;
  startTime?: string;
  endTime?: string;
}) {
  const author = await makeAdmin();
  const { route } = await makeRoute();
  const pattern = await db
    .insertInto('recurrence_pattern')
    .values({
      route_id: route.id,
      weekdays: options.weekdays,
      start_time: options.startTime ?? '09:00',
      end_time: options.endTime ?? '11:00',
      end_date: options.endDate ?? null,
      owner_default_id: options.ownerDefaultId ?? null,
      created_by: author.id,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return { pattern, route, author };
}

async function instancesOf(patternId: string) {
  return db
    .selectFrom('shift')
    .select([
      'id',
      'status',
      'owner_id',
      'starts_at',
      'ends_at',
      'created_by',
      'assigned_over_conflict',
      sql<string>`to_char(occurrence_date, 'YYYY-MM-DD')`.as('occurrence_date'),
    ])
    .where('recurrence_pattern_id', '=', patternId)
    .orderBy('occurrence_date')
    .execute();
}

/** Every ISO weekday, so a pattern mints one instance per day in range and the
 *  assertions are about the algorithm rather than about which day it is today. */
const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];

describe('§5.3 — the sweep is a catch-up question, not a schedule', () => {
  it('mints every occurrence in range for a pattern it has never seen', async () => {
    const { pattern } = await makeUnmaterializedPattern({ weekdays: EVERY_DAY });
    expect(await instancesOf(pattern.id)).toHaveLength(0);

    // §4.4: the job asks the database what is due and unhandled. It was never told
    // this pattern exists; it finds it because it looks.
    await materializationJob.run();

    const minted = await instancesOf(pattern.id);
    // Today's 09:00 window has already passed by the time most test runs happen, so
    // the count is the horizon's days give or take today's own occurrence.
    expect(minted.length).toBeGreaterThanOrEqual(HORIZON_DAYS);
    expect(minted.length).toBeLessThanOrEqual(HORIZON_DAYS + 1);
    expect(new Set(minted.map((row) => row.occurrence_date)).size).toBe(minted.length);
  });

  it('mints NOTHING on a second pass — `uq_shift_occurrence` + ON CONFLICT DO NOTHING', async () => {
    const { pattern } = await makeUnmaterializedPattern({ weekdays: EVERY_DAY });

    const first = await materializeDuePatterns();
    const before = await instancesOf(pattern.id);
    expect(first.created).toBe(before.length);

    // Re-run twice more. `data-model.md §9`: the insert is retry-safe, so being run
    // late, twice, or after an outage costs nothing.
    const second = await materializeDuePatterns();
    await materializationJob.run();

    expect(second.created).toBe(0);
    const after = await instancesOf(pattern.id);
    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
  });

  it('self-heals a gap: the occurrences a missed tick skipped are re-minted, and only those', async () => {
    const { pattern } = await makeUnmaterializedPattern({ weekdays: EVERY_DAY });
    await materializationJob.run();

    const full = await instancesOf(pattern.id);
    // The box was off for three days in the middle of the window.
    const missing = full.slice(2, 5);
    await db
      .deleteFrom('shift')
      .where(
        'id',
        'in',
        missing.map((row) => row.id),
      )
      .execute();
    expect(await instancesOf(pattern.id)).toHaveLength(full.length - 3);

    const healed = await materializeDuePatterns();

    // Exactly the gap, nothing else. The question is "which occurrences in range have
    // no row?", so the answer scales with the damage rather than with the horizon.
    expect(healed.created).toBe(3);
    const after = await instancesOf(pattern.id);
    expect(after.map((r) => r.occurrence_date)).toEqual(
      full.map((r) => r.occurrence_date),
    );
  });

  it('stops at `end_date`, the only stop condition — and does not resume', async () => {
    const today = await pantryToday();
    const endDate = isoDate(addDays(today, 3));
    const { pattern } = await makeUnmaterializedPattern({
      weekdays: EVERY_DAY,
      endDate,
    });

    await materializationJob.run();

    const minted = await instancesOf(pattern.id);
    expect(minted.length).toBeGreaterThan(0);
    for (const instance of minted) {
      expect(instance.occurrence_date <= endDate).toBe(true);
    }
    // There is no active/paused flag to disagree with `end_date` (§5.3), and a second
    // pass finds nothing past it either.
    expect((await materializeDuePatterns()).created).toBe(0);
  });

  it('does not retract already-materialized instances when an end date is set later', async () => {
    const { pattern } = await makeUnmaterializedPattern({ weekdays: EVERY_DAY });
    await materializationJob.run();
    const before = await instancesOf(pattern.id);

    const today = await pantryToday();
    await updatePattern({ id: (await makeAdmin()).id }, pattern.id, {
      endDate: isoDate(addDays(today, 2)),
    });

    // §5.3: "neither stopping mechanism retracts already-materialized instances" —
    // ending part of a series is staff's explicit bulk-terminate.
    const after = await instancesOf(pattern.id);
    expect(after).toHaveLength(before.length);
    expect(after.every((row) => row.status !== 'CANCELLED')).toBe(true);
  });

  it('visits every pattern in one pass, each in its own transaction', async () => {
    // A transaction per pattern (`architecture.md §4.1` puts the boundary at the use
    // case), which is also what lets the sweep's `failed` list exist: one series that
    // throws is retried by the next pass rather than taking the roster down with it.
    // That branch is not exercised here — see this wave's report.
    const first = await makeUnmaterializedPattern({ weekdays: EVERY_DAY });
    const second = await makeUnmaterializedPattern({ weekdays: EVERY_DAY });

    const result = await materializeDuePatterns();

    expect(result.patterns).toBe(2);
    expect(result.failed).toEqual([]);
    const minted = [
      await instancesOf(first.pattern.id),
      await instancesOf(second.pattern.id),
    ];
    expect(minted[0]!.length).toBeGreaterThan(0);
    expect(minted[1]!.length).toBeGreaterThan(0);
    expect(result.created).toBe(minted[0]!.length + minted[1]!.length);
  });

  it('stamps the minted shift with the PATTERN’s author — there is no system user', async () => {
    const { pattern, author } = await makeUnmaterializedPattern({ weekdays: EVERY_DAY });
    await materializationJob.run();

    // `data-model.md §5.3`: a minted shift's `created_by = recurrence_pattern.created_by`.
    for (const instance of await instancesOf(pattern.id)) {
      expect(instance.created_by).toBe(author.id);
    }
  });
});

describe('I25 — born CLAIMED only if ownerDefault is set AND eligible() holds', () => {
  it('born CLAIMED when the default owner is eligible for that instance', async () => {
    const driver = await makeDriver();
    const { pattern } = await makeUnmaterializedPattern({
      weekdays: EVERY_DAY,
      ownerDefaultId: driver.id,
    });

    const result = await materializePattern(pattern.id);
    const minted = await instancesOf(pattern.id);

    expect(minted.length).toBeGreaterThan(0);
    expect(result.bornClaimed).toBe(result.created);
    for (const instance of minted) {
      expect(instance.status).toBe('CLAIMED');
      expect(instance.owner_id).toBe(driver.id);
      // Materialization is gated by eligible(), so it can never produce a conflicting
      // assignment — I20's staff-assign exemption is the only thing that sets this.
      expect(instance.assigned_over_conflict).toBe(false);
    }
  });

  it('born OPEN for the one instance the owner blocked, CLAIMED for the rest', async () => {
    const driver = await makeDriver();
    const { pattern } = await makeUnmaterializedPattern({
      weekdays: EVERY_DAY,
      ownerDefaultId: driver.id,
      startTime: '09:00',
      endTime: '11:00',
    });

    // A block declared BEFORE the conflicting instance exists. This is exactly the
    // case §5.3 says the gate is for: without it, the block would never be checked
    // against that instance, because the row did not exist when the block was saved.
    const today = await pantryToday();
    const blockedDate = addDays(today, 5);
    const blocked = isoDate(blockedDate);
    await makeAvailabilityBlock(
      driver.id,
      new Date(`${blocked}T00:00:00Z`),
      new Date(`${blocked}T23:59:00Z`),
    );

    await materializePattern(pattern.id);
    const minted = await instancesOf(pattern.id);

    const blockedInstance = minted.find((row) => row.occurrence_date === blocked);
    expect(blockedInstance).toBeDefined();
    expect(blockedInstance!.status).toBe('OPEN');
    expect(blockedInstance!.owner_id).toBeNull();

    for (const instance of minted.filter((row) => row.occurrence_date !== blocked)) {
      expect(instance.status).toBe('CLAIMED');
      expect(instance.owner_id).toBe(driver.id);
    }
  });

  it('born OPEN when there is no ownerDefault at all', async () => {
    const { pattern } = await makeUnmaterializedPattern({ weekdays: EVERY_DAY });
    const result = await materializePattern(pattern.id);

    expect(result.bornClaimed).toBe(0);
    for (const instance of await instancesOf(pattern.id)) {
      expect(instance.status).toBe('OPEN');
      expect(instance.owner_id).toBeNull();
    }
  });

  it('born OPEN when the ownerDefault was DEACTIVATED — the clause materialization is the reason for', async () => {
    // `domain-modeling.md §5.2`'s first conjunct, added 2026-07-28. Claim and
    // availability declaration are unreachable for a soft-deleted account (it cannot
    // sign in); materialization is not — it needs no login. Without this the pattern
    // keeps minting runs born CLAIMED to a dead account, which never appear open and
    // which the person named on them cannot act on.
    const driver = await makeDriver({ deactivated: true });
    const { pattern } = await makeUnmaterializedPattern({
      weekdays: EVERY_DAY,
      ownerDefaultId: driver.id,
    });

    const result = await materializePattern(pattern.id);

    expect(result.created).toBeGreaterThan(0);
    expect(result.bornClaimed).toBe(0);
    for (const instance of await instancesOf(pattern.id)) {
      expect(instance.status).toBe('OPEN');
      expect(instance.owner_id).toBeNull();
    }
  });

  it('born OPEN when the ownerDefault does not hold the Drive duty', async () => {
    // I2 is set membership; holding RECEIVE says nothing about DRIVE, and no tier
    // substitutes for it.
    const receiver = await makeUser({ tier: 'STAFF', duties: ['RECEIVE'] });
    const { pattern } = await makeUnmaterializedPattern({
      weekdays: EVERY_DAY,
      ownerDefaultId: receiver.id,
    });

    expect((await materializePattern(pattern.id)).bornClaimed).toBe(0);
    expect(
      (await instancesOf(pattern.id)).every((row) => row.status === 'OPEN'),
    ).toBe(true);
  });

  it('born OPEN for an instance overlapping a run the owner already holds', async () => {
    const driver = await makeDriver();
    const { pattern: first } = await makeUnmaterializedPattern({
      weekdays: EVERY_DAY,
      ownerDefaultId: driver.id,
      startTime: '09:00',
      endTime: '11:00',
    });
    await materializePattern(first.id);

    // A second series in the same window. Every one of its instances overlaps an
    // instance of the first that this driver now owns (I20).
    const { pattern: second } = await makeUnmaterializedPattern({
      weekdays: EVERY_DAY,
      ownerDefaultId: driver.id,
      startTime: '10:00',
      endTime: '12:00',
    });
    const result = await materializePattern(second.id);

    expect(result.created).toBeGreaterThan(0);
    expect(result.bornClaimed).toBe(0);
  });
});

describe('I23 / I24 — the pattern changes only by an explicit pattern-level edit', () => {
  /** The whole row, so a change to any column shows up rather than only the ones a
   *  test remembered to name. */
  async function patternRow(id: string) {
    return db
      .selectFrom('recurrence_pattern')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
  }

  async function seeded() {
    const driver = await makeDriver();
    const { pattern } = await makeUnmaterializedPattern({
      weekdays: EVERY_DAY,
      ownerDefaultId: driver.id,
    });
    await materializePattern(pattern.id);
    const instances = await instancesOf(pattern.id);
    const staff = await makeUser({ tier: 'STAFF' });
    return { pattern, instances, staff, driver };
  }

  it('edit-one leaves the pattern untouched', async () => {
    const { pattern, instances, staff } = await seeded();
    const before = await patternRow(pattern.id);

    await updateShift({ id: staff.id }, instances[1]!.id, {
      staffNote: 'Ring the bell at the loading dock.',
    });

    expect(await patternRow(pattern.id)).toEqual(before);
    const edited = await db
      .selectFrom('shift')
      .select(['staff_note', 'recurrence_pattern_id'])
      .where('id', '=', instances[1]!.id)
      .executeTakeFirstOrThrow();
    // Still minted from the pattern; the edit did not detach it either.
    expect(edited.recurrence_pattern_id).toBe(pattern.id);
    expect(edited.staff_note).toBe('Ring the bell at the loading dock.');
  });

  it('cancelling one instance leaves the pattern untouched', async () => {
    const { pattern, instances, staff } = await seeded();
    const before = await patternRow(pattern.id);

    const cancelled = await cancelShift({ id: staff.id }, instances[2]!.id);

    expect(cancelled.status).toBe('CANCELLED');
    expect(await patternRow(pattern.id)).toEqual(before);
    // I23 is about the pattern, so the series keeps generating: the sweep does not
    // resurrect the cancelled date (`uq_shift_occurrence` still holds it) and does not
    // touch the others.
    expect((await materializeDuePatterns()).created).toBe(0);
  });

  it('bulk-terminate cancels the range and still leaves the pattern untouched', async () => {
    const { pattern, instances, staff } = await seeded();
    const before = await patternRow(pattern.id);

    const from = instances[1]!.occurrence_date;
    const to = instances[3]!.occurrence_date;
    const cancelled = await bulkTerminate({ id: staff.id }, pattern.id, from, to);

    expect(cancelled).toBe(3);
    // §5.3: bulk-terminate does not end the pattern — `end_date` is untouched, so the
    // series keeps generating beyond the range unless staff also sets it.
    expect(await patternRow(pattern.id)).toEqual(before);
    expect(before.end_date).toBeNull();

    const after = await instancesOf(pattern.id);
    for (const instance of after) {
      const inRange =
        instance.occurrence_date >= from && instance.occurrence_date <= to;
      expect(instance.status).toBe(inRange ? 'CANCELLED' : 'CLAIMED');
      // `ck_shift_conflict_flag`: an owner-clearing UPDATE clears the flag with it.
      if (inRange) {
        expect(instance.owner_id).toBeNull();
        expect(instance.assigned_over_conflict).toBe(false);
      }
    }
  });

  it('a pattern-level edit is the one thing that does change it (I24)', async () => {
    const { pattern, staff, instances } = await seeded();
    const before = await patternRow(pattern.id);

    const result = await updatePattern({ id: staff.id }, pattern.id, {
      startTime: '13:00',
      endTime: '15:00',
    });

    const after = await patternRow(pattern.id);
    expect(after.start_time).not.toBe(before.start_time);
    expect(result.pattern.start_time).toBe('13:00');
    expect(result.pattern.end_time).toBe('15:00');

    // Every future instance here is CLAIMED (born-CLAIMED above), and moving an owned
    // run is cap 9 — it needs that driver's conflicts and an explicit confirmation, so
    // a pattern edit leaves them exactly where they were and hands them back.
    expect(result.moved).toBe(0);
    expect(result.ownedInstances.length).toBe(instances.length);
    // Iterate the ORIGINALS and look each up in the current set, never the reverse.
    // Moving the window later in the day legitimately MINTS an occurrence that did not
    // exist before: today's 09:00 slot is already past and so was never materialized
    // (§5.3's loop runs over [now, horizon]), while today's new 13:00 slot is still in
    // the future and is. The reverse direction therefore hits a current row with no
    // original and dies on the `!` — but only when pantry-local now sits between the
    // two windows, which is why this passed every run outside 09:00–13:00.
    const current = await instancesOf(pattern.id);
    for (const original of instances) {
      const instance = current.find((row) => row.id === original.id)!;
      expect(instance.status).toBe('CLAIMED');
      expect(instance.starts_at.getTime()).toBe(original.starts_at.getTime());
      expect(instance.ends_at.getTime()).toBe(original.ends_at.getTime());
    }
  });

  it('moves the future UNCLAIMED instances onto a new window, and reports the count honestly', async () => {
    const { pattern } = await makeUnmaterializedPattern({ weekdays: EVERY_DAY });
    await materializePattern(pattern.id);
    const staff = await makeUser({ tier: 'STAFF' });
    const before = await instancesOf(pattern.id);

    const result = await updatePattern({ id: staff.id }, pattern.id, {
      startTime: '13:00',
      endTime: '15:00',
    });

    expect(result.moved).toBe(before.length);
    expect(result.ownedInstances).toEqual([]);
    // Originals first, for the reason given on the I24 test above: the edit can mint a
    // row `before` never held, and `after`-first would assert against `undefined`.
    const after = await instancesOf(pattern.id);
    for (const original of before) {
      const moved = after.find((row) => row.id === original.id)!;
      expect(moved.starts_at.getTime()).not.toBe(original.starts_at.getTime());
    }
  });

  it('leaves instances the edited pattern would no longer generate in place', async () => {
    const today = await pantryToday();
    const { pattern } = await makeUnmaterializedPattern({ weekdays: EVERY_DAY });
    await materializePattern(pattern.id);
    const staff = await makeUser({ tier: 'STAFF' });

    // Keep only the weekday today falls on. Every other minted instance is now
    // off-pattern.
    const keep = isoWeekday(today);
    const result = await updatePattern({ id: staff.id }, pattern.id, {
      weekdays: [keep],
    });

    expect(result.offPatternInstances.length).toBeGreaterThan(0);
    // Left in place, not cancelled: §5.3 says neither stop condition retracts an
    // already-materialized instance.
    for (const instance of await instancesOf(pattern.id)) {
      expect(instance.status).toBe('OPEN');
    }
    for (const off of result.offPatternInstances) {
      expect(isoWeekday(parseDate(off.occurrence_date, 'd'))).not.toBe(keep);
    }
  });
});

describe('createPattern — eager to the horizon (§5.3)', () => {
  it('mints every instance in range at create time, from today', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    const { route } = await makeRoute();

    const created = await createPattern({ id: staff.id }, {
      routeId: route.id,
      weekdays: EVERY_DAY,
      startTime: '09:00',
      endTime: '11:00',
    });

    expect(created.materialized).toBeGreaterThanOrEqual(HORIZON_DAYS);
    // Eager means the rows are already there — nothing anywhere expands a pattern
    // virtually, so a following sweep has nothing left to do.
    expect((await materializeDuePatterns()).created).toBe(0);

    const today = await pantryToday();
    for (const instance of await instancesOf(created.pattern.id)) {
      expect(instance.occurrence_date >= isoDate(today)).toBe(true);
    }
  });

  it('sorts and de-duplicates the weekday set, and refuses one outside 1..7', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    const { route } = await makeRoute();

    const created = await createPattern({ id: staff.id }, {
      routeId: route.id,
      weekdays: [5, 2, 2],
      startTime: '09:00',
      endTime: '11:00',
    });
    expect(created.pattern.weekdays).toEqual([2, 5]);

    await expect(
      createPattern({ id: staff.id }, {
        routeId: route.id,
        weekdays: [0],
        startTime: '09:00',
        endTime: '11:00',
      }),
    ).rejects.toThrow(/Monday/);
  });

  it('refuses an overnight window — §5.3 is intra-day, `end_time > start_time`', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    const { route } = await makeRoute();

    await expect(
      createPattern({ id: staff.id }, {
        routeId: route.id,
        weekdays: [1],
        startTime: '22:00',
        endTime: '02:00',
      }),
    ).rejects.toThrow(/later in the day/);
  });
});

describe('occurrenceDates', () => {
  const from = { year: 2026, month: 8, day: 3 }; // a Monday

  it('yields only the wanted ISO weekdays, in order', () => {
    const dates = occurrenceDates({ weekdays: [2], endDate: null }, from, 21);
    expect(dates.map(isoDate)).toEqual(['2026-08-04', '2026-08-11', '2026-08-18']);
  });

  it('stops at endDate rather than merely filtering it', () => {
    const dates = occurrenceDates({ weekdays: [2], endDate: '2026-08-11' }, from, 60);
    expect(dates.map(isoDate)).toEqual(['2026-08-04', '2026-08-11']);
  });

  it('is bounded by the horizon for an open-ended pattern', () => {
    expect(occurrenceDates({ weekdays: [1, 2, 3, 4, 5, 6, 7], endDate: null }, from, 6))
      .toHaveLength(7); // inclusive of both ends
  });

  it('reads ISO weekdays as 1 = Monday … 7 = Sunday', () => {
    expect(isoWeekday({ year: 2026, month: 8, day: 3 })).toBe(1);
    expect(isoWeekday({ year: 2026, month: 8, day: 9 })).toBe(7);
  });
});
