// The NTFB report — PRD cap 15, `ui-ux-spec.md` S3.1, `domain-modeling.md §6`.
//
// Pure aggregation over what Phases 1 and 2 produced. No new domain state: nothing here
// writes anything except a Reporter's correction and the mapping table, and both of
// those go through the same void-and-reinsert and last-write-wins rules the receiver's
// half already obeys.
//
// THE DEFINITION (locked, `domain-modeling.md §6`):
//
//     report  = weight_entry[NOT voided] ∪ unscheduled_donation[CONFIRMED ∧ reportable]
//     metrics = weight_entry[NOT voided] ∪ unscheduled_donation[CONFIRMED]
//
// Three ways to get that union wrong, all of which produce a plausible-looking number:
//
//   1. **Filtering the union on `shift`.** The locked doc says it in as many words:
//      "the report query MUST NOT filter on Shift (walk-ins have none)". A join that
//      starts from `shift` drops every unscheduled donation and the total still adds
//      up, just to the wrong figure. Both halves below start from their own table.
//
//   2. **Bucketing on `created_at`.** `report_day` is `shift.occurrence_date` for a
//      weight and `received_date` for a donation (`data-model.md §8`). A Tuesday run
//      received at 12:30am Wednesday belongs to Tuesday, and an edit made a week later
//      does not move it.
//
//   3. **Summing in JavaScript.** `numeric(8,2)` is exact; a float is not. Every total
//      here is a SQL `sum()` cast to text, or integer-cent addition — never `+` on
//      parsed numbers.
//
// Enforcement tiers (`architecture.md §4.1`) — this file is tier 3 where it writes:
// the Reporter's revise reuses I13's void-then-insert, and the mapping edit is a plain
// field write. Everything else is a read.

import { sql } from 'kysely';
import {
  EXPORT_BLOCKED_MESSAGE,
  type CategoryMapping,
  type ExportRow,
  type NtfbCategory,
  type ReportEntry,
  type ReportLine,
  type UnmappedCategory,
  type WeeklyReport,
} from '../../../shared/src/report.js';
import { db } from '../db/index.js';
import { writeTransaction, type Tx } from '../db/transaction.js';
import { badRequest, conflict, notFound } from '../middleware/error.js';
import { addDays, localCalendarDate, parseDate } from '../time.js';
import { isoDate } from './schedule.js';
import { parseWeight } from './receive.js';
import type { Reader } from './eligibility.js';

export interface ReportActor {
  id: string;
}

/**
 * Composite-key separator for the in-memory groupings below.
 *
 * A character no donor name, category name or storage label can contain, so
 * `"Kroger" + "Elm St"` and `"Kroger Elm" + "St"` cannot collide into one bucket the
 * way any printable delimiter eventually does.
 */
const SEP = '\u0000';

