// Donor master data — `product-requirement.md` cap 2, `ui-ux-spec.md S1.8` (Donors
// tab). Admin maintains the permanent stores the pantry collects from.
//
// `address` and `contact` are operational: the address is where the driver drives
// and the contact is who they call when the loading dock is locked. They are NOT
// PII in this system's sense (phone/address on `app_user`) and are never shaped
// out — see the scope note in `pii.ts`.

import type { Selectable } from 'kysely';
import type { RemovalOutcome } from '../../../shared/src/masters.js';
import { db } from '../db/index.js';
import { writeTransaction, type Tx } from '../db/transaction.js';
import type { Donor } from '../db/types.js';
import { badRequest, conflict, notFound } from '../middleware/error.js';

export type DonorRecord = Selectable<Donor>;

export interface CreateDonorInput {
  name: string;
  address?: string | null;
  contact?: string | null;
  note?: string | null;
}

export interface UpdateDonorInput {
  name?: string;
  address?: string | null;
  contact?: string | null;
  note?: string | null;
  /** `domain-modeling.md §3.3` ACTIVE ⇄ DEACTIVATED. */
  active?: boolean;
}

/** A display name that is only whitespace is not a name. `name` is NOT NULL at the
 *  database and carries no format rule beyond that, so this is the whole check. */
function cleanName(value: string): string {
  const name = value.trim();
  if (name === '') throw badRequest('A donor name is required.');
  return name;
}

/** Optional free text: absent and blank both mean "nothing on file", which the
 *  column spells `NULL`. */
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
// Reads. No transaction: `architecture.md §4.1` puts every WRITE through
// `writeTransaction`, and a single-statement read needs no isolation of its own.
// ---------------------------------------------------------------------------

export interface ListDonorsOptions {
  /** The S1.8 admin list wants the deactivated ones too, so it can restore one.
   *  Every other reader is a picker and wants the active set (`data-model.md §0`). */
  includeInactive?: boolean;
}

export async function listDonors(
  options: ListDonorsOptions = {},
): Promise<DonorRecord[]> {
  let query = db.selectFrom('donor').selectAll().orderBy('name');
  if (options.includeInactive !== true) {
    // I21 — active reads filter on the soft-delete predicate; `ix_donor_active`
    // is the partial index for exactly this (`data-model.md §12`).
    query = query.where('deactivated_at', 'is', null);
  }
  return query.execute();
}

