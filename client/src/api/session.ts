// Who is signed in, and how to sign out.
//
// The shell needs three things from the server and nothing else: the current
// user (to derive navigation, `ui-ux-spec.md §4`), when the sign-in expires (to
// render the "Still here?" prompt — expiry is server-authoritative,
// `architecture.md §4.2`), and a way to sign out (always visible, §5).
//
// Paths were assumed while the auth routes were being written in another lane
// (`phase-1-state.md` A15) and reconciled by the lead at the Wave-1 merge: the
// real current-user route is `/me`, not `/auth/me`. Keeping them collected here
// is what made that a one-line correction.

import type { Duty, ShapedUser, SessionResponse, Tier } from './shared.ts';
import { api } from './client.ts';

const PATHS = {
  me: '/me',
  logout: '/auth/logout',
} as const;

/** The signed-in user as the server shapes it (`pii.ts` — `architecture.md §4.3`).
 *  Phone and address are present because you always see your own; they are absent
 *  — not null — on other people's records for a Volunteer viewer.
 *
 *  This is the server's own `ShapedUser`, re-exported rather than restated: the
 *  local copy A15 recorded existed only because `shared/src` belonged to another
 *  lane that wave, and two hand-kept copies of a response shape drift. */
export type CurrentUser = ShapedUser;

/** Server-authoritative. `sharedDevice` is the §4.2 device classification, which
 *  the shell needs because a shared device may not offer "remember me". */
export type SessionInfo = SessionResponse;

export type { Duty, Tier };

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
