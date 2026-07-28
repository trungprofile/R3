// Cookie plumbing for §4.2's session mechanism.
//
// The session cookie carries an opaque random identifier — `httpOnly` so script
// cannot read it, `Secure` so it never crosses plaintext, `SameSite=Lax` so a
// cross-site POST cannot ride it while an ordinary link into the app still works.
//
// The value is HMAC-signed with SESSION_COOKIE_SECRET (`.env.example`,
// `architecture.md §5.1`). The identifier is already unguessable, so the signature
// buys one thing: a forged or truncated cookie is rejected in microseconds without
// touching the database.
//
// Cookies are parsed by hand. `cookie-parser` would be a new dependency and
// dependencies are Wave-0-owned (`phase-1-build-plan.md §3`); the format is a
// semicolon-separated list and needs no library.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';

export const SESSION_COOKIE = 'r3_session';

/**
 * The shared-device marker (`architecture.md §4.2`). Set once when an admin
 * registers this browser as the receiver tablet or the reporter desktop; its
 * absence means personal, because the enumerated set is the small one.
 *
 * Browser-local state that can be cleared is exactly what §4.2 describes ("a lost
 * marker — browser data cleared, tablet reset — silently makes the pantry tablet
 * personal"), and the loss is made visible by the tablet's push subscription
 * disappearing with its registration rather than by anything here.
 */
export const DEVICE_COOKIE = 'r3_device';

const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1000;

function cookieSecret(): string {
  const secret = process.env['SESSION_COOKIE_SECRET'];
  if (secret && secret.length > 0) return secret;
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('SESSION_COOKIE_SECRET is not set');
  }
  // Development and test only: a per-process secret. Restarting invalidates every
  // cookie, which is the correct behavior for a secret nobody configured.
  return ephemeralSecret;
}
const ephemeralSecret = randomBytes(32).toString('hex');

function sign(value: string): string {
  return createHmac('sha256', cookieSecret()).update(value).digest('base64url');
}

export function signCookieValue(value: string): string {
  return `${value}.${sign(value)}`;
}

/** Returns the identifier, or null if the signature does not verify. */
export function unsignCookieValue(signed: string): string | null {
  const cut = signed.lastIndexOf('.');
  if (cut <= 0) return null;

  const value = signed.slice(0, cut);
  const provided = Buffer.from(signed.slice(cut + 1));
  const expected = Buffer.from(sign(value));
  if (provided.length !== expected.length) return null;
  return timingSafeEqual(provided, expected) ? value : null;
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;

  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

export function setSessionCookie(res: Response, sessionId: string, expiresAt: Date): void {
  res.cookie(SESSION_COOKIE, signCookieValue(sessionId), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    // Personal devices keep the login for weeks (`ui-ux-spec.md §5`), so the cookie
    // is persistent rather than session-scoped. Expiry is still decided by the
    // server: the row's `expires_at` is what actually governs.
    expires: expiresAt,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
  });
}

export function setDeviceCookie(res: Response, deviceId: string): void {
  res.cookie(DEVICE_COOKIE, signCookieValue(deviceId), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: TEN_YEARS_MS,
  });
}

/** The device marker this browser presents, or null for an unmarked (personal)
 *  browser. Verified against the `device` table before it can affect a session. */
export function readDeviceMarker(req: Request): string | null {
  const raw = readCookie(req, DEVICE_COOKIE);
  return raw === null ? null : unsignCookieValue(raw);
}
