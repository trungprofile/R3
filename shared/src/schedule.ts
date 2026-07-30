// API shapes for scheduling — publishing shifts, recurrence patterns, reschedule,
// cancel (`product-requirement.md` caps 4 and 9, `ui-ux-spec.md S1.6`/`S1.7`/`S1.2`).
//
// Same rule as `shared/src/index.ts`: zero runtime dependencies. Types and plain
// values only; nothing here imports from `server`.
//
// Two time frames cross the wire and they are not interchangeable:
//
//   * `YYYY-MM-DD` + `HH:MM` — pantry-local calendar date and wall clock. This is the
//     frame staff schedule in, and the frame `domain-modeling.md §5.3` states a
//     pattern's rule times in ("LOCAL wall-clock, converted to instants only at
//     materialization via `app_config.timezone`", `data-model.md §5.2`). The client
//     never converts; a driver whose phone is in another zone cannot shift the
//     pantry's day.
//   * ISO-8601 instants — what is stored on `shift.starts_at` / `ends_at` and what a
//     board renders. Resolved by the server, once, against `app_config.timezone`.
//
// Vocabulary: the domain says "shift", the UI says "run" (`ui-ux-spec.md §7`). Field
// names follow the domain; user-facing strings follow the UI.

import type { ShiftStatus } from './index.js';

// ---------------------------------------------------------------------------
// Shifts
// ---------------------------------------------------------------------------

/** One planned stop, read from the route TEMPLATE. Not a `ShiftStop`: I5 puts those
 *  rows on the shift only from `IN_PROGRESS` onward, so a scheduled-but-unstarted
 *  run has none and its stop list is still the route's. */
export interface PlannedStop {
  donorId: string;
  donorName: string;
  /** Operational data, never trimmed — `pii.ts` gates people, not places. */
  donorAddress: string | null;
  position: number;
}

/** A shift as the board (`S1.2`) and the staff scheduler (`S1.6`) read it. */
export interface ShiftSummary {
  id: string;
  routeId: string;
  routeName: string;
  /** `YYYY-MM-DD`, pantry-local — the calendar slot, not an instant. */
  occurrenceDate: string;
  /** ISO-8601 instant. */
  startsAt: string;
  /** ISO-8601 instant, exclusive: the window is half-open (`domain-modeling.md §5.2`). */
  endsAt: string;
  /** I7. `MISSED` is never here — it is derived at read time by the reporting doc. */
  status: ShiftStatus;
  ownerId: string | null;
  /** Names are public-within-org (`product-requirement.md §2`) and never PII-shaped. */
  ownerName: string | null;
  truckName: string | null;
  /** Non-null ⇒ minted from a pattern; drives S1.2's "repeats weekly" tag. */
  recurrencePatternId: string | null;
  /** I20's staff-assign exemption: staff confirmed through a conflict when setting
   *  this owner. Drives S1.3's persistent banner. */
  assignedOverConflict: boolean;
  /** Coordinator→driver note (PRD cap 11, channel 1). */
  staffNote: string | null;
  /** Driver's whole-run note (PRD cap 11, channel 3). */
  note: string | null;
  /** I27 handoff milestone. Set does NOT mean completed — the shift stays IN_PROGRESS. */
  pickupCompletedAt: string | null;
}

export interface ShiftDetail extends ShiftSummary {
  /** The route's ordered stops. See `PlannedStop`: template rows, not I5 snapshots. */
  plannedStops: PlannedStop[];
}

/**
 * Publish a one-off shift (`S1.6`: "date/time, route"). No truck field — the driver
 * picks one at start (I8), and no owner field — a shift exists independently of any
 * driver (PRD cap 4); claiming and staff-assign are cap 6.
 */
export interface CreateShiftRequest {
  routeId: string;
  /** `YYYY-MM-DD`, pantry-local. */
  date: string;
  /** `HH:MM`, pantry-local. */
  startTime: string;
  /** `HH:MM`, pantry-local, strictly later in the same day. */
  endTime: string;
  staffNote?: string | null;
}

