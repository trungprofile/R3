// D72 — pointing a label-only walk-in at a real store.
//
// THE HOLE THIS FILLS. An `UnscheduledDonation` sources from `donor_id` OR
// `donor_label`, and `I16(b)` accepts either — so a walk-in a receiver typed as
// "Sunrise Bagels" is legitimately `reportable = true`, and its pounds are in the
// reported total and in Admin metrics. But a Meal Connect receipt keys on
// `(pickup date, donor_id)` and the check-off table requires a real store, so that
// receipt exists, carries weight, and can never be ticked as filed.
//
// `domain-modeling.md` is right that this is deliberate at the moment the row is
// written: NTFB's own donor picker cannot be pointed at a store that is not theirs
// either. What was NOT deliberate is that nothing re-pointed the row once the store
// WAS added to our list, so those pounds sat outside NTFB permanently.
//
// FOUR THINGS ARE ASSERTED, in the order they can go wrong:
//
//   1. THE HAPPY PATH ACTUALLY MERGES. Not "the column was written" — that is a
//      unit test of an UPDATE. The receipt the reporter was looking at has to
//      disappear into the store's own `(date, donor)` card and become tickable,
//      because that is the whole point and `exportReceipts` is what decides it.
//   2. I29, THE ON-ROUTE DONOR GUARD. If the donation has a shift, the chosen store
//      must not already be a stop on it. This action is exactly the case that can
//      create the violation, and no CHECK can express it (it is cross-table).
//   3. THE ANONYMOUS REFUSAL. No donor and no label means nobody wrote down where
//      the food came from, and picking a store here would be the app inventing
//      provenance rather than recording it.
//   4. CONSERVATION ACROSS THE ATTACH (D27). Trash rates are per donor, so
//      attaching one changes the deduction. Weight MOVES BETWEEN CATEGORIES and the
//      reported total does not change. `report-trash.test.ts` asserts the property
//      in general; this asserts it survives the one operation that re-points a
//      receipt at a different set of rates.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DONATION_ON_ROUTE_MESSAGE } from '../../shared/src/donation.js';
import {
  ATTACH_ALREADY_MESSAGE,
  ATTACH_ANONYMOUS_MESSAGE,
  ATTACH_LABEL_NOTE_PREFIX,
} from '../../shared/src/report.js';
import { db, pool } from '../src/db/index.js';
import {
  attachDonorToDonations,
  createNtfbCategory,
  exportReceipts,
  markReceiptSubmitted,
  setMapping,
  weekBounds,
  weeklyReport,
} from '../src/services/report.js';
import { addWeight } from '../src/services/receive.js';
import { createDonation } from '../src/services/donation.js';
import {
  makeCategory,
  makeDonor,
  makeReceiver,
  makeStartedShift,
  resetDatabase,
} from './fixtures.js';

/** The fixture shift sits on 2026-08-04, a Tuesday; its week is Mon 3rd–Sun 9th. */
const DAY = '2026-08-04';

function week(): [string, string] {
  const { weekStart, weekEnd } = weekBounds(DAY);
  return [weekStart, weekEnd];
}

beforeEach(resetDatabase);
afterAll(async () => {
  await pool.end();
});

/**
 * Bakery, mapped to NTFB `Bread`, plus the archived `Trash` category that gives the
 * computed line somewhere to report.
 *
 * `resetDatabase` truncates `category` and `ntfb_category`, so migration 0016's seed
 * is not there to read — the same reason `report-trash.test.ts` builds its own.
 */
async function pantry() {
  const bread = await createNtfbCategory({ name: 'Bread' });
  const trashNtfb = await createNtfbCategory({ name: 'Trash' });

  const bakery = await makeCategory('Bakery');
  await setMapping(bakery.id, bread.id, 'Dry');

  await db
    .insertInto('category')
    .values({
      name: 'Trash',
      ntfb_category_id: trashNtfb.id,
      ntfb_storage: 'Dry',
      deactivated_at: new Date(),
    })
    .execute();

  // The rate key is DATA, never a match on the literal name (migration 0017).
  await db
    .updateTable('category')
    .set({ trash_rate_key: 'BAKERY' })
    .where('id', '=', bakery.id)
    .execute();

  return { bakery };
}

/**
 * A confirmed walk-in with a typed-in store NAME and no store row — the D72 case.
 *
 * `createDonation` buckets to the pantry's today (`data-model.md §8`); the date is
 * moved afterwards so the row lands in the same week as the fixture run, which is
 * what makes the merge in test 1 observable at all.
 */
