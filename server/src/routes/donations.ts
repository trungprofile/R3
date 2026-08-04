// Unplanned-intake routes — PRD cap 12, `ui-ux-spec.md` S1.5 (driver flag) and S2.3
// (receiver record & confirm).
//
// Parse, declare, shape. I29's on-route guard, I16b's source requirement, I17's
// SUGGESTED lifecycle and the edit window are all in `services/donation.ts`.
//
// Two different duties appear here, which is the point of cap 12 shipping as one
// unit: the driver FLAGS (DRIVE) and the receiver CONFIRMS (RECEIVE). They are set
// memberships, not ranks (I2) — an Admin without RECEIVE cannot confirm a donation,
// and a coordinator without DRIVE cannot flag one on someone's run.
//
// `/donations` is unclaimed by any earlier module, and `POST /shifts/:id/donations`
// is a distinct method+path pair from every one of the 24 already mounted under
// `/shifts` — checked, not assumed (A108).

import type { DonationSummary } from '../../../shared/src/donation.js';
import type { Tier } from '../../../shared/src/index.js';
import {
  confirmDonation,
  createDonation,
  discardSuggestion,
  flagAdHoc,
  listDonationsForShift,
  readDonation,
  setReportable,
  type DonationActor,
} from '../services/donation.js';
import { badRequest } from '../middleware/error.js';
import { body, defineRoute, optionalString, requiredString } from './registry.js';

function actorOf(req: { actor?: { id: string; tier: Tier } }): DonationActor {
  const actor = req.actor!;
  return { id: actor.id };
}

function noteField(source: Record<string, unknown>): string | null {
  const value = source['note'];
  if (value === null) return null;
  if (typeof value !== 'string') throw badRequest('note must be text or null.');
  return value;
}

/** A boolean field. Absent stays absent so the service can tell "leave it" from
 *  "set it false" — which for `reportable` is the difference between the I15 default
 *  and a deliberate opt-out. */
