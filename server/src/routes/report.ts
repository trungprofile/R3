// Report routes — PRD cap 15, `ui-ux-spec.md` S3.1.
//
// Parse, declare, shape. The union's definition, the unmapped-category block, and the
// void-then-insert of a Reporter's correction all live in `services/report.ts`.
//
// The access declaration is `anyDuty: ['REPORT']` and NOT a tier, which is the one
// non-obvious thing here: S3.1 says "anyone with `report` duty", and PRD §2 makes
// reporting a duty a Volunteer can hold. Duties are set membership (I2), so this is
// deliberately not `tier: 'ADMIN'` — an Admin without the duty is not a Reporter, and
// a Volunteer with it is.
//
// The mapping editor is here rather than under `/admin` because S3.1 owns it
// (phase-3-build-plan.md D11).

import type {
  CategoryMapping,
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
      );
      res.json(updated);
    },
  }),

  /**
   * Export. Refuses while any category carrying weight this week is unmapped — a short
   * file that looks complete is worse than no file, because the shortfall is invisible
   * at the far end (`services/report.ts`).
   *
   * CSV, and the column set is provisional: "Meal Connect format" is named by PRD cap
   * 15 and Success Metric 3 and defined by neither (phase-3-build-plan.md D13).
   */
  defineRoute({
    method: 'get',
    path: '/report/export',
    access: REPORTER,
    handler: async (req, res) => {
      const { weekStart, weekEnd, rows } = await exportRows(await anchorOf(req));
      const lines = [
        EXPORT_COLUMNS.map(csvCell).join(','),
        ...rows.map((row) =>
          [
            row.day,
            row.ntfbCategory,
            row.ntfbCode,
            row.agfpCategory,
            row.donor,
            row.weightLb,
          ]
            .map(csvCell)
            .join(','),
        ),
      ];

      res.setHeader('content-type', 'text/csv; charset=utf-8');
      res.setHeader(
        'content-disposition',
        `attachment; filename="agfp-ntfb-${weekStart}-to-${weekEnd}.csv"`,
      );
      res.send(`${lines.join('\r\n')}\r\n`);
    },
  }),

  // --- the AGFP→NTFB mapping editor (S3.1 owns it, D11) --------------------

  defineRoute({
    method: 'get',
    path: '/report/ntfb-categories',
    access: REPORTER,
    handler: async (_req, res) => {
      const payload: NtfbCategory[] = await listNtfbCategories();
      res.json(payload);
    },
  }),

  defineRoute({
    method: 'post',
    path: '/report/ntfb-categories',
    access: REPORTER,
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
    access: REPORTER,
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
    access: REPORTER,
    handler: async (req, res) => {
      const outcome = await removeNtfbCategory(String(req.params['id']));
      res.json({ outcome });
    },
  }),

  defineRoute({
    method: 'get',
    path: '/report/mappings',
    access: REPORTER,
    handler: async (_req, res) => {
      const payload: CategoryMapping[] = await listMappings();
      res.json(payload);
    },
  }),

  /** Point one AGFP category at an NTFB one, or clear it with an explicit null. */
  defineRoute({
    method: 'put',
    path: '/report/mappings/:categoryId',
    access: REPORTER,
    handler: async (req, res) => {
      const input = body(req);
      const target = input['ntfbCategoryId'];
      if (target !== null && typeof target !== 'string') {
        throw badRequest('ntfbCategoryId must be an id or null.');
      }
      const payload: CategoryMapping[] = await setMapping(
        String(req.params['categoryId']),
        target,
      );
      res.json(payload);
    },
  }),
];
