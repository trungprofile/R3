// Home — the card derivation and the copy.
//
// There is no jsdom and no component renderer in this repo, and adding one would
// be a dependency (build-plan §3/D5) — so nothing here renders anything. What is
// covered is what a wrong answer would silently break: who gets which card, that
// nobody is ever left with nothing, and that every card points somewhere real.
//
// Run: npx vitest run --root client

import { describe, expect, it } from 'vitest';
import { COPY, hasNothingAssigned, homeCardsFor } from './home.ts';
import { canSee } from '../../../app/access.ts';
import { resolvePath } from '../../../app/routes.ts';
import type { CurrentUser } from '../../../api/session.ts';
import { DUTIES, TIERS } from '../../../api/shared.ts';
import type { Duty, Tier } from '../../../api/shared.ts';

function user(tier: Tier, duties: Duty[]): CurrentUser {
  return {
    id: 'u1',
    username: 'luispark',
    firstName: 'Luis',
    lastName: 'Park',
    tier,
    duties,
    active: true,
  };
}

const driver = user('VOLUNTEER', ['DRIVE']);
const receiver = user('VOLUNTEER', ['RECEIVE']);
const bothDuties = user('VOLUNTEER', ['DRIVE', 'RECEIVE']);
const noDuties = user('VOLUNTEER', []);
const coordinator = user('STAFF', []);
const reporter = user('STAFF', ['REPORT']);
const admin = user('ADMIN', ['REPORT']);

const ids = (person: CurrentUser) => homeCardsFor(person).map((card) => card.id);

/** Every tier crossed with every subset of duties — 3 x 8 = 24 people, the whole
 *  space, so the six-card cap is proved rather than sampled. */
const everyone: CurrentUser[] = TIERS.flatMap((tier) => {
  const subsets: Duty[][] = [[]];
  for (const duty of DUTIES) {
    for (const subset of [...subsets]) subsets.push([...subset, duty]);
  }
  return subsets.map((duties) => user(tier, duties));
});

describe('cards derived from tier and duty (D22)', () => {
  it('gives a driver the board', () => {
    expect(ids(driver)).toEqual(['board', 'inbox']);
  });

  it('offers no My shifts card — D31 made it a tab of the Board', () => {
    // It used to be here because the bottom bar is capped at four (§3) and the hub
    // was the only route to availability on a phone. The Board is now that route,
    // and two cards leading to one screen is a worse map than one.
    for (const person of everyone) expect(ids(person)).not.toContain('my-shifts');
  });

  it('gives a receiver the run picker — the entry that had no nav anywhere before', () => {
    expect(ids(receiver)).toEqual(['receive-runs', 'inbox']);
  });

  it('gives someone holding two duties both, at once and unswitched', () => {
    // The hub is not a duty picker (§4): nothing is chosen, everything is shown.
    expect(ids(bothDuties)).toEqual(['board', 'receive-runs', 'inbox']);
  });

  it('treats duties as set membership, never a hierarchy (I2)', () => {
    expect(ids(receiver)).not.toContain('board');
    expect(ids(driver)).not.toContain('receive-runs');
    // An Admin without the receive duty is not a receiver.
    expect(ids(admin)).not.toContain('receive-runs');
  });

  it('opens Schedule to the Staff tier and above — tier is hierarchical (I1)', () => {
    expect(ids(coordinator)).toContain('schedule');
    expect(ids(admin)).toContain('schedule');
    expect(ids(driver)).not.toContain('schedule');
  });

  it('opens Admin to the Admin tier only', () => {
    expect(ids(admin)).toContain('admin');
    expect(ids(coordinator)).not.toContain('admin');
  });

  it('opens Report on the duty, not the tier — an Admin without it is not a reporter', () => {
    expect(ids(reporter)).toContain('report');
    expect(ids(coordinator)).not.toContain('report');
  });

  it('puts the duty cards first, then the tier ones, inbox last', () => {
    expect(ids(admin)).toEqual(['report', 'schedule', 'admin', 'inbox']);
    // An admin who also drives gets the board card too, ahead of the office.
    expect(ids(user('ADMIN', ['DRIVE', 'RECEIVE', 'REPORT']))).toEqual([
      'board',
      'receive-runs',
      'report',
      'schedule',
      'admin',
      'inbox',
    ]);
  });

  it('gives a non-driving coordinator no Pick up card', () => {
    // The board is not gone for them: §4 keeps it in the nav on every viewport, and
    // the bottom bar falls back to it. The CARD is duty-derived, and "Pick up food"
    // is not what a coordinator opens the board to do.
    expect(ids(coordinator)).toEqual(['schedule', 'inbox']);
  });
});