export async function getDonor(donorId: string): Promise<DonorRecord | undefined> {
  return db
    .selectFrom('donor')
    .selectAll()
    .where('id', '=', donorId)
    .executeTakeFirst();
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createDonor(input: CreateDonorInput): Promise<DonorRecord> {
  const name = cleanName(input.name);
  return writeTransaction(async (tx) =>
    tx
      .insertInto('donor')
      .values({
        name,
        address: cleanText(input.address),
        contact: cleanText(input.contact),
        note: cleanText(input.note),
      })
      .returningAll()
      .executeTakeFirstOrThrow(),
  );
}

/**
 * I21 — field edits are always allowed; soft-delete governs removal only. A
 * deactivated donor can still be renamed or have its note corrected, and that is
 * deliberate: the row is still referenced by history that renders through a live
 * FK (`domain-modeling.md §2.3`, ShiftStop keeps a live Donor FK).
 *
 * `active` is the one field here that is not an ordinary edit — it is §3.3's
 * single lifecycle toggle, stored as the one physical bit `deactivated_at`.
 */
export async function updateDonor(
  donorId: string,
  patch: UpdateDonorInput,
): Promise<DonorRecord> {
  const values: {
    name?: string;
    address?: string | null;
    contact?: string | null;
    note?: string | null;
    deactivated_at?: Date | null;
  } = {};

  if (patch.name !== undefined) values.name = cleanName(patch.name);
  if (patch.address !== undefined) values.address = cleanText(patch.address);
  if (patch.contact !== undefined) values.contact = cleanText(patch.contact);
  if (patch.note !== undefined) values.note = cleanText(patch.note);

  return writeTransaction(async (tx) => {
    const current = await tx
      .selectFrom('donor')
      .select(['id', 'deactivated_at'])
      .where('id', '=', donorId)
      .executeTakeFirst();
    if (!current) throw notFound('No such donor.');

    if (patch.active !== undefined) {
      // Toggling to the state it already holds must not restamp the instant —
      // "deactivated since" is information the admin screen shows.
      if (patch.active) values.deactivated_at = null;
      else values.deactivated_at = current.deactivated_at ?? new Date();
    }

    if (Object.keys(values).length === 0) throw badRequest('Nothing to change.');

    return tx
      .updateTable('donor')
      .set(values)
      .where('id', '=', donorId)
      .returningAll()
      .executeTakeFirstOrThrow();
  });
}

/**
 * I21 — "has referencing history" for a Donor.
 *
 * ONE function, deliberately (build-plan D3), and Phase 2 is where that decision paid
 * off: `weight_entry.donor_id` and `unscheduled_donation.donor_id` (`data-model.md
 * §7`) arrived, and extending this predicate was the two probes below rather than a
 * hunt through call sites. Nothing else in the codebase may ask this question a
 * second way.
 *
 * Advisory only. The real guard is the blanket `ON DELETE RESTRICT` on every FK
 * (`data-model.md §0`): the DELETE below succeeds iff zero rows reference the row.
 * This picks the branch and produces the friendly outcome; it is not correctness.
 */
export async function donorHasHistory(tx: Tx, donorId: string): Promise<boolean> {
  const routeStop = await tx
    .selectFrom('route_stop')
    .select('id')
    .where('donor_id', '=', donorId)
    .executeTakeFirst();
  if (routeStop) return true;

  const shiftStop = await tx
    .selectFrom('shift_stop')
    .select('id')
    .where('donor_id', '=', donorId)
    .executeTakeFirst();
  if (shiftStop) return true;

  // Phase 2 (§7). Voided weights count: a voided row is retained for audit and is
  // still a reference, so hard-deleting the donor it credits would take the audit
  // trail with it — which is the one thing voiding exists to keep.
  const weight = await tx
    .selectFrom('weight_entry')
    .select('id')
    .where('donor_id', '=', donorId)
    .executeTakeFirst();
  if (weight) return true;

  const donation = await tx
    .selectFrom('unscheduled_donation')
    .select('id')
    .where('donor_id', '=', donorId)
    .executeTakeFirst();
  return donation !== undefined;
}

/**
 * I21 — soft-delete when the donor has referencing history, hard-delete when it has
 * none (the escape hatch for a mistaken create). The caller does not choose which.
 */
export async function removeDonor(donorId: string): Promise<RemovalOutcome> {
  return writeTransaction(async (tx) => {
    const donor = await tx
      .selectFrom('donor')
      .select(['id', 'deactivated_at'])
      .where('id', '=', donorId)
      .executeTakeFirst();
    if (!donor) throw notFound('No such donor.');

    if (await donorHasHistory(tx, donorId)) {
      await tx
        .updateTable('donor')
        .set({ deactivated_at: donor.deactivated_at ?? new Date() })
        .where('id', '=', donorId)
        .execute();
      return 'DEACTIVATED';
    }

    try {
      await tx.deleteFrom('donor').where('id', '=', donorId).execute();
    } catch (err) {
      // A writer that created history between the predicate and the DELETE is
      // normally caught by SERIALIZABLE and re-run (`db/transaction.ts`). This
      // turns the residual case into the 409 it is, rather than a 500 with a
      // correlation id pointing at a race nobody can act on.
      if (isForeignKeyViolation(err)) {
        throw conflict('That donor is now used by a run. Open it again and retry.');
      }
      throw err;
    }
    return 'DELETED';
  });
}
