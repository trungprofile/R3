// The composition root: providers, the global interaction patterns, the shell.
//
// Order matters. Session sits outside the router because navigation is derived
// from the signed-in user (§4). The offline banner and the "Still here?" prompt
// sit outside every screen because §6 makes them global, not per-screen. The
// alerts onboarding sits there too and for the same reason: §5's chip is in the
// top bar on every screen, and the card that fixes it has to be reachable from
// wherever the user notices the chip.

import { useEffect } from 'react';
import { AppShell } from './AppShell.tsx';
import type { ScreenRegistry } from './AppShell.tsx';
import { IdlePrompt } from './IdlePrompt.tsx';
import { OfflineBanner } from './OfflineBanner.tsx';
import { RouterProvider, useRouter } from './router.tsx';
import { HOME_PATH } from './routes.ts';
import { SessionProvider, useSession } from './SessionProvider.tsx';
import { ToastProvider } from './ToastProvider.tsx';
import { OnboardingCard, onServiceWorkerNavigate, usePwa } from '../pwa/index.ts';

/** `/` is not a screen. A signed-in user lands on the board (S1.2). */
function HomeRedirect() {
  const { path, navigate } = useRouter();
  const { status } = useSession();

  useEffect(() => {
    if (status === 'signed-in' && path === '/') navigate(HOME_PATH, { replace: true });
  }, [status, path, navigate]);

  return null;
}

/**
 * Tapping an alert banner while R3 is already open.
 *
 * `sw.ts` focuses the existing window and posts it the destination rather than
 * reloading a running app out from under the user; the shell owns routing, so this
 * is the half that listens. Without it S1.9's "tap to act" silently half-works.
 */
function AlertNavigation() {
  const { navigate } = useRouter();
  useEffect(() => onServiceWorkerNavigate((url) => navigate(url)), [navigate]);
  return null;
}

/**
 * Inside the providers, because the onboarding state has two consumers that live on
 * opposite sides of the shell: the top bar's chip (§5, "always visible") and the
 * card that re-walks the flow when it is tapped.
 */
function Shell({ screens, useUnreadCount }: { screens: ScreenRegistry; useUnreadCount: UnreadCountHook }) {
  const { status } = useSession();
  // Nothing about alerts runs before sign-in: registering requires a session, and
  // §5 places onboarding after login.
  const pwa = usePwa(status === 'signed-in');
  // The top bar's bell is on every screen, so the count cannot live inside S1.9 —
  // it is read here and passed down. Gated on sign-in for the same reason as
  // `usePwa`: the endpoint needs a session, and polling before one is a 401 loop.
  const { unreadCount } = useUnreadCount(status === 'signed-in');

  return (
    <>
      <HomeRedirect />
      <AlertNavigation />
      <AppShell
        screens={screens}
        unreadCount={unreadCount}
        alertsEnabled={pwa.alertsEnabled}
        onFixAlerts={pwa.fix}
      />
      <OnboardingCard pwa={pwa} />
    </>
  );
}

/**
 * The unread-count source, injected rather than imported.
 *
 * The count comes from S1.9's endpoint, but `app/` must not import from
 * `screens/` — the shell takes its screens as a prop from `main.tsx` precisely so
 * the dependency runs one way. The bell is on every screen, so the count cannot
 * live inside the inbox screen either. Injecting the hook keeps both true.
 */
export type UnreadCountHook = (active: boolean) => { unreadCount: number };

export function App({
  screens,
  useUnreadCount,
}: {
  screens: ScreenRegistry;
  useUnreadCount: UnreadCountHook;
}) {
  return (
    <SessionProvider>
      <RouterProvider>
        <ToastProvider>
          <Shell screens={screens} useUnreadCount={useUnreadCount} />
          {/* Blocking, and above everything — §6 does not want a usable-looking
              app with no network. */}
          <OfflineBanner />
          <IdlePrompt />
        </ToastProvider>
      </RouterProvider>
    </SessionProvider>
  );
}
