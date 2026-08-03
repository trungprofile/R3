// Report routes — PRD cap 15, `ui-ux-spec.md` S3.1.
//
// Parse, declare, shape. The union's definition, the unmapped-category block, and the
// void-then-insert of a Reporter's correction all live in `services/report.ts`.
//
// TWO ACCESS DECLARATIONS IN ONE FILE, AND THE DIFFERENCE IS DELIBERATE.
//
// The REPORT itself is `anyDuty: ['REPORT']` and NOT a tier. S3.1 says "anyone with
// `report` duty", and PRD §2 makes reporting a duty a Volunteer can hold. Duties are
// set membership (I2), so this is deliberately not `tier: 'ADMIN'` — an Admin without
// the duty is not a Reporter, and a Volunteer with it is. Moving the mapping did not
// change that and must not: an admin who does not report does not get the week's
// numbers by being an admin.
//
// The MAPPING routes are `tier: 'ADMIN'` (D17, overriding D11). D11 put the matching
// on S3.1 under the same `REPORT` duty, and said in the same breath that its location
// was "still the human's to override — moving it to S1.8 is a route-access change and
// a screen move, not a data change". `ui-ux-spec.md §8` open assumption 3 offered
// "the Report screen (or Admin)"; the pantry chose Admin, so these six routes changed
// tier and the editor moved to `screens/s1-rescue/s1-8-admin/mapping/`.
//
// The paths stay under `/report/*`: they are the report's own vocabulary, and
// renaming them would be a wire change bought with nothing. What it costs, recorded
// rather than discovered: a Reporter blocked by an unmapped category can no longer
// clear it themselves, and S3.1 now names who can instead of offering a second tab.

import type {
  CategoryMapping,
  NtfbCategory,
  ReportEntry,
  ReportExport,
  WeeklyReport,
} from '../../../shared/src/report.js';
import type { Tier } from '../../../shared/src/index.js';
import {
  clearReceiptSubmitted,
  createNtfbCategory,
  exportReceipts,
  listMappings,
  listNtfbCategories,
  markReceiptSubmitted,
  removeNtfbCategory,
  reportEntries,
  resolveRange,
  reviseReportedWeight,
  setMapping,
  updateNtfbCategory,
  weeklyReport,
  type ReportActor,
} from '../services/report.js';
import { setReportable } from '../services/donation.js';
import { badRequest } from '../middleware/error.js';
import { body, defineRoute, optionalString, requiredString } from './registry.js';

function actorOf(req: { actor?: { id: string; tier: Tier } }): ReportActor {
  const actor = req.actor!; // the gate guarantees an actor on every non-public route
  return { id: actor.id };
}

const REPORTER = { tier: 'VOLUNTEER', anyDuty: ['REPORT'] } as const;

/** The mapping is master data now, and master data is Admin's (D17). Hierarchical
 *  (I2/§4.3): Admin outranks Staff and Volunteer, so this is `>=`, not equality. */
const MAPPING_ADMIN = { tier: 'ADMIN' } as const;

