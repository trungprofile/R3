// API shapes for unplanned intake — PRD cap 12, `ui-ux-spec.md` S1.5 (driver flag)
// and S2.3 (receiver record/confirm). Both halves ship together (PRD cap 12).
//
// Zero runtime dependencies, as everywhere in this package.
//
// The domain rule this file is shaped by: `WeightEntry` and `UnscheduledDonation`
// are **peers, not nested** (I18). An unscheduled donation is itself a weight
// record — donor-or-label, category, weight, day, reportable — so the grain here is
// one row per category, exactly as it is for a `weight_entry`. A donation spanning
// three categories is three rows, and the receiver adds them one tile at a time on
// the same surface they already use for a scheduled stop (S2.3, "same
// weight-by-category surface").

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * `donation_status` — mirrors the native enum added in migration 0011.
 *
 * `SUGGESTED` originates **only** from a driver-add (I17); a receiver-authored
 * donation is born `CONFIRMED`. Unconfirmed `SUGGESTED` rows are deleted at that
 * shift's receive-done, or by the daily sweep once the edit window expires — they
 * are a prefill, not a ledger entry, so hard-delete is correct.
 */
export const DONATION_STATUSES = ['SUGGESTED', 'CONFIRMED'] as const;
export type DonationStatus = (typeof DONATION_STATUSES)[number];

/**
 * How the source resolves. **Derived** from which column is set, never stored
 * (`data-model.md §7.2`): `donor_id` → MASTER, `donor_label` → LABEL, neither → ANON.
 */
export const DONATION_SOURCES = ['MASTER', 'LABEL', 'ANON'] as const;
export type DonationSource = (typeof DONATION_SOURCES)[number];

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface DonationSummary {
  id: string;
  /** Non-null only for a driver-add that arrived on a run (0..1). */
  shiftId: string | null;
  status: DonationStatus;
  source: DonationSource;
  donorId: string | null;
  donorLabel: string | null;
  /** What to print: the master donor's name, the free-text label, or the
   *  "unattributed" bucket an anonymous walk-in collapses into (`data-model.md §8`). */
  donorDisplay: string;
  /** D24 — null only while `SUGGESTED`. The driver no longer picks a category, so a
   *  prefill arrives without one and the receiver names it at confirm.
   *  `ck_ud_confirmed_category` makes it non-null on every `CONFIRMED` row, which is
   *  the only kind the report and metrics ever read. */
  categoryId: string | null;
  categoryName: string | null;
  /** Decimal string; null while `SUGGESTED` (I16a makes it required on CONFIRMED). */
  weight: string | null;
  reportable: boolean;
  /** `YYYY-MM-DD`, pantry-local. The §8 grouping anchor — the shift's occurrence
   *  date for a driver-add, the receive day for a walk-in. */
  receivedDate: string;
  note: string | null;
  createdByName: string;
  createdAt: string;
  /** False once `receiver_edit_window_days` has passed; after that, editing is
   *  Reporter-only and lives on S3.1 (Phase 3). */
  editableByReceiver: boolean;
}

// ---------------------------------------------------------------------------
// S1.5 — the driver's flag ("Flag a stop not on my route")
// ---------------------------------------------------------------------------

/**
 * Create a `SUGGESTED` donation mid-run. **Never writes a `ShiftStop` row** (I14) —
 * the planned route stays pristine, which is what keeps planned and unplanned
 * structurally distinguishable rather than a matter of interpretation.
 *
 * Guarded by I29: the donor must not already be a stop of this shift. More food from
 * a scheduled stop is additional `weight_entry` rows, not an unscheduled donation.
 *
 * ## No `categoryId`, and why that is a change (D24)
 *
 * `ui-ux-spec.md:193` has always described this control as "just a donor picker (or
 * free-text label) and an optional note". D8 had to overrule that sentence, because
 * `domain-modeling.md §2.3` (locked) listed `Category | required` on
 * `UnscheduledDonation` with no `SUGGESTED` exemption, and the locked doc outranks the
 * UI spec. So the driver picked a category they could not verify, standing at a loading
 * dock, for food the receiver would weigh later anyway.
 *
 * The locked doc was amended on 2026-08-02 under explicit human authorization: a
 * category is required **on `CONFIRMED`**, not at creation (migration 0015, D24, which
 * supersedes D8). The driver's picker is gone and the UI spec's original sentence is
 * true again. The receiver picks at confirm — they are the one holding the food.
 */
export interface FlagAdHocRequest {
  /** Exactly one of these two, or neither for an anonymous pickup
   *  (`ck_ud_source_exclusive` forbids both). */
  donorId?: string | null;
  donorLabel?: string | null;
  note?: string | null;
}

/** The refusal when the flagged donor is already a stop on this run (I29). */
export const DONATION_ON_ROUTE_MESSAGE =
  'That store is already a stop on this run. Add its weight to the stop instead.';

// ---------------------------------------------------------------------------
// S2.3 — the receiver's record / confirm
// ---------------------------------------------------------------------------

/**
 * Record a donation from scratch. Born `CONFIRMED`, so `weight` is required (I16a).
 *
 * No `shiftId`: a receiver-authored donation is off-plan by definition, and
 * `received_date` is the receive day (`data-model.md §8`). Driver-adds are the only
 * shift-bearing rows, and they arrive through `FlagAdHocRequest` above.
 */
export interface CreateDonationRequest {
  donorId?: string | null;
  donorLabel?: string | null;
  categoryId: string;
  weight: string;
  /** Default ON (I15). Attribution is optional **only** when this is false (I16b). */
  reportable?: boolean;
  note?: string | null;
}

/**
 * Confirm a driver-flagged `SUGGESTED` row: `SUGGESTED → CONFIRMED`.
 *
 * Every field is re-supplied because the driver's flag is a *prefill*, not a
 * commitment — the receiver is the one who sees the food, and may correct the donor
 * the driver guessed at.
 */
export interface ConfirmDonationRequest {
  weight: string;
  /** Optional on the wire only in the sense that absent means "keep what the row
   *  already has". Since D24 a prefill normally has none, so in practice the receiver
   *  supplies it here — and `ck_ud_confirmed_category` refuses the transition if the
   *  row would end up without one. */
  categoryId?: string;
  donorId?: string | null;
  donorLabel?: string | null;
  reportable?: boolean;
  note?: string | null;
}

/**
 * The `reportable` toggle on its own — a plain field edit, last-write-wins, stamped
 * with who and when (PRD cap 15). Deliberately *not* the void-and-reinsert path that
 * weights take: the flag carries no weight and has no prior value worth preserving
 * as a row.
 */
export interface SetReportableRequest {
  reportable: boolean;
}

/** The key boundary S2.3 must make visible, verbatim from `ui-ux-spec.md:333`. */
export const REPORTABLE_EXPLAINER =
  'Reported donations go in the weekly NTFB report. Unreported ones still count in our own totals.';

/** I16b, refused server-side as well as hidden client-side. */
export const DONATION_SOURCE_REQUIRED_MESSAGE =
  'A reported donation needs a store name.';

/** D24 — `ck_ud_confirmed_category`, refused before the CHECK fires so the receiver
 *  reads a sentence rather than a 500. A driver-flagged row arrives without a
 *  category now, so this is the ordinary path, not an edge case. */
export const DONATION_CATEGORY_REQUIRED_MESSAGE = 'Pick what kind of food this is.';

/** The window has closed; correcting it is now a Reporter job on the report screen. */
export const DONATION_WINDOW_CLOSED_MESSAGE =
  'The time to change this run has passed. Ask someone with reporting access to fix it.';
