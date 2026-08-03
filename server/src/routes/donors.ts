// Donor master data — `product-requirement.md` cap 2, `ui-ux-spec.md S1.8`.
//
// Parse, declare, shape. Every domain rule (I21's removal branch, what counts as a
// name) lives in `services/donor.ts`; nothing here decides anything
// (`architecture.md §4.1`).

import type {
  CreateDonorRequest,
  DonorSummary,
  RemoveMasterResponse,
  SetDonorPhotoRequest,
  UpdateDonorRequest,
} from '../../../shared/src/masters.js';
import { badRequest, notFound } from '../middleware/error.js';
import {
  createDonor,
  getDonor,
  getDonorPhoto,
  listDonors,
  removeDonor,
  setDonorPhoto,
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
    // D20 — both are operational, like `address`: a driver looking for a loading
    // dock needs them, so neither goes near `pii.ts`. The photo itself is not
    // here; this is only whether one exists.
    mapUrl: row.map_url,
    hasPhoto: row.has_photo,
    // Both operational, like `address`. The NTFB number is what the reporter types
    // into Meal Connect's donor picker, and the rates decide what the printed receipt
    // deducts (D27) — neither is a person's data and neither goes near `pii.ts`.
    ntfbDonorCode: row.ntfb_donor_code,
    // Kysely hands back `numeric` as a string. Passed through as one: a `numeric(5,4)`
    // that becomes a float here has already lost the exactness the column exists for.
    trashRateBakery: row.trash_rate_bakery,
    trashRateProduce: row.trash_rate_produce,
    trashRateDeli: row.trash_rate_deli,
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
        mapUrl: optionalString(input, 'mapUrl') ?? null,
        ntfbDonorCode: optionalString(input, 'ntfbDonorCode') ?? null,
        // D27. What counts as a rate is a domain rule and lives in the service
        // (`architecture.md §4.1`); this only says the field is text or null.
        trashRateBakery: optionalString(input, 'trashRateBakery') ?? null,
        trashRateProduce: optionalString(input, 'trashRateProduce') ?? null,
        trashRateDeli: optionalString(input, 'trashRateDeli') ?? null,
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
      const mapUrl = optionalString(input, 'mapUrl');
      const ntfbDonorCode = optionalString(input, 'ntfbDonorCode');
      // D27 — absent and `null` are different edits here ("leave it" vs "back to the
      // pantry default"), so the spread below has to preserve the distinction rather
      // than collapse it with `?? null` the way the POST does.
      const trashRateBakery = optionalString(input, 'trashRateBakery');
      const trashRateProduce = optionalString(input, 'trashRateProduce');
      const trashRateDeli = optionalString(input, 'trashRateDeli');
      const active = optionalBoolean(input, 'active');

      const updated = await updateDonor(String(req.params['id']), {
        ...(name !== undefined ? { name } : {}),
        ...(address !== undefined ? { address } : {}),
        ...(contact !== undefined ? { contact } : {}),
        ...(note !== undefined ? { note } : {}),
        ...(mapUrl !== undefined ? { mapUrl } : {}),
        ...(ntfbDonorCode !== undefined ? { ntfbDonorCode } : {}),
        ...(trashRateBakery !== undefined ? { trashRateBakery } : {}),
        ...(trashRateProduce !== undefined ? { trashRateProduce } : {}),
        ...(trashRateDeli !== undefined ? { trashRateDeli } : {}),
        ...(active !== undefined ? { active } : {}),
      });
      res.json(toSummary(updated));
    },
  }),

  /**
   * The bytes (D20). Any signed-in user, deliberately wider than the write that
   * puts them there: the photo exists for the driver arriving somewhere new at
   * 6am, and a driver is a Volunteer. This is the ONLY endpoint that pays for an
   * image — every list carries `hasPhoto` and nothing else.
   */
  defineRoute({
    method: 'get',
    path: '/donors/:id/photo',
    access: { tier: 'VOLUNTEER' },
    handler: async (req, res) => {
      const photo = await getDonorPhoto(String(req.params['id']));
      if (!photo) throw notFound('No photo for that store.');

      // `private` because this sits behind a session: nothing shared may hold it.
      // A day is long enough that a driver on one bar re-fetches nothing during a
      // run, and the cost is that a photo replaced today can be a day stale on a
      // phone that already had the old one. For a picture of a door that is the
      // right trade. Express answers `If-None-Match` from `res.send`, so the
      // revalidation after the window costs a 304 rather than the bytes.
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.type(photo.mime).send(photo.bytes);
    },
  }),

  /**
   * Set or clear it. Admin, like every other donor write.
   *
   * Nothing is validated here: what counts as a photo is a domain rule and lives
   * in the service (`architecture.md §4.1`). This only insists the field is
   * PRESENT, because absent and `null` mean different things on the wire and only
   * one of them means "clear the photo".
   */
  defineRoute({
    method: 'put',
    path: '/donors/:id/photo',
    access: { tier: 'ADMIN' },
    handler: async (req, res) => {
      const input = body(req) as Record<string, unknown> & Partial<SetDonorPhotoRequest>;
      const dataUrl = optionalString(input, 'dataUrl');
      if (dataUrl === undefined) throw badRequest('dataUrl is required.');

      const updated = await setDonorPhoto(String(req.params['id']), dataUrl);
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