/** Exact addition over `numeric(8,2)`: scale to integer cents, never float `+`. */
export function addAll(values: string[]): string {
  const cents = values.reduce((acc, v) => acc + Math.round(Number(v) * 100), 0);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

function subtract(a: string, b: string): string {
  return addAll([a, `-${b}`]);
}

// ---------------------------------------------------------------------------
// The week
// ---------------------------------------------------------------------------

/**
 * Resolve the Monday–Sunday week containing a date.
 *
 * Monday-start is not stated by any doc. It is the ISO week and the one a "weekly
 * report" is normally understood to mean; the pantry's own cycle is weekly per PRD §1
 * but its boundary is never named (phase-3-state.md A178).
 */
export function weekBounds(anchor: string): { weekStart: string; weekEnd: string } {
  const date = parseDate(anchor, 'week');
  const utc = new Date(Date.UTC(date.year, date.month - 1, date.day));
  // getUTCDay: 0 = Sunday. Shift so Monday is 0.
  const offset = (utc.getUTCDay() + 6) % 7;
  const start = addDays(date, -offset);
  return { weekStart: isoDate(start), weekEnd: isoDate(addDays(start, 6)) };
}

/** Today, pantry-local — the week the Reporter lands on with no date chosen. */
export async function currentWeek(): Promise<{ weekStart: string; weekEnd: string }> {
  const { timezone } = await db
    .selectFrom('app_config')
    .select('timezone')
    .executeTakeFirstOrThrow();
  return weekBounds(isoDate(localCalendarDate(new Date(), timezone)));
}

// ---------------------------------------------------------------------------
// The union
// ---------------------------------------------------------------------------

interface IntakeRow {
  categoryId: string;
  categoryName: string;
  ntfbCategoryId: string | null;
  ntfbCategoryName: string | null;
  ntfbCode: string | null;
  /** The mapping's storage half (migration 0013). Carried from here to the report line
   *  and the export because it is half of what Meal Connect calls a line item. */
  storage: string | null;
  total: string;
  reportable: boolean;
}

/**
 * Both halves of the union, grouped by category and by whether they are reportable.
 *
 * Written as two independent queries UNIONed rather than as a join, because they share
 * no table: a weight's day comes from its shift, a donation's from its own column, and
 * the second half has no shift at all. Combining them with a join would require an
 * outer join on `shift` whose null branch is the walk-in case — the same result, one
 * `WHERE` away from silently dropping it.
 */
async function intakeByCategory(
  reader: Reader,
  from: string,
  to: string,
): Promise<IntakeRow[]> {
  const rows = await sql<{
    category_id: string;
    category_name: string;
    ntfb_category_id: string | null;
    ntfb_category_name: string | null;
    ntfb_code: string | null;
    storage: string | null;
    total: string;
    reportable: boolean;
  }>`
    WITH intake AS (
      -- Planned. report_day = shift.occurrence_date, via join and never duplicated
      -- as a column (data-model.md §8, derived-vs-stored).
      SELECT we.category_id,
             we.weight,
             TRUE AS reportable          -- I15: scheduled ⇒ reportable, no flag exists
      FROM weight_entry we
      JOIN shift s ON s.id = we.shift_id
      WHERE we.voided = FALSE
        AND s.occurrence_date BETWEEN ${from}::date AND ${to}::date

      UNION ALL

      -- Unplanned. Its own date column, and NO join to shift — a walk-in has none,
      -- and joining would drop it (domain-modeling.md §6, stated explicitly).
      SELECT ud.category_id,
             ud.weight,
             ud.reportable
      FROM unscheduled_donation ud
      WHERE ud.status = 'CONFIRMED'
        AND ud.received_date BETWEEN ${from}::date AND ${to}::date
    )
    SELECT c.id                AS category_id,
           c.name              AS category_name,
           c.ntfb_category_id  AS ntfb_category_id,
           n.name              AS ntfb_category_name,
           n.code              AS ntfb_code,
           c.ntfb_storage      AS storage,
           sum(i.weight)::text AS total,
           i.reportable        AS reportable
    FROM intake i
    JOIN category c ON c.id = i.category_id
    LEFT JOIN ntfb_category n ON n.id = c.ntfb_category_id
    GROUP BY c.id, c.name, c.ntfb_category_id, n.name, n.code, c.ntfb_storage, i.reportable
    ORDER BY c.name
  `.execute(reader);

  return rows.rows.map((r) => ({
    categoryId: r.category_id,
    categoryName: r.category_name,
    ntfbCategoryId: r.ntfb_category_id,
    ntfbCategoryName: r.ntfb_category_name,
    ntfbCode: r.ntfb_code,
    storage: r.storage,
    total: r.total,
    reportable: r.reportable,
  }));
}

/**
 * The week as S3.1 renders it.
 *
 * `lines` roll AGFP categories into their NTFB bucket and carry only the reportable
 * half. `intakeTotal` counts everything, reportable or not, which is what keeps
 * "intake ≠ NTFB-reported" visible on the screen that most tempts someone to conflate
 * them (PRD §3).
 */
export async function weeklyReport(anchor: string): Promise<WeeklyReport> {
  const { weekStart, weekEnd } = weekBounds(anchor);
  const rows = await intakeByCategory(db, weekStart, weekEnd);

  const reportable = rows.filter((r) => r.reportable);

  const byNtfb = new Map<string, ReportLine>();
  const unmapped: UnmappedCategory[] = [];

  for (const row of reportable) {
    if (row.ntfbCategoryId === null || row.ntfbCategoryName === null) {
      // Surfaced, never dropped. Dropping it would understate the report by exactly
      // the amount nobody noticed — the "lost-sheet misreporting" failure mode.
      unmapped.push({
        categoryId: row.categoryId,
        categoryName: row.categoryName,
        total: row.total,
      });
      continue;
    }

    // Keyed on category AND storage, because that pair is what Meal Connect calls a
    // line item (migration 0013). Two AGFP categories reporting to one NTFB bucket
    // under different storage are two lines here and two lines on the receipt — which
    // is what NTFB's own receipts do, carrying two `Prepared Meals` rows. Keying on
    // the category alone would merge frozen weight into a dry line.
    const key = [row.ntfbCategoryId, row.storage ?? ''].join(SEP);
    let line = byNtfb.get(key);
    if (!line) {
      line = {
        ntfbCategoryId: row.ntfbCategoryId,
        ntfbCategoryName: row.ntfbCategoryName,
        ntfbCode: row.ntfbCode,
        storage: row.storage,
        agfpCategories: [],
        total: '0.00',
      };
      byNtfb.set(key, line);
    }
    line.agfpCategories.push({
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      total: row.total,
    });
    line.total = addAll([line.total, row.total]);
  }

  const lines = [...byNtfb.values()].sort(
    (a, b) =>
      a.ntfbCategoryName.localeCompare(b.ntfbCategoryName) ||
      (a.storage ?? '').localeCompare(b.storage ?? ''),
  );

  // `reportedTotal` is Σ of everything REPORTABLE, mapped or not — deliberately not
  // Σ of `lines`.
  //
  // Those two differ exactly by the unmapped weight, and conflating them mislabels the
  // number PRD §3 cares most about. A scheduled weight is reportable by construction
  // (I15); if it has no NTFB category yet that is a gap in the mapping table, not a
  // decision that the food is unreported. Deriving `unreportedTotal` from Σ(lines)
  // would file 516 lb of produce under "tracked for pantry metrics only, never
  // reported" — which is a real category with a real meaning, and not this one.
  //
  // So: unreported means somebody turned the toggle off. Unmapped is a separate
  // problem with its own block (`readyToExport`), and Σ(lines) < reportedTotal is
  // precisely the state that block exists to announce.
  const reportedTotal = addAll(reportable.map((r) => r.total));
  const intakeTotal = addAll(rows.map((r) => r.total));

  const openRuns = await db
    .selectFrom('shift')
    .innerJoin('route', 'route.id', 'shift.route_id')
    .select([
      'shift.id as shiftId',
      'route.name as routeName',
      sql<string>`to_char(shift.occurrence_date, 'YYYY-MM-DD')`.as('occurrenceDate'),
      'shift.status as status',
    ])
    .where(sql<boolean>`shift.occurrence_date BETWEEN ${weekStart}::date AND ${weekEnd}::date`)
    .where('shift.status', 'in', ['OPEN', 'CLAIMED', 'IN_PROGRESS'])
    .orderBy('shift.occurrence_date')
    .execute();

  // The pantry's identity at the far end — printed above the export so a Reporter can
  // confirm the account before typing (migration 0013).
  const config = await db
    .selectFrom('app_config')
    .select(['ntfb_agency_code', 'ntfb_food_bank', 'ntfb_food_bank_code'])
    .executeTakeFirstOrThrow();

  return {
    weekStart,
    weekEnd,
    lines,
    unmapped,
    reportedTotal,
    intakeTotal,
    unreportedTotal: subtract(intakeTotal, reportedTotal),
    // Unmapped weight blocks the export, an open run does not: the first would make
    // the file wrong, the second only makes it early, and only the Reporter knows
    // whether the week is really over.
    readyToExport: unmapped.length === 0,
    openRuns,
    mealConnect: {
      agencyCode: config.ntfb_agency_code,
      foodBank: config.ntfb_food_bank,
      foodBankCode: config.ntfb_food_bank_code,
    },
  };
}

// ---------------------------------------------------------------------------
// The drill-in (Success Metric 4 — every number resolves to store-category-day)
// ---------------------------------------------------------------------------

/**
 * The entries behind one number.
 *
 * Scoped by week and optionally by AGFP category. Both halves of the union again, and
 * again the donation half never touches `shift`.
 */
export async function reportEntries(
  anchor: string,
  options: { categoryId?: string } = {},
): Promise<ReportEntry[]> {
  const { weekStart, weekEnd } = weekBounds(anchor);
  const categoryFilter = options.categoryId ?? null;

  const rows = await sql<{
    id: string;
    kind: 'WEIGHT' | 'DONATION';
    day: string;
    donor_name: string;
    donor_code: string | null;
    category_id: string;
    category_name: string;
    weight: string;
    reportable: boolean;
    receiver_name: string;
    shift_id: string | null;
    route_name: string | null;
    window_open: boolean;
  }>`
    SELECT we.id,
           'WEIGHT'                                        AS kind,
           to_char(s.occurrence_date, 'YYYY-MM-DD')        AS day,
           d.name                                          AS donor_name,
           d.ntfb_donor_code                               AS donor_code,
           we.category_id,
           c.name                                          AS category_name,
           we.weight::text                                 AS weight,
           TRUE                                            AS reportable,
           concat_ws(' ', u.first_name, u.last_name)       AS receiver_name,
           we.shift_id,
           r.name                                          AS route_name,
           (s.starts_at + (cfg.receiver_edit_window_days * interval '1 day') > now())
                                                           AS window_open
    FROM weight_entry we
    JOIN shift s     ON s.id = we.shift_id
    JOIN route r     ON r.id = s.route_id
    JOIN donor d     ON d.id = we.donor_id
    JOIN category c  ON c.id = we.category_id
    JOIN app_user u  ON u.id = we.created_by
    CROSS JOIN app_config cfg
    WHERE we.voided = FALSE
      AND s.occurrence_date BETWEEN ${weekStart}::date AND ${weekEnd}::date
      AND (${categoryFilter}::uuid IS NULL OR we.category_id = ${categoryFilter}::uuid)

    UNION ALL

    SELECT ud.id,
           'DONATION'                                      AS kind,
           to_char(ud.received_date, 'YYYY-MM-DD')         AS day,
           -- The three source cases collapse here exactly as §8 says they do in the
           -- report: master donor, free-text label, or one "Unattributed" bucket.
           coalesce(d.name, ud.donor_label, 'Unattributed') AS donor_name,
           -- NULL for a free-text label by construction: there is no donor row, so
           -- there is no store for Meal Connect to attribute the food to.
           d.ntfb_donor_code                               AS donor_code,
           ud.category_id,
           c.name                                          AS category_name,
           ud.weight::text                                 AS weight,
           ud.reportable,
           concat_ws(' ', u.first_name, u.last_name)       AS receiver_name,
           ud.shift_id,
           r.name                                          AS route_name,
           (coalesce(s.starts_at, ud.created_at)
              + (cfg.receiver_edit_window_days * interval '1 day') > now())
                                                           AS window_open
    FROM unscheduled_donation ud
    LEFT JOIN shift s  ON s.id = ud.shift_id
    LEFT JOIN route r  ON r.id = s.route_id
    LEFT JOIN donor d  ON d.id = ud.donor_id
    JOIN category c    ON c.id = ud.category_id
    JOIN app_user u    ON u.id = ud.created_by
    CROSS JOIN app_config cfg
    WHERE ud.status = 'CONFIRMED'
      AND ud.received_date BETWEEN ${weekStart}::date AND ${weekEnd}::date
      AND (${categoryFilter}::uuid IS NULL OR ud.category_id = ${categoryFilter}::uuid)

    ORDER BY day, donor_name
  `.execute(db);

  return rows.rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    day: r.day,
    donorName: r.donor_name,
    donorCode: r.donor_code,
    categoryId: r.category_id,
    categoryName: r.category_name,
    weight: r.weight,
    reportable: r.reportable,
    receiverName: r.receiver_name,
    shiftId: r.shift_id,
    routeName: r.route_name,
    receiverWindowOpen: r.window_open,
  }));
}

