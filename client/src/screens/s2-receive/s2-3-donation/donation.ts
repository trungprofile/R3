// S2.3 unscheduled donation — every decision the screen makes, as a function of
// plain records.
//
// Written this way so it can be tested at all: there is no browser or component
// harness in this repo and adding one would be a dependency no lane may add
// (build-plan §3/D5). The JSX beside this file arranges what is decided here.
//
// EVERYTHING BELOW IS COMMUNICATION ONLY. `services/donation.ts` enforces I15,
// I16, I17 and I29 inside a SERIALIZABLE transaction and refuses the same things
// again when this screen gets one wrong (`CLAUDE.md`). Greying out Submit is a
// courtesy to a volunteer at a tablet, never the rule itself.
//
// THE THREE THINGS THIS FILE EXISTS TO GET RIGHT:
//
//   1. THE GRAIN IS ONE ROW PER CATEGORY (I18). An unscheduled donation is itself
//      a weight record, peer to a `weight_entry` and not a container for several.
//      A donation spanning three categories is three submissions, exactly as
//      adding three weights to a stop is three entries.
//   2. NEVER BOTH A DONOR ID AND A LABEL. `ck_ud_source_exclusive` refuses it at
//      the storage layer; `sourceFields` below makes it unrepresentable here, by
//      deriving both fields from one mode rather than from two inputs.
//   3. BLANK ATTRIBUTION IS LEGAL ONLY WITH THE REPORT TOGGLE OFF (I16b). NTFB
//      needs an attributable store; an unreported walk-in does not.

import { toApiError } from '../../../api/index.ts';
import { DONATION_SOURCE_REQUIRED_MESSAGE } from '../../../api/shared.ts';
import type {
  CategorySummary,
  ConfirmDonationRequest,
  CreateDonationRequest,
  DonationSource,
  DonationSummary,
  DonorSummary,
} from '../../../api/shared.ts';

// ---------------------------------------------------------------------------
// Weights (A165)
// ---------------------------------------------------------------------------

/**
 * `numeric(8,2)` — six digits before the point, two after. Mirrors
 * `parseWeight`'s pattern in `services/receive.ts` so the keypad can say "that
 * is not a weight" before the round trip; the server says it again regardless.
 */
const WEIGHT_PATTERN = /^\d{1,6}(\.\d{1,2})?$/;

export function isWeight(value: string): boolean {
  return WEIGHT_PATTERN.test(value.trim());
}

/** A decimal string as a person reads it: `"87.50"` → `"87.5"`, `"120.00"` →
 *  `"120"`. String surgery, never arithmetic — `Number("1222.35")` is already not
 *  1222.35 and this column feeds the NTFB report. */
export function formatWeight(value: string): string {
  const trimmed = value.trim();
  const [whole = '0', fraction] = trimmed.split('.');
  if (fraction === undefined) return whole;
  const kept = fraction.replace(/0+$/, '');
  return kept === '' ? whole : `${whole}.${kept}`;
}

/** §7: "Units always shown ('lb')." */
export function weightWithUnit(value: string): string {
  return `${formatWeight(value)} lb`;
}

// ---------------------------------------------------------------------------
// The draft
// ---------------------------------------------------------------------------

/**
 * One submission in progress — one category, one weight, one source.
 *
 * `sourceMode` is the single input the two source columns are derived from, which
 * is what makes "never both" a shape rather than a rule someone has to remember.
 */
export interface DonationDraft {
  sourceMode: DonationSource;
  /** Only meaningful in `MASTER` mode. */
  donorId: string | null;
  /** Only meaningful in `LABEL` mode. Raw text; trimmed on the way out. */
  donorLabel: string;
  categoryId: string | null;
  /** Keypad digits, e.g. `"87.5"`. Never a number. */
  weight: string;
  /** Default ON (I15). */
  reportable: boolean;
  note: string;
}

/** A fresh donation. Report ON, because I15 makes that the default and the
 *  common case is a store call that belongs in the NTFB report. */
export function emptyDraft(): DonationDraft {
  return {
    sourceMode: 'MASTER',
    donorId: null,
    donorLabel: '',
    categoryId: null,
    weight: '',
    reportable: true,
    note: '',
  };
}

