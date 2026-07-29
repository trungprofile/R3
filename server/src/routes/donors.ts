// Donor master data — `product-requirement.md` cap 2, `ui-ux-spec.md S1.8`.
//
// Parse, declare, shape. Every domain rule (I21's removal branch, what counts as a
// name) lives in `services/donor.ts`; nothing here decides anything
// (`architecture.md §4.1`).

import type {
  CreateDonorRequest,
  DonorSummary,
  RemoveMasterResponse,
  UpdateDonorRequest,
} from '../../../shared/src/masters.js';
import { badRequest, notFound } from '../middleware/error.js';
import {
  createDonor,
  getDonor,
  listDonors,
  removeDonor,
  updateDonor,
  type DonorRecord,
} from '../services/donor.js';
import { body, defineRoute, optionalString, requiredString } from './registry.js';

/**
 * The response shape. `address` and `contact` go out WHOLE — `pii.ts` gates people,
 * not places, and the donor address is the pickup location a driver navigates to
 * (`CLAUDE.md`; scope note in `pii.ts`).
 */
function toSummary(row: DonorRecord): DonorSummary {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    contact: row.contact,
    note: row.note,
    // I21 — the flag travels with the record; a deactivated donor is preserved
    // everywhere it is referenced rather than vanishing.
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

/** A PATCH may clear `address`; it may not clear `name`, which is NOT NULL. */
function patchName(source: Record<string, unknown>): string | undefined {
  const name = optionalString(source, 'name');
  if (name === null) throw badRequest('A donor name is required.');
  return name;
}

export const donorRoutes = [
  /**
   * Any signed-in user. `product-requirement.md §2` withholds *creating and
   * deleting* donors from Volunteers, not seeing them: the driver's own screens
   * are built on the donor's address and contact, and the receiver sees the
   * store's permanent note. Reads default to the active set; the S1.8 admin list
   * asks for the rest with `?includeInactive=true`.
   */
  defineRoute({
    method: 'get',
    path: '/donors',
    access: { tier: 'VOLUNTEER' },
    handler: async (req, res) => {
      const rows = await listDonors({
        includeInactive: wantsInactive(req.query['includeInactive']),
      });
      const payload: DonorSummary[] = rows.map(toSummary);
      res.json(payload);
    },
  }),

  defineRoute({
    method: 'get',
    path: '/donors/:id',
    access: { tier: 'VOLUNTEER' },
    handler: async (req, res) => {
      const row = await getDonor(String(req.params['id']));
      if (!row) throw notFound('No such donor.');
      res.json(toSummary(row));
    },
  }),

  /** Admin only: `product-requirement.md §2` lists "donor & truck master data" in
   *  the Admin-only delta, and Staff explicitly "cannot create/delete permanent
   *  donors". Hierarchical by construction — the gate admits nobody above Admin. */
  defineRoute({
    method: 'post',
    path: '/donors',
    access: { tier: 'ADMIN' },
    handler: async (req, res) => {
      const input = body(req) as Record<string, unknown> & Partial<CreateDonorRequest>;
      const created = await createDonor({
        name: requiredString(input, 'name'),
        address: optionalString(input, 'address') ?? null,
        contact: optionalString(input, 'contact') ?? null,
        note: optionalString(input, 'note') ?? null,
      });
      res.status(201).json(toSummary(created));
    },
  }),

  /** Edit, plus §3.3's ACTIVE ⇄ DEACTIVATED toggle as `active`. I21 allows field
   *  edits at any time; the toggle is the only lifecycle move here. */
  defineRoute({
    method: 'patch',
    path: '/donors/:id',
    access: { tier: 'ADMIN' },
    handler: async (req, res) => {
      const input = body(req) as Record<string, unknown> & Partial<UpdateDonorRequest>;
      const name = patchName(input);
      const address = optionalString(input, 'address');
      const contact = optionalString(input, 'contact');
      const note = optionalString(input, 'note');
      const active = optionalBoolean(input, 'active');

      const updated = await updateDonor(String(req.params['id']), {
        ...(name !== undefined ? { name } : {}),
        ...(address !== undefined ? { address } : {}),
        ...(contact !== undefined ? { contact } : {}),
        ...(note !== undefined ? { note } : {}),
        ...(active !== undefined ? { active } : {}),
      });
      res.json(toSummary(updated));
    },
  }),

  /** I21 decides which removal actually happens; the client is told which. */
  defineRoute({
    method: 'delete',
    path: '/donors/:id',
    access: { tier: 'ADMIN' },
    handler: async (req, res) => {
      const payload: RemoveMasterResponse = {
        outcome: await removeDonor(String(req.params['id'])),
      };
      res.json(payload);
    },
  }),
];
