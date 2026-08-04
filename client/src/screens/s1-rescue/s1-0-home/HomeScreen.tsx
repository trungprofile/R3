// Home — the hub every signed-in user lands on (D22).
//
// Large tappable cards for what THIS person can do, derived from tier and duty
// exactly as the nav is. There is no duty switcher and this is not one: nothing is
// chosen, everything the user holds is on the screen at once (§4, and the spec's
// own open assumption 2).
//
// Canonical on every surface. On a phone and a tablet it is also the only route to
// Schedule, Report and Admin, because §3 caps the bottom bar at four items.
//
// At most seven cards since D50 raised D31's cap by one for D49's second driver
// card, which is what keeps the grid to one screenful.
//
// One request on this screen: none. The subtitles are static descriptive text, and
// the seam for a live count is `homeCardsFor(user, live)` — see `home.ts`.

import type { ReactNode } from 'react';
import type { ScreenProps } from '../../../app/index.ts';
import { useCurrentUser, useRouter } from '../../../app/index.ts';
import {
  BellIcon,
  BoardIcon,
  CalendarIcon,
  ChartIcon,
  ClockIcon,
  DocumentIcon,
  EmptyState,
  PeopleIcon,
} from '../../../components/index.ts';
import type { ScreenId } from '../../../app/index.ts';
import { COPY, hasNothingAssigned, homeCardsFor } from './home.ts';
import './home.css';

/** The same glyph the nav uses for the same destination, so a card and a nav item
 *  read as one place. Icons live here rather than in `home.ts` to keep that file
 *  free of JSX and therefore testable without a renderer. */
const ICONS: Partial<Record<ScreenId, ReactNode>> = {
  'my-shifts': <CalendarIcon size="2em" />,
  board: <BoardIcon size="2em" />,
  'receive-runs': <ChartIcon size="2em" />,
  report: <DocumentIcon size="2em" />,
  schedule: <ClockIcon size="2em" />,
  admin: <PeopleIcon size="2em" />,
  inbox: <BellIcon size="2em" />,
};

export function HomeScreen(_props: ScreenProps) {
  const user = useCurrentUser();
  const { navigate } = useRouter();
  const cards = homeCardsFor(user);

  return (
    <div className="r3-home">
      <h1 className="r3-home__greeting">{COPY.greeting(user.firstName)}</h1>

      {hasNothingAssigned(cards) ? (
        <EmptyState title={COPY.nothingTitle}>{COPY.nothingBody}</EmptyState>
      ) : null}

      <ul className="r3-home__cards">
        {cards.map((card) => (
          <li key={card.id}>
            {/* The whole card is the target (§3's big-row rule), not a link inside it. */}
            <button type="button" className="r3-home__card" onClick={() => navigate(card.path)}>
              <span className="r3-home__card-icon" aria-hidden="true">
                {ICONS[card.id]}
              </span>
              <span className="r3-home__card-text">
                <span className="r3-home__card-title">{card.title}</span>
                <span className="r3-home__card-sub">{card.subtitle}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
