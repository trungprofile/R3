// S2.1b's list, and the two things `D66`/`D67` added to it.
//
// The property this file exists to hold down is the NO-STRANDING one (A162):
// `receiveDone` is deliberately not window-gated — closing a run is the completion
// action (I11), not an edit — and this list is its only route. So a run past the
// receiver's edit window must still be LISTED, however it is banded on screen. A
// `WHERE` here instead of a flag would leave it IN_PROGRESS with nothing in the
// whole API able to close it.
//
// The banding itself is the client's, and is tested in `run-picker.test.ts`. What
// is server-side is the predicate and the fact that nothing is filtered out.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/index.js';
import {
  addWeight,
  listReceivableRuns,
  readDonationSummary,
  receiveDone,
} from '../src/services/receive.js';
import { createDonation, flagAdHoc, listReceiveWorklist } from '../src/services/donation.js';
import {
  makeCategory,
  makeDonor,
  makeReceiver,
  makeStartedShift,
  resetDatabase,
} from './fixtures.js';

beforeEach(resetDatabase);
afterAll(async () => {
  await pool.end();
});

const DAY = 24 * 60 * 60 * 1000;

/** A run whose start is far enough back that `receiver_edit_window_days` has
 *  certainly passed, whatever `app_config` is set to at the pantry. */
function longAgo(days = 365): Date {
  return new Date(Date.now() - days * DAY);
}

