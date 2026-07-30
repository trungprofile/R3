// The sheet: adding weights, correcting them, skipping a stop — and the one thing
// that makes all of it safe, which is that nothing is ever stored twice.
//
//   I13  weight rows are immutable and append-only; a correction is void-old +
//        insert-new; voided rows are excluded from every sum; totals are
//        SUM-on-read and never stored.
//   I12  WEIGHED is a read-time projection over non-voided rows, never a column.
//
// The projection is what most of these assertions are really about: it is easy to
// write code that passes every test by storing a WEIGHED disposition, and the whole
// point of I12 is that voiding the last weight has to take the stop back out of the
// resolved set. So several tests check the state AFTER a void, not just after an add.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/index.js';
import {
  addWeight,
  readStopSheet,
  reviseWeight,
  skipStop,
  voidWeight,
} from '../src/services/receive.js';
import { makeCategory, makeReceiver, makeStartedShift, resetDatabase } from './fixtures.js';

const receiver = (id: string) => ({ id });

async function sheet() {
  const { shift, stops } = await makeStartedShift({ stopCount: 2 });
  const user = await makeReceiver();
  const produce = await makeCategory('Produce');
  const bakery = await makeCategory('Bakery');
  return { shiftId: shift.id, stops, actor: receiver(user.id), produce, bakery };
}

beforeEach(resetDatabase);
afterAll(async () => {
  await pool.end();
});

describe('adding weight (cap 14)', () => {
  it('confirms immediately — the entry is on the sheet with no submit step', async () => {
    const { shiftId, stops, actor, produce } = await sheet();

    const detail = await addWeight(actor, shiftId, stops[0]!.id, {
      categoryId: produce.id,
      weight: '516',
    });

    const tile = detail.tiles.find((t) => t.categoryId === produce.id);
    expect(tile?.entries).toHaveLength(1);
    expect(tile?.subtotal).toBe('516.00');
    expect(detail.stopTotal).toBe('516.00');
  });

  it('allows many rows per (shift, donor, category) — I13 grain', async () => {
    const { shiftId, stops, actor, produce } = await sheet();

    await addWeight(actor, shiftId, stops[0]!.id, { categoryId: produce.id, weight: '516' });
    const detail = await addWeight(actor, shiftId, stops[0]!.id, {
      categoryId: produce.id,
      weight: '706',
    });

    const tile = detail.tiles.find((t) => t.categoryId === produce.id);
    expect(tile?.entries).toHaveLength(2);
    // The sheet's whole promise: it does the arithmetic the paper log made a person do.
    expect(tile?.subtotal).toBe('1222.00');
  });

  it('keeps decimals exact — a scale reading is not routed through a float', async () => {
    const { shiftId, stops, actor, produce } = await sheet();

    await addWeight(actor, shiftId, stops[0]!.id, { categoryId: produce.id, weight: '0.1' });
    await addWeight(actor, shiftId, stops[0]!.id, { categoryId: produce.id, weight: '0.2' });
    const detail = await addWeight(actor, shiftId, stops[0]!.id, {
      categoryId: produce.id,
      weight: '0.3',
    });

    // 0.1 + 0.2 + 0.3 is 0.6000000000000001 in binary floating point.
    expect(detail.stopTotal).toBe('0.60');
  });

  it('projects the stop to WEIGHED once a non-voided row exists (I12)', async () => {
    const { shiftId, stops, actor, produce } = await sheet();
    expect((await readStopSheet(db, shiftId, stops[0]!.id)).state).toBe('COLLECTED');

    const detail = await addWeight(actor, shiftId, stops[0]!.id, {
      categoryId: produce.id,
      weight: '10',
    });
    expect(detail.state).toBe('WEIGHED');
  });

  it('refuses an archived category — tiles render from live active data (S1.8)', async () => {
    const { shiftId, stops, actor, produce } = await sheet();
    await db
      .updateTable('category')
      .set({ deactivated_at: new Date() })
      .where('id', '=', produce.id)
      .execute();

    await expect(
      addWeight(actor, shiftId, stops[0]!.id, { categoryId: produce.id, weight: '10' }),
    ).rejects.toThrow(/still in use/i);
  });

  it('rejects a weight that is not a number of pounds', async () => {
    const { shiftId, stops, actor, produce } = await sheet();
    for (const bad of ['', 'abc', '-5', '1.234', '12345678']) {
      await expect(
        addWeight(actor, shiftId, stops[0]!.id, { categoryId: produce.id, weight: bad }),
      ).rejects.toThrow();
    }
  });

  it('stamps the entry with who logged it (I26, PRD cap 14 attribution)', async () => {
    const { shiftId, stops, actor, produce } = await sheet();
    const detail = await addWeight(actor, shiftId, stops[0]!.id, {
      categoryId: produce.id,
      weight: '10',
    });
    const entry = detail.tiles.find((t) => t.categoryId === produce.id)!.entries[0]!;
    expect(entry.createdByName).toMatch(/\S/);
  });
});

