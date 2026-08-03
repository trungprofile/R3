// Unplanned intake — the driver's flag and the receiver's record/confirm (cap 12).
//
//   I14  planned → WeightEntry, unplanned → UnscheduledDonation. A driver-add NEVER
//        creates a ShiftStop row.
//   I15  scheduled ⇒ reportable, one way. Only this entity carries the flag, default ON.
//   I16  (a) CONFIRMED ⇒ weight; (b) CONFIRMED ∧ reportable ⇒ a source.
//   I17  SUGGESTED comes only from a driver-add.
//   I29  a donation on a run may not name a donor that is already a stop of that run.
//
// I16's two clauses are deliberately separate and the tests keep them separate: an
// unreported walk-in needs no store name, but it still needs a weight, because
// metrics union every CONFIRMED row regardless of the flag.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/index.js';
import {
  confirmDonation,
  createDonation,
  discardSuggestion,
  flagAdHoc,
  listDonationsForShift,
  purgeExpiredSuggestions,
  setReportable,
} from '../src/services/donation.js';
import {
  makeCategory,
  makeDonor,
  makeReceiver,
  makeStartedShift,
  resetDatabase,
} from './fixtures.js';

const actor = (id: string) => ({ id });

beforeEach(resetDatabase);
afterAll(async () => {
  await pool.end();
});

async function scene() {
  const started = await makeStartedShift({ stopCount: 1 });
  const user = await makeReceiver();
  const category = await makeCategory('Produce');
  const offRoute = await makeDonor('Corner Market');
  return { ...started, receiver: actor(user.id), driver: actor(started.ownerId), category, offRoute };
}

describe('the driver flag (S1.5, I14/I17)', () => {
  it('creates a SUGGESTED row with no weight', async () => {
    const { shift, driver, category, offRoute } = await scene();

    const donation = await flagAdHoc(driver, shift.id, {
      donorId: offRoute.id,
      note: 'two crates by the door',
    });

    expect(donation.status).toBe('SUGGESTED');
    expect(donation.weight).toBeNull();
    expect(donation.source).toBe('MASTER');
    expect(donation.donorDisplay).toBe('Corner Market');
    expect(donation.note).toBe('two crates by the door');
  });

  it('never writes a ShiftStop — the planned route stays pristine (I14)', async () => {
    const { shift, driver, category, offRoute, stops } = await scene();
    await flagAdHoc(driver, shift.id, { donorId: offRoute.id });

    const after = await db
      .selectFrom('shift_stop')
      .selectAll()
      .where('shift_id', '=', shift.id)
      .execute();

    expect(after).toHaveLength(stops.length);
    expect(after.map((s) => s.donor_id)).not.toContain(offRoute.id);
  });

  it('buckets to the run own day, not to the moment it was flagged (§8)', async () => {
    const { shift, driver, category, offRoute } = await scene();
    const donation = await flagAdHoc(driver, shift.id, {
      donorId: offRoute.id,
    });
    expect(donation.receivedDate).toBe('2026-08-04');
  });

  it('refuses a donor that is already a stop on this run (I29)', async () => {
    const { shift, driver, category, donors } = await scene();

    await expect(
      flagAdHoc(driver, shift.id, { donorId: donors[0]!.id }),
    ).rejects.toThrow(/already a stop/i);
  });

  it('accepts a free-text label for a store that is not master data', async () => {
    const { shift, driver, category } = await scene();
    const donation = await flagAdHoc(driver, shift.id, {
      donorLabel: "Ruby's Bakery",
    });

    expect(donation.source).toBe('LABEL');
    expect(donation.donorId).toBeNull();
    expect(donation.donorDisplay).toBe("Ruby's Bakery");

    // Free text never auto-creates a master Donor (§2.3).
    const donors = await db.selectFrom('donor').select('name').execute();
    expect(donors.map((d) => d.name)).not.toContain("Ruby's Bakery");
  });

  it('refuses both a donor id and a label at once (ck_ud_source_exclusive)', async () => {
    const { shift, driver, category, offRoute } = await scene();
    await expect(
      flagAdHoc(driver, shift.id, {
        donorId: offRoute.id,
        donorLabel: 'Also this',
      }),
    ).rejects.toThrow(/not both/i);
  });

  it('is the driver own run only', async () => {
    const { shift, receiver, category, offRoute } = await scene();
    await expect(
      flagAdHoc(receiver, shift.id, { donorId: offRoute.id }),
    ).rejects.toThrow(/not yours/i);
  });
});