/** Load a driver's prefill into the form. Donor, category and note come across;
 *  the weight does not, because a `SUGGESTED` row has none (I16a exempts it) and
 *  supplying one is exactly what the receiver is here for. */
export function draftFrom(row: DonationSummary): DonationDraft {
  return {
    sourceMode: row.source,
    donorId: row.donorId,
    donorLabel: row.donorLabel ?? '',
    categoryId: row.categoryId,
    weight: row.weight ?? '',
    reportable: row.reportable,
    note: row.note ?? '',
  };
}

/**
 * Keep the source, drop the entry. Used after a successful submit so the second
 * category of the same donation is one weight away — the grain is per category
 * (I18), so a three-category donation is three passes through this form and
 * re-picking the store each time would be three times the work for no meaning.
 */
export function nextInSameDonation(draft: DonationDraft): DonationDraft {
  return { ...draft, categoryId: null, weight: '' };
}

/** Whether the draft names a source at all. `ANON` never does — that is what it
 *  is for. */
export function hasSource(draft: DonationDraft): boolean {
  switch (draft.sourceMode) {
    case 'MASTER':
      return draft.donorId !== null;
    case 'LABEL':
      return draft.donorLabel.trim() !== '';
    case 'ANON':
      return false;
  }
}

// ---------------------------------------------------------------------------
// Validation — communication only
// ---------------------------------------------------------------------------

export interface DraftErrors {
  category?: string;
  weight?: string;
  donor?: string;
}

/**
 * What the receiver still has to supply. Every one of these is refused again by
 * the server; the point of saying it here is that a volunteer at a tablet should
 * not learn about a missing store name from a round trip.
 */
export function validateDraft(draft: DonationDraft): DraftErrors {
  const errors: DraftErrors = {};

  if (draft.categoryId === null) errors.category = COPY.categoryRequired;

  const weight = draft.weight.trim();
  if (weight === '') errors.weight = COPY.weightRequired;
  else if (!isWeight(weight)) errors.weight = COPY.weightInvalid;

  // I16b, and the exact sentence the server refuses with — one copy, in
  // `shared/src/donation.ts`, so the two cannot drift apart.
  if (draft.reportable && !hasSource(draft)) errors.donor = DONATION_SOURCE_REQUIRED_MESSAGE;

  return errors;
}

export function isSubmittable(draft: DonationDraft): boolean {
  return Object.keys(validateDraft(draft)).length === 0;
}

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

function trimmedNote(draft: DonationDraft): string | null {
  const note = draft.note.trim();
  return note === '' ? null : note;
}

/**
 * The two source columns, derived from the one mode.
 *
 * On CREATE, an absent field simply means "no source", so the unused column is
 * left out entirely.
 */
function createSource(draft: DonationDraft): { donorId?: string; donorLabel?: string } {
  if (draft.sourceMode === 'MASTER' && draft.donorId !== null) return { donorId: draft.donorId };
  if (draft.sourceMode === 'LABEL') {
    const label = draft.donorLabel.trim();
    if (label !== '') return { donorLabel: label };
  }
  return {};
}

/**
 * The same two columns for CONFIRM, where the rule is different and the
 * difference matters: `confirmDonation` reads an ABSENT field as "keep what the
 * driver flagged" and an explicit `null` as "clear it". So a receiver switching a
 * prefilled store to a typed name must send `donorId: null` — omitting it would
 * silently keep the driver's store and be refused as "both".
 */
function confirmSource(draft: DonationDraft): {
  donorId: string | null;
  donorLabel: string | null;
} {
  if (draft.sourceMode === 'MASTER') return { donorId: draft.donorId, donorLabel: null };
  if (draft.sourceMode === 'LABEL') {
    const label = draft.donorLabel.trim();
    return { donorId: null, donorLabel: label === '' ? null : label };
  }
  return { donorId: null, donorLabel: null };
}

/** Gated on `isSubmittable`; the empty category would be refused by the server as
 *  a bad request rather than stored. */
