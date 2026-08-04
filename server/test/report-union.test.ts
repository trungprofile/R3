// The report and metrics unions — `domain-modeling.md §6` (locked), `data-model.md §8`.
//
//     report  = weight_entry[NOT voided] ∪ unscheduled_donation[CONFIRMED ∧ reportable]
//     metrics = weight_entry[NOT voided] ∪ unscheduled_donation[CONFIRMED]
//
// Every test here exists because the corresponding mistake produces a number that
// looks right. That is the whole difficulty of testing aggregation: a wrong total is
// still a total, and nothing crashes.
//
// The three mistakes, each with its own test below:
//
//   1. Filtering the union on `shift` — drops every walk-in, silently.
//   2. Bucketing on `created_at` — mis-files anything received after midnight.
//   3. Counting voided rows, or counting unreportable ones in the report.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { db, pool } from '../src/db/index.js';
import {
  createNtfbCategory,
  exportReceipts,
  listMappings,
  removeNtfbCategory,
  reportEntries,
  reviseReportedWeight,
  setMapping,
  weekBounds,
  pantryToday,
  weeklyReport,
} from '../src/services/report.js';
import { intakeMetrics } from '../src/services/metrics.js';
import { createDonation, setReportable } from '../src/services/donation.js';
import { addWeight } from '../src/services/receive.js';
import {
  makeCategory,
  makeDonor,
  makeReceiver,
  makeStartedShift,
  resetDatabase,
} from './fixtures.js';

/** The fixture shift sits on 2026-08-04, a Tuesday. Its week is Mon 3rd–Sun 9th. */
const WEEK = '2026-08-04';

/**
 * An anchor date as the RANGE the report now takes (D41).
 *
 * `weeklyReport` / `exportReceipts` / `reportEntries` were widened from one week
 * anchor to `(from, to)`, and the default the route applies when a caller names no
 * dates is still this: the Monday-to-Sunday week containing the anchor (A178). These
 * tests all work in whole weeks, so resolving the anchor here keeps every assertion
 * below about the arithmetic rather than about the new signature.
 */
function weekOf(anchor: string): [string, string] {
  const { weekStart, weekEnd } = weekBounds(anchor);
  return [weekStart, weekEnd];
}

/** The same window as an object, for the calls that take one. */
const RANGE = { from: weekBounds(WEEK).weekStart, to: weekBounds(WEEK).weekEnd };

beforeEach(resetDatabase);
afterAll(async () => {
  await pool.end();
});

async function scene() {
  const started = await makeStartedShift({ stopCount: 1 });
  const user = await makeReceiver();
  const produce = await makeCategory('Produce');
  const bakery = await makeCategory('Bakery');
  return { ...started, actor: { id: user.id }, produce, bakery };
}

describe('week bounds', () => {
  it('runs Monday to Sunday whichever day you ask about', () => {
    // 2026-08-04 is a Tuesday.
    expect(weekBounds('2026-08-04')).toEqual({
      weekStart: '2026-08-03',
      weekEnd: '2026-08-09',
    });
    // The Monday itself, and the Sunday, resolve to the same week.
    expect(weekBounds('2026-08-03').weekStart).toBe('2026-08-03');
    expect(weekBounds('2026-08-09').weekStart).toBe('2026-08-03');
    // And the day after is the next week, not a rolling seven days.
    expect(weekBounds('2026-08-10').weekStart).toBe('2026-08-10');
  });
});