async function walkIn(
  actorId: string,
  categoryId: string,
  opts: { label?: string | null; weight: string; shiftId?: string },
) {
  const row = await createDonation(
    { id: actorId },
    {
      donorLabel: opts.label ?? null,
      categoryId,
      weight: opts.weight,
      // An anonymous row cannot be reportable (I16b), so the caller that wants one
      // asks for the switch off. Everything else defaults on, as I15 intends.
      reportable: opts.label !== null && opts.label !== undefined,
    },
  );

  await db
    .updateTable('unscheduled_donation')
    .set({
      received_date: DAY,
      ...(opts.shiftId !== undefined ? { shift_id: opts.shiftId } : {}),
    })
    .where('id', '=', row.id)
    .execute();

  return row;
}

// ---------------------------------------------------------------------------
// 1. The happy path — and what makes it a happy path is the MERGE
// ---------------------------------------------------------------------------

describe('filing a label-only walk-in under a store (D72)', () => {
  it('moves the row onto the store’s own receipt and makes it fileable', async () => {
    const { bakery } = await pantry();
    const { shift, stops, donors } = await makeStartedShift({ stopCount: 1 });
    const receiver = await makeReceiver();
    const store = donors[0]!;

    await addWeight({ id: receiver.id }, shift.id, stops[0]!.id, {
      categoryId: bakery.id,
      weight: '100',
    });
    const typed = await walkIn(receiver.id, bakery.id, { label: 'Sunrise Bagels', weight: '50' });

    // BEFORE. Two cards: the store's, and one keyed on a name nobody can file.
    const before = await exportReceipts(...week());
    expect(before.receipts).toHaveLength(2);
    const label = before.receipts.find((r) => r.donorName === 'Sunrise Bagels')!;
    expect(label.donorId).toBeNull();
    // The ids the picker acts on. Sent by the server rather than inferred from the
    // name, because the name is free text and two receivers can spell one store two
    // ways.
    expect(label.labelDonationIds).toEqual([typed.id]);
    // The store's own card carries none — there is nothing on it to re-point.
    expect(before.receipts.find((r) => r.donorId === store.id)!.labelDonationIds).toEqual([]);

    await attachDonorToDonations({ id: receiver.id }, label.labelDonationIds, store.id);

    // AFTER. One card, and it is the store's.
    const after = await exportReceipts(...week());
    expect(after.receipts).toHaveLength(1);
    const merged = after.receipts[0]!;
    expect(merged.donorId).toBe(store.id);
    expect(merged.donorName).toBe(store.name);
    expect(merged.labelDonationIds).toEqual([]);

    // Fileable, which is the thing that was impossible before. `markReceiptSubmitted`
    // is the real check-off and it needs a `donor_id`; that it does not throw IS the
    // assertion.
    await markReceiptSubmitted({ id: receiver.id }, merged.pickupDate, merged.donorId!);
    const filed = await exportReceipts(...week());
    expect(filed.receipts[0]!.submitted?.submittedBy).toContain(receiver.first_name);
  });

  it('clears donor_label, because the schema forbids both, and keeps the name in the note', async () => {
    // THE ONE PLACE THE PLAN WAS WRONG ABOUT THE CODE. "Keep `donor_label` as
    // provenance" is not available: `ck_ud_source_exclusive` (migration 0011) is
    // `donor_id IS NULL OR donor_label IS NULL`, a tier-1 CHECK, and `data-model.md
    // §7` DERIVES the source discriminator from which of the two is set. A row holding
    // both is a fourth state nothing in the codebase reads, and there is no migration
    // in this change.
    //
    // So the label is cleared and the typed name is folded into the donation's own
    // note — which `intakeNotes` already carries onto the receipt as a `DONATION`
    // note, so the reporter filing the card sees the name the receiver wrote down
    // beside the store it was filed under. A column nobody queries would have
    // preserved less.
    const { bakery } = await pantry();
    const receiver = await makeReceiver();
    const store = await makeDonor('Sunrise Bagels LLC');
    const typed = await walkIn(receiver.id, bakery.id, { label: 'sunrise bagels', weight: '20' });

    await attachDonorToDonations({ id: receiver.id }, [typed.id], store.id);

    const row = await db
      .selectFrom('unscheduled_donation')
      .select(['donor_id', 'donor_label', 'note', 'reportable'])
      .where('id', '=', typed.id)
      .executeTakeFirstOrThrow();

    expect(row.donor_id).toBe(store.id);
    expect(row.donor_label).toBeNull();
    expect(row.note).toBe(`${ATTACH_LABEL_NOTE_PREFIX} sunrise bagels.`);
    // The switch is untouched. This action changes WHERE the pounds are filed, never
    // whether they are reported.
    expect(row.reportable).toBe(true);

    // And the reporter can read it: it arrives on the receipt as a `DONATION` note.
    const sheet = await exportReceipts(...week());
    const card = sheet.receipts.find((r) => r.donorId === store.id)!;
    expect(card.notes.some((n) => n.role === 'DONATION' && n.text.includes('sunrise bagels'))).toBe(
      true,
    );
  });

  it('refuses a row that already has a store', async () => {
    const { bakery } = await pantry();
    const receiver = await makeReceiver();
    const first = await makeDonor('First Store');
    const second = await makeDonor('Second Store');
    const typed = await walkIn(receiver.id, bakery.id, { label: 'Sunrise', weight: '20' });

    await attachDonorToDonations({ id: receiver.id }, [typed.id], first.id);
    await expect(
      attachDonorToDonations({ id: receiver.id }, [typed.id], second.id),
    ).rejects.toThrow(ATTACH_ALREADY_MESSAGE);
  });

  it('refuses an archived store', async () => {
    // Donors are admin master data (I21). Filing against a store the pantry has
    // stopped collecting from would put a pickup on a submission nobody expects.
    const { bakery } = await pantry();
    const receiver = await makeReceiver();
    const store = await makeDonor('Closed Store');
    await db
      .updateTable('donor')
      .set({ deactivated_at: new Date() })
      .where('id', '=', store.id)
      .execute();
    const typed = await walkIn(receiver.id, bakery.id, { label: 'Sunrise', weight: '20' });

    await expect(
      attachDonorToDonations({ id: receiver.id }, [typed.id], store.id),
    ).rejects.toThrow(/archived/i);
  });
});