// ---------------------------------------------------------------------------
// The Reporter's correction (PRD cap 15)
// ---------------------------------------------------------------------------

/**
 * Correct a weight from the drill-in.
 *
 * Same void-old + insert-new as the receiver's path (I13) and the same overwrite
 * presentation, but **deliberately not window-gated**: after the receiver's window
 * closes this is the only remaining way to fix a bad number, which is the entire
 * reason S3.1 carries an edit affordance at all. Before it closes, this mirrors what
 * the receiver could already do at the tablet.
 *
 * No approval step. The Reporter's edit is itself the correction (S3.1).
 */
export async function reviseReportedWeight(
  actor: ReportActor,
  entryId: string,
  input: { weight: string; note?: string | null },
): Promise<ReportEntry[]> {
  const weight = parseWeight(input.weight);

  const anchor = await writeTransaction(async (tx) => {
    const existing = await tx
      .selectFrom('weight_entry')
      .innerJoin('shift', 'shift.id', 'weight_entry.shift_id')
      .select([
        'weight_entry.id as id',
        'weight_entry.shift_id as shiftId',
        'weight_entry.donor_id as donorId',
        'weight_entry.category_id as categoryId',
        'weight_entry.note as note',
        sql<string>`to_char(shift.occurrence_date, 'YYYY-MM-DD')`.as('day'),
      ])
      .where('weight_entry.id', '=', entryId)
      .executeTakeFirst();

    if (!existing) throw notFound('No such entry.');

    const voided = await tx
      .updateTable('weight_entry')
      .set({ voided: true, updated_by: actor.id, updated_at: sql<Date>`now()` })
      .where('id', '=', entryId)
      .where('voided', '=', false)
      .executeTakeFirst();

    if (Number(voided.numUpdatedRows) === 0) {
      throw conflict('Someone already changed that number. Take another look.');
    }

    await tx
      .insertInto('weight_entry')
      .values({
        shift_id: existing.shiftId,
        donor_id: existing.donorId,
        category_id: existing.categoryId,
        weight,
        note: input.note === undefined ? existing.note : input.note,
        created_by: actor.id,
        updated_by: actor.id,
      })
      .execute();

    return existing.day;
  });

  return reportEntries(anchor);
}

