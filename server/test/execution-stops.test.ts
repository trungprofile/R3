// Resolving stops, the two note channels, and reordering mid-run.
//
// The load-bearing assertion in this file is the last describe block: after every
// stop is resolved the shift is STILL `IN_PROGRESS`. That is build-plan D1 and I11 —
// the receiver's receive-done is the only completion action and it ships in Phase 2 —
// not a gap for a later wave to close.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/index.js';
import {
  getRun,
  reorderStops,
  resolveStop,
  setRunNote,
  setStopNote,
  startRun,
} from '../src/services/execution.js';
import {
  makeClaimedShift,
  makeDriver,
  makeRoute,
  makeTruck,
  resetDatabase,
} from './fixtures.js';

const DRIVER = (id: string) => ({ id, tier: 'VOLUNTEER' as const });

/** A run in flight: three stops, all PENDING. */
async function startedRun(stopCount = 3) {
  const { route, donors } = await makeRoute(stopCount);
  const { shift, ownerId } = await makeClaimedShift({ routeId: route.id });
  const truck = await makeTruck();
  const run = await startRun(DRIVER(ownerId), shift.id, { truckId: truck.id });
  return { shift, ownerId, donors, run };
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await db.destroy();
  await pool.end().catch(() => undefined);
});

describe('resolveStop', () => {
  it('checks a stop off and skips another', async () => {
    const { shift, ownerId, run } = await startedRun();

    const collected = await resolveStop(DRIVER(ownerId), shift.id, run.stops[0]!.id, {
      disposition: 'COLLECTED',
    });
    const skipped = await resolveStop(DRIVER(ownerId), shift.id, run.stops[1]!.id, {
      disposition: 'SKIPPED',
    });

    expect(collected.disposition).toBe('COLLECTED');
    expect(skipped.disposition).toBe('SKIPPED');

    // SKIPPED is an explicit stored disposition — no phantom zero row anywhere
    // (`domain-modeling.md §3.2`).
    const after = await getRun(DRIVER(ownerId), shift.id);
    expect(after.stops.map((s) => s.disposition)).toEqual([
      'COLLECTED',
      'SKIPPED',
      'PENDING',
    ]);
  });

  it('saves the driver→receiver note with the same tap (cap 11, channel 2)', async () => {
    const { shift, ownerId, run } = await startedRun(1);
    const stop = await resolveStop(DRIVER(ownerId), shift.id, run.stops[0]!.id, {
      disposition: 'COLLECTED',
      note: 'Two pallets, one is short-dated',
    });
    expect(stop.note).toBe('Two pallets, one is short-dated');
  });

  it('is idempotent when the disposition is already what was asked for', async () => {
    const { shift, ownerId, run } = await startedRun(1);
    await resolveStop(DRIVER(ownerId), shift.id, run.stops[0]!.id, {
      disposition: 'COLLECTED',
    });
    const again = await resolveStop(DRIVER(ownerId), shift.id, run.stops[0]!.id, {
      disposition: 'COLLECTED',
    });
    expect(again.disposition).toBe('COLLECTED');
  });

  it('refuses COLLECTED → SKIPPED: that edge belongs to the receiver (§3.2)', async () => {
    const { shift, ownerId, run } = await startedRun(1);
    await resolveStop(DRIVER(ownerId), shift.id, run.stops[0]!.id, {
      disposition: 'COLLECTED',
    });
    await expect(
      resolveStop(DRIVER(ownerId), shift.id, run.stops[0]!.id, { disposition: 'SKIPPED' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('has no edge back to PENDING — there is no un-check action', async () => {
    const { shift, ownerId, run } = await startedRun(1);
    await resolveStop(DRIVER(ownerId), shift.id, run.stops[0]!.id, {
      disposition: 'SKIPPED',
    });
    await expect(
      // The only two dispositions a driver may send are COLLECTED and SKIPPED; the
      // state machine has no arrow back to PENDING for either actor.
      resolveStop(DRIVER(ownerId), shift.id, run.stops[0]!.id, {
        disposition: 'PENDING' as never,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('refuses a driver who does not own the run', async () => {
    const { shift, run } = await startedRun(1);
    const other = await makeDriver();
    await expect(
      resolveStop(DRIVER(other.id), shift.id, run.stops[0]!.id, {
        disposition: 'COLLECTED',
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('refuses a stop that belongs to a different run', async () => {
    const a = await startedRun(1);
    const b = await startedRun(1);
    await expect(
      resolveStop(DRIVER(a.ownerId), a.shift.id, b.run.stops[0]!.id, {
        disposition: 'COLLECTED',
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('notes', () => {
  it('edits a stop note on its own, last write wins', async () => {
    const { shift, ownerId, run } = await startedRun(1);
    await setStopNote(DRIVER(ownerId), shift.id, run.stops[0]!.id, 'Ring the bell');
    const cleared = await setStopNote(DRIVER(ownerId), shift.id, run.stops[0]!.id, null);
    expect(cleared.note).toBeNull();
  });

  it('keeps the whole-run note in its own field, distinct from staff_note', async () => {
    const { shift, ownerId } = await startedRun(1);
    await db
      .updateTable('shift')
      .set({ staff_note: 'Call Clark if the dock is blocked' })
      .where('id', '=', shift.id)
      .execute();

    const run = await setRunNote(DRIVER(ownerId), shift.id, 'Traffic on 35 all morning');

    // Cap 11: four channels, none sharing storage.
    expect(run.note).toBe('Traffic on 35 all morning');
    expect(run.staffNote).toBe('Call Clark if the dock is blocked');
  });

  it('stamps the run note write as last-writer (I26)', async () => {
    const { shift, ownerId } = await startedRun(1);
    await setRunNote(DRIVER(ownerId), shift.id, 'All fine');
    const row = await db
      .selectFrom('shift')
      .select('updated_by')
      .where('id', '=', shift.id)
      .executeTakeFirstOrThrow();
    expect(row.updated_by).toBe(ownerId);
  });
});

describe('reorderStops', () => {
  it('reorders without losing check state (S1.5)', async () => {
    const { shift, ownerId, run } = await startedRun(3);
    await resolveStop(DRIVER(ownerId), shift.id, run.stops[0]!.id, {
      disposition: 'COLLECTED',
    });

    const reversed = [run.stops[2]!.id, run.stops[1]!.id, run.stops[0]!.id];
    const stops = await reorderStops(DRIVER(ownerId), shift.id, reversed);

    expect(stops.map((s) => s.id)).toEqual(reversed);
    expect(stops.map((s) => s.position)).toEqual([0, 1, 2]);
    // Reorder is a position attribute, not a state (`domain-modeling.md §3.2`).
    expect(stops[2]!.disposition).toBe('COLLECTED');
  });

  it('rejects a partial or duplicated list', async () => {
    const { shift, ownerId, run } = await startedRun(3);
    await expect(
      reorderStops(DRIVER(ownerId), shift.id, [run.stops[0]!.id]),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      reorderStops(DRIVER(ownerId), shift.id, [
        run.stops[0]!.id,
        run.stops[0]!.id,
        run.stops[1]!.id,
      ]),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('refuses a driver who does not own the run', async () => {
    const { shift, run } = await startedRun(2);
    const other = await makeDriver();
    await expect(
      reorderStops(DRIVER(other.id), shift.id, [run.stops[1]!.id, run.stops[0]!.id]),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('D1 — a Phase-1 run never reaches COMPLETED', () => {
  it('stays IN_PROGRESS after every stop is resolved', async () => {
    const { shift, ownerId, run } = await startedRun(2);

    await resolveStop(DRIVER(ownerId), shift.id, run.stops[0]!.id, {
      disposition: 'COLLECTED',
    });
    await resolveStop(DRIVER(ownerId), shift.id, run.stops[1]!.id, {
      disposition: 'SKIPPED',
    });

    const after = await getRun(DRIVER(ownerId), shift.id);
    // I11: the only completion action is the receiver's receive-done, and the
    // receiver ships in Phase 2. This is the correct behaviour, not a gap.
    expect(after.status).toBe('IN_PROGRESS');
    expect(after.stops.every((s) => s.disposition !== 'PENDING')).toBe(true);
  });

  it('exposes no service function that writes COMPLETED', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../src/services/execution.ts', import.meta.url), 'utf8'),
    );
    // A second completion path would contradict I11 and would have to be removed
    // again in Phase 2, so the absence is asserted rather than assumed. Comments
    // naming the state are fine; a write of it is not.
    expect(source).not.toMatch(/status:\s*'COMPLETED'/);
  });
});
