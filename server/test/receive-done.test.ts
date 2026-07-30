// Receive-done — the transition Phase 1 deliberately did not have.
//
//   I11  the receiver's receive-done is the ONLY completion action. No auto-complete,
//        no driver close-run, no staff override.
//   I12  it requires every ShiftStop ∈ {WEIGHED, SKIPPED, REASSIGNED}. A hard gate:
//        it is what guarantees no silently-dropped pickup reaches NTFB.
//   I17  unconfirmed SUGGESTED donations are deleted inline, in that transaction.
//   I10  COMPLETED is terminal.
//
// Phase 1's build plan (D1) asserted the opposite of the first line here — that a
// started run stays IN_PROGRESS forever — and its tests still assert it for the
// driver's paths. Both are correct: D1 was about there being no SECOND completion
// path, and this is the first.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/index.js';
import { addWeight, listReceivableRuns, readReceiveDone, receiveDone, skipStop } from '../src/services/receive.js';
import { completePickup } from '../src/services/execution.js';
import { flagAdHoc } from '../src/services/donation.js';
import {
  makeCategory,
  makeDonor,
  makeReceiver,
  makeStartedShift,
  resetDatabase,
} from './fixtures.js';

const receiver = (id: string) => ({ id });

beforeEach(resetDatabase);
afterAll(async () => {
  await pool.end();
});

async function run(stopCount = 2) {
  const started = await makeStartedShift({ stopCount });
  const user = await makeReceiver();
  const category = await makeCategory('Produce');
  return { ...started, actor: receiver(user.id), category };
}

/** Resolve every stop so the I12 gate is satisfied. */
async function weighEverything(
  shiftId: string,
  stops: { id: string }[],
  actor: { id: string },
  categoryId: string,
) {
  for (const stop of stops) {
    await addWeight(actor, shiftId, stop.id, { categoryId, weight: '100' });
  }
}

