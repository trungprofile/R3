// The pickup route builder — template rules (`ui-ux-spec.md S1.6`, PRD cap 4).
//
// Against the MIGRATED database (CLAUDE.md). That is load-bearing twice over here:
// I28's template side is `uq_route_stop_donor`, a tier-1 constraint that exists
// only as real DDL, and the reorder path depends on `uq_route_stop_position` being
// DEFERRABLE INITIALLY DEFERRED — a fixture schema would let a broken renumber
// pass.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/index.js';
import {
  createRoute,
  getRoute,
  listRoutes,
  removeRoute,
  restoreRoute,
  updateRoute,
} from '../src/services/pickup-route.js';
import { makeDonor, makeShift, resetDatabase } from './fixtures.js';

beforeEach(resetDatabase);
afterAll(async () => {
  await db.destroy();
  await pool.end().catch(() => undefined);
});

/** The stop list as the builder shows it: donor ids in visit order. */
function order(route: { stops: { donor_id: string }[] }): string[] {
  return route.stops.map((s) => s.donor_id);
}

async function threeDonors() {
  return [await makeDonor('Alpha'), await makeDonor('Bravo'), await makeDonor('Charlie')];
}

describe('ordering', () => {
  it('assigns contiguous positions in the submitted order', async () => {
    const [a, b, c] = await threeDonors();
    const route = await createRoute({ name: 'Tuesday North', stops: [c!.id, a!.id, b!.id] });

    // Order is the payload: the client sent no positions at all.
    expect(order(route)).toEqual([c!.id, a!.id, b!.id]);
    expect(route.stops.map((s) => s.position)).toEqual([0, 1, 2]);
  });

  it('reads stops back in position order, not insertion order', async () => {
    const [a, b, c] = await threeDonors();
    const created = await createRoute({ name: 'R', stops: [a!.id, b!.id, c!.id] });
    await updateRoute(created.route.id, { stops: [c!.id, b!.id, a!.id] });

    const read = await getRoute(created.route.id);
    expect(order(read!)).toEqual([c!.id, b!.id, a!.id]);
    expect(read!.stops.map((s) => s.position)).toEqual([0, 1, 2]);
  });

  it('renumbers on reorder rather than leaving gaps (data-model.md §5.1)', async () => {
    const [a, b, c] = await threeDonors();
    const created = await createRoute({ name: 'R', stops: [a!.id, b!.id, c!.id] });

    const reordered = await updateRoute(created.route.id, { stops: [b!.id, c!.id, a!.id] });
    expect(order(reordered)).toEqual([b!.id, c!.id, a!.id]);
    expect(reordered.stops.map((s) => s.position)).toEqual([0, 1, 2]);
  });

  it('survives a swap of two adjacent stops — the transient position collision is deferred', async () => {
    const [a, b] = await threeDonors();
    const created = await createRoute({ name: 'R', stops: [a!.id, b!.id] });

    // Mid-transaction both rows sit on the same position for a moment. This only
    // commits because `uq_route_stop_position` is DEFERRABLE INITIALLY DEFERRED.
    const swapped = await updateRoute(created.route.id, { stops: [b!.id, a!.id] });
    expect(order(swapped)).toEqual([b!.id, a!.id]);
  });

  it('keeps a surviving stop\'s identity across a drag', async () => {
    const [a, b, c] = await threeDonors();
    const created = await createRoute({ name: 'R', stops: [a!.id, b!.id, c!.id] });
    const idOfA = created.stops.find((s) => s.donor_id === a!.id)!.id;

    const reordered = await updateRoute(created.route.id, { stops: [c!.id, a!.id, b!.id] });
    expect(reordered.stops.find((s) => s.donor_id === a!.id)!.id).toBe(idOfA);
  });

  it('adds, removes and reorders in one save', async () => {
    const [a, b, c] = await threeDonors();
    const d = await makeDonor('Delta');
    const created = await createRoute({ name: 'R', stops: [a!.id, b!.id, c!.id] });

    const saved = await updateRoute(created.route.id, { stops: [d.id, c!.id, a!.id] });
    expect(order(saved)).toEqual([d.id, c!.id, a!.id]);
    expect(saved.stops.map((s) => s.position)).toEqual([0, 1, 2]);

    const rows = await db
      .selectFrom('route_stop')
      .select('donor_id')
      .where('route_id', '=', created.route.id)
      .execute();
    expect(rows).toHaveLength(3); // b is gone, not orphaned
  });
});