describe('the receiver record (S2.3, I15/I16)', () => {
  it('is born CONFIRMED and reportable by default (I15)', async () => {
    const { receiver, category, offRoute } = await scene();

    const donation = await createDonation(receiver, {
      donorId: offRoute.id,
      categoryId: category.id,
      weight: '87.5',
    });

    expect(donation.status).toBe('CONFIRMED');
    expect(donation.reportable).toBe(true);
    expect(donation.weight).toBe('87.50');
    expect(donation.shiftId).toBeNull(); // off-plan by definition
  });

  it('requires a source when reportable (I16b)', async () => {
    const { receiver, category } = await scene();
    await expect(
      createDonation(receiver, { categoryId: category.id, weight: '10', reportable: true }),
    ).rejects.toThrow(/needs a store name/i);
  });

  it('allows an anonymous walk-in when NOT reportable (I16b)', async () => {
    const { receiver, category } = await scene();
    const donation = await createDonation(receiver, {
      categoryId: category.id,
      weight: '10',
      reportable: false,
    });

    expect(donation.source).toBe('ANON');
    // The visible consequence of allowing a null source (§8).
    expect(donation.donorDisplay).toBe('Unattributed');
  });

  it('still requires a weight on an unreported row (I16a — metrics count it)', async () => {
    const { receiver, category } = await scene();
    await expect(
      // @ts-expect-error — the weight is what this test is about
      createDonation(receiver, { categoryId: category.id, reportable: false }),
    ).rejects.toThrow();
  });

  it('treats a blank label as no source, not as an empty store name', async () => {
    const { receiver, category } = await scene();
    await expect(
      createDonation(receiver, { donorLabel: '   ', categoryId: category.id, weight: '10' }),
    ).rejects.toThrow(/needs a store name/i);
  });
});

describe('confirming a prefill (SUGGESTED → CONFIRMED)', () => {
  it('adds the weight the driver could not', async () => {
    const { shift, driver, receiver, category, offRoute } = await scene();
    const flagged = await flagAdHoc(driver, shift.id, {
      donorId: offRoute.id,
    });

    const confirmed = await confirmDonation(receiver, flagged.id, {
      weight: '120',
      categoryId: category.id,
    });

    expect(confirmed.status).toBe('CONFIRMED');
    expect(confirmed.weight).toBe('120.00');
    expect(confirmed.shiftId).toBe(shift.id); // provenance survives the confirm
  });

  it('lets the receiver correct the donor the driver guessed at', async () => {
    const { shift, driver, receiver, category } = await scene();
    const flagged = await flagAdHoc(driver, shift.id, {
      donorLabel: 'the place on 5th',
    });
    const real = await makeDonor('Fifth Street Grocery');

    const confirmed = await confirmDonation(receiver, flagged.id, {
      weight: '30',
      categoryId: category.id,
      donorId: real.id,
      donorLabel: null,
    });

    expect(confirmed.source).toBe('MASTER');
    expect(confirmed.donorDisplay).toBe('Fifth Street Grocery');
  });

  it('re-checks I29 when the receiver re-points it at an on-route donor', async () => {
    const { shift, driver, receiver, category, donors } = await scene();
    const flagged = await flagAdHoc(driver, shift.id, {
      donorLabel: 'unknown',
    });

    await expect(
      confirmDonation(receiver, flagged.id, {
        weight: '30',
        categoryId: category.id,
        donorId: donors[0]!.id,
        donorLabel: null,
      }),
    ).rejects.toThrow(/already a stop/i);
  });

  it('refuses a second confirm — the first receiver weight stands', async () => {
    const { shift, driver, receiver, category, offRoute } = await scene();
    const flagged = await flagAdHoc(driver, shift.id, {
      donorId: offRoute.id,
    });

    await confirmDonation(receiver, flagged.id, { weight: '10', categoryId: category.id });
    await expect(
      confirmDonation(receiver, flagged.id, { weight: '99', categoryId: category.id }),
    ).rejects.toThrow(/already recorded/i);
  });
});

