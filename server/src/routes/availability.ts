// Driver availability — `product-requirement.md` cap 7, `ui-ux-spec.md S1.4`.
//
// Parse, declare, shape. No domain rule lives here: the I20 declaration gate, the
// pantry-local expansion, and the "whose availability may you read" rule are all in
// `services/availability.ts`, because a rule that needs the database is a service
// rule (`architecture.md §4.3`) and because a route is not the only caller.
//
// Every route below declares its access. `architecture.md §4.3` is default-deny —
// an undeclared route is rejected, not open — and `defineRoute` makes `access` a
// required field so forgetting one does not typecheck.

import type {
  AvailabilityListResponse,
  DeclareAvailabilityResponse,
} from '../../../shared/src/availability.js';
import type { Tier } from '../../../shared/src/index.js';
import {
  declareAvailability,
  listAvailability,
  withdrawAvailability,
  type AvailabilityActor,
} from '../services/availability.js';
import { body, defineRoute, requiredString } from './registry.js';

function actorOf(req: { actor?: { id: string; tier: Tier } }): AvailabilityActor {
  const actor = req.actor!; // the gate guarantees an actor on every non-public route
  return { id: actor.id, tier: actor.tier };
}

export const availabilityRoutes = [
  /**
   * "When I'm away" (S1.4), and Staff's view of a driver's availability
   * (`product-requirement.md §2`). `?userId=` selects the subject; the service
   * decides whether this actor may see it, since that answer needs the row's owner
   * and not just the session.
   *
   * Declared at VOLUNTEER with no duty: every signed-in user may read their own
   * (empty for a non-driver), and a Staff coordinator without the Drive duty must
   * still be able to read a driver's.
   */
  defineRoute({
    method: 'get',
    path: '/availability',
    access: { tier: 'VOLUNTEER' },
    handler: async (req, res) => {
      const actor = actorOf(req);
      const raw = req.query['userId'];
      const subjectId = typeof raw === 'string' && raw !== '' ? raw : undefined;
      const blocks = await listAvailability(actor, subjectId);
      const payload: AvailabilityListResponse = {
        userId: subjectId ?? actor.id,
        blocks,
      };
      res.json(payload);
    },
  }),

  /**
   * Declare unavailability. `anyDuty: ['DRIVE']` is a duty gate — set membership
   * (I2), never a tier comparison: cap 7 is a driver capability, and eligibility
   * only ever reads a driver's blocks, so a Reporter declaring one would store a row
   * nothing could consult.
   *
   * Refusal is 409 with the conflicting runs attached (I20's declaration gate), so
   * S1.4 can name the run the driver has to release.
   */
  defineRoute({
    method: 'post',
    path: '/availability',
    access: { tier: 'VOLUNTEER', anyDuty: ['DRIVE'] },
    handler: async (req, res) => {
      const input = body(req);
      const kind = requiredString(input, 'kind');
      const blocks = await declareAvailability(actorOf(req), {
        // Validated by the service, which owns the shape rules for both kinds.
        kind: kind as 'DATES' | 'WINDOW',
        fromDate: requiredString(input, 'fromDate'),
        toDate: requiredString(input, 'toDate'),
        ...(input['startTime'] !== undefined
          ? { startTime: String(input['startTime']) }
          : {}),
        ...(input['endTime'] !== undefined ? { endTime: String(input['endTime']) } : {}),
      });
      const payload: DeclareAvailabilityResponse = { blocks };
      res.status(201).json(payload);
    },
  }),

  /** Withdraw one block. Ownership is checked in the service, in the transaction. */
  defineRoute({
    method: 'delete',
    path: '/availability/:id',
    access: { tier: 'VOLUNTEER', anyDuty: ['DRIVE'] },
    handler: async (req, res) => {
      await withdrawAvailability(actorOf(req), String(req.params['id']));
      res.status(204).end();
    },
  }),
];
