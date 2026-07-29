// The top bar's bell — `AppShell`'s `unreadCount` prop (S1.9, `ui-ux-spec.md §3`).
//
// FOR THE LEAD TO WIRE, NOT THIS LANE. `client/src/app/**` belongs to another owner,
// so this hook exists here, ready: `App.tsx` calls it and passes the number into
// `AppShell`. Until then the bell reads zero, which is the shell's own default.
//
// It polls, and that is the honest answer rather than a lazy one: a notification is
// written by a job or by another user's action, so nothing in this browser knows it
// happened. Push would tell us — except push is best-effort and may silently never
// arrive (PRD channel strategy), which is the whole reason the inbox is the source of
// truth. A cheap indexed count every minute is what makes the bell right for a user
// who never enabled alerts.

import { useCallback, useEffect, useState } from 'react';
import { fetchUnreadCount } from './api.ts';

/** Not specified anywhere; see this lane's report. A minute is far below anything a
 *  volunteer would notice and far above anything this box would feel — the whole
 *  operating envelope is under ten users (`product-requirement.md §6`). */
export const UNREAD_POLL_MS = 60_000;

/**
 * The caller's unread count, refreshed while `active`.
 *
 * `active` is "signed in": there is no inbox to count before that, and the endpoint
 * declares `{ tier: 'VOLUNTEER' }` so an anonymous poll would be a 401 a minute.
 *
 * A failed poll is swallowed. The count is ambient information, and §6's error
 * pattern is for actions the user took — a banner about a background refresh would
 * be noise about something they cannot act on.
 */
export function useUnreadCount(active: boolean): { unreadCount: number; refresh: () => void } {
  const [unreadCount, setUnreadCount] = useState(0);

  const refresh = useCallback(() => {
    if (!active) return;
    void fetchUnreadCount()
      .then((result) => setUnreadCount(result.unreadCount))
      .catch(() => undefined);
  }, [active]);

  useEffect(() => {
    if (!active) {
      setUnreadCount(0);
      return;
    }
    refresh();
    const timer = setInterval(refresh, UNREAD_POLL_MS);
    // Coming back to the foreground is the moment a stale count is most visible, and
    // the moment a background tab's timer has been throttled longest.
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [active, refresh]);

  return { unreadCount, refresh };
}
