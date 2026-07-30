// The route table. One entry per screen in `ui-ux-spec.md §8`.
//
// Paths are real URL paths, not hash fragments: Express serves the SPA with a
// catch-all fallback to `index.html` (`architecture.md §4.5`), so a deep link
// pasted into a browser — or opened from an inbox notification — resolves.
//
// `requires` mirrors the tier/duty gate the SERVER declares on the matching
// route (`architecture.md §4.3`). Repeating it here hides pages a user cannot
// use; it decides nothing. Every rule is enforced again server-side (§4.5).

import type { Duty, Tier } from '../api/shared.ts';

export type ScreenId =
  | 'login' // S1.1
  | 'board' // S1.2
  | 'shift' // S1.3
  | 'my-shifts' // S1.4
  | 'pickup' // S1.5
  | 'schedule' // S1.6
  | 'reschedule' // S1.7
  | 'admin' // S1.8
  | 'inbox' // S1.9
  | 'receive-runs' // S2.1b
  | 'receive-stop' // S2.2
  | 'receive-done' // S2.2b
  | 'donation' // S2.3
  | 'report' // S3.1
  | 'metrics'; // S3.2

export interface Access {
  /** Minimum tier. Hierarchical — Staff admits Admin (I1). */
  tier?: Tier;
  /** Holding ANY of these duties. Set membership, never a hierarchy (I2). */
  anyDuty?: Duty[];
}

export interface RouteDef {
  id: ScreenId;
  /** Pattern; `:name` segments become params. */
  path: string;
  /** The screen ID in the UI spec, for anyone tracing a route back to its spec. */
  spec: string;
  /** Which build phase ships this screen. Routes above `CURRENT_PHASE` are
   *  defined but not yet reachable — the nav must not offer a dead end. */
  phase: 1 | 2 | 3;
  requires?: Access;
  /** Full-bleed: no top bar, no nav. Login (§5) and the pickup takeover (S1.5). */
  fullScreen?: boolean;
}

/**
 * Bump as phases ship. Phase 3 adds report and metrics — the last of the three
 * (`product-requirement.md §4`), so every route in this table is now reachable.
 *
 * Bumped WITH the screens, never ahead of them: `nav.tsx` offers a nav entry the
 * moment a route's phase has shipped, so a premature bump puts Report and Metrics in
 * the desktop nav pointing at the shell's placeholder. Phase 2 learned this from a
 * `doc-qa` finding about the tablet home path and the rule has held since.
 */
export const CURRENT_PHASE = 3;

export const ROUTES: readonly RouteDef[] = [
  { id: 'login', path: '/login', spec: 'S1.1', phase: 1, fullScreen: true },
  { id: 'board', path: '/board', spec: 'S1.2', phase: 1 },
  { id: 'shift', path: '/shifts/:shiftId', spec: 'S1.3', phase: 1 },
  { id: 'my-shifts', path: '/my-shifts', spec: 'S1.4', phase: 1, requires: { anyDuty: ['DRIVE'] } },
  {
    id: 'pickup',
    path: '/pickup/:shiftId',
    spec: 'S1.5',
    phase: 1,
    requires: { anyDuty: ['DRIVE'] },
    // §S1.5: full-screen takeover while a route is active.
    fullScreen: true,
  },
  { id: 'schedule', path: '/schedule', spec: 'S1.6', phase: 1, requires: { tier: 'STAFF' } },
  {
    id: 'reschedule',
    path: '/schedule/:shiftId/reschedule',
    spec: 'S1.7',
    phase: 1,
    requires: { tier: 'STAFF' },
  },
  { id: 'admin', path: '/admin', spec: 'S1.8', phase: 1, requires: { tier: 'ADMIN' } },
  { id: 'inbox', path: '/inbox', spec: 'S1.9', phase: 1 },

  // Phase 2 — receiving. Canonical on the shared tablet in landscape; the
  // responsive matrix marks weight entry and unscheduled donation `n/a` on a
  // phone, so these are the only screens in the app with no phone target.
  //
  // `anyDuty: ['RECEIVE']` throughout: receiving is a duty, and I2 makes duties
  // set membership, so an Admin without it is not a receiver.
  {
    id: 'receive-runs',
    path: '/receive',
    spec: 'S2.1b',
    phase: 2,
    requires: { anyDuty: ['RECEIVE'] },
  },
  {
    id: 'receive-stop',
    path: '/receive/:shiftId/stops/:stopId',
    spec: 'S2.2',
    phase: 2,
    requires: { anyDuty: ['RECEIVE'] },
  },
  {
    id: 'receive-done',
    path: '/receive/:shiftId/done',
    spec: 'S2.2b',
    phase: 2,
    requires: { anyDuty: ['RECEIVE'] },
  },
  {
    id: 'donation',
    path: '/donations/new',
    spec: 'S2.3',
    phase: 2,
    requires: { anyDuty: ['RECEIVE'] },
  },

  { id: 'report', path: '/report', spec: 'S3.1', phase: 3, requires: { anyDuty: ['REPORT'] } },
  { id: 'metrics', path: '/metrics', spec: 'S3.2', phase: 3, requires: { tier: 'ADMIN' } },
];