describe('the union must not filter on shift', () => {
  it('counts a walk-in, which has no shift at all', async () => {
    const { actor, produce } = await scene();
    const donor = await makeDonor('Corner Market');

    await createDonation(actor, {
      donorId: donor.id,
      categoryId: produce.id,
      weight: '40',
    });
    // A walk-in's date is its own received_date, which `createDonation` sets to the
    // PANTRY-LOCAL today (D10) — so ask for that day's week, not the fixture shift's
    // and not the machine's. `new Date().toISOString()` is the UTC date, which is
    // already tomorrow at the pantry every evening after 7pm Chicago; on a Sunday
    // that lands the query in the NEXT week and this test failed for the clock
    // rather than for the code. Exactly the failure §6 records from Wave 3: a green
    // gate is evidence only if the suite is time-independent.
    const today = await pantryToday();

    const report = await weeklyReport(...weekOf(today));
    expect(report.intakeTotal).toBe('40.00');

    // The failure this guards: a join starting from `shift` would return 0.00 here
    // and the report would still look like a report.
    expect(report.intakeTotal).not.toBe('0.00');
  });

  it('counts a scheduled weight and a walk-in together', async () => {
    const { shift, stops, actor, produce } = await scene();
    const donor = await makeDonor('Corner Market');

    await addWeight(actor, shift.id, stops[0]!.id, {
      categoryId: produce.id,
      weight: '100',
    });
    // Force the donation onto the same business day as the shift.
    const created = await createDonation(actor, {
      donorId: donor.id,
      categoryId: produce.id,
      weight: '25',
    });
    await db
      .updateTable('unscheduled_donation')
      .set({ received_date: '2026-08-04' })
      .where('id', '=', created.id)
      .execute();

    const report = await weeklyReport(...weekOf(WEEK));
    expect(report.intakeTotal).toBe('125.00');
  });
});

describe('report_day is a business day, never created_at', () => {
  it('buckets a weight to its shift occurrence date, not to when it was typed', async () => {
    const { shift, stops, actor, produce } = await scene();
    await addWeight(actor, shift.id, stops[0]!.id, {
      categoryId: produce.id,
      weight: '60',
    });

    // The row was created just now; the shift is dated 2026-08-04. A Tuesday-night
    // run received at 12:30am Wednesday belongs to Tuesday (§8).
    const report = await weeklyReport(...weekOf(WEEK));
    expect(report.intakeTotal).toBe('60.00');

    // And it is absent from the week that contains `created_at`. That week is PINNED
    // rather than read off the clock: asking for "the week containing now" made the
    // assertion vacuous whenever now happened to fall in the fixture shift's own week
    // — which it does for seven days out of every ~53, and did on 2026-08-03. Moving
    // `created_at` to a fixed instant three weeks out makes the two weeks provably
    // different, so this asserts the bucketing rule instead of asserting the date.
    await db
      .updateTable('weight_entry')
      .set({ created_at: new Date('2026-08-26T02:30:00Z') })
      .execute();

    const createdAtWeek = await weeklyReport(...weekOf('2026-08-26'));
    expect(createdAtWeek.intakeTotal).toBe('0.00');

    // ...and it is still in the shift's week, which is the other half of the rule.
    const stillThere = await weeklyReport(...weekOf(WEEK));
    expect(stillThere.intakeTotal).toBe('60.00');
  });
});

describe('what counts', () => {
  it('excludes voided weights (I13)', async () => {
    const { shift, stops, actor, produce } = await scene();
    const detail = await addWeight(actor, shift.id, stops[0]!.id, {
      categoryId: produce.id,
      weight: '80',
    });
    const entry = detail.tiles.find((t) => t.categoryId === produce.id)!.entries[0]!;
    await db.updateTable('weight_entry').set({ voided: true }).where('id', '=', entry.id).execute();

    expect((await weeklyReport(...weekOf(WEEK))).intakeTotal).toBe('0.00');
  });

  it('excludes SUGGESTED donations — a prefill is not intake (I17)', async () => {
    const { actor, produce } = await scene();
    const donor = await makeDonor();
    const created = await createDonation(actor, {
      donorId: donor.id,
      categoryId: produce.id,
      weight: '30',
    });
    await db
      .updateTable('unscheduled_donation')
      .set({ status: 'SUGGESTED', weight: null, received_date: '2026-08-04' })
      .where('id', '=', created.id)
      .execute();

    expect((await weeklyReport(...weekOf(WEEK))).intakeTotal).toBe('0.00');
  });

  it('counts an unreported donation as INTAKE but never as REPORTED', async () => {
    const { actor, produce } = await scene();
    const ntfb = await createNtfbCategory({ name: 'Produce' });
    await setMapping(produce.id, ntfb.id);

    const created = await createDonation(actor, {
      categoryId: produce.id,
      weight: '15',
      reportable: false,
    });
    await db
      .updateTable('unscheduled_donation')
      .set({ received_date: '2026-08-04' })
      .where('id', '=', created.id)
      .execute();

    const report = await weeklyReport(...weekOf(WEEK));

    // The key data boundary of PRD §3, as two numbers that must not converge.
    expect(report.intakeTotal).toBe('15.00');
    expect(report.reportedTotal).toBe('0.00');
    expect(report.unreportedTotal).toBe('15.00');
  });
});

