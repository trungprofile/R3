// Receiving routes — PRD cap 14, `ui-ux-spec.md` S2.1b / S2.2 / S2.2b.
//
// Parse, declare, shape. Every domain rule — the I12 completion gate, I13's
// void-then-insert, the edit window, the WEIGHED projection — lives in
// `services/receive.ts` (`architecture.md §4.1`).
//
// The access declaration is the same on every route here and both halves matter
// (§4.3 implementation note):
//
//   - `anyDuty: ['RECEIVE']` — SET MEMBERSHIP (I2). Receiving is a duty, and
//     seniority never confers one: an Admin without RECEIVE does not weigh food.
//   - `tier: 'VOLUNTEER'` — the floor, since receivers are volunteers (PRD §2).
//
// Mounted under `/receive`, which no earlier module claims, so there is no
// method+path pair for Express to shadow (A108).

import type {
  ReceiveDoneSummary,
  ReceiveRunSummary,
  ReceiveStopDetail,
  ReceiveStopSummary,
} from '../../../shared/src/receive.js';
import type { Tier } from '../../../shared/src/index.js';
import { db } from '../db/index.js';
import {
  addWeight,
  listReceivableRuns,
  readReceiveDone,
  readRunStops,
  readStopSheet,
  receiveDone,
  reviseWeight,
  skipStop,
  voidWeight,
  type ReceiveActor,
} from '../services/receive.js';
import { badRequest } from '../middleware/error.js';
import { body, defineRoute, requiredString } from './registry.js';

function actorOf(req: { actor?: { id: string; tier: Tier } }): ReceiveActor {
  const actor = req.actor!; // the gate guarantees an actor on every non-public route
  return { id: actor.id };
}

function noteField(source: Record<string, unknown>): string | null {
  const value = source['note'];
  if (value === null) return null;
  if (typeof value !== 'string') throw badRequest('note must be text or null.');
  return value;
}

const RECEIVER = { tier: 'VOLUNTEER', anyDuty: ['RECEIVE'] } as const;

export const receiveRoutes = [
  /** S2.1b — "Which run are you receiving?" */
  defineRoute({
    method: 'get',
    path: '/receive/runs',
    access: RECEIVER,
    handler: async (_req, res) => {
      const payload: ReceiveRunSummary[] = await listReceivableRuns();
      res.json(payload);
    },
  }),

  /** The stop strip S2.2 keeps on screen, refreshed as another receiver resolves
   *  stops on the same run (S2.1b: they may work it in parallel). */
  defineRoute({
    method: 'get',
    path: '/receive/runs/:id/stops',
    access: RECEIVER,
    handler: async (req, res) => {
      const payload: ReceiveStopSummary[] = await readRunStops(String(req.params['id']));
      res.json(payload);
    },
  }),

  /** S2.2 — the sheet for one stop: tiles, running entries, live subtotals. */
  defineRoute({
    method: 'get',
    path: '/receive/runs/:id/stops/:stopId',
    access: RECEIVER,
    handler: async (req, res) => {
      const payload: ReceiveStopDetail = await readStopSheet(
        db,
        String(req.params['id']),
        String(req.params['stopId']),
      );
      res.json(payload);
    },
  }),

  /** "Add weight". Confirms immediately — no draft, no separate sign-off (cap 14). */
  defineRoute({
    method: 'post',
    path: '/receive/runs/:id/stops/:stopId/weights',
    access: RECEIVER,
    handler: async (req, res) => {
      const input = body(req);
      const payload: ReceiveStopDetail = await addWeight(
        actorOf(req),
        String(req.params['id']),
        String(req.params['stopId']),
        {
          categoryId: requiredString(input, 'categoryId'),
          weight: requiredString(input, 'weight'),
          ...(input['note'] !== undefined ? { note: noteField(input) } : {}),
        },
      );
      res.json(payload);
    },
  }),

  /**
   * The ✎ overwrite. A PUT, not a PATCH, because the entry is replaced rather than
   * amended: I13 makes weight rows immutable, so this voids the addressed row and
   * inserts a new one, and the response carries a different entry id than the URL.
   */
  defineRoute({
    method: 'put',
    path: '/receive/runs/:id/stops/:stopId/weights/:entryId',
    access: RECEIVER,
    handler: async (req, res) => {
      const input = body(req);
      const payload: ReceiveStopDetail = await reviseWeight(
        actorOf(req),
        String(req.params['id']),
        String(req.params['stopId']),
        String(req.params['entryId']),
        {
          weight: requiredString(input, 'weight'),
          ...(input['note'] !== undefined ? { note: noteField(input) } : {}),
        },
      );
      res.json(payload);
    },
  }),

  /** Void with no replacement. Idempotent: voiding a voided row is a no-op, because
   *  `voided` is a one-way flag and the caller asked for the state it is already in. */
  defineRoute({
    method: 'delete',
    path: '/receive/runs/:id/stops/:stopId/weights/:entryId',
    access: RECEIVER,
    handler: async (req, res) => {
      const payload: ReceiveStopDetail = await voidWeight(
        actorOf(req),
        String(req.params['id']),
        String(req.params['stopId']),
        String(req.params['entryId']),
      );
      res.json(payload);
    },
  }),

  /** "Skip stop" — nothing came from this store. No phantom zero row (§3.2). */
  defineRoute({
    method: 'post',
    path: '/receive/runs/:id/stops/:stopId/skip',
    access: RECEIVER,
    handler: async (req, res) => {
      const input = body(req);
      const payload: ReceiveStopDetail = await skipStop(
        actorOf(req),
        String(req.params['id']),
        String(req.params['stopId']),
        { ...(input['note'] !== undefined ? { note: noteField(input) } : {}) },
      );
      res.json(payload);
    },
  }),

  /** S2.2b's summary — read before the one irreversible tap. */
  defineRoute({
    method: 'get',
    path: '/receive/runs/:id/done',
    access: RECEIVER,
    handler: async (req, res) => {
      const payload: ReceiveDoneSummary = await readReceiveDone(String(req.params['id']));
      res.json(payload);
    },
  }),

  /**
   * Receive-done. The only completion action there is (I11), and the only route in
   * the whole API that writes `COMPLETED`.
   */
  defineRoute({
    method: 'post',
    path: '/receive/runs/:id/done',
    access: RECEIVER,
    handler: async (req, res) => {
      const result = await receiveDone(actorOf(req), String(req.params['id']));
      res.json(result);
    },
  }),
];
