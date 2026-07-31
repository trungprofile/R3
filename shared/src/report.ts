// API shapes for the NTFB report — PRD cap 15, `ui-ux-spec.md` S3.1.
//
// Zero runtime dependencies, as everywhere in this package.
//
// The one definition everything here is built on (`domain-modeling.md §6`, locked):
//
//     report  = weight_entry[NOT voided] ∪ unscheduled_donation[CONFIRMED ∧ reportable]
//     metrics = weight_entry[NOT voided] ∪ unscheduled_donation[CONFIRMED]
//
// Two things about that union are easy to get wrong and are the reason the shapes
// below look the way they do:
//
//   1. **The report query must not filter on `Shift`.** Walk-ins have none. A join
//      that starts from `shift` silently drops every unscheduled donation, and the
//      number would still look plausible.
//   2. **The two entities have no shared date column.** `report_day` is
//      `shift.occurrence_date` for a weight and `received_date` for a donation
//      (`data-model.md §8`) — never `created_at`, which mis-buckets whenever
//      receiving lags past midnight.
//
// Weights cross the wire as decimal strings for the same reason they do in
// `receive.ts`: `numeric(8,2)` is exact and this is the column the food bank reads.

// ---------------------------------------------------------------------------
// The AGFP→NTFB mapping (the editable table S3.1 owns)
// ---------------------------------------------------------------------------

/**
 * One of North Texas Food Bank's categories.
 *
 * **The pantry enters these.** They are NTFB's vocabulary, written down in no
 * foundation doc, and migration 0012 deliberately ships the table empty rather than
 * guessing at them — see that migration's header for why fabricating them would be
 * worse than shipping nothing.
 */
export interface NtfbCategory {
  id: string;
  name: string;
  /** Meal Connect may key on a code rather than a display name; null until known. */
  code: string | null;
  active: boolean;
  /** How many AGFP categories currently map here. Drives the I21 delete/archive hint. */
  mappedCount: number;
}

export interface CreateNtfbCategoryRequest {
  name: string;
  code?: string | null;
}

export interface UpdateNtfbCategoryRequest {
  name?: string;
  code?: string | null;
  /** Reactivate an archived one. Archiving goes through DELETE, where I21 decides. */
  active?: boolean;
}

/** One row of S3.1's mapping editor: an AGFP category and where it reports to. */
export interface CategoryMapping {
  categoryId: string;
  categoryName: string;
  categoryActive: boolean;
  ntfbCategoryId: string | null;
  ntfbCategoryName: string | null;
  /**
   * The Storage value Meal Connect's line-item form wants beside the category —
   * `Frozen`, `Dry`, `Refrigeration` on the sample receipt.
   *
   * Part of the MAPPING, not of `NtfbCategory`: storage varies within one NTFB
   * bucket (two AGFP categories may report there frozen and dry respectively),
   * and a real receipt carries two separate `Prepared Meals` lines, so Meal
   * Connect accepts exactly that. Free text for the same reason `code` is
   * nullable — those three values are what one receipt showed, not a vocabulary
   * anyone here has been given (migration 0013).
   *
   * `null` does NOT block the export the way an unmapped category does: the
   * weight still reaches the right category and only one of the form's four
   * fields is blank.
   */
  storage: string | null;
}

/**
 * `ntfbCategoryId: null` clears the mapping — "not reported under any NTFB category
 * yet", which also clears `storage`, since storage is meaningless without a target.
 */
export interface SetMappingRequest {
  ntfbCategoryId: string | null;
  storage?: string | null;
}

// ---------------------------------------------------------------------------
// The weekly report
// ---------------------------------------------------------------------------

/**
 * One line of the report: an NTFB category and the AGFP weight rolled into it.
 *
 * `agfpCategories` is what makes the roll-up inspectable one level before the
 * drill-in — two AGFP categories may share one NTFB bucket, and a Reporter checking a
 * number needs to see which.
 */
