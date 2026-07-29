// `shift.assigned_over_conflict` — I20's staff-assign exemption, migration 0008.
//
// Against the MIGRATED database (CLAUDE.md), because the whole rule here IS a tier-1
// CHECK: `ck_shift_conflict_flag` exists only as real DDL, and a fixture schema would
// let every one of these assertions pass while the deployed database rejected the same
// writes.
//
// WHY THIS FILE EXISTS BEFORE THE FEATURE DOES. Wave 3 writes staff-assign, release and
// staff-unassign; this wave only made the flag storable. The constraint's behaviour is
// counter-intuitive in a specific way — it does not clear the flag when the owner goes,
// it makes forgetting to clear it *fail* — and `doc-qa` caught the lead asserting the
// opposite in three places. These tests pin the real behaviour so Wave 3 meets it as a
// red test with an explanation rather than as a constraint violation in a service it is
// midway through writing.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/index.js';
import { makeDriver, makeShift, resetDatabase } from './fixtures.js';

beforeEach(resetDatabase);
afterAll(async () => {
  await db.destroy();
  await pool.end().catch(() => undefined);
});

describe('the conflict flag cannot outlive the owner it warns', () => {
  it('defaults to false — self-select and materialization never set it', async () => {
    const shift = await makeShift();
    expect(shift.assigned_over_conflict).toBe(false);
  });

  it('may be set on a shift that has an owner', async () => {
    const driver = await makeDriver();
    const shift = await makeShift({ status: 'CLAIMED', ownerId: driver.id });

    const updated = await db
      .updateTable('shift')
      .set({ assigned_over_conflict: true })
      .where('id', '=', shift.id)
      .returningAll()
      .executeTakeFirstOrThrow();

    expect(updated.assigned_over_conflict).toBe(true);
  });

  it('cannot be set on an OPEN shift, which by I7 has no owner to warn', async () => {
    const shift = await makeShift({ status: 'OPEN' });

    await expect(
      db
        .updateTable('shift')
        .set({ assigned_over_conflict: true })
        .where('id', '=', shift.id)
        .execute(),
    ).rejects.toThrow(/ck_shift_conflict_flag/);
  });

  // The one Wave 3 must not be surprised by: clearing the owner WITHOUT clearing the
  // flag raises. This is the intended design — a loud failure beats a released shift
  // that silently keeps bannering the next driver about a conflict that was never
  // theirs — but it means every owner-clearing UPDATE carries a second SET.
  it('rejects an owner-clearing UPDATE that forgets the flag', async () => {
    const driver = await makeDriver();
    const shift = await makeShift({ status: 'CLAIMED', ownerId: driver.id });
    await db
      .updateTable('shift')
      .set({ assigned_over_conflict: true })
      .where('id', '=', shift.id)
      .execute();

    await expect(
      db
        .updateTable('shift')
        .set({ status: 'CANCELLED', owner_id: null })
        .where('id', '=', shift.id)
        .execute(),
    ).rejects.toThrow(/ck_shift_conflict_flag/);
  });

  // `data-model.md §9`'s cancel predicate, in the form the constraint requires.
  it('accepts the same UPDATE when it clears the flag too', async () => {
    const driver = await makeDriver();
    const shift = await makeShift({ status: 'CLAIMED', ownerId: driver.id });
    await db
      .updateTable('shift')
      .set({ assigned_over_conflict: true })
      .where('id', '=', shift.id)
      .execute();

    const cancelled = await db
      .updateTable('shift')
      .set({ status: 'CANCELLED', owner_id: null, assigned_over_conflict: false })
      .where('id', '=', shift.id)
      .returningAll()
      .executeTakeFirstOrThrow();

    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.owner_id).toBeNull();
    expect(cancelled.assigned_over_conflict).toBe(false);
  });
});
