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
import { navItemsFor } from './nav.tsx';
import { buildPath, HOME_PATH, homePathFor, matchPath, resolvePath, ROUTES } from './routes.ts';
import type { CurrentUser } from '../api/session.ts';
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

describe('navigation derived from tier and duty (UI §4)', () => {
  const ids = (u: CurrentUser, viewport: 'phone' | 'tablet' | 'desktop') =>
    navItemsFor(u, viewport).map((item) => item.id);

  it('gives the phone Board, My Shifts and Inbox for a driver', () => {
    expect(ids(driver, 'phone')).toEqual(['board', 'my-shifts', 'inbox']);
  });

  it('never exceeds the 4-item bottom nav (§3)', () => {
    for (const person of [driver, receiver, coordinator, admin]) {
      expect(ids(person, 'phone').length).toBeLessThanOrEqual(4);
    }
  });

  it('gives the tablet no nav at all (§4)', () => {
    expect(ids(receiver, 'tablet')).toEqual([]);
    expect(ids(admin, 'tablet')).toEqual([]);
  });

  it('gives Staff Schedule and Board on the desktop', () => {
    expect(ids(coordinator, 'desktop')).toContain('schedule');
    expect(ids(coordinator, 'desktop')).toContain('board');
    expect(ids(coordinator, 'desktop')).not.toContain('admin');
  });

  it('gives Admin the admin section, and Staff sections too — tier is hierarchical', () => {
    expect(ids(admin, 'desktop')).toContain('admin');
    expect(ids(admin, 'desktop')).toContain('schedule');
  });

  it('offers no My Shifts to someone who does not drive', () => {
    expect(ids(coordinator, 'desktop')).not.toContain('my-shifts');
    expect(ids(receiver, 'phone')).not.toContain('my-shifts');
  });

  it('offers Report and Metrics now that Phase 3 has shipped', () => {
    // Through Phases 1 and 2 this asserted the OPPOSITE — that both were absent,
    // because a nav item leading to the shell's placeholder is worse than no item.
    // Phase 3 registered both screens and bumped CURRENT_PHASE in the same commit,
    // which is the ordering `shipped()` exists to enforce, so the assertion flips
    // rather than being deleted.
    expect(ids(admin, 'desktop')).toContain('report');
    expect(ids(admin, 'desktop')).toContain('metrics');
  });

  it('offers the inbox to everyone — it is the source of truth for events', () => {
    for (const person of [driver, receiver, coordinator, admin]) {
      expect(ids(person, 'phone')).toContain('inbox');
      expect(ids(person, 'desktop')).toContain('inbox');
    }
  });
});

describe('the way out of a dead end (§3)', () => {
  // The shell's no-access state sends people to `homePathFor`. That escape hatch is
  // worthless if it points at another page they cannot see — they would land on the
  // same message again, and on the tablet, which has no nav at all, that is the end
  // of the road. Nothing renders here, so this covers the destination rather than
  // the button.
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

  it('sends a nav-less receiver to the one screen they can work', () => {
    // The tablet has no nav (§4), so the board would strand them.
    expect(homePathFor(receiver, 'tablet')).toBe('/receive');
    // ...but the same person at the shared desktop has a nav and wants the board.
    expect(homePathFor(receiver, 'desktop')).toBe(HOME_PATH);
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