/**
 * A run that already exists with the same date, window and stop set, published from a
 * different pattern (`data-model.md §5.3` `real_conflict`).
 *
 * A **soft** check, deliberately: cross-pattern overlapping runs are legitimate, so
 * this is surfaced to the staff member who is standing there and never blocks the
 * write. There is no unique index behind it, and the rolling materialization job
 * never runs it at all.
 */
export interface DuplicateRunWarning {
  shiftId: string;
  occurrenceDate: string;
  routeName: string;
  startsAt: string;
  endsAt: string;
}

export interface CreateShiftResponse {
  shift: ShiftDetail;
  /** Empty in the ordinary case. Non-empty is a warning, not a refusal. */
  duplicates: DuplicateRunWarning[];
}

/**
 * Edit one instance (`domain-modeling.md §5.3` `edit-one`). I23: this never reaches
 * the pattern, whether or not the shift was minted from one.
 *
 * Date and time are not here — moving a run is a reschedule (cap 9), which has to
 * surface the owner's conflicts before it can go through.
 */
export interface UpdateShiftRequest {
  /** `null` clears it; absent leaves it alone. */
  staffNote?: string | null;
}

/**
 * Move a shift's date/time (PRD cap 9, `S1.7`).
 *
 * `confirmRelease` is the second half of the flow: when the new window conflicts with
 * the owner's declared availability or another run of theirs, the first call is
 * refused with the conflicts attached, and only an explicit confirmation moves the
 * shift **and releases the owner** back to the board. The system never auto-selects a
 * replacement.
 */
export interface RescheduleShiftRequest {
  date: string;
  startTime: string;
  endTime: string;
  confirmRelease?: boolean;
}

export interface RescheduleShiftResponse {
  shift: ShiftSummary;
  /** True when the owner was released by a confirmed conflict (cap 9). */
  released: boolean;
}

/** One reason the owner should not be kept on the new window. */
export interface RescheduleConflict {
  kind: 'AVAILABILITY_BLOCK' | 'OWNED_SHIFT';
  startsAt: string;
  endsAt: string;
  /** Present for `OWNED_SHIFT`. */
  shiftId?: string;
  routeName?: string;
}

export interface RescheduleConflictResponse {
  error: 'RESCHEDULE_CONFLICT';
  message: string;
  conflicts: RescheduleConflict[];
}

/**
 * `S1.7`'s warning, which is explicit about the consequence: "Karen marked herself
 * away then. Moving this releases her run back to the board."
 *
 * Built here so the server and the client cannot word it differently. Third person
 * plural rather than a guessed pronoun — the schema stores no gender.
 */
export function rescheduleConflictMessage(
  ownerName: string,
  kinds: readonly RescheduleConflict['kind'][],
): string {
  const cause = kinds.includes('AVAILABILITY_BLOCK')
    ? `${ownerName} marked themselves away then.`
    : `${ownerName} already has a run then.`;
  return `${cause} Moving this releases their run back to the board.`;
}

export interface CancelShiftResponse {
  shift: ShiftSummary;
}

// ---------------------------------------------------------------------------
// Recurrence patterns
// ---------------------------------------------------------------------------

/** ISO weekday numbers, 1 = Monday … 7 = Sunday (`data-model.md §5.2`). */
export const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export interface RecurrencePatternSummary {
  id: string;
  routeId: string;
  routeName: string;
  /** ISO weekdays, ascending. At least one (`ck_rp_weekdays`). */
  weekdays: number[];
  /** `HH:MM`, pantry-local wall clock — never an instant (`data-model.md §5.2`). */
  startTime: string;
  endTime: string;
  /** `YYYY-MM-DD` or null. The ONLY stop condition: there is deliberately no
   *  separate active/paused flag (`domain-modeling.md §5.3`). */
  endDate: string | null;
  /** "Claim all future" target. Set by claim-all ONLY, and not at create.
   *  Staff-assign is per-run: it writes `shift.owner_id` and never this
   *  (`domain-modeling.md §5.3`'s Operations table lists only claim-all, and PRD
   *  cap 6 gives staff-assign "the same owner field as self-select"). There is no
   *  endpoint that sets a series-level default on staff's behalf, by design. */
  ownerDefaultId: string | null;
  ownerDefaultName: string | null;
  createdAt: string;
}

