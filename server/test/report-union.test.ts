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
  exportRows,
  listMappings,
  removeNtfbCategory,
  reportEntries,
  reviseReportedWeight,
  setMapping,
  weekBounds,
  weeklyReport,
} from '../src/services/report.js';
import { intakeMetrics } from '../src/services/metrics.js';
import { createDonation } from '../src/services/donation.js';
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
    // pantry-local today — so ask for today's week, not the fixture shift's.
    const today = new Date().toISOString().slice(0, 10);

    const report = await weeklyReport(today);
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

    const report = await weeklyReport(WEEK);
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
    const report = await weeklyReport(WEEK);
    expect(report.intakeTotal).toBe('60.00');

    // And it is absent from the week that contains `created_at`.
    const thisWeek = await weeklyReport(new Date().toISOString().slice(0, 10));
    expect(thisWeek.intakeTotal).toBe('0.00');
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

    expect((await weeklyReport(WEEK)).intakeTotal).toBe('0.00');
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

    expect((await weeklyReport(WEEK)).intakeTotal).toBe('0.00');
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

    const report = await weeklyReport(WEEK);

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

    const report = await weeklyReport(WEEK);
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

    const report = await weeklyReport(WEEK);

    // The silent-drop failure this exists to prevent: the report would read 0.00
    // reported with 70 lb of food in the building, and nothing would say so.
    expect(report.unmapped).toHaveLength(1);
    expect(report.unmapped[0]!.total).toBe('70.00');
    expect(report.readyToExport).toBe(false);
    expect(report.lines).toHaveLength(0);

    await expect(exportRows(WEEK)).rejects.toThrow(/not matched/i);
  });

  it('counts unmapped-but-reportable weight as REPORTED, never as UNREPORTED', async () => {
    // Found by exercising the API rather than by a gate. A scheduled weight is
    // reportable by construction (I15); having no NTFB category yet is a gap in the
    // mapping table, not a decision that the food goes unreported. Deriving
    // `unreportedTotal` from Σ(lines) filed it under "tracked for pantry metrics only,
    // never reported" — a real category with a real meaning, and not this one.
    const { shift, stops, actor, produce } = await scene();
    await addWeight(actor, shift.id, stops[0]!.id, { categoryId: produce.id, weight: '70' });

    const report = await weeklyReport(WEEK);

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

    const report = await weeklyReport(WEEK);

    expect(report.intakeTotal).toBe('45.00');
    expect(report.reportedTotal).toBe('40.00'); // 10 mapped + 30 unmapped
    expect(report.unreportedTotal).toBe('5.00'); // only the toggled-off walk-in
    expect(report.unmapped.map((u) => u.total)).toEqual(['30.00']);
    expect(report.readyToExport).toBe(false);
  });

  it('exports once everything carrying weight is mapped', async () => {
    const { shift, stops, actor, produce } = await scene();
    const ntfb = await createNtfbCategory({ name: 'Produce', code: 'PRO' });
    await setMapping(produce.id, ntfb.id);
    await addWeight(actor, shift.id, stops[0]!.id, { categoryId: produce.id, weight: '70' });

    const { rows } = await exportRows(WEEK);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      day: '2026-08-04',
      ntfbCategory: 'Produce',
      ntfbCode: 'PRO',
      agfpCategory: 'Produce',
      weightLb: '70.00',
    });
  });

  it('does not block on a category that is mapped to nothing but carries no weight', async () => {
    const { shift, stops, actor, produce } = await scene();
    const ntfb = await createNtfbCategory({ name: 'Produce' });
    await setMapping(produce.id, ntfb.id);
    // `bakery` exists, is unmapped, and has no entries this week.
    await addWeight(actor, shift.id, stops[0]!.id, { categoryId: produce.id, weight: '5' });

    const report = await weeklyReport(WEEK);
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

    const entries = await reportEntries(WEEK);
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

    const entries = await reportEntries(WEEK);
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

    const before = await reportEntries(WEEK);
    expect(before[0]!.receiverWindowOpen).toBe(false);

    const after = await reviseReportedWeight({ id: reporter.id }, before[0]!.id, {
      weight: '120',
    });

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

  it('refuses to revise an already-voided entry', async () => {
    const { shift, stops, actor, produce } = await scene();
    const reporter = await makeReceiver();
    await addWeight(actor, shift.id, stops[0]!.id, { categoryId: produce.id, weight: '10' });
    const entries = await reportEntries(WEEK);

    await reviseReportedWeight({ id: reporter.id }, entries[0]!.id, { weight: '20' });
    await expect(
      reviseReportedWeight({ id: reporter.id }, entries[0]!.id, { weight: '30' }),
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

    expect(northside).toMatchObject({
      intake: '70.00',
      reported: '50.00',
      unreported: '20.00',
    });
    expect(metrics.totalIntake).toBe('70.00');
    expect(metrics.totalUnreported).toBe('20.00');
  });

  it('reports no previous figure rather than zero when there is no prior period', async () => {
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
    // Null, not "0.00" — a store with no history must not render as a 100% drop.
    expect(metrics.stores[0]!.previousIntake).toBeNull();
  });
});