describe('the AGFP→NTFB mapping', () => {
  it('rolls several AGFP categories into one NTFB line', async () => {
    const { shift, stops, actor, produce, bakery } = await scene();
    const dry = await createNtfbCategory({ name: 'Dry Goods', code: 'DRY' });
    await setMapping(produce.id, dry.id);
    await setMapping(bakery.id, dry.id);

    await addWeight(actor, shift.id, stops[0]!.id, { categoryId: produce.id, weight: '10' });
    await addWeight(actor, shift.id, stops[0]!.id, { categoryId: bakery.id, weight: '5' });

    const report = await weeklyReport(...weekOf(WEEK));
    expect(report.lines).toHaveLength(1);
    expect(report.lines[0]!.total).toBe('15.00');
    // Inspectable one level before the drill-in: which AGFP categories made it up.
    expect(report.lines[0]!.agfpCategories.map((c) => c.categoryName).sort()).toEqual([
      'Bakery',
      'Produce',
    ]);
    expect(report.lines[0]!.ntfbCode).toBe('DRY');
  });

  it('surfaces unmapped weight and BLOCKS the export rather than dropping it', async () => {
    const { shift, stops, actor, produce } = await scene();
    await addWeight(actor, shift.id, stops[0]!.id, { categoryId: produce.id, weight: '70' });

    const report = await weeklyReport(...weekOf(WEEK));

    // The silent-drop failure this exists to prevent: the report would read 0.00
    // reported with 70 lb of food in the building, and nothing would say so.
    expect(report.unmapped).toHaveLength(1);
    expect(report.unmapped[0]!.total).toBe('70.00');
    expect(report.readyToExport).toBe(false);
    expect(report.lines).toHaveLength(0);

    await expect(exportReceipts(...weekOf(WEEK))).rejects.toThrow(/not matched/i);
  });

  it('counts unmapped-but-reportable weight as REPORTED, never as UNREPORTED', async () => {
    // Found by exercising the API rather than by a gate. A scheduled weight is
    // reportable by construction (I15); having no NTFB category yet is a gap in the
    // mapping table, not a decision that the food goes unreported. Deriving
    // `unreportedTotal` from Σ(lines) filed it under "tracked for pantry metrics only,
    // never reported" — a real category with a real meaning, and not this one.
    const { shift, stops, actor, produce } = await scene();
    await addWeight(actor, shift.id, stops[0]!.id, { categoryId: produce.id, weight: '70' });

    const report = await weeklyReport(...weekOf(WEEK));

    expect(report.intakeTotal).toBe('70.00');
    expect(report.reportedTotal).toBe('70.00');
    expect(report.unreportedTotal).toBe('0.00');
    // And the gap between Σ(lines) and reportedTotal is what the block announces.
    expect(report.lines).toHaveLength(0);
    expect(report.readyToExport).toBe(false);
  });

  it('separates the two reasons a number is missing from the export', async () => {
    const { shift, stops, actor, produce, bakery } = await scene();
    const ntfb = await createNtfbCategory({ name: 'Bakery' });
    await setMapping(bakery.id, ntfb.id);

    // Mapped and reportable → in the lines.
    await addWeight(actor, shift.id, stops[0]!.id, { categoryId: bakery.id, weight: '10' });
    // Reportable but unmapped → blocks, and still counts as reported.
    await addWeight(actor, shift.id, stops[0]!.id, { categoryId: produce.id, weight: '30' });
    // Genuinely unreported → never counts as reported, and does not block.
    const walkIn = await createDonation(actor, {
      categoryId: bakery.id,
      weight: '5',
      reportable: false,
    });
    await db
      .updateTable('unscheduled_donation')
      .set({ received_date: '2026-08-04' })
      .where('id', '=', walkIn.id)
      .execute();

    const report = await weeklyReport(...weekOf(WEEK));

    expect(report.intakeTotal).toBe('45.00');
    expect(report.reportedTotal).toBe('40.00'); // 10 mapped + 30 unmapped
    expect(report.unreportedTotal).toBe('5.00'); // only the toggled-off walk-in
    expect(report.unmapped.map((u) => u.total)).toEqual(['30.00']);
    expect(report.readyToExport).toBe(false);
  });

  it('exports once everything carrying weight is mapped', async () => {
    const { shift, stops, actor, produce } = await scene();
    const ntfb = await createNtfbCategory({ name: 'Produce', code: 'PRO' });
    await setMapping(produce.id, ntfb.id, 'Refrigeration');
    await addWeight(actor, shift.id, stops[0]!.id, { categoryId: produce.id, weight: '70' });

    const { receipts } = await exportReceipts(...weekOf(WEEK));
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      pickupDate: '2026-08-04',
      // Meal Connect's own two figures, which its review screen shows back before
      // Submit and which are therefore the check that a receipt was typed completely.
      itemCount: 1,
      totalPounds: '70',
      notAttempted: false,
      noPounds: false,
    });
    expect(receipts[0]!.lines).toEqual([
      {
        ntfbCategory: 'Produce',
        storage: 'Refrigeration',
        pounds: '70',
        agfpCategory: 'Produce',
        computed: false,
      },
    ]);
  });

  it('splits one NTFB category into two lines when the storage differs', async () => {
    // The receipt this was built from carries two `Prepared Meals` lines, so Meal
    // Connect treats (category, storage) as the line item and not the category
    // alone. Rolling these into one line would file frozen food as dry.
    const { shift, stops, actor, produce, bakery } = await scene();
    const assorted = await createNtfbCategory({ name: 'Assorted Dry Food' });
    await setMapping(produce.id, assorted.id, 'Frozen');
    await setMapping(bakery.id, assorted.id, 'Dry');

    await addWeight(actor, shift.id, stops[0]!.id, { categoryId: produce.id, weight: '10' });
    await addWeight(actor, shift.id, stops[0]!.id, { categoryId: bakery.id, weight: '5' });

    const report = await weeklyReport(...weekOf(WEEK));
    expect(report.lines).toHaveLength(2);
    expect(report.lines.map((line) => [line.storage, line.total])).toEqual([
      ['Dry', '5.00'],
      ['Frozen', '10.00'],
    ]);

    // And two line items on ONE receipt, whose total is still the pair's sum.
    const { receipts } = await exportReceipts(...weekOf(WEEK));
    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.lines.map((line) => line.storage)).toEqual(['Dry', 'Frozen']);
    expect(receipts[0]!.itemCount).toBe(2);
    expect(receipts[0]!.totalPounds).toBe('15');
  });

  it('orders the export by receipt, and totals each one', async () => {
    // Receipt order is day → store → category, because that is the order a Reporter
    // types them in. Ordering by category first scatters one receipt's lines down
    // the file, which is what this did while the format was a guess.
    const started = await makeStartedShift({ stopCount: 2 });
    const user = await makeReceiver();
    const actor = { id: user.id };
    const produce = await makeCategory('Produce');
    const bakery = await makeCategory('Bakery');

    const fresh = await createNtfbCategory({ name: 'Produce' });
    const bread = await createNtfbCategory({ name: 'Bread' });
    await setMapping(produce.id, fresh.id, 'Refrigeration');
    await setMapping(bakery.id, bread.id, 'Dry');

    // Two stores, each with both categories, entered in an order that is neither.
    await addWeight(actor, started.shift.id, started.stops[1]!.id, {
      categoryId: bakery.id,
      weight: '4',
    });
    await addWeight(actor, started.shift.id, started.stops[0]!.id, {
      categoryId: produce.id,
      weight: '10',
    });
    await addWeight(actor, started.shift.id, started.stops[1]!.id, {
      categoryId: produce.id,
      weight: '20',
    });
    await addWeight(actor, started.shift.id, started.stops[0]!.id, {
      categoryId: bakery.id,
      weight: '3',
    });

    const { receipts } = await exportReceipts(...weekOf(WEEK));
    const donorNames = started.donors.map((d) => d.name).sort();

    // One card per store, in the order they are typed.
    expect(receipts.map((r) => r.donorName)).toEqual([donorNames[0], donorNames[1]]);
    // Within a card, by category.
    for (const receipt of receipts) {
      expect(receipt.lines.map((line) => line.ntfbCategory)).toEqual(['Bread', 'Produce']);
      expect(receipt.itemCount).toBe(2);
    }
    // Each card's own total — never the week's.
    expect(receipts.map((r) => r.totalPounds).sort()).toEqual(['13', '24']);
  });

  it('carries the food bank’s own donor number onto the receipt', async () => {
    // Meal Connect's donor picker reads `H-E-B Food Stores (810)`, so the code is
    // what makes a row unambiguous at the far end.
    const { shift, stops, actor, produce, donors } = await scene();
    const ntfb = await createNtfbCategory({ name: 'Produce' });
    await setMapping(produce.id, ntfb.id, 'Refrigeration');
    await db
      .updateTable('donor')
      .set({ ntfb_donor_code: '810' })
      .where('id', '=', donors[0]!.id)
      .execute();
    await addWeight(actor, shift.id, stops[0]!.id, { categoryId: produce.id, weight: '9' });

    const { receipts } = await exportReceipts(...weekOf(WEEK));
    expect(receipts[0]!.donorCode).toBe('810');
  });

  it('clears the storage when the category it belonged to is cleared', async () => {
    // Storage is the other half of a line item. Leaving `Frozen` behind would
    // silently reattach it to whatever this category is pointed at next.
    const { produce } = await scene();
    const ntfb = await createNtfbCategory({ name: 'Produce' });
    await setMapping(produce.id, ntfb.id, 'Refrigeration');
    expect((await listMappings()).find((m) => m.categoryId === produce.id)!.storage).toBe(
      'Refrigeration',
    );

    await setMapping(produce.id, null);
    const cleared = (await listMappings()).find((m) => m.categoryId === produce.id)!;
    expect(cleared.ntfbCategoryId).toBeNull();
    expect(cleared.storage).toBeNull();
  });

  it('does not block on a category that is mapped to nothing but carries no weight', async () => {
    const { shift, stops, actor, produce } = await scene();
    const ntfb = await createNtfbCategory({ name: 'Produce' });
    await setMapping(produce.id, ntfb.id);
    // `bakery` exists, is unmapped, and has no entries this week.
    await addWeight(actor, shift.id, stops[0]!.id, { categoryId: produce.id, weight: '5' });

    const report = await weeklyReport(...weekOf(WEEK));
    expect(report.unmapped).toHaveLength(0);
    expect(report.readyToExport).toBe(true);
  });

  it('archives an NTFB category that is mapped, and deletes one that is not (I21)', async () => {
    const { produce } = await scene();
    const unused = await createNtfbCategory({ name: 'Never Used' });
    expect(await removeNtfbCategory(unused.id)).toBe('DELETED');

    const used = await createNtfbCategory({ name: 'In Use' });
    await setMapping(produce.id, used.id);
    expect(await removeNtfbCategory(used.id)).toBe('DEACTIVATED');
  });

  it('refuses a duplicate NTFB category name', async () => {
    await createNtfbCategory({ name: 'Produce' });
    await expect(createNtfbCategory({ name: 'produce' })).rejects.toThrow(/already/i);
  });

  it('lists every AGFP category, mapped or not', async () => {
    await scene();
    const mappings = await listMappings();
    expect(mappings.map((m) => m.categoryName).sort()).toEqual(['Bakery', 'Produce']);
    expect(mappings.every((m) => m.ntfbCategoryId === null)).toBe(true);
  });
});

