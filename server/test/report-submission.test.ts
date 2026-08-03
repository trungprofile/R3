// The Meal Connect check-off (D35), and the range the report is now cut on (D41).
//
// WHY THIS IS PERSISTED AND NOT A UI FLAG, which is what every test here is really
// about: Meal Connect has no import (D13) and takes one submission at a time, so a
// fifteen-store week is fifteen separate typing sessions. "Which of these have I
// already filed" is therefore a question two people ask about the same range, and the
// failure when it is answered wrong is a receipt filed twice or not at all — neither
// of which is visible at the far end. That is the same class of failure as the lost
// paper sheet, one step further downstream.
//
// FOUR THINGS ASSERTED, in the order they can go wrong:
//
//   1. THE COMPOSITE PRIMARY KEY IS THE GUARD. Two reporters ticking the same store
//      produce ONE row. A read-then-insert is precisely the write-skew SERIALIZABLE
//      exists to catch, so the assertion is against the constraint and not against
//      the service being careful.
//   2. THE RECEIPT CARRIES ITS OWN STATE. `computeRange` joins the table, so the
//      submitted flag and the pounds come out of one computation. A second query the
//      view stitched on could disagree with the card beside it.
//   3. UN-TICKING IS A DELETE. A mis-tick is removed, not corrected with a second
//      fact saying the first was wrong.
//   4. THE ARITHMETIC IS UNTOUCHED. Ticking a receipt changes no total anywhere.
//      `domain-modeling.md §6` is locked and this table is not in the union.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/index.js';
import {
  clearReceiptSubmitted,
  createNtfbCategory,
  exportReceipts,
  markReceiptSubmitted,
  resolveRange,
  setMapping,
  weekBounds,
  weeklyReport,
} from '../src/services/report.js';
import { addWeight } from '../src/services/receive.js';
import { createDonation } from '../src/services/donation.js';
import {
  makeCategory,
  makeReceiver,
  makeStartedShift,
  resetDatabase,
} from './fixtures.js';

/** The fixture shift sits on 2026-08-04, a Tuesday. Its week is Mon 3rd–Sun 9th. */
const WEEK = '2026-08-04';
const RANGE = { from: weekBounds(WEEK).weekStart, to: weekBounds(WEEK).weekEnd };

beforeEach(resetDatabase);
afterAll(async () => {
  await pool.end();
});

/** One store, one weighed pickup, fully mapped — the smallest world an export will
 *  not refuse. Returns the donor the receipt is keyed on. */
async function oneWeighedPickup(weight = '70') {
  const started = await makeStartedShift({ stopCount: 1 });
  const receiver = await makeReceiver();
  const actor = { id: receiver.id };

  const produce = await makeCategory('Produce');
  const ntfb = await createNtfbCategory({ name: 'Produce' });
  await setMapping(produce.id, ntfb.id, 'Refrigerated');

  await addWeight(actor, started.shift.id, started.stops[0]!.id, {
    categoryId: produce.id,
    weight,
  });

  return {
    ...started,
    actor,
    produce,
    donorId: started.stops[0]!.donor_id,
  };
}

async function submissionRows() {
  return db.selectFrom('meal_connect_submission').selectAll().execute();
}

// ---------------------------------------------------------------------------
// 1. Two reporters, one row
// ---------------------------------------------------------------------------

describe('the composite primary key is the guard (D35)', () => {
  it('leaves one row when two reporters tick the same store on the same day', async () => {
    const { donorId, actor } = await oneWeighedPickup();
    const second = await makeReceiver();

    await markReceiptSubmitted(actor, '2026-08-04', donorId);
    await markReceiptSubmitted({ id: second.id }, '2026-08-04', donorId);

    const rows = await submissionRows();
    expect(rows).toHaveLength(1);
    // The FIRST tick stands. A second one is a no-op rather than a 409, because the
    // state the second reporter wanted is the state they get and refusing would be
    // telling them off for agreeing.
    expect(rows[0]!.submitted_by).toBe(actor.id);
  });

  it('keeps the two dates apart for one store', async () => {
    const { donorId, actor } = await oneWeighedPickup();

    await markReceiptSubmitted(actor, '2026-08-04', donorId);
    await markReceiptSubmitted(actor, '2026-08-05', donorId);

    expect(await submissionRows()).toHaveLength(2);
  });

  it('refuses a store that does not exist rather than writing a dangling tick', async () => {
    const { actor } = await oneWeighedPickup();
    await expect(
      markReceiptSubmitted(actor, '2026-08-04', '00000000-0000-0000-0000-000000000000'),
    ).rejects.toThrow(/No such store/i);
  });
});

// ---------------------------------------------------------------------------
// 2. The receipt carries its own state
// ---------------------------------------------------------------------------

