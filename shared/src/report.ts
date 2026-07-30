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
}

/** `null` clears the mapping — "not reported under any NTFB category yet". */
export interface SetMappingRequest {
  ntfbCategoryId: string | null;
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
  lines: ReportLine[];
  unmapped: UnmappedCategory[];
  /** Σ of `lines` — what the export will say. */
  reportedTotal: string;
  /** Σ of everything received in the week, reported or not. */
  intakeTotal: string;
  /** `intakeTotal − reportedTotal`, stated rather than left to be worked out. */
  unreportedTotal: string;
  /** False while any `unmapped` row carries weight — S3.1's "incomplete week". */
  readyToExport: boolean;
  /** Runs in the week that never reached `COMPLETED`. A week can be exported with
   *  these outstanding; the screen says so rather than deciding for the Reporter. */
  openRuns: { shiftId: string; routeName: string; occurrenceDate: string; status: string }[];
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
 * One row of the Meal Connect export.
 *
 * **The column set is not specified anywhere.** `product-requirement.md` cap 15 and
 * Success Metric 3 both say "Meal Connect format" and neither says what that is; it is
 * NTFB's file format and it is not in this repo. These columns are the report's own
 * grain (`data-model.md §8`: `report_day × category × donor-or-label`) written out
 * flat, which is the most defensible thing to emit without the real spec — every
 * number is traceable and nothing is invented beyond the header row.
 *
 * Treat the header names as provisional until someone compares them with a real
 * submission (phase-3-build-plan.md D13).
 */
export interface ExportRow {
  day: string;
  ntfbCategory: string;
  ntfbCode: string;
  agfpCategory: string;
  donor: string;
  weightLb: string;
}

export const EXPORT_COLUMNS = [
  'Date',
  'NTFB Category',
  'NTFB Code',
  'AGFP Category',
  'Donor',
  'Weight (lb)',
] as const;

/** Refused rather than silently short. See `UnmappedCategory`. */
export const EXPORT_BLOCKED_MESSAGE =
  'Some food this week is not matched to a North Texas Food Bank category yet. Match it below and the report will be ready.';
