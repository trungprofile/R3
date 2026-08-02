// The pickup route builder — the reusable template scheduling materializes shifts
// from (`product-requirement.md` cap 4, `ui-ux-spec.md S1.6`).
//
// A Route is an ordered list of Donors (`domain-modeling.md §1`). This file owns
// the template and nothing downstream of it: it never writes `shift` or
// `shift_stop`, never materializes an occurrence, and never reads a recurrence
// pattern except to answer "does anything reference this route?".
//
// Two properties do most of the work here:
//
//   * ORDER IS THE PAYLOAD. Callers submit donor ids in the order they should be
//     visited; positions are assigned by this file. A client therefore cannot
//     submit a sparse, colliding or negative sequence, and "contiguous; reorder
//     renumbers" (`data-model.md §5.1`) holds by construction rather than by
//     validation.
//   * REPLACE, DON'T PATCH. One save carries the whole ordered list, because S1.6
//     is a drag-and-drop surface where add, remove and reorder happen together.
//     The rewrite runs in one transaction, which is what
//     `uq_route_stop_position ... DEFERRABLE INITIALLY DEFERRED` exists for: the
//     intermediate rows collide, and the constraint is checked at commit.

import type { Kysely } from 'kysely';
import { db } from '../db/index.js';
import { writeTransaction, type Tx } from '../db/transaction.js';
import type { DB } from '../db/types.js';
import { badRequest, notFound } from '../middleware/error.js';

/** Read-only queries may use the default isolation level (`architecture.md §4.1`),
 *  so reads accept either the pool or an open transaction. */
type Reader = Kysely<DB>;

export interface RouteRecord {
  id: string;
  name: string;
  /** D19 — seeds `shift.staff_note` at publish. Nothing reads it after that. */
  default_staff_note: string | null;
  deactivated_at: Date | null;
  created_at: Date;
}

export interface RouteStopRecord {
  id: string;
  donor_id: string;
  position: number;
  donor_name: string;
  donor_address: string | null;
  donor_deactivated_at: Date | null;
}

export interface RouteWithStops {
  route: RouteRecord;
  stops: RouteStopRecord[];
}

const ROUTE_COLUMNS = [
  'id',
  'name',
  'default_staff_note',
  'deactivated_at',
  'created_at',
] as const;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Postgres answers a malformed uuid with 22P02, which would surface as a 500.
 *  An unparseable id is simply a thing that does not exist. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

async function stopsByRoute(
  exec: Reader,
  routeIds: string[],
): Promise<Map<string, RouteStopRecord[]>> {
  const byRoute = new Map<string, RouteStopRecord[]>();
  if (routeIds.length === 0) return byRoute;

  const rows = await exec
    .selectFrom('route_stop')
    .innerJoin('donor', 'donor.id', 'route_stop.donor_id')
    .select([
      'route_stop.id as id',
      'route_stop.route_id as route_id',
      'route_stop.donor_id as donor_id',
      'route_stop.position as position',
      'donor.name as donor_name',
      'donor.address as donor_address',
      'donor.deactivated_at as donor_deactivated_at',
    ])
    .where('route_stop.route_id', 'in', routeIds)
    .orderBy('route_stop.position')
    .execute();

  for (const row of rows) {
    const { route_id, ...stop } = row;
    const held = byRoute.get(route_id) ?? [];
    held.push(stop);
    byRoute.set(route_id, held);
  }
  return byRoute;
}

export interface ListRoutesOptions {
  /** Archived routes are hidden from the picker (`domain-modeling.md §3.3`) but
   *  the builder still has to list them to un-archive one. */
  includeArchived?: boolean;
}

export async function listRoutes(
  options: ListRoutesOptions = {},
): Promise<RouteWithStops[]> {
  let query = db.selectFrom('route').select([...ROUTE_COLUMNS]);
  if (!options.includeArchived) {
    // ACTIVE ⇄ ARCHIVED (`domain-modeling.md §3.3`): archived routes are hidden
    // from the route picker, never removed.
    query = query.where('deactivated_at', 'is', null);
  }

  const routes = await query.orderBy('name').execute();
  const stops = await stopsByRoute(db, routes.map((r) => r.id));
  return routes.map((route) => ({ route, stops: stops.get(route.id) ?? [] }));
}

export async function getRoute(routeId: string): Promise<RouteWithStops | null> {
  if (!isUuid(routeId)) return null;

  const route = await db
    .selectFrom('route')
    .select([...ROUTE_COLUMNS])
    .where('id', '=', routeId)
    .executeTakeFirst();
  if (!route) return null;

  const stops = await stopsByRoute(db, [route.id]);
  return { route, stops: stops.get(route.id) ?? [] };
}