describe('a receipt carries its own submitted state (D35)', () => {
  it('is null before anyone ticks it, and names who and when afterwards', async () => {
    const { donorId, actor } = await oneWeighedPickup();

    const before = await exportReceipts(RANGE.from, RANGE.to);
    expect(before.receipts).toHaveLength(1);
    expect(before.receipts[0]!.donorId).toBe(donorId);
    expect(before.receipts[0]!.submitted).toBeNull();

    await markReceiptSubmitted(actor, '2026-08-04', donorId);

    const after = await exportReceipts(RANGE.from, RANGE.to);
    expect(after.receipts[0]!.submitted).not.toBeNull();
    expect(after.receipts[0]!.submitted!.submittedBy).toMatch(/\S/);
    expect(Date.parse(after.receipts[0]!.submitted!.submittedAt)).not.toBeNaN();
  });

  it('un-ticks by DELETE, which is what makes a mis-tick reversible', async () => {
    const { donorId, actor } = await oneWeighedPickup();

    await markReceiptSubmitted(actor, '2026-08-04', donorId);
    await clearReceiptSubmitted('2026-08-04', donorId);

    expect(await submissionRows()).toHaveLength(0);
    const sheet = await exportReceipts(RANGE.from, RANGE.to);
    expect(sheet.receipts[0]!.submitted).toBeNull();
  });

  it('is silent about un-ticking something nobody ticked', async () => {
    const { donorId } = await oneWeighedPickup();
    // The caller asked for a state, and it is the state they end up in.
    await expect(clearReceiptSubmitted('2026-08-04', donorId)).resolves.toBeUndefined();
  });

  it('leaves a walk-in receipt unticked and unticke-able, with no donor to key on', async () => {
    // A free-text label has no `donor` row, so `meal_connect_submission.donor_id`
    // has nothing to point at — which is the same store Meal Connect's own picker
    // cannot be pointed at either (migration 0018). The screen reads `donorId: null`
    // and says so rather than offering a control that would fail.
    const { actor, produce } = await oneWeighedPickup();
    await createDonation(actor, {
      donorLabel: 'A neighbour',
      categoryId: produce.id,
      weight: '10',
      reportable: true,
    });
    await db
      .updateTable('unscheduled_donation')
      .set({ received_date: '2026-08-04', status: 'CONFIRMED' })
      .execute();

    const sheet = await exportReceipts(RANGE.from, RANGE.to);
    const walkIn = sheet.receipts.find((r) => r.donorName === 'A neighbour');
    expect(walkIn).toBeDefined();
    expect(walkIn!.donorId).toBeNull();
    expect(walkIn!.submitted).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. The check-off changes no arithmetic
// ---------------------------------------------------------------------------

describe('ticking a receipt changes nothing anyone is reporting', () => {
  it('leaves every total on the report exactly where it was', async () => {
    // `domain-modeling.md §6` is LOCKED and this table is not in the union. The
    // check-off records what a PERSON did with a receipt after R3 had finished
    // computing it, and a report that moved when someone ticked a box would be a
    // report nobody could reconcile against the paper log.
    const { donorId, actor } = await oneWeighedPickup();

    const before = await weeklyReport(RANGE.from, RANGE.to);
    await markReceiptSubmitted(actor, '2026-08-04', donorId);
    const after = await weeklyReport(RANGE.from, RANGE.to);

    expect(after.reportedTotal).toBe(before.reportedTotal);
    expect(after.intakeTotal).toBe(before.intakeTotal);
    expect(after.unreportedTotal).toBe(before.unreportedTotal);
    expect(after.lines).toEqual(before.lines);
    expect(after.readyToExport).toBe(before.readyToExport);
  });
});

// ---------------------------------------------------------------------------
// 4. The window (D41)
// ---------------------------------------------------------------------------

describe('the report takes a range, defaulting to this week (D41)', () => {
  it('defaults to the Monday-to-Sunday week containing the pantry today', async () => {
    const range = await resolveRange({});
    // The same boundary S3.1's report, S1.2's board and (since D39) Admin metrics
    // cut on, so two screens open side by side cannot disagree about "this week".
    expect(weekBounds(range.from).weekStart).toBe(range.from);
    expect(weekBounds(range.from).weekEnd).toBe(range.to);
  });

  it('honours an explicit from/to, and a `week` anchor for a bookmark saved before D41', async () => {
    expect(await resolveRange({ from: '2026-07-20', to: '2026-08-09' })).toEqual({
      from: '2026-07-20',
      to: '2026-08-09',
    });
    expect(await resolveRange({ week: WEEK })).toEqual({
      from: '2026-08-03',
      to: '2026-08-09',
    });
  });

  it('refuses a backwards range rather than silently swapping it', async () => {
    // Swapping would answer a question nobody asked. The one place a Reporter types
    // these is two date fields, where the wrong way round is a typo they can see.
    await expect(resolveRange({ from: '2026-08-09', to: '2026-08-03' })).rejects.toThrow(
      /on or before/i,
    );
  });

  it('yields more receipts over a longer window, each computed exactly as before', async () => {
    // D41 widened ONE function's window. Nothing about D28's whole-pound rounding or
    // D27's deduction depends on seven days: both are keyed `(pickup date, donor)`,
    // so a fortnight is more receipts and not different receipts.
    const first = await oneWeighedPickup('70');

    // A week later, at a different store: `occurrence_date` is derived from
    // `startsAt`, which is the fixture's own rule.
    const secondShift = await makeStartedShift({
      stopCount: 1,
      startsAt: new Date('2026-08-11T14:00:00Z'),
    });
    await addWeight(first.actor, secondShift.shift.id, secondShift.stops[0]!.id, {
      categoryId: first.produce.id,
      weight: '30',
    });

    const oneWeek = await exportReceipts('2026-08-03', '2026-08-09');
    expect(oneWeek.receipts.filter((r) => r.totalPounds !== '0')).toHaveLength(1);

    const twoWeeks = await exportReceipts('2026-08-03', '2026-08-16');
    const withPounds = twoWeeks.receipts.filter((r) => r.totalPounds !== '0');
    expect(withPounds).toHaveLength(2);
    // Each receipt is the same number it was when it stood alone in its own week.
    expect(withPounds.map((r) => r.totalPounds).sort()).toEqual(['30', '70']);

    const report = await weeklyReport('2026-08-03', '2026-08-16');
    expect(report.from).toBe('2026-08-03');
    expect(report.to).toBe('2026-08-16');
    expect(report.reportedTotal).toBe('100.00');
  });
});
