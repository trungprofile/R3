// Admin account management — `product-requirement.md` cap 1, `ui-ux-spec.md S1.8`.
//
// Donors, trucks and categories are the other three S1.8 tabs and belong to a
// different wave; nothing about them is here.

import type { Duty, RemoveUserResponse, ShapedUser, Tier } from '../../../shared/src/index.js';
import { notFound } from '../middleware/error.js';
import { shapeUser, type Viewer } from '../pii.js';
import {
  createUser,
  getUser,
  listUsers,
  removeUser,
  setCredential,
  updateUser,
} from '../services/user.js';
import { body, defineRoute, requiredString } from './registry.js';

function viewerOf(req: { actor?: { id: string; tier: Tier } }): Viewer {
  const actor = req.actor!; // the gate guarantees an actor on every non-public route
  return { id: actor.id, tier: actor.tier };
}

export const userRoutes = [
  /**
   * The account list. Staff and above: `product-requirement.md §2` gives Staff
   * "operational status across all volunteers" but not others' PII, and that
   * split is made by `shapeUser`, not by this declaration — which is exactly the
   * §4.3 division between a permission and a response-shaping rule.
   */
  defineRoute({
    method: 'get',
    path: '/users',
    access: { tier: 'STAFF' },
    handler: async (req, res) => {
      const viewer = viewerOf(req);
      const users = await listUsers();
      const payload: ShapedUser[] = users.map(({ user, duties }) =>
        shapeUser(user, duties, viewer),
      );
      res.json(payload);
    },
  }),

  defineRoute({
    method: 'get',
    path: '/users/:id',
    access: { tier: 'STAFF' },
    handler: async (req, res) => {
      const record = await getUser(String(req.params['id']));
      if (!record) throw notFound('No such account.');
      res.json(shapeUser(record.user, record.duties, viewerOf(req)));
    },
  }),

  /** Create. The username is generated (`domain-modeling.md §5.1`) and shown
   *  read-only; the client never sends one. */
  defineRoute({
    method: 'post',
    path: '/users',
    access: { tier: 'ADMIN' },
    handler: async (req, res) => {
      const input = body(req);
      const created = await createUser({
        firstName: requiredString(input, 'firstName'),
        lastName: requiredString(input, 'lastName'),
        tier: input['tier'] as Tier,
        duties: input['duties'] as Duty[] | undefined,
        phone: (input['phone'] ?? null) as string | null,
        address: (input['address'] ?? null) as string | null,
        credential: input['credential'] as string | undefined,
      });

      const payload: { user: ShapedUser; generatedCredential?: string } = {
        user: shapeUser(created.user, created.duties, viewerOf(req)),
      };
      // Returned once, to the admin who just created the account, because a
      // randomly generated PIN exists nowhere else. Never logged (§5.4).
      if (created.generatedCredential !== undefined) {
        payload.generatedCredential = created.generatedCredential;
      }
      res.status(201).json(payload);
    },
  }),

  /** Edit. `username` is absent from the accepted fields by construction — it is
   *  immutable after creation (I3). */
  defineRoute({
    method: 'patch',
    path: '/users/:id',
    access: { tier: 'ADMIN' },
    handler: async (req, res) => {
      const input = body(req);
      const updated = await updateUser(String(req.params['id']), {
        ...(input['firstName'] !== undefined
          ? { firstName: input['firstName'] as string }
          : {}),
        ...(input['lastName'] !== undefined
          ? { lastName: input['lastName'] as string }
          : {}),
        ...(input['tier'] !== undefined ? { tier: input['tier'] as Tier } : {}),
        ...(input['duties'] !== undefined ? { duties: input['duties'] as Duty[] } : {}),
        ...(input['phone'] !== undefined
          ? { phone: input['phone'] as string | null }
          : {}),
        ...(input['address'] !== undefined
          ? { address: input['address'] as string | null }
          : {}),
        ...(input['credential'] !== undefined
          ? { credential: input['credential'] as string }
          : {}),
        // Reactivation only; the service refuses `false` and points at Delete.
        ...(input['active'] !== undefined ? { active: input['active'] as boolean } : {}),
      });
      res.json(shapeUser(updated.user, updated.duties, viewerOf(req)));
    },
  }),

  /** Set or reset a PIN / password (S1.8). */
  defineRoute({
    method: 'post',
    path: '/users/:id/credential',
    access: { tier: 'ADMIN' },
    handler: async (req, res) => {
      await setCredential(
        String(req.params['id']),
        requiredString(body(req), 'credential'),
      );
      res.status(204).end();
    },
  }),

  /** I21 decides which removal actually happens; the client is told which. */
  defineRoute({
    method: 'delete',
    path: '/users/:id',
    access: { tier: 'ADMIN' },
    handler: async (req, res) => {
      const outcome = await removeUser(String(req.params['id']));
      const payload: RemoveUserResponse = { outcome };
      res.json(payload);
    },
  }),
];
