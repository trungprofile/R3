// The in-app inbox — S1.9, and the server surface the top bar's bell reads.
//
// Parse, declare, shape. Every domain rule lives in `services/inbox.ts`: whose inbox
// this is, which rows are device-scoped and therefore not inbox rows at all, and what
// marking read means when it happens twice. None of those can be decided from the
// session alone, so none of them are decided here (`architecture.md §4.3`).
//
// ALL FOUR DECLARE `{ tier: 'VOLUNTEER' }` — §4.3's "any signed-in user", since every
// account is at least a Volunteer (I1). No duty: the inbox is not a driver surface.
// Coordinators receive the unavailability and at-risk events, drivers receive
// assignment and reminders (`product-requirement.md §4`, notification matrix), and a
// user with an empty inbox reads an empty inbox rather than a 403. There is no
// `?userId=` and no staff view: rows are per-recipient and one user never reads
// another's, which is why nothing here takes a subject.
//
// The wire types are declared in this file rather than in `shared/src` — that
// directory is single-owner (build-plan §3) and no wave-4 lane may edit it. The
// client half restates them in its own screen folder.

import {
  listInbox,
  markAllRead,
  markRead,
  unreadCount,
  type InboxItem,
} from '../services/inbox.js';
import { defineRoute } from './registry.js';

export interface InboxListResponse {
  items: InboxItem[];
  unreadCount: number;
}

export interface UnreadCountResponse {
  unreadCount: number;
}

export interface MarkReadResponse {
  id: string;
  readAt: string;
  unreadCount: number;
}

export interface MarkAllReadResponse {
  marked: number;
  unreadCount: number;
}

function actorOf(req: { actor?: { id: string } }): { id: string } {
  const actor = req.actor!; // the gate guarantees an actor on every non-public route
  return { id: actor.id };
}

/** A positive integer query parameter, or undefined. The service clamps it — the
 *  bound is a service decision, not a parsing one. */
function positiveInt(raw: unknown): number | undefined {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

export const notificationRoutes = [
  /**
   * The inbox itself: newest first, unread state per row (S1.9). `?unread=true`
   * narrows it to unread; `?limit=` bounds the page.
   *
   * `unreadCount` rides along so the list and the bell come from one read and cannot
   * disagree by a refresh.
   */
  defineRoute({
    method: 'get',
    path: '/notifications',
    access: { tier: 'VOLUNTEER' },
    handler: async (req, res) => {
      const page = await listInbox(actorOf(req), {
        ...(positiveInt(req.query['limit']) !== undefined
          ? { limit: positiveInt(req.query['limit']) as number }
          : {}),
        unreadOnly: req.query['unread'] === 'true',
      });
      const payload: InboxListResponse = page;
      res.json(payload);
    },
  }),

  /**
   * The bell's number alone. Its own endpoint because the shell shows the count on
   * every screen (`ui-ux-spec.md §3`, top bar) and has no use for the rows — this
   * one is a single indexed count rather than a list the caller throws away.
   */
  defineRoute({
    method: 'get',
    path: '/notifications/unread-count',
    access: { tier: 'VOLUNTEER' },
    handler: async (req, res) => {
      const payload: UnreadCountResponse = { unreadCount: await unreadCount(actorOf(req)) };
      res.json(payload);
    },
  }),

  /**
   * Mark everything read. Declared BEFORE the parameterised route below so the
   * ordering is obvious to a reader; the two cannot collide in any case, since
   * `/notifications/read-all` has two path segments and `/notifications/:id/read`
   * has three.
   */
  defineRoute({
    method: 'post',
    path: '/notifications/read-all',
    access: { tier: 'VOLUNTEER' },
    handler: async (req, res) => {
      const payload: MarkAllReadResponse = await markAllRead(actorOf(req));
      res.json(payload);
    },
  }),

  /**
   * Mark one read — what "tap to act" does on the way to the deep link. A 404
   * covers both "no such alert" and "not yours", so the inbox cannot be probed.
   */
  defineRoute({
    method: 'post',
    path: '/notifications/:id/read',
    access: { tier: 'VOLUNTEER' },
    handler: async (req, res) => {
      const payload: MarkReadResponse = await markRead(
        actorOf(req),
        String(req.params['id']),
      );
      res.json(payload);
    },
  }),
];