describe('the report toggle (cap 15 — a plain field edit)', () => {
  it('flips last-write-wins and stamps who', async () => {
    const { receiver, category, offRoute } = await scene();
    const donation = await createDonation(receiver, {
      donorId: offRoute.id,
      categoryId: category.id,
      weight: '10',
    });

    const off = await setReportable(receiver, donation.id, false);
    expect(off.reportable).toBe(false);

    const row = await db
      .selectFrom('unscheduled_donation')
      .select('updated_by')
      .where('id', '=', donation.id)
      .executeTakeFirstOrThrow();
    expect(row.updated_by).toBe(receiver.id);
  });

  it('does not void and reinsert — the row id is unchanged', async () => {
    const { receiver, category, offRoute } = await scene();
    const donation = await createDonation(receiver, {
      donorId: offRoute.id,
      categoryId: category.id,
      weight: '10',
    });

    const off = await setReportable(receiver, donation.id, false);
    expect(off.id).toBe(donation.id);

    const rows = await db.selectFrom('unscheduled_donation').selectAll().execute();
    expect(rows).toHaveLength(1);
  });

  it('refuses to turn reporting ON for an anonymous row (I16b)', async () => {
    const { receiver, category } = await scene();
    const donation = await createDonation(receiver, {
      categoryId: category.id,
      weight: '10',
      reportable: false,
    });

    await expect(setReportable(receiver, donation.id, true)).rejects.toThrow(
      /needs a store name/i,
    );
  });
});

describe('the SUGGESTED lifecycle (I17)', () => {
  it('discards a prefill the receiver decided was not real', async () => {
    const { shift, driver, receiver, category, offRoute } = await scene();
    const flagged = await flagAdHoc(driver, shift.id, {
      donorId: offRoute.id,
    });

    await discardSuggestion(receiver, flagged.id);
    expect(await listDonationsForShift(shift.id)).toHaveLength(0);
  });

  it('refuses to discard a CONFIRMED row — that is intake', async () => {
    const { receiver, category, offRoute } = await scene();
    const donation = await createDonation(receiver, {
      donorId: offRoute.id,
      categoryId: category.id,
      weight: '10',
    });

    await expect(discardSuggestion(receiver, donation.id)).rejects.toThrow(/cannot be removed/i);
  });

  it('sweeps prefills whose shift window has expired, and only those', async () => {
    const { shift, driver, category, offRoute } = await scene();
    await flagAdHoc(driver, shift.id, { donorId: offRoute.id });

    // Not yet due: the default window is 7 days from the shift start.
    expect(await purgeExpiredSuggestions()).toBe(0);

    await db
      .updateTable('shift')
      .set({ starts_at: new Date(Date.now() - 30 * 24 * 3600 * 1000) })
      .where('id', '=', shift.id)
      .execute();

    expect(await purgeExpiredSuggestions()).toBe(1);
    expect(await listDonationsForShift(shift.id)).toHaveLength(0);
  });

  it('never sweeps a CONFIRMED row however old', async () => {
    const { shift, driver, receiver, category, offRoute } = await scene();
    const flagged = await flagAdHoc(driver, shift.id, {
      donorId: offRoute.id,
    });
    await confirmDonation(receiver, flagged.id, { weight: '10', categoryId: category.id });

    await db
      .updateTable('shift')
      .set({ starts_at: new Date(Date.now() - 365 * 24 * 3600 * 1000) })
      .where('id', '=', shift.id)
      .execute();

    expect(await purgeExpiredSuggestions()).toBe(0);
  });
});

describe('the receiver edit window (§3.1)', () => {
  it('refuses a confirm once the window has closed', async () => {
    const { shift, driver, receiver, category, offRoute } = await scene();
    const flagged = await flagAdHoc(driver, shift.id, {
      donorId: offRoute.id,
    });

    await db
      .updateTable('shift')
      .set({ starts_at: new Date(Date.now() - 30 * 24 * 3600 * 1000) })
      .where('id', '=', shift.id)
      .execute();

    await expect(confirmDonation(receiver, flagged.id, { weight: '10' })).rejects.toThrow(
      /time to change this run has passed/i,
    );
  });
});
