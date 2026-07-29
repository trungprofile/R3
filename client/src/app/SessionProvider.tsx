// Who is signed in, for the whole app.
//
// The shell needs the current user to derive navigation (§4) and the expiry to
// warn before an inactivity timeout (§5). Both come from the server; nothing
// about identity is decided here.
//
// Sign-in ends one of two ways (§5): Logout, always visible in the top bar, or
// inactivity. Either way the client's job is to notice and show the login screen
// — the server is what actually ends it.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { fetchSession, signOut as requestSignOut } from '../api/session.ts';
import type { CurrentUser } from '../api/session.ts';
import { isApiError } from '../api/errors.ts';
import { subscribeToActivity } from '../api/activity.ts';

export type SessionStatus = 'loading' | 'signed-in' | 'signed-out' | 'error';

export interface SessionValue {
  status: SessionStatus;
  user: CurrentUser | null;
  /** Epoch ms the sign-in lapses at, as the server reported it, slid forward by
   *  local activity. Used only to decide when to warn. */
  expiresAt: number | null;
  /**
   * The pantry's IANA zone, from the session (`app_config.timezone`).
   *
   * Every run time on screen is a pantry-local fact — "the 9am run" is 9am at the
   * pantry, not on whatever device is reading it. Screens format against this
   * rather than the device's zone, which is right only while everyone happens to
   * be in one place. `null` before the session loads; a formatter falling back to
   * the device zone for that moment is correct, since there is nothing else to use.
   */
  timezone: string | null;
  /** Re-read the signed-in user. Doubles as the "Yes, I'm here" answer, because
   *  an authenticated request is what slides the timeout server-side. */
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Called by the login screen once credentials are accepted. */
  onSignedIn: () => Promise<void>;
  error: unknown;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [idleWindowMs, setIdleWindowMs] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      const info = await fetchSession();
      const expiry = Date.parse(info.expiresAt);
      setUser(info.user);
      setExpiresAt(Number.isNaN(expiry) ? null : expiry);
      setTimezone(info.timezone);
      // How long a quiet app has before it lapses. Read off the server's own
      // number rather than hard-coded, because it differs by device and tier
      // (`architecture.md §4.2`) and is tunable without a redeploy.
      setIdleWindowMs(Number.isNaN(expiry) ? null : expiry - Date.now());
      setError(null);
      setStatus('signed-in');
    } catch (cause) {
      if (isApiError(cause) && cause.kind === 'unauthenticated') {
        setUser(null);
        setExpiresAt(null);
        setStatus('signed-out');
        return;
      }
      setError(cause);
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Mirror the server's sliding `last_seen_at` locally. See `api/activity.ts`
  // for why the client must not poll for this.
  useEffect(() => {
    if (idleWindowMs === null) return;
    return subscribeToActivity((at) => setExpiresAt(at + idleWindowMs));
  }, [idleWindowMs]);

  const signOut = useCallback(async () => {
    try {
      await requestSignOut();
    } finally {
      // Whatever the server said, this device is done. A failed sign-out that
      // left the name in the top bar on a shared tablet is the worse outcome.
      setUser(null);
      setExpiresAt(null);
      setTimezone(null);
      setStatus('signed-out');
    }
  }, []);

  const value = useMemo<SessionValue>(
    () => ({
      status,
      user,
      expiresAt,
      timezone,
      refresh: load,
      signOut,
      onSignedIn: load,
      error,
    }),
    [status, user, expiresAt, timezone, load, signOut, error],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession used outside SessionProvider');
  return value;
}

/** For screens that only render once someone is signed in. */
export function useCurrentUser(): CurrentUser {
  const { user } = useSession();
  if (!user) throw new Error('useCurrentUser used with nobody signed in');
  return user;
}