describe('the edit window on the picker (`D66`)', () => {
  it('flags a fresh run as still weighable', async () => {
    const { shift } = await makeStartedShift({ stopCount: 1 });
    const runs = await listReceivableRuns();
    expect(runs.find((r) => r.shiftId === shift.id)?.editWindowOpen).toBe(true);
  });

  it('flags a lapsed run as closed, and still lists it (A162)', async () => {
    const { shift } = await makeStartedShift({ stopCount: 1, startsAt: longAgo() });

    const listed = (await listReceivableRuns()).find((r) => r.shiftId === shift.id);

    expect(listed).toBeDefined();
    expect(listed?.editWindowOpen).toBe(false);
  });

  it('leaves a lapsed run closable, which is why it is still listed', async () => {
    // The half that matters. Weigh the stop while the window is open, then move the
    // run's start back past the window — the state a run reaches by simply being
    // left alone — and confirm the one action that closes it still works from the
    // list it is still on.
    const { shift, stops } = await makeStartedShift({ stopCount: 1 });
    const actor = { id: (await makeReceiver()).id };
    const category = await makeCategory('Produce');
    await addWeight(actor, shift.id, stops[0]!.id, { categoryId: category.id, weight: '100' });

    await db
      .updateTable('shift')
      .set({ starts_at: longAgo(), ends_at: longAgo(364) })
      .where('id', '=', shift.id)
      .execute();

    const listed = (await listReceivableRuns()).find((r) => r.shiftId === shift.id);
    expect(listed?.editWindowOpen).toBe(false);
    expect(listed?.readyForReceiveDone).toBe(true);

    await expect(receiveDone(actor, shift.id)).resolves.toMatchObject({ shiftId: shift.id });
    const row = await db
      .selectFrom('shift')
      .select('status')
      .where('id', '=', shift.id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('COMPLETED');
  });

  it('reads the window from app_config rather than from a constant', async () => {
    const { shift } = await makeStartedShift({
      stopCount: 1,
      startsAt: new Date(Date.now() - 3 * DAY),
    });
    // `app_config` is a singleton and `resetDatabase` does NOT truncate it, so this
    // is put back before the test ends — otherwise the seeded window leaks into
    // every file that runs after this one.
    const original = await db
      .selectFrom('app_config')
      .select('receiver_edit_window_days')
      .executeTakeFirstOrThrow();

    try {
      await db.updateTable('app_config').set({ receiver_edit_window_days: 1 }).execute();
      expect((await listReceivableRuns()).find((r) => r.shiftId === shift.id)?.editWindowOpen).toBe(
        false,
      );

      await db.updateTable('app_config').set({ receiver_edit_window_days: 30 }).execute();
      expect((await listReceivableRuns()).find((r) => r.shiftId === shift.id)?.editWindowOpen).toBe(
        true,
      );
    } finally {
      await db
        .updateTable('app_config')
        .set({ receiver_edit_window_days: original.receiver_edit_window_days })
        .execute();
    }
  });
});

describe('the returning milestone on the picker (`D48`, I27)', () => {
  it('is null until the driver confirms heading back', async () => {
    const { shift } = await makeStartedShift({ stopCount: 1 });
    expect(
      (await listReceivableRuns()).find((r) => r.shiftId === shift.id)?.pickupCompletedAt,
    ).toBeNull();
  });

  it('surfaces the instant, and leaves the run IN_PROGRESS', async () => {
    // I27: heading back is a milestone INSIDE `IN_PROGRESS`, never a status. The
    // picker reads it for one line of copy and nothing else — the run is still on
    // the list and still offers exactly what it offered before.
    const { shift } = await makeStartedShift({ stopCount: 2 });
    const at = new Date('2026-08-03T20:15:00Z');
    await db
      .updateTable('shift')
      .set({ pickup_completed_at: at })
      .where('id', '=', shift.id)
      .execute();

    const listed = (await listReceivableRuns()).find((r) => r.shiftId === shift.id);
    expect(listed?.pickupCompletedAt).toBe(at.toISOString());
    expect(listed?.readyForReceiveDone).toBe(false);

    const row = await db
      .selectFrom('shift')
      .select('status')
      .where('id', '=', shift.id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('IN_PROGRESS');
  });
});

describe('the unscheduled-donation summary (`D67`, rows added by `D76`)', () => {
  it('answers with zeros when nothing has been recorded at all', async () => {
    // The panel is shown in every state — it is the only route to S2.3 — so this
    // must return a row rather than nothing.
    expect(await readDonationSummary()).toEqual({
      recordedCount: 0,
      // `coalesce(..., 0)::text` — a decimal string, like every weight on the
      // wire, and trimmed for display by the panel rather than here.
      recordedTotal: '0',
      pendingCount: 0,
      suggested: [],
      recorded: [],
    });
  });

  it('counts and sums today"s confirmed rows', async () => {
    const actor = { id: (await makeReceiver()).id };
    const category = await makeCategory('Produce');
    const donor = await makeDonor('Corner Market');
    await createDonation(actor, {
      donorId: donor.id,
      categoryId: category.id,
      weight: '100.50',
    });
    await createDonation(actor, { donorLabel: 'A neighbour', categoryId: category.id, weight: '44.5' });

    const summary = await readDonationSummary();
    expect(summary.recordedCount).toBe(2);
    expect(Number(summary.recordedTotal)).toBe(145);
  });

  it('leaves out a confirmed row whose window has shut', async () => {
    const actor = { id: (await makeReceiver()).id };
    const category = await makeCategory('Produce');
    await createDonation(actor, { donorLabel: 'A neighbour', categoryId: category.id, weight: '40' });
    // A walk-in has no shift, so its window runs from its own `created_at`.
    await db.updateTable('unscheduled_donation').set({ created_at: longAgo() }).execute();

    const summary = await readDonationSummary();
    expect(summary.recorded).toHaveLength(0);
    expect(summary.recordedCount).toBe(0);
    expect(Number(summary.recordedTotal)).toBe(0);
  });

  it('counts driver-flagged rows waiting for weights, whenever they were flagged', async () => {
    // Not DATE-bounded: a row flagged yesterday is still waiting today. It is
    // window-bounded since `D77` (below), and removed by the I17 purge.
    const { shift, ownerId } = await makeStartedShift({ stopCount: 1 });
    const offRoute = await makeDonor('Sunrise Bagels');
    await flagAdHoc({ id: ownerId }, shift.id, { donorId: offRoute.id });

    const summary = await readDonationSummary();
    expect(summary.pendingCount).toBe(1);
    // A SUGGESTED row has no weight yet (I16a), so it is in neither total.
    expect(summary.recordedCount).toBe(0);
  });
});

describe('the donation worklist S2.1b now carries (`D76`, `D77`)', () => {
  it('lists a fresh prefill under `suggested`, with the count agreeing', async () => {
    const { shift, ownerId } = await makeStartedShift({ stopCount: 1 });
    const offRoute = await makeDonor('Sunrise Bagels');
    await flagAdHoc({ id: ownerId }, shift.id, {
      donorId: offRoute.id,
      note: 'two crates by the door',
    });

    const summary = await readDonationSummary();
    expect(summary.suggested).toHaveLength(1);
    expect(summary.suggested[0]!.status).toBe('SUGGESTED');
    expect(summary.suggested[0]!.donorDisplay).toBe('Sunrise Bagels');
    // What the receiver still has to supply (D24, I16a).
    expect(summary.suggested[0]!.categoryId).toBeNull();
    expect(summary.suggested[0]!.weight).toBeNull();
    expect(summary.suggested[0]!.note).toBe('two crates by the door');
    // The contract's own words: `pendingCount` IS `suggested.length`.
    expect(summary.pendingCount).toBe(summary.suggested.length);
  });

  it('drops a prefill whose edit window has lapsed (`D77`)', async () => {
    // The rule the run bands beside it use (`D66`). `confirmDonation` refuses a
    // lapsed row, so listing it offered work the next tap would refuse.
    const open = await makeStartedShift({ stopCount: 1 });
    const lapsed = await makeStartedShift({ stopCount: 1, startsAt: longAgo() });
    const a = await makeDonor('Sunrise Bagels');
    const b = await makeDonor('Corner Market');
    await flagAdHoc({ id: open.ownerId }, open.shift.id, { donorId: a.id });
    await flagAdHoc({ id: lapsed.ownerId }, lapsed.shift.id, { donorId: b.id });

    const summary = await readDonationSummary();
    expect(summary.suggested.map((d) => d.donorDisplay)).toEqual(['Sunrise Bagels']);
    expect(summary.pendingCount).toBe(1);

    // Not a hidden row that is secretly still weighable: the flag on it agrees.
    const { suggested } = await listReceiveWorklist();
    expect(suggested.every((d) => d.editableByReceiver)).toBe(true);
  });

  it('reads that bound from `app_config`, not from a constant', async () => {
    const { shift, ownerId } = await makeStartedShift({
      stopCount: 1,
      startsAt: new Date(Date.now() - 3 * DAY),
    });
    await flagAdHoc({ id: ownerId }, shift.id, { donorId: (await makeDonor()).id });

    // `app_config` is a singleton and `resetDatabase` does not truncate it.
    const original = await db
      .selectFrom('app_config')
      .select('receiver_edit_window_days')
      .executeTakeFirstOrThrow();

    try {
      await db.updateTable('app_config').set({ receiver_edit_window_days: 1 }).execute();
      expect((await listReceiveWorklist()).suggested).toHaveLength(0);

      await db.updateTable('app_config').set({ receiver_edit_window_days: 30 }).execute();
      expect((await listReceiveWorklist()).suggested).toHaveLength(1);
    } finally {
      await db
        .updateTable('app_config')
        .set({ receiver_edit_window_days: original.receiver_edit_window_days })
        .execute();
    }
  });

  it('bounds a walk-in from its own `created_at`, having no shift to anchor to', async () => {
    // The `coalesce` half of the predicate. A receiver-authored row is CONFIRMED, so
    // reach for a SUGGESTED row with no shift the only way there is — directly —
    // since I17 makes every SUGGESTED row a driver-add through the service.
    const user = await makeReceiver();
    const donor = await makeDonor('Walk-in');
    await db
      .insertInto('unscheduled_donation')
      .values({
        shift_id: null,
        donor_id: donor.id,
        donor_label: null,
        category_id: null,
        weight: null,
        status: 'SUGGESTED',
        received_date: '2026-01-02',
        created_by: user.id,
        updated_by: user.id,
      })
      .execute();

    expect((await listReceiveWorklist()).suggested).toHaveLength(1);

    // Age the row itself past the window. No shift is involved either way.
    await db
      .updateTable('unscheduled_donation')
      .set({ created_at: longAgo() })
      .execute();

    expect((await listReceiveWorklist()).suggested).toHaveLength(0);
  });

  it('keeps a confirmed row whose `received_date` is not today (`D76`)', async () => {
    // THE CASE THAT MOVED THIS BOUND OFF THE CALENDAR DAY. A driver's flag carries
    // its RUN's `received_date`, which can be any day the window still covers — so
    // while `recorded` meant "today", weighing such a row made it vanish from the
    // panel at the exact moment the receiver wanted to see it. Both lists are the
    // edit window now, and the panel says "weighed" rather than "recorded today".
    const actor = { id: (await makeReceiver()).id };
    const category = await makeCategory('Produce');
    await createDonation(actor, { donorLabel: 'Later', categoryId: category.id, weight: '40' });
    await createDonation(actor, { donorLabel: 'Now', categoryId: category.id, weight: '10' });
    await db
      .updateTable('unscheduled_donation')
      .set({ received_date: '2099-01-02' })
      .where('donor_label', '=', 'Later')
      .execute();

    const summary = await readDonationSummary();
    expect(summary.recorded.map((d) => d.donorDisplay).sort()).toEqual(['Later', 'Now']);
    // The rows and the aggregate beside them describe the same set — one query, so
    // they cannot disagree across two round trips.
    expect(summary.recordedCount).toBe(summary.recorded.length);
    expect(Number(summary.recordedTotal)).toBe(50);
  });

  it('orders both lists newest first', async () => {
    const actor = { id: (await makeReceiver()).id };
    const category = await makeCategory('Produce');
    await createDonation(actor, { donorLabel: 'First', categoryId: category.id, weight: '1' });
    await createDonation(actor, { donorLabel: 'Second', categoryId: category.id, weight: '2' });

    const { recorded } = await listReceiveWorklist();
    expect(recorded.map((d) => d.donorDisplay)).toEqual(['Second', 'First']);
  });
});
