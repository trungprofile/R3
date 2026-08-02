// Pickup route templates — `product-requirement.md` cap 4, `ui-ux-spec.md S1.6`.
//
// Every declaration is `{ tier: 'STAFF' }`. Cap 4 gives route definition and
// editing to Staff ("Staff publishes pickup shifts ... and defines/edits routes as
// ordered stores"), and the comparison is hierarchical (I1), so Admin is admitted
// by the same declaration — never by a second one.
//
// Parse, declare, shape. No domain rules live here (`architecture.md §4.1`); the
// route builder's rules are all in `services/pickup-route.ts`.
//
// Imported by RELATIVE path, not as `@r3/shared`: inside a git worktree
// `node_modules/@r3/shared` resolves to the main checkout's copy, so a package
// import would typecheck this lane against a different tree (open assumption A34).

import type {
  RemoveRouteResponse,
  RouteDetail,
  RouteStopSummary,
} from '../../../shared/src/routes.js';
import { notFound } from '../middleware/error.js';
import {
  createRoute,
  getRoute,
  listRoutes,
  removeRoute,
  restoreRoute,
  updateRoute,
  type RouteWithStops,
} from '../services/pickup-route.js';
import { body, defineRoute } from './registry.js';

/**
 * Response shaping. Donor `name` and `address` are carried straight through:
 * `pii.ts` gates people, not places (`CLAUDE.md`) — a donor's address is
 * operational data the builder and the driver both need.
 */
function shapeRoute({ route, stops }: RouteWithStops): RouteDetail {
  const shapedStops: RouteStopSummary[] = stops.map((stop) => ({
    id: stop.id,
    donorId: stop.donor_id,
    donorName: stop.donor_name,
    donorAddress: stop.donor_address,
    donorActive: stop.donor_deactivated_at === null,
    position: stop.position,
  }));

  return {
    id: route.id,
    name: route.name,
    // D19 — the note a run published on this route starts with. A default, not a
    // fifth note channel; see `shared/src/routes.ts`.
    defaultStaffNote: route.default_staff_note,
    // ACTIVE ⇄ ARCHIVED (`domain-modeling.md §3.3`).
    active: route.deactivated_at === null,
    stopCount: shapedStops.length,
    createdAt: route.created_at.toISOString(),
    stops: shapedStops,
  };
}

/** `?includeArchived=true` — anything else, including absent, means active only. */
function wantsArchived(value: unknown): boolean {
  return value === 'true' || value === '1';
}

export const pickupRouteRoutes = [
  defineRoute({
    method: 'get',
    path: '/routes',
    access: { tier: 'STAFF' },
    handler: async (req, res) => {
      const routes = await listRoutes({
        includeArchived: wantsArchived(req.query['includeArchived']),
      });
      res.json(routes.map(shapeRoute));
    },
  }),

  defineRoute({
    method: 'get',
    path: '/routes/:id',
    access: { tier: 'STAFF' },
    handler: async (req, res) => {
      const route = await getRoute(String(req.params['id']));
      if (!route) throw notFound('No such route.');
      res.json(shapeRoute(route));
    },
  }),

  /** Create. `stops` is an ordered list of donor ids; positions are the server's
   *  to assign, so the client never sends one. */
  defineRoute({
    method: 'post',
    path: '/routes',
    access: { tier: 'STAFF' },
    handler: async (req, res) => {
      const input = body(req);
      const created = await createRoute({
        name: input['name'] as string,
        stops: input['stops'] as string[],
        defaultStaffNote: (input['defaultStaffNote'] as string | null | undefined) ?? null,
      });
      res.status(201).json(shapeRoute(created));
    },
  }),

  /** Edit. A present `stops` replaces the whole ordered list — one save covers
   *  add, remove and the S1.6 drag-and-drop reorder together. */
  defineRoute({
    method: 'patch',
    path: '/routes/:id',
    access: { tier: 'STAFF' },
    handler: async (req, res) => {
      const input = body(req);
      const updated = await updateRoute(String(req.params['id']), {
        ...(input['name'] !== undefined ? { name: input['name'] as string } : {}),
        ...(input['stops'] !== undefined ? { stops: input['stops'] as string[] } : {}),
        ...(input['defaultStaffNote'] !== undefined
          ? { defaultStaffNote: input['defaultStaffNote'] as string | null }
          : {}),
      });
      res.json(shapeRoute(updated));
    },
  }),

  /** `domain-modeling.md §3.3` decides which removal happens; the client is told
   *  which, the same way account removal reports it. */
  defineRoute({
    method: 'delete',
    path: '/routes/:id',
    access: { tier: 'STAFF' },
    handler: async (req, res) => {
      const outcome = await removeRoute(String(req.params['id']));
      const payload: RemoveRouteResponse = { outcome };
      res.json(payload);
    },
  }),

  /** ACTIVE ⇄ ARCHIVED is a toggle, not a one-way door. */
  defineRoute({
    method: 'post',
    path: '/routes/:id/restore',
    access: { tier: 'STAFF' },
    handler: async (req, res) => {
      res.json(shapeRoute(await restoreRoute(String(req.params['id']))));
    },
  }),
];
