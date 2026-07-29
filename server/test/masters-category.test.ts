// Category master data (cap 17, shipped in Phase 1 by build-plan D2).
//
// Nothing consumes a category until Phase 2, so these tests are about the admin
// shell alone: the list, the rename, cap 17's archive, and I21's removal branch —
// which in Phase 1 has no referencing table to find, deliberately (D3).

import { sql } from 'kysely';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/index.js';
import {
  createCategory,
  getCategory,
  listCategories,
  removeCategory,
  updateCategory,
} from '../src/services/category.js';
import { resetDatabase } from './fixtures.js';

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await db.destroy();
  await pool.end().catch(() => undefined);
});

/** The launch set (`ui-ux-spec.md S2.2`) — 11 rows, seeded as data rather than
 *  declared as an enum, which is the whole point of cap 17. */
const AGFP_CATEGORIES = [
  'Frozen Meat',
  'Bakery',
  'Produce',
  'Deli',
  'Dairy',
  'Dry',
  'Frz Non Meat',
  'Non Food',
  'Pet',
  'Health & Beauty',
  'Trash',
];

describe('create + rename (cap 17)', () => {
  it('holds the 11 AGFP categories as ordinary rows', async () => {
    for (const name of AGFP_CATEGORIES) await createCategory({ name });
    expect(await listCategories()).toHaveLength(11);
  });

  it('trims and rejects a blank name', async () => {
    expect((await createCategory({ name: '  Bakery ' })).name).toBe('Bakery');
    await expect(createCategory({ name: '  ' })).rejects.toMatchObject({ status: 400 });
  });

  it('renames', async () => {
    const category = await createCategory({ name: 'Frz Non Meat' });
    expect((await updateCategory(category.id, { name: 'Frozen Non-Meat' })).name).toBe(
      'Frozen Non-Meat',
    );
  });

  it('404s an unknown category', async () => {
    const missing = '00000000-0000-0000-0000-000000000000';
    await expect(updateCategory(missing, { name: 'x' })).rejects.toMatchObject({
      status: 404,
    });
    await expect(removeCategory(missing)).rejects.toMatchObject({ status: 404 });
  });
});

describe('archive (§3.3 ACTIVE ⇄ ARCHIVED)', () => {
  it('hides an archived category from the active set and restores it', async () => {
    const kept = await createCategory({ name: 'Produce' });
    const archived = await createCategory({ name: 'Trash' });

    await updateCategory(archived.id, { active: false });

    // Hidden from new entry — this list is what renders the S2.2 keypad tiles.
    expect((await listCategories()).map((c) => c.id)).toEqual([kept.id]);
    // Preserved: still there for the S1.8 admin list and for history/reports.
    expect(await listCategories({ includeInactive: true })).toHaveLength(2);
    expect((await getCategory(archived.id))?.deactivated_at).not.toBeNull();

    await updateCategory(archived.id, { active: true });
    expect(await listCategories()).toHaveLength(2);
  });

  it('I21 — an archived category can still be renamed', async () => {
    const category = await createCategory({ name: 'Helth & Beauty' });
    await updateCategory(category.id, { active: false });

    const fixed = await updateCategory(category.id, { name: 'Health & Beauty' });
    expect(fixed.name).toBe('Health & Beauty');
    expect(fixed.deactivated_at).not.toBeNull();
  });
});

describe('I21 — remove', () => {
  it('hard-deletes: no Phase-1 table references a category (D3)', async () => {
    // `categoryHasHistory()` is exhaustively false in Phase 1 because
    // `weight_entry` and `unscheduled_donation` (`data-model.md §7`) are deferred.
    // This asserts the Phase-1 behavior, not a permanent one: when those tables
    // land, a category they reference deactivates instead, and this is the test
    // that will say so.
    const category = await createCategory({ name: 'Mistyped' });
    expect(await removeCategory(category.id)).toBe('DELETED');
    expect(await getCategory(category.id)).toBeUndefined();
  });

  it('removes an archived category the same way', async () => {
    const category = await createCategory({ name: 'Mistyped' });
    await updateCategory(category.id, { active: false });
    expect(await removeCategory(category.id)).toBe('DELETED');
  });

  it('no table in the Phase-1 schema has a category FK', async () => {
    // The structural fact the predicate above encodes, asserted against the
    // migrated database rather than against a reading of the migrations.
    const referencing = await sql<{ table_name: string }>`
      SELECT tc.table_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name   = tc.constraint_name
       AND ccu.constraint_schema = tc.constraint_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND ccu.table_name = 'category'
    `.execute(db);
    expect(referencing.rows).toEqual([]);
  });
});