describe('the six-card cap (D31)', () => {
  // The cap is the reason D31 removed a card rather than reordering the grid: the
  // hub exists for the phone, and a seventh card is what puts the last one under
  // the fold on the surface that has no other route to it.
  const MAX_CARDS = 6;

  it('enumerates the whole tier/duty space', () => {
    expect(everyone.length).toBe(24);
  });

  it('gives the most-privileged account exactly six', () => {
    expect(ids(user('ADMIN', ['DRIVE', 'RECEIVE', 'REPORT']))).toHaveLength(MAX_CARDS);
  });

  it('never exceeds six, for any tier and duty combination', () => {
    for (const person of everyone) {
      expect(
        homeCardsFor(person).length,
        `${person.tier}/${person.duties}`,
      ).toBeLessThanOrEqual(MAX_CARDS);
    }
  });

  it('never repeats a destination on one screen', () => {
    // Two cards to one place is what D31 removed; this is what keeps it removed.
    for (const person of everyone) {
      const cards = ids(person);
      expect(new Set(cards).size, `${person.tier}/${person.duties}`).toBe(cards.length);
    }
  });
});

describe('nobody is stranded', () => {
  it('still gives a volunteer with no duties a usable screen', () => {
    // `ninatorres` exists (A112). One card, and a sentence saying who can change it.
    expect(ids(noDuties)).toEqual(['inbox']);
    expect(hasNothingAssigned(homeCardsFor(noDuties))).toBe(true);
  });

  it('says nothing of the kind to anyone who does have work', () => {
    for (const person of [driver, receiver, coordinator, reporter, admin]) {
      expect(hasNothingAssigned(homeCardsFor(person))).toBe(false);
    }
  });

  it('gives everyone the inbox — it is the source of truth for events', () => {
    for (const person of [driver, receiver, noDuties, coordinator, admin]) {
      expect(ids(person)).toContain('inbox');
    }
  });
});

describe('every card leads somewhere the viewer is allowed to be', () => {
  // A card that lands on "You don't have access to this page." is worse than an
  // absent one: the hub would be teaching a dead end.
  it('resolves, and passes the same access check the shell runs', () => {
    for (const person of [driver, receiver, bothDuties, noDuties, coordinator, reporter, admin]) {
      for (const card of homeCardsFor(person)) {
        const match = resolvePath(card.path);
        expect(match, `${card.id} for ${person.tier}/${person.duties}`).not.toBeNull();
        expect(match!.route.id).toBe(card.id);
        expect(canSee(person, match!.route.requires)).toBe(true);
      }
    }
  });
});

describe('the live-subtitle seam', () => {
  // The first version ships static subtitles on purpose: a hub that fans out five
  // requests on every sign-in is worse than one that does not. This is the shape a
  // real count slots into later, so nothing has to be restructured for it.
  it('leaves every subtitle static by default', () => {
    expect(homeCardsFor(driver)[0]?.subtitle).toBe(COPY.driveSubtitle);
  });

  it('overrides one card without touching the others', () => {
    const cards = homeCardsFor(bothDuties, { 'receive-runs': '2 trucks waiting' });
    expect(cards.find((card) => card.id === 'receive-runs')?.subtitle).toBe('2 trucks waiting');
    expect(cards.find((card) => card.id === 'board')?.subtitle).toBe(COPY.driveSubtitle);
  });
});

describe('microcopy (§7)', () => {
  /** §7's forbidden list, verbatim. */
  const FORBIDDEN = [
    'pwa',
    'push subscription',
    'session',
    'payload',
    'endpoint',
    'atomic',
    'instance',
  ];

  const sentences: string[] = [
    ...Object.values(COPY).flatMap((value) => (typeof value === 'string' ? [value] : [])),
    COPY.greeting('Luis'),
  ];

  it('uses none of the forbidden words', () => {
    for (const sentence of sentences) {
      for (const word of FORBIDDEN) {
        expect(sentence.toLowerCase()).not.toContain(word);
      }
    }
  });

  it('puts no em dash in anything this screen writes (D21)', () => {
    for (const sentence of sentences) {
      expect(sentence, sentence).not.toContain('—');
    }
  });

  it('greets by first name, and leaves no hole when there is not one', () => {
    expect(COPY.greeting('Luis')).toBe('Hi Luis');
    expect(COPY.greeting('')).toBe('Hi');
  });

  it('gives the empty state a body that says what to do next (§6)', () => {
    expect(COPY.nothingBody.length).toBeGreaterThan(0);
    expect(COPY.nothingBody).not.toBe(COPY.nothingTitle);
  });

  it('never repeats a title in its own subtitle (D21)', () => {
    for (const card of homeCardsFor(admin)) {
      expect(card.subtitle.toLowerCase()).not.toBe(card.title.toLowerCase());
      expect(card.subtitle).not.toBe('');
    }
  });
});
