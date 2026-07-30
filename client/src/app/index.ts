// The shell: routing, navigation, and the global interaction patterns of §6.
//
// A screen imports what it needs from here rather than reaching into the files —
// the shape of the shell is a contract, its layout is not.

export { App } from './App.tsx';
export { AppShell } from './AppShell.tsx';
export type { AppShellProps, ScreenProps, ScreenRegistry } from './AppShell.tsx';

export { RouterProvider, useRouter, useRouteParams, Link } from './router.tsx';
export type { LinkProps } from './router.tsx';

export {
  ROUTES,
  CURRENT_PHASE,
  HOME_PATH,
  matchPath,
  resolvePath,
  routeById,
  buildPath,
} from './routes.ts';
export type { Access, RouteDef, RouteMatch, RouteParams, ScreenId } from './routes.ts';

export { tierRank, atLeastTier, hasDuty, hasAnyDuty, canSee } from './access.ts';
export { navItemsFor } from './nav.tsx';
export type { NavEntry } from './nav.tsx';

export { SessionProvider, useSession, useCurrentUser } from './SessionProvider.tsx';
export type { SessionStatus, SessionValue } from './SessionProvider.tsx';

export { ToastProvider, useToast } from './ToastProvider.tsx';
export { OfflineBanner } from './OfflineBanner.tsx';
export { IdlePrompt } from './IdlePrompt.tsx';
export { useViewport } from './useViewport.ts';
export type { Viewport } from './useViewport.ts';
export { todayInZone, deviceToday } from './pantry-day.ts';
export { useAsyncData } from './useAsyncData.ts';
export type { AsyncData } from './useAsyncData.ts';