async function readRouteIn(tx: Tx, routeId: string): Promise<RouteWithStops> {
  const route = await tx
    .selectFrom('route')
    .select([...ROUTE_COLUMNS])
    .where('id', '=', routeId)
    .executeTakeFirstOrThrow();
  const stops = await stopsByRoute(tx, [route.id]);
  return { route, stops: stops.get(route.id) ?? [] };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

function validName(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw badRequest('Give this route a name.');
  }
  return value.trim();
}

/** D19's default note. Absent and blank both mean "no default", which the column
 *  spells `NULL` — the same treatment every other optional free-text field gets. */
function cleanNote(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const note = value.trim();
  return note === '' ? null : note;
}

/**
 * Validate the submitted ordering.
 *
 * I28 (template side) — a Donor appears at most once per Route. `uq_route_stop_donor`
 * is the actual enforcement (tier 1); this pre-check exists so a duplicated store
 * reads as a sentence rather than as a constraint violation.
 *
 * `domain-modeling.md §2.2` — `Route` contains 1..N `RouteStop`: a route has at
 * least one stop. Cross-row, so no CHECK can express it; it lives here.
 */
function validStops(value: unknown): string[] {
  if (!Array.isArray(value)) throw badRequest('Add at least one store to this route.');

  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const donorId of value) {
    if (!isUuid(donorId)) throw badRequest('That store is no longer available.');
    if (seen.has(donorId)) {
      // I28
      throw badRequest('A store can only appear once on a route.');
    }
    seen.add(donorId);
    ordered.push(donorId);
  }

  if (ordered.length === 0) throw badRequest('Add at least one store to this route.');
  return ordered;
}

/**
 * Rewrite a route's ordered stop list.
 *
 * Positions are assigned here, contiguous and ascending from 0, so a reorder is a
 * renumber (`data-model.md §5.1`: routes are ~8 stops, fractional ranks buy
 * nothing). Rows whose donor survives the edit are UPDATEd rather than
 * delete-and-reinsert, which keeps the stop's identity stable across a drag.
 *
 * I6 — nothing in this function touches `shift_stop`. That is the whole
 * enforcement: a started shift's stops are a frozen copy owned by that shift (I5),
 * so editing the template cannot reach them.
 */
async function setStopsIn(tx: Tx, routeId: string, donorIds: string[]): Promise<void> {
  const existing = await tx
    .selectFrom('route_stop')
    .select(['id', 'donor_id'])
    .where('route_id', '=', routeId)
    .execute();
  const existingByDonor = new Map(existing.map((row) => [row.donor_id, row.id]));

  const donors = await tx
    .selectFrom('donor')
    .select(['id', 'deactivated_at'])
    .where('id', 'in', donorIds)
    .execute();
  const donorById = new Map(donors.map((d) => [d.id, d]));

  for (const donorId of donorIds) {
    const donor = donorById.get(donorId);
    if (!donor) throw badRequest('That store is no longer available.');
    // I21 — a deactivated store is hidden from NEW use but preserved everywhere it
    // is already referenced. So it cannot be ADDED to a route, while a stop that
    // already names it stays put until staff swaps it out.
    if (donor.deactivated_at !== null && !existingByDonor.has(donorId)) {
      throw badRequest('That store is deactivated. Turn it back on to add it here.');
    }
  }

  const keep = new Set(donorIds);
  const dropped = existing.filter((row) => !keep.has(row.donor_id)).map((row) => row.id);
  if (dropped.length > 0) {
    await tx.deleteFrom('route_stop').where('id', 'in', dropped).execute();
  }

  // Positions collide transiently while this loop runs; `uq_route_stop_position`
  // is DEFERRABLE INITIALLY DEFERRED and is checked at commit (`data-model.md §5.1`).
  const inserts: { route_id: string; donor_id: string; position: number }[] = [];
  for (const [position, donorId] of donorIds.entries()) {
    const stopId = existingByDonor.get(donorId);
    if (stopId === undefined) {
      inserts.push({ route_id: routeId, donor_id: donorId, position });
    } else {
      await tx
        .updateTable('route_stop')
        .set({ position })
        .where('id', '=', stopId)
        .execute();
    }
  }
  if (inserts.length > 0) {
    await tx.insertInto('route_stop').values(inserts).execute();
  }
}

export interface CreateRouteParams {
  name: string;
  stops: string[];
  defaultStaffNote?: string | null;
}

export async function createRoute(params: CreateRouteParams): Promise<RouteWithStops> {
  const name = validName(params.name);
  const stops = validStops(params.stops);

  return writeTransaction(async (tx) => {
    const route = await tx
      .insertInto('route')
      .values({ name, default_staff_note: cleanNote(params.defaultStaffNote) })
      .returning([...ROUTE_COLUMNS])
      .executeTakeFirstOrThrow();

    await setStopsIn(tx, route.id, stops);
    return readRouteIn(tx, route.id);
  });
}

