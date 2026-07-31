// The app shell — `ui-ux-spec.md §4`.
//
// Top bar identical everywhere; navigation derived from the signed-in user's
// tier and duties (never a duty switcher); one `<main>` holding whichever screen
// the URL resolves to.
//
// Screens are registered by later waves, one folder per S1.x screen. A route
// with no screen yet renders a plain placeholder rather than a blank page.

import type { ComponentType, ReactNode } from 'react';
import {
  BottomNav,
  EmptyState,
  ErrorBlock,
  SideNav,
  SkeletonRows,
  TopBar,
} from '../components/index.ts';
import { displayName } from '../api/session.ts';
import { canSee } from './access.ts';
import { navItemsFor } from './nav.tsx';
import { useRouter } from './router.tsx';
import { HOME_PATH, homePathFor, routeById } from './routes.ts';
import type { ScreenId } from './routes.ts';
import { useSession } from './SessionProvider.tsx';
import { useViewport } from './useViewport.ts';
import './app.css';

export interface ScreenProps {
  /** `:params` from the URL, already decoded. */
  params: Readonly<Record<string, string>>;
}

/** Filled in by the wave that builds the screens — one entry per S1.x. A screen
 *  reads the signed-in user with `useCurrentUser()` rather than taking it as a
 *  prop, so the shell never has to invent one for the login screen. */
export type ScreenRegistry = Partial<Record<ScreenId, ComponentType<ScreenProps>>>;

export interface AppShellProps {
  screens: ScreenRegistry;
  /** Unread notification count for the top-bar bell (S1.9). */
  unreadCount?: number;
  /** Alerts on/off for the push-state chip (§5). Omit until it is known. */
  alertsEnabled?: boolean;
  onFixAlerts?: () => void;
}

/** A route whose screen a later wave builds. Plain copy, no screen code on
 *  screen — §7 keeps identifiers out of what a volunteer reads. */
function Placeholder() {
  return (
    <div className="r3-placeholder">
      <p>This screen isn't ready yet.</p>
    </div>
  );
}

export function AppShell({ screens, unreadCount, alertsEnabled, onFixAlerts }: AppShellProps) {
  const { status, user, signOut, refresh, error } = useSession();
  const { match, navigate, go } = useRouter();
  const viewport = useViewport();

  if (status === 'loading') {
    return (
      <div className="r3-app">
        <TopBar />
        <main className="r3-app__main">
          <SkeletonRows rows={3} label="Loading R3" />
        </main>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="r3-app">
        <TopBar />
        <main className="r3-app__main">
          <ErrorBlock error={error} onRetry={() => void refresh()} />
        </main>
      </div>
    );
  }

  // Signed out: the login screen and nothing else. No nav, no bell — there is
  // nobody to derive them from.
  if (status === 'signed-out' || !user) {
    const Login = screens.login;
    return (
      <div className="r3-app">
        <TopBar />
        <main className="r3-app__fullscreen">
          {Login ? <Login params={{}} /> : <EmptyState title="Sign in to continue." />}
        </main>
      </div>
    );
  }

  const items = navItemsFor(user, viewport);
  const activeId = match?.route.id ?? null;

  const chrome = (
    <TopBar
      userName={displayName(user)}
      unreadCount={unreadCount ?? 0}
      onOpenInbox={() => go('inbox')}
      onLogout={() => void signOut()}
      {...(alertsEnabled === undefined ? {} : { alertsEnabled })}
      {...(onFixAlerts ? { onFixAlerts } : {})}
    />
  );

  const onSelect = (id: string) => navigate(routeById(id as ScreenId).path);

  let content: ReactNode;
  if (!match) {
    content = (
      <EmptyState title="That page isn't here.">
        <button type="button" className="r3-linkish" onClick={() => navigate(HOME_PATH)}>
          Go to the board
        </button>
      </EmptyState>
    );
  } else if (!canSee(user, match.route.requires)) {
    // Communication only: this page is hidden because the server would refuse it
    // anyway (`architecture.md §4.5`). The refusal there is the rule.
    //
    // The way out is not decoration. §3 obliges an empty state to say what to do
    // next, and this one has to carry the affordance itself: the tablet has NO nav
    // (`nav.tsx` returns [] for it), so without this button a receiver who lands
    // here — by a stale URL after a re-login, most likely — has nothing left but
    // the browser's address bar. `homePathFor` rather than the board, for the same
    // reason it exists: that is the one screen a nav-less receiver can use.
    const home = homePathFor(user, viewport);
    content = (
      <EmptyState
        title="You don't have access to this page."
        action={
          <button type="button" className="r3-linkish" onClick={() => navigate(home)}>
            {home === HOME_PATH ? 'Go to the board' : 'Go to receiving'}
          </button>
        }
      >
        Ask a coordinator if you need it.
      </EmptyState>
    );
  } else {
    const Screen = screens[match.route.id];
    content = Screen ? <Screen params={match.params} /> : <Placeholder />;
  }

  // S1.5's pickup takeover and the login screen fill the viewport (§S1.5, §5).
  if (match?.route.fullScreen) {
    return (
      <div className={`r3-app r3-app--${viewport}`}>
        {chrome}
        <main className="r3-app__fullscreen">{content}</main>
      </div>
    );
  }

  return (
    <div className={`r3-app r3-app--${viewport}`}>
      {chrome}
      <div className="r3-app__body">
        {viewport === 'desktop' && items.length > 0 ? (
          <SideNav items={items} activeId={activeId} onSelect={onSelect} />
        ) : null}
        <main className="r3-app__main">{content}</main>
      </div>
      {viewport === 'phone' && items.length > 0 ? (
        <BottomNav items={items} activeId={activeId} onSelect={onSelect} />
      ) : null}
    </div>
  );
}
