// Identity resolution: one lookup per request (`architecture.md §4.2`).
//
// This middleware only ANSWERS "who is this?" — it never decides whether they may
// proceed. That is `authorize.ts`, and keeping them apart is what lets the gate be
// default-deny: a route with no declaration is rejected even though the actor
// resolved perfectly well.

import type { NextFunction, Request, Response } from 'express';
import { resolveSession, type Actor } from '../services/session.js';
import { clearSessionCookie, readCookie, SESSION_COOKIE, unsignCookieValue } from './cookies.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set only when a live session resolved. Absent is anonymous, never a
       *  fabricated system user — `data-model.md §5.3` forbids one. */
      actor?: Actor;
    }
  }
}

export async function attachActor(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const raw = readCookie(req, SESSION_COOKIE);
    if (raw === null) return next();

    const sessionId = unsignCookieValue(raw);
    if (sessionId === null) {
      clearSessionCookie(res);
      return next();
    }

    // The lookup also slides `last_seen_at` and re-reads tier and duties, so a
    // deactivation or a tier change takes effect on the very next request.
    const actor = await resolveSession(sessionId);
    if (actor === null) {
      clearSessionCookie(res);
      return next();
    }

    req.actor = actor;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * The real client IP, for §4.2's per-IP spray counter.
 *
 * Behind Cloudflare the origin sees Cloudflare's address, so the client address
 * must come from `CF-Connecting-IP` / `X-Forwarded-For` — and be trusted ONLY for
 * requests genuinely arriving through the tunnel, since any header is forgeable by
 * anyone who reaches the origin directly. `req.ips` is non-empty only when Express
 * validated the hop against `trust proxy`, so that is the condition used here.
 * Throttling on the socket address alone would treat the whole internet as a
 * handful of addresses.
 */
export function clientIp(req: Request): string {
  if (req.ips.length > 0) {
    return req.get('CF-Connecting-IP') ?? req.ip ?? 'unknown';
  }
  return req.socket.remoteAddress ?? 'unknown';
}