export interface ReportLine {
  ntfbCategoryId: string;
  ntfbCategoryName: string;
  ntfbCode: string | null;
  /** Second half of the roll-up key — see `CategoryMapping.storage`. One NTFB
   *  category with two storage values is two lines here and two line items in Meal
   *  Connect, which is what its own receipts do. */
  storage: string | null;
  agfpCategories: { categoryId: string; categoryName: string; total: string }[];
  total: string;
}

/**
 * An AGFP category that carries weight this week but maps to nothing.
 *
 * Surfaced rather than dropped, and it **blocks export** (D12). Silently omitting it
 * would understate the report by exactly the amount nobody noticed, which is the
 * "lost-sheet misreporting" failure Success Metric 4 exists to kill.
 */
export interface UnmappedCategory {
  categoryId: string;
  categoryName: string;
  total: string;
}

/**
 * The week, as S3.1 renders it.
 *
 * `reportedTotal` and `intakeTotal` are the two numbers PRD §3 insists stay distinct
 * everywhere: intake is everything the pantry received, reported is only what flows to
 * NTFB. They differ by the unreported donations, which is why that figure is here
 * rather than only on S3.2.
 */
export interface WeeklyReport {
  /** `YYYY-MM-DD`, the Monday of the week, pantry-local. */
  weekStart: string;
  /** `YYYY-MM-DD`, the Sunday. Inclusive — a report is a closed week. */
  weekEnd: string;
  /** The mapped breakdown. While `unmapped` is non-empty, Σ`lines` is LESS than
   *  `reportedTotal` — that gap is exactly what `readyToExport: false` announces. */
  lines: ReportLine[];
  unmapped: UnmappedCategory[];
  /**
   * Everything reportable this week, mapped or not — **not** Σ`lines`.
   *
   * A scheduled weight is reportable by construction (I15). If it has no NTFB category
   * yet that is a gap in the mapping table, not a decision that the food goes
   * unreported, and counting it as unreported would file it under "tracked for pantry
   * metrics only, never reported" — a real category with a real meaning, and not this
   * one.
   */
  reportedTotal: string;
  /** Σ of everything received in the week, reportable or not. */
  intakeTotal: string;
  /** `intakeTotal − reportedTotal` — donations somebody turned the report toggle OFF
   *  for. Tracked in the pantry's own totals, never sent to NTFB (PRD §3). */
  unreportedTotal: string;
  /** False while any `unmapped` row carries weight — S3.1's "incomplete week". */
  readyToExport: boolean;
  /** Runs in the week that never reached `COMPLETED`. A week can be exported with
   *  these outstanding; the screen says so rather than deciding for the Reporter. */
  openRuns: { shiftId: string; routeName: string; occurrenceDate: string; status: string }[];
  /**
   * Where this week is going, as Meal Connect labels it on its own receipts.
   *
   * Printed above the export so a Reporter can confirm the account before typing —
   * the export is a worksheet for a web form (see `ExportRow`), and the one thing a
   * worksheet cannot check for them is whether they are logged in as the right
   * agency. Configuration, not data (`app_config`, migration 0013).
   */
  mealConnect: { agencyCode: string; foodBank: string; foodBankCode: string };
}

// ---------------------------------------------------------------------------
// The drill-in (Success Metric 4 — 100% traceable)
// ---------------------------------------------------------------------------

/**
 * One underlying entry behind a report number: store, day, receiver.
 *
 * `kind` is what tells a Reporter which correction path applies. A `WEIGHT` is
 * immutable and corrects by void-and-reinsert (I13); a `DONATION`'s `reportable` flag
 * is a plain field edit (PRD cap 15). They are peers, never nested (I18).
 */
