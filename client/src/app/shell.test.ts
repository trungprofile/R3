// Pure-logic tests for the two things in the shell that are rules rather than
// pixels: route matching and nav derivation.
//
// There is NO browser test harness in this wave — no jsdom, no component
// renderer, and adding one would be a dependency (build-plan §3/D5). So nothing
// here renders anything; these cover the functions a wrong answer would silently
// break, and the report says plainly what is not covered.
//
// Run: npx vitest run --root client

import { describe, expect, it } from 'vitest';
import { atLeastTier, canSee, hasAnyDuty, hasDuty, tierRank } from './access.ts';
import { idleTimerDelay } from './IdlePrompt.tsx';
import { flattenNav, navItemsFor } from './nav.tsx';
import { buildPath, HOME_PATH, homePathFor, matchPath, resolvePath, ROUTES } from './routes.ts';
import type { CurrentUser } from '../api/session.ts';
import { DUTIES, TIERS } from '../api/shared.ts';
import type { Duty, Tier } from '../api/shared.ts';

function user(tier: Tier, duties: Duty[]): CurrentUser {
  return {
    id: 'u1',
    username: 'kholt',
    firstName: 'Karen',
    lastName: 'Holt',
    tier,
    duties,
    active: true,
  };
}

const driver = user('VOLUNTEER', ['DRIVE']);
const receiver = user('VOLUNTEER', ['RECEIVE']);
const coordinator = user('STAFF', []);
const admin = user('ADMIN', ['REPORT']);

