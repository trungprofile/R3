// At-risk sweep — "shift still open and at-risk (1 day before start) → Coordinator +
// eligible drivers" (PRD §4 matrix, `architecture.md §4.4`).
//
// The property under test is not "it sends an alert" but **catch-up**: the pass asks
// what is due and unhandled, so running it late, twice, or after an outage produces the
// same result. That is what demotes a missed tick from a lost notification to a slightly
// late one, and it is why there is no timer anywhere in this feature.
//
// The job is driven by calling `run()` directly: `jobs/registry.ts` is the lead's seam
// this wave, so nothing here registers itself with the scheduler.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/index.js';
import { atRiskJob } from '../src/jobs/at-risk.js';
import { sweepAtRiskShifts } from '../src/services/coverage.js';
import {
  makeAvailabilityBlock,
  makeDriver,
  makeShift,
  makeUser,
  resetDatabase,
} from './fixtures.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function at(offsetMs: number): Date {
  return new Date(Date.now() + offsetMs);
}

async function notifications() {
  return db
    .selectFrom('notification')
    .select(['event', 'recipient_id', 'shift_id'])
    .orderBy('created_at')
    .execute();
}

beforeEach(resetDatabase);
afterAll(async () => {
  await db.destroy();
  await pool.end().catch(() => undefined);
});

describe('what the sweep considers due', () => {
  it('alerts on an open run starting inside a day', async () => {
    const coordinator = await makeUser({ tier: 'STAFF' });
    const driver = await makeDriver();
    const shift = await makeShift({
      createdBy: coordinator.id,
      startsAt: at(12 * HOUR),
      endsAt: at(14 * HOUR),
    });

    expect(await sweepAtRiskShifts()).toBe(1);

    const rows = await notifications();
    expect(rows.every((r) => r.event === 'SHIFT_AT_RISK' && r.shift_id === shift.id)).toBe(
      true,
    );
    expect(rows.map((r) => r.recipient_id).sort()).toEqual(
      [coordinator.id, driver.id].sort(),
    );
  });

  it('says nothing about a run further out than a day', async () => {
    const coordinator = await makeUser({ tier: 'STAFF' });
    await makeShift({ createdBy: coordinator.id, startsAt: at(2 * DAY) });

    expect(await sweepAtRiskShifts()).toBe(0);
    expect(await notifications()).toEqual([]);
  });

  it('says nothing about a run that already has a driver', async () => {
    const coordinator = await makeUser({ tier: 'STAFF' });
    const driver = await makeDriver();
    await makeShift({
      createdBy: coordinator.id,
      ownerId: driver.id,
      status: 'CLAIMED',
      startsAt: at(12 * HOUR),
    });

    expect(await sweepAtRiskShifts()).toBe(0);
  });

  it('says nothing about a run whose start has passed', async () => {
    // Open and past is derived MISSED/UNCLAIMED (`§3.1`); "still open for tomorrow"
    // would not be true of it.
    const coordinator = await makeUser({ tier: 'STAFF' });
    await makeShift({
      createdBy: coordinator.id,
      startsAt: at(-2 * HOUR),
      endsAt: at(-HOUR),
    });

    expect(await sweepAtRiskShifts()).toBe(0);
  });

  it('says nothing about a cancelled run', async () => {
    const coordinator = await makeUser({ tier: 'STAFF' });
    await makeShift({
      createdBy: coordinator.id,
      status: 'CANCELLED',
      startsAt: at(12 * HOUR),
    });

    expect(await sweepAtRiskShifts()).toBe(0);
  });
});

describe('who hears about it', () => {
  it('leaves out a driver who is away or already busy then', async () => {
    // The fan-out set is `eligible()` at send time (PRD §4), so it is the same
    // predicate the claim gate uses — one definition, five call sites.
    const coordinator = await makeUser({ tier: 'STAFF' });
    const free = await makeDriver();
    const away = await makeDriver();
    const busy = await makeDriver();
    const gone = await makeDriver({ deactivated: true });
    const receiver = await makeUser({ duties: ['RECEIVE'] });

    await makeAvailabilityBlock(away.id, at(11 * HOUR), at(13 * HOUR));
    await makeShift({
      createdBy: coordinator.id,
      ownerId: busy.id,
      status: 'CLAIMED',
      startsAt: at(12 * HOUR + 30 * 60 * 1000),
      endsAt: at(15 * HOUR),
    });
    await makeShift({
      createdBy: coordinator.id,
      startsAt: at(12 * HOUR),
      endsAt: at(14 * HOUR),
    });

    await sweepAtRiskShifts();

    const recipients = (await notifications()).map((r) => r.recipient_id).sort();
    expect(recipients).toEqual([coordinator.id, free.id].sort());
    expect(recipients).not.toContain(away.id);
    expect(recipients).not.toContain(busy.id);
    expect(recipients).not.toContain(gone.id);
    expect(recipients).not.toContain(receiver.id);
  });
});

describe('catch-up semantics (§4.4)', () => {
  it('sends once no matter how many times the sweep runs', async () => {
    const coordinator = await makeUser({ tier: 'STAFF' });
    await makeShift({
      createdBy: coordinator.id,
      startsAt: at(12 * HOUR),
      endsAt: at(14 * HOUR),
    });

    expect(await sweepAtRiskShifts()).toBe(1);
    expect(await sweepAtRiskShifts()).toBe(0);
    expect(await sweepAtRiskShifts()).toBe(0);

    expect(await notifications()).toHaveLength(1);
  });

  it('still alerts on a run whose one-day mark passed during an outage', async () => {
    // The whole point of asking "what is due and unhandled" rather than firing at a
    // moment: a process that was down at the 24-hour mark catches this on its next tick.
    const coordinator = await makeUser({ tier: 'STAFF' });
    await makeShift({
      createdBy: coordinator.id,
      startsAt: at(2 * HOUR),
      endsAt: at(4 * HOUR),
    });

    expect(await sweepAtRiskShifts()).toBe(1);
  });

  it('runs as a job, and a quiet pass writes nothing', async () => {
    const coordinator = await makeUser({ tier: 'STAFF' });
    await makeShift({
      createdBy: coordinator.id,
      startsAt: at(12 * HOUR),
      endsAt: at(14 * HOUR),
    });

    await atRiskJob.run();
    expect(await notifications()).toHaveLength(1);

    await atRiskJob.run();
    expect(await notifications()).toHaveLength(1);

    expect(atRiskJob.name).toBe('at-risk');
    expect(atRiskJob.intervalMs).toBe(60_000);
  });
});
