// API shapes for shift coverage — who owns a run.
//
// One capability group, four operations: a driver claims (`product-requirement.md`
// cap 6) and releases (cap 8); Staff assigns and unassigns (cap 6's fallback path).
// `domain-modeling.md §3.1` owns the transitions, §5.3 owns the recurring variants
// (`claim-all`, `release-one`, `release-range`), and I20 owns who may do the first.
//
// RULE, inherited from `shared/src/index.ts`: zero runtime dependencies. The only
// import below is a sibling file in this same package.
//
// Dates cross the wire as ISO-8601 instants; `occurrenceDate` crosses as
// `YYYY-MM-DD` in **pantry-local** time, because that is the calendar slot
// `data-model.md §5.3` stores and the frame `domain-modeling.md §5.2` states a
// window in. The client never converts — the server resolves against
// `app_config.timezone`.

import {
  ELIGIBILITY_REASONS,
  type EligibilityReason,
  type EligibilitySummary,
} from './availability.js';

// ---------------------------------------------------------------------------
// One run, as every coverage response names it
// ---------------------------------------------------------------------------

/** A shift touched by a coverage operation, in the shape S1.2/S1.3 render a row from. */
export interface CoveredShift {
  shiftId: string;
  /** `YYYY-MM-DD`, pantry-local — the calendar slot, not an instant. */
  occurrenceDate: string;
  /** ISO-8601 instant. */
  startsAt: string;
  /** ISO-8601 instant, exclusive — the window is half-open (`§5.2`). */
  endsAt: string;
  routeName: string;
}

// ---------------------------------------------------------------------------
// Claim (PRD cap 6, S1.2)
// ---------------------------------------------------------------------------

/**
 * S1.2: "Claiming prompts: 'Claim every Tuesday run, or just this one?'".
 *
 * - `ONE`    — this run only.
 * - `SERIES` — §5.3's `claim-all`: sets the pattern's `ownerDefault` and claims the
 *   existing future OPEN instances that pass `eligible()`. Conflicting ones are
 *   **skipped, never force-claimed** (PRD cap 6), and the driver is told which.
 */
export const CLAIM_SCOPES = ['ONE', 'SERIES'] as const;
export type ClaimScope = (typeof CLAIM_SCOPES)[number];

export interface ClaimRequest {
  /** Defaults to `ONE`. `SERIES` is offered only on a repeating run. */
  scope?: ClaimScope;
}

/**
 * Why one run in a `SERIES` claim did not go through.
 *
 * The eligibility reasons (I20's gate) plus one that is not an eligibility fact at
 * all: `NO_LONGER_OPEN` is the conditional UPDATE matching zero rows — the run was
 * claimed, cancelled or otherwise moved on between this claim reading the board and
 * writing to it (`data-model.md §9`).
 */
export const CLAIM_SKIP_REASONS = [...ELIGIBILITY_REASONS, 'NO_LONGER_OPEN'] as const;
export type ClaimSkipReason = EligibilityReason | 'NO_LONGER_OPEN';

export interface SkippedShift extends CoveredShift {
  reasons: ClaimSkipReason[];
}

export interface ClaimResult {
  scope: ClaimScope;
  claimed: CoveredShift[];
  /** Non-empty only for `SERIES` — a single claim is refused outright, never "skipped". */
  skipped: SkippedShift[];
  /** `claimed + skipped`: how many runs the claim considered. */
  requested: number;
  /** True when at least one run was skipped. S1.2 shows the summary only then. */
  partial: boolean;
  /** "Tuesday" for a weekly pattern; null for a one-off. */
  seriesLabel: string | null;
  /** The toast S1.2 specifies, rendered server-side so a non-browser caller gets it too. */
  summary: string;
}

/** 409 body when `eligible()` refuses a self-select claim (I20's hard gate). */
export interface ClaimRefusedResponse {
  error: 'NOT_ELIGIBLE';
  message: string;
  eligibility: EligibilitySummary;
}

/** 409 body when the run moved on first — S1.2/§6's optimistic-claim revert. */
export interface ShiftUnavailableResponse {
  error: 'SHIFT_UNAVAILABLE';
  message: string;
}

// ---------------------------------------------------------------------------
// Release (PRD cap 8, S1.3)
// ---------------------------------------------------------------------------

/**
 * S1.3: "Release just this one, or this and future?" with a date-range option.
 *
 * Both are §5.3's `release-one` / `release-range`: `CLAIMED → OPEN`, `ownerDefault`
 * untouched, the series still generating beyond the range (I23). Neither is staff's
 * bulk-terminate, which is terminal (`CANCELLED`) and not a driver capability.
 */
export const RELEASE_SCOPES = ['ONE', 'RANGE'] as const;
export type ReleaseScope = (typeof RELEASE_SCOPES)[number];

export interface ReleaseRequest {
  /** Defaults to `ONE`. */
  scope?: ReleaseScope;
  /** `YYYY-MM-DD`, pantry-local. Defaults to this run's own date. `RANGE` only. */
  fromDate?: string;
  /** `YYYY-MM-DD`, pantry-local, inclusive. Omit for "this and future". `RANGE` only. */
  toDate?: string | null;
}

export interface ReleaseResult {
  scope: ReleaseScope;
  released: CoveredShift[];
  summary: string;
}

// ---------------------------------------------------------------------------
// Staff assign / unassign (PRD cap 6 fallback, S1.6)
// ---------------------------------------------------------------------------

