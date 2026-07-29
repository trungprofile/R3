// The 1-hour shift reminder — `architecture.md §4.4` and the PRD notification matrix.
//
// The job is exercised by calling `run()` directly: `jobs/registry.ts` is this wave's
// shared seam and no lane edits it (the lead registers the job at merge), and the
// scheduler engine is already tested elsewhere. What matters here is the sweep's
// query — "what is due and unhandled?" — and that running it twice sends once.
//
// Times are relative to the database clock rather than a frozen one, because the
// predicate under test is SQL (`starts_at <= now() + interval '1 hour'`) and a fake
// timer in the test process would not reach it.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/index.js';
import { shiftReminderJob } from '../src/jobs/reminder.js';
import { sendDueShiftReminders } from '../src/services/execution.js';
import {
  makeClaimedShift,
  makeDriver,
  makeRoute,
  makeShift,
  makeTruck,
  resetDatabase,
} from './fixtures.js';
import { startRun } from '../src/services/execution.js';

const MINUTES = 60_000;
const at = (minutesFromNow: number) => new Date(Date.now() + minutesFromNow * MINUTES);

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await db.destroy();
  await pool.end().catch(() => undefined);
});

describe('sendDueShiftReminders', () => {
  it('reminds the owning driver of a run starting within the hour', async () => {
    const { route } = await makeRoute(1, 'Tuesday North');
    const { shift, ownerId } = await makeClaimedShift({
      routeId: route.id,
      startsAt: at(30),
      endsAt: at(150),
    });

    expect(await sendDueShiftReminders()).toBe(1);

    const rows = await db.selectFrom('notification').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      event: 'SHIFT_REMINDER',
      recipient_id: ownerId,
      shift_id: shift.id,
    });
    // The payload is pre-formatted here because only this side holds
    // `app_config.timezone`; dispatch stays a dumb sender (A7).
    const payload = rows[0]!.payload as { route?: string; when?: string };
    expect(payload.route).toBe('Tuesday North');
    expect(payload.when).toMatch(/–/);
  });

  it('sends once, however often the sweep runs (uq_notif_shift_event, tier 1)', async () => {
    await makeClaimedShift({ startsAt: at(30), endsAt: at(150) });

    expect(await sendDueShiftReminders()).toBe(1);
    expect(await sendDueShiftReminders()).toBe(0);
    await shiftReminderJob.run();

    const rows = await db.selectFrom('notification').selectAll().execute();
    expect(rows).toHaveLength(1);
  });

  it('ignores a run more than an hour out', async () => {
    await makeClaimedShift({ startsAt: at(90), endsAt: at(210) });
    expect(await sendDueShiftReminders()).toBe(0);
  });

  it('catches up on a run inside the window after a missed tick', async () => {
    // 59 minutes out: the tick that should have fired at 60 never ran, and this one
    // still finds it. A missed tick self-heals; it is not lost to a restart.
    await makeClaimedShift({ startsAt: at(59), endsAt: at(179) });
    expect(await sendDueShiftReminders()).toBe(1);
  });

  it('does not remind about a run whose start has already passed', async () => {
    // Catch-up heals a late tick, but "your run starts in an hour" about a run that
    // began an hour ago is false. A claimed run whose window passed is the reporting
    // doc's NO_SHOW (`domain-modeling.md §3.1`), not a reminder.
    await makeClaimedShift({ startsAt: at(-30), endsAt: at(90) });
    expect(await sendDueShiftReminders()).toBe(0);
  });

  it('ignores an OPEN run — the matrix names the OWNING driver', async () => {
    await makeShift({ status: 'OPEN', startsAt: at(30), endsAt: at(150) });
    expect(await sendDueShiftReminders()).toBe(0);
  });

  it('ignores a run already in progress', async () => {
    const { route } = await makeRoute(1);
    const { shift, ownerId } = await makeClaimedShift({
      routeId: route.id,
      startsAt: at(30),
      endsAt: at(150),
    });
    const truck = await makeTruck();
    await startRun({ id: ownerId, tier: 'VOLUNTEER' }, shift.id, { truckId: truck.id });

    expect(await sendDueShiftReminders()).toBe(0);
  });

  it('skips a deactivated owner (I21 — hidden from new use)', async () => {
    const driver = await makeDriver({ deactivated: true });
    await makeClaimedShift({ ownerId: driver.id, startsAt: at(30), endsAt: at(150) });
    expect(await sendDueShiftReminders()).toBe(0);
  });

  it('reminds each owner of their own run, not everyone of everything', async () => {
    await makeClaimedShift({ startsAt: at(20), endsAt: at(140) });
    await makeClaimedShift({ startsAt: at(40), endsAt: at(160) });

    expect(await sendDueShiftReminders()).toBe(2);
    const rows = await db
      .selectFrom('notification')
      .select(['recipient_id', 'shift_id'])
      .execute();
    expect(new Set(rows.map((r) => r.recipient_id)).size).toBe(2);
    expect(new Set(rows.map((r) => r.shift_id)).size).toBe(2);
  });
});