function queryString(query: Record<string, unknown>, key: string): string | undefined {
  const value = query[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * The window the report is cut on (D41).
 *
 * `from`/`to` when they are given, otherwise the Monday-to-Sunday week containing the
 * pantry's today (A178) — the same boundary S1.2's board and, since D39, Admin metrics
 * use, so two screens open side by side cannot disagree about what "this week" is.
 *
 * `week` is still accepted and still resolves to that anchor's whole week. Nothing in
 * the app sends it any more; a bookmark saved before D41 does, and answering it is the
 * same courtesy D18 gave `/metrics` and D40 gives `?tab=mapping`. The service owns the
 * resolution, including the refusal of a backwards range — a route parses and shapes.
 */
async function rangeOf(req: { query: Record<string, unknown> }): Promise<{
  from: string;
  to: string;
}> {
  return resolveRange({
    from: queryString(req.query, 'from'),
    to: queryString(req.query, 'to'),
    week: queryString(req.query, 'week'),
  });
}

export const reportRoutes = [
  /** The range. S3.1's whole first screen, defaulting to this week (D41). */
  defineRoute({
    method: 'get',
    path: '/report',
    access: REPORTER,
    handler: async (req, res) => {
      const { from, to } = await rangeOf(req);
      const payload: WeeklyReport = await weeklyReport(from, to);
      res.json(payload);
    },
  }),

  /** The drill-in — Success Metric 4's "100% of line items resolve to a
   *  store-category-day". Optionally narrowed to one AGFP category. */
  defineRoute({
    method: 'get',
    path: '/report/entries',
    access: REPORTER,
    handler: async (req, res) => {
      const { from, to } = await rangeOf(req);
      const categoryId = queryString(req.query, 'categoryId');
      const payload: ReportEntry[] = await reportEntries(from, to, {
        ...(categoryId !== undefined ? { categoryId } : {}),
      });
      res.json(payload);
    },
  }),

  /**
   * The Reporter's correction of a weight. Void-old + insert-new (I13), and
   * deliberately not gated on the receiver's edit window — after that window closes
   * this is the only remaining way to fix a bad number (PRD cap 15).
   */
  defineRoute({
    method: 'put',
    path: '/report/weights/:id',
    access: REPORTER,
    handler: async (req, res) => {
      const input = body(req);
      const note = optionalString(input, 'note');
      // The range the Reporter is looking at rides on the query string, so the
      // entries that come back are the panel they are standing in front of rather
      // than a window the server picked (D41).
      const range = await rangeOf(req);
      const payload: ReportEntry[] = await reviseReportedWeight(
        actorOf(req),
        String(req.params['id']),
        {
          weight: requiredString(input, 'weight'),
          ...(note !== undefined ? { note } : {}),
        },
        range,
      );
      res.json(payload);
    },
  }),

  /**
   * The report toggle from the drill-in. A plain field edit, last write wins (cap 15)
   * — the same service the receiver's S2.3 calls, because it is the same operation and
   * a second implementation would be a second set of I16b checks free to disagree.
   *
   * `enforceWindow: false` is what makes this the Reporter's route rather than a
   * second receiver's. After the receiver's window closes this drill-in is the ONLY
   * remaining way to correct the entry (cap 15, S3.1) — sharing the service without
   * this flag made the toggle uneditable by *anyone* past the window, which is the
   * reverse of the rule, and it shipped because the weight path had a post-window test
   * and this one did not.
   */
  defineRoute({
    method: 'patch',
    path: '/report/donations/:id/reportable',
    access: REPORTER,
    handler: async (req, res) => {
      const input = body(req);
      const reportable = input['reportable'];
      if (typeof reportable !== 'boolean') {
        throw badRequest('reportable must be true or false.');
      }
      const updated = await setReportable(
        actorOf(req),
        String(req.params['id']),
        reportable,
        { enforceWindow: false },
      );
      res.json(updated);
    },
  }),

  /**
   * Export. Refuses while any category carrying weight this week is unmapped — a short
   * submission that looks complete is worse than none, because the shortfall is
   * invisible at the far end (`services/report.ts`).
   *
   * ONE PATH, ONE FORMAT, ONE REFUSAL (D29, superseding D13 and D16). The far end is a
   * web form with no import, so there was never a machine to hand a file to: the export
   * is a printable mimic of the portal's own receipt, one card per `(pickup date,
   * donor)`, and this route serves it as JSON for S3.1 to render.
   *
   * The CSV is gone with its `content-disposition` and its column list. D16 kept both
   * formats below a single service call so the refusal could not be forgotten by one of
   * them; deleting the second format is the stronger version of the same argument, and
   * A186's point — that this export is server-built *precisely* so it can refuse to
   * emit a short one — is now enforced by there being nothing else to emit.
   */
  defineRoute({
    method: 'get',
    path: '/report/export',
    access: REPORTER,
    handler: async (req, res) => {
      const { from, to } = await rangeOf(req);
      const payload: ReportExport = await exportReceipts(from, to);
      res.json(payload);
    },
  }),

  // --- the Meal Connect check-off (D35, migration 0018) ---------------------
  //
  // `anyDuty: ['REPORT']` like the rest of the report, and NOT a tier: filing a
  // receipt into the portal is the reporter's job, and D17's line holds — an Admin
  // without the duty is not a Reporter (I2, set membership). A route that declared
  // nothing would be REJECTED rather than open (§4.3 default-deny), which is why the
  // declaration is here on both halves and not only on the write.
  //
  // ONE PATH, TWO METHODS. The pair `(pickupDate, donorId)` IS the receipt's key and
  // the table's primary key, so POST creates the fact and DELETE removes it, and
  // neither needs an id the client would have to have been given first. The un-tick is
  // a real DELETE, which is what makes a mis-tick reversible.

  defineRoute({
    method: 'post',
    path: '/report/submissions',
    access: REPORTER,
    handler: async (req, res) => {
      const input = body(req);
      await markReceiptSubmitted(
        actorOf(req),
        requiredString(input, 'pickupDate'),
        requiredString(input, 'donorId'),
      );
      res.status(204).end();
    },
  }),

  defineRoute({
    method: 'delete',
    path: '/report/submissions',
    access: REPORTER,
    handler: async (req, res) => {
      const input = body(req);
      await clearReceiptSubmitted(
        requiredString(input, 'pickupDate'),
        requiredString(input, 'donorId'),
      );
      res.status(204).end();
    },
  }),

  // --- the AGFP→NTFB mapping editor (Admin owns it now, D17) ----------------

  defineRoute({
    method: 'get',
    path: '/report/ntfb-categories',
    access: MAPPING_ADMIN,
    handler: async (_req, res) => {
      const payload: NtfbCategory[] = await listNtfbCategories();
      res.json(payload);
    },
  }),

  defineRoute({
    method: 'post',
    path: '/report/ntfb-categories',
    access: MAPPING_ADMIN,
    handler: async (req, res) => {
      const input = body(req);
      const code = optionalString(input, 'code');
      const payload: NtfbCategory = await createNtfbCategory({
        name: requiredString(input, 'name'),
        ...(code !== undefined ? { code } : {}),
      });
      res.status(201).json(payload);
    },
  }),

  defineRoute({
    method: 'patch',
    path: '/report/ntfb-categories/:id',
    access: MAPPING_ADMIN,
    handler: async (req, res) => {
      const input = body(req);
      const name = optionalString(input, 'name');
      const code = optionalString(input, 'code');
      const active = input['active'];
      if (active !== undefined && typeof active !== 'boolean') {
        throw badRequest('active must be true or false.');
      }
      await updateNtfbCategory(String(req.params['id']), {
        ...(typeof name === 'string' ? { name } : {}),
        ...(code !== undefined ? { code } : {}),
        ...(active === true ? { active: true } : {}),
      });
      const payload: NtfbCategory[] = await listNtfbCategories();
      res.json(payload);
    },
  }),

  /** I21, same as every other master: archive if a category maps here, else delete. */
  defineRoute({
    method: 'delete',
    path: '/report/ntfb-categories/:id',
    access: MAPPING_ADMIN,
    handler: async (req, res) => {
      const outcome = await removeNtfbCategory(String(req.params['id']));
      res.json({ outcome });
    },
  }),

  defineRoute({
    method: 'get',
    path: '/report/mappings',
    access: MAPPING_ADMIN,
    handler: async (_req, res) => {
      const payload: CategoryMapping[] = await listMappings();
      res.json(payload);
    },
  }),

  /**
   * Point one AGFP category at an NTFB one, or clear it with an explicit null.
   *
   * `storage` rides along because it is the other half of a Meal Connect line item and
   * is chosen in the same breath on S3.1. Omitting it leaves the stored value alone;
   * clearing the target clears it regardless (`services/report.ts`).
   */
  defineRoute({
    method: 'put',
    path: '/report/mappings/:categoryId',
    access: MAPPING_ADMIN,
    handler: async (req, res) => {
      const input = body(req);
      const target = input['ntfbCategoryId'];
      if (target !== null && typeof target !== 'string') {
        throw badRequest('ntfbCategoryId must be an id or null.');
      }
      const payload: CategoryMapping[] = await setMapping(
        String(req.params['categoryId']),
        target,
        optionalString(input, 'storage'),
      );
      res.json(payload);
    },
  }),
];