export interface UpdateRouteParams {
  name?: string;
  /** When present, replaces the whole ordered list. */
  stops?: string[];
  /** When present, sets or clears the D19 default. `null` clears it. */
  defaultStaffNote?: string | null;
}

/**
 * Edit a route.
 *
 * An ARCHIVED route is editable: `domain-modeling.md §2.3` scopes the soft-delete
 * rule to removal only ("field edits are always allowed"), and §3.3 makes the
 * toggle bidirectional — archiving hides a route from the picker, it does not
 * freeze it.
 */
export async function updateRoute(
  routeId: string,
  params: UpdateRouteParams,
): Promise<RouteWithStops> {
  if (!isUuid(routeId)) throw notFound('No such route.');
  const name = params.name === undefined ? undefined : validName(params.name);
  const stops = params.stops === undefined ? undefined : validStops(params.stops);

  return writeTransaction(async (tx) => {
    const existing = await tx
      .selectFrom('route')
      .select('id')
      .where('id', '=', routeId)
      .executeTakeFirst();
    if (!existing) throw notFound('No such route.');

    if (name !== undefined || params.defaultStaffNote !== undefined) {
      await tx
        .updateTable('route')
        .set({
          ...(name !== undefined ? { name } : {}),
          ...(params.defaultStaffNote !== undefined
            ? { default_staff_note: cleanNote(params.defaultStaffNote) }
            : {}),
        })
        .where('id', '=', routeId)
        .execute();
    }
    if (stops !== undefined) {
      await setStopsIn(tx, routeId, stops);
    }

    return readRouteIn(tx, routeId);
  });
}

/**
 * "Has referencing history" for Route.
 *
 * ONE function per entity, deliberately (`phase-1-build-plan.md D3`): the
 * predicate gains referencing tables in later phases and extending it must be a
 * one-line change rather than a hunt.
 *
 * `route_stop` is deliberately NOT history — the stops are the route's own body,
 * not a record of it having been used. What counts is anything that scheduled
 * against it: a materialized `shift` (I4 binds one at schedule time) or a
 * `recurrence_pattern` that will mint more.
 */
export async function routeHasHistory(tx: Tx, routeId: string): Promise<boolean> {
  const shift = await tx
    .selectFrom('shift')
    .select('id')
    .where('route_id', '=', routeId)
    .executeTakeFirst();
  if (shift) return true;

  const pattern = await tx
    .selectFrom('recurrence_pattern')
    .select('id')
    .where('route_id', '=', routeId)
    .executeTakeFirst();
  return pattern !== undefined;
}

export type RemoveRouteOutcome = 'DELETED' | 'ARCHIVED';

/**
 * Remove a route: archive it when anything has scheduled against it, hard-delete
 * it when nothing has (fixing a mistaken create).
 *
 * `domain-modeling.md §3.3`, Route row — ACTIVE ⇄ ARCHIVED, "hard-delete only if
 * zero referencing history". `data-model.md §5.1` states the same rule as "the
 * same pattern as the I21 masters", and every FK into `route` is ON DELETE
 * RESTRICT, so the database is the backstop if this predicate is ever narrower
 * than the FK set.
 */
export async function removeRoute(routeId: string): Promise<RemoveRouteOutcome> {
  if (!isUuid(routeId)) throw notFound('No such route.');

  return writeTransaction(async (tx) => {
    const route = await tx
      .selectFrom('route')
      .select(['id', 'deactivated_at'])
      .where('id', '=', routeId)
      .executeTakeFirst();
    if (!route) throw notFound('No such route.');

    if (await routeHasHistory(tx, routeId)) {
      // Idempotent: re-archiving keeps the original timestamp rather than
      // resetting when the route left the picker.
      if (route.deactivated_at === null) {
        await tx
          .updateTable('route')
          .set({ deactivated_at: new Date() })
          .where('id', '=', routeId)
          .execute();
      }
      return 'ARCHIVED';
    }

    // The stops are part of the route, so they go with it. Nothing else may
    // reference them: `shift_stop` is a copy (I5), never an FK to `route_stop`.
    await tx.deleteFrom('route_stop').where('route_id', '=', routeId).execute();
    await tx.deleteFrom('route').where('id', '=', routeId).execute();
    return 'DELETED';
  });
}

/** The other half of ACTIVE ⇄ ARCHIVED (`domain-modeling.md §3.3`): the toggle is
 *  bidirectional, so an archived route can come back to the picker. */
export async function restoreRoute(routeId: string): Promise<RouteWithStops> {
  if (!isUuid(routeId)) throw notFound('No such route.');

  return writeTransaction(async (tx) => {
    const route = await tx
      .selectFrom('route')
      .select('id')
      .where('id', '=', routeId)
      .executeTakeFirst();
    if (!route) throw notFound('No such route.');

    await tx
      .updateTable('route')
      .set({ deactivated_at: null })
      .where('id', '=', routeId)
      .execute();

    return readRouteIn(tx, routeId);
  });
}
