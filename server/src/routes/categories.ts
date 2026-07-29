// Category master data — `product-requirement.md` cap 17, `ui-ux-spec.md S1.8`.
// Ships in Phase 1 by build-plan D2.
//
// Parse, declare, shape. The domain rules are in `services/category.ts`.

import type {
  CategorySummary,
  CreateCategoryRequest,
  RemoveMasterResponse,
  UpdateCategoryRequest,
} from '../../../shared/src/masters.js';
import { badRequest, notFound } from '../middleware/error.js';
import {
  createCategory,
  getCategory,
  listCategories,
  removeCategory,
  updateCategory,
  type CategoryRecord,
} from '../services/category.js';
import { body, defineRoute, optionalString, requiredString } from './registry.js';

function toSummary(row: CategoryRecord): CategorySummary {
  return {
    id: row.id,
    name: row.name,
    // I21 — archived categories are preserved in history and reports.
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
  const name = optionalString(source, 'name');
  if (name === null) throw badRequest('A category name is required.');
  return name;
}

export const categoryRoutes = [
  /**
   * Any signed-in user. The consumer is the S2.2 weight-entry keypad, whose tiles
   * render from live active-category data rather than a hardcoded list
   * (`ui-ux-spec.md S2.2`) — that screen is Phase 2, and the duty holding it is
   * RECEIVE, so gating this on a duty now would be inventing a rule for a caller
   * that does not exist yet. Default is the active set; the S1.8 admin list passes
   * `?includeInactive=true` to see archived ones.
   */
  defineRoute({
    method: 'get',
    path: '/categories',
    access: { tier: 'VOLUNTEER' },
    handler: async (req, res) => {
      const rows = await listCategories({
        includeInactive: wantsInactive(req.query['includeInactive']),
      });
      const payload: CategorySummary[] = rows.map(toSummary);
      res.json(payload);
    },
  }),

  defineRoute({
    method: 'get',
    path: '/categories/:id',
    access: { tier: 'VOLUNTEER' },
    handler: async (req, res) => {
      const row = await getCategory(String(req.params['id']));
      if (!row) throw notFound('No such category.');
      res.json(toSummary(row));
    },
  }),

  /** Admin only: cap 17 is "Admin maintains the list of weight-entry categories". */
  defineRoute({
    method: 'post',
    path: '/categories',
    access: { tier: 'ADMIN' },
    handler: async (req, res) => {
      const input = body(req) as Record<string, unknown> &
        Partial<CreateCategoryRequest>;
      const created = await createCategory({ name: requiredString(input, 'name') });
      res.status(201).json(toSummary(created));
    },
  }),

  /** Rename, plus cap 17's "archive one" as `active: false` (§3.3 ACTIVE ⇄
   *  ARCHIVED). This is the action the S1.8 Categories tab uses. */
  defineRoute({
    method: 'patch',
    path: '/categories/:id',
    access: { tier: 'ADMIN' },
    handler: async (req, res) => {
      const input = body(req) as Record<string, unknown> &
        Partial<UpdateCategoryRequest>;
      const name = patchName(input);
      const active = optionalBoolean(input, 'active');

      const updated = await updateCategory(String(req.params['id']), {
        ...(name !== undefined ? { name } : {}),
        ...(active !== undefined ? { active } : {}),
      });
      res.json(toSummary(updated));
    },
  }),

  /** I21 decides which removal actually happens. In Phase 1 no table references a
   *  category, so this is always a hard delete — the escape hatch for a mistyped
   *  create, not the archive action above. */
  defineRoute({
    method: 'delete',
    path: '/categories/:id',
    access: { tier: 'ADMIN' },
    handler: async (req, res) => {
      const payload: RemoveMasterResponse = {
        outcome: await removeCategory(String(req.params['id'])),
      };
      res.json(payload);
    },
  }),
];
