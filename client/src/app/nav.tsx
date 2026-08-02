// Navigation, derived from what the signed-in user can do — `ui-ux-spec.md §4`.
//
// "Navigation is derived from what the logged-in user can do, not a manual duty
// switcher." There is no duty picker anywhere in R3 and adding one is a spec
// change, not a feature (§4, and the spec's own open assumption 2).
//
// Per device (§4):
//   - Phone (driver): bottom nav = Board · My Shifts · Inbox.
//   - Tablet (receive): NO NAV. Login goes straight to weight entry, Phase 2.
//   - Desktop (back office): left nav, sections by role/duty —
//       `report` duty → Report; Staff tier → Schedule, Board; Admin tier →
//       Admin. A Staff member who also reports sees both. No switching.
//
// ORDER ON THE DESKTOP IS STAFF-FIRST: Admin · Schedule · Report · Board ·
// My Shifts · Inbox. The tier- and duty-restricted entries come before the ones
// everybody has, because the back office is what a desktop is FOR — a coordinator
// signs in to publish a week, not to look at the board they could have opened on
// their phone. §4 lists the sections but does not fix their order, so this is a
// house choice rather than a spec change.
//
// It does NOT move the landing screen. `HOME_PATH` is still `/board`: the board is
// the spec's "adoption centerpiece" and the one screen everyone can open, so it
// stays the front door even though it is no longer the first link.
//
// Metrics is absent on purpose. D18 made it S1.8's first tab, so the Admin entry
// leads to it; a second entry would be two links to one screen.
//
// Tier is hierarchical, duty is set membership — see `access.ts`.

import type { ReactNode } from 'react';
import {
  BellIcon,
  BoardIcon,
  CalendarIcon,
  ClockIcon,
  DocumentIcon,
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

function entry(id: ScreenId, label: string, icon: ReactNode): NavEntry {
  return { id, label, path: routeById(id).path, icon };
}

/** A screen whose phase has not shipped is defined but not offered — a nav item
 *  leading to a screen that does not exist is worse than one that is absent. */
function shipped(id: ScreenId): boolean {
  return routeById(id).phase <= CURRENT_PHASE;
}

export function navItemsFor(user: CurrentUser, viewport: Viewport): NavEntry[] {
  if (viewport === 'tablet') return []; // §4: tablet has no nav.

  const items: NavEntry[] = [];
  const drives = hasDuty(user, 'DRIVE');
  const staff = atLeastTier(user, 'STAFF');

  if (viewport === 'phone') {
    // §3 caps the bottom nav at 4 items; these are 3. My Shifts is where a
    // driver's own runs and availability live (S1.4), so it is offered to
    // someone who can hold a run at all.
    items.push(entry('board', 'Board', <BoardIcon />));
    if (drives) items.push(entry('my-shifts', 'My Shifts', <CalendarIcon />));
    items.push(entry('inbox', 'Inbox', <BellIcon />));
    return items;
  }

  // Desktop, staff-first. §4's list is the back office; the responsive matrix also
  // marks the board, my shifts and the inbox as usable here, so a driver at the
  // shared desktop is not stranded with an empty nav — those simply come after the
  // work only this device can do.
  if (atLeastTier(user, 'ADMIN')) items.push(entry('admin', 'Admin', <PeopleIcon />));
  if (staff) items.push(entry('schedule', 'Schedule', <ClockIcon />));
  if (hasDuty(user, 'REPORT') && shipped('report')) {
    items.push(entry('report', 'Report', <DocumentIcon />));
  }
  if (staff || drives) items.push(entry('board', 'Board', <BoardIcon />));
  if (drives) items.push(entry('my-shifts', 'My Shifts', <CalendarIcon />));
  items.push(entry('inbox', 'Inbox', <BellIcon />));
  return items;
}