// ---------------------------------------------------------------------------
// The mapping table (S3.1's editor)
// ---------------------------------------------------------------------------

export async function listNtfbCategories(): Promise<NtfbCategory[]> {
  const rows = await db
    .selectFrom('ntfb_category')
    .leftJoin('category', 'category.ntfb_category_id', 'ntfb_category.id')
    .select([
      'ntfb_category.id as id',
      'ntfb_category.name as name',
      'ntfb_category.code as code',
      'ntfb_category.deactivated_at as deactivatedAt',
      sql<string>`count(category.id)`.as('mappedCount'),
    ])
    .groupBy(['ntfb_category.id', 'ntfb_category.name', 'ntfb_category.code', 'ntfb_category.deactivated_at'])
    .orderBy('ntfb_category.name')
    .execute();

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    code: r.code,
    active: r.deactivatedAt === null,
    mappedCount: Number(r.mappedCount),
  }));
}

export async function createNtfbCategory(
  input: { name: string; code?: string | null },
): Promise<NtfbCategory> {
  const name = input.name.trim();
  if (name === '') throw badRequest('Give the category a name.');

  return writeTransaction(async (tx) => {
    const clash = await tx
      .selectFrom('ntfb_category')
      .select('id')
      .where(sql<boolean>`lower(name) = lower(${name})`)
      .where('deactivated_at', 'is', null)
      .executeTakeFirst();
    if (clash) throw conflict('There is already a category with that name.');

    const row = await tx
      .insertInto('ntfb_category')
      .values({ name, code: input.code?.trim() || null })
      .returningAll()
      .executeTakeFirstOrThrow();

    return { id: row.id, name: row.name, code: row.code, active: true, mappedCount: 0 };
  });
}

