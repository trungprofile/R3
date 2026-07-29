// Donor master data (cap 2) and I21's removal branch.
//
// Against the MIGRATED database: the FK `ON DELETE RESTRICT` that *is* the I21
// history guard (`data-model.md §0`) exists only as real DDL, so a fixture schema
// or a mock would prove nothing about the branch these tests are about.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/index.js';
import {
  createDonor,
  getDonor,
  listDonors,
  removeDonor,
  updateDonor,
} from '../src/services/donor.js';
import { makeDonor, makeDriver, makeRoute, makeShift, resetDatabase } from './fixtures.js';

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await db.destroy();
  await pool.end().catch(() => undefined);
});

describe('create + edit (cap 2)', () => {
  it('stores the operational fields drivers need', async () => {
    const donor = await createDonor({
      name: "Sam's Club",
      address: '4400 N Freeway',
      contact: 'Dock — 555-0143',
      note: 'Ring the bell at the side door.',
    });

    expect(donor.name).toBe("Sam's Club");
    expect(donor.address).toBe('4400 N Freeway');
    expect(donor.contact).toBe('Dock — 555-0143');
    expect(donor.note).toBe('Ring the bell at the side door.');
    expect(donor.deactivated_at).toBeNull();
  });

  it('trims, and treats blank optional text as nothing on file', async () => {
    const donor = await createDonor({ name: '  Kroger  ', address: '   ', contact: null });
    expect(donor.name).toBe('Kroger');
    expect(donor.address).toBeNull();
    expect(donor.contact).toBeNull();
  });

  it('rejects a name that is only whitespace', async () => {
    await expect(createDonor({ name: '   ' })).rejects.toMatchObject({ status: 400 });
  });

  it('rejects an empty patch rather than silently doing nothing', async () => {
    const donor = await makeDonor();
    await expect(updateDonor(donor.id, {})).rejects.toMatchObject({ status: 400 });
  });

  it('404s an unknown donor', async () => {
    const missing = '00000000-0000-0000-0000-000000000000';
    await expect(updateDonor(missing, { name: 'x' })).rejects.toMatchObject({
      status: 404,
    });
    await expect(removeDonor(missing)).rejects.toMatchObject({ status: 404 });
  });
});

describe('active toggle (§3.3 ACTIVE ⇄ DEACTIVATED)', () => {
  it('hides deactivated donors from the default list and restores them', async () => {
    const kept = await createDonor({ name: 'Aldi' });
    const gone = await createDonor({ name: 'Walmart' });

    await updateDonor(gone.id, { active: false });

    // `data-model.md §0`: active reads filter on the soft-delete predicate.
    expect((await listDonors()).map((d) => d.id)).toEqual([kept.id]);
    // The S1.8 admin list still sees it, which is how it gets restored.
    expect((await listDonors({ includeInactive: true })).map((d) => d.name)).toEqual([
      'Aldi',
      'Walmart',
    ]);

    await updateDonor(gone.id, { active: true });
    expect((await listDonors()).map((d) => d.id).sort()).toEqual([kept.id, gone.id].sort());
  });

  it('does not restamp a donor already deactivated', async () => {
    const donor = await createDonor({ name: 'Target' });
    const first = await updateDonor(donor.id, { active: false });
    const again = await updateDonor(donor.id, { active: false, name: 'Target #2' });

    expect(again.deactivated_at).toEqual(first.deactivated_at);
    expect(again.name).toBe('Target #2');
  });

  it('I21 — field edits are allowed on a deactivated donor', async () => {
    const donor = await createDonor({ name: 'Costco', note: 'old note' });
    await updateDonor(donor.id, { active: false });

    // Soft-delete governs removal only. The row is still referenced by history
    // that renders through a live FK, so its details must stay correctable.
    const edited = await updateDonor(donor.id, {
      note: 'Ask for Miguel',
      address: '9 Dock Rd',
    });
    expect(edited.note).toBe('Ask for Miguel');
    expect(edited.address).toBe('9 Dock Rd');
    expect(edited.deactivated_at).not.toBeNull();
  });
});

describe('I21 — remove: soft with history, hard without', () => {
  it('hard-deletes a donor nothing has ever referenced', async () => {
    const donor = await createDonor({ name: 'Mistyped Store' });

    expect(await removeDonor(donor.id)).toBe('DELETED');
    expect(await getDonor(donor.id)).toBeUndefined();
  });

  it('deactivates a donor listed on a route (route_stop)', async () => {
    const { donors } = await makeRoute(2);
    const donor = donors[0]!;

    expect(await removeDonor(donor.id)).toBe('DEACTIVATED');

    const after = await getDonor(donor.id);
    expect(after?.deactivated_at).not.toBeNull();
    // Preserved everywhere it is referenced: the route stop still resolves.
    const stops = await db
      .selectFrom('route_stop')
      .select('id')
      .where('donor_id', '=', donor.id)
      .execute();
    expect(stops).toHaveLength(1);
  });

  it('deactivates a donor frozen into a shift snapshot (shift_stop)', async () => {
    // The second referencing table, and the reason the predicate is one function:
    // a donor can be off every route and still be in a started run's snapshot (I5).
    const donor = await makeDonor('Snapshot Only');
    const driver = await makeDriver();
    const shift = await makeShift({ status: 'IN_PROGRESS', ownerId: driver.id });
    await db
      .insertInto('shift_stop')
      .values({ shift_id: shift.id, donor_id: donor.id, position: 0 })
      .execute();

    expect(await removeDonor(donor.id)).toBe('DEACTIVATED');
    expect((await getDonor(donor.id))?.deactivated_at).not.toBeNull();
  });

  it('keeps the original timestamp when an already-deactivated donor is removed', async () => {
    const { donors } = await makeRoute(1);
    const donor = donors[0]!;
    const archived = await updateDonor(donor.id, { active: false });

    expect(await removeDonor(donor.id)).toBe('DEACTIVATED');
    expect((await getDonor(donor.id))?.deactivated_at).toEqual(archived.deactivated_at);
  });

  it('the FK RESTRICT is the real guard, not the predicate', async () => {
    // `data-model.md §0`: app-level reference counting is friendly text; the
    // database is correctness. A raw DELETE of a referenced donor must fail even
    // though nothing in the service was consulted.
    const { donors } = await makeRoute(1);
    await expect(
      db.deleteFrom('donor').where('id', '=', donors[0]!.id).execute(),
    ).rejects.toMatchObject({ code: '23503' });
  });
});
