// Coverage failures — PRD cap 16, `ui-ux-spec.md` S3.2, `domain-modeling.md` I7/§3.1.
//
// `MISSED` is the one piece of the domain that has never been computed anywhere in
// this codebase until now: it is NOT a stored state (I7), it is
//
//     window passed ∧ status ∈ {OPEN, CLAIMED}
//
// split into UNCLAIMED (OPEN — nobody took it) and NO_SHOW (CLAIMED — someone
// committed and did not turn up).
//
// The split is the whole value. Rolled together, "eight missed runs" says nothing
// about what to do; split, it is either a scheduling problem or a conversation with a
// particular driver. So most of these tests are about the boundary between the two,
// and about the states that must NOT be counted at all.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db/index.js';
import { coverageMetrics } from '../src/services/metrics.js';
import { makeDriver, makeRoute, makeShift, resetDatabase } from './fixtures.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** A window that has definitively passed. */
function past(daysAgo: number): { startsAt: Date; endsAt: Date } {
  const startsAt = new Date(Date.now() - daysAgo * DAY);
  return { startsAt, endsAt: new Date(startsAt.getTime() + 2 * HOUR) };
}

/** A wide period so the default 28-day range never decides a test's outcome. */
const WIDE = { from: '2020-01-01', to: '2099-12-31' };

beforeEach(resetDatabase);
afterAll(async () => {
  await pool.end();
});

describe('the UNCLAIMED / NO_SHOW split', () => {
  it('calls a passed OPEN run UNCLAIMED — nobody took it', async () => {
    await makeShift({ status: 'OPEN', ...past(3) });

    const metrics = await coverageMetrics(WIDE);
    expect(metrics.unclaimedCount).toBe(1);
    expect(metrics.noShowCount).toBe(0);
    expect(metrics.runs[0]!.failure).toBe('UNCLAIMED');
    // An OPEN shift has no owner by construction (ck_shift_owner).
    expect(metrics.runs[0]!.ownerId).toBeNull();
  });

  it('calls a passed CLAIMED run NO_SHOW — someone committed and flaked', async () => {
    const driver = await makeDriver();
    await makeShift({ status: 'CLAIMED', ownerId: driver.id, ...past(3) });

    const metrics = await coverageMetrics(WIDE);
    expect(metrics.noShowCount).toBe(1);
    expect(metrics.unclaimedCount).toBe(0);
    expect(metrics.runs[0]!.failure).toBe('NO_SHOW');
    expect(metrics.runs[0]!.ownerId).toBe(driver.id);
    expect(metrics.runs[0]!.ownerName).toMatch(/\S/);
  });
});

describe('what is NOT a coverage failure', () => {
  it('ignores a run that started — IN_PROGRESS is not missed', async () => {
    const driver = await makeDriver();
    await makeShift({ status: 'IN_PROGRESS', ownerId: driver.id, ...past(3) });

    const metrics = await coverageMetrics(WIDE);
    expect(metrics.runs).toHaveLength(0);
  });

  it('ignores a completed run', async () => {
    const driver = await makeDriver();
    await makeShift({ status: 'COMPLETED', ownerId: driver.id, ...past(3) });

    expect((await coverageMetrics(WIDE)).runs).toHaveLength(0);
  });

  it('ignores a CANCELLED run — a decision, not a failure', async () => {
    // Counting it would punish staff for tidying the board, and cancelling is the
    // documented way to remove a run that should not happen (§3.1).
    await makeShift({ status: 'CANCELLED', ...past(3) });

    expect((await coverageMetrics(WIDE)).runs).toHaveLength(0);
  });

  it('ignores a future run that is still open — it has not been missed yet', async () => {
    const startsAt = new Date(Date.now() + 2 * DAY);
    await makeShift({
      status: 'OPEN',
      startsAt,
      endsAt: new Date(startsAt.getTime() + 2 * HOUR),
    });

    expect((await coverageMetrics(WIDE)).runs).toHaveLength(0);
  });

  it('does not count a run whose window has not finished yet', async () => {
    // Half-open window `[start, end)` (§5.2): a run underway is late, not missed,
    // and is still claimable.
    const startsAt = new Date(Date.now() - HOUR);
    await makeShift({
      status: 'OPEN',
      startsAt,
      endsAt: new Date(Date.now() + HOUR),
    });

    expect((await coverageMetrics(WIDE)).runs).toHaveLength(0);
  });
});

describe('the patterns S3.2 exists to surface', () => {
  it('tallies a driver three no-shows', async () => {
    const driver = await makeDriver();
    for (const days of [3, 10, 17]) {
      await makeShift({ status: 'CLAIMED', ownerId: driver.id, ...past(days) });
    }

    const metrics = await coverageMetrics(WIDE);
    expect(metrics.byDriver).toHaveLength(1);
    expect(metrics.byDriver[0]).toMatchObject({ ownerId: driver.id, noShows: 3 });
  });

  it('tallies a route that keeps going unclaimed', async () => {
    const { route } = await makeRoute(1, 'Thursday South');
    for (const days of [3, 10]) {
      await makeShift({ status: 'OPEN', routeId: route.id, ...past(days) });
    }

    const metrics = await coverageMetrics(WIDE);
    const row = metrics.byRoute.find((r) => r.routeId === route.id);
    expect(row).toMatchObject({ routeName: 'Thursday South', unclaimed: 2, noShows: 0 });
  });

  it('counts scheduled runs as the denominator, excluding cancelled ones', async () => {
    const driver = await makeDriver();
    await makeShift({ status: 'CLAIMED', ownerId: driver.id, ...past(3) });
    await makeShift({ status: 'COMPLETED', ownerId: driver.id, ...past(4) });
    await makeShift({ status: 'CANCELLED', ...past(5) });

    const metrics = await coverageMetrics(WIDE);
    // One missed out of two that were really scheduled — not out of three.
    expect(metrics.noShowCount).toBe(1);
    expect(metrics.scheduledCount).toBe(2);
  });
});

describe('filters', () => {
  it('narrows to one driver', async () => {
    const a = await makeDriver();
    const b = await makeDriver();
    await makeShift({ status: 'CLAIMED', ownerId: a.id, ...past(3) });
    await makeShift({ status: 'CLAIMED', ownerId: b.id, ...past(3) });

    const metrics = await coverageMetrics({ ...WIDE, driverId: a.id });
    expect(metrics.noShowCount).toBe(1);
    expect(metrics.runs[0]!.ownerId).toBe(a.id);
  });

  it('narrows to one route', async () => {
    const first = await makeRoute(1, 'Route A');
    const second = await makeRoute(1, 'Route B');
    await makeShift({ status: 'OPEN', routeId: first.route.id, ...past(3) });
    await makeShift({ status: 'OPEN', routeId: second.route.id, ...past(3) });

    const metrics = await coverageMetrics({ ...WIDE, routeId: first.route.id });
    expect(metrics.unclaimedCount).toBe(1);
    expect(metrics.runs[0]!.routeName).toBe('Route A');
  });

  it('narrows by period, on the occurrence date', async () => {
    await makeShift({ status: 'OPEN', ...past(3) });

    const wide = await coverageMetrics(WIDE);
    expect(wide.runs).toHaveLength(1);

    // A period that ends before the run's own day excludes it.
    const narrow = await coverageMetrics({ from: '2020-01-01', to: '2020-01-31' });
    expect(narrow.runs).toHaveLength(0);
  });
});