/**
 * Create a weekly pattern (`S1.6`: "Every Tuesday, starting __, no end" or an end
 * date). Materialization is eager to the horizon, so creating one immediately mints
 * every instance in range (`domain-modeling.md §5.3`).
 *
 * **There is no `startDate`.** A series begins when it is created. `domain-modeling.md
 * §5.3` gives the rule exactly three parts — weekly on {days}, time-of-day, route —
 * plus `ownerDefault` and `endDate`, and states one stop condition and one lower bound
 * (`for each occurrence date D in [now, horizon]`). `data-model.md §5.2` has no
 * `start_date` column to hold one. A start date accepted here could therefore only be
 * honoured by the create call: the rolling sweep asks the database "which occurrences
 * in range have no row?" (`architecture.md §4.4`), has nothing to read a start date
 * from, and would back-fill every skipped date on its next pass. S1.6's "starting __"
 * is the sentence naming when the series begins, which for an eagerly-materialized
 * pattern created now is today.
 */
export interface CreatePatternRequest {
  routeId: string;
  weekdays: number[];
  startTime: string;
  endTime: string;
  /** Omitted or null = open-ended. */
  endDate?: string | null;
}

export interface CreatePatternResponse {
  pattern: RecurrencePatternSummary;
  /** How many instances the eager materialization minted. */
  materialized: number;
  duplicates: DuplicateRunWarning[];
}

/**
 * Edit the pattern itself (`S1.6`'s "Edit the weekly pattern", as opposed to "Edit
 * just this date"). I24: this is the only thing that changes a pattern.
 */
export interface UpdatePatternRequest {
  routeId?: string;
  weekdays?: number[];
  startTime?: string;
  endTime?: string;
  /** `null` clears the end date, reopening an open-ended series. */
  endDate?: string | null;
}

export interface UpdatePatternResponse {
  pattern: RecurrencePatternSummary;
  /** The same soft check as create: `data-model.md §5.3` surfaces `real_conflict` at
   *  pattern create **and edit**, both being the moments a staff member is standing
   *  there to judge it. Never blocks. */
  duplicates: DuplicateRunWarning[];
  /** Future unclaimed instances moved onto the new window. */
  moved: number;
  /**
   * Future instances with an owner, left exactly where they were. Moving an owned run
   * is cap 9 and requires staff to see that driver's conflicts and confirm, which a
   * pattern edit cannot do on their behalf.
   */
  ownedInstances: ShiftSummary[];
  /**
   * Future instances that the edited pattern would no longer generate — a dropped
   * weekday, or a date past a new end date. Left in place: neither stop condition
   * retracts already-materialized instances (`domain-modeling.md §5.3`), so ending
   * part of a series is staff's explicit bulk-terminate.
   */
  offPatternInstances: ShiftSummary[];
  /** Instances minted for weekdays the edit added. */
  materialized: number;
}

/**
 * Staff-only bulk-terminate (`domain-modeling.md §5.3`): `CANCELLED` (terminal) on a
 * pattern's instances in `[fromDate, toDate]`.
 *
 * NOT the driver's release-range, which returns instances to `OPEN` and is cap 8.
 * This one permanently kills those runs — a store closed, a route retired — and the
 * pattern keeps generating beyond the range unless staff also sets `endDate`.
 */
export interface BulkTerminateRequest {
  fromDate: string;
  toDate: string;
}

export interface BulkTerminateResponse {
  cancelled: number;
}
