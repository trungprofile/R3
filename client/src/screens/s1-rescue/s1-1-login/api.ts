// S1.1's two calls, through the typed fetch layer.
//
// Never `fetch` directly: `api/client.ts` is what carries the cookie, turns every
// failure into the one `ApiError` shape (§6) and notices a dead network. Both
// paths below are declared PUBLIC on the server (`server/src/routes/auth.ts`) —
// they are the only two that are, and they are public deliberately:
// `product-requirement.md §2` publishes the roster, and `architecture.md §4.2`
// defends the PIN by throttling rather than by hiding who has an account.

import { api } from '../../../api/index.ts';
import type { LoginRequest, RosterEntry, SessionResponse } from '../../../api/shared.ts';

const PATHS = {
  roster: '/auth/roster',
  login: '/auth/login',
} as const;

/** The name list §5 asks for. Aborted when the screen goes away — `useAsyncData`
 *  hands the signal in. */
export function fetchRoster(signal: AbortSignal): Promise<RosterEntry[]> {
  return api.get<RosterEntry[]>(PATHS.roster, { signal });
}

/** The response carries `expiresAt` and `sharedDevice`; the shell re-reads the
 *  signed-in user itself (`SessionProvider.onSignedIn`), so the only thing this
 *  screen keeps from it is the device classification — which decides whether the
 *  name may be remembered on this browser (§5). */
export function signIn(request: LoginRequest): Promise<SessionResponse> {
  return api.post<SessionResponse>(PATHS.login, { body: request });
}
