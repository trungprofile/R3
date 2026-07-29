// Shift coverage — claim, release, staff assign / unassign.
//
// Parse, declare, shape. No domain rule lives here: I20's gate, its staff-assign
// exemption, claim atomicity and the conflict flag are all in `services/coverage.ts`,
// because a rule that needs the database is a service rule (`architecture.md §4.3`) and
// because a route is not the only caller (the at-risk sweep is the other).
//
// Every route below declares its access. §4.3 is default-deny — an undeclared route is
// rejected, not open — and `defineRoute` makes `access` a required field, so forgetting
// one does not typecheck.
//
// The two comparisons are different kinds (§4.3 implementation note): claim and release
// carry `anyDuty: ['DRIVE']`, which is **set membership** (I2) — a Staff coordinator
// without the Drive duty may not claim a run. Assign and unassign carry `tier: 'STAFF'`,
// which is **hierarchical** (I1) — Admin passes without being named.

import type { Tier } from '../../../shared/src/index.js';
import type {
  AssignResult,
  ClaimResult,
  ClaimScope,
  EligibilityPreviewResponse,
  ReleaseResult,
  ReleaseScope,
  UnassignResult,
} from '../../../shared/src/coverage.js';
import {
  assignDriver,
  claimShift,
  previewAssignment,
  releaseShift,
  unassignDriver,
  type CoverageActor,
} from '../services/coverage.js';
import { badRequest } from '../middleware/error.js';
import { body, defineRoute, optionalString, requiredString } from './registry.js';

function actorOf(req: { actor?: { id: string; tier: Tier } }): CoverageActor {
  const actor = req.actor!; // the gate guarantees an actor on every non-public route
  return { id: actor.id, tier: actor.tier };
}

function claimScope(source: Record<string, unknown>): ClaimScope {
  const value = source['scope'];
  if (value === undefined || value === 'ONE') return 'ONE';
  if (value === 'SERIES') return 'SERIES';
  throw badRequest('scope must be ONE or SERIES.');
}

function releaseScope(source: Record<string, unknown>): ReleaseScope {
  const value = source['scope'];
  if (value === undefined || value === 'ONE') return 'ONE';
  if (value === 'RANGE') return 'RANGE';
  throw badRequest('scope must be ONE or RANGE.');
}

export const coverageRoutes = [
  /**
   * Claim an open run — S1.2's primary action, and the prompt behind it: "Claim every
   * Tuesday run, or just this one?".
   *
   * 409 in two flavours the client tells apart by `error`: `NOT_ELIGIBLE` (I20's gate
   * refused) and `SHIFT_UNAVAILABLE` (§6's optimistic-claim revert — "That run was just
   * taken by Karen"). A `SERIES` claim answers 201 even when some runs were skipped:
   * partial success is success (PRD cap 6), and `summary` carries S1.2's sentence.
   */
  defineRoute({
    method: 'post',
    path: '/shifts/:id/claim',
    access: { tier: 'VOLUNTEER', anyDuty: ['DRIVE'] },
    handler: async (req, res) => {
      const input = body(req);
      const result: ClaimResult = await claimShift(
        actorOf(req),
        String(req.params['id']),
        claimScope(input),
      );
      res.status(201).json(result);
    },
  }),

  /**
   * Release an owned run, one or a date range (PRD cap 8, S1.3's "Release just this
   * one, or this and future?").
   *
   * Declared at VOLUNTEER + Drive: releasing is the mirror of claiming, and the
   * ownership rule — you may release only your own — needs the row, so it is settled in
   * the service (§4.3).
   */
  defineRoute({
    method: 'post',
    path: '/shifts/:id/release',
    access: { tier: 'VOLUNTEER', anyDuty: ['DRIVE'] },
    handler: async (req, res) => {
      const input = body(req);
      const fromDate = optionalString(input, 'fromDate');
      const toDate = optionalString(input, 'toDate');
      const result: ReleaseResult = await releaseShift(
        actorOf(req),
        String(req.params['id']),
        {
          scope: releaseScope(input),
          ...(typeof fromDate === 'string' ? { fromDate } : {}),
          ...(toDate !== undefined ? { toDate } : {}),
        },
      );
      res.json(result);
    },
  }),

  /**
   * Staff's pre-confirm check (S1.6: the conflict is surfaced *before* Staff confirms).
   * Read-only; the same evaluation runs again inside the assigning transaction.
   */
  defineRoute({
    method: 'get',
    path: '/shifts/:id/eligibility',
    access: { tier: 'STAFF' },
    handler: async (req, res) => {
      const raw = req.query['driverId'];
      if (typeof raw !== 'string' || raw === '') throw badRequest('driverId is required.');
      const payload: EligibilityPreviewResponse = await previewAssignment(
        String(req.params['id']),
        raw,
      );
      res.json(payload);
    },
  }),

  /**
   * Staff assigns or defaults a driver (PRD cap 6's fallback path, S1.6).
   *
   * `tier: 'STAFF'` and no duty: coordinating a run is not driving one, and requiring
   * Drive here would stop a coordinator who does not drive from doing their job. The
   * *target* still has to hold Drive — that is the service's check, because it needs
   * the database.
   *
   * 409 `ASSIGN_CONFLICT` carries S1.6's warning sentence and the eligibility detail;
   * re-posting with `confirmConflict: true` is the explicit confirmation I20's exemption
   * requires, and it flags the shift for S1.3's banner.
   */
  defineRoute({
    method: 'post',
    path: '/shifts/:id/assign',
    access: { tier: 'STAFF' },
    handler: async (req, res) => {
      const input = body(req);
      const result: AssignResult = await assignDriver(
        actorOf(req),
        String(req.params['id']),
        {
          driverId: requiredString(input, 'driverId'),
          confirmConflict: input['confirmConflict'] === true,
        },
      );
      res.json(result);
    },
  }),

  /** Staff clears the owner; the run goes back on the board as open (PRD §4 matrix's
   *  "staff unassign" row). Terminal cancellation is a different, staff-only action. */
  defineRoute({
    method: 'post',
    path: '/shifts/:id/unassign',
    access: { tier: 'STAFF' },
    handler: async (req, res) => {
      const result: UnassignResult = await unassignDriver(
        actorOf(req),
        String(req.params['id']),
      );
      res.json(result);
    },
  }),
];