/** Where a signed-in user lands by default. The board is the adoption centerpiece
 *  (S1.2) and the one screen everyone can open. */
export const HOME_PATH = '/board';

/**
 * Where THIS user lands after signing in.
 *
 * `ui-ux-spec.md §4` is explicit about the tablet: "Login goes straight to weight
 * entry, Phase 2", and S2.1 says the receiver login "opens to S2.1b (run picker)".
 * That surface has no navigation at all (`nav.tsx` returns an empty list for it), so
 * the run picker is not merely a nicer default there — it is the only screen a
 * receiver could reach.
 *
 * Which is also why this arrived one commit after the route table: pointing a
 * nav-less surface at a screen the registry did not yet hold would have replaced a
 * working board with a placeholder whose only affordance is Logout.
 *
 * Keyed on the duty AND the viewport, never either alone: a receiver who opens R3 on
 * the shared desktop still has a nav and still wants the board.
 */
export function homePathFor(
  user: { duties: readonly Duty[] },
  viewport: 'phone' | 'tablet' | 'desktop',
): string {
  if (viewport === 'tablet' && user.duties.includes('RECEIVE')) {
    return routeById('receive-runs').path;
  }
  return HOME_PATH;
}

export type RouteParams = Readonly<Record<string, string>>;

export interface RouteMatch {
  route: RouteDef;
  params: RouteParams;
}

/** Matches one pattern against one path. Segment count must be equal — no
 *  wildcards, no optional segments, nine screens and no framework (build-plan D5). */
export function matchPath(pattern: string, path: string): RouteParams | null {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = path.split('/').filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const expected = patternParts[index] as string;
    const actual = pathParts[index] as string;
    if (expected.startsWith(':')) {
      if (actual === '') return null;
      params[expected.slice(1)] = decodeURIComponent(actual);
    } else if (expected !== actual) {
      return null;
    }
  }
  return params;
}

export function resolvePath(path: string): RouteMatch | null {
  // Static routes before parameterised ones, so `/schedule` never matches a
  // pattern like `/:something` by accident of table order.
  const ordered = [...ROUTES].sort(
    (a, b) => Number(a.path.includes(':')) - Number(b.path.includes(':')),
  );
  for (const route of ordered) {
    const params = matchPath(route.path, path);
    if (params) return { route, params };
  }
  return null;
}

export function routeById(id: ScreenId): RouteDef {
  const route = ROUTES.find((candidate) => candidate.id === id);
  if (!route) throw new Error(`Unknown screen: ${id}`);
  return route;
}

/** Fills `:params` in a route's pattern. Throws rather than navigating to a URL
 *  with a literal ":shiftId" in it. */
export function buildPath(id: ScreenId, params: RouteParams = {}): string {
  return routeById(id)
    .path.split('/')
    .map((segment) => {
      if (!segment.startsWith(':')) return segment;
      const value = params[segment.slice(1)];
      if (value === undefined) throw new Error(`Missing "${segment.slice(1)}" for screen ${id}`);
      return encodeURIComponent(value);
    })
    .join('/');
}
