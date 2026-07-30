// Metrics routes — PRD cap 16, `ui-ux-spec.md` S3.2.
//
// Parse, declare, shape. Read-only throughout: S3.2's "primary action: none
// destructive; this is read + export".
//
// `tier: 'ADMIN'` and not a duty, unlike the report. S3.2 says "User/device: admin",
// and PRD cap 16 opens "Admin sees per-store and total-intake metrics". Tiers are
// hierarchical (I1) so this is a floor rather than an equality — there is nothing
// above Admin, but writing it as a floor keeps the comparison the same shape as every
// other declaration in this directory.
//
// Mounted under `/metrics`, which no earlier module claims (A108).

import type { CoverageMetrics, IntakeMetrics } from '../../../shared/src/metrics.js';
import { coverageMetrics, intakeMetrics } from '../services/metrics.js';
import { defineRoute } from './registry.js';

const ADMIN = { tier: 'ADMIN' } as const;

/** A `YYYY-MM-DD` query param, or absent. The service validates the format and owns
 *  the default period — a route that invented one would be a second definition of
 *  "recently" free to disagree with the service's. */
function dateParam(query: Record<string, unknown>, key: string): string | undefined {
  const value = query[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export const metricsRoutes = [
  /**
   * Per-store intake, split reported vs unreported, with the previous equal-length
   * period for trend.
   *
   * The split is the point (PRD §3, "intake ≠ NTFB-reported"): this union ignores the
   * reportable flag entirely, which is the only reason unreported volume is a number
   * anyone can see.
   */
  defineRoute({
    method: 'get',
    path: '/metrics/intake',
    access: ADMIN,
    handler: async (req, res) => {
      const from = dateParam(req.query as Record<string, unknown>, 'from');
      const to = dateParam(req.query as Record<string, unknown>, 'to');
      const payload: IntakeMetrics = await intakeMetrics({
        ...(from !== undefined ? { from } : {}),
        ...(to !== undefined ? { to } : {}),
      });
      res.json(payload);
    },
  }),

  /**
   * Coverage failures — UNCLAIMED and NO_SHOW, derived on every request and never
   * stored (I7). Filterable by driver, route and period, which is what turns a count
   * into "this route keeps going unclaimed" (S3.2).
   */
  defineRoute({
    method: 'get',
    path: '/metrics/coverage',
    access: ADMIN,
    handler: async (req, res) => {
      const query = req.query as Record<string, unknown>;
      const from = dateParam(query, 'from');
      const to = dateParam(query, 'to');
      const driverId = dateParam(query, 'driverId');
      const routeId = dateParam(query, 'routeId');
      const payload: CoverageMetrics = await coverageMetrics({
        ...(from !== undefined ? { from } : {}),
        ...(to !== undefined ? { to } : {}),
        ...(driverId !== undefined ? { driverId } : {}),
        ...(routeId !== undefined ? { routeId } : {}),
      });
      res.json(payload);
    },
  }),
];
