// Truck master data — `product-requirement.md` cap 3, `ui-ux-spec.md S1.8`.
//
// Parse, declare, shape. The domain rules are in `services/truck.ts`.

import type {
  CreateTruckRequest,
  RemoveMasterResponse,
  TruckSummary,
  UpdateTruckRequest,
} from '../../../shared/src/masters.js';
import { badRequest, notFound } from '../middleware/error.js';
import {
  createTruck,
  getTruck,
  listTrucks,
  removeTruck,
  updateTruck,
  type TruckRecord,
} from '../services/truck.js';
import { body, defineRoute, optionalString, requiredString } from './registry.js';

function toSummary(row: TruckRecord): TruckSummary {
  return {
    id: row.id,
    truckName: row.truck_name,
    plate: row.plate,
    // I21 — deactivated trucks are preserved on every shift that used them.
    active: row.deactivated_at === null,
    createdAt: row.created_at.toISOString(),
  };
}

function wantsInactive(value: unknown): boolean {
  return value === 'true';
}

function optionalBoolean(
  source: Record<string, unknown>,
  field: string,
): boolean | undefined {
  const value = source[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw badRequest(`${field} must be true or false.`);
  return value;
}

function patchName(source: Record<string, unknown>): string | undefined {
  const name = optionalString(source, 'truckName');
  if (name === null) throw badRequest('A truck name is required.');
  return name;
}

export const truckRoutes = [
  /**
   * Any signed-in user: the driver picks a truck at route start (cap 3), so the
   * list cannot be Admin-gated. Default is the active set — an inactive truck is
   * hidden from driver selection (`domain-modeling.md §3.3`) — and the S1.8 admin
   * list passes `?includeInactive=true`.
   */
  defineRoute({
    method: 'get',
    path: '/trucks',
    access: { tier: 'VOLUNTEER' },
    handler: async (req, res) => {
      const rows = await listTrucks({
        includeInactive: wantsInactive(req.query['includeInactive']),
      });
      const payload: TruckSummary[] = rows.map(toSummary);
      res.json(payload);
    },
  }),

  defineRoute({
    method: 'get',
    path: '/trucks/:id',
    access: { tier: 'VOLUNTEER' },
    handler: async (req, res) => {
      const row = await getTruck(String(req.params['id']));
      if (!row) throw notFound('No such truck.');
      res.json(toSummary(row));
    },
  }),

  /** Admin only: "donor & truck master data" is in `product-requirement.md §2`'s
   *  Admin-only delta. */
  defineRoute({
    method: 'post',
    path: '/trucks',
    access: { tier: 'ADMIN' },
    handler: async (req, res) => {
      const input = body(req) as Record<string, unknown> & Partial<CreateTruckRequest>;
      const created = await createTruck({
        truckName: requiredString(input, 'truckName'),
        plate: optionalString(input, 'plate') ?? null,
      });
      res.status(201).json(toSummary(created));
    },
  }),

  /** Edit, plus §3.3's ACTIVE ⇄ INACTIVE toggle as `active`. */
  defineRoute({
    method: 'patch',
    path: '/trucks/:id',
    access: { tier: 'ADMIN' },
    handler: async (req, res) => {
      const input = body(req) as Record<string, unknown> & Partial<UpdateTruckRequest>;
      const truckName = patchName(input);
      const plate = optionalString(input, 'plate');
      const active = optionalBoolean(input, 'active');

      const updated = await updateTruck(String(req.params['id']), {
        ...(truckName !== undefined ? { truckName } : {}),
        ...(plate !== undefined ? { plate } : {}),
        ...(active !== undefined ? { active } : {}),
      });
      res.json(toSummary(updated));
    },
  }),

  /** I21 decides which removal actually happens; the client is told which. */
  defineRoute({
    method: 'delete',
    path: '/trucks/:id',
    access: { tier: 'ADMIN' },
    handler: async (req, res) => {
      const payload: RemoveMasterResponse = {
        outcome: await removeTruck(String(req.params['id'])),
      };
      res.json(payload);
    },
  }),
];
