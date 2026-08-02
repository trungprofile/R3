// S3.2's calls, all through the typed fetch layer.
//
// `fetch` is never called directly: a raw call would miss the sign-in cookie, the
// one error shape (§6) and the offline banner all at once (`api/client.ts`).
//
// Shapes come from `client/src/api/shared.ts`, the client's door into `shared/src`,
// and never from the `@r3/shared` specifier: inside a git worktree that resolves to
// the MAIN checkout's copy, so a package import would typecheck this lane against a
// different file than the one being written (A34 / A78).
//
// Nothing here is new server surface. `routes/metrics.ts` shipped before this
// screen; this file only names the two paths and the params they take. Both are
// `tier: 'ADMIN'` server-side, hierarchical (I1) — the client check that hides the
// nav entry is communication, never the rule (`architecture.md §4.5`).
//
// Every param is optional on the wire and omitting the dates gives the last 28 days
// (A179). This screen always sends them anyway, because the period is a control the
// admin can see and move: a request whose window was chosen by the server would
// disagree with the label above the table the moment they stepped back.

import { api } from '../../../../api/index.ts';
import type {
  CoverageMetrics,
  CoverageQuery,
  IntakeMetrics,
  RouteDetail,
  ShapedUser,
} from '../../../../api/shared.ts';
import type { Period } from './metrics.ts';

const withSignal = (signal?: AbortSignal) => (signal ? { signal } : {});

/**
 * Per-store intake, split reported vs unreported, with the previous equal-length
 * period for trend.
 *
 * The union behind this ignores the reportable flag entirely, which is the only
 * reason unreported volume is a number anyone can see (PRD §3, `domain-modeling.md
 * §6`). The report's union does filter on it — they are two endpoints because they
 * are two different questions.
 */
export function fetchIntake(period: Period, signal?: AbortSignal): Promise<IntakeMetrics> {
  return api.get<IntakeMetrics>('/metrics/intake', {
    query: { from: period.from, to: period.to },
    ...withSignal(signal),
  });
}

/**
 * Coverage failures — UNCLAIMED and NO_SHOW, derived on every request and never
 * stored (I7). A stored flag would go stale the moment a shift was claimed late,
 * so there is nothing to refresh here and nothing to write back.
 */
export function fetchCoverage(query: CoverageQuery, signal?: AbortSignal): Promise<CoverageMetrics> {
  return api.get<CoverageMetrics>('/metrics/coverage', {
    query: {
      ...(query.from !== undefined ? { from: query.from } : {}),
      ...(query.to !== undefined ? { to: query.to } : {}),
      ...(query.driverId !== undefined ? { driverId: query.driverId } : {}),
      ...(query.routeId !== undefined ? { routeId: query.routeId } : {}),
    },
    ...withSignal(signal),
  });
}

/** The driver picker's list. Filtered to the Drive duty on the client — duty is
 *  set membership (I2) and the server sends `duties` on every row (`driverOptions`). */
export function fetchUsers(signal?: AbortSignal): Promise<ShapedUser[]> {
  return api.get<ShapedUser[]>('/users', withSignal(signal));
}

/** The route picker's list, archived ones included: a route retired last month can
 *  still own a missed run inside the period being read. */
export function fetchRoutes(signal?: AbortSignal): Promise<RouteDetail[]> {
  return api.get<RouteDetail[]>('/routes', {
    query: { includeArchived: true },
    ...withSignal(signal),
  });
}
