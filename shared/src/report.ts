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
  /**
   * True only on the synthetic **Trash** line (`D27`).
   *
   * Nothing was ever weighed into it: it is the sum of the per-receipt deductions off
   * Bakery, Produce and Deli, so it has no `agfpCategories` and no drill-in. Every
   * other line is `false`/absent.
   */
  computed?: boolean;
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
  /**
   * EVERY WEIGHT ON THIS PAYLOAD IS A WHOLE NUMBER OF POUNDS (`D28`, answering
   * `A189`), still carried as a decimal string (`"744.00"`) so it adds exactly the
   * way every other weight in this repo does.
   *
   * The rounding grain is the **receipt line** — one `(pickup date, donor, AGFP
   * category)` — because that is the number a person types into Meal Connect, and
   * `D28` says the receipt total is the sum of the rounded rows rather than the
   * rounded sum. Every figure here is an aggregate of those same rounded lines, which
   * is what keeps this screen and the printed receipt from disagreeing by a pound.
   *
   * **The window is a RANGE, not necessarily a week** (`D41`). It used to be
   * `weekStart` / `weekEnd`, and the rename is the point: a reporter catching up on
   * two weeks at once asked for a range, and a field called `weekEnd` holding a date
   * eleven days after `weekStart` is a field that lies. The DEFAULT is still the
   * Monday-to-Sunday week containing the pantry's today (`A178`), which is the same
   * boundary S1.2's board and Admin metrics cut on, so nothing about the ordinary
   * case changed.
   *
   * Nothing here depends on the window being seven days: `D28`'s rounding happens at
   * the receipt line and `D27`'s deduction happens per receipt, and a receipt is
   * keyed `(pickup date, donor)` either way. A longer range is simply more receipts.
   */
  /** `YYYY-MM-DD`, pantry-local, inclusive. */
  from: string;
  /** `YYYY-MM-DD`, pantry-local, inclusive — a report is a closed range. */
  to: string;
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
  /** False while any `unmapped` row carries weight — S3.1's "incomplete range". */
  readyToExport: boolean;
  /** Runs in the range that never reached `COMPLETED`. It can be exported with
   *  these outstanding; the screen says so rather than deciding for the Reporter. */
  openRuns: { shiftId: string; routeName: string; occurrenceDate: string; status: string }[];
  /**
   * Where this week is going, as Meal Connect labels it on its own receipts.
   * Configuration, not data (`app_config`, migration 0013).
   *
   * **Nothing reads this.** It used to print above the export so a Reporter could
   * confirm the account before typing; `D25` removed that line from both the screen
   * and the printed receipt, because the person entering the submission already knows
   * their own agency code. The field is kept because the codes are real configuration
   * and a future sheet may want them back, but do not assume from this shape that
   * anything renders it today.
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
 * Where one note on a receipt came from (`D29`).
 *
 * It names the **channel**, not the writer's tier — the writer is `ReceiptNote.author`,
 * and two of these are the same person. PRD cap 11's channels, plus the two intake
 * tables:
 *
 *   - `COORDINATOR` — `Shift.staff_note`, the coordinator→driver line (channel 1). No
 *     author: nothing records who typed it, and inventing one from `updated_by` would
 *     name whoever last touched any field on the shift.
 *   - `DRIVER` — `Shift.note`, the driver's one whole-run remark (channel 3).
 *   - `STOP` — `ShiftStop.note`, written at one store. Also the driver's, and kept
 *     apart from `DRIVER` because "the back gate was locked" belongs to a store and
 *     "the truck broke down" belongs to a run.
 *   - `RECEIVER` — `WeightEntry.note`, written at the scale.
 *   - `DONATION` — `UnscheduledDonation.note`, the walk-in's own remark.
 */
export type ReceiptNoteRole = 'COORDINATOR' | 'DRIVER' | 'STOP' | 'RECEIVER' | 'DONATION';

/**
 * One remark attached to a receipt.
 *
 * This is the field that carries "the store wasn't open at the scheduled time" to the
 * food bank. Nothing here is submitted automatically — Meal Connect's own free-text
 * box is the reporter's to fill, so these are gathered and labelled and the reporter
 * decides which ones belong on the submission.
 */
export interface ReceiptNote {
  role: ReceiptNoteRole;
  /** `null` for a `COORDINATOR` note, which stores no author. */
  author: string | null;
  text: string;
}

/**
 * One line item, exactly as Meal Connect's form asks for it.
 *
 * **One line per AGFP category — never merged.** Deli and Frz Non Meat both report as
 * `Prepared Meal / Frozen` (migration 0016), and the sample receipt carries two
 * separate `Prepared Meals` rows for precisely that reason. Merging them would file
 * one number where the portal took two.
 *
 * **There is no Description.** The portal has the field; it is the reporter's own free
 * text for NTFB and not ours to fill.
 */
export interface ReceiptLine {
  ntfbCategory: string;
  /** `''` when the mapping never named one — one of the form's four fields blank,
   *  which does not block the export the way an unmapped category does. */
  storage: string;
  /** Whole pounds, no decimal part (`D28`). */
  pounds: string;
  /**
   * The pantry's own category, for reconciling against the paper log.
   *
   * NOT typed into the portal, and the screen marks it as such — without it, two
   * identical `Prepared Meal / Frozen` rows are unreadable now that Description is
   * gone. Empty on the computed Trash line, which has no AGFP category.
   */
  agfpCategory: string;
  /** True only on the synthetic Trash line (`D27`) — nothing was weighed into it. */
  computed: boolean;
}