describe('correcting a weight (I13 — void-old + insert-new)', () => {
  it('never UPDATEs the number: the old row survives, voided', async () => {
    const { shiftId, stops, actor, produce } = await sheet();
    const first = await addWeight(actor, shiftId, stops[0]!.id, {
      categoryId: produce.id,
      weight: '516',
    });
    const original = first.tiles.find((t) => t.categoryId === produce.id)!.entries[0]!;

    const after = await reviseWeight(actor, shiftId, stops[0]!.id, original.id, {
      weight: '615',
    });

    // The UI presents an overwrite; the ledger holds two rows, one of them voided.
    const rows = await db
      .selectFrom('weight_entry')
      .select(['id', 'voided', 'weight'])
      .where('shift_id', '=', shiftId)
      .orderBy('created_at')
      .execute();

    expect(rows).toHaveLength(2);
    expect(rows[0]!.voided).toBe(true);
    expect(rows[0]!.weight).toBe('516.00');
    expect(rows[1]!.voided).toBe(false);

    // And the sheet shows one number, which is the new one.
    const tile = after.tiles.find((t) => t.categoryId === produce.id)!;
    expect(tile.entries).toHaveLength(1);
    expect(tile.subtotal).toBe('615.00');
  });

  it('stamps the voided row with the voider (I26)', async () => {
    const { shiftId, stops, actor, produce } = await sheet();
    const first = await addWeight(actor, shiftId, stops[0]!.id, {
      categoryId: produce.id,
      weight: '10',
    });
    const original = first.tiles.find((t) => t.categoryId === produce.id)!.entries[0]!;
    const other = await makeReceiver();

    await reviseWeight(receiver(other.id), shiftId, stops[0]!.id, original.id, {
      weight: '20',
    });

    const voidedRow = await db
      .selectFrom('weight_entry')
      .select(['updated_by'])
      .where('id', '=', original.id)
      .executeTakeFirstOrThrow();
    expect(voidedRow.updated_by).toBe(other.id);
  });

  it('refuses to revise an already-voided row — the second racer loses', async () => {
    const { shiftId, stops, actor, produce } = await sheet();
    const first = await addWeight(actor, shiftId, stops[0]!.id, {
      categoryId: produce.id,
      weight: '10',
    });
    const original = first.tiles.find((t) => t.categoryId === produce.id)!.entries[0]!;

    await reviseWeight(actor, shiftId, stops[0]!.id, original.id, { weight: '20' });
    await expect(
      reviseWeight(actor, shiftId, stops[0]!.id, original.id, { weight: '30' }),
    ).rejects.toThrow(/already changed/i);
  });

  it('excludes voided rows from every sum', async () => {
    const { shiftId, stops, actor, produce } = await sheet();
    const a = await addWeight(actor, shiftId, stops[0]!.id, {
      categoryId: produce.id,
      weight: '100',
    });
    await addWeight(actor, shiftId, stops[0]!.id, { categoryId: produce.id, weight: '50' });

    const first = a.tiles.find((t) => t.categoryId === produce.id)!.entries[0]!;
    const after = await voidWeight(actor, shiftId, stops[0]!.id, first.id);

    expect(after.stopTotal).toBe('50.00');
  });

  it('takes the stop back OUT of WEIGHED when its last weight is voided (I12)', async () => {
    const { shiftId, stops, actor, produce } = await sheet();
    const added = await addWeight(actor, shiftId, stops[0]!.id, {
      categoryId: produce.id,
      weight: '10',
    });
    expect(added.state).toBe('WEIGHED');

    const entry = added.tiles.find((t) => t.categoryId === produce.id)!.entries[0]!;
    const after = await voidWeight(actor, shiftId, stops[0]!.id, entry.id);

    // This is the assertion a stored WEIGHED column would fail. The stop falls back
    // to its own disposition, which is where the driver left it.
    expect(after.state).toBe('COLLECTED');
  });

  it('is idempotent: voiding a voided row is the state the caller asked for', async () => {
    const { shiftId, stops, actor, produce } = await sheet();
    const added = await addWeight(actor, shiftId, stops[0]!.id, {
      categoryId: produce.id,
      weight: '10',
    });
    const entry = added.tiles.find((t) => t.categoryId === produce.id)!.entries[0]!;

    await voidWeight(actor, shiftId, stops[0]!.id, entry.id);
    await expect(voidWeight(actor, shiftId, stops[0]!.id, entry.id)).resolves.toBeDefined();
  });
});

