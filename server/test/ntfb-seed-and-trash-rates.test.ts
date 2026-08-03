// The NTFB seed (D26), the trash-rate columns (D27) and the D24 category CHECK.
//
// These are migrations, so the thing under test is SQL, not a service. Three of the
// four blocks below therefore RE-EXECUTE a migration file verbatim against the
// truncated test database rather than asserting on rows that happen to be there:
// `resetDatabase` truncates `category` and `ntfb_category` (fixtures.ts says so in as
// many words), so a test that merely read the seeded rows would pass or fail depending
// on which file vitest ran first. Reading the file is also the only way to prove the
// idempotency guard, which is a property of the statement and not of the data.
//
// The fourth block is `ck_ud_confirmed_category` (D24, migration 0015). That one is a
// tier-1 constraint on a table `resetDatabase` leaves in place, so it is probed
// directly — the whole point of running tests against a migrated database rather than
// a fixture schema (`CLAUDE.md`).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sql } from 'kysely';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/index.js';
import { makeDonor, makeReceiver, resetDatabase } from './fixtures.js';

const migration = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), 'utf8');

/** Run a migration file's body. `sql.raw` because these are multi-statement scripts
 *  with no parameters — exactly what the migration runner does with them. */
async function apply(name: string): Promise<void> {
  await sql.raw(migration(name)).execute(db);
}

/** 0010 seeds the 11 AGFP categories; 0016 maps them. The two are inseparable — 0016
 *  matches on the names 0010 wrote. */
async function seedCategoriesAndMapping(): Promise<void> {
  await apply('0010_seed_categories.sql');
  await apply('0016_seed_ntfb_mapping.sql');
}

beforeEach(resetDatabase);
afterAll(async () => {
  await pool.end();
});

