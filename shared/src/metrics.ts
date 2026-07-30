// API shapes for admin metrics — PRD cap 16, `ui-ux-spec.md` S3.2.
//
// Zero runtime dependencies.
//
// Two families of number live here and they answer different questions:
//
//   INTAKE     what came in, per store and in total, split reported vs unreported.
//              `metrics = weight_entry[NOT voided] ∪ unscheduled_donation[CONFIRMED]`
//              — note this union ignores `reportable` entirely, which is exactly what
//              makes "unreported volume" a number the pantry can see at all.
//
//   COVERAGE   which runs never happened. `MISSED` is NOT a stored state (I7); it is
//              `window passed ∧ status ∈ {OPEN, CLAIMED}`, split into UNCLAIMED (OPEN
//              — nobody took it) and NO_SHOW (CLAIMED — someone committed and flaked).
//              Derived read-only on every request; a stored flag would go stale the
//              moment a shift was claimed late.

// ---------------------------------------------------------------------------
// Intake
// ---------------------------------------------------------------------------

/** One store's row in S3.2's per-store table. */
export interface StoreIntake {
  /** Null for donations that carry a free-text label or no source at all. */
  donorId: string | null;
  /** The master donor's name, the free-text label, or the "unattributed" bucket
   *  anonymous walk-ins collapse into (`data-model.md §8`). */
  donorName: string;
  /** Everything received from this store in the period. */
  intake: string;
  /** The part that flows to NTFB. */
  reported: string;
  /** `intake − reported`. Stated rather than left to be worked out — PRD §3 wants
   *  these kept as two distinct, clearly labelled numbers everywhere. */
  unreported: string;
  /** Same store, previous period of equal length. Null when there is no prior data,
   *  which is different from zero and must not render as a 100% drop. */
  previousIntake: string | null;
}

export interface IntakeMetrics {
  /** `YYYY-MM-DD`, inclusive, pantry-local. */
  from: string;
  to: string;
  stores: StoreIntake[];
  totalIntake: string;
  totalReported: string;
  totalUnreported: string;
  /** The comparison period `previousIntake` is measured against. */
  previousFrom: string;
  previousTo: string;
}

// ---------------------------------------------------------------------------
// Coverage failures
// ---------------------------------------------------------------------------

/**
 * Why a run never happened. Derived from status + window, never stored (I7).
 *
 * The split is the whole point: an UNCLAIMED run is a scheduling problem (nobody was
 * available, or nobody saw it), a NO_SHOW is a person problem (someone took it and did
 * not turn up). Rolling them together loses the only distinction that suggests what to
 * do about it.
 */
export const COVERAGE_FAILURES = ['UNCLAIMED', 'NO_SHOW'] as const;
export type CoverageFailure = (typeof COVERAGE_FAILURES)[number];

export interface MissedRun {
  shiftId: string;
  failure: CoverageFailure;
  occurrenceDate: string;
  startsAt: string;
  routeId: string;
  routeName: string;
  /** Null for UNCLAIMED by construction — an OPEN shift has no owner. */
  ownerId: string | null;
  ownerName: string | null;
}

/** A driver's no-show tally — S3.2's "this driver has three no-shows this month". */
export interface DriverCoverage {
  ownerId: string;
  ownerName: string;
  noShows: number;
}

/** A route's unclaimed tally — "this route keeps going unclaimed". */
export interface RouteCoverage {
  routeId: string;
  routeName: string;
  unclaimed: number;
  noShows: number;
}

export interface CoverageMetrics {
  from: string;
  to: string;
  /** Every missed run in the period, newest first. The table under the counts. */
  runs: MissedRun[];
  unclaimedCount: number;
  noShowCount: number;
  /** Runs in the period that were scheduled at all — the denominator that turns a
   *  count into a rate, without this module deciding how to display it. */
  scheduledCount: number;
  byDriver: DriverCoverage[];
  byRoute: RouteCoverage[];
}

/** S3.2's filters. All optional; absent means "no filter". */
export interface CoverageQuery {
  from?: string;
  to?: string;
  driverId?: string;
  routeId?: string;
}
