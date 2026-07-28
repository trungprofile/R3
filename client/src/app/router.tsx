// The router. Hand-rolled, deliberately: build-plan D5 considered a routing
// library and rejected it — nine screens behind one nav need a History API
// wrapper, not a framework, and "jobs you do not have cannot fail"
// (`architecture.md §4.4`).
//
// Browser history, not hash fragments. Express already serves the SPA with a
// catch-all fallback to `index.html` (`architecture.md §4.5`), so `/shifts/42`
// loads from a cold start and an inbox deep link resolves.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { buildPath, resolvePath } from './routes.ts';
import type { RouteMatch, RouteParams, ScreenId } from './routes.ts';

interface RouterValue {
  path: string;
  match: RouteMatch | null;
  navigate: (to: string, options?: { replace?: boolean }) => void;
  /** Navigate by screen ID, so a path change is one edit in `routes.ts`. */
  go: (id: ScreenId, params?: RouteParams) => void;
}

const RouterContext = createContext<RouterValue | null>(null);

function currentPath(): string {
  return window.location.pathname;
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(currentPath);

  useEffect(() => {
    // Back/forward. Without this the URL changes and the screen does not.
    const onPopState = () => setPath(currentPath());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((to: string, options?: { replace?: boolean }) => {
    if (to === currentPath()) return;
    if (options?.replace) window.history.replaceState(null, '', to);
    else window.history.pushState(null, '', to);
    setPath(to);
    // A new screen starts at the top; browsers only restore scroll for real
    // navigations, and a board scrolled to Thursday is disorienting on a
    // freshly-opened shift.
    window.scrollTo(0, 0);
  }, []);

  const value = useMemo<RouterValue>(
    () => ({
      path,
      match: resolvePath(path),
      navigate,
      go: (id, params) => navigate(buildPath(id, params)),
    }),
    [path, navigate],
  );

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  const value = useContext(RouterContext);
  if (!value) throw new Error('useRouter used outside RouterProvider');
  return value;
}

/** Params of the current screen. `{}` when the path matched nothing. */
export function useRouteParams(): RouteParams {
  return useRouter().match?.params ?? {};
}

export interface LinkProps {
  to: string;
  children: ReactNode;
  className?: string;
}

/** An in-app link that stays a real anchor: middle-click, ctrl-click and "copy
 *  link address" all keep working, and only a plain left-click is intercepted. */
export function Link({ to, children, className }: LinkProps) {
  const { navigate } = useRouter();

  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented) return;
    if (event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };

  return (
    <a href={to} onClick={onClick} {...(className ? { className } : {})}>
      {children}
    </a>
  );
}