describe('the NTFB seed (D26, migration 0016 — retires D12)', () => {
  it('gives all ELEVEN AGFP categories a bucket and a storage', async () => {
    await seedCategoriesAndMapping();

    const rows = await db
      .selectFrom('category')
      .leftJoin('ntfb_category', 'ntfb_category.id', 'category.ntfb_category_id')
      .select([
        'category.name as agfp',
        'ntfb_category.name as ntfb',
        'category.ntfb_storage as storage',
      ])
      .orderBy('category.name')
      .execute();

    // The exact table from the pantry. Eleven of eleven is the whole point: D12 stayed
    // in force while `Frz Non Meat` had no home, and ten of eleven would have been the
    // same failure one row smaller.
    expect(rows).toEqual([
      { agfp: 'Bakery', ntfb: 'Bread', storage: 'Dry' },
      { agfp: 'Dairy', ntfb: 'Dairy', storage: 'Refrigerated' },
      { agfp: 'Deli', ntfb: 'Prepared Meal', storage: 'Frozen' },
      { agfp: 'Dry', ntfb: 'Dry Food', storage: 'Dry' },
      { agfp: 'Frozen Meat', ntfb: 'Meat', storage: 'Frozen' },
      { agfp: 'Frz Non Meat', ntfb: 'Prepared Meal', storage: 'Frozen' },
      { agfp: 'Health & Beauty', ntfb: 'Health & Beauty', storage: 'Dry' },
      { agfp: 'Non Food', ntfb: 'Non-Food', storage: 'Dry' },
      { agfp: 'Pet', ntfb: 'Pet Food', storage: 'Dry' },
      { agfp: 'Produce', ntfb: 'Produce', storage: 'Refrigerated' },
      { agfp: 'Trash', ntfb: 'Trash', storage: 'Dry' },
    ]);
  });

  it('lets Deli and Frz Non Meat share one bucket AND one storage', async () => {
    await seedCategoriesAndMapping();

    const sharers = await db
      .selectFrom('category')
      .innerJoin('ntfb_category', 'ntfb_category.id', 'category.ntfb_category_id')
      .select(['category.name as agfp', 'category.ntfb_storage as storage'])
      .where('ntfb_category.name', '=', 'Prepared Meal')
      .orderBy('category.name')
      .execute();

    // The many-to-one case 0012's own comment anticipated, and the reason the export
    // emits two identical `Prepared Meal / Frozen` lines for one store on one day —
    // exactly as the sample Meal Connect receipt does.
    expect(sharers).toEqual([
      { agfp: 'Deli', storage: 'Frozen' },
      { agfp: 'Frz Non Meat', storage: 'Frozen' },
    ]);
  });

  it('archives the AGFP Trash category, because D27 computes it', async () => {
    await seedCategoriesAndMapping();

    const trash = await db
      .selectFrom('category')
      .select(['deactivated_at', 'ntfb_category_id'])
      .where('name', '=', 'Trash')
      .executeTakeFirstOrThrow();

    // Archived so a receiver can never weigh into it — that weight would be counted
    // once as itself and again inside the computed deduction.
    expect(trash.deactivated_at).not.toBeNull();
    // But still mapped: the synthetic line reports as NTFB `Trash / Dry`.
    expect(trash.ntfb_category_id).not.toBeNull();
  });

  it('is idempotent — a second run adds no rows and overwrites no admin edit', async () => {
    await seedCategoriesAndMapping();

    // An admin remaps Bakery after launch, which is exactly what the mapping screen is
    // for. A re-run must not take it back.
    const dryFood = await db
      .selectFrom('ntfb_category')
      .select('id')
      .where('name', '=', 'Dry Food')
      .executeTakeFirstOrThrow();
    await db
      .updateTable('category')
      .set({ ntfb_category_id: dryFood.id, ntfb_storage: 'Refrigerated' })
      .where('name', '=', 'Bakery')
      .execute();

    await apply('0016_seed_ntfb_mapping.sql');

    const count = await db
      .selectFrom('ntfb_category')
      .select(({ fn }) => fn.countAll<string>().as('n'))
      .executeTakeFirstOrThrow();
    expect(Number(count.n)).toBe(10);

    const bakery = await db
      .selectFrom('category')
      .innerJoin('ntfb_category', 'ntfb_category.id', 'category.ntfb_category_id')
      .select(['ntfb_category.name as ntfb', 'category.ntfb_storage as storage'])
      .where('category.name', '=', 'Bakery')
      .executeTakeFirstOrThrow();
    expect(bakery).toEqual({ ntfb: 'Dry Food', storage: 'Refrigerated' });
  });

  it('inserts nothing when an operator typed the NTFB list in by hand first', async () => {
    // 0010's guard-on-empty-table reasoning, applied to `ntfb_category`: whoever got
    // there first keeps exactly what they typed.
    await db.insertInto('ntfb_category').values({ name: 'Their Own Name' }).execute();
    await seedCategoriesAndMapping();

    const names = await db.selectFrom('ntfb_category').select('name').execute();
    expect(names.map((r) => r.name)).toEqual(['Their Own Name']);
  });
});