// ---------------------------------------------------------------------------
// 2. I29 — the on-route donor guard
// ---------------------------------------------------------------------------

describe('I29, and this action is exactly what can violate it', () => {
  it('refuses a store that is already a stop on the donation’s own run', async () => {
    // I29: an `UnscheduledDonation` with a non-null Shift must not reference a Donor
    // that is a `ShiftStop` of that Shift. More food from a scheduled stop is another
    // `weight_entry` — the grain already allows many per (Shift, Donor, Category) —
    // and keeping the two structurally disjoint is what lets the report trust the
    // planned/unplanned split.
    const { bakery } = await pantry();
    const { shift, donors } = await makeStartedShift({ stopCount: 1 });
    const receiver = await makeReceiver();
    const onRoute = donors[0]!;

    const typed = await walkIn(receiver.id, bakery.id, {
      label: 'Sunrise Bagels',
      weight: '20',
      shiftId: shift.id,
    });

    await expect(
      attachDonorToDonations({ id: receiver.id }, [typed.id], onRoute.id),
    ).rejects.toThrow(DONATION_ON_ROUTE_MESSAGE);

    // And it is a refusal, not a partial write.
    const row = await db
      .selectFrom('unscheduled_donation')
      .select(['donor_id', 'donor_label'])
      .where('id', '=', typed.id)
      .executeTakeFirstOrThrow();
    expect(row.donor_id).toBeNull();
    expect(row.donor_label).toBe('Sunrise Bagels');
  });

  it('allows a store that is NOT a stop on that run', async () => {
    // The guard is about the run this donation hangs off, not about being on any
    // route anywhere. A driver who picks up extra food from a store they are not
    // visiting today is exactly what an unscheduled donation is for.
    const { bakery } = await pantry();
    const { shift } = await makeStartedShift({ stopCount: 1 });
    const receiver = await makeReceiver();
    const elsewhere = await makeDonor('Not On This Run');

    const typed = await walkIn(receiver.id, bakery.id, {
      label: 'Sunrise Bagels',
      weight: '20',
      shiftId: shift.id,
    });

    await attachDonorToDonations({ id: receiver.id }, [typed.id], elsewhere.id);
    const row = await db
      .selectFrom('unscheduled_donation')
      .select('donor_id')
      .where('id', '=', typed.id)
      .executeTakeFirstOrThrow();
    expect(row.donor_id).toBe(elsewhere.id);
  });

  it('rolls the whole batch back when one row in it is refused', async () => {
    // A receipt is `(pickup date, label)` and the picker sends every donation behind
    // it. Half of them landing on a store and half staying behind would leave two
    // cards where the reporter was looking at one, so it is all of them or none —
    // which is what one SERIALIZABLE transaction buys.
    const { bakery } = await pantry();
    const { shift, donors } = await makeStartedShift({ stopCount: 1 });
    const receiver = await makeReceiver();
    const onRoute = donors[0]!;

    const clean = await walkIn(receiver.id, bakery.id, { label: 'Sunrise Bagels', weight: '20' });
    const guarded = await walkIn(receiver.id, bakery.id, {
      label: 'Sunrise Bagels',
      weight: '30',
      shiftId: shift.id,
    });

    await expect(
      attachDonorToDonations({ id: receiver.id }, [clean.id, guarded.id], onRoute.id),
    ).rejects.toThrow(DONATION_ON_ROUTE_MESSAGE);

    const rows = await db
      .selectFrom('unscheduled_donation')
      .select(['id', 'donor_id'])
      .where('id', 'in', [clean.id, guarded.id])
      .execute();
    expect(rows.every((r) => r.donor_id === null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. The anonymous refusal
// ---------------------------------------------------------------------------

describe('an anonymous walk-in', () => {
  it('cannot be filed under a store, because nobody wrote down where it came from', async () => {
    // No donor and no label. `I16(b)` already keeps it out of the report; what this
    // refusal adds is that the reporter cannot put it IN by choosing a store on its
    // behalf. Picking one here would be the app inventing provenance rather than
    // recording it, and the food bank would be told a store donated food it did not.
    const { bakery } = await pantry();
    const receiver = await makeReceiver();
    const store = await makeDonor('Sunrise Bagels');
    const anonymous = await walkIn(receiver.id, bakery.id, { label: null, weight: '20' });

    await expect(
      attachDonorToDonations({ id: receiver.id }, [anonymous.id], store.id),
    ).rejects.toThrow(ATTACH_ANONYMOUS_MESSAGE);
  });

  it('never appears as a receipt with ids on it in the first place', async () => {
    // The screen's half of the same rule. An anonymous row is outside the reported
    // union, so it forms no receipt — it reaches the reporter through `notReported`,
    // which says why on the row rather than offering a control that would be refused
    // (the courtesy D35 gives a receipt with no store).
    const { bakery } = await pantry();
    const receiver = await makeReceiver();
    await walkIn(receiver.id, bakery.id, { label: null, weight: '20' });

    const sheet = await exportReceipts(...week());
    expect(sheet.receipts).toHaveLength(0);
    expect(sheet.notReported).toHaveLength(1);
    expect(sheet.notReported[0]!.canReport).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. D27 — the deduction moves, the total does not
// ---------------------------------------------------------------------------

describe('the trash deduction across an attach (D27)', () => {
  it('moves weight between categories and leaves the reported total alone', async () => {
    // Trash rates are PER DONOR, with null meaning "use the pantry default" — which
    // is 10% for bakery, NOT zero. So attaching a store changes which rate this
    // weight is deducted at, and that is supposed to happen.
    //
    // What must not happen is the reported total moving. `net + trash == gross` holds
    // per receipt and therefore over any set of them, so merging two receipts into
    // one cannot change what the food bank is told in total — only how it is split.
    const { bakery } = await pantry();
    const { shift, stops, donors } = await makeStartedShift({ stopCount: 1 });
    const receiver = await makeReceiver();
    const store = donors[0]!;

    // 20% for this store against the pantry's 10% default, so the split HAS to move.
    await db
      .updateTable('donor')
      .set({ trash_rate_bakery: '0.2000' })
      .where('id', '=', store.id)
      .execute();

    await addWeight({ id: receiver.id }, shift.id, stops[0]!.id, {
      categoryId: bakery.id,
      weight: '100',
    });
    const typed = await walkIn(receiver.id, bakery.id, { label: 'Sunrise Bagels', weight: '50' });

    const before = await weeklyReport(...week());
    const beforeSheet = await exportReceipts(...week());
    // Store: 100 gross, 20% → 20 trash, 80 net. Label: 50 gross at the 10% default
    // → 5 trash, 45 net. 25 lb of trash in total.
    const beforeTrash = beforeSheet.receipts
      .flatMap((r) => r.lines)
      .filter((l) => l.computed)
      .reduce((acc, l) => acc + Number(l.pounds), 0);
    expect(beforeTrash).toBe(25);

    await attachDonorToDonations({ id: receiver.id }, [typed.id], store.id);

    const after = await weeklyReport(...week());
    const afterSheet = await exportReceipts(...week());
    // One receipt now: 150 gross at the store's own 20% → 30 trash, 120 net.
    const afterTrash = afterSheet.receipts
      .flatMap((r) => r.lines)
      .filter((l) => l.computed)
      .reduce((acc, l) => acc + Number(l.pounds), 0);
    expect(afterTrash).toBe(30);

    // THE PROPERTY. The split moved by five pounds; the total did not move at all.
    expect(after.reportedTotal).toBe(before.reportedTotal);
    expect(after.intakeTotal).toBe(before.intakeTotal);

    // And the receipt still closes against itself, which is the check the paper sheet
    // does: net + trash == gross.
    const merged = afterSheet.receipts[0]!;
    expect(Number(merged.totalPounds)).toBe(150);
  });
});
