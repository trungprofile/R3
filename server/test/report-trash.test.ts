// The trash deduction (D27), whole pounds (D28) and the Meal Connect receipt (D29).
//
// This is the pilot-blocking arithmetic. Everything here exists because the wrong
// answer is still a number: a deduction taken in the wrong ORDER, or off the wrong
// categories, or applied on one of the two code paths and not the other, produces a
// report that reconciles against itself and disagrees with the pantry's paper.
//
// The four things asserted, in the order they can go wrong:
//
//   1. THE PAPER SHEET, to the pound. One real Retail Rescue Log reconciles exactly —
//      827/3691/53 gross at 10/10/15% gives 83+369+8 = 460 Trash and 744/3322/45 net.
//      Round the gross FIRST, then the deduction, then subtract; no other order closes
//      the columns.
//   2. CONSERVATION. `net + trash == gross`, because Trash is itself a reported NTFB
//      category. The deduction moves weight between reported categories and never
//      changes the reported total. An implementation that breaks this is wrong however
//      plausible each individual figure looks.
//   3. THE TWO PATHS AGREE. S3.1's screen and the printed receipt are two shapes of one
//      week. They used to be two independent re-sums, which is the arrangement that
//      lets them differ by a pound with nothing to say which is right.
//   4. THE PICKUPS THAT PRODUCED NOTHING. A skipped stop and a run nobody worked
//      emitted no export row at all, so the food bank never learned they were
//      attempted. Meal Connect has a checkbox for each.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { ReceiptLine } from '../../shared/src/report.js';
import { db, pool } from '../src/db/index.js';
import {
  createNtfbCategory,
  exportReceipts,
  roundPounds,
  setMapping,
  trashDeduction,
  weekBounds,
  weeklyReport,
} from '../src/services/report.js';
import { addWeight } from '../src/services/receive.js';
import { createDonation } from '../src/services/donation.js';
import {
  makeCategory,
  makeReceiver,
  makeRoute,
  makeShift,
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

beforeEach(resetDatabase);
afterAll(async () => {
  await pool.end();
});

/**
 * The pantry's world as migrations 0010/0016/0017 leave it, rebuilt by hand.
 *
 * `resetDatabase` truncates `category` and `ntfb_category`, so the seed is not there to
 * read (fixtures.ts says so in as many words). This assembles the four categories the
 * deduction actually touches, their NTFB buckets, and the archived `Trash` category
 * whose mapping is what makes the computed line resolvable.
 */
async function pantry() {
  const bread = await createNtfbCategory({ name: 'Bread' });
  const producePro = await createNtfbCategory({ name: 'Produce' });
  const prepared = await createNtfbCategory({ name: 'Prepared Meal' });
  const trashNtfb = await createNtfbCategory({ name: 'Trash' });

  const bakery = await makeCategory('Bakery');
  const produce = await makeCategory('Produce');
  const deli = await makeCategory('Deli');
  const frzNonMeat = await makeCategory('Frz Non Meat');

  await setMapping(bakery.id, bread.id, 'Dry');
  await setMapping(produce.id, producePro.id, 'Refrigerated');
  await setMapping(deli.id, prepared.id, 'Frozen');
  await setMapping(frzNonMeat.id, prepared.id, 'Frozen');

  // Archived exactly as 0016 leaves it — a receiver must not be able to weigh into a
  // category that is computed — but keeping its mapping, so the synthetic line still
  // reports as NTFB `Trash / Dry`.
  await db
    .insertInto('category')
    .values({
      name: 'Trash',
      ntfb_category_id: trashNtfb.id,
      ntfb_storage: 'Dry',
      deactivated_at: new Date(),
    })
    .execute();

  // The key is DATA, never a match on the literal name (0017). `Frz Non Meat` is
  // deliberately absent: it shares Deli's bucket and is deducted at no rate at all.
  for (const [id, key] of [
    [bakery.id, 'BAKERY'],
    [produce.id, 'PRODUCE'],
    [deli.id, 'DELI'],
  ] as const) {
    await db.updateTable('category').set({ trash_rate_key: key }).where('id', '=', id).execute();
  }

  return { bakery, produce, deli, frzNonMeat };
}

/** A started run with `stopCount` stops, plus a receiver to weigh into it. */
async function run(stopCount = 1) {
  const started = await makeStartedShift({ stopCount });
  const user = await makeReceiver();
  return { ...started, actor: { id: user.id } };
}

function lineFor(lines: ReceiptLine[], agfp: string): ReceiptLine | undefined {
  return lines.find((l) => l.agfpCategory === agfp);
}

// ---------------------------------------------------------------------------
// 1. The paper sheet
// ---------------------------------------------------------------------------

describe('the Retail Rescue Log, reproduced (D27)', () => {
  it('reads 744 / 3322 / 45 with a 460 lb Trash line, exactly as the sheet does', async () => {
    // THE WORKED EXAMPLE. Sam's Club, produce overridden to 10%: bakery 827 at 10%,
    // produce 3691 at 10%, deli 53 at 15%. 82.7 → 83, 369.1 → 369, 7.95 → 8. The three
    // deductions sum to 460, which is the boxed Trash figure on the paper.
    const { bakery, produce, deli } = await pantry();
    const { shift, stops, actor, donors } = await run(1);

    await db
      .updateTable('donor')
      .set({ name: "Sam's Club", trash_rate_produce: '0.1000' })
      .where('id', '=', donors[0]!.id)
      .execute();

    await addWeight(actor, shift.id, stops[0]!.id, { categoryId: bakery.id, weight: '827' });
    await addWeight(actor, shift.id, stops[0]!.id, { categoryId: produce.id, weight: '3691' });
    await addWeight(actor, shift.id, stops[0]!.id, { categoryId: deli.id, weight: '53' });

    const { receipts } = await exportReceipts(...weekOf(WEEK));
    expect(receipts).toHaveLength(1);
    const receipt = receipts[0]!;

    expect(receipt.lines).toEqual([
      {
        ntfbCategory: 'Bread',
        storage: 'Dry',
        pounds: '744',
        agfpCategory: 'Bakery',
        computed: false,
      },
      {
        ntfbCategory: 'Prepared Meal',
        storage: 'Frozen',
        pounds: '45',
        agfpCategory: 'Deli',
        computed: false,
      },
      {
        ntfbCategory: 'Produce',
        storage: 'Refrigerated',
        pounds: '3322',
        agfpCategory: 'Produce',
        computed: false,
      },
      {
        ntfbCategory: 'Trash',
        storage: 'Dry',
        pounds: '460',
        // Nothing was weighed into it. The AGFP `Trash` category is archived precisely
        // so nobody can, which is why this line carries no category of ours.
        agfpCategory: '',
        computed: true,
      },
    ]);

    expect(receipt.donorName).toBe("Sam's Club");
    expect(receipt.itemCount).toBe(4);
    // 744 + 45 + 3322 + 460 = 4571 = 827 + 3691 + 53. The sheet's own check.
    expect(receipt.totalPounds).toBe('4571');
  });

  it('rounds the DEDUCTION half-up, which is what makes 7.95 land on 8', async () => {
    // The one figure on the sheet that reveals the rounding rule. 53 × 15% = 7.95, and
    // the pantry wrote 8. Rounding down here loses a pound off Trash and gains one on
    // Deli, and the columns stop closing.
    expect(trashDeduction('53', '0.1500')).toBe('8');
    expect(trashDeduction('827', '0.1000')).toBe('83');
    expect(trashDeduction('3691', '0.1000')).toBe('369');
    // And the gross is rounded FIRST, so this is what the deduction is computed from.
    expect(roundPounds('826.5')).toBe('827');
    expect(roundPounds('826.49')).toBe('826');
  });

  it('deducts by trash_rate_key, never by the category NAME', async () => {
    // I21 lets an admin rename master data at any time. A `WHERE name = 'Bakery'`
    // implementation stops deducting the moment they do — no error, no warning, the
    // pantry just over-reports to the food bank until somebody re-derives the sheet by
    // hand. The key travels with the row, so the rename is invisible to the arithmetic.
    const { bakery } = await pantry();
    const { shift, stops, actor } = await run(1);

    await db
      .updateTable('category')
      .set({ name: 'Bakery & Bread' })
      .where('id', '=', bakery.id)
      .execute();

    await addWeight(actor, shift.id, stops[0]!.id, { categoryId: bakery.id, weight: '1000' });

    const { receipts } = await exportReceipts(...weekOf(WEEK));
    const lines = receipts[0]!.lines;
    expect(lineFor(lines, 'Bakery & Bread')!.pounds).toBe('900');
    expect(lines.find((l) => l.computed)!.pounds).toBe('100');
  });
});

// ---------------------------------------------------------------------------
// 2. Conservation
// ---------------------------------------------------------------------------

describe('the deduction moves weight, it never removes it', () => {
  it('keeps net_bakery + net_produce + net_deli + trash == the three grosses', async () => {
    // THE PROPERTY THE WHOLE FEATURE RESTS ON. Trash is itself a reported NTFB
    // category, so the reported total is unchanged by the deduction — which is what
    // makes it safe to add to a report that already reconciles. Awkward inputs on
    // purpose: each of the three rounds a different way.
    const { bakery, produce, deli } = await pantry();
    const { shift, stops, actor } = await run(1);

    await addWeight(actor, shift.id, stops[0]!.id, { categoryId: bakery.id, weight: '1234.40' });
    await addWeight(actor, shift.id, stops[0]!.id, { categoryId: produce.id, weight: '999.60' });
    await addWeight(actor, shift.id, stops[0]!.id, { categoryId: deli.id, weight: '77.70' });

    // The grosses, rounded first — the left-hand side of the property.
    const gross =
      Number(roundPounds('1234.40')) + Number(roundPounds('999.60')) + Number(roundPounds('77.70'));
    expect(gross).toBe(1234 + 1000 + 78);

    const { receipts } = await exportReceipts(...weekOf(WEEK));
    const lines = receipts[0]!.lines;

    // Defaults: 10% bakery, 5% produce, 15% deli.
    expect(lineFor(lines, 'Bakery')!.pounds).toBe('1111'); // 1234 − 123
    expect(lineFor(lines, 'Produce')!.pounds).toBe('950'); //  1000 −  50
    expect(lineFor(lines, 'Deli')!.pounds).toBe('66'); //        78 −  12
    const trash = lines.find((l) => l.computed)!;
    expect(trash.pounds).toBe('185'); // 123 + 50 + 12

    const net = Number(lineFor(lines, 'Bakery')!.pounds) +
      Number(lineFor(lines, 'Produce')!.pounds) +
      Number(lineFor(lines, 'Deli')!.pounds);

    expect(net + Number(trash.pounds)).toBe(gross);
    expect(receipts[0]!.totalPounds).toBe(String(gross));

    // And the same property one level up, on the screen: the week's reported total is
    // not moved by the deduction.
    const report = await weeklyReport(...weekOf(WEEK));
    expect(report.reportedTotal).toBe(`${gross}.00`);
  });

  it('conserves over a MULTI-WEEK range too, receipt by receipt (D41)', async () => {
    // D41 widened the report's window from a week to a range, and the brief said to
    // VERIFY rather than assume that nothing about D28's rounding or D27's deduction
    // depended on seven days. This is that verification, and it holds for a structural
    // reason: both are keyed `(pickup date, donor)`, so a fortnight is more receipts
    // and not different receipts. If either had been computed over the WINDOW instead,
    // `round(range gross x rate)` would not equal the sum of the per-receipt
    // deductions and this would come apart by a pound or two.
    const { bakery, produce, deli } = await pantry();

    const first = await run(1);
    await addWeight(first.actor, first.shift.id, first.stops[0]!.id, {
      categoryId: bakery.id,
      weight: '1234.40',
    });
    await addWeight(first.actor, first.shift.id, first.stops[0]!.id, {
      categoryId: produce.id,
      weight: '999.60',
    });
    await addWeight(first.actor, first.shift.id, first.stops[0]!.id, {
      categoryId: deli.id,
      weight: '77.70',
    });

    // A second store, a week later — a different receipt in a different week.
    const second = await makeStartedShift({
      stopCount: 1,
      startsAt: new Date('2026-08-11T14:00:00Z'),
    });
    await addWeight(first.actor, second.shift.id, second.stops[0]!.id, {
      categoryId: bakery.id,
      weight: '55.50',
    });
    await addWeight(first.actor, second.shift.id, second.stops[0]!.id, {
      categoryId: produce.id,
      weight: '333.30',
    });

    const { receipts } = await exportReceipts('2026-08-03', '2026-08-16');
    const withPounds = receipts.filter((r) => r.totalPounds !== '0');
    expect(withPounds).toHaveLength(2);

    // Receipt one is the SAME set of numbers the single-week test above asserts,
    // untouched by the longer window.
    const one = withPounds.find((r) => r.totalPounds === String(1234 + 1000 + 78))!;
    expect(lineFor(one.lines, 'Bakery')!.pounds).toBe('1111');
    expect(lineFor(one.lines, 'Produce')!.pounds).toBe('950');
    expect(lineFor(one.lines, 'Deli')!.pounds).toBe('66');
    expect(one.lines.find((l) => l.computed)!.pounds).toBe('185');

    // Receipt two: 56 bakery at 10% is 6, 333 produce at 5% is 17.
    const two = withPounds.find((r) => r !== one)!;
    expect(lineFor(two.lines, 'Bakery')!.pounds).toBe('50');
    expect(lineFor(two.lines, 'Produce')!.pounds).toBe('316');
    expect(two.lines.find((l) => l.computed)!.pounds).toBe('23');

    // Conservation, per receipt and therefore over the whole range: the reported
    // total is the sum of the rounded grosses and the deduction moved nothing out.
    const grossOne = 1234 + 1000 + 78;
    const grossTwo = 56 + 333;
    for (const receipt of withPounds) {
      const sum = receipt.lines.reduce((acc, line) => acc + Number(line.pounds), 0);
      expect(String(sum)).toBe(receipt.totalPounds);
    }
    const report = await weeklyReport('2026-08-03', '2026-08-16');
    expect(report.reportedTotal).toBe(`${grossOne + grossTwo}.00`);
  });

  it('leaves a category with no rate key completely alone', async () => {
    // `Frz Non Meat` shares Deli's NTFB bucket AND its storage, and is deducted at no
    // rate at all. The 15% is the pantry's answer for deli only, and the column is what
    // expresses that — a bucket-level deduction would silently take 15% of this too.
    const { deli, frzNonMeat } = await pantry();
    const { shift, stops, actor } = await run(1);

    await addWeight(actor, shift.id, stops[0]!.id, { categoryId: deli.id, weight: '100' });
    await addWeight(actor, shift.id, stops[0]!.id, { categoryId: frzNonMeat.id, weight: '200' });

    const lines = (await exportReceipts(...weekOf(WEEK))).receipts[0]!.lines;
    expect(lineFor(lines, 'Deli')!.pounds).toBe('85');
    expect(lineFor(lines, 'Frz Non Meat')!.pounds).toBe('200');
    expect(lines.find((l) => l.computed)!.pounds).toBe('15');
  });
});

// ---------------------------------------------------------------------------
// 3. The rates, and the two paths
// ---------------------------------------------------------------------------

describe('whose rate applies (D27)', () => {
  it('falls back to the pantry default when the store has no override', async () => {
    // NULL on a donor means "use the pantry default" and is deliberately not a copy of
    // it: a copied value would stop tracking a change to the default, and nobody could
    // tell an inherited rate from a deliberate one.
    const { bakery } = await pantry();
    const { shift, stops, actor, donors } = await run(1);

    const rates = await db
      .selectFrom('donor')
      .select(['trash_rate_bakery', 'trash_rate_produce', 'trash_rate_deli'])
      .where('id', '=', donors[0]!.id)
      .executeTakeFirstOrThrow();
    expect(rates).toEqual({
      trash_rate_bakery: null,
      trash_rate_produce: null,
      trash_rate_deli: null,
    });

    await addWeight(actor, shift.id, stops[0]!.id, { categoryId: bakery.id, weight: '100' });

    // app_config.trash_rate_bakery = 0.1000 (migration 0017).
    const lines = (await exportReceipts(...weekOf(WEEK))).receipts[0]!.lines;
    expect(lineFor(lines, 'Bakery')!.pounds).toBe('90');
    expect(lines.find((l) => l.computed)!.pounds).toBe('10');
  });

  it('lets one store override without touching any other', async () => {
    const { bakery } = await pantry();
    const { shift, stops, actor, donors } = await run(2);

    await db
      .updateTable('donor')
      .set({ trash_rate_bakery: '0.2000' })
      .where('id', '=', donors[0]!.id)
      .execute();

    await addWeight(actor, shift.id, stops[0]!.id, { categoryId: bakery.id, weight: '100' });
    await addWeight(actor, shift.id, stops[1]!.id, { categoryId: bakery.id, weight: '100' });

    const { receipts } = await exportReceipts(...weekOf(WEEK));
    const overridden = receipts.find((r) => r.donorName === donors[0]!.name)!;
    const defaulted = receipts.find((r) => r.donorName === donors[1]!.name)!;

    expect(lineFor(overridden.lines, 'Bakery')!.pounds).toBe('80');
    expect(lineFor(defaulted.lines, 'Bakery')!.pounds).toBe('90');
  });

  it('deducts NOTHING at a rate of zero, and emits no Trash line at all', async () => {
    // A store the pantry has decided wastes nothing. Zero must mean zero rather than
    // "unset" — which is what the nullable column buys, and what a `0 || default`
    // written anywhere in the chain would quietly undo.
    const { bakery } = await pantry();
    const { shift, stops, actor, donors } = await run(1);

    await db
      .updateTable('donor')
      .set({ trash_rate_bakery: '0.0000' })
      .where('id', '=', donors[0]!.id)
      .execute();

    await addWeight(actor, shift.id, stops[0]!.id, { categoryId: bakery.id, weight: '500' });

    const receipt = (await exportReceipts(...weekOf(WEEK))).receipts[0]!;
    expect(lineFor(receipt.lines, 'Bakery')!.pounds).toBe('500');
    expect(receipt.lines.some((l) => l.computed)).toBe(false);
    expect(receipt.itemCount).toBe(1);
    expect(receipt.totalPounds).toBe('500');

    // And no Trash line on the screen either — an empty one would read as a real zero.
    const report = await weeklyReport(...weekOf(WEEK));
    expect(report.lines.some((l) => l.computed === true)).toBe(false);
  });

  it('deducts a walk-in under the same rule as a scheduled pickup', async () => {
    // Otherwise the report could be changed by HOW food arrived, which is exactly what
    // §6's union exists to prevent one level down.
    const { bakery } = await pantry();
    const { actor } = await run(1);
    const donation = await createDonation(actor, {
      // A reportable donation must name its source (I16b), and a free-text label has no
      // donor row — so it takes the pantry default, which is the whole point.
      donorLabel: 'Corner Bakery',
      categoryId: bakery.id,
      weight: '100',
    });
    await db
      .updateTable('unscheduled_donation')
      .set({ received_date: '2026-08-04' })
      .where('id', '=', donation.id)
      .execute();

    const receipt = (await exportReceipts(...weekOf(WEEK))).receipts.find(
      (r) => r.donorName === 'Corner Bakery',
    )!;
    expect(lineFor(receipt.lines, 'Bakery')!.pounds).toBe('90');
    expect(receipt.lines.find((l) => l.computed)!.pounds).toBe('10');
  });
});

describe('the screen and the printed receipt cannot disagree', () => {
  it('rolls the same week up to the same numbers on both paths', async () => {
    // The two used to be independent re-sums of the union, and a deduction applied to
    // one of them would have been invisible until someone compared a printout with the
    // screen it came from.
    const { bakery, produce, deli, frzNonMeat } = await pantry();
    const { shift, stops, actor, donors } = await run(2);

    await db
      .updateTable('donor')
      .set({ trash_rate_produce: '0.1000' })
      .where('id', '=', donors[0]!.id)
      .execute();

    await addWeight(actor, shift.id, stops[0]!.id, { categoryId: bakery.id, weight: '827' });
    await addWeight(actor, shift.id, stops[0]!.id, { categoryId: produce.id, weight: '3691' });
    await addWeight(actor, shift.id, stops[1]!.id, { categoryId: deli.id, weight: '53.4' });
    await addWeight(actor, shift.id, stops[1]!.id, { categoryId: frzNonMeat.id, weight: '120.6' });

    const report = await weeklyReport(...weekOf(WEEK));
    const { receipts } = await exportReceipts(...weekOf(WEEK));

    // Every pound on the receipts, summed, is the week's reported total.
    const fromReceipts = receipts.reduce((acc, r) => acc + Number(r.totalPounds), 0);
    expect(report.reportedTotal).toBe(`${fromReceipts}.00`);

    // And line for line: each NTFB line on the screen is the sum of the matching
    // receipt lines. Both are keyed on (category, storage), which is Meal Connect's
    // own line item.
    for (const line of report.lines) {
      const matching = receipts
        .flatMap((r) => r.lines)
        .filter((l) => l.ntfbCategory === line.ntfbCategoryName && l.storage === (line.storage ?? ''))
        .reduce((acc, l) => acc + Number(l.pounds), 0);
      expect(`${matching}.00`, line.ntfbCategoryName).toBe(line.total);
    }

    // Including the computed one, which exists on both.
    expect(report.lines.find((l) => l.computed)!.total).toBe(
      `${receipts.flatMap((r) => r.lines).filter((l) => l.computed).reduce((a, l) => a + Number(l.pounds), 0)}.00`,
    );
  });
});

// ---------------------------------------------------------------------------
// 4. The pickups that produced nothing (D29)
// ---------------------------------------------------------------------------

describe('a pickup that produced nothing still reaches the food bank (D29)', () => {
  it('emits a not-attempted receipt for a SKIPPED stop, with the reason in Notes', async () => {
    // Before this, a skipped stop produced NO row at all — the pickup was invisible to
    // NTFB, which is the lost-sheet failure one level up from an unmapped category.
    const { bakery } = await pantry();
    const { shift, stops, actor, donors, ownerId } = await run(2);

    await db
      .updateTable('shift')
      .set({ staff_note: 'Ask for the back dock after 9.', note: 'Long day, heavy traffic.' })
      .where('id', '=', shift.id)
      .execute();
    await db
      .updateTable('shift_stop')
      .set({ disposition: 'SKIPPED', note: "Store wasn't open at the scheduled time." })
      .where('id', '=', stops[1]!.id)
      .execute();

    await addWeight(actor, shift.id, stops[0]!.id, { categoryId: bakery.id, weight: '100' });

    const { receipts } = await exportReceipts(...weekOf(WEEK));
    expect(receipts).toHaveLength(2);

    const skipped = receipts.find((r) => r.donorName === donors[1]!.name)!;
    expect(skipped.notAttempted).toBe(true);
    expect(skipped.noPounds).toBe(false);
    expect(skipped.lines).toEqual([]);
    expect(skipped.itemCount).toBe(0);
    expect(skipped.totalPounds).toBe('0');

    // THE FIELD THAT CARRIES THE REASON. Labelled by channel so the reporter can judge
    // what belongs on the submission; nothing here is sent automatically.
    const owner = await db
      .selectFrom('app_user')
      .select(['first_name', 'last_name'])
      .where('id', '=', ownerId)
      .executeTakeFirstOrThrow();
    const driverName = `${owner.first_name} ${owner.last_name}`;

    expect(skipped.notes).toEqual([
      { role: 'COORDINATOR', author: null, text: 'Ask for the back dock after 9.' },
      { role: 'DRIVER', author: driverName, text: 'Long day, heavy traffic.' },
      { role: 'STOP', author: driverName, text: "Store wasn't open at the scheduled time." },
    ]);

    // The stop that DID produce food is an ordinary receipt, and carries the run's
    // notes too — they are the run's, not the stop's.
    const collected = receipts.find((r) => r.donorName === donors[0]!.name)!;
    expect(collected.notAttempted).toBe(false);
    expect(collected.totalPounds).toBe('100');
    expect(collected.notes.map((n) => n.role)).toEqual(['COORDINATOR', 'DRIVER']);
  });

  it('emits a not-attempted receipt for a run nobody ever worked', async () => {
    // A MISSED run has no ShiftStop rows at all — the snapshot is taken at
    // CLAIMED → IN_PROGRESS and that never happened — so its stores come from the
    // Route. Without that branch the entire run is absent from the week.
    await pantry();
    const { route, donors } = await makeRoute(1, 'Tuesday Morning');
    const shift = await makeShift({
      routeId: route.id,
      status: 'OPEN',
      startsAt: new Date('2026-07-28T14:00:00Z'),
    });
    await db
      .updateTable('shift')
      .set({ staff_note: 'New store, ring the bell at the loading bay.' })
      .where('id', '=', shift.id)
      .execute();

    const { receipts } = await exportReceipts(...weekOf('2026-07-28'));
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      pickupDate: '2026-07-28',
      donorName: donors[0]!.name,
      notAttempted: true,
      noPounds: false,
      itemCount: 0,
      totalPounds: '0',
    });
    expect(receipts[0]!.notes).toEqual([
      { role: 'COORDINATOR', author: null, text: 'New store, ring the bell at the loading bay.' },
    ]);
  });

  it('emits a No Pounds receipt when the pickup happened and came to nothing', async () => {
    // Distinct from not-attempted, and the portal distinguishes them: somebody drove
    // there, weighed what was waiting, and it was zero.
    const { bakery } = await pantry();
    const { shift, stops, actor, donors } = await run(2);

    await addWeight(actor, shift.id, stops[0]!.id, { categoryId: bakery.id, weight: '100' });
    await addWeight(actor, shift.id, stops[1]!.id, { categoryId: bakery.id, weight: '0' });

    const { receipts } = await exportReceipts(...weekOf(WEEK));
    const empty = receipts.find((r) => r.donorName === donors[1]!.name)!;

    expect(empty.noPounds).toBe(true);
    expect(empty.notAttempted).toBe(false);
    expect(empty.lines).toEqual([]);
    expect(empty.totalPounds).toBe('0');
  });

  it('says nothing about a store that was neither scheduled nor weighed', async () => {
    // The other half of the rule. A card here would put a store on the submission that
    // was never on the route that day.
    const { bakery } = await pantry();
    const { shift, stops, actor } = await run(1);
    await makeRoute(1, 'Some Other Route'); // its donor exists and is due nothing

    await addWeight(actor, shift.id, stops[0]!.id, { categoryId: bakery.id, weight: '100' });

    const { receipts } = await exportReceipts(...weekOf(WEEK));
    expect(receipts).toHaveLength(1);
  });

  it('sorts the receipts the way they are typed: date, then store', async () => {
    const { bakery } = await pantry();
    const { shift, stops, actor, donors } = await run(2);
    await addWeight(actor, shift.id, stops[0]!.id, { categoryId: bakery.id, weight: '10' });
    await addWeight(actor, shift.id, stops[1]!.id, { categoryId: bakery.id, weight: '20' });

    const { receipts } = await exportReceipts(...weekOf(WEEK));
    expect(receipts.map((r) => r.donorName)).toEqual(
      donors.map((d) => d.name).sort((a, b) => a.localeCompare(b)),
    );
  });
});
