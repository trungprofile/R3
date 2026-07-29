// Alerts — the endpoints the browser's onboarding talks to (`ui-ux-spec.md §5`,
// PRD cap 13 "install/onboarding").
//
// Two routes and no more: the key a browser needs to register, and the
// registration itself. There is no unregister route — a dead registration is
// soft-revoked by dispatch on a `410 Gone` (`architecture.md §4.4`), and the UI has
// no "turn alerts off" action: §5 offers only "Alerts OFF — tap to fix".
//
// Both declare `{ tier: 'VOLUNTEER' }`, which is §4.3's "any signed-in user" —
// every account is at least a Volunteer (I1). Neither is public: the VAPID public
// key is not a secret, but nothing anonymous has a reason to register for alerts,
// and default-deny means the permissive answer has to be argued for rather than
// defaulted into.
//
// Handlers parse, declare, and shape. Which owner a registration gets — person or
// shared device — is the service's decision, made from the confirmed device marker
// (`architecture.md §4.2`), not from anything the client sends.

import type {
  PushConfigResponse,
  PushRegistrationResponse,
} from '../../../shared/src/index.js';
import { readDeviceMarker } from '../middleware/cookies.js';
import { badRequest } from '../middleware/error.js';
import { registerSubscription, vapidPublicKey } from '../services/push-subscription.js';
import { findDevice } from '../services/session.js';
import { body, defineRoute } from './registry.js';

function keysOf(source: Record<string, unknown>): Record<string, unknown> {
  const keys = source['keys'];
  if (typeof keys !== 'object' || keys === null || Array.isArray(keys)) {
    throw badRequest('Alerts could not be turned on.');
  }
  return keys as Record<string, unknown>;
}

/** Field-shape only. The service owns what a valid registration IS, and owns the
 *  wording of the refusal with it — `registry.ts`'s `requiredString` would answer
 *  with the field's own name, and those names are `ui-ux-spec.md §7`'s forbidden
 *  vocabulary, one `detail` render away from a volunteer's screen. */
function text(source: Record<string, unknown>, field: string): string {
  const value = source[field];
  return typeof value === 'string' ? value : '';
}

export const pushRoutes = [
  /**
   * What a browser needs before it can register. Null when the box has no VAPID
   * configured — the client then shows alerts as unavailable rather than failing a
   * registration it could never complete.
   */
  defineRoute({
    method: 'get',
    path: '/push/config',
    access: { tier: 'VOLUNTEER' },
    handler: (_req, res) => {
      const payload: PushConfigResponse = { publicKey: vapidPublicKey() };
      res.json(payload);
    },
  }),

  /**
   * Store this browser's registration. Idempotent: the client re-offers the same
   * registration on every start, which is how one the server never received heals
   * itself without any bookkeeping on either side.
   */
  defineRoute({
    method: 'post',
    path: '/push/subscriptions',
    access: { tier: 'VOLUNTEER' },
    handler: async (req, res) => {
      const actor = req.actor!; // the gate guarantees an actor on every non-public route
      const input = body(req);
      const keys = keysOf(input);

      // The browser's device marker decides who owns the registration, but only
      // after it is confirmed against the `device` table — an unknown marker is
      // personal, never trusted on its own word (`architecture.md §4.2`).
      const marker = readDeviceMarker(req);
      const device = marker === null ? null : await findDevice(marker);

      const saved = await registerSubscription({
        userId: actor.id,
        deviceId: device?.id ?? null,
        endpoint: text(input, 'endpoint'),
        p256dh: text(keys, 'p256dh'),
        auth: text(keys, 'auth'),
        label: typeof input['label'] === 'string' ? input['label'] : null,
      });

      const payload: PushRegistrationResponse = saved;
      res.status(201).json(payload);
    },
  }),
];
