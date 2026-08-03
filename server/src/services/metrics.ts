// Admin metrics — PRD cap 16, `ui-ux-spec.md` S3.2.
//
// Two families of number, answering different questions, and the doc is emphatic that
// they must not be conflated:
//
//   INTAKE    what came in, per store and in total, split reported vs unreported.
//             `metrics = weight_entry[NOT voided] ∪ unscheduled_donation[CONFIRMED]`
//             — this union ignores `reportable` ENTIRELY, which is the only reason
//             "unreported volume" is a number anyone can see. The report's union does
//             filter on it; keeping the two apart is the whole of "intake ≠
//             NTFB-reported" (PRD §3, `domain-modeling.md §6`).
//
//   COVERAGE  which runs never happened. `MISSED` is NOT a stored state (I7): it is
//             `window passed ∧ status ∈ {OPEN, CLAIMED}`, split UNCLAIMED (OPEN —
//             nobody took it) and NO_SHOW (CLAIMED — someone committed and flaked).
//             Derived on every request. A stored flag would be wrong the moment a
//             shift was claimed late, and there is no job that could keep it honest.
//
// Everything here is a read. No transaction, no writes, nothing to enforce — which is
// why this file holds no invariants of its own and cites the ones it must not break.

import { sql } from 'kysely';
import type {
  CoverageMetrics,
  DriverCoverage,
  IntakeMetrics,
  MissedRun,
  RouteCoverage,
  StoreIntake,
} from '../../../shared/src/metrics.js';
import { db } from '../db/index.js';
import { addDays, dayNumber, parseDate } from '../time.js';
import { isoDate } from './schedule.js';
import { addAll, currentWeek } from './report.js';

/**
 * The period a caller gets when they name none: THIS WEEK, Monday to Sunday (D39).
 *
 * It was the last 28 days, which `A179` recorded as a guess no doc ever settled —
 * four whole weeks, chosen so the previous-period comparison would be like-for-like
 * rather than a ragged month. **D39 answers A179**: the default is now the same
 * Monday-to-Sunday week S3.1 reports on (A178, `weekBounds`) and S1.2's board defaults
 * to, imported from `report.ts` rather than re-derived, so an admin with the report and
 * the metrics open cannot be shown two different weeks under one word.
 *
 * The like-for-like argument survives intact: the previous period is still computed
 * from the window's own LENGTH (`intakeMetrics` below), so a seven-day window compares
 * against the seven days before it. What is lost is the four-week default's smoothing,
 * and that is the trade — a default nobody chose, against a default that agrees with
 * every other screen. Explicit `from`/`to` still reach any window at all.
 */
async function defaultRange(): Promise<{ from: string; to: string }> {
  const { weekStart, weekEnd } = await currentWeek();
  return { from: weekStart, to: weekEnd };
}

function subtract(a: string, b: string): string {
  return addAll([a, `-${b}`]);
}

// ---------------------------------------------------------------------------
// Intake
// ---------------------------------------------------------------------------

/**
 * Per-store intake, with the previous equal-length period for trend.
 *
 * The union is written out twice — once for the period, once for the one before it —
 * rather than fetched in one pass and bucketed in JS, because the "previous period"
 * boundary is a date comparison Postgres already does correctly and JS would have to
 * be told about (`data-model.md §8`'s point about business days, again).
 *
 * `donorName` collapses the three source cases exactly as §8 says the report does:
 * master donor, free-text label, or one "Unattributed" bucket for anonymous walk-ins.
 * That bucket is the visible consequence of allowing a null source (I16b).
 */