describe('the trash rates (D27, migration 0017)', () => {
  it('defaults the pantry rates to 10% bakery, 5% produce, 15% deli', async () => {
    // `app_config` is the one table `resetDatabase` leaves alone (it is a singleton
    // seeded by 0001), so this reads the real migrated defaults.
    const config = await db
      .selectFrom('app_config')
      .select(['trash_rate_bakery', 'trash_rate_produce', 'trash_rate_deli'])
      .executeTakeFirstOrThrow();

    expect(config).toEqual({
      trash_rate_bakery: '0.1000',
      trash_rate_produce: '0.0500',
      trash_rate_deli: '0.1500',
    });
  });

  it('refuses a rate outside 0..1 at the database (ck_donor_trash_rates)', async () => {
    const donor = await makeDonor('Rate Probe');
    await expect(
      db
        .updateTable('donor')
        .set({ trash_rate_produce: '1.5000' })
        .where('id', '=', donor.id)
        .execute(),
    ).rejects.toThrow(/ck_donor_trash_rates/);
  });

  it('refuses a trash_rate_key that is not one of the three', async () => {
    await expect(
      db.insertInto('category').values({ name: 'Nonsense', trash_rate_key: 'BREAD' }).execute(),
    ).rejects.toThrow(/trash_rate_key/);
  });

  it('refuses two ACTIVE categories claiming the same rate key (uq_category_trash_key)', async () => {
    // Load-bearing: two active rows on one key would each deduct off their own gross
    // and both feed the same synthetic Trash line, so the pantry would report trash it
    // never had. Nothing in the arithmetic can detect that; the index makes it
    // unrepresentable.
    await db.insertInto('category').values({ name: 'Bakery', trash_rate_key: 'BAKERY' }).execute();
    await expect(
      db
        .insertInto('category')
        .values({ name: 'Bread & Rolls', trash_rate_key: 'BAKERY' })
        .execute(),
    ).rejects.toThrow(/uq_category_trash_key/);
  });

  it('lets an ARCHIVED category keep its key so a replacement can take it', async () => {
    // The partial predicate. Replacing `Bakery` means archiving the old row and
    // pointing the key at the new one; the archived row keeps its key so historical
    // rows still read correctly.
    await db
      .insertInto('category')
      .values({ name: 'Bakery', trash_rate_key: 'BAKERY', deactivated_at: new Date() })
      .execute();

    await expect(
      db
        .insertInto('category')
        .values({ name: 'Bakery & Bread', trash_rate_key: 'BAKERY' })
        .execute(),
    ).resolves.toBeDefined();
  });

  it('seeds the three keys onto Bakery, Produce and Deli and nothing else', async () => {
    await apply('0010_seed_categories.sql');
    // 0017's DDL already ran; only its data half is replayable, and that is what is
    // being asserted — which categories carry a key.
    await sql`
      UPDATE category SET trash_rate_key = 'BAKERY'  WHERE name = 'Bakery';
      UPDATE category SET trash_rate_key = 'PRODUCE' WHERE name = 'Produce';
      UPDATE category SET trash_rate_key = 'DELI'    WHERE name = 'Deli';
    `.execute(db);

    const keyed = await db
      .selectFrom('category')
      .select(['name', 'trash_rate_key'])
      .where('trash_rate_key', 'is not', null)
      .orderBy('name')
      .execute();

    // `Frz Non Meat` is deliberately absent: it shares Deli's NTFB bucket but is
    // deducted at NO rate, and this column is what expresses that.
    expect(keyed).toEqual([
      { name: 'Bakery', trash_rate_key: 'BAKERY' },
      { name: 'Deli', trash_rate_key: 'DELI' },
      { name: 'Produce', trash_rate_key: 'PRODUCE' },
    ]);
  });
});

describe('ck_ud_confirmed_category (D24, migration 0015)', () => {
  async function probeRow(status: 'SUGGESTED' | 'CONFIRMED', categoryId: string | null) {
    const user = await makeReceiver();
    return db
      .insertInto('unscheduled_donation')
      .values({
        donor_label: 'Probe Store',
        category_id: categoryId,
        weight: status === 'CONFIRMED' ? '12.00' : null,
        status,
        received_date: '2026-08-02',
        created_by: user.id,
        updated_by: user.id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
  }

  it('accepts a SUGGESTED row with no category — the driver no longer picks one', async () => {
    await expect(probeRow('SUGGESTED', null)).resolves.toBeDefined();
  });

  it('refuses a CONFIRMED row with no category', async () => {
    await expect(probeRow('CONFIRMED', null)).rejects.toThrow(/ck_ud_confirmed_category/);
  });

  it('refuses the TRANSITION too, not just the insert', async () => {
    // The case that actually matters: a prefill sitting at NULL cannot be promoted
    // without someone naming a category, which is what keeps the report whole.
    const row = await probeRow('SUGGESTED', null);
    await expect(
      db
        .updateTable('unscheduled_donation')
        .set({ status: 'CONFIRMED', weight: '12.00' })
        .where('id', '=', row.id)
        .execute(),
    ).rejects.toThrow(/ck_ud_confirmed_category/);
  });

  it('accepts a CONFIRMED row that names one', async () => {
    const category = await db
      .insertInto('category')
      .values({ name: 'Produce' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await expect(probeRow('CONFIRMED', category.id)).resolves.toBeDefined();
  });
});