describe('stop identity (I28) and cardinality', () => {
  it('refuses the same store twice on one route', async () => {
    const [a] = await threeDonors();
    await expect(createRoute({ name: 'R', stops: [a!.id, a!.id] })).rejects.toThrow(
      /only appear once/i,
    );
  });

  it('refuses a duplicate introduced by an edit', async () => {
    const [a, b] = await threeDonors();
    const created = await createRoute({ name: 'R', stops: [a!.id, b!.id] });
    await expect(
      updateRoute(created.route.id, { stops: [a!.id, b!.id, a!.id] }),
    ).rejects.toThrow(/only appear once/i);
  });

  it('is enforced by the database, not only by the service (tier 1)', async () => {
    const [a] = await threeDonors();
    const created = await createRoute({ name: 'R', stops: [a!.id] });

    // Bypassing the service entirely: uq_route_stop_donor is what actually holds
    // I28's template side, and it holds against SQL typed directly.
    await expect(
      db
        .insertInto('route_stop')
        .values({ route_id: created.route.id, donor_id: a!.id, position: 9 })
        .execute(),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('requires at least one stop (domain-modeling.md §2.2, 1..N)', async () => {
    await expect(createRoute({ name: 'Empty', stops: [] })).rejects.toThrow(/at least one/i);

    const [a] = await threeDonors();
    const created = await createRoute({ name: 'R', stops: [a!.id] });
    await expect(updateRoute(created.route.id, { stops: [] })).rejects.toThrow(
      /at least one/i,
    );

    // And the route it refused to empty still has its stop.
    expect(order((await getRoute(created.route.id))!)).toEqual([a!.id]);
  });

  it('refuses a store that does not exist', async () => {
    await expect(
      createRoute({ name: 'R', stops: ['00000000-0000-4000-8000-000000000000'] }),
    ).rejects.toThrow(/no longer available/i);
  });

  it('needs a name', async () => {
    const [a] = await threeDonors();
    await expect(createRoute({ name: '   ', stops: [a!.id] })).rejects.toThrow(/name/i);
  });
});

describe('deactivated stores (I21)', () => {
  it('cannot be added to a route', async () => {
    const [a, b] = await threeDonors();
    await db
      .updateTable('donor')
      .set({ deactivated_at: new Date() })
      .where('id', '=', b!.id)
      .execute();

    await expect(createRoute({ name: 'R', stops: [a!.id, b!.id] })).rejects.toThrow(
      /deactivated/i,
    );
  });

  it('stay on a route they were already on, and reorder normally', async () => {
    const [a, b] = await threeDonors();
    const created = await createRoute({ name: 'R', stops: [a!.id, b!.id] });
    await db
      .updateTable('donor')
      .set({ deactivated_at: new Date() })
      .where('id', '=', b!.id)
      .execute();

    // "Preserved everywhere referenced" — hidden from NEW use, not retracted from
    // the route it is already on.
    const reordered = await updateRoute(created.route.id, { stops: [b!.id, a!.id] });
    expect(order(reordered)).toEqual([b!.id, a!.id]);
    expect(reordered.stops.find((s) => s.donor_id === b!.id)!.donor_deactivated_at)
      .not.toBeNull();
  });
});

describe('editing a route never reaches a started shift (I6)', () => {
  it('leaves the shift\'s frozen snapshot untouched', async () => {
    const [a, b, c] = await threeDonors();
    const created = await createRoute({ name: 'R', stops: [a!.id, b!.id] });
    const shift = await makeShift({ routeId: created.route.id });

    // Stand in for what the execution lane will write at start (I5): the route's
    // ordered stops COPIED onto the shift. Inserted directly because this suite
    // owns none of that path — it only needs the snapshot to exist.
    await db
      .insertInto('shift_stop')
      .values([
        { shift_id: shift.id, donor_id: a!.id, position: 0 },
        { shift_id: shift.id, donor_id: b!.id, position: 1 },
      ])
      .execute();

    // Every kind of template edit at once: reorder, remove, add.
    await updateRoute(created.route.id, { stops: [c!.id, a!.id] });

    const snapshot = await db
      .selectFrom('shift_stop')
      .select(['donor_id', 'position'])
      .where('shift_id', '=', shift.id)
      .orderBy('position')
      .execute();

    expect(snapshot).toEqual([
      { donor_id: a!.id, position: 0 },
      { donor_id: b!.id, position: 1 },
    ]);
  });
});

describe('lifecycle — ACTIVE ⇄ ARCHIVED (domain-modeling.md §3.3)', () => {
  it('hard-deletes a route nothing has scheduled against', async () => {
    const [a] = await threeDonors();
    const created = await createRoute({ name: 'Mistake', stops: [a!.id] });

    expect(await removeRoute(created.route.id)).toBe('DELETED');
    expect(await getRoute(created.route.id)).toBeNull();

    // Its stops go with it — they are the route's body, not history of it.
    const orphans = await db
      .selectFrom('route_stop')
      .select('id')
      .where('route_id', '=', created.route.id)
      .execute();
    expect(orphans).toHaveLength(0);
  });

  it('archives a route a shift is bound to (I4), keeping its stops', async () => {
    const [a, b] = await threeDonors();
    const created = await createRoute({ name: 'In Use', stops: [a!.id, b!.id] });
    await makeShift({ routeId: created.route.id });

    expect(await removeRoute(created.route.id)).toBe('ARCHIVED');

    const archived = await getRoute(created.route.id);
    expect(archived!.route.deactivated_at).not.toBeNull();
    expect(order(archived!)).toEqual([a!.id, b!.id]);
  });

  it('archives a route a recurrence pattern would keep minting from', async () => {
    const [a] = await threeDonors();
    const created = await createRoute({ name: 'Weekly', stops: [a!.id] });
    const author = await makeShift(); // any admin-authored row gives us a user id
    await db
      .insertInto('recurrence_pattern')
      .values({
        route_id: created.route.id,
        weekdays: [2],
        start_time: '09:00',
        end_time: '11:00',
        created_by: author.created_by,
      })
      .execute();

    expect(await removeRoute(created.route.id)).toBe('ARCHIVED');
  });

  it('hides an archived route from the picker but not from the builder', async () => {
    const [a, b] = await threeDonors();
    const kept = await createRoute({ name: 'Active One', stops: [a!.id] });
    const gone = await createRoute({ name: 'Retired One', stops: [b!.id] });
    await makeShift({ routeId: gone.route.id });
    await removeRoute(gone.route.id);

    const picker = await listRoutes();
    expect(picker.map((r) => r.route.id)).toEqual([kept.route.id]);

    const all = await listRoutes({ includeArchived: true });
    expect(all.map((r) => r.route.id).sort()).toEqual(
      [kept.route.id, gone.route.id].sort(),
    );
  });

  it('restores an archived route — the toggle goes both ways', async () => {
    const [a] = await threeDonors();
    const created = await createRoute({ name: 'Back Again', stops: [a!.id] });
    await makeShift({ routeId: created.route.id });
    await removeRoute(created.route.id);

    const restored = await restoreRoute(created.route.id);
    expect(restored.route.deactivated_at).toBeNull();
    expect((await listRoutes()).map((r) => r.route.id)).toContain(created.route.id);
  });

  it('re-archiving does not move the timestamp', async () => {
    const [a] = await threeDonors();
    const created = await createRoute({ name: 'R', stops: [a!.id] });
    await makeShift({ routeId: created.route.id });

    await removeRoute(created.route.id);
    const first = (await getRoute(created.route.id))!.route.deactivated_at;
    expect(await removeRoute(created.route.id)).toBe('ARCHIVED');
    expect((await getRoute(created.route.id))!.route.deactivated_at).toEqual(first);
  });

  it('still edits an archived route — soft-delete governs removal, not fields', async () => {
    const [a, b] = await threeDonors();
    const created = await createRoute({ name: 'Old Name', stops: [a!.id] });
    await makeShift({ routeId: created.route.id });
    await removeRoute(created.route.id);

    const edited = await updateRoute(created.route.id, {
      name: 'New Name',
      stops: [b!.id, a!.id],
    });
    expect(edited.route.name).toBe('New Name');
    expect(order(edited)).toEqual([b!.id, a!.id]);
    expect(edited.route.deactivated_at).not.toBeNull(); // still archived
  });

  it('answers a missing route with 404, and a malformed id the same way', async () => {
    expect(await getRoute('not-a-uuid')).toBeNull();
    await expect(removeRoute('not-a-uuid')).rejects.toMatchObject({ status: 404 });
    await expect(
      updateRoute('00000000-0000-4000-8000-000000000000', { name: 'x' }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
