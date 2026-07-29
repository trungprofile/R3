// Truck master data — `product-requirement.md` cap 3, `ui-ux-spec.md S1.8` (Trucks
// tab). A truck is a selectable entity the driver picks at route start: identity
// and attribution only, no telemetry, mileage, or maintenance.
//
// I22 — no exclusivity. Double-booking one truck across concurrent shifts is
// allowed, so nothing here (and no constraint in `data-model.md §4`) ties a truck
// to a time window.

import type { Selectable } from 'kysely';
import type { RemovalOutcome } from '../../../shared/src/masters.js';
import { db } from '../db/index.js';
import { writeTransaction, type Tx } from '../db/transaction.js';
import type { Truck } from '../db/types.js';
import { badRequest, conflict, notFound } from '../middleware/error.js';

export type TruckRecord = Selectable<Truck>;

export interface CreateTruckInput {
  truckName: string;
  plate?: string | null;
}

export interface UpdateTruckInput {
  truckName?: string;
  plate?: string | null;
  /** `domain-modeling.md §3.3` ACTIVE ⇄ INACTIVE — inactive is hidden from driver
   *  selection, which is what `listTrucks()`'s default filter produces. */
  active?: boolean;
}

function cleanName(value: string): string {
  const name = value.trim();
  if (name === '') throw badRequest('A truck name is required.');
  return name;
}

/** `plate` is optional (`domain-modeling.md §2.3`). */
function cleanText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const text = value.trim();
  return text === '' ? null : text;
}

/** SQLSTATE 23503 — foreign_key_violation. */
function isForeignKeyViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === '23503'
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface ListTrucksOptions {
  /** The S1.8 admin list; the driver's start-of-run picker never sets it. */
  includeInactive?: boolean;
}

export async function listTrucks(
  options: ListTrucksOptions = {},
): Promise<TruckRecord[]> {
  let query = db.selectFrom('truck').selectAll().orderBy('truck_name');
  if (options.includeInactive !== true) {
    // I21 — active reads filter on the soft-delete predicate (`ix_truck_active`).
    query = query.where('deactivated_at', 'is', null);
  }
  return query.execute();
}

export async function getTruck(truckId: string): Promise<TruckRecord | undefined> {
  return db
    .selectFrom('truck')
    .selectAll()
    .where('id', '=', truckId)
    .executeTakeFirst();
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createTruck(input: CreateTruckInput): Promise<TruckRecord> {
  const truckName = cleanName(input.truckName);
  return writeTransaction(async (tx) =>
    tx
      .insertInto('truck')
      .values({ truck_name: truckName, plate: cleanText(input.plate) })
      .returningAll()
      .executeTakeFirstOrThrow(),
  );
}

/** I21 — field edits are always allowed, deactivated or not; soft-delete governs
 *  removal only. `active` is §3.3's single lifecycle toggle. */
export async function updateTruck(
  truckId: string,
  patch: UpdateTruckInput,
): Promise<TruckRecord> {
  const values: {
    truck_name?: string;
    plate?: string | null;
    deactivated_at?: Date | null;
  } = {};

  if (patch.truckName !== undefined) values.truck_name = cleanName(patch.truckName);
  if (patch.plate !== undefined) values.plate = cleanText(patch.plate);

  return writeTransaction(async (tx) => {
    const current = await tx
      .selectFrom('truck')
      .select(['id', 'deactivated_at'])
      .where('id', '=', truckId)
      .executeTakeFirst();
    if (!current) throw notFound('No such truck.');

    if (patch.active !== undefined) {
      if (patch.active) values.deactivated_at = null;
      else values.deactivated_at = current.deactivated_at ?? new Date();
    }

    if (Object.keys(values).length === 0) throw badRequest('Nothing to change.');

    return tx
      .updateTable('truck')
      .set(values)
      .where('id', '=', truckId)
      .returningAll()
      .executeTakeFirstOrThrow();
  });
}

/**
 * I21 — "has referencing history" for a Truck.
 *
 * ONE function, deliberately (build-plan D3), for the same reason as
 * `donorHasHistory`: the set of referencing tables grows, and it must grow in one
 * place. `shift.truck_id` is the only one today and, unlike donor and category,
 * Phase 2's deferred tables (`data-model.md §7`) add none.
 *
 * Advisory only — the FK's `ON DELETE RESTRICT` is the real guard (`§0`).
 */
export async function truckHasHistory(tx: Tx, truckId: string): Promise<boolean> {
  const shift = await tx
    .selectFrom('shift')
    .select('id')
    .where('truck_id', '=', truckId)
    .executeTakeFirst();
  return shift !== undefined;
}

/** I21 — deactivate when the truck has been driven, hard-delete when it never was. */
export async function removeTruck(truckId: string): Promise<RemovalOutcome> {
  return writeTransaction(async (tx) => {
    const truck = await tx
      .selectFrom('truck')
      .select(['id', 'deactivated_at'])
      .where('id', '=', truckId)
      .executeTakeFirst();
    if (!truck) throw notFound('No such truck.');

    if (await truckHasHistory(tx, truckId)) {
      await tx
        .updateTable('truck')
        .set({ deactivated_at: truck.deactivated_at ?? new Date() })
        .where('id', '=', truckId)
        .execute();
      return 'DEACTIVATED';
    }

    try {
      await tx.deleteFrom('truck').where('id', '=', truckId).execute();
    } catch (err) {
      if (isForeignKeyViolation(err)) {
        throw conflict('That truck is now used by a run. Open it again and retry.');
      }
      throw err;
    }
    return 'DELETED';
  });
}