function optionalBoolean(
  source: Record<string, unknown>,
  field: string,
): boolean | undefined {
  const value = source[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw badRequest(`${field} must be true or false.`);
  return value;
}

/** The polymorphic source, passed through untouched — `resolveSource` in the service
 *  owns the XOR and the blank-label normalisation. */
function sourceFields(input: Record<string, unknown>): {
  donorId?: string | null;
  donorLabel?: string | null;
} {
  const donorId = optionalString(input, 'donorId');
  const donorLabel = optionalString(input, 'donorLabel');
  return {
    ...(donorId !== undefined ? { donorId } : {}),
    ...(donorLabel !== undefined ? { donorLabel } : {}),
  };
}

const DRIVER = { tier: 'VOLUNTEER', anyDuty: ['DRIVE'] } as const;
const RECEIVER = { tier: 'VOLUNTEER', anyDuty: ['RECEIVE'] } as const;

export const donationRoutes = [
  /**
   * S1.5 "Flag a stop not on my route" — the driver's half of cap 12.
   *
   * Creates a `SUGGESTED` row and never a `ShiftStop` (I14). Refused if the donor is
   * already a stop on this run (I29): that food is another weight on the stop.
   *
   * No `categoryId` since D24 — a category is required on `CONFIRMED` only (migration
   * 0015), and the receiver names it. A body that still sends one is ignored rather
   * than refused, which is what lets a phone running yesterday's cached bundle keep
   * flagging pickups through the deploy.
   */
  defineRoute({
    method: 'post',
    path: '/shifts/:id/donations',
    access: DRIVER,
    handler: async (req, res) => {
      const input = body(req);
      const payload: DonationSummary = await flagAdHoc(
        actorOf(req),
        String(req.params['id']),
        {
          ...sourceFields(input),
          ...(input['note'] !== undefined ? { note: noteField(input) } : {}),
        },
      );
      res.status(201).json(payload);
    },
  }),

  /** What the driver flagged on this run — S2.2's "extra pickups" badge, and the
   *  prefill list S2.3 opens with. Readable by the receiver, who is the one who acts
   *  on it. */
  defineRoute({
    method: 'get',
    path: '/shifts/:id/donations',
    access: RECEIVER,
    handler: async (req, res) => {
      const payload: DonationSummary[] = await listDonationsForShift(
        String(req.params['id']),
      );
      res.json(payload);
    },
  }),

  /**
   * One donation — S2.3 since `D76`, which weighs a single donation rather than
   * holding the worklist. The worklist moved to S2.1b and is served by
   * `GET /receive/donations/summary`; this is what makes the weighing page
   * addressable, so it survives a reload instead of depending on list state.
   *
   * Same RECEIVER gate as the read above — set membership on RECEIVE (I2), not a
   * rank. A route declaring no requirement would be rejected, not open (§4.3).
   */
  defineRoute({
    method: 'get',
    path: '/donations/:id',
    access: RECEIVER,
    handler: async (req, res) => {
      const payload: DonationSummary = await readDonation(String(req.params['id']));
      res.json(payload);
    },
  }),

  /**
   * S2.3 from scratch — a walk-in or a relayed store call. Born `CONFIRMED`, so a
   * weight is required (I16a), and attribution is required unless the report toggle
   * is off (I16b).
   */
  defineRoute({
    method: 'post',
    path: '/donations',
    access: RECEIVER,
    handler: async (req, res) => {
      const input = body(req);
      const payload: DonationSummary = await createDonation(actorOf(req), {
        ...sourceFields(input),
        categoryId: requiredString(input, 'categoryId'),
        weight: requiredString(input, 'weight'),
        ...(optionalBoolean(input, 'reportable') !== undefined
          ? { reportable: optionalBoolean(input, 'reportable')! }
          : {}),
        ...(input['note'] !== undefined ? { note: noteField(input) } : {}),
      });
      res.status(201).json(payload);
    },
  }),

  /** Confirm a driver's prefill: `SUGGESTED → CONFIRMED`, with the receiver free to
   *  correct the donor or category the driver guessed at. */
  defineRoute({
    method: 'post',
    path: '/donations/:id/confirm',
    access: RECEIVER,
    handler: async (req, res) => {
      const input = body(req);
      const donationId = String(req.params['id']);
      const categoryId = optionalString(input, 'categoryId');
      const payload: DonationSummary = await confirmDonation(actorOf(req), donationId, {
        weight: requiredString(input, 'weight'),
        ...(typeof categoryId === 'string' ? { categoryId } : {}),
        ...sourceFields(input),
        ...(optionalBoolean(input, 'reportable') !== undefined
          ? { reportable: optionalBoolean(input, 'reportable')! }
          : {}),
        ...(input['note'] !== undefined ? { note: noteField(input) } : {}),
      });
      res.json(payload);
    },
  }),

  /**
   * The report toggle on its own — a plain field edit, last write wins (PRD cap 15).
   * Not the void-and-reinsert path weights take: the flag carries no weight and has
   * no prior value worth keeping as a row.
   */
  defineRoute({
    method: 'patch',
    path: '/donations/:id/reportable',
    access: RECEIVER,
    handler: async (req, res) => {
      const input = body(req);
      const reportable = optionalBoolean(input, 'reportable');
      if (reportable === undefined) throw badRequest('reportable must be true or false.');
      const payload: DonationSummary = await setReportable(
        actorOf(req),
        String(req.params['id']),
        reportable,
      );
      res.json(payload);
    },
  }),

  /** Discard a prefill the receiver decided was not a real pickup. `SUGGESTED` only —
   *  a `CONFIRMED` row is intake and is never deleted (§7.2). */
  defineRoute({
    method: 'delete',
    path: '/donations/:id',
    access: RECEIVER,
    handler: async (req, res) => {
      await discardSuggestion(actorOf(req), String(req.params['id']));
      res.status(204).end();
    },
  }),
];