export interface AssignRequest {
  driverId: string;
  /**
   * S1.6's explicit confirmation. I20's exemption is "Staff sees a warning and must
   * explicitly confirm"; without this flag a conflicting assignment is answered 409
   * with the warning rather than written.
   */
  confirmConflict?: boolean;
}

export interface AssignResult {
  shift: CoveredShift;
  driverId: string;
  /** True when Staff confirmed through a conflict — drives S1.3's persistent banner. */
  assignedOverConflict: boolean;
}

/** 409 body when the assignment conflicts and Staff has not confirmed yet. */
export interface AssignConflictResponse {
  error: 'ASSIGN_CONFLICT';
  message: string;
  eligibility: EligibilitySummary;
}

export interface UnassignResult {
  shift: CoveredShift;
}

/** Staff's pre-confirm check (S1.6: the warning is surfaced *before* confirming). */
export interface EligibilityPreviewResponse {
  shiftId: string;
  driverId: string;
  eligibility: EligibilitySummary;
  /** The sentence S1.6 puts in front of Staff, or null when there is nothing to warn about. */
  warning: string | null;
}

// ---------------------------------------------------------------------------
// Copy
//
// Pure functions over the shapes above, so the server and any client render the same
// sentence. `ui-ux-spec.md §7`: plain, short, second person; the user's word is
// "run"; "instance" is forbidden vocabulary.
// ---------------------------------------------------------------------------

/** ISO weekday 1..7 → name (`data-model.md §5.2`: `weekdays smallint[]`, ISO dow). */
const WEEKDAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

/**
 * S1.2's "every Tuesday run", derived from the pattern's weekdays.
 *
 * A pattern may repeat on several days, which S1.2's one-day example does not cover:
 * two are named, three or more collapse to "repeating" rather than reciting a list in
 * a toast.
 */
export function weekdayLabel(weekdays: readonly number[]): string {
  const names = [...weekdays]
    .filter((d) => d >= 1 && d <= 7)
    .sort((a, b) => a - b)
    .map((d) => WEEKDAY_NAMES[d - 1]!);
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return 'repeating';
}

function runWord(count: number, label: string | null): string {
  const noun = count === 1 ? 'run' : 'runs';
  return label !== null ? `${label} ${noun}` : noun;
}

/**
 * The claim toast (S1.2).
 *
 * "A full-success claim (12 of 12) shows the normal, unremarkable success toast — the
 * partial-result summary only appears when at least one instance was skipped."
 */
export function claimSummary(result: Omit<ClaimResult, 'summary'>): string {
  if (result.scope === 'ONE') return "You're on this run.";

  const total = result.requested;
  const claimed = result.claimed.length;
  const skipped = result.skipped.length;
  const runs = runWord(total, result.seriesLabel);

  if (skipped === 0) return `You're on all ${total} ${runs}.`;
  if (claimed === 0) {
    return `No ${runs} could be claimed — ${skipped} skipped (conflicts with your schedule).`;
  }
  return `Claimed ${claimed} of ${total} ${runs} — ${skipped} skipped (conflicts with your schedule).`;
}

/** The release toast, in the driver's verb. S1.3 fixes the flow and the
 *  consequence, not the wording — and the consequence is the half that matters
 *  here, since "cancelled" alone would read as the run being off entirely. */
export function releaseSummary(released: readonly CoveredShift[]): string {
  if (released.length === 1) return "Run cancelled — it's back on the board.";
  return `Cancelled ${released.length} runs — they're back on the board.`;
}

/**
 * Why a claim was refused (I20's hard gate at claim time).
 *
 * No screen spells this out — S1.2 gives copy only for the lost-race revert — so the
 * two temporal reasons get the sentence S1.4 already uses for the mirror-image
 * refusal, and the rest fall back to one plain line.
 */
export function claimRefusedMessage(reasons: readonly EligibilityReason[]): string {
  if (reasons.includes('OWNED_SHIFT_OVERLAP')) {
    return 'You already have a run at that time — cancel it first.';
  }
  if (reasons.includes('AVAILABILITY_BLOCK')) {
    return "You marked yourself away then — clear that first if you can make it.";
  }
  return "You can't take that run.";
}

/**
 * §6's optimistic-claim revert: "That run was just taken by Karen."
 *
 * The name is the current owner's first name, which is public-within-org
 * (`product-requirement.md §2` — names are not PII), so no shaping applies.
 */
export function shiftUnavailableMessage(
  status: string,
  ownerFirstName: string | null,
): string {
  if (status === 'CANCELLED') return 'That run was cancelled.';
  if (ownerFirstName !== null && ownerFirstName !== '') {
    return `That run was just taken by ${ownerFirstName}.`;
  }
  return 'That run is no longer available.';
}

/**
 * S1.6's warning: "Karen marked herself away then — assign anyway?".
 *
 * Generalized to a neutral pronoun, since the screen's example names one person.
 * Returns null when nothing about the assignment needs confirming.
 */
export function assignWarningMessage(
  driverFirstName: string,
  reasons: readonly EligibilityReason[],
): string | null {
  const away = reasons.includes('AVAILABILITY_BLOCK');
  const busy = reasons.includes('OWNED_SHIFT_OVERLAP');
  if (away && busy) {
    return `${driverFirstName} marked themselves away then and already has another run — assign anyway?`;
  }
  if (away) return `${driverFirstName} marked themselves away then — assign anyway?`;
  if (busy) return `${driverFirstName} already has a run at that time — assign anyway?`;
  return null;
}
