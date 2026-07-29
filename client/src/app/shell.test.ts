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
import { navItemsFor } from './nav.tsx';
import { buildPath, matchPath, resolvePath, ROUTES } from './routes.ts';
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

  it('does not offer screens from a later phase', () => {
    // Admin holds the `report` duty, but Report and Metrics are Phase 3 and a
    // nav item leading nowhere is worse than an absent one.
    expect(ids(admin, 'desktop')).not.toContain('report');
    expect(ids(admin, 'desktop')).not.toContain('metrics');
  });

  it('offers the inbox to everyone — it is the source of truth for events', () => {
    for (const person of [driver, receiver, coordinator, admin]) {
      expect(ids(person, 'phone')).toContain('inbox');
      expect(ids(person, 'desktop')).toContain('inbox');
    }
  });
});
