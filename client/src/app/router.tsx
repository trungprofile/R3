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

/** `?tab=metrics`, `?edit=<shiftId>` — the small amount of screen state that has to
 *  survive a link. Deliberately not path segments: a query keeps `ROUTES` a flat
 *  list of nine screens, where `/admin/:tab?` would make every screen's path a
 *  pattern to reason about. Read via `useQuery()`. */
export type Query = Readonly<Record<string, string>>;

interface RouterValue {
  /** Pathname only. `resolvePath` matches against this, never the query. */
  path: string;
  /** Pathname + query, i.e. what is actually in the address bar. */
  href: string;
  query: Query;
  match: RouteMatch | null;
  navigate: (to: string, options?: { replace?: boolean }) => void;
  /** Navigate by screen ID, so a path change is one edit in `routes.ts`. */
  go: (id: ScreenId, params?: RouteParams, query?: Query) => void;
  /** Change the query without touching the path or adding a history entry.
   *  A tab switch is not a place you should have to press Back through. */
  setQuery: (next: Query) => void;
}

const RouterContext = createContext<RouterValue | null>(null);

function currentHref(): string {
  return window.location.pathname + window.location.search;
}

function splitHref(href: string): { path: string; query: Query } {
  const cut = href.indexOf('?');
  if (cut === -1) return { path: href, query: {} };
  const query: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(href.slice(cut + 1))) query[key] = value;
  return { path: href.slice(0, cut), query };
}

function withQuery(path: string, query: Query): string {
  const search = new URLSearchParams(
    // An empty value means "not set". Otherwise clearing a tab would leave
    // `?tab=` behind and every link would grow a tail of dead keys.
    Object.entries(query).filter(([, value]) => value !== ''),
  ).toString();
  return search === '' ? path : `${path}?${search}`;
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [href, setHref] = useState(currentHref);

  useEffect(() => {
    // Back/forward. Without this the URL changes and the screen does not.
    const onPopState = () => setHref(currentHref());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((to: string, options?: { replace?: boolean }) => {
    if (to === currentHref()) return;
    if (options?.replace) window.history.replaceState(null, '', to);
    else window.history.pushState(null, '', to);
    setHref(to);
    // A new screen starts at the top; browsers only restore scroll for real
    // navigations, and a board scrolled to Thursday is disorienting on a
    // freshly-opened shift.
    window.scrollTo(0, 0);
  }, []);

  const value = useMemo<RouterValue>(() => {
    const { path, query } = splitHref(href);
    return {
      path,
      href,
      query,
      match: resolvePath(path),
      navigate,
      go: (id, params, nextQuery) =>
        navigate(withQuery(buildPath(id, params), nextQuery ?? {})),
      setQuery: (next) => navigate(withQuery(path, next), { replace: true }),
    };
  }, [href, navigate]);

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

/** Query string of the current URL. `{}` when there is none. */
export function useQuery(): Query {
  return useRouter().query;
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
