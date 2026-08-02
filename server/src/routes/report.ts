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
  ExportRow,
  NtfbCategory,
  ReportEntry,
  WeeklyReport,
} from '../../../shared/src/report.js';
import { EXPORT_COLUMNS } from '../../../shared/src/report.js';
import type { Tier } from '../../../shared/src/index.js';
import {
  createNtfbCategory,
  currentWeek,
  exportRows,
  listMappings,
  listNtfbCategories,
  removeNtfbCategory,
  reportEntries,
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

/** The anchor date; absent means the current pantry-local week. */
async function anchorOf(req: { query: Record<string, unknown> }): Promise<string> {
  const week = req.query['week'];
  if (typeof week === 'string' && week !== '') return week;
  return (await currentWeek()).weekStart;
}

/** RFC 4180 enough for a spreadsheet: quote everything, double inner quotes. A donor
 *  name with a comma in it is ordinary, and an unquoted one silently shifts a column. */
function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * One worksheet row as cells, in `EXPORT_COLUMNS` order (D13).
 *
 * Both output formats go through this, so the CSV and the printed sheet cannot lay
 * the same row out differently. `NTFB Code` is absent on purpose: Meal Connect picks
 * a category by name from a dropdown, and the `MEAT48675888`-style ids on a receipt
 * are its own per-line identifiers, issued on submission.
 */
function exportCells(row: ExportRow): string[] {
  return [
    row.day,
    row.donor,
    row.donorCode,
    row.ntfbCategory,
    row.storage,
    row.agfpCategory,
    row.weightLb,
    row.receiptItems,
    row.receiptTotal,
  ];
}

export const reportRoutes = [
  /** The week. S3.1's whole first screen. */
  defineRoute({
    method: 'get',
    path: '/report',
    access: REPORTER,
    handler: async (req, res) => {
      const payload: WeeklyReport = await weeklyReport(await anchorOf(req));
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
      const categoryId = req.query['categoryId'];
      const payload: ReportEntry[] = await reportEntries(await anchorOf(req), {
        ...(typeof categoryId === 'string' && categoryId !== '' ? { categoryId } : {}),
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
      const payload: ReportEntry[] = await reviseReportedWeight(
        actorOf(req),
        String(req.params['id']),
        {
          weight: requiredString(input, 'weight'),
          ...(note !== undefined ? { note } : {}),
        },
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
   * file that looks complete is worse than no file, because the shortfall is invisible
   * at the far end (`services/report.ts`).
   *
   * CSV, and now shaped by a real Meal Connect submission rather than by a guess: the
   * far end has no import, so this is the worksheet a Reporter reads while typing
   * receipts into a web form (D13, `ExportRow`).
   *
   * TWO FORMATS, ONE ROUTE, ONE REFUSAL (D16). `?format=json` answers with the same
   * rows for S3.1's print view. It is a query parameter on this route rather than a
   * route of its own, and that is the whole design: `exportRows()` is called once,
   * above the branch, so the unmapped-category conflict is thrown before either
   * format exists. A second endpoint would be a second place for the refusal to be
   * forgotten — and A186 records that this export is server-built *precisely* so it
   * can refuse to emit a short one.
   */
  defineRoute({
    method: 'get',
    path: '/report/export',
    access: REPORTER,
    handler: async (req, res) => {
      // Before the branch, deliberately: whichever format was asked for, an unmapped
      // category carrying weight refuses here and nothing is emitted.
      const { weekStart, weekEnd, rows } = await exportRows(await anchorOf(req));

      if (req.query['format'] === 'json') {
        res.json({ weekStart, weekEnd, columns: [...EXPORT_COLUMNS], rows });
        return;
      }

      const lines = [
        EXPORT_COLUMNS.map(csvCell).join(','),
        ...rows.map((row) => exportCells(row).map(csvCell).join(',')),
      ];

      res.setHeader('content-type', 'text/csv; charset=utf-8');
      res.setHeader(
        'content-disposition',
        `attachment; filename="agfp-ntfb-${weekStart}-to-${weekEnd}.csv"`,
      );
      res.send(`${lines.join('\r\n')}\r\n`);
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