export async function intakeMetrics(
  options: { from?: string; to?: string } = {},
): Promise<IntakeMetrics> {
  const fallback = await defaultRange();
  const from = options.from ? isoDate(parseDate(options.from, 'from')) : fallback.from;
  const to = options.to ? isoDate(parseDate(options.to, 'to')) : fallback.to;

  const span = dayNumber(parseDate(to, 'to')) - dayNumber(parseDate(from, 'from')) + 1;
  const previousTo = isoDate(addDays(parseDate(from, 'from'), -1));
  const previousFrom = isoDate(addDays(parseDate(previousTo, 'previousTo'), -(span - 1)));

  const current = await intakeRows(from, to);
  const previous = await intakeRows(previousFrom, previousTo);
  const previousByKey = new Map(previous.map((r) => [r.key, r.intake]));

  const stores: StoreIntake[] = current.map((row) => ({
    donorId: row.donorId,
    donorName: row.donorName,
    intake: row.intake,
    reported: row.reported,
    unreported: subtract(row.intake, row.reported),
    // Absent from the previous period is null, not "0.00" — a store that did not
    // exist yet must not render as a total collapse.
    previousIntake: previousByKey.get(row.key) ?? null,
  }));

  const totalIntake = addAll(stores.map((s) => s.intake));
  const totalReported = addAll(stores.map((s) => s.reported));

  return {
    from,
    to,
    stores,
    totalIntake,
    totalReported,
    totalUnreported: subtract(totalIntake, totalReported),
    previousFrom,
    previousTo,
  };
}

interface IntakeRow {
  key: string;
  donorId: string | null;
  donorName: string;
  intake: string;
  reported: string;
}

async function intakeRows(from: string, to: string): Promise<IntakeRow[]> {
  const rows = await sql<{
    donor_id: string | null;
    donor_name: string;
    intake: string;
    reported: string;
  }>`
    WITH intake AS (
      -- Planned intake. Always reportable (I15), so it counts toward both totals.
      SELECT we.donor_id,
             d.name        AS donor_name,
             we.weight,
             we.weight     AS reportable_weight
      FROM weight_entry we
      JOIN shift s ON s.id = we.shift_id
      JOIN donor d ON d.id = we.donor_id
      WHERE we.voided = FALSE
        AND s.occurrence_date BETWEEN ${from}::date AND ${to}::date

      UNION ALL

      -- Unplanned. No join to shift: a walk-in has none, and joining drops it
      -- (domain-modeling.md §6). The reportable flag decides only the second column.
      SELECT ud.donor_id,
             coalesce(d.name, ud.donor_label, 'Unattributed') AS donor_name,
             ud.weight,
             CASE WHEN ud.reportable THEN ud.weight ELSE 0 END AS reportable_weight
      FROM unscheduled_donation ud
      LEFT JOIN donor d ON d.id = ud.donor_id
      WHERE ud.status = 'CONFIRMED'
        AND ud.received_date BETWEEN ${from}::date AND ${to}::date
    )
    SELECT donor_id,
           donor_name,
           sum(weight)::text            AS intake,
           sum(reportable_weight)::text AS reported
    FROM intake
    GROUP BY donor_id, donor_name
    ORDER BY sum(weight) DESC, donor_name
  `.execute(db);

  return rows.rows.map((r) => ({
    // A free-text label and an anonymous bucket both have a null donor_id, so the
    // name is what distinguishes them.
    key: `${r.donor_id ?? ''}|${r.donor_name}`,
    donorId: r.donor_id,
    donorName: r.donor_name,
    intake: r.intake,
    reported: r.reported,
  }));
}

// ---------------------------------------------------------------------------
// Coverage failures (I7 — derived, never stored)
// ---------------------------------------------------------------------------

/**
 * Runs whose window passed without the run ever starting.
 *
 * `MISSED = window passed ∧ status ∈ {OPEN, CLAIMED}`. "Passed" is `ends_at < now()`:
 * the window is half-open `[start, end)` (`domain-modeling.md §5.2`), so a run is not
 * missed until its end has actually gone by — a shift in progress of being late is
 * still claimable.
 *
 * `CANCELLED` is excluded by the status filter and that is deliberate, not incidental:
 * a cancelled run is a decision, not a failure, and counting it as one would punish
 * staff for tidying the board.
 */
