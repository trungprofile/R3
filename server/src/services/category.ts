// Category master data — `product-requirement.md` cap 17, `ui-ux-spec.md S1.8`
// (Categories tab). Admin maintains the list of weight-entry buckets; it is data,
// not a fixed enum, seeded with the 11 AGFP categories at launch.
//
// Cap 17 ships in Phase 1 by build-plan D2, resolved in favour of the UI spec. It
// is CRUD on an admin shell that already exists and NOTHING consumes a category
// until Phase 2's weight entry, where the active set renders the S2.2 keypad tiles.

import type { Selectable } from 'kysely';
import type { RemovalOutcome } from '../../../shared/src/masters.js';
import { db } from '../db/index.js';
import { writeTransaction, type Tx } from '../db/transaction.js';
import type { Category } from '../db/types.js';
import { badRequest, notFound } from '../middleware/error.js';

export type CategoryRecord = Selectable<Category>;

export interface CreateCategoryInput {
  name: string;
}

export interface UpdateCategoryInput {
  name?: string;
  /** `domain-modeling.md §3.3` ACTIVE ⇄ ARCHIVED — archived is hidden from new
   *  entry and preserved in history and reports. This is cap 17's "archive one". */
  active?: boolean;
}

function cleanName(value: string): string {
  const name = value.trim();
  if (name === '') throw badRequest('A category name is required.');
  return name;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface ListCategoriesOptions {
  /** The S1.8 admin list; the S2.2 keypad never sets it — an archived category is
   *  hidden from new entry by definition. */
  includeInactive?: boolean;
}

export async function listCategories(
  options: ListCategoriesOptions = {},
): Promise<CategoryRecord[]> {
  let query = db.selectFrom('category').selectAll().orderBy('name');
  if (options.includeInactive !== true) {
    // I21 — active reads filter on the soft-delete predicate (`ix_category_active`).
    query = query.where('deactivated_at', 'is', null);
  }
  return query.execute();
}

export async function getCategory(
  categoryId: string,
): Promise<CategoryRecord | undefined> {
  return db
    .selectFrom('category')
    .selectAll()
    .where('id', '=', categoryId)
    .executeTakeFirst();
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createCategory(
  input: CreateCategoryInput,
): Promise<CategoryRecord> {
  const name = cleanName(input.name);
  return writeTransaction(async (tx) =>
    tx
      .insertInto('category')
      .values({ name })
      .returningAll()
      .executeTakeFirstOrThrow(),
  );
}

/** I21 — field edits are always allowed, archived or not; soft-delete governs
 *  removal only. `active` is §3.3's single lifecycle toggle. */
export async function updateCategory(
  categoryId: string,
  patch: UpdateCategoryInput,
): Promise<CategoryRecord> {
  const values: { name?: string; deactivated_at?: Date | null } = {};
  if (patch.name !== undefined) values.name = cleanName(patch.name);

  return writeTransaction(async (tx) => {
    const current = await tx
      .selectFrom('category')
      .select(['id', 'deactivated_at'])
      .where('id', '=', categoryId)
      .executeTakeFirst();
    if (!current) throw notFound('No such category.');

    if (patch.active !== undefined) {
      if (patch.active) values.deactivated_at = null;
      else values.deactivated_at = current.deactivated_at ?? new Date();
    }

    if (Object.keys(values).length === 0) throw badRequest('Nothing to change.');

    return tx
      .updateTable('category')
      .set(values)
      .where('id', '=', categoryId)
      .returningAll()
      .executeTakeFirstOrThrow();
  });
}

/**
 * I21 — "has referencing history" for a Category.
 *
 * ONE function, deliberately (build-plan D3), and this is the entity that paid for
 * that decision: through Phase 1 the set of tables referencing a category was EMPTY
 * and this predicate was exhaustively false. Phase 2 added `weight_entry.category_id`
 * and `unscheduled_donation.category_id` (`data-model.md §7`), and the change was the
 * two probes below and nothing else — which is the whole reason the question is asked
 * in exactly one place per entity.
 *
 * Advisory either way: the blanket `ON DELETE RESTRICT` is the real guard
 * (`data-model.md §0`), so a category that acquires history is protected by the
 * database whether or not this file was updated.
 */
export async function categoryHasHistory(tx: Tx, categoryId: string): Promise<boolean> {
  // Voided weights count. A voided row still references its category, and hiding
  // that would offer a hard delete the database would then refuse.
  const weight = await tx
    .selectFrom('weight_entry')
    .select('id')
    .where('category_id', '=', categoryId)
    .executeTakeFirst();
  if (weight) return true;

  const donation = await tx
    .selectFrom('unscheduled_donation')
    .select('id')
    .where('category_id', '=', categoryId)
    .executeTakeFirst();
  return donation !== undefined;
}

/**
 * I21 — deactivate (archive) when the category has referencing history,
 * hard-delete when it has none.
 *
 * In Phase 1 that always resolves to a hard delete, because no Phase-1 table
 * references `category` at all. The archive action is a separate call —
 * `updateCategory({ active: false })` — and the caller does not choose between the
 * two: this function asks the domain and reports which branch happened.
 *
 * `ui-ux-spec.md S1.8` used to say "no hard delete", contradicting I21. Resolved by
 * the human 2026-07-28 in favour of I21 (hard-delete only when nothing references it,
 * so no history row is ever left dangling); S1.8 and PRD cap 17 were corrected.
 */
export async function removeCategory(categoryId: string): Promise<RemovalOutcome> {
  return writeTransaction(async (tx) => {
    const category = await tx
      .selectFrom('category')
      .select(['id', 'deactivated_at'])
      .where('id', '=', categoryId)
      .executeTakeFirst();
    if (!category) throw notFound('No such category.');

    if (await categoryHasHistory(tx, categoryId)) {
      await tx
        .updateTable('category')
        .set({ deactivated_at: category.deactivated_at ?? new Date() })
        .where('id', '=', categoryId)
        .execute();
      return 'DEACTIVATED';
    }

    await tx.deleteFrom('category').where('id', '=', categoryId).execute();
    return 'DELETED';
  });
}