describe('the drill-in (Success Metric 4)', () => {
  it('resolves every number to store, day and receiver', async () => {
    const { shift, stops, actor, produce } = await scene();
    await addWeight(actor, shift.id, stops[0]!.id, { categoryId: produce.id, weight: '12' });

    const entries = await reportEntries(...weekOf(WEEK));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: 'WEIGHT',
      day: '2026-08-04',
      weight: '12.00',
      reportable: true,
    });
    expect(entries[0]!.donorName).toMatch(/\S/);
    expect(entries[0]!.receiverName).toMatch(/\S/);
    expect(entries[0]!.routeName).toMatch(/\S/);
  });

  it('shows a walk-in with no run and an unattributed donor', async () => {
    const { actor, produce } = await scene();
    const created = await createDonation(actor, {
      categoryId: produce.id,
      weight: '9',
      reportable: false,
    });
    await db
      .updateTable('unscheduled_donation')
      .set({ received_date: '2026-08-04' })
      .where('id', '=', created.id)
      .execute();

    const entries = await reportEntries(...weekOf(WEEK));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: 'DONATION',
      donorName: 'Unattributed',
      shiftId: null,
      routeName: null,
      reportable: false,
    });
  });
});

describe("the Reporter's correction (cap 15)", () => {
  it('voids and reinserts, and works after the receiver window has closed', async () => {
    const { shift, stops, actor, produce } = await scene();
    const reporter = await makeReceiver();
    await addWeight(actor, shift.id, stops[0]!.id, { categoryId: produce.id, weight: '100' });

    // Slam the window shut. The receiver can no longer touch this run.
    await db
      .updateTable('shift')
      .set({ starts_at: new Date(Date.now() - 90 * 24 * 3600 * 1000) })
      .where('id', '=', shift.id)
      .execute();

    const before = await reportEntries(...weekOf(WEEK));
    expect(before[0]!.receiverWindowOpen).toBe(false);

    const after = await reviseReportedWeight(
      { id: reporter.id },
      before[0]!.id,
      { weight: '120' },
      // D41 — the revise re-reads the RANGE the Reporter is looking at, narrowed to
      // the entry's own category. It used to answer with the whole week across every
      // category, under one category's heading in the drill-in.
      RANGE,
    );

    // One live entry, the new value; the old row retained and voided (I13).
    expect(after).toHaveLength(1);
    expect(after[0]!.weight).toBe('120.00');

    const rows = await db
      .selectFrom('weight_entry')
      .select(['voided', sql<string>`weight::text`.as('weight')])
      .orderBy('created_at')
      .execute();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ voided: true, weight: '100.00' });
    expect(rows[1]).toMatchObject({ voided: false, weight: '120.00' });
  });

  it('lets the Reporter flip the report toggle after the window has closed', async () => {
    // The gap that let a real bug ship: the weight path had a post-window test and
    // the toggle did not, so the toggle quietly inherited the RECEIVER's window gate
    // through the shared service and became uneditable by anyone — the reverse of
    // cap 15, which makes this drill-in the only remaining way to correct an entry.
    const { shift, actor, produce } = await scene();
    const reporter = await makeReceiver();
    const donor = await makeDonor('Corner Market');

    const donation = await createDonation(actor, {
      donorId: donor.id,
      categoryId: produce.id,
      weight: '25',
    });
    await db
      .updateTable('unscheduled_donation')
      .set({ received_date: '2026-08-04', shift_id: shift.id })
      .where('id', '=', donation.id)
      .execute();

    await db
      .updateTable('shift')
      .set({ starts_at: new Date(Date.now() - 90 * 24 * 3600 * 1000) })
      .where('id', '=', shift.id)
      .execute();

    // The receiver is out of time...
    await expect(setReportable({ id: actor.id }, donation.id, false)).rejects.toThrow(
      /time to change this run has passed/i,
    );

    // ...and the Reporter is not, which is the entire point of S3.1's edit.
    const updated = await setReportable({ id: reporter.id }, donation.id, false, {
      enforceWindow: false,
    });
    expect(updated.reportable).toBe(false);

    // And it took effect: the week's reported total drops by the toggled-off donation.
    const report = await weeklyReport(...weekOf(WEEK));
    expect(report.unreportedTotal).toBe('25.00');
  });

  it('refuses to revise an already-voided entry', async () => {
    const { shift, stops, actor, produce } = await scene();
    const reporter = await makeReceiver();
    await addWeight(actor, shift.id, stops[0]!.id, { categoryId: produce.id, weight: '10' });
    const entries = await reportEntries(...weekOf(WEEK));

    await reviseReportedWeight({ id: reporter.id }, entries[0]!.id, { weight: '20' }, RANGE);
    await expect(
      reviseReportedWeight({ id: reporter.id }, entries[0]!.id, { weight: '30' }, RANGE),
    ).rejects.toThrow(/already changed/i);
  });
});