export interface ReportEntry {
  id: string;
  kind: 'WEIGHT' | 'DONATION';
  /** `YYYY-MM-DD` — `report_day`, not `created_at` (`data-model.md §8`). */
  day: string;
  donorName: string;
  /** NTFB's own number for this store, as its donor picker shows it — `810` for
   *  `H-E-B Food Stores (810)`. Null for a store nobody has recorded one for, and
   *  always null for a free-text walk-in label, which has no donor row and
   *  therefore nothing Meal Connect can be pointed at. */
  donorCode: string | null;
  categoryId: string;
  categoryName: string;
  weight: string;
  /** Always true for a `WEIGHT` (I15: scheduled ⇒ reportable, so it carries no flag). */
  reportable: boolean;
  /** Who logged it (I26) — the "receiver" column S3.1 asks for. */
  receiverName: string;
  /** The run it came from; null for a walk-in, which has no shift by construction. */
  shiftId: string | null;
  routeName: string | null;
  /** False once the receiver's window has closed — after which S3.1 is the ONLY
   *  remaining way to correct this entry (PRD cap 15). Informational: the Reporter
   *  may edit either way, and that is the point of the screen. */
  receiverWindowOpen: boolean;
}

/** Reporter's correction. Void-old + insert-new underneath (I13), an overwrite on
 *  screen — the same look S2.2 gives the receiver, and deliberately so. */
export interface ReviseEntryRequest {
  weight: string;
  note?: string | null;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * One row of the Meal Connect worksheet.
 *
 * **Meal Connect has no import.** A real submission (D13) turned out to be three web
 * screens a person types into: a receipt per `(pickup date, donor)`, then N line items
 * of `Category · Storage · Description · Pounds`, then a review list showing
 * `Number of Items` and `Total Pounds` per receipt, then Submit.
 *
 * So this file is not a machine format and never was — it is the sheet a Reporter reads
 * while typing, and its shape follows from that:
 *
 *   - **One row per line item**, at the grain the form asks for: `day × donor ×
 *     ntfb_category × storage`. Storage is part of the key because it is part of the
 *     line item (`CategoryMapping.storage`).
 *   - **Sorted `day → donor → category`**, which is receipt order. The previous
 *     ordering was `day → category → donor`, so a Reporter filling one receipt had to
 *     hunt up and down the file for the rest of that store's lines.
 *   - **`receiptItems` and `receiptTotal` repeat on every row of a receipt.** They are
 *     what Meal Connect's review screen shows back, so they are the check that a
 *     receipt was typed completely. Repeated rather than emitted as subtotal rows,
 *     which would make the file non-rectangular and break every spreadsheet that
 *     opens it.
 *
 * Weights are NOT rounded to whole pounds. The sample receipt shows integers, but its
 * inputs were integers, and nothing observed says the form refuses a decimal — rounding
 * each row would also make Σ rows disagree with the week's total by a few pounds
 * (phase-3-state.md A189).
 *
 * `agfpCategory` stays in the file even though Meal Connect never asks for it: it is
 * how a Reporter checks a line against S3.1 and the pantry's own sheets, and Success
 * Metric 4 is about every number being traceable.
 */
export interface ExportRow {
  day: string;
  donor: string;
  /** Empty when unknown — see `ReportEntry.donorCode`. Empty here is a real signal:
   *  a walk-in label has no store for Meal Connect to attribute the food to. */
  donorCode: string;
  ntfbCategory: string;
  storage: string;
  agfpCategory: string;
  weightLb: string;
  /** How many rows this receipt has, repeated on each of them. */
  receiptItems: string;
  /** Σ of this receipt's rows, repeated on each of them. */
  receiptTotal: string;
}

/** Named as Meal Connect's own screens name them, so a Reporter reads the sheet and
 *  the form in the same words. */
export const EXPORT_COLUMNS = [
  'Pickup Date',
  'Donor',
  'Donor Code',
  'Category',
  'Storage',
  'AGFP Category',
  'Pounds',
  'Receipt Items',
  'Receipt Total (lb)',
] as const;

/** Refused rather than silently short. See `UnmappedCategory`. */
export const EXPORT_BLOCKED_MESSAGE =
  'Some food this week is not matched to a North Texas Food Bank category yet. Match it below and the report will be ready.';
