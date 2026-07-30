// S3.2's Coverage tab — "counts of UNCLAIMED (window passed, never claimed) and
// NO_SHOW (claimed, never started) shifts, derived read-only (never stored, Domain
// I7) — filterable by driver, route, and period".
//
// THE SPLIT IS THE WHOLE VALUE. Two counts, two cards, two tallies, and a column
// in the table that names which happened. Rolled together the number says only
// "some runs did not happen"; split, an unclaimed run is a scheduling problem (put
// it on the board earlier, or ask who is free) and a no-show is a conversation
// with one person. Nothing on this tab ever shows their sum.
//
// NOTHING HERE IS EDITABLE. These figures are derived on every request and never
// stored (I7) — there is no row to correct, and a control offering to would be
// offering to change something that does not exist. A182: a run staff CANCELLED is
// neither failure, by construction, and the empty state says so rather than
// leaving an admin to wonder where a cancelled run went.
//
// Naming a volunteer's no-shows is a real thing to do carefully. The driver tally
// states the count and stops: no colour, no rank, no adjective (§7).

import { useCallback, useMemo, useState } from 'react';
import {
  Button,
  EmptyState,
  ErrorBlock,
  Segmented,
  SkeletonRows,
} from '../../../components/index.ts';
import { useAsyncData, useSession } from '../../../app/index.ts';
import type { CoverageMetrics, RouteDetail, ShapedUser } from '../../../api/shared.ts';
import { fetchCoverage, fetchRoutes, fetchUsers } from './api.ts';
import {
  ANY_FILTER,
  COPY,
  coverageCsv,
  coverageQueryFor,
  csvFilename,
  dayLabel,
  driverLine,
  driverOptions,
  driversByNoShows,
  failureExplainer,
  failureLabel,
  isFiltered,
  rateLabel,
  routeLine,
  routeOptions,
  routesByFailures,
  runOwnerLabel,
  startTimeLabel,
  type Period,
} from './metrics.ts';
import { downloadCsv } from './download.ts';

export interface CoverageTabProps {
  period: Period;
}