describe('skipping a stop (§3.2, receiver branch)', () => {
  it('stores SKIPPED and writes no phantom zero row', async () => {
    const { shiftId, stops, actor } = await sheet();

    const detail = await skipStop(actor, shiftId, stops[0]!.id);
    expect(detail.state).toBe('SKIPPED');

    const rows = await db
      .selectFrom('weight_entry')
      .selectAll()
      .where('shift_id', '=', shiftId)
      .execute();
    // "We received nothing" and "we received zero pounds" are different facts, and
    // only one of them belongs in the report.
    expect(rows).toHaveLength(0);
  });

  it('refuses to skip a stop that already carries weight', async () => {
    const { shiftId, stops, actor, produce } = await sheet();
    await addWeight(actor, shiftId, stops[0]!.id, { categoryId: produce.id, weight: '10' });

    await expect(skipStop(actor, shiftId, stops[0]!.id)).rejects.toThrow(/already has weights/i);
  });

  it('leaves a driver-SKIPPED stop skipped even if a weight exists for that donor', async () => {
    // An off-route weight for the same donor is allowed by I13; it must not silently
    // un-skip a stop the driver explicitly skipped.
    const { shift, stops } = await makeStartedShift({ stopCount: 1 });
    const user = await makeReceiver();
    const category = await makeCategory();

    await db
      .updateTable('shift_stop')
      .set({ disposition: 'SKIPPED' })
      .where('id', '=', stops[0]!.id)
      .execute();

    await db
      .insertInto('weight_entry')
      .values({
        shift_id: shift.id,
        donor_id: stops[0]!.donor_id,
        category_id: category.id,
        weight: '5',
        created_by: user.id,
        updated_by: user.id,
      })
      .execute();

    const detail = await readStopSheet(db, shift.id, stops[0]!.id);
    expect(detail.state).toBe('SKIPPED');
  });
});

describe('the sheet itself', () => {
  it('shows every active category as a tile, including empty ones', async () => {
    const { shiftId, stops, produce, bakery } = await sheet();
    const detail = await readStopSheet(db, shiftId, stops[0]!.id);

    const ids = detail.tiles.map((t) => t.categoryId);
    expect(ids).toContain(produce.id);
    expect(ids).toContain(bakery.id);
    expect(detail.tiles.every((t) => t.subtotal === '0.00')).toBe(true);
  });

  it('keeps an archived category visible when it already carries entries', async () => {
    const { shiftId, stops, actor, produce } = await sheet();
    await addWeight(actor, shiftId, stops[0]!.id, { categoryId: produce.id, weight: '42' });
    await db
      .updateTable('category')
      .set({ deactivated_at: new Date() })
      .where('id', '=', produce.id)
      .execute();

    const detail = await readStopSheet(db, shiftId, stops[0]!.id);
    const tile = detail.tiles.find((t) => t.categoryId === produce.id);

    // Hiding it would make the stop total disagree with the numbers under the tiles.
    expect(tile?.subtotal).toBe('42.00');
    expect(detail.stopTotal).toBe('42.00');
  });

  it('carries all three read-only note channels the receiver is shown (cap 11)', async () => {
    const { shift, stops, donors } = await makeStartedShift({ stopCount: 1 });
    await db.updateTable('shift').set({ note: 'Run note' }).where('id', '=', shift.id).execute();
    await db
      .updateTable('shift_stop')
      .set({ note: 'Stop note' })
      .where('id', '=', stops[0]!.id)
      .execute();
    await db
      .updateTable('donor')
      .set({ note: 'Donor note' })
      .where('id', '=', donors[0]!.id)
      .execute();

    const detail = await readStopSheet(db, shift.id, stops[0]!.id);
    expect(detail.runNote).toBe('Run note');
    expect(detail.stopNote).toBe('Stop note');
    expect(detail.donorNote).toBe('Donor note');
  });
});