export function createBody(draft: DonationDraft): CreateDonationRequest {
  return {
    ...createSource(draft),
    categoryId: draft.categoryId ?? '',
    weight: draft.weight.trim(),
    reportable: draft.reportable,
    note: trimmedNote(draft),
  };
}

export function confirmBody(draft: DonationDraft): ConfirmDonationRequest {
  return {
    ...confirmSource(draft),
    categoryId: draft.categoryId ?? '',
    weight: draft.weight.trim(),
    reportable: draft.reportable,
    note: trimmedNote(draft),
  };
}

// ---------------------------------------------------------------------------
// The worklist
// ---------------------------------------------------------------------------

export interface Worklist {
  /** `SUGGESTED` — a driver flagged it mid-run and it is waiting for weights.
   *  Shown first: these are the reason someone is on this screen. */
  pending: DonationSummary[];
  /** `CONFIRMED` and recent, so a correction is reachable without hunting. */
  recorded: DonationSummary[];
}

/** Newest first in both halves — the same ordering the inbox uses, and the one
 *  that puts the row a driver just flagged at the top of the list. */
function newestFirst(a: DonationSummary, b: DonationSummary): number {
  return b.createdAt.localeCompare(a.createdAt);
}

export function splitWorklist(rows: readonly DonationSummary[]): Worklist {
  return {
    pending: rows.filter((row) => row.status === 'SUGGESTED').sort(newestFirst),
    recorded: rows.filter((row) => row.status === 'CONFIRMED').sort(newestFirst),
  };
}

/** Replace one row in place, or prepend it if it is new. Every write returns the
 *  updated row, so the list stays right without a second round trip. */
export function upsertRow(
  rows: readonly DonationSummary[],
  row: DonationSummary,
): DonationSummary[] {
  const index = rows.findIndex((candidate) => candidate.id === row.id);
  if (index < 0) return [row, ...rows];
  const next = [...rows];
  next[index] = row;
  return next;
}

export function removeRow(rows: readonly DonationSummary[], id: string): DonationSummary[] {
  return rows.filter((row) => row.id !== id);
}

/** One line describing a row, for a list that has no room for a form. */
export function describeRow(row: DonationSummary): string {
  const weight = row.weight === null ? COPY.noWeightYet : weightWithUnit(row.weight);
  return `${row.categoryName} · ${weight}`;
}

/** Whether the receiver may still change this row. False once
 *  `receiver_edit_window_days` has passed, after which correcting it is a
 *  reporting job on S3.1 (Phase 3, build-plan D9). */
export function canEdit(row: DonationSummary): boolean {
  return row.editableByReceiver;
}

// ---------------------------------------------------------------------------
// Pickers
// ---------------------------------------------------------------------------

/** Active categories, alphabetical. The server already returns the active set;
 *  saying it again here means a tile the server would refuse can never be drawn. */
export function tileCategories(categories: readonly CategorySummary[]): CategorySummary[] {
  return categories.filter((category) => category.active).sort(byName);
}

/**
 * The donor list, alphabetical — plus, if a prefill points at a store that has
 * since been archived, that store, so the receiver can see what the driver
 * picked instead of an empty picker. The server refuses a deactivated donor at
 * confirm time and says so; hiding it here would just make the refusal baffling.
 */
export function pickableDonors(
  donors: readonly DonorSummary[],
  selectedId: string | null,
): DonorSummary[] {
  return donors
    .filter((donor) => donor.active || donor.id === selectedId)
    .sort(byName);
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name);
}

export function donorName(donors: readonly DonorSummary[], id: string | null): string | null {
  if (id === null) return null;
  return donors.find((donor) => donor.id === id)?.name ?? null;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** The server writes its own refusals to §7's rules (`DONATION_ON_ROUTE_MESSAGE`,
 *  `DONATION_SOURCE_REQUIRED_MESSAGE`, `DONATION_WINDOW_CLOSED_MESSAGE`), so when
 *  it sent one that is the sentence. Never a code (§6). */
export function messageFor(error: unknown): string {
  const apiError = toApiError(error);
  return apiError.detail ?? apiError.message;
}

/** Whether the failure means the list on screen is stale — another receiver
 *  confirmed the same prefill, or receive-done swept it (I17). Both are ordinary
 *  on a shared tablet and both are fixed by a re-read. */
