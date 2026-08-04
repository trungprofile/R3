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
// the duty model rather than of the app. ONE ENTRY PER CAPABILITY, one unheaded
// list, the same list everywhere. That rule stands; two things about it moved.
//
// D51 REPLACES D30's ORDER. D30 listed the entries "in the order a week runs" —
// pick the food up, receive it, report it. Read top-down that puts a volunteer's
// screens above an admin's, so the person with the most to do scrolls furthest for
// the thing only they can reach. The list now descends by privilege, which puts the
// narrowest capability first and means a shorter list is always a PREFIX-free
// subset of a longer one rather than a differently-shuffled version of it:
//
//   Home · Admin · Schedule · Report · Receive a load · Today's pickup · Shift board · Inbox
//
// D49 SOFTENS D30's "one entry per capability" for DRIVE, and only for DRIVE.
// Driving is two jobs, not one: the runs you already own (today, and the rest of
// the week) and the board you claim new ones from. D30 nested the first inside the
// second as `?tab=mine`, which then grew a second tab row inside itself — two
// levels of tabs for a driver looking for their own morning. They are two sibling
// entries now:
//   - Today's pickup → `/my-shifts`, the driver's own runs. Named for the day it
//     opens on rather than for the job (D64): the page leads with today's run.
//   - Shift board  → `/board`, the claimable board and When I'm away.
// This is not a licence to split any other capability; it is a statement that DRIVE
// was two capabilities that had been written down as one.
//
// Two entries are still absent, for D30's original reason:
//   - Metrics is Admin's first tab (D18), so the Admin entry leads to it.
//   - Log a donation is reached from `Unscheduled donation` on the receive run
//     picker, which is where a receiver already is when they need it.
//
// Per surface:
//   - Desktop: the whole list in `SideNav`.
//   - Phone AND tablet: a shorter, CAPPED list in `BottomNav`. §3 caps the bottom
//     nav at four items with icon and label, which is why this is a different list
//     rather than the same one drawn smaller — up to eight destinations, room for
//     four. Office work is reached through the Home hub on those two surfaces,
//     which is what earns the hub its place (D22). The cap is the design, not a
//     truncation of the desktop list.
//
// Tier is hierarchical, duty is set membership — see `access.ts`.

import type { ReactNode } from 'react';
import {
  BellIcon,
  BoardIcon,
  CalendarIcon,
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
/** The driver's own runs (D49). A calendar rather than a truck: what this entry
 *  answers is "when am I out?", and the board beside it is the list of runs. */
const myShifts = (label: string) => entry('my-shifts', label, <CalendarIcon />);

/**
 * The desktop nav: one entry per capability this user holds, in one flat run (D30),
 * descending by privilege (D51), with DRIVE's two entries adjacent (D49).
 *
 *   Home · Admin · Schedule · Report · Receive a load · Today's pickup · Shift board · Inbox
 *
 * Eight is the whole list and it belongs to exactly one person: an Admin holding
 * all three duties. Everyone else reads a subset in the same relative order.
 */
export function navSectionsFor(user: CurrentUser): NavSection[] {
  const drives = hasDuty(user, 'DRIVE');
  const staff = atLeastTier(user, 'STAFF');

  const items: NavEntry[] = [home()];

  if (atLeastTier(user, 'ADMIN')) items.push(entry('admin', 'Admin', <PeopleIcon />));
  if (staff) items.push(entry('schedule', 'Schedule', <ClockIcon />));
  if (hasDuty(user, 'REPORT') && shipped('report')) {
    items.push(entry('report', 'Report', <DocumentIcon />));
  }
  if (hasDuty(user, 'RECEIVE') && shipped('receive-runs')) items.push(receive('Receive a load'));

  // The driver's own runs. Gated on the duty alone, matching `routes.ts` — a
  // coordinator has no runs of their own, so this page would be empty for them.
  // D64: named for what the page opens on — today's run — not for the duty.
  if (drives) items.push(myShifts("Today's pickup"));
  // §4 gives the board to the Staff tier as well as to drivers: a coordinator
  // watches claims land there. It is named for what it IS since D49 — the driver's
  // own runs belong to the entry above, and a coordinator was never opening this to
  // pick food up anyway.
  if (drives || staff) items.push(board('Shift board'));

  items.push(inbox());
  return [{ heading: null, items }];
}

/** §3's cap on the bottom bar. Not a layout preference: 56px tall with the icon
 *  above the word is what makes a fifth item unreadable rather than merely tight. */
const BOTTOM_BAR_CAP = 4;

/**
 * The bottom bar: at most four items, icon and label (§3).
 *
 * Deliberately NOT the full list, and not a truncation of it either. Home and Inbox
 * are fixed at the ends, which leaves TWO slots for up to six capabilities — so the
 * bar carries one entry per DUTY held and everything else is reached through the
 * Home hub. That is what earns the hub its place (D22), and it is the design rather
 * than a screen that ran out of room.
 *
 * D49 gave DRIVE a second entry, which does not fit beside a second duty. A driver
 * who does not receive spends the spare slot on the Shift board; a driver who also
 * receives gets Receive there instead, and reaches the board from Home. The slots
 * fill in the same descending-privilege order as the sidebar (D51).
 *
 * Shorter labels than the sidebar's: 56px tall, icon above the word, and "Receive a
 * load" does not fit on a 375px phone at four across.
 */
function bottomBarFor(user: CurrentUser): NavEntry[] {
  const drives = hasDuty(user, 'DRIVE');
  const receives = hasDuty(user, 'RECEIVE') && shipped('receive-runs');

  // The middle, in the sidebar's order. Home and Inbox bracket it, so this may be
  // at most two long.
  const middle: NavEntry[] = [];
  if (receives) middle.push(receive('Receive'));
  if (drives) middle.push(myShifts('Pickup'));
  // The board takes whatever slot is left. For a driver who does not receive that is
  // their second entry (D49); for anyone holding neither duty it is the one
  // destination everyone can open, so a coordinator or a volunteer with nothing
  // assigned gets a bar with somewhere to go rather than two items in 56px.
  if (!receives) middle.push(board('Board'));

  // The cap is §3's and it is enforced here rather than trusted to the branches
  // above: a fourth duty would otherwise silently draw a fifth item into 56px.
  return [home(), ...middle.slice(0, BOTTOM_BAR_CAP - 2), inbox()];
}

/**
 * What this surface shows. The whole list on the desktop, a capped one elsewhere.
 *
 * One entry point rather than two exports, so a caller cannot draw the desktop's
 * eight items into a bar §3 caps at four.
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
