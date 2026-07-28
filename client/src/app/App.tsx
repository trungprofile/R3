// The composition root: providers, the global interaction patterns, the shell.
//
// Order matters. Session sits outside the router because navigation is derived
// from the signed-in user (§4). The offline banner and the "Still here?" prompt
// sit outside every screen because §6 makes them global, not per-screen.

import { useEffect } from 'react';
import { AppShell } from './AppShell.tsx';
import type { ScreenRegistry } from './AppShell.tsx';
import { IdlePrompt } from './IdlePrompt.tsx';
import { OfflineBanner } from './OfflineBanner.tsx';
import { RouterProvider, useRouter } from './router.tsx';
import { HOME_PATH } from './routes.ts';
import { SessionProvider, useSession } from './SessionProvider.tsx';
import { ToastProvider } from './ToastProvider.tsx';

/** `/` is not a screen. A signed-in user lands on the board (S1.2). */
function HomeRedirect() {
  const { path, navigate } = useRouter();
  const { status } = useSession();

  useEffect(() => {
    if (status === 'signed-in' && path === '/') navigate(HOME_PATH, { replace: true });
  }, [status, path, navigate]);

  return null;
}

export function App({ screens }: { screens: ScreenRegistry }) {
  return (
    <SessionProvider>
      <RouterProvider>
        <ToastProvider>
          <HomeRedirect />
          <AppShell screens={screens} />
          {/* Blocking, and above everything — §6 does not want a usable-looking
              app with no network. */}
          <OfflineBanner />
          <IdlePrompt />
        </ToastProvider>
      </RouterProvider>
    </SessionProvider>
  );
}
