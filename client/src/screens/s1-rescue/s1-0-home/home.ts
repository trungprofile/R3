// Home — everything about the hub that is a RULE rather than a pixel.
//
// Split out from `HomeScreen.tsx` so it can be tested without a browser: there is
// no jsdom and no component renderer in this repo, and adding one would be a
// dependency (build-plan §3/D5).
//
// The hub is a D22 spec addition — `ui-ux-spec.md §8` has no Home screen. It exists
// because §3 caps the bottom nav at four items and an admin who also drives has six
// destinations, so on a phone or a tablet the office work has to be reached from
// somewhere. This is that somewhere.
//
// Nothing here decides anything. `architecture.md §4.5`: the client repeats the
// server's rules so a volunteer is not offered an action that would be refused, and
// the server checks each of them again on the request that matters. The cards are
// derived from tier and duty by the SAME two helpers the nav uses (`app/access.ts`),
// never by a second reading of the rule.

import type { CurrentUser } from '../../../api/session.ts';
import { atLeastTier, hasDuty } from '../../../app/access.ts';
import { CURRENT_PHASE, routeById } from '../../../app/routes.ts';
import type { ScreenId } from '../../../app/routes.ts';

// ---------------------------------------------------------------------------
// Copy (`ui-ux-spec.md §6, §7`)
//
// One object so the forbidden-word and em-dash checks in `home.test.ts` can read
// every sentence this screen owns. §7 forbids: PWA, push subscription, session,
// payload, endpoint, atomic, instance.
//
// Each subtitle says what the destination is FOR, which the title cannot: "Reports"
// and "Admin" are both places a coordinator has never been. D21's rule bites the
// other way round — a subtitle restating its own title would be cut.
// ---------------------------------------------------------------------------

export const COPY = {
  /** Greeting by first name. `trim()` so a record with no first name reads "Hi"
   *  rather than "Hi " with a hole after it. */
  greeting: (firstName: string) => `Hi ${firstName}`.trim(),

  driveTitle: 'Pick up food',
  driveSubtitle: 'Claim a run, or open the one you already have.',

  receiveTitle: 'Receive a load',
  receiveSubtitle: 'Weigh what a driver brought in.',

  reportTitle: 'Reports',
  reportSubtitle: "The week's totals, and the sheet for the food bank.",

  scheduleTitle: 'Schedule',
  scheduleSubtitle: 'Publish a week, move a run, fill the gaps.',

  adminTitle: 'Admin',
  adminSubtitle: 'People, stores, trucks and categories.',

  inboxTitle: 'Inbox',
  inboxSubtitle: 'Everything that has happened, newest first.',

  /** Nobody with a duty or a tier lands here, so this has to be honest about why
   *  the screen is nearly empty and about who can change it (§7: say why something
   *  is missing). Volunteers with no duties exist. */
  nothingTitle: 'Nothing is assigned to you yet.',
  nothingBody: 'Ask a coordinator to add driving, receiving or reporting to your account.',
} as const;

// ---------------------------------------------------------------------------

export interface HomeCard {
  /** The screen this card opens. Doubles as the icon key on the screen. */
  id: ScreenId;
  title: string;
  /** One line under the title. STATIC in this first version, on purpose: a hub
   *  that fans out five requests on every sign-in is worse than one that does not.
   *  `live` below is the seam for replacing any of them with a real count later,
   *  without changing this shape or any caller. */
  subtitle: string;
  path: string;
}

/** Live lines, keyed by the card they belong to. Empty today. When a count is
 *  worth a request ("2 trucks waiting"), it is passed in here and overrides the
 *  static subtitle for that one card only. */
export type LiveSubtitles = Partial<Record<ScreenId, string>>;

/** A screen whose phase has not shipped is not offered — a card leading to the
 *  shell's placeholder is worse than no card. Mirrors `app/nav.tsx`. */
function shipped(id: ScreenId): boolean {
  return routeById(id).phase <= CURRENT_PHASE;
}

function card(id: ScreenId, title: string, subtitle: string, live: LiveSubtitles): HomeCard {
  return { id, title, subtitle: live[id] ?? subtitle, path: routeById(id).path };
}

/**
 * What this person can do, in the order the nav lists it.
 *
 * SIX at most, since D31 sent My shifts back to the Board as a tab: Pick up food,
 * Receive a load, Report, Schedule, Admin, Inbox. Nobody holds more than that, so
 * the grid never needs a second screenful and the hub never needs a scroll on the
 * phone it exists for.
 *
 * Duty is set membership and tier is hierarchical (I1, I2) — `atLeastTier` and
 * `hasDuty` are imported rather than re-expressed, because a hub that disagrees
 * with the nav about who may schedule is two rules where there should be one.
 *
 * Inbox is always last and always present: it is the source of truth for events
 * regardless of duty, and it is what keeps a volunteer with nothing assigned from
 * landing on a screen with no way off it.
 */
export function homeCardsFor(user: CurrentUser, live: LiveSubtitles = {}): HomeCard[] {
  const cards: HomeCard[] = [];

  if (hasDuty(user, 'DRIVE')) {
    cards.push(card('board', COPY.driveTitle, COPY.driveSubtitle, live));
  }
  if (hasDuty(user, 'RECEIVE') && shipped('receive-runs')) {
    cards.push(card('receive-runs', COPY.receiveTitle, COPY.receiveSubtitle, live));
  }
  if (hasDuty(user, 'REPORT') && shipped('report')) {
    cards.push(card('report', COPY.reportTitle, COPY.reportSubtitle, live));
  }
  if (atLeastTier(user, 'STAFF')) {
    cards.push(card('schedule', COPY.scheduleTitle, COPY.scheduleSubtitle, live));
  }
  if (atLeastTier(user, 'ADMIN')) {
    cards.push(card('admin', COPY.adminTitle, COPY.adminSubtitle, live));
  }

  cards.push(card('inbox', COPY.inboxTitle, COPY.inboxSubtitle, live));
  return cards;
}

/** True when the only card is the inbox — nobody has given this person a duty or
 *  a tier yet. The screen says so plainly instead of showing one lonely card and
 *  leaving them to guess whether it is broken. */
export function hasNothingAssigned(cards: readonly HomeCard[]): boolean {
  return cards.every((entry) => entry.id === 'inbox');
}