describe('the completion gate (I12)', () => {
  it('refuses while any stop is unresolved', async () => {
    const { shift, stops, actor, category } = await run(2);
    await addWeight(actor, shift.id, stops[0]!.id, { categoryId: category.id, weight: '10' });

    await expect(receiveDone(actor, shift.id)).rejects.toThrow(/weight or a skip/i);

    const row = await db
      .selectFrom('shift')
      .select('status')
      .where('id', '=', shift.id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('IN_PROGRESS');
  });

  it('refuses on an unweighed COLLECTED stop — the driver picked it up, nobody weighed it', async () => {
    const { shift, actor } = await run(1);
    // Every stop is COLLECTED out of the fixture: driver-resolved, receiver-pending.
    await expect(receiveDone(actor, shift.id)).rejects.toThrow(/weight or a skip/i);
  });

  it('accepts a mix of WEIGHED and SKIPPED', async () => {
    const { shift, stops, actor, category } = await run(2);
    await addWeight(actor, shift.id, stops[0]!.id, { categoryId: category.id, weight: '10' });
    await skipStop(actor, shift.id, stops[1]!.id);

    await expect(receiveDone(actor, shift.id)).resolves.toMatchObject({ shiftId: shift.id });
  });

  it('accepts REASSIGNED as resolved — it is no longer this run to finish (I30)', async () => {
    const { shift, stops, actor, category } = await run(2);
    await addWeight(actor, shift.id, stops[0]!.id, { categoryId: category.id, weight: '10' });
    await db
      .updateTable('shift_stop')
      .set({ disposition: 'REASSIGNED' })
      .where('id', '=', stops[1]!.id)
      .execute();

    await expect(receiveDone(actor, shift.id)).resolves.toBeDefined();
  });

  it('re-derives WEIGHED rather than trusting a stored value — a voided weight reopens the gate', async () => {
    const { shift, stops, actor, category } = await run(1);
    const detail = await addWeight(actor, shift.id, stops[0]!.id, {
      categoryId: category.id,
      weight: '10',
    });
    const entry = detail.tiles.find((t) => t.categoryId === category.id)!.entries[0]!;

    await db.updateTable('weight_entry').set({ voided: true }).where('id', '=', entry.id).execute();

    // The stop's stored disposition never changed; only the projection did.
    await expect(receiveDone(actor, shift.id)).rejects.toThrow(/weight or a skip/i);
  });
});

describe('the transition (I11, I10)', () => {
  it('moves IN_PROGRESS → COMPLETED', async () => {
    const { shift, stops, actor, category } = await run(1);
    await weighEverything(shift.id, stops, actor, category.id);

    await receiveDone(actor, shift.id);

    const row = await db
      .selectFrom('shift')
      .select(['status', 'updated_by'])
      .where('id', '=', shift.id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('COMPLETED');
    expect(row.updated_by).toBe(actor.id);
  });

  it('is terminal — a second receive-done is refused, not repeated', async () => {
    const { shift, stops, actor, category } = await run(1);
    await weighEverything(shift.id, stops, actor, category.id);
    await receiveDone(actor, shift.id);

    await expect(receiveDone(actor, shift.id)).rejects.toThrow(/already finished/i);
  });

  it('closes a run whose driver never tapped "heading back" — I27 is optional', async () => {
    const { shift, stops, actor, category } = await run(1);
    await weighEverything(shift.id, stops, actor, category.id);

    await receiveDone(actor, shift.id);
    const row = await db
      .selectFrom('shift')
      .select(['status', 'pickup_completed_at'])
      .where('id', '=', shift.id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('COMPLETED');
    expect(row.pickup_completed_at).toBeNull();
  });

  it('refuses further weighing once closed', async () => {
    const { shift, stops, actor, category } = await run(1);
    await weighEverything(shift.id, stops, actor, category.id);
    await receiveDone(actor, shift.id);

    await expect(
      addWeight(actor, shift.id, stops[0]!.id, { categoryId: category.id, weight: '5' }),
    ).rejects.toThrow(/already finished/i);
  });
});

describe('the I17 purge', () => {
  it('deletes unconfirmed SUGGESTED donations in the same transaction', async () => {
    const { shift, stops, ownerId, actor, category } = await run(1);
    const offRoute = await makeDonor('Corner Market');
    await flagAdHoc({ id: ownerId }, shift.id, {
      donorId: offRoute.id,
      categoryId: category.id,
      note: 'two crates',
    });

    await weighEverything(shift.id, stops, actor, category.id);
    const result = await receiveDone(actor, shift.id);

    expect(result.purgedSuggestions).toBe(1);
    const left = await db
      .selectFrom('unscheduled_donation')
      .selectAll()
      .where('shift_id', '=', shift.id)
      .execute();
    expect(left).toHaveLength(0);
  });

  it('leaves CONFIRMED donations alone — those are intake, not a prefill', async () => {
    const { shift, stops, ownerId, actor, category } = await run(1);
    const offRoute = await makeDonor('Corner Market');
    const flagged = await flagAdHoc({ id: ownerId }, shift.id, {
      donorId: offRoute.id,
      categoryId: category.id,
    });
    await db
      .updateTable('unscheduled_donation')
      .set({ status: 'CONFIRMED', weight: '40' })
      .where('id', '=', flagged.id)
      .execute();

    await weighEverything(shift.id, stops, actor, category.id);
    const result = await receiveDone(actor, shift.id);

    expect(result.purgedSuggestions).toBe(0);
    const left = await db
      .selectFrom('unscheduled_donation')
      .selectAll()
      .where('shift_id', '=', shift.id)
      .execute();
    expect(left).toHaveLength(1);
  });
});

describe('S2.1b — the run picker', () => {
  it('lists a run whose stops are all resolved, so receive-done stays reachable', async () => {
    const { shift, stops, actor, category } = await run(1);
    await weighEverything(shift.id, stops, actor, category.id);

    const runs = await listReceivableRuns();
    const listed = runs.find((r) => r.shiftId === shift.id);

    // The stricter reading of S2.1b ("shifts with at least one unresolved stop")
    // would drop this run and strand it — S2.2b is reached FROM this list.
    expect(listed).toBeDefined();
    expect(listed?.readyForReceiveDone).toBe(true);
    expect(listed?.doneCount).toBe(1);
  });

  it('drops the run once it is received', async () => {
    const { shift, stops, actor, category } = await run(1);
    await weighEverything(shift.id, stops, actor, category.id);
    await receiveDone(actor, shift.id);

    const runs = await listReceivableRuns();
    expect(runs.find((r) => r.shiftId === shift.id)).toBeUndefined();
  });

  it('shows the shift occurrence date, not the device today (data-model §8)', async () => {
    const { shift } = await run(1);
    const runs = await listReceivableRuns();
    const listed = runs.find((r) => r.shiftId === shift.id);
    expect(listed?.occurrenceDate).toBe('2026-08-04');
  });

  it('marks a run with an unresolved stop as not ready', async () => {
    const { shift } = await run(2);
    const runs = await listReceivableRuns();
    const listed = runs.find((r) => r.shiftId === shift.id);
    expect(listed?.readyForReceiveDone).toBe(false);
    expect(listed?.totalCount).toBe(2);
    expect(listed?.doneCount).toBe(0);
  });
});

describe('S2.2b — the summary', () => {
  it('prints a weight for a weighed stop and nothing for a skipped one', async () => {
    const { shift, stops, actor, category } = await run(2);
    await addWeight(actor, shift.id, stops[0]!.id, { categoryId: category.id, weight: '2192' });
    await skipStop(actor, shift.id, stops[1]!.id);

    const summary = await readReceiveDone(shift.id);

    expect(summary.lines).toHaveLength(2);
    expect(summary.lines[0]).toMatchObject({ state: 'WEIGHED', total: '2192.00' });
    expect(summary.lines[1]).toMatchObject({ state: 'SKIPPED', total: null });
    expect(summary.runTotal).toBe('2192.00');
    expect(summary.readyForReceiveDone).toBe(true);
  });
});

describe('the driver handoff still does not complete anything (I27)', () => {
  it('leaves the run IN_PROGRESS after "heading back"', async () => {
    const { shift, ownerId } = await run(1);
    await db
      .updateTable('shift_stop')
      .set({ disposition: 'COLLECTED' })
      .where('shift_id', '=', shift.id)
      .execute();

    await completePickup({ id: ownerId, tier: 'VOLUNTEER' }, shift.id);

    const row = await db
      .selectFrom('shift')
      .select(['status', 'pickup_completed_at'])
      .where('id', '=', shift.id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('IN_PROGRESS');
    expect(row.pickup_completed_at).not.toBeNull();
  });
});
