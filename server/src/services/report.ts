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
import { DONATION_ON_ROUTE_MESSAGE } from '../../../shared/src/donation.js';
import {
  ATTACH_ALREADY_MESSAGE,
  ATTACH_ANONYMOUS_MESSAGE,
  ATTACH_LABEL_NOTE_PREFIX,
  EXPORT_BLOCKED_MESSAGE,
  type CategoryMapping,
  type NtfbCategory,
  type Receipt,
  type ReceiptLine,
  type ReceiptNote,
  type ReceiptNoteRole,
  type ReportEntry,
  type ReportExport,
  type ReportLine,
  type UnmappedCategory,
  type UnreportedDonation,
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
// Whole pounds and the trash deduction (D27, D28 — which ANSWERS A189)
// ---------------------------------------------------------------------------
//
// A189 said, in as many words, that a human had to decide where the remainder goes
// before per-row rounding could be implemented, and until then the export carried
// decimals. The pantry decided: EVERY POUND ON THE RECEIPT IS A WHOLE NUMBER, and the
// receipt total is the sum of the rounded rows rather than the rounded sum. So the
// remainder does not go anywhere — it is dropped at the line, once, and the total is
// built back up from lines that already agree with what gets typed into the portal.
//
// THE DEDUCTION. A fraction of what comes off the truck is not fit to distribute. The
// pantry does not weigh it; they deduct a standing percentage from three categories and
// report the sum as NTFB's own `Trash`. Per receipt — `(pickup date, donor)`:
//
//     gross_S  = round(Σ reportable weight for this receipt in S)   S ∈ {BAKERY, PRODUCE, DELI}
//     rate_S   = donor.trash_rate_S ?? app_config.trash_rate_S
//     deduct_S = round(gross_S × rate_S)
//     net_S    = gross_S − deduct_S
//     trash    = Σ deduct_S                     → one synthetic (Trash, Dry) line
//
// THE ROUNDING ORDER IS LOAD-BEARING AND IS NOT A SIMPLIFICATION TO BE UNDONE. Round
// the gross to whole pounds FIRST, then compute and round the deduction, then subtract.
// One real Retail Rescue Log sheet reconciles to the pound under exactly that order —
// 827/3691/53 at 10/10/15% gives 83+369+8 = 460, the boxed Trash figure, and
// 744/3322/45 net — and under no other. Multiplying the raw decimal and rounding once
// at the end drifts, and then the pantry's paper and the pantry's app disagree about
// what was sent to the food bank.
//
// THE CONSERVATION PROPERTY, which is what makes this safe to add to a report that
// already reconciles:
//
//     net_bakery + net_produce + net_deli + trash == gross_bakery + gross_produce + gross_deli
//
// The deduction MOVES weight between reported categories; it never changes the reported
// total. `report-trash.test.ts` asserts it directly. An implementation that breaks it
// is wrong even if every individual figure looks plausible.

/** `numeric(8,2)` as exact integer cents — the same scaling `addAll` uses, and the
 *  reason neither of them ever writes `+` on a parsed float. */
function cents(value: string): number {
  return Math.round(Number(value) * 100);
}

/** Half-up, away from zero: 82.5 → 83, 7.95 → 8. What a person does with a pencil,
 *  and what the paper sheet's three deductions each require. */
function divideRoundHalfUp(numerator: number, denominator: number): number {
  const sign = numerator < 0 ? -1 : 1;
  return sign * Math.floor((Math.abs(numerator) + denominator / 2) / denominator);
}

/**
 * A weight to the nearest whole pound, as a string with no decimal part (`D28`).
 *
 * The one rounding helper in this file, imported rather than copied: there are already
 * three separate integer-cent implementations in this repo (here, `receive.ts`, and the
 * client's own `report.ts`) and a fourth that rounded differently would put the screen
 * and the printed receipt a pound apart with nothing to say which was right.
 */
export function roundPounds(value: string): string {
  return String(divideRoundHalfUp(cents(value), 100));
}

/** The three storage families the pantry deducts from — `category.trash_rate_key`
 *  (migration 0017), never a match on the literal category name. An admin may rename
 *  `Bakery` at any time (I21), and a name match would silently stop deducting. */
export type TrashRateKey = 'BAKERY' | 'PRODUCE' | 'DELI';
export const TRASH_RATE_KEYS: readonly TrashRateKey[] = ['BAKERY', 'PRODUCE', 'DELI'];

/**
 * `deduct_S` — one receipt's deduction for one storage family, in whole pounds.
 *
 * `grossPounds` must ALREADY be rounded; that ordering is the whole point (see above).
 * `rate` is `numeric(5,4)`, so 0.1000 is 10% — scaled to an exact integer count of
 * ten-thousandths before it is multiplied, for the same reason weights are scaled to
 * cents.
 */
export function trashDeduction(grossPounds: string, rate: string): string {
  const perTenThousand = Math.round(Number(rate) * 10000);
  return String(divideRoundHalfUp(Number(grossPounds) * perTenThousand, 10000));
}

/** Addition over values `roundPounds` produced: still whole, still exact. */
function addPounds(values: string[]): string {
  return String(values.reduce((acc, v) => acc + Number(v), 0));
}

/** A whole-pound string as the `numeric(8,2)`-shaped decimal string the rest of the
 *  report speaks (`"744"` → `"744.00"`), so `WeeklyReport` keeps one weight format. */
function asWeight(pounds: string): string {
  return addAll([pounds]);
}

// ---------------------------------------------------------------------------
// The window (D41 — a range, defaulting to this week)
// ---------------------------------------------------------------------------

/**
 * Resolve the Monday–Sunday week containing a date.
 *
 * Monday-start is not stated by any doc. It is the ISO week and the one a "weekly
 * report" is normally understood to mean; the pantry's own cycle is weekly per PRD §1
 * but its boundary is never named (phase-3-state.md A178).
 *
 * STILL THE DEFAULT AFTER D41, and now in three places rather than two: S3.1's report,
 * S1.2's board, and Admin metrics (D39, which answers A179). All three cut on this one
 * function or on its client mirror `app/week.ts`, so "this week" cannot mean two
 * different weeks on two screens an admin has open side by side.
 */
export function weekBounds(anchor: string): { weekStart: string; weekEnd: string } {
  const date = parseDate(anchor, 'week');
  const utc = new Date(Date.UTC(date.year, date.month - 1, date.day));
  // getUTCDay: 0 = Sunday. Shift so Monday is 0.
  const offset = (utc.getUTCDay() + 6) % 7;
  const start = addDays(date, -offset);
  return { weekStart: isoDate(start), weekEnd: isoDate(addDays(start, 6)) };
}

/** Today, pantry-local. */
export async function pantryToday(): Promise<string> {
  const { timezone } = await db
    .selectFrom('app_config')
    .select('timezone')
    .executeTakeFirstOrThrow();
  return isoDate(localCalendarDate(new Date(), timezone));
}

/** Today's week, pantry-local — the range the Reporter lands on with no dates chosen
 *  (D41), and the same one `services/metrics.ts` falls back to since D39. */
export async function currentWeek(): Promise<{ weekStart: string; weekEnd: string }> {
  return weekBounds(await pantryToday());
}

/**
 * The window a caller asked for, or this week when they asked for none (D41).
 *
 * Three inputs, in falling specificity: an explicit `from`/`to`; a `week` anchor,
 * which is still honoured so a bookmark saved before D41 resolves to the week it
 * always meant rather than 404ing on a parameter nobody sends any more; or nothing.
 *
 * A backwards range is REFUSED rather than swapped. Swapping would silently answer a
 * question nobody asked, and the one place a reporter can type these is two date
 * fields where getting them the wrong way round is a typo they can see.
 */
export async function resolveRange(input: {
  from?: string | undefined;
  to?: string | undefined;
  week?: string | undefined;
}): Promise<{ from: string; to: string }> {
  if (input.from !== undefined || input.to !== undefined) {
    const week = input.week !== undefined ? weekBounds(input.week) : null;
    const fallback = week ?? (await currentWeek());
    const from = input.from !== undefined
      ? isoDate(parseDate(input.from, 'from'))
      : fallback.weekStart;
    const to = input.to !== undefined ? isoDate(parseDate(input.to, 'to')) : fallback.weekEnd;
    if (from > to) throw badRequest('The first date has to be on or before the second.');
    return { from, to };
  }

  const { weekStart, weekEnd } =
    input.week !== undefined ? weekBounds(input.week) : await currentWeek();
  return { from: weekStart, to: weekEnd };
}

// ---------------------------------------------------------------------------
// The union, at receipt grain
// ---------------------------------------------------------------------------

/** One `(pickup date, donor, AGFP category, reportable)` bucket of the union. */
interface ReceiptIntakeRow {
  day: string;
  donorId: string | null;
  donorName: string;
  donorCode: string | null;
  /** The store's own overrides, `null` meaning "use the pantry default" (0017). A
   *  walk-in label has no donor row at all, so it takes the defaults too — which is
   *  correct, since there is no store to have negotiated an exception. */
  rateBakery: string | null;
  rateProduce: string | null;
  rateDeli: string | null;
  categoryId: string;
  categoryName: string;
  ntfbCategoryId: string | null;
  ntfbCategoryName: string | null;
  ntfbCode: string | null;
  /** The mapping's storage half (migration 0013). Carried from here to the report line
   *  and the receipt because it is half of what Meal Connect calls a line item. */
  storage: string | null;
  trashRateKey: TrashRateKey | null;
  total: string;
  reportable: boolean;
}

/**
 * Both halves of the union, at the grain a receipt is written in.
 *
 * Written as two independent queries UNIONed rather than as a join, because they share
 * no table: a weight's day comes from its shift, a donation's from its own column, and
 * the second half has no shift at all. Combining them with a join would require an
 * outer join on `shift` whose null branch is the walk-in case — the same result, one
 * `WHERE` away from silently dropping it.
 *
 * WHY THE GRAIN GOT FINER THAN THE REPORT NEEDS. The trash deduction is per receipt at
 * a per-store rate (D27), so `round(week gross × rate)` is NOT `Σ round(receipt gross ×
 * rate)` and only the second one reproduces the paper sheet. Both the screen and the
 * printed receipt therefore roll up from here rather than from two separate queries
 * free to disagree.
 */
async function intakeByReceipt(
  reader: Reader,
  from: string,
  to: string,
): Promise<ReceiptIntakeRow[]> {
  const rows = await sql<{
    day: string;
    donor_id: string | null;
    donor_name: string;
    donor_code: string | null;
    rate_bakery: string | null;
    rate_produce: string | null;
    rate_deli: string | null;
    category_id: string;
    category_name: string;
    ntfb_category_id: string | null;
    ntfb_category_name: string | null;
    ntfb_code: string | null;
    storage: string | null;
    trash_rate_key: TrashRateKey | null;
    total: string;
    reportable: boolean;
  }>`
    WITH intake AS (
      -- Planned. report_day = shift.occurrence_date, via join and never duplicated
      -- as a column (data-model.md §8, derived-vs-stored).
      SELECT to_char(s.occurrence_date, 'YYYY-MM-DD') AS day,
             we.donor_id,
             d.name                       AS donor_name,
             d.ntfb_donor_code            AS donor_code,
             d.trash_rate_bakery::text    AS rate_bakery,
             d.trash_rate_produce::text   AS rate_produce,
             d.trash_rate_deli::text      AS rate_deli,
             we.category_id,
             we.weight,
             TRUE AS reportable          -- I15: scheduled ⇒ reportable, no flag exists
      FROM weight_entry we
      JOIN shift s ON s.id = we.shift_id
      JOIN donor d ON d.id = we.donor_id
      WHERE we.voided = FALSE
        AND s.occurrence_date BETWEEN ${from}::date AND ${to}::date

      UNION ALL

      -- Unplanned. Its own date column, and NO join to shift — a walk-in has none,
      -- and joining would drop it (domain-modeling.md §6, stated explicitly).
      SELECT to_char(ud.received_date, 'YYYY-MM-DD') AS day,
             ud.donor_id,
             coalesce(d.name, ud.donor_label, 'Unattributed') AS donor_name,
             d.ntfb_donor_code            AS donor_code,
             d.trash_rate_bakery::text    AS rate_bakery,
             d.trash_rate_produce::text   AS rate_produce,
             d.trash_rate_deli::text      AS rate_deli,
             ud.category_id,
             ud.weight,
             ud.reportable
      FROM unscheduled_donation ud
      LEFT JOIN donor d ON d.id = ud.donor_id
      WHERE ud.status = 'CONFIRMED'
        AND ud.received_date BETWEEN ${from}::date AND ${to}::date
    )
    SELECT i.day,
           i.donor_id,
           i.donor_name,
           i.donor_code,
           i.rate_bakery,
           i.rate_produce,
           i.rate_deli,
           c.id                AS category_id,
           c.name              AS category_name,
           c.ntfb_category_id  AS ntfb_category_id,
           n.name              AS ntfb_category_name,
           n.code              AS ntfb_code,
           c.ntfb_storage      AS storage,
           c.trash_rate_key    AS trash_rate_key,
           sum(i.weight)::text AS total,
           i.reportable        AS reportable
    FROM intake i
    JOIN category c ON c.id = i.category_id
    LEFT JOIN ntfb_category n ON n.id = c.ntfb_category_id
    GROUP BY i.day, i.donor_id, i.donor_name, i.donor_code,
             i.rate_bakery, i.rate_produce, i.rate_deli,
             c.id, c.name, c.ntfb_category_id, n.name, n.code,
             c.ntfb_storage, c.trash_rate_key, i.reportable
    ORDER BY i.day, i.donor_name, c.name
  `.execute(reader);

  return rows.rows.map((r) => ({
    day: r.day,
    donorId: r.donor_id,
    donorName: r.donor_name,
    donorCode: r.donor_code,
    rateBakery: r.rate_bakery,
    rateProduce: r.rate_produce,
    rateDeli: r.rate_deli,
    categoryId: r.category_id,
    categoryName: r.category_name,
    ntfbCategoryId: r.ntfb_category_id,
    ntfbCategoryName: r.ntfb_category_name,
    ntfbCode: r.ntfb_code,
    storage: r.storage,
    trashRateKey: r.trash_rate_key,
    total: r.total,
    reportable: r.reportable,
  }));
}

// ---------------------------------------------------------------------------
// The computed week: rounding, then the deduction, then everything else
// ---------------------------------------------------------------------------

/** One reportable line of one receipt, already whole pounds and already net. */
interface ReceiptCategory {
  categoryId: string;
  categoryName: string;
  ntfbCategoryId: string | null;
  ntfbCategoryName: string | null;
  ntfbCode: string | null;
  storage: string | null;
  trashRateKey: TrashRateKey | null;
  /** Whole pounds AFTER the deduction — what the receipt prints and what rolls up. */
  pounds: string;
}

/** One receipt's Meal Connect check-off (D35, migration 0018), or `null` for one
 *  nobody has filed. Read at the same grain the receipt is written in, so a receipt
 *  carries its own submitted state rather than being stitched to one by the view. */
export interface ReceiptSubmissionRow {
  submittedAt: string;
  submittedBy: string;
}

interface ComputedReceipt {
  key: string;
  day: string;
  donorId: string | null;
  donorName: string;
  donorCode: string | null;
  /** D35. Always null for a walk-in label, which has no `donor` row to key on. */
  submitted: ReceiptSubmissionRow | null;
  /** Reportable only. Zero-pound lines are already dropped. */
  categories: ReceiptCategory[];
  /**
   * Whether ANY reportable row landed here, before the zero-pound filter below.
   *
   * Not the same as `categories.length > 0`, and the difference is the whole reason
   * it exists (D54, D56):
   *
   *   - A receipt whose only line rounds away to nothing still has reportable
   *     intake. It must keep its card, or the weight entry behind it has nowhere
   *     to be corrected from now that the drill-in is gone.
   *   - A receipt whose only intake is a walk-in somebody switched OFF has none. It
   *     is not in the reported union at all (§6), so a card would tell the food bank
   *     "No Pounds" about a store that was never on the route that day. Those rows
   *     reach the reporter through the export's `notReported` list instead (D56).
   */
  hasReportable: boolean;
  /** Σ of this receipt's three deductions, whole pounds. `'0'` when there are none. */
  trashPounds: string;
  /** Everything NOT reportable, rounded at the same grain. Feeds `intakeTotal` only —
   *  it never reaches a receipt, because `report ≠ metrics` (§6). */
  unreportablePounds: string;
}

/** Where the computed Trash line reports. Looked up, never assumed: an admin can
 *  rename or archive an NTFB category (I21) and a hard-coded id would outlive it. */
interface TrashTarget {
  id: string;
  name: string;
  code: string | null;
  storage: string;
}

async function trashTargetOf(reader: Reader): Promise<TrashTarget | null> {
  // Matched on NTFB's own name, which is the only handle the schema gives: `Trash` is
  // NTFB's vocabulary, seeded by 0016, and no column marks it. Storage comes from
  // whichever AGFP category maps there — the archived `Trash` category keeps its
  // mapping for exactly this reason — so an admin who edits it is honoured; `Dry` is
  // the seeded value and the fallback.
  const row = await sql<{ id: string; name: string; code: string | null; storage: string | null }>`
    SELECT n.id, n.name, n.code,
           (SELECT c.ntfb_storage
              FROM category c
             WHERE c.ntfb_category_id = n.id
               AND c.ntfb_storage IS NOT NULL
             ORDER BY c.deactivated_at NULLS FIRST, c.name
             LIMIT 1) AS storage
    FROM ntfb_category n
    WHERE lower(n.name) = 'trash'
      AND n.deactivated_at IS NULL
    LIMIT 1
  `.execute(reader);

  const found = row.rows[0];
  if (!found) return null;
  return { id: found.id, name: found.name, code: found.code, storage: found.storage ?? 'Dry' };
}

/**
 * Every check-off in the window, keyed the way a receipt is (D35).
 *
 * ONE READ, INSIDE `computeRange`, and that placement is the whole point. `computeWeek`
 * was unified last round precisely so the screen's totals and the printed receipts
 * could not be two independent re-sums; adding a second query that the VIEW stitched
 * onto the receipts would put the same seam back one layer up, where a receipt could
 * render as filed while the card beside it disagreed. A receipt carries its own
 * submitted state or nothing does.
 *
 * `donor_id` is NOT NULL on the table, so a walk-in label never matches — which is
 * correct rather than a gap: there is no store for Meal Connect to be pointed at
 * either (migration 0018).
 */
async function submissionsByReceipt(
  reader: Reader,
  from: string,
  to: string,
): Promise<Map<string, ReceiptSubmissionRow>> {
  const rows = await sql<{
    day: string;
    donor_id: string;
    donor_name: string;
    submitted_at: Date;
    submitted_by: string;
  }>`
    SELECT to_char(mcs.pickup_date, 'YYYY-MM-DD')            AS day,
           mcs.donor_id                                      AS donor_id,
           d.name                                            AS donor_name,
           mcs.submitted_at                                  AS submitted_at,
           concat_ws(' ', u.first_name, u.last_name)         AS submitted_by
    FROM meal_connect_submission mcs
    JOIN donor d    ON d.id = mcs.donor_id
    JOIN app_user u ON u.id = mcs.submitted_by
    WHERE mcs.pickup_date BETWEEN ${from}::date AND ${to}::date
  `.execute(reader);

  return new Map(
    rows.rows.map((r) => [
      receiptKey(r.day, r.donor_id, r.donor_name),
      { submittedAt: r.submitted_at.toISOString(), submittedBy: r.submitted_by },
    ]),
  );
}

function receiptKey(day: string, donorId: string | null, donorName: string): string {
  // A free-text walk-in label and the anonymous bucket both have a null donor id, so
  // the name is what keeps two of them apart — and `SEP` is what keeps `"Kroger" +
  // "Elm St"` from colliding with `"Kroger Elm" + "St"`.
  return [day, donorId ?? `label${SEP}${donorName}`].join(SEP);
}

/**
 * The RANGE, rounded to whole pounds and with the trash deduction applied — the ONE
 * place either of those happens.
 *
 * `weeklyReport()` and the receipt payload are two different shapes of this same
 * result. They used to be two independent re-sums, which is exactly the arrangement
 * that lets the screen and the printed sheet disagree about what was sent to the food
 * bank; there is no version of "both must apply the deduction" stronger than one
 * implementation.
 *
 * D41 WIDENED THE WINDOW AND CHANGED NOTHING ELSE, which is the reason it was cheap:
 * the two things that could have depended on seven days do not. `D28`'s rounding is
 * per RECEIPT LINE and `D27`'s deduction is per RECEIPT, both keyed `(pickup date,
 * donor)` — so a fortnight is more receipts, each computed exactly as it was, and the
 * conservation property `net + trash == gross` holds per receipt and therefore over
 * any set of them. `report-trash.test.ts` asserts that directly, over a range.
 */
async function computeRange(from: string, to: string): Promise<{
  from: string;
  to: string;
  receipts: ComputedReceipt[];
  trashTarget: TrashTarget | null;
  submissions: Map<string, ReceiptSubmissionRow>;
}> {
  const rows = await intakeByReceipt(db, from, to);
  const submissions = await submissionsByReceipt(db, from, to);

  const config = await db
    .selectFrom('app_config')
    .select([
      sql<string>`trash_rate_bakery::text`.as('bakery'),
      sql<string>`trash_rate_produce::text`.as('produce'),
      sql<string>`trash_rate_deli::text`.as('deli'),
    ])
    .executeTakeFirstOrThrow();

  const trashTarget = await trashTargetOf(db);

  const receipts = new Map<string, ComputedReceipt>();
  const rates = new Map<string, Record<TrashRateKey, string>>();

  for (const row of rows) {
    const key = receiptKey(row.day, row.donorId, row.donorName);
    let receipt = receipts.get(key);
    if (!receipt) {
      receipt = {
        key,
        day: row.day,
        donorId: row.donorId,
        donorName: row.donorName,
        donorCode: row.donorCode,
        submitted: submissions.get(key) ?? null,
        categories: [],
        hasReportable: false,
        trashPounds: '0',
        unreportablePounds: '0',
      };
      receipts.set(key, receipt);
      rates.set(key, {
        BAKERY: row.rateBakery ?? config.bakery,
        PRODUCE: row.rateProduce ?? config.produce,
        DELI: row.rateDeli ?? config.deli,
      });
    }

    // ROUND FIRST. Every figure downstream — the deduction, the line, the receipt
    // total, the week — is built from this one number (D28, answering A189).
    const pounds = roundPounds(row.total);

    if (!row.reportable) {
      receipt.unreportablePounds = addPounds([receipt.unreportablePounds, pounds]);
      continue;
    }

    receipt.hasReportable = true;
    receipt.categories.push({
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      ntfbCategoryId: row.ntfbCategoryId,
      ntfbCategoryName: row.ntfbCategoryName,
      ntfbCode: row.ntfbCode,
      storage: row.storage,
      trashRateKey: row.trashRateKey,
      pounds,
    });
  }

  for (const receipt of receipts.values()) {
    // NO TRASH BUCKET, NO DEDUCTION. Without an NTFB category to report the deduction
    // INTO, subtracting it would delete pounds from the report rather than move them —
    // the one outcome worse than not deducting at all. Conservation still holds,
    // trivially, because nothing moved.
    if (trashTarget === null) continue;

    const rate = rates.get(receipt.key)!;
    let trash = 0;

    for (const key of TRASH_RATE_KEYS) {
      const group = receipt.categories.filter((c) => c.trashRateKey === key);
      if (group.length === 0) continue;

      // `uq_category_trash_key` (0017) allows at most ONE ACTIVE category per key, so
      // this group is normally one line and `gross` is exactly `round(Σ raw)` as the
      // formula states. The loop is for the replacement case — an archived `Bakery`
      // still carrying weight beside its successor — where the deduction comes off the
      // largest line first rather than being split into fractions the sheet has no
      // column for.
      const gross = addPounds(group.map((c) => c.pounds));
      const deduct = trashDeduction(gross, rate[key]);
      if (deduct === '0') continue;

      let remaining = Number(deduct);
      for (const line of [...group].sort((a, b) => Number(b.pounds) - Number(a.pounds))) {
        const take = Math.min(remaining, Number(line.pounds));
        line.pounds = String(Number(line.pounds) - take);
        remaining -= take;
        if (remaining === 0) break;
      }
      trash += Number(deduct);
    }

    receipt.trashPounds = String(trash);
    // A line that rounds away to nothing is not typed into the portal, so it is not a
    // line. It cannot resurface in a total either — every total below is built from
    // what survives this filter.
    receipt.categories = receipt.categories
      .filter((c) => c.pounds !== '0')
      .sort(
        (a, b) =>
          (a.ntfbCategoryName ?? '').localeCompare(b.ntfbCategoryName ?? '') ||
          (a.storage ?? '').localeCompare(b.storage ?? '') ||
          a.categoryName.localeCompare(b.categoryName),
      );
  }

  const ordered = [...receipts.values()].sort(
    (a, b) => a.day.localeCompare(b.day) || a.donorName.localeCompare(b.donorName),
  );

  // The map is returned as well as applied, because a receipt that produced NO intake
  // at all — a skipped stop, a run nobody worked (D29) — has no row here to hang it
  // on and is built in `exportReceipts` from `pickupContext` instead. It reads this
  // same map rather than issuing a second query of its own.
  return { from, to, receipts: ordered, trashTarget, submissions };
}

/**
 * The range as S3.1 renders it (D41 — a week by default, and no longer only a week).
 *
 * `lines` roll AGFP categories into their NTFB bucket and carry only the reportable
 * half. `intakeTotal` counts everything, reportable or not, which is what keeps
 * "intake ≠ NTFB-reported" visible on the screen that most tempts someone to conflate
 * them (PRD §3).
 *
 * Every weight here is a whole number of pounds, aggregated from the per-receipt lines
 * `computeRange()` already rounded and already deducted (D27, D28). Applying the
 * deduction only while building `lines` would have left `reportedTotal` gross, because
 * it is deliberately NOT Σ`lines` — see below.
 */
export async function weeklyReport(from: string, to: string): Promise<WeeklyReport> {
  const { receipts, trashTarget } = await computeRange(from, to);

  const byNtfb = new Map<string, ReportLine>();
  /** Whole pounds per line and per unmapped category, converted to the report's decimal
   *  string only at the end. Accumulating in `"744.00"` and re-parsing each time would
   *  round-trip through `Number` on every row for no reason. */
  const linePounds = new Map<string, string>();
  const unmappedPounds = new Map<string, { categoryName: string; pounds: string }>();
  const perLineCategories = new Map<string, Map<string, { categoryName: string; pounds: string }>>();
  let trashPounds = '0';
  let reportedPounds = '0';
  let unreportablePounds = '0';

  for (const receipt of receipts) {
    trashPounds = addPounds([trashPounds, receipt.trashPounds]);
    reportedPounds = addPounds([reportedPounds, receipt.trashPounds]);
    unreportablePounds = addPounds([unreportablePounds, receipt.unreportablePounds]);

    for (const row of receipt.categories) {
      reportedPounds = addPounds([reportedPounds, row.pounds]);

      if (row.ntfbCategoryId === null || row.ntfbCategoryName === null) {
        // Surfaced, never dropped. Dropping it would understate the report by exactly
        // the amount nobody noticed — the "lost-sheet misreporting" failure mode.
        const existing = unmappedPounds.get(row.categoryId);
        unmappedPounds.set(row.categoryId, {
          categoryName: row.categoryName,
          pounds: addPounds([existing?.pounds ?? '0', row.pounds]),
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
        linePounds.set(key, '0');
        perLineCategories.set(key, new Map());
      }
      const contributors = perLineCategories.get(key)!;
      const seen = contributors.get(row.categoryId);
      contributors.set(row.categoryId, {
        categoryName: row.categoryName,
        pounds: addPounds([seen?.pounds ?? '0', row.pounds]),
      });
      linePounds.set(key, addPounds([linePounds.get(key)!, row.pounds]));
    }
  }

  for (const [key, line] of byNtfb) {
    line.total = asWeight(linePounds.get(key)!);
    line.agfpCategories = [...perLineCategories.get(key)!]
      .map(([categoryId, c]) => ({
        categoryId,
        categoryName: c.categoryName,
        total: asWeight(c.pounds),
      }))
      .sort((a, b) => a.categoryName.localeCompare(b.categoryName));
  }

  const lines = [...byNtfb.values()].sort(
    (a, b) =>
      a.ntfbCategoryName.localeCompare(b.ntfbCategoryName) ||
      (a.storage ?? '').localeCompare(b.storage ?? ''),
  );

  // The synthetic Trash line (D27). Nothing was ever weighed into it — the AGFP `Trash`
  // category is archived by 0016 precisely so nobody can — so it carries no
  // `agfpCategories` and has no drill-in. It is a REPORTED line like any other, which
  // is the whole reason the deduction is safe: it moves weight between reported
  // categories rather than out of the report.
  if (trashTarget !== null && trashPounds !== '0') {
    lines.push({
      ntfbCategoryId: trashTarget.id,
      ntfbCategoryName: trashTarget.name,
      ntfbCode: trashTarget.code,
      storage: trashTarget.storage,
      agfpCategories: [],
      total: asWeight(trashPounds),
      computed: true,
    });
  }

  const unmapped: UnmappedCategory[] = [...unmappedPounds]
    .map(([categoryId, c]) => ({
      categoryId,
      categoryName: c.categoryName,
      total: asWeight(c.pounds),
    }))
    .sort((a, b) => a.categoryName.localeCompare(b.categoryName));

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
  //
  // It now sums the ROUNDED, POST-DEDUCTION lines plus the trash, rather than the raw
  // rows. Summing the raw rows would leave this figure gross while every line under it
  // was net — the two would differ by the deduction and nothing on the screen would
  // say why.
  const reportedTotal = asWeight(reportedPounds);
  const intakeTotal = asWeight(addPounds([reportedPounds, unreportablePounds]));

  const openRuns = await db
    .selectFrom('shift')
    .innerJoin('route', 'route.id', 'shift.route_id')
    .select([
      'shift.id as shiftId',
      'route.name as routeName',
      sql<string>`to_char(shift.occurrence_date, 'YYYY-MM-DD')`.as('occurrenceDate'),
      'shift.status as status',
    ])
    .where(sql<boolean>`shift.occurrence_date BETWEEN ${from}::date AND ${to}::date`)
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
    from,
    to,
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
 * Scoped by the same range the report was computed over (D41) and optionally by AGFP
 * category. Both halves of the union again, and again the donation half never touches
 * `shift`.
 */
export async function reportEntries(
  from: string,
  to: string,
  options: { categoryId?: string } = {},
): Promise<ReportEntry[]> {
  const categoryFilter = options.categoryId ?? null;

  const rows = await sql<{
    id: string;
    kind: 'WEIGHT' | 'DONATION';
    day: string;
    donor_id: string | null;
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
           -- (day, donor_id) is the RECEIPT's key (D55). Selected here so S3.1 can
           -- put an entry under the card it belongs to rather than matching a name.
           we.donor_id                                     AS donor_id,
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
      AND s.occurrence_date BETWEEN ${from}::date AND ${to}::date
      AND (${categoryFilter}::uuid IS NULL OR we.category_id = ${categoryFilter}::uuid)

    UNION ALL

    SELECT ud.id,
           'DONATION'                                      AS kind,
           to_char(ud.received_date, 'YYYY-MM-DD')         AS day,
           ud.donor_id                                     AS donor_id,
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
      AND ud.received_date BETWEEN ${from}::date AND ${to}::date
      AND (${categoryFilter}::uuid IS NULL OR ud.category_id = ${categoryFilter}::uuid)

    ORDER BY day, donor_name
  `.execute(db);

  return rows.rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    day: r.day,
    donorId: r.donor_id,
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
  range: { from: string; to: string },
): Promise<ReportEntry[]> {
  const weight = parseWeight(input.weight);

  const categoryId = await writeTransaction(async (tx) => {
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

    return existing.categoryId;
  });

  // The panel the Reporter is looking at, re-read: the RANGE they are reporting on
  // (D41) narrowed to the one category the drill-in is open on. It used to return the
  // whole week across every category, which the drill-in then rendered under one
  // category's heading — a defect the widened signature made visible rather than
  // introduced, since the category is on the row being edited and was always known.
  return reportEntries(range.from, range.to, { categoryId });
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
// Export — the Meal Connect receipt (D29, superseding D13's worksheet)
// ---------------------------------------------------------------------------

/**
 * One `(day, donor)` pickup as the run itself recorded it, plus the three notes that
 * hang off a shift.
 *
 * This is the half of the receipt that has nothing to do with weight, and it is why the
 * type exists: a stop the driver skipped and a run nobody ever worked produced NO export
 * row at all, so those pickups were invisible to the food bank. Meal Connect has a
 * checkbox for each of them.
 */
interface StopContextRow {
  day: string;
  donorId: string;
  donorName: string;
  donorCode: string | null;
  disposition: string;
  /** `MISSED` — derived, never stored (I7): the window passed with the shift still
   *  `OPEN` (nobody took it) or `CLAIMED` (someone committed and flaked). */
  missed: boolean;
  stopNote: string | null;
  shiftId: string;
  runNote: string | null;
  staffNote: string | null;
  ownerName: string | null;
}

async function pickupContext(
  reader: Reader,
  from: string,
  to: string,
): Promise<StopContextRow[]> {
  const rows = await sql<{
    day: string;
    donor_id: string;
    donor_name: string;
    donor_code: string | null;
    disposition: string;
    missed: boolean;
    stop_note: string | null;
    shift_id: string;
    run_note: string | null;
    staff_note: string | null;
    owner_name: string | null;
  }>`
    -- Runs that were WORKED. ShiftStop is the frozen per-shift snapshot (I5), so it
    -- is the only honest record of what the driver found. REASSIGNED stops are
    -- excluded: the food was collected on the destination shift (I30) and that shift
    -- issues the receipt — counting it here would report the same pickup twice, once
    -- as weight and once as a not-attempt. CANCELLED runs are excluded too; a
    -- cancelled run is a decision, not a pickup that failed.
    SELECT to_char(s.occurrence_date, 'YYYY-MM-DD')        AS day,
           ss.donor_id                                     AS donor_id,
           d.name                                          AS donor_name,
           d.ntfb_donor_code                               AS donor_code,
           ss.disposition::text                            AS disposition,
           FALSE                                           AS missed,
           ss.note                                         AS stop_note,
           s.id                                            AS shift_id,
           s.note                                          AS run_note,
           s.staff_note                                    AS staff_note,
           nullif(concat_ws(' ', u.first_name, u.last_name), '') AS owner_name
    FROM shift_stop ss
    JOIN shift s      ON s.id = ss.shift_id
    JOIN donor d      ON d.id = ss.donor_id
    LEFT JOIN app_user u ON u.id = s.owner_id
    WHERE s.occurrence_date BETWEEN ${from}::date AND ${to}::date
      AND s.status <> 'CANCELLED'
      AND ss.disposition <> 'REASSIGNED'

    UNION ALL

    -- Runs NOBODY EVER WORKED. A missed run has no ShiftStop rows at all — the
    -- snapshot is taken at CLAIMED → IN_PROGRESS and that transition never happened —
    -- so the stores that were due come from the Route the shift was bound to at
    -- schedule time (I4). Without this branch the whole run is silently absent from
    -- the week, which is the single largest hole this export had.
    SELECT to_char(s.occurrence_date, 'YYYY-MM-DD'),
           rs.donor_id,
           d.name,
           d.ntfb_donor_code,
           'PENDING'::text,
           TRUE,
           NULL::text,
           s.id,
           s.note,
           s.staff_note,
           nullif(concat_ws(' ', u.first_name, u.last_name), '')
    FROM shift s
    JOIN route_stop rs ON rs.route_id = s.route_id
    JOIN donor d       ON d.id = rs.donor_id
    LEFT JOIN app_user u ON u.id = s.owner_id
    WHERE s.occurrence_date BETWEEN ${from}::date AND ${to}::date
      AND s.status IN ('OPEN', 'CLAIMED')
      AND s.ends_at < now()
  `.execute(reader);

  return rows.rows.map((r) => ({
    day: r.day,
    donorId: r.donor_id,
    donorName: r.donor_name,
    donorCode: r.donor_code,
    disposition: r.disposition,
    missed: r.missed,
    stopNote: r.stop_note,
    shiftId: r.shift_id,
    runNote: r.run_note,
    staffNote: r.staff_note,
    ownerName: r.owner_name,
  }));
}

/** The two intake tables' own notes, with who wrote them (I26). */
interface IntakeNoteRow {
  day: string;
  donorId: string | null;
  donorName: string;
  role: 'RECEIVER' | 'DONATION';
  author: string | null;
  text: string;
}

async function intakeNotes(reader: Reader, from: string, to: string): Promise<IntakeNoteRow[]> {
  const rows = await sql<{
    day: string;
    donor_id: string | null;
    donor_name: string;
    role: 'RECEIVER' | 'DONATION';
    author: string | null;
    text: string;
  }>`
    SELECT to_char(s.occurrence_date, 'YYYY-MM-DD')        AS day,
           we.donor_id                                     AS donor_id,
           d.name                                          AS donor_name,
           'RECEIVER'                                      AS role,
           nullif(concat_ws(' ', u.first_name, u.last_name), '') AS author,
           we.note                                         AS text
    FROM weight_entry we
    JOIN shift s     ON s.id = we.shift_id
    JOIN donor d     ON d.id = we.donor_id
    JOIN app_user u  ON u.id = we.created_by
    WHERE we.voided = FALSE
      AND we.note IS NOT NULL AND btrim(we.note) <> ''
      AND s.occurrence_date BETWEEN ${from}::date AND ${to}::date

    UNION ALL

    SELECT to_char(ud.received_date, 'YYYY-MM-DD'),
           ud.donor_id,
           coalesce(d.name, ud.donor_label, 'Unattributed'),
           'DONATION',
           nullif(concat_ws(' ', u.first_name, u.last_name), ''),
           ud.note
    FROM unscheduled_donation ud
    LEFT JOIN donor d ON d.id = ud.donor_id
    JOIN app_user u   ON u.id = ud.created_by
    WHERE ud.status = 'CONFIRMED'
      AND ud.note IS NOT NULL AND btrim(ud.note) <> ''
      AND ud.received_date BETWEEN ${from}::date AND ${to}::date
  `.execute(reader);

  return rows.rows.map((r) => ({
    day: r.day,
    donorId: r.donor_id,
    donorName: r.donor_name,
    role: r.role,
    author: r.author,
    text: r.text,
  }));
}

/** Reading order on the card: the instruction, then the run, then the store, then the
 *  scale. Not an importance ranking — the reporter judges that, which is the point. */
const NOTE_ORDER: Record<ReceiptNoteRole, number> = {
  COORDINATOR: 0,
  DRIVER: 1,
  STOP: 2,
  RECEIVER: 3,
  DONATION: 4,
};

/**
 * The confirmed walk-ins the pantry decided NOT to report (D56).
 *
 * OUTSIDE THE UNION, AND THAT IS THE POINT. `domain-modeling.md §6` (locked) defines
 * the report as `WeightEntry[!voided] ∪ UnscheduledDonation[CONFIRMED ∧ reportable]`,
 * so these rows reach no line, no total and no receipt. Before D56 that also meant
 * they reached no SCREEN: there was nothing on S3.1 for a reporter to flip, and the
 * only way to turn one back on was a drill-in they never opened.
 *
 * So they travel BESIDE the receipts rather than among them. Folding them in would put
 * unreported weight on a Meal Connect submission and break the conservation property
 * D27 rests on — `net + trash == gross` over the reported set. Flipping one on moves
 * it into the union on the next read, which is the only way it should ever move.
 *
 * `can_report` is I16(b) answered here rather than in the browser: `CONFIRMED ∧
 * reportable=true ⇒ source non-null`, enforced in `setReportable` and reported here so
 * the row can say why instead of offering a control that would 400.
 *
 * The weight is the RAW decimal. D28's whole-pound rounding is a property of a receipt
 * line, and nothing here is one.
 */
async function unreportedDonations(
  reader: Reader,
  from: string,
  to: string,
): Promise<UnreportedDonation[]> {
  const rows = await sql<{
    id: string;
    received_date: string;
    donor_id: string | null;
    donor_label: string | null;
    donor_name: string;
    category_name: string;
    weight: string;
    receiver_name: string;
    note: string | null;
  }>`
    SELECT ud.id,
           to_char(ud.received_date, 'YYYY-MM-DD')          AS received_date,
           ud.donor_id,
           ud.donor_label,
           coalesce(d.name, ud.donor_label, 'Unattributed') AS donor_name,
           c.name                                           AS category_name,
           ud.weight::text                                  AS weight,
           concat_ws(' ', u.first_name, u.last_name)        AS receiver_name,
           ud.note
    FROM unscheduled_donation ud
    LEFT JOIN donor d  ON d.id = ud.donor_id
    JOIN category c    ON c.id = ud.category_id
    JOIN app_user u    ON u.id = ud.created_by
    WHERE ud.status = 'CONFIRMED'
      AND ud.reportable = FALSE
      AND ud.received_date BETWEEN ${from}::date AND ${to}::date
    ORDER BY ud.received_date, donor_name, c.name
  `.execute(reader);

  return rows.rows.map((r) => ({
    id: r.id,
    receivedDate: r.received_date,
    donorName: r.donor_name,
    categoryName: r.category_name,
    weight: r.weight,
    receiverName: r.receiver_name,
    note: r.note,
    // I16(b), the same predicate `requireSourceWhenReportable` applies on the write.
    canReport: r.donor_id !== null || r.donor_label !== null,
  }));
}

/**
 * The label-only walk-ins in the range, keyed the way a receipt is (D72).
 *
 * `donor_id IS NULL AND donor_label IS NOT NULL` is exactly the row `I16(b)` accepts
 * as a source and Meal Connect's own donor picker cannot be pointed at — reportable,
 * carrying real weight, and unfileable forever unless somebody re-points it. The
 * anonymous bucket is excluded on purpose: it has no name to re-point, and a receipt
 * is never built from one anyway (it has no reportable intake, so `exportReceipts`
 * drops the draft).
 *
 * A read, not a write. `attachDonorToDonations` is the write, and it re-checks
 * everything below inside its own transaction rather than trusting this.
 */
async function labelDonationsByReceipt(
  reader: Reader,
  from: string,
  to: string,
): Promise<Map<string, string[]>> {
  const rows = await sql<{ id: string; day: string; donor_label: string }>`
    SELECT ud.id,
           to_char(ud.received_date, 'YYYY-MM-DD') AS day,
           ud.donor_label                          AS donor_label
    FROM unscheduled_donation ud
    WHERE ud.status = 'CONFIRMED'
      AND ud.donor_id IS NULL
      AND ud.donor_label IS NOT NULL
      AND ud.received_date BETWEEN ${from}::date AND ${to}::date
    ORDER BY ud.received_date, ud.donor_label, ud.id
  `.execute(reader);

  const byKey = new Map<string, string[]>();
  for (const row of rows.rows) {
    // The same key `intakeByReceipt` groups on: `coalesce(d.name, ud.donor_label, …)`
    // IS the label when the donor is null, so the two agree by construction.
    const key = receiptKey(row.day, null, row.donor_label);
    const ids = byKey.get(key);
    if (ids) ids.push(row.id);
    else byKey.set(key, [row.id]);
  }
  return byKey;
}

interface ReceiptDraft {
  key: string;
  pickupDate: string;
  /** Null for a free-text walk-in label, which has no `donor` row — and therefore no
   *  check-off either (D35, migration 0018). */
  donorId: string | null;
  donorName: string;
  donorCode: string | null;
  submitted: ReceiptSubmissionRow | null;
  lines: ReceiptLine[];
  /** The driver drove past, or the receiver found nothing there. */
  skipped: boolean;
  missed: boolean;
  /** A stop was scheduled for this store on this day. */
  hasStop: boolean;
  /** Somebody recorded intake against it, even if it rounded to nothing. */
  hasIntake: boolean;
  notes: ReceiptNote[];
  /** Shift-level notes repeat on every stop of the run; keyed so they land once. */
  seenShiftNotes: Set<string>;
}

/**
 * The week as Meal Connect receipts — one card per `(pickup date, donor)` (D29).
 *
 * Refuses while any category carrying weight is unmapped — a short submission that
 * looks complete is worse than none, because the shortfall is invisible at the far end.
 * The seed satisfies that guard on a fresh database (D26), but an admin can still unmap
 * a category, so the guard stays.
 *
 * WHAT THE PORTAL ACTUALLY IS (D13, still standing): three web screens with no import.
 * A receipt names a date and a donor, ticks two checkboxes, then lists line items of
 * `Category · Storage · Description · Pounds`, and finishes with `Number of Items` and
 * `Total Pounds`. So this is a printable mimic of that form and not a file — one card
 * read top to bottom while typing.
 *
 * Three things are deliberate and each of them was a bug in the worksheet it replaces:
 *
 *   1. **One line per AGFP category, never merged.** Deli and Frz Non Meat both report
 *      as `Prepared Meal / Frozen` (0016), and the sample receipt carries two separate
 *      `Prepared Meals` rows because that is what the portal took.
 *   2. **No Description.** The portal has the field; it is the reporter's own free text
 *      for NTFB and not ours to invent.
 *   3. **Pickups that produced nothing still get a receipt.** A skipped stop and a run
 *      nobody worked emitted no row at all, so the food bank never learned they were
 *      attempted. The checkboxes are computed and the reason goes in `notes`.
 */
export async function exportReceipts(from: string, to: string): Promise<ReportExport> {
  const report = await weeklyReport(from, to);
  if (!report.readyToExport) throw conflict(EXPORT_BLOCKED_MESSAGE);

  // The same computation the screen just rolled up, at the grain the portal is typed
  // in — NOT a second, independent re-sum. Two re-sums is how the screen and the
  // printed receipt come to disagree by a pound with nothing to say which is right.
  const { receipts: computed, trashTarget, submissions } = await computeRange(from, to);
  const context = await pickupContext(db, from, to);
  const notes = await intakeNotes(db, from, to);
  // Beside the receipts, never among them (D56). See `unreportedDonations`.
  const notReported = await unreportedDonations(db, from, to);
  // D72 — which donations a label-only card is made of, so it can be pointed at a
  // real store in one action.
  const labelDonations = await labelDonationsByReceipt(db, from, to);

  const drafts = new Map<string, ReceiptDraft>();

  const draftFor = (
    key: string,
    pickupDate: string,
    donorId: string | null,
    donorName: string,
    donorCode: string | null,
  ): ReceiptDraft => {
    let draft = drafts.get(key);
    if (!draft) {
      draft = {
        key,
        pickupDate,
        donorId,
        donorName,
        donorCode,
        // D35 — read from the map `computeRange` already built, so a receipt with no
        // intake at all (a skipped stop, a run nobody worked) carries its check-off
        // from the same source as one that has weight on it.
        submitted: submissions.get(key) ?? null,
        lines: [],
        skipped: false,
        missed: false,
        hasStop: false,
        hasIntake: false,
        notes: [],
        seenShiftNotes: new Set(),
      };
      drafts.set(key, draft);
    }
    // A stop knows the store's NTFB number even when the range's only intake was a
    // free-text walk-in; whichever source has it wins. Same for the donor id, which
    // the walk-in half of the union does not have.
    draft.donorCode ??= donorCode;
    draft.donorId ??= donorId;
    return draft;
  };

  for (const receipt of computed) {
    const draft = draftFor(
      receipt.key,
      receipt.day,
      receipt.donorId,
      receipt.donorName,
      receipt.donorCode,
    );
    // REPORTABLE intake, not intake (D56). A `(date, donor)` whose only intake is a
    // walk-in somebody switched off is outside the reported union entirely, so a
    // card for it would file "No Pounds" on a store that was never on the route that
    // day — the exact thing the drop below exists to prevent. It is not lost: the
    // reporter reaches it through `notReported`, and can put it back in the report
    // from there. A store that ALSO has weighed intake keeps its card either way.
    draft.hasIntake ||= receipt.hasReportable;
    for (const row of receipt.categories) {
      draft.lines.push({
        ntfbCategory: row.ntfbCategoryName ?? '',
        storage: row.storage ?? '',
        pounds: row.pounds,
        agfpCategory: row.categoryName,
        computed: false,
      });
    }
    if (trashTarget !== null && receipt.trashPounds !== '0') {
      draft.lines.push({
        ntfbCategory: trashTarget.name,
        storage: trashTarget.storage,
        pounds: receipt.trashPounds,
        // Nothing was weighed into it — it is the deduction off this receipt's own
        // Bakery, Produce and Deli (D27), and the screen marks it so nobody hunts for
        // the pallet it came from.
        agfpCategory: '',
        computed: true,
      });
    }
  }

  for (const row of context) {
    const key = receiptKey(row.day, row.donorId, row.donorName);
    const draft = draftFor(key, row.day, row.donorId, row.donorName, row.donorCode);
    draft.hasStop = true;
    if (row.disposition === 'SKIPPED') draft.skipped = true;
    if (row.missed) draft.missed = true;

    // Shift-level notes are written once and read at every stop of the run, so they are
    // keyed on the shift rather than appended per stop.
    if (row.staffNote !== null && row.staffNote.trim() !== '') {
      const seen = `${row.shiftId}${SEP}COORDINATOR`;
      if (!draft.seenShiftNotes.has(seen)) {
        draft.seenShiftNotes.add(seen);
        // No author: `staff_note` records none, and reading one off `updated_by` would
        // name whoever last touched any field on the shift (I26 is last-writer only).
        draft.notes.push({ role: 'COORDINATOR', author: null, text: row.staffNote.trim() });
      }
    }
    if (row.runNote !== null && row.runNote.trim() !== '') {
      const seen = `${row.shiftId}${SEP}DRIVER`;
      if (!draft.seenShiftNotes.has(seen)) {
        draft.seenShiftNotes.add(seen);
        draft.notes.push({ role: 'DRIVER', author: row.ownerName, text: row.runNote.trim() });
      }
    }
    if (row.stopNote !== null && row.stopNote.trim() !== '') {
      draft.notes.push({ role: 'STOP', author: row.ownerName, text: row.stopNote.trim() });
    }
  }

  for (const note of notes) {
    const key = receiptKey(note.day, note.donorId, note.donorName);
    const draft = drafts.get(key);
    // Only onto a receipt that exists. A note on a week's worth of intake nobody is
    // reporting has nowhere to go, and inventing a receipt to carry it would tell the
    // food bank about a pickup that is not theirs.
    if (!draft) continue;
    draft.notes.push({ role: note.role, author: note.author, text: note.text.trim() });
  }

  const receipts: Receipt[] = [];

  for (const draft of drafts.values()) {
    const totalPounds = addPounds(draft.lines.map((l) => l.pounds));

    // The two checkboxes, in the order the portal reads them. Both are computed and
    // both are only reachable when the receipt came to nothing — a store that was
    // skipped on the run but walked food in the same day has pounds, and pounds are
    // what the food bank is being told about.
    const notAttempted = totalPounds === '0' && (draft.skipped || draft.missed);
    const noPounds =
      totalPounds === '0' && !notAttempted && (draft.hasStop || draft.hasIntake);

    // Nothing happened, nothing was due, nothing to say. Emitting a card here would
    // put a store on the submission that was never on the route that day.
    //
    // D54 MADE THIS LINE LOAD-BEARING, so what it drops is now stated rather than
    // assumed. S3.1's drill-in is gone and the receipt is the ONLY way to reach the
    // cap-15 weight edit, so a receipt dropped here strands every WEIGHT behind it
    // with no screen to correct it from.
    //
    // It drops exactly one thing: a `(date, donor)` with no stop that day and no
    // reportable intake — which is a walk-in somebody switched off, and nothing else.
    // A weight entry is reportable by construction (I15), so it always sets
    // `hasReportable` and always keeps its card, down to a weight of zero. The
    // switched-off walk-in is not lost either: it reaches the reporter through
    // `notReported` (D56), which is where it can be put back into the report.
    //
    // `report-export.test.ts` asserts both halves directly — every entry the screen
    // offers a correction on is reachable from a receipt or from that list, and no
    // held-back donation manufactures a "No Pounds" card for a store that was never
    // on the route.
    if (totalPounds === '0' && !notAttempted && !noPounds) continue;

    receipts.push({
      pickupDate: draft.pickupDate,
      donorId: draft.donorId,
      donorName: draft.donorName,
      donorCode: draft.donorCode,
      lines: draft.lines,
      itemCount: draft.lines.length,
      totalPounds,
      notAttempted,
      noPounds,
      notes: draft.notes.sort((a, b) => NOTE_ORDER[a.role] - NOTE_ORDER[b.role]),
      // D35. Null both for "nobody has filed this" and for a walk-in label, which has
      // no store to key the check-off on — the screen distinguishes the two from
      // `donorId`, not from this.
      submitted: draft.submitted,
      // D72. Empty for every card that already has a store — there is nothing to
      // re-point — and empty for one built only from scheduled stops.
      labelDonationIds: draft.donorId === null ? labelDonations.get(draft.key) ?? [] : [],
    });
  }

  // Receipt order, which is typing order: the day, then the store. Anything else makes
  // a reporter hunt up and down the page for the rest of one card.
  receipts.sort(
    (a, b) =>
      a.pickupDate.localeCompare(b.pickupDate) || a.donorName.localeCompare(b.donorName),
  );

  return { from, to, receipts, notReported };
}

// ---------------------------------------------------------------------------
// Pointing a label-only walk-in at a real store (D72)
// ---------------------------------------------------------------------------

/**
 * Give the walk-ins behind one label-only receipt a real store.
 *
 * THE PROBLEM IT FIXES. An `UnscheduledDonation` sources from `donor_id` OR
 * `donor_label` and `I16(b)` accepts either, so a walk-in typed as "Sunrise Bagels" is
 * legitimately `reportable = true` — its pounds are in the reported total and in Admin
 * metrics. But a Meal Connect receipt keys on `(pickup date, donor_id)` and the
 * check-off's own table requires a real store, so that receipt can never be ticked as
 * filed. `domain-modeling.md` is right that this is deliberate at the moment the row is
 * written: NTFB's donor picker cannot be pointed at a store that is not theirs either.
 * What was NOT deliberate is that nothing re-pointed it once the store WAS added to our
 * list, so those pounds sat outside NTFB permanently.
 *
 * NO SCHEMA CHANGE. Both columns exist and are nullable; this writes one and clears the
 * other.
 *
 * `donor_label` CANNOT BE KEPT, AND THAT IS A TIER-1 RULE, NOT A CHOICE.
 * `ck_ud_source_exclusive` (migration 0011) is `donor_id IS NULL OR donor_label IS
 * NULL`, and `data-model.md §7` builds on it: the source discriminator is DERIVED from
 * which of the two is set and is never stored. A row carrying both would be a fourth
 * state nothing in the codebase reads. So the label is cleared here, and the plan's
 * "keep it as provenance" is not available without a migration — which this is not.
 *
 * THE PROVENANCE STILL SURVIVES, in the one place it is actually read. The typed name
 * is appended to the donation's own `note`, which `intakeNotes` already carries onto
 * the receipt as a `DONATION` note — so the reporter filing the card can see the store
 * name the receiver wrote down, beside the store it was filed under. A column nobody
 * queries would have preserved less.
 *
 * `I16(b)` is satisfied throughout: source non-null before, source non-null after.
 *
 * ALL OF THEM OR NONE, in one SERIALIZABLE transaction (`architecture.md §4.1`). The
 * card is `(pickup date, label)`; half of it moving to a store and half staying behind
 * would leave two cards where the reporter was looking at one.
 *
 * TWO GUARDS, NEITHER OPTIONAL:
 *
 *   - **I29, the on-route donor guard.** If the donation has a shift, the chosen store
 *     must not already be a `ShiftStop` of it — food from a scheduled stop is another
 *     `weight_entry`, not an unscheduled donation, and this action is exactly the case
 *     that can create the violation. Read inside the writing transaction, like the two
 *     other I29 checks in `services/donation.ts`, so a stop added concurrently cannot
 *     slip between the check and the write.
 *   - **The store must be ACTIVE.** Donors are admin master data (I21) and a reporter
 *     picks from them; naming an archived store would file against one the pantry has
 *     stopped collecting from.
 *
 * D27 IS AFFECTED AND IS SUPPOSED TO BE. Trash rates are per donor (`donor.trash_rate_*`,
 * null meaning "use the pantry default", which is NOT zero), so attaching a store
 * changes this receipt's deduction. That MOVES weight between reported categories and
 * never changes the reported total — the conservation property in the header, which
 * `report-trash.test.ts` asserts directly, and which holds here because the deduction is
 * recomputed per receipt from whatever rates now apply.
 */
/**
 * The typed store name, folded into the donation's own note.
 *
 * `ATTACH_LABEL_NOTE_PREFIX` is what makes it findable later, and appending rather
 * than replacing is what keeps the receiver's own words. Idempotent by construction:
 * the attach can only run once per row, because the second one is refused by
 * `ATTACH_ALREADY_MESSAGE`.
 */
function appendTypedName(note: string | null, label: string): string {
  const line = `${ATTACH_LABEL_NOTE_PREFIX} ${label}.`;
  const existing = (note ?? '').trim();
  return existing === '' ? line : `${existing}\n${line}`;
}

export async function attachDonorToDonations(
  actor: ReportActor,
  donationIds: readonly string[],
  donorId: string,
): Promise<void> {
  if (donationIds.length === 0) throw badRequest('Pick a pickup to file.');

  await writeTransaction(async (tx) => {
    const donor = await tx
      .selectFrom('donor')
      .select(['id', 'deactivated_at as deactivatedAt'])
      .where('id', '=', donorId)
      .executeTakeFirst();
    if (!donor) throw notFound('No such store.');
    if (donor.deactivatedAt !== null) {
      throw conflict('That store is archived. Ask an admin to bring it back first.');
    }

    for (const id of donationIds) {
      const row = await tx
        .selectFrom('unscheduled_donation')
        .select([
          'id',
          'status',
          'note',
          'shift_id as shiftId',
          'donor_id as donorId',
          'donor_label as donorLabel',
        ])
        .where('id', '=', id)
        .executeTakeFirst();

      if (!row) throw notFound('No such donation.');
      // Only a recorded pickup has a receipt to merge into. A `SUGGESTED` prefill is
      // the receiver's to finish (S2.3), and that screen already picks the store.
      if (row.status !== 'CONFIRMED') throw conflict('That donation has not been recorded yet.');
      if (row.donorId !== null) throw conflict(ATTACH_ALREADY_MESSAGE);
      // No donor and no label: nobody wrote down where the food came from, and
      // choosing a store here would be the app inventing provenance.
      if (row.donorLabel === null) throw badRequest(ATTACH_ANONYMOUS_MESSAGE);

      // I29 — the on-route donor guard.
      if (row.shiftId !== null) {
        const onRoute = await tx
          .selectFrom('shift_stop')
          .select('id')
          .where('shift_id', '=', row.shiftId)
          .where('donor_id', '=', donorId)
          .executeTakeFirst();
        if (onRoute) throw conflict(DONATION_ON_ROUTE_MESSAGE);
      }

      await tx
        .updateTable('unscheduled_donation')
        .set({
          donor_id: donorId,
          // Cleared because `ck_ud_source_exclusive` forbids both, and carried into
          // the note instead so the reporter can still see what was written down.
          donor_label: null,
          note: appendTypedName(row.note, row.donorLabel),
          updated_by: actor.id,
          updated_at: sql<Date>`now()`,
        })
        .where('id', '=', id)
        // Re-stated as a predicate so a concurrent attach cannot be overwritten by
        // this one — the read above is not the guarantee, this is (`data-model.md §9`).
        .where('donor_id', 'is', null)
        .execute();
    }
  });
}

// ---------------------------------------------------------------------------
// The Meal Connect check-off (D35, migration 0018)
// ---------------------------------------------------------------------------

/**
 * Mark one receipt as filed into Meal Connect.
 *
 * A tier-3 write like every other one here: inside `writeTransaction`, which is
 * SERIALIZABLE with a 40001 retry (`architecture.md §4.1`), and nothing outside
 * `services/` opens one.
 *
 * TWO REPORTERS TICKING THE SAME STORE PRODUCE ONE ROW, NOT TWO, and the guarantee is
 * the composite primary key rather than the read below — a read-then-insert is exactly
 * the write-skew SERIALIZABLE exists to catch, and the constraint holds even when it
 * does not. `ON CONFLICT DO NOTHING` makes a second tick a no-op rather than a 409:
 * the state the second reporter wanted is the state they get, and refusing would be
 * telling them off for agreeing.
 *
 * NOT WINDOW-GATED. The receiver's edit window (D9) governs correcting intake; this
 * records what a person did at a different organisation's web form, and a range filed
 * three weeks late is the case the check-off exists for rather than one to refuse.
 */
export async function markReceiptSubmitted(
  actor: ReportActor,
  pickupDate: string,
  donorId: string,
): Promise<void> {
  const day = isoDate(parseDate(pickupDate, 'pickupDate'));

  await writeTransaction(async (tx) => {
    const donor = await tx
      .selectFrom('donor')
      .select('id')
      .where('id', '=', donorId)
      .executeTakeFirst();
    // A deactivated store still gets receipts for the pickups it made while it was
    // open, so this checks existence and not `deactivated_at`.
    if (!donor) throw notFound('No such store.');

    await tx
      .insertInto('meal_connect_submission')
      // `::date`, not a JS `Date`: the column is a civil DATE and a `Date` object
      // carries a time and a zone, which is the shape that lands a pickup on the
      // previous day for anyone west of Greenwich (`data-model.md §0`).
      .values({
        pickup_date: sql<Date>`${day}::date`,
        donor_id: donorId,
        submitted_by: actor.id,
      })
      .onConflict((oc) => oc.columns(['pickup_date', 'donor_id']).doNothing())
      .execute();
  });
}

/**
 * Un-tick one receipt.
 *
 * A DELETE, which is what makes the check-off reversible — a mis-tick is removed
 * rather than corrected with a second fact saying the first was wrong. Deleting a row
 * that is not there is silent for the same reason a second tick is: the caller asked
 * for a state, and it is the state they end up in.
 */
export async function clearReceiptSubmitted(
  pickupDate: string,
  donorId: string,
): Promise<void> {
  const day = isoDate(parseDate(pickupDate, 'pickupDate'));

  await writeTransaction(async (tx) => {
    await tx
      .deleteFrom('meal_connect_submission')
      .where(sql<boolean>`pickup_date = ${day}::date`)
      .where('donor_id', '=', donorId)
      .execute();
  });
}