export function CoverageTab({ period }: CoverageTabProps) {
  const { timezone } = useSession();
  const [driverId, setDriverId] = useState<string>(ANY_FILTER);
  const [routeId, setRouteId] = useState<string>(ANY_FILTER);

  const loadCoverage = useCallback(
    (signal: AbortSignal) => fetchCoverage(coverageQueryFor(period, driverId, routeId), signal),
    [period, driverId, routeId],
  );
  const coverage = useAsyncData<CoverageMetrics>(loadCoverage);
  const metrics = coverage.data;

  // The two pickers' lists. Loaded once and not re-fetched when the period moves —
  // people and routes do not change with the window being read.
  const loadUsers = useCallback((signal: AbortSignal) => fetchUsers(signal), []);
  const loadRoutes = useCallback((signal: AbortSignal) => fetchRoutes(signal), []);
  const users = useAsyncData<ShapedUser[]>(loadUsers);
  const routes = useAsyncData<RouteDetail[]>(loadRoutes);

  const drivers = useMemo(() => driverOptions(users.data ?? []), [users.data]);
  const routeChoices = useMemo(() => routeOptions(routes.data ?? []), [routes.data]);
  const filtered = isFiltered(driverId, routeId);

  return (
    <div>
      <div className="s32-panel__head">
        <h2 className="s32-heading">{COPY.coverage.heading}</h2>
        {metrics !== null && metrics.runs.length > 0 ? (
          <Button
            variant="primary"
            onClick={() =>
              downloadCsv(
                csvFilename('coverage', period),
                coverageCsv(metrics, timezone ?? undefined),
              )
            }
          >
            {COPY.coverage.export}
          </Button>
        ) : null}
      </div>

      <p className="s32-lede">{COPY.coverage.lede}</p>

      {/* §1.5 rules out a dropdown where a visible list fits. Under ten users and
          a handful of routes fit, so both filters are a row of 44px buttons with
          every option on screen. */}
      <div className="s32-filters">
        <div>
          <p className="s32-filter__label">{COPY.coverage.filterDriverLabel}</p>
          <Segmented
            label={COPY.coverage.filterDriverLabel}
            options={drivers}
            value={driverId}
            onChange={setDriverId}
          />
        </div>
        <div>
          <p className="s32-filter__label">{COPY.coverage.filterRouteLabel}</p>
          <Segmented
            label={COPY.coverage.filterRouteLabel}
            options={routeChoices}
            value={routeId}
            onChange={setRouteId}
          />
        </div>
      </div>

      {coverage.showLoading && metrics === null ? (
        <SkeletonRows rows={6} label={COPY.coverage.loading} />
      ) : null}

      {coverage.error ? <ErrorBlock error={coverage.error} onRetry={coverage.reload} /> : null}

      {metrics !== null && !coverage.error ? (
        <>
          <Counts metrics={metrics} />
          {metrics.runs.length === 0 ? (
            <EmptyState
              title={filtered ? COPY.coverage.emptyFilteredTitle : COPY.coverage.emptyTitle}
              action={
                filtered ? (
                  <Button
                    onClick={() => {
                      setDriverId(ANY_FILTER);
                      setRouteId(ANY_FILTER);
                    }}
                  >
                    {COPY.coverage.clearFilters}
                  </Button>
                ) : null
              }
            >
              {filtered ? COPY.coverage.emptyFilteredBody : COPY.coverage.emptyBody}
            </EmptyState>
          ) : (
            <>
              <Tallies metrics={metrics} />
              <h3 className="s32-subheading">{COPY.coverage.runsHeading}</h3>
              <RunsTable metrics={metrics} timeZone={timezone} />
            </>
          )}
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The two counts
// ---------------------------------------------------------------------------

/** Two cards, side by side, each with the denominator that turns its count into a
 *  rate (`CoverageMetrics.scheduledCount`) — three no-shows against thirty runs
 *  and three against three are different facts. */
function Counts({ metrics }: { metrics: CoverageMetrics }) {
  const cards = [
    { failure: 'UNCLAIMED' as const, count: metrics.unclaimedCount },
    { failure: 'NO_SHOW' as const, count: metrics.noShowCount },
  ];

  return (
    <div className="s32-counts">
      {cards.map((card) => {
        const rate = rateLabel(card.count, metrics.scheduledCount);
        return (
          <div className="s32-count" key={card.failure}>
            <p className="s32-count__label">{failureLabel(card.failure)}</p>
            <p className="s32-count__value">{card.count}</p>
            {rate !== null ? <p className="s32-count__rate">{rate}</p> : null}
            <p className="s32-count__means">{failureExplainer(card.failure)}</p>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// By route, by driver — the patterns S3.2 names
// ---------------------------------------------------------------------------

function Tallies({ metrics }: { metrics: CoverageMetrics }) {
  const drivers = driversByNoShows(metrics.byDriver);
  const routes = routesByFailures(metrics.byRoute);

  return (
    <div className="s32-tallies">
      {/* "this route keeps going unclaimed" — both failures per route, side by
          side, because they ask for different things. */}
      <section className="s32-tally">
        <h3 className="s32-subheading">{COPY.coverage.byRouteHeading}</h3>
        {routes.length === 0 ? (
          <p className="s32-note">{COPY.coverage.byRouteEmpty}</p>
        ) : (
          <ul className="s32-tally__list">
            {routes.map((route) => (
              <li key={route.routeId}>
                <div className="s32-tally__row">
                  <span className="s32-tally__name">{route.routeName}</span>
                  <span className="s32-tally__count">{routeLine(route)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* "this driver has three no-shows this month" — the count, and nothing
          about the person. An unclaimed run has no driver to name, which the note
          says so the absence does not read as a gap. */}
      <section className="s32-tally">
        <h3 className="s32-subheading">{COPY.coverage.byDriverHeading}</h3>
        <p className="s32-note">{COPY.coverage.byDriverNote}</p>
        {drivers.length === 0 ? (
          <p className="s32-note">{COPY.coverage.byDriverEmpty}</p>
        ) : (
          <ul className="s32-tally__list">
            {drivers.map((driver) => (
              <li key={driver.ownerId}>
                <div className="s32-tally__row">
                  <span className="s32-tally__name">{driver.ownerName}</span>
                  <span className="s32-tally__count">{driverLine(driver)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Every missed run
// ---------------------------------------------------------------------------

function RunsTable({ metrics, timeZone }: { metrics: CoverageMetrics; timeZone: string | null }) {
  return (
    <div className="s32-table-wrap">
      <table className="s32-table">
        <thead>
          <tr>
            <th scope="col">{COPY.coverage.colDate}</th>
            <th scope="col">{COPY.coverage.colTime}</th>
            <th scope="col">{COPY.coverage.colRoute}</th>
            <th scope="col">{COPY.coverage.colFailure}</th>
            <th scope="col">{COPY.coverage.colDriver}</th>
          </tr>
        </thead>
        <tbody>
          {metrics.runs.map((run) => (
            <tr key={run.shiftId}>
              {/* The pantry-local calendar slot the run was scheduled in, never a
                  date derived from the instant — those disagree near midnight. */}
              <th scope="row">{dayLabel(run.occurrenceDate)}</th>
              <td>{startTimeLabel(run.startsAt, timeZone ?? undefined)}</td>
              <td>{run.routeName}</td>
              <td>{failureLabel(run.failure)}</td>
              <td>{runOwnerLabel(run)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
