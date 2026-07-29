// Pickup-execution routes — PRD cap 10, `ui-ux-spec.md S1.5` (driver) and `S1.3`
// (staff reassign).
//
// Parse, declare, shape. No domain rule lives here: the I5 snapshot, the I27 gate,
// the I30 close-old-insert-new, and every ownership check are in
// `services/execution.ts`, because a rule that needs the database is a service rule
// (`architecture.md §4.3`) and because a route is not the only caller — the reminder
// sweep enters the same layer from a job.
//
// Two kinds of comparison appear in the declarations below and they are not the same
// kind (§4.3 implementation note):
//
//   - `anyDuty: ['DRIVE']` — SET MEMBERSHIP (I2). Cap 10 is a driver capability, and
//     seniority never confers a duty: a Staff coordinator without DRIVE cannot start
//     someone's run.
//   - `tier: 'STAFF'` on reassign — HIERARCHICAL (I1), so Admin passes. I30 is
//     staff-only and explicitly NOT something the driver does from S1.5, and it is
//     not a duty: a coordinator holds no DRIVE duty and must still be able to move a
//     stalled driver's stops.
//
// Every route declares its access; `defineRoute` makes the field required, and the
// gate rejects anything it was not handed (§4.3 default-deny).

import type {
  ReassignStopResponse,
  RunDetail,
  RunStopSummary,
} from '../../../shared/src/execution.js';
import type { Tier } from '../../../shared/src/index.js';
import {
  completePickup,
  getRun,
  reassignStop,
  reorderStops,
  resolveStop,
  setRunNote,
  setStopNote,
  startRun,
  type ExecutionActor,
} from '../services/execution.js';
import { badRequest } from '../middleware/error.js';
import { body, defineRoute, requiredString } from './registry.js';

function actorOf(req: { actor?: { id: string; tier: Tier } }): ExecutionActor {
  const actor = req.actor!; // the gate guarantees an actor on every non-public route
  return { id: actor.id, tier: actor.tier };
}

/** A nullable text field: `null` clears it, a string sets it, absent means "leave
 *  it alone". `optionalString` in the registry rejects a non-string; notes are the
 *  same shape but read on their own so the distinction stays explicit here. */
function noteField(source: Record<string, unknown>): string | null {
  const value = source['note'];
  if (value === null) return null;
  if (typeof value !== 'string') throw badRequest('note must be text or null.');
  return value;
}

export const executionRoutes = [
  /**
   * The run: shift, truck, notes, ordered stops. The owner reads it on S1.5; Staff
   * reads it on S1.3 (where the reassign action lives), so the declaration is the
   * floor tier and the service decides whose run this is — that answer needs the
   * row's owner, not just the session.
   */
  defineRoute({
    method: 'get',
    path: '/shifts/:id/run',
    access: { tier: 'VOLUNTEER' },
    handler: async (req, res) => {
      const run = await getRun(actorOf(req), String(req.params['id']));
      const payload: RunDetail = run;
      res.json(payload);
    },
  }),

  /** Start the run: pick a truck, snapshot the route (I5), `CLAIMED → IN_PROGRESS`.
   *  One request, one transaction — I8 makes truck and transition inseparable. */
  defineRoute({
    method: 'post',
    path: '/shifts/:id/start',
    access: { tier: 'VOLUNTEER', anyDuty: ['DRIVE'] },
    handler: async (req, res) => {
      const input = body(req);
      const run = await startRun(actorOf(req), String(req.params['id']), {
        truckId: requiredString(input, 'truckId'),
      });
      const payload: RunDetail = run;
      res.json(payload);
    },
  }),

  /** Check off or skip one stop. The two dispositions a driver may set; the service
   *  rejects the rest (`domain-modeling.md §3.2`). */
  defineRoute({
    method: 'post',
    path: '/shifts/:id/stops/:stopId/resolve',
    access: { tier: 'VOLUNTEER', anyDuty: ['DRIVE'] },
    handler: async (req, res) => {
      const input = body(req);
      const stop = await resolveStop(
        actorOf(req),
        String(req.params['id']),
        String(req.params['stopId']),
        {
          // Validated by the service, which owns the state machine.
          disposition: requiredString(input, 'disposition') as 'COLLECTED' | 'SKIPPED',
          ...(input['note'] !== undefined ? { note: noteField(input) } : {}),
        },
      );
      const payload: RunStopSummary = stop;
      res.json(payload);
    },
  }),

  /** The driver→receiver note for one stop (cap 11, channel 2). */
  defineRoute({
    method: 'patch',
    path: '/shifts/:id/stops/:stopId',
    access: { tier: 'VOLUNTEER', anyDuty: ['DRIVE'] },
    handler: async (req, res) => {
      const stop = await setStopNote(
        actorOf(req),
        String(req.params['id']),
        String(req.params['stopId']),
        noteField(body(req)),
      );
      const payload: RunStopSummary = stop;
      res.json(payload);
    },
  }),

  /** Drag-and-drop reorder (S1.5). The list carries the order; the server numbers it. */
  defineRoute({
    method: 'post',
    path: '/shifts/:id/stops/order',
    access: { tier: 'VOLUNTEER', anyDuty: ['DRIVE'] },
    handler: async (req, res) => {
      const input = body(req);
      const raw = input['stopIds'];
      if (!Array.isArray(raw) || raw.some((id) => typeof id !== 'string')) {
        throw badRequest('stopIds must be a list of stop ids.');
      }
      const stops = await reorderStops(
        actorOf(req),
        String(req.params['id']),
        raw as string[],
      );
      const payload: RunStopSummary[] = stops;
      res.json(payload);
    },
  }),

  /** The driver's whole-run note (cap 11, channel 3). Distinct field from
   *  `staff_note`, which is the coordinator's and is not written from here. */
  defineRoute({
    method: 'patch',
    path: '/shifts/:id/note',
    access: { tier: 'VOLUNTEER', anyDuty: ['DRIVE'] },
    handler: async (req, res) => {
      const run = await setRunNote(
        actorOf(req),
        String(req.params['id']),
        noteField(body(req)),
      );
      const payload: RunDetail = run;
      res.json(payload);
    },
  }),

  /**
   * "Heading back" (I27). Sets the milestone; the run stays `IN_PROGRESS`, and there
   * is deliberately no route here that closes it — receive-done is the receiver's and
   * ships in Phase 2 (build-plan D1).
   */
  defineRoute({
    method: 'post',
    path: '/shifts/:id/pickup-complete',
    access: { tier: 'VOLUNTEER', anyDuty: ['DRIVE'] },
    handler: async (req, res) => {
      const input = body(req);
      const run = await completePickup(actorOf(req), String(req.params['id']), {
        ...(input['note'] !== undefined ? { note: noteField(input) } : {}),
      });
      const payload: RunDetail = run;
      res.json(payload);
    },
  }),

  /** Mid-run reassignment (I30). Staff-only and tier-gated, per S1.3 — the driver
   *  never does this from S1.5. */
  defineRoute({
    method: 'post',
    path: '/shifts/:id/stops/:stopId/reassign',
    access: { tier: 'STAFF' },
    handler: async (req, res) => {
      const input = body(req);
      const moved = await reassignStop(
        actorOf(req),
        String(req.params['id']),
        String(req.params['stopId']),
        { toShiftId: requiredString(input, 'toShiftId') },
      );
      const payload: ReassignStopResponse = moved;
      res.json(payload);
    },
  }),
];