describe('route matching', () => {
  it('matches a static path', () => {
    expect(resolvePath('/board')?.route.id).toBe('board');
  });

  it('extracts params', () => {
    expect(matchPath('/shifts/:shiftId', '/shifts/42')).toEqual({ shiftId: '42' });
  });

  it('rejects a different segment count', () => {
    expect(matchPath('/shifts/:shiftId', '/shifts')).toBeNull();
    expect(matchPath('/shifts/:shiftId', '/shifts/42/extra')).toBeNull();
  });

  it('prefers a static route over a parameterised one', () => {
    // /schedule must not be swallowed by /shifts/:shiftId-shaped patterns.
    expect(resolvePath('/schedule')?.route.id).toBe('schedule');
    expect(resolvePath('/schedule/7/reschedule')?.route.id).toBe('reschedule');
  });

  it('returns null for an unknown path', () => {
    expect(resolvePath('/nowhere')).toBeNull();
  });

  it('builds a path from a screen id', () => {
    expect(buildPath('shift', { shiftId: '42' })).toBe('/shifts/42');
    expect(() => buildPath('shift')).toThrow();
  });

  it('gives every screen a distinct path', () => {
    const paths = ROUTES.map((route) => route.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe('tier and duty comparison', () => {
  it('ranks tiers hierarchically (I1)', () => {
    expect(tierRank('VOLUNTEER')).toBeLessThan(tierRank('STAFF'));
    expect(tierRank('STAFF')).toBeLessThan(tierRank('ADMIN'));
  });

  it('admits a higher tier where a lower one is required — never equality (I1)', () => {
    expect(atLeastTier(admin, 'STAFF')).toBe(true);
    expect(atLeastTier(coordinator, 'STAFF')).toBe(true);
    expect(atLeastTier(driver, 'STAFF')).toBe(false);
  });

  it('treats duties as set membership, not a hierarchy (I2)', () => {
    expect(hasDuty(driver, 'DRIVE')).toBe(true);
    expect(hasDuty(driver, 'REPORT')).toBe(false);
    expect(hasAnyDuty(admin, ['DRIVE', 'REPORT'])).toBe(true);
    expect(hasAnyDuty(coordinator, ['DRIVE', 'REPORT'])).toBe(false);
  });

  it('requires tier AND duty when a route states both', () => {
    expect(canSee(driver, undefined)).toBe(true);
    expect(canSee(driver, { tier: 'STAFF', anyDuty: ['DRIVE'] })).toBe(false);
    expect(canSee(admin, { tier: 'STAFF', anyDuty: ['REPORT'] })).toBe(true);
  });
});

describe('navigation derived from tier and duty (UI §4, D22, D30, D49, D51)', () => {
  const ids = (u: CurrentUser, viewport: 'phone' | 'tablet' | 'desktop') =>
    flattenNav(navItemsFor(u, viewport)).map((item) => item.id);
  const headings = (u: CurrentUser, viewport: 'phone' | 'tablet' | 'desktop') =>
    navItemsFor(u, viewport).map((section) => section.heading);

  /** Every tier crossed with every subset of duties. 3 x 8 = 24 people, which is
   *  the whole space, so the bottom-bar cap is proved rather than sampled. */
  const everyone: CurrentUser[] = TIERS.flatMap((tier) => {
    const subsets: Duty[][] = [[]];
    for (const duty of DUTIES) {
      for (const subset of [...subsets]) subsets.push([...subset, duty]);
    }
    return subsets.map((duties) => user(tier, duties));
  });

  it('enumerates the whole tier/duty space', () => {
    expect(everyone.length).toBe(24);
  });

  // --- the blocker (D22) -------------------------------------------------

  it('gives the tablet a nav, for everybody', () => {
    // This asserted the OPPOSITE until D22: §4 said "tablet: no nav" because it
    // assumed the tablet IS the receive station. The 768-1023px band therefore had
    // no links at all, on any device that happened to be that wide.
    for (const person of everyone) {
      expect(ids(person, 'tablet').length, `${person.tier}/${person.duties}`).toBeGreaterThan(1);
    }
  });

  it('puts Receive in the nav on every viewport for someone who receives', () => {
    // Receiving had no nav entry ANYWHERE before D22, so `/receive` was reachable
    // only by landing on it. That is why a receiver could not start weighing.
    for (const viewport of ['phone', 'tablet', 'desktop'] as const) {
      expect(ids(receiver, viewport), viewport).toContain('receive-runs');
      expect(ids(user('VOLUNTEER', ['DRIVE', 'RECEIVE']), viewport), viewport).toContain(
        'receive-runs',
      );
    }
  });

  // --- the bottom bar (§3) -----------------------------------------------

  it('never exceeds the 4-item bottom nav, for any tier and duty combination (§3)', () => {
    for (const person of everyone) {
      for (const viewport of ['phone', 'tablet'] as const) {
        const bar = ids(person, viewport);
        expect(bar.length, `${person.tier}/${person.duties} on ${viewport}`).toBeLessThanOrEqual(4);
        expect(bar.length, `${person.tier}/${person.duties} on ${viewport}`).toBeGreaterThanOrEqual(
          3,
        );
      }
    }
  });

  it('keeps the cap even where the desktop list is twice as long (D49, D51)', () => {
    // The person this is about: an Admin holding all three duties reads eight
    // entries on the desktop and must still read four in 56px. D49 added a second
    // driver entry, which is the change that could have quietly made it five.
    const everything = user('ADMIN', ['DRIVE', 'RECEIVE', 'REPORT']);
    expect(ids(everything, 'desktop').length).toBe(8);
    for (const viewport of ['phone', 'tablet'] as const) {
      expect(ids(everything, viewport).length, viewport).toBe(4);
    }
  });

  it('draws the bar without headings — there is no room for one in 56px', () => {
    for (const viewport of ['phone', 'tablet'] as const) {
      expect(headings(admin, viewport)).toEqual([null]);
    }
  });

  it('draws the sidebar without headings either, since D30', () => {
    // D22 grouped the desktop list under PICKING UP / RECEIVING / OFFICE; D30 took
    // the headings back out. One run, one entry per capability, on every viewport.
    for (const person of everyone) {
      expect(headings(person, 'desktop'), `${person.tier}/${person.duties}`).toEqual([null]);
    }
  });

  it('gives the bar Home, the duty screens and Inbox', () => {
    // A driver spends the fourth slot on their second entry (D49): their own runs,
    // then the board they claim from.
    expect(ids(driver, 'phone')).toEqual(['home', 'my-shifts', 'board', 'inbox']);
    expect(ids(receiver, 'phone')).toEqual(['home', 'receive-runs', 'inbox']);
  });

  it('spends the two middle slots on duties before second entries (D49, D51)', () => {
    // Someone holding both duties has no room for the board: two duties fill the
    // two slots, in the sidebar's descending-privilege order, and the board is
    // reached through Home. That is §3's cap doing its job, not a truncation.
    expect(ids(user('VOLUNTEER', ['DRIVE', 'RECEIVE']), 'tablet')).toEqual([
      'home',
      'receive-runs',
      'my-shifts',
      'inbox',
    ]);
  });

  it('fills the bar with the board when someone holds neither duty', () => {
    // A two-item bar in 56px reads as broken, and the board is the one screen
    // everyone can open.
    expect(ids(coordinator, 'phone')).toEqual(['home', 'board', 'inbox']);
    expect(ids(user('VOLUNTEER', []), 'phone')).toEqual(['home', 'board', 'inbox']);
  });

  it('keeps the office off the bar — it is reached through Home there (D22)', () => {
    for (const viewport of ['phone', 'tablet'] as const) {
      const bar = ids(admin, viewport);
      expect(bar).not.toContain('admin');
      expect(bar).not.toContain('schedule');
      expect(bar).not.toContain('report');
    }
  });

  // --- the desktop's flat list (D30) --------------------------------------

  it('returns exactly one run, never an empty one', () => {
    for (const person of everyone) {
      const sections = navItemsFor(person, 'desktop');
      expect(sections.length, `${person.tier}/${person.duties}`).toBe(1);
      expect(sections[0]!.items.length).toBeGreaterThan(0);
    }
  });

  it("labels the driver entries Today's pickup and Shift board, shortened in the bar", () => {
    // Two destinations since D49, and the names have to divide the job between them:
    // "Today's pickup" (D64) is the driver's own runs, led by today's; "Shift board"
    // is where new ones come from. Each has a shorter spelling for the bar — 56px with the icon above the
    // word will not take the longer one at four across (§3). The sidebar labels
    // match the Home cards, so the two surfaces teach one vocabulary (D30).
    const label = (u: CurrentUser, viewport: 'phone' | 'desktop', id: string) =>
      flattenNav(navItemsFor(u, viewport)).find((item) => item.id === id)?.label;
    expect(label(driver, 'desktop', 'my-shifts')).toBe("Today's pickup");
    expect(label(driver, 'phone', 'my-shifts')).toBe('Pickup');
    expect(label(driver, 'desktop', 'board')).toBe('Shift board');
    expect(label(driver, 'phone', 'board')).toBe('Board');
  });

  it('still calls it Shift board for a coordinator, who never picks food up', () => {
    // §4 keeps the board for the Staff tier: a coordinator watches claims land
    // there. Before D49 it was labelled for picking food up for them too, naming it
    // after a job they do not have.
    const label = flattenNav(navItemsFor(coordinator, 'desktop')).find(
      (item) => item.id === 'board',
    )?.label;
    expect(label).toBe('Shift board');
  });

  it('gives Staff Schedule and the Board on the desktop', () => {
    // §4: "Staff tier → Schedule …, Board". D22 moved the board under a heading; it
    // did not take it away from a coordinator watching claims land.
    expect(ids(coordinator, 'desktop')).toContain('schedule');
    expect(ids(coordinator, 'desktop')).toContain('board');
    expect(ids(coordinator, 'desktop')).not.toContain('admin');
  });

  it('gives Admin the admin entry, and the Staff ones too — tier is hierarchical', () => {
    expect(ids(admin, 'desktop')).toContain('admin');
    expect(ids(admin, 'desktop')).toContain('schedule');
  });

  it('offers My shifts to drivers again, and to nobody else (D49)', () => {
    // D30 folded it into the Board as `?tab=mine`, which then grew a second tab row
    // inside itself — two levels of tabs for a driver looking for their own morning.
    // D49 makes it a sibling page. It is gated on the DUTY, matching `routes.ts`: a
    // coordinator has no runs of their own, so the page would be empty for them.
    for (const person of everyone) {
      for (const viewport of ['phone', 'tablet', 'desktop'] as const) {
        const expected = person.duties.includes('DRIVE');
        expect(
          ids(person, viewport).includes('my-shifts'),
          `${person.tier}/${person.duties} on ${viewport}`,
        ).toBe(expected);
      }
    }
  });

  it('gives a driver both entries on the desktop, never one standing for both', () => {
    expect(ids(driver, 'desktop')).toEqual(['home', 'my-shifts', 'board', 'inbox']);
  });

  it('offers Log a donation to nobody — it hangs off the receive run picker (D30)', () => {
    // Same reason. A receiver reaches it from the screen they are already on, which
    // is where the decision to log one gets made.
    for (const person of everyone) {
      for (const viewport of ['phone', 'tablet', 'desktop'] as const) {
        expect(ids(person, viewport), `${person.tier} on ${viewport}`).not.toContain('donation');
      }
    }
  });

  it('keeps one entry per capability, so no destination is listed twice', () => {
    for (const person of everyone) {
      for (const viewport of ['phone', 'tablet', 'desktop'] as const) {
        const list = ids(person, viewport);
        expect(new Set(list).size, `${person.tier} on ${viewport}`).toBe(list.length);
      }
    }
  });

  it('never lists more than eight, which is what one entry each comes to', () => {
    // Home, Admin, Schedule, Report, Receive a load, Today's pickup, Shift board,
    // Inbox. Seven until D49 gave DRIVE its second entry.
    for (const person of everyone) {
      expect(ids(person, 'desktop').length, `${person.tier}/${person.duties}`).toBeLessThanOrEqual(
        8,
      );
    }
  });

  it('offers Report now that Phase 3 has shipped', () => {
    // Through Phases 1 and 2 this asserted the OPPOSITE — that it was absent,
    // because a nav item leading to the shell's placeholder is worse than no item.
    // Phase 3 registered the screen and bumped CURRENT_PHASE in the same commit,
    // which is the ordering `shipped()` exists to enforce, so the assertion flips
    // rather than being deleted.
    expect(ids(admin, 'desktop')).toContain('report');
  });

  it('does not offer Metrics as its own entry — D18 made it a tab of Admin', () => {
    // Two links to one screen is a worse map than one. The Admin entry leads there.
    expect(ids(admin, 'desktop')).not.toContain('metrics');
  });

  it('reads Home, then descending privilege, then Inbox (D51)', () => {
    // D30 ordered these "in the order a week runs"; D51 supersedes that. Descending
    // privilege puts the narrowest capability nearest the top, so the person with
    // the most entries does not scroll furthest for the one only they can reach —
    // and every shorter list is the same list with rows removed, never reshuffled.
    expect(ids(admin, 'desktop')).toEqual([
      'home',
      'admin',
      'schedule',
      'report',
      'board',
      'inbox',
    ]);
    expect(ids(coordinator, 'desktop')).toEqual(['home', 'schedule', 'board', 'inbox']);
    expect(ids(receiver, 'desktop')).toEqual(['home', 'receive-runs', 'inbox']);
    expect(ids(user('ADMIN', ['DRIVE', 'RECEIVE', 'REPORT']), 'desktop')).toEqual([
      'home',
      'admin',
      'schedule',
      'report',
      'receive-runs',
      'my-shifts',
      'board',
      'inbox',
    ]);
  });

  it('keeps every shorter list in the same relative order as the longest (D51)', () => {
    // The property the order is FOR: someone who gains a duty finds their existing
    // entries where they left them, with a new one inserted, rather than a list they
    // have to re-read.
    const canonical = ids(user('ADMIN', ['DRIVE', 'RECEIVE', 'REPORT']), 'desktop');
    for (const person of everyone) {
      const list = ids(person, 'desktop');
      const positions = list.map((id) => canonical.indexOf(id));
      expect(positions, `${person.tier}/${person.duties}`).not.toContain(-1);
      const ascending = [...positions].sort((a, b) => a - b);
      expect(positions, `${person.tier}/${person.duties}`).toEqual(ascending);
    }
  });

  it('lands everyone on the hub after sign-in, on every viewport', () => {
    // The front door is no longer the board: it is the one screen that adapts to
    // the viewer, which is what lets the office reach a phone at all.
    expect(HOME_PATH).toBe('/');
    for (const person of everyone) {
      for (const viewport of ['phone', 'tablet', 'desktop'] as const) {
        expect(homePathFor(person, viewport)).toBe('/');
      }
    }
  });

  it('offers Home and the inbox to everyone, on every viewport', () => {
    for (const person of everyone) {
      for (const viewport of ['phone', 'tablet', 'desktop'] as const) {
        expect(ids(person, viewport)).toContain('home');
        expect(ids(person, viewport)).toContain('inbox');
      }
    }
  });

  it('never offers a nav entry the viewer would be refused', () => {
    for (const person of everyone) {
      for (const viewport of ['phone', 'tablet', 'desktop'] as const) {
        for (const item of flattenNav(navItemsFor(person, viewport))) {
          const match = resolvePath(item.path);
          expect(match, item.path).not.toBeNull();
          expect(canSee(person, match!.route.requires), `${item.id} for ${person.tier}`).toBe(true);
        }
      }
    }
  });
});

describe('the way out of a dead end (§3)', () => {
  // The shell's no-access state sends people to `homePathFor`. That escape hatch is
  // worthless if it points at another page they cannot see — they would land on the
  // same message again. Nothing renders here, so this covers the destination rather
  // than the button.
  const viewports = ['phone', 'tablet', 'desktop'] as const;

  it('always lands somewhere the viewer is allowed to be', () => {
    for (const person of [driver, receiver, coordinator, admin]) {
      for (const viewport of viewports) {
        const match = resolvePath(homePathFor(person, viewport));
        expect(match, `${person.tier}/${person.duties} on ${viewport}`).not.toBeNull();
        expect(canSee(person, match!.route.requires)).toBe(true);
      }
    }
  });

  it('sends a receiver to the hub, which carries their work as a card (D22)', () => {
    // This used to send them to `/receive` on a tablet, because that surface had no
    // nav and the run picker was the only screen they could reach from it. The hub
    // reaches everything, so one destination now serves everybody.
    for (const viewport of viewports) {
      expect(homePathFor(receiver, viewport)).toBe(HOME_PATH);
    }
  });

  it('resolves the hub itself, with no tier or duty to hold anyone out', () => {
    const match = resolvePath(HOME_PATH);
    expect(match?.route.id).toBe('home');
    expect(match?.route.requires).toBeUndefined();
  });
});

describe('idle-prompt timer', () => {
  // Regression: the un-clamped version passed `expiresAt - now - 30s` straight to
  // setTimeout. For a Volunteer on a personal phone that is ~30 days, which
  // overflows setTimeout's 32-bit delay and fires IMMEDIATELY rather than throwing
  // — so "Still here?" appeared seconds after every sign-in.
  const MAX = 2_147_483_647;

  it('caps a delay that would overflow setTimeout', () => {
    const thirtyDays = 30 * 24 * 60 * 60 * 1000 - 30_000;
    expect(thirtyDays).toBeGreaterThan(MAX);
    expect(idleTimerDelay(thirtyDays)).toBe(MAX);
  });

  it('leaves a delay that fits alone, so short windows still warn on time', () => {
    // A shared device idles out in 30 minutes; the warning must land at 29:30, not
    // be rounded to anything.
    const thirtyMinutes = 30 * 60 * 1000 - 30_000;
    expect(idleTimerDelay(thirtyMinutes)).toBe(thirtyMinutes);
  });
});
