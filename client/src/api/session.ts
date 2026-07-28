// Who is signed in, and how to sign out.
//
// The shell needs three things from the server and nothing else: the current
// user (to derive navigation, `ui-ux-spec.md §4`), when the sign-in expires (to
// render the "Still here?" prompt — expiry is server-authoritative,
// `architecture.md §4.2`), and a way to sign out (always visible, §5).
//
// ENDPOINT PATHS ARE ASSUMED. The auth routes are being written in another lane
// and did not exist in this tree. They are collected here, in one file, so
// realigning them is one edit rather than a search. See the report's `Assumed:`.

import type { Duty, Tier } from '@r3/shared';
import { api } from './client.ts';

const PATHS = {
  me: '/auth/me',
  logout: '/auth/logout',
} as const;

/** The signed-in user as the server shapes it (`pii.ts` — `architecture.md §4.3`).
 *  Phone and address are present because you always see your own; they are absent
 *  on other people's records for a Volunteer viewer. */
export interface CurrentUser {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  /** Hierarchical — compare with `>=`, never equality (I1). */
  tier: Tier;
  /** Set membership — holding one implies nothing about another (I2). */
  duties: Duty[];
  phone?: string | null;
  address?: string | null;
}

export interface SessionInfo {
  user: CurrentUser;
  /** ISO timestamp. The sign-in ends then unless activity slides it; the client
   *  only renders a warning from this value and never decides expiry itself. */
  expiresAt: string;
}

/** Also the keep-alive: any authenticated request slides `last_seen_at` server
 *  side (`architecture.md §4.2`), so re-reading this is what "Yes, I'm here"
 *  does. There is no separate ping endpoint and there should not be one. */
export function fetchSession(signal?: AbortSignal): Promise<SessionInfo> {
  return api.get<SessionInfo>(PATHS.me, signal ? { signal } : {});
}

export function signOut(): Promise<void> {
  return api.post<void>(PATHS.logout);
}

/** How a person is named on screen: their own name, never their username. §1
 *  principle 4 — recognition over recall. */
export function displayName(user: CurrentUser): string {
  return `${user.firstName} ${user.lastName}`.trim();
}