export function shouldReloadAfter(error: unknown): boolean {
  const kind = toApiError(error).kind;
  return kind === 'conflict' || kind === 'not-found';
}

// ---------------------------------------------------------------------------
// Copy (§7: plain, short, second person; no jargon)
// ---------------------------------------------------------------------------

/** Forbidden in any UI string (`ui-ux-spec.md §7`). Pinned by a test rather than
 *  by good intentions. */
export const FORBIDDEN_IN_COPY = [
  'pwa',
  'push subscription',
  'session',
  'payload',
  'endpoint',
  'atomic',
  'instance',
] as const;

/**
 * Every sentence on this screen, in one place.
 *
 * `REPORTABLE_EXPLAINER`, `DONATION_SOURCE_REQUIRED_MESSAGE`,
 * `DONATION_ON_ROUTE_MESSAGE` and `DONATION_WINDOW_CLOSED_MESSAGE` are NOT
 * restated here. They live in `shared/src/donation.ts` and are used from there,
 * because the server refuses with the same words and a second copy would drift.
 */
export const COPY = {
  title: 'Unscheduled donation',
  lede: 'Food that arrived outside a planned pickup. One weight per kind of food.',
  loading: 'Loading donations',

  // --- the driver's prefills ---------------------------------------------
  pendingHeading: 'Waiting for weights',
  pendingHint: 'A driver flagged these on a run. Tap one to weigh it.',
  pendingLabel: 'Donations waiting for weights',
  noWeightYet: 'no weight yet',
  discard: 'Discard',
  discardQuestion: 'Throw this one away?',
  discardConsequence:
    'It disappears for good, and nothing is recorded for it. Only do this if no food arrived.',
  discardConfirm: 'Throw it away',
  discarded: 'Thrown away.',

  // --- the form -----------------------------------------------------------
  newHeading: 'Record a donation',
  editHeading: 'Weigh this donation',
  editHint: 'A driver started this one. Correct anything that looks wrong.',
  startOver: 'Start a new one',
  categoryLabel: 'What kind of food?',
  categoryRequired: 'Pick what kind of food this is.',
  noCategories: 'No kinds of food are set up yet.',
  noCategoriesHint: 'Ask an admin to add them, then come back.',
  weightLabel: 'Weight',
  weightKeypadLabel: 'Weight keypad',
  weightRequired: 'Type the weight.',
  weightInvalid: 'That is not a weight. Type pounds, like 128 or 12.5.',
  noteLabel: 'Note (optional)',
  submitNew: 'Submit',
  submitConfirm: 'Submit',
  savedNew: 'Donation recorded.',
  savedConfirm: 'Donation recorded.',

  // --- the report toggle --------------------------------------------------
  reportLabel: 'Report this to North Texas Food Bank',
  reportOn: 'Yes, report it',
  reportOff: 'No, ours only',
  reportGroupLabel: 'Report this donation to North Texas Food Bank',

  // --- the donor field ----------------------------------------------------
  sourceLabel: 'Where did it come from?',
  sourceGroupLabel: 'How to name where this came from',
  sourceMaster: 'From our list',
  sourceLabelMode: 'Type a name',
  sourceAnon: 'No name',
  donorListLabel: 'Stores',
  donorTypedLabel: 'Store or person',
  donorTypedHint: 'Whoever brought it. This is what the report will show.',
  donorAnonHint: 'Nobody is named. Allowed only when this is not reported.',
  noDonors: 'No stores are set up yet.',
  noDonorsHint: 'Type a name instead, or ask an admin to add the store.',
  archivedDonor: 'This store was removed from the list.',

  // --- what has been recorded --------------------------------------------
  recordedHeading: 'Recorded today',
  recordedLabel: 'Donations already recorded',
  reportedChip: 'Reported',
  notReportedChip: 'Ours only',
  stopReporting: 'Stop reporting it',
  startReporting: 'Report it',
  reportableSaved: 'Saved.',
  nothingYet: 'Nothing recorded yet.',

  // --- leaving ------------------------------------------------------------
  backToRuns: 'Back to the runs',
} as const;