export async function coverageMetrics(
  query: { from?: string; to?: string; driverId?: string; routeId?: string } = {},
): Promise<CoverageMetrics> {
  const fallback = await defaultRange();
  const from = query.from ? isoDate(parseDate(query.from, 'from')) : fallback.from;
  const to = query.to ? isoDate(parseDate(query.to, 'to')) : fallback.to;
  const driverId = query.driverId ?? null;
  const routeId = query.routeId ?? null;

  const rows = await sql<{
    shift_id: string;
    failure: 'UNCLAIMED' | 'NO_SHOW';
    occurrence_date: string;
    starts_at: Date;
    route_id: string;
    route_name: string;
    owner_id: string | null;
    owner_name: string | null;
  }>`
    SELECT s.id                                     AS shift_id,
           CASE s.status WHEN 'OPEN' THEN 'UNCLAIMED' ELSE 'NO_SHOW' END AS failure,
           to_char(s.occurrence_date, 'YYYY-MM-DD') AS occurrence_date,
           s.starts_at,
           s.route_id,
           r.name                                   AS route_name,
           s.owner_id,
           concat_ws(' ', u.first_name, u.last_name) AS owner_name
    FROM shift s
    JOIN route r      ON r.id = s.route_id
    LEFT JOIN app_user u ON u.id = s.owner_id
    WHERE s.status IN ('OPEN', 'CLAIMED')
      AND s.ends_at < now()
      AND s.occurrence_date BETWEEN ${from}::date AND ${to}::date
      AND (${driverId}::uuid IS NULL OR s.owner_id = ${driverId}::uuid)
      AND (${routeId}::uuid  IS NULL OR s.route_id = ${routeId}::uuid)
    ORDER BY s.occurrence_date DESC, s.starts_at DESC
  `.execute(db);

  const runs: MissedRun[] = rows.rows.map((r) => ({
    shiftId: r.shift_id,
    failure: r.failure,
    occurrenceDate: r.occurrence_date,
    startsAt: r.starts_at.toISOString(),
    routeId: r.route_id,
    routeName: r.route_name,
    ownerId: r.owner_id,
    ownerName: r.owner_name === null || r.owner_name === '' ? null : r.owner_name,
  }));

  // The denominator. Everything scheduled in the period whatever became of it, so a
  // count of three no-shows can be read against three runs or against thirty.
  const scheduled = await db
    .selectFrom('shift')
    .select(({ fn }) => fn.countAll<string>().as('count'))
    .where(sql<boolean>`shift.occurrence_date BETWEEN ${from}::date AND ${to}::date`)
    .where('shift.status', '!=', 'CANCELLED')
    .$if(driverId !== null, (qb) => qb.where('shift.owner_id', '=', driverId))
    .$if(routeId !== null, (qb) => qb.where('shift.route_id', '=', routeId))
    .executeTakeFirstOrThrow();

  const byDriver = new Map<string, DriverCoverage>();
  const byRoute = new Map<string, RouteCoverage>();

  for (const run of runs) {
    if (run.failure === 'NO_SHOW' && run.ownerId !== null) {
      const entry = byDriver.get(run.ownerId) ?? {
        ownerId: run.ownerId,
        ownerName: run.ownerName ?? 'Unknown',
        noShows: 0,
      };
      entry.noShows += 1;
      byDriver.set(run.ownerId, entry);
    }

    const route = byRoute.get(run.routeId) ?? {
      routeId: run.routeId,
      routeName: run.routeName,
      unclaimed: 0,
      noShows: 0,
    };
    if (run.failure === 'UNCLAIMED') route.unclaimed += 1;
    else route.noShows += 1;
    byRoute.set(run.routeId, route);
  }

  return {
    from,
    to,
    runs,
    unclaimedCount: runs.filter((r) => r.failure === 'UNCLAIMED').length,
    noShowCount: runs.filter((r) => r.failure === 'NO_SHOW').length,
    scheduledCount: Number(scheduled.count),
    byDriver: [...byDriver.values()].sort((a, b) => b.noShows - a.noShows),
    byRoute: [...byRoute.values()].sort(
      (a, b) => b.unclaimed + b.noShows - (a.unclaimed + a.noShows),
    ),
  };
}