describe('metrics ignore the reportable flag entirely', () => {
  it('counts reported and unreported alike as intake, split per store', async () => {
    const { actor, produce } = await scene();
    const store = await makeDonor('Northside');

    const reported = await createDonation(actor, {
      donorId: store.id,
      categoryId: produce.id,
      weight: '50',
    });
    const notReported = await createDonation(actor, {
      donorId: store.id,
      categoryId: produce.id,
      weight: '20',
      reportable: false,
    });
    for (const row of [reported, notReported]) {
      await db
        .updateTable('unscheduled_donation')
        .set({ received_date: '2026-08-04' })
        .where('id', '=', row.id)
        .execute();
    }

    const metrics = await intakeMetrics({ from: '2026-08-03', to: '2026-08-09' });
    const northside = metrics.stores.find((s) => s.donorName === 'Northside');

    // D58 cut the per-store `unreported` column; the two figures the row still
    // carries are the boundary itself, and the difference is read off them.
    expect(northside).toMatchObject({ intake: '70.00', reported: '50.00' });
    expect(metrics.totalIntake).toBe('70.00');
    // PRD cap 16's "unreported donation volume" survives as the aggregate figure.
    expect(metrics.totalUnreported).toBe('20.00');
  });

  it('measures one window and no other (D58)', async () => {
    // The comparison period is GONE: `intakeMetrics` used to run its union twice, so
    // the table could carry a Change column against an equal-length period before
    // this one. Nothing renders that any more, and a payload that still announced a
    // window nobody measured against would be a promise with no query behind it.
    const { actor, produce } = await scene();
    const store = await makeDonor('Northside');
    const created = await createDonation(actor, {
      donorId: store.id,
      categoryId: produce.id,
      weight: '10',
    });
    await db
      .updateTable('unscheduled_donation')
      .set({ received_date: '2026-08-04' })
      .where('id', '=', created.id)
      .execute();

    const metrics = await intakeMetrics({ from: '2026-08-03', to: '2026-08-09' });
    expect(metrics.from).toBe('2026-08-03');
    expect(metrics.to).toBe('2026-08-09');
    expect(Object.keys(metrics).sort()).toEqual([
      'from',
      'stores',
      'to',
      'totalIntake',
      'totalReported',
      'totalUnreported',
    ]);
    expect(Object.keys(metrics.stores[0]!).sort()).toEqual([
      'donorId',
      'donorName',
      'intake',
      'reported',
    ]);
  });
});
