// Navigation, derived from what the signed-in user can do — `ui-ux-spec.md §4`.
//
// "Navigation is derived from what the logged-in user can do, not a manual duty
// switcher." There is no duty picker anywhere in R3 and adding one is a spec
// change, not a feature (§4, and the spec's own open assumption 2).
//
// D22 removed the early `[]` return that left the whole 768-1023px band with no
// links at all and gave `Receive` no nav entry on any viewport. That fix stands.
//
// D30 undid the other half of D22 — the three headings. PICKING UP / RECEIVING /
// OFFICE grouped seven entries into three runs of two or three, which is a map of
// the duty model rather than of the app: the person who needs the grouping is the
// one holding two duties, and they were already reading only two of the three
// groups. ONE ENTRY PER CAPABILITY, one unheaded list, the same list everywhere:
//
//   Home · Pick up food · Receive a load · Report · Schedule · Admin · Inbox
//
// Two entries went with the headings rather than under them:
//   - My shifts is a tab of the Board now, so a second link to the same screen
//     would be the two-links-to-one-place problem D18 already settled for Metrics.
//   - Log a donation is reached from `Unscheduled donation` on the receive run
//     picker, which is where a receiver already is when they need it.
//
// Per surface:
//   - Desktop: the whole list in `SideNav`.
//   - Phone AND tablet: a shorter, CAPPED list in `BottomNav`. §3 caps the bottom
//     nav at four items with icon and label, which is why this is a different list
//     rather than the same one drawn smaller — six destinations, room for four.
//     Office work is reached through the Home hub on those two surfaces, which is
//     what earns the hub its place (D22).
//
// Metrics is absent on purpose. D18 made it S1.8's first tab, so the Admin entry
// leads to it; a second entry would be two links to one screen.
//
// Tier is hierarchical, duty is set membership — see `access.ts`.

import type { ReactNode } from 'react';
import {
  BellIcon,
  BoardIcon,
  ChartIcon,
  ClockIcon,
  DocumentIcon,
  HomeIcon,
  PeopleIcon,
} from '../components/index.ts';
import type { CurrentUser } from '../api/session.ts';
import { atLeastTier, hasDuty } from './access.ts';
import { CURRENT_PHASE, routeById } from './routes.ts';
import type { ScreenId } from './routes.ts';
import type { Viewport } from './useViewport.ts';

export interface NavEntry {
  id: ScreenId;
  label: string;
  path: string;
  icon: ReactNode;
}

/** A run of entries. `heading` has been `null` everywhere since D30 flattened the
 *  desktop list; the field survives so `SideNav`'s contract and every caller's
 *  signature did not have to change with it. */
export interface NavSection {
  heading: string | null;
  items: NavEntry[];
}

function entry(id: ScreenId, label: string, icon: ReactNode): NavEntry {
  return { id, label, path: routeById(id).path, icon };
}

/** A screen whose phase has not shipped is defined but not offered — a nav item
 *  leading to a screen that does not exist is worse than one that is absent. */
function shipped(id: ScreenId): boolean {
  return routeById(id).phase <= CURRENT_PHASE;
}

// The entries, named once so the full list and the capped bar cannot drift into
// two spellings of the same destination.
const home = () => entry('home', 'Home', <HomeIcon />);
const inbox = () => entry('inbox', 'Inbox', <BellIcon />);
const board = (label: string) => entry('board', label, <BoardIcon />);
const receive = (label: string) => entry('receive-runs', label, <ChartIcon />);

/**
 * The desktop nav: one entry per capability this user holds, in one flat run (D30).
 *
 * The order is the order a week runs — pick the food up, receive it, report it —
 * with the two screens everyone has bracketing it.
 */
export function navSectionsFor(user: CurrentUser): NavSection[] {
  const drives = hasDuty(user, 'DRIVE');
  const staff = atLeastTier(user, 'STAFF');

  const items: NavEntry[] = [home()];

  // §4 gives the board to the Staff tier as well as to drivers: a coordinator
  // watches claims land there. D30 renamed it to match the Home card — a
  // coordinator opening it is still watching people pick food up.
  if (drives || staff) items.push(board('Pick up food'));
  if (hasDuty(user, 'RECEIVE') && shipped('receive-runs')) items.push(receive('Receive a load'));
  if (hasDuty(user, 'REPORT') && shipped('report')) {
    items.push(entry('report', 'Report', <DocumentIcon />));
  }
  if (staff) items.push(entry('schedule', 'Schedule', <ClockIcon />));
  if (atLeastTier(user, 'ADMIN')) items.push(entry('admin', 'Admin', <PeopleIcon />));

  items.push(inbox());
  return [{ heading: null, items }];
}

/**
 * The bottom bar: at most four items, icon and label (§3).
 *
 * Deliberately NOT the full list. Schedule, Report and Admin are reached through
 * the Home hub on a phone and on a tablet, because §3's cap leaves room for four
 * and an admin who also drives has six places to be (D22).
 *
 * Shorter labels than the sidebar's for the same reason: 56px tall, icon above the
 * word, and "Receive a load" does not fit on a 375px phone at four across.
 */
function bottomBarFor(user: CurrentUser): NavEntry[] {
  const drives = hasDuty(user, 'DRIVE');
  const receives = hasDuty(user, 'RECEIVE') && shipped('receive-runs');

  const items: NavEntry[] = [home()];
  if (drives) items.push(board('Pick up'));
  if (receives) items.push(receive('Receive'));
  // Neither duty: the board is what the rest of the app is about and everyone can
  // open it, so a coordinator or a volunteer with nothing assigned gets a bar with
  // somewhere to go rather than two items floating in 56px.
  if (!drives && !receives) items.push(board('Board'));
  items.push(inbox());
  return items;
}

/**
 * What this surface shows. The whole list on the desktop, a capped one elsewhere.
 *
 * One entry point rather than two exports, so a caller cannot draw the desktop's
 * seven items into a bar §3 caps at four.
 */
export function navItemsFor(user: CurrentUser, viewport: Viewport): NavSection[] {
  if (viewport === 'desktop') return navSectionsFor(user);
  return [{ heading: null, items: bottomBarFor(user) }];
}

/** The flat item list behind whatever `navItemsFor` returned — what `BottomNav`
 *  takes, and what a test counts. */
export function flattenNav(sections: readonly NavSection[]): NavEntry[] {
  return sections.flatMap((section) => section.items);
}