/**
 * One Meal Connect receipt: everything the portal asks for about `(pickup date, donor)`.
 *
 * **Meal Connect has no import** (`D13`, and that finding still stands). A real
 * submission turned out to be three web screens a person types into, so the export is
 * not a machine format and never was — it is a printable mimic of the form, one card
 * per store per day, read top to bottom while typing (`D29`, superseding `D13`'s
 * rectangular column list).
 *
 * **The two checkboxes are computed, and they are the reason this type exists.** A
 * skipped stop and a run nobody worked produced NO export row at all, so those pickups
 * were invisible to the food bank — the "lost-sheet misreporting" failure, one level up
 * from the unmapped category. Emitting them is the point.
 */
export interface Receipt {
  /** `YYYY-MM-DD` — `report_day`, never `created_at` (`data-model.md §8`). */
  pickupDate: string;
  /**
   * The store's own id, and `null` for a free-text walk-in label or the anonymous
   * bucket, neither of which has a `donor` row.
   *
   * On the payload because `(pickupDate, donorId)` is the key of the check-off below
   * (`D35`, migration 0018) — and because null is the one case that cannot be ticked,
   * which the screen has to be able to see rather than discover from a refusal.
   */
  donorId: string | null;
  donorName: string;
  /** NTFB's own number for the store, shown on its picker as `H-E-B Food Stores (810)`.
   *  Null for a store nobody has recorded one for, and always null for a free-text
   *  walk-in label, which has no donor row to attribute the food to. */
  donorCode: string | null;
  /** Empty on a not-attempted receipt. */
  lines: ReceiptLine[];
  /** Meal Connect's `Number of Items` — how many line items, not how many crates. */
  itemCount: number;
  /** Meal Connect's `Total Pounds`: Σ of the ROUNDED line pounds (`D28`). */
  totalPounds: string;
  /** `Scheduled Pickup Not Attempted`. The stop was `SKIPPED`, or the run was never
   *  worked at all — `MISSED`, which is derived and not stored (I7): the window
   *  passed with the shift still `OPEN` (unclaimed) or `CLAIMED` (no-show). */
  notAttempted: boolean;
  /** `No Pounds`. The pickup happened and came to nothing. */
  noPounds: boolean;
  /** Every note attached to this pickup, labelled by channel. */
  notes: ReceiptNote[];
  /**
   * Who filed this receipt into Meal Connect and when, or `null` for one nobody has
   * filed yet (`D35`, migration 0018).
   *
   * **Persisted, not a UI flag.** The portal takes one submission at a time and has
   * no import (`D13`), so a fifteen-store week is fifteen separate typing sessions.
   * A local flag answers "which have I done" for one person until they reload, and
   * answers nothing at all for the second reporter working the same range — where
   * the failure is a receipt filed twice or not at all, neither of which is visible
   * at the far end.
   *
   * Always `null` when `donorId` is null: the check-off is keyed on a real store,
   * and a free-text walk-in label has no `donor` row to key on. That is the same
   * store Meal Connect's own picker cannot be pointed at.
   */
  submitted: ReceiptSubmission | null;
}

/** One receipt's check-off (`D35`). Un-ticking DELETES the row, which is what makes
 *  a mis-tick reversible rather than something to be corrected with a second fact. */
export interface ReceiptSubmission {
  /** ISO instant. Rendered pantry-local at the screen, like every other instant. */
  submittedAt: string;
  /** Who ticked it, by name (I26's provenance, the half that has a writer). */
  submittedBy: string;
}

/**
 * Tick or un-tick one receipt. The pair IS the receipt's key and the table's primary
 * key, so there is no id to send and no id to guess.
 */
export interface ReceiptSubmissionRequest {
  /** `YYYY-MM-DD`. */
  pickupDate: string;
  donorId: string;
}

/** The range's receipts, in the order they are typed: date, then store. */
export interface ReportExport {
  /** `YYYY-MM-DD`, inclusive, pantry-local — the same window `WeeklyReport` carries
   *  and, since `D41`, not necessarily seven days. */
  from: string;
  to: string;
  receipts: Receipt[];
}

/**
 * Refused rather than silently short. See `UnmappedCategory`.
 *
 * It has now been rewritten twice for the same reason, which is worth knowing
 * before it is rewritten a third time: this sentence names a PLACE, and the place
 * keeps moving. It ended "Match it below" while the editor sat on S3.1; `D17`
 * moved it to Admin's Category matching tab; `D40` merged that tab into
 * Categories. A sentence that pointed at a tab which no longer exists would strand
 * a Reporter who cannot fix the block themselves and has nowhere to be sent.
 *
 * It also no longer says "this week": the report takes a range now (`D41`).
 */
export const EXPORT_BLOCKED_MESSAGE =
  'Some food in these dates is not matched to a North Texas Food Bank category yet. An admin matches it under Admin, on the Categories tab, and then the report is ready.';
