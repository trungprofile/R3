// Login, logout, the login-screen roster, and "who am I".
//
// Handlers parse, call one service, and shape. The credential comparison, the
// throttle, and the session lifetime all live in `services/` — this file must not
// be the place anyone looks for an auth rule.

import type {
  RosterEntry,
  SessionResponse,
} from '../../../shared/src/index.js';
import { credentialKindFor } from '../../../shared/src/index.js';
import { clientIp } from '../middleware/auth.js';
import {
  clearSessionCookie,
  readDeviceMarker,
  setSessionCookie,
} from '../middleware/cookies.js';
import { notFound } from '../middleware/error.js';
import { shapeUser } from '../pii.js';
import { login } from '../services/auth.js';
import { getPantryTimezone } from '../services/config.js';
import { destroySession, findDevice } from '../services/session.js';
import { getUser, listRosterUsers } from '../services/user.js';
import { body, defineRoute, requiredString } from './registry.js';

export const authRoutes = [
  /**
   * The name list the login screen shows (`ui-ux-spec.md §5`: recognition, no
   * typing). PUBLIC, declared out loud per §4.3 — and public on purpose:
   * `product-requirement.md §2` publishes the roster, so §4.2 defends the PIN by
   * throttling rather than by hiding who has an account.
   */
  defineRoute({
    method: 'get',
    path: '/auth/roster',
    access: { public: true },
    handler: async (_req, res) => {
      const users = await listRosterUsers();
      // Through `shapeUser` even though the viewer is anonymous: it is the sole
      // exit path for an app_user record, and an exception here is how the next
      // one gets written.
      const roster: RosterEntry[] = users.map(({ user, duties }) => {
        const shaped = shapeUser(user, duties, null);
        return {
          id: shaped.id,
          username: shaped.username,
          firstName: shaped.firstName,
          lastName: shaped.lastName,
          credentialKind: credentialKindFor(shaped.tier),
        };
      });
      res.json(roster);
    },
  }),

  defineRoute({
    method: 'post',
    path: '/auth/login',
    access: { public: true },
    handler: async (req, res) => {
      const input = body(req);
      const username = requiredString(input, 'username');
      const credential = requiredString(input, 'credential');

      // The browser's device marker decides the session's lifetime policy, but
      // only after it is confirmed against the `device` table — an unknown marker
      // is personal, never trusted on its own word.
      const marker = readDeviceMarker(req);
      const device = marker === null ? null : await findDevice(marker);

      const result = await login({
        username: username.trim(),
        credential,
        deviceId: device?.id ?? null,
        clientIp: clientIp(req),
      });

      setSessionCookie(res, result.sessionId, result.expiresAt);

      const payload: SessionResponse = {
        user: shapeUser(result.user, result.duties, {
          id: result.user.id,
          tier: result.user.tier,
        }),
        expiresAt: result.expiresAt.toISOString(),
        sharedDevice: result.sharedDevice,
        // A second service call, deliberately: §4.1's "one service function per
        // domain operation" is about who owns the WRITE. This is a read of pantry
        // settings that every screen needs and that auth has no business owning.
        timezone: await getPantryTimezone(),
      };
      res.status(200).json(payload);
    },
  }),

  /** Logout deletes the row — the reason sessions are server-side at all
   *  (`architecture.md §4.2`): on the shared tablet the next person must not
   *  inherit the last person's session. */
  defineRoute({
    method: 'post',
    path: '/auth/logout',
    access: { tier: 'VOLUNTEER' },
    handler: async (req, res) => {
      await destroySession(req.actor!.sessionId);
      clearSessionCookie(res);
      res.status(204).end();
    },
  }),

  /** Any signed-in user. `expiresAt` is server-authoritative: the "Still here?"
   *  prompt renders this value and never computes its own (§4.2). */
  defineRoute({
    method: 'get',
    path: '/me',
    access: { tier: 'VOLUNTEER' },
    handler: async (req, res) => {
      const actor = req.actor!;
      const record = await getUser(actor.id);
      if (!record) throw notFound('No such account.');

      const payload: SessionResponse = {
        user: shapeUser(record.user, record.duties, { id: actor.id, tier: actor.tier }),
        expiresAt: actor.expiresAt.toISOString(),
        sharedDevice: actor.sharedDevice,
        timezone: await getPantryTimezone(),
      };
      res.json(payload);
    },
  }),
];