export async function updateNtfbCategory(
  id: string,
  input: { name?: string; code?: string | null; active?: boolean },
): Promise<void> {
  await writeTransaction(async (tx) => {
    const existing = await tx
      .selectFrom('ntfb_category')
      .select('id')
      .where('id', '=', id)
      .executeTakeFirst();
    if (!existing) throw notFound('No such category.');

    await tx
      .updateTable('ntfb_category')
      .set({
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.code !== undefined ? { code: input.code?.trim() || null } : {}),
        // Only reactivation goes through here; archiving is DELETE, where I21 decides.
        ...(input.active === true ? { deactivated_at: null } : {}),
        updated_at: sql<Date>`now()`,
      })
      .where('id', '=', id)
      .execute();
  });
}

/** I21, same shape as every other master: archive if referenced, hard-delete if not. */
export async function removeNtfbCategory(id: string): Promise<'DELETED' | 'DEACTIVATED'> {
  return writeTransaction(async (tx) => {
    const existing = await tx
      .selectFrom('ntfb_category')
      .select(['id', 'deactivated_at as deactivatedAt'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!existing) throw notFound('No such category.');

    if (await ntfbHasHistory(tx, id)) {
      await tx
        .updateTable('ntfb_category')
        .set({ deactivated_at: sql<Date>`now()`, updated_at: sql<Date>`now()` })
        .where('id', '=', id)
        .execute();
      return 'DEACTIVATED';
    }

    await tx.deleteFrom('ntfb_category').where('id', '=', id).execute();
    return 'DELETED';
  });
}

/** One function per entity, as build-plan D3 established. `category.ntfb_category_id`
 *  is the only table that references this one. */
export async function ntfbHasHistory(tx: Tx, id: string): Promise<boolean> {
  const mapped = await tx
    .selectFrom('category')
    .select('id')
    .where('ntfb_category_id', '=', id)
    .executeTakeFirst();
  return mapped !== undefined;
}

/** Every AGFP category and where it currently reports to — S3.1's mapping editor. */
export async function listMappings(): Promise<CategoryMapping[]> {
  const rows = await db
    .selectFrom('category')
    .leftJoin('ntfb_category', 'ntfb_category.id', 'category.ntfb_category_id')
    .select([
      'category.id as categoryId',
      'category.name as categoryName',
      'category.deactivated_at as categoryDeactivated',
      'category.ntfb_category_id as ntfbCategoryId',
      'ntfb_category.name as ntfbCategoryName',
      'category.ntfb_storage as storage',
    ])
    .orderBy('category.name')
    .execute();

  return rows.map((r) => ({
    categoryId: r.categoryId,
    categoryName: r.categoryName,
    categoryActive: r.categoryDeactivated === null,
    ntfbCategoryId: r.ntfbCategoryId,
    ntfbCategoryName: r.ntfbCategoryName,
    storage: r.storage,
  }));
}

/**
 * Point one AGFP category at an NTFB one, or clear it.
 *
 * A plain field edit, last write wins. Changing it **re-reports history**: every past
 * week's report is computed on read, so a remap changes what an already-exported week
 * would say if exported again. That is correct — the mapping is a statement about what
 * these categories *are*, not about one week — but it is worth knowing before someone
 * remaps mid-year (phase-3-state.md A181).
 */
export async function setMapping(
  categoryId: string,
  ntfbCategoryId: string | null,
  storage?: string | null,
): Promise<CategoryMapping[]> {
  await writeTransaction(async (tx) => {
    const category = await tx
      .selectFrom('category')
      .select('id')
      .where('id', '=', categoryId)
      .executeTakeFirst();
    if (!category) throw notFound('No such category.');

    if (ntfbCategoryId !== null) {
      const target = await tx
        .selectFrom('ntfb_category')
        .select('id')
        .where('id', '=', ntfbCategoryId)
        .where('deactivated_at', 'is', null)
        .executeTakeFirst();
      if (!target) throw badRequest('Pick a category that is still in use.');
    }

    // Clearing the target clears the storage with it: storage is the second half of a
    // Meal Connect line item, and a line item with no category is not one. Leaving a
    // stale `Frozen` behind would silently reattach it to whatever the category is
    // pointed at next.
    const nextStorage =
      ntfbCategoryId === null ? null : storage === undefined ? undefined : storage?.trim() || null;

    await tx
      .updateTable('category')
      .set({
        ntfb_category_id: ntfbCategoryId,
        ...(nextStorage !== undefined ? { ntfb_storage: nextStorage } : {}),
      })
      .where('id', '=', categoryId)
      .execute();
  });

  return listMappings();
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * The week as a Meal Connect worksheet.
 *
 * Refuses while any category carrying weight is unmapped — a short file that looks
 * complete is worse than no file, because the shortfall is invisible at the far end.
 *
 * The shape is driven by what Meal Connect actually turned out to be (`ExportRow`,
 * D13): a web form a person types receipts into, one receipt per `(pickup date,
 * donor)`, each holding line items of `Category · Storage · Pounds`. So the grain is
 * `day × donor × ntfb_category × storage`, and the ORDER is receipt order — day, then
 * store, then category. Sorting by category before donor, as this did while the format
 * was a guess, scatters one receipt's lines down the length of the file.
 */
export async function exportRows(anchor: string): Promise<{
  weekStart: string;
  weekEnd: string;
  rows: ExportRow[];
}> {
  const report = await weeklyReport(anchor);
  if (!report.readyToExport) throw conflict(EXPORT_BLOCKED_MESSAGE);

  const entries = await reportEntries(anchor);
  const mappings = await listMappings();
  const byCategory = new Map(mappings.map((m) => [m.categoryId, m]));

  interface Bucket {
    day: string;
    donor: string;
    donorCode: string;
    ntfbCategory: string;
    storage: string;
    agfpCategories: Set<string>;
    weights: string[];
  }

  // Still grouped rather than one row per entry (A180 — the food bank wants the day's
  // total from a store, not each time someone tapped Add), but now grouped to the LINE
  // ITEM: storage joins the key, because one NTFB bucket reached under two storage
  // requirements is two lines on the receipt.
  const grouped = new Map<string, Bucket>();

  for (const entry of entries) {
    if (!entry.reportable) continue; // report ≠ metrics (§6)
    const mapping = byCategory.get(entry.categoryId);
    const ntfbCategory = mapping?.ntfbCategoryName ?? '';
    const storage = mapping?.storage ?? '';
    const key = [entry.day, entry.donorName, ntfbCategory, storage].join(SEP);

    const bucket = grouped.get(key) ?? {
      day: entry.day,
      donor: entry.donorName,
      donorCode: entry.donorCode ?? '',
      ntfbCategory,
      storage,
      agfpCategories: new Set<string>(),
      weights: [],
    };
    // Several AGFP categories can collapse into one line item; all of them are named,
    // because this column is how a Reporter traces the line back to the pantry's own
    // sheets (Success Metric 4).
    bucket.agfpCategories.add(entry.categoryName);
    bucket.weights.push(entry.weight);
    grouped.set(key, bucket);
  }

  const lines = [...grouped.values()].sort(
    (a, b) =>
      a.day.localeCompare(b.day) ||
      a.donor.localeCompare(b.donor) ||
      a.ntfbCategory.localeCompare(b.ntfbCategory) ||
      a.storage.localeCompare(b.storage),
  );

  // A receipt is `(pickup date, donor)` — Meal Connect's own unit, and what its review
  // screen counts and totals back before Submit. Computed once per receipt and
  // repeated on each of its rows, so the file stays rectangular: subtotal rows would
  // break every spreadsheet that opens it, and this file exists to be read by a person
  // typing into a form.
  const receipts = new Map<string, { items: number; total: string }>();
  for (const line of lines) {
    const key = [line.day, line.donor].join(SEP);
    const receipt = receipts.get(key) ?? { items: 0, total: '0.00' };
    receipt.items += 1;
    receipt.total = addAll([receipt.total, addAll(line.weights)]);
    receipts.set(key, receipt);
  }

  const rows = lines.map((line) => {
    const receipt = receipts.get([line.day, line.donor].join(SEP))!;
    return {
      day: line.day,
      donor: line.donor,
      donorCode: line.donorCode,
      ntfbCategory: line.ntfbCategory,
      storage: line.storage,
      agfpCategory: [...line.agfpCategories].sort((a, b) => a.localeCompare(b)).join(', '),
      // NOT rounded to whole pounds: the sample receipt's integers were integer
      // inputs, and nothing observed says the form refuses a decimal. Rounding each
      // row would also put Σ rows a few pounds away from the week's own total
      // (phase-3-state.md A189).
      weightLb: addAll(line.weights),
      receiptItems: String(receipt.items),
      receiptTotal: receipt.total,
    };
  });

  return { weekStart: report.weekStart, weekEnd: report.weekEnd, rows };
}
