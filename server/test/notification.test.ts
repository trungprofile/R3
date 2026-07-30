// Wave-1 signal tests — the notification outbox and push dispatch.
//
// These run against the MIGRATED database (CLAUDE.md): `uq_notif_shift_event` and
// `ck_notif_recipient` are tier-1 constraints that exist only as real DDL, so a
// fixture schema would prove nothing about the duplicate-send guard.
//
// The only thing faked here is the WIRE. `PushTransport` stands in for the network so
// no test sends a real push or needs deploy credentials; every row these tests read
// and write is real.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { db, pool } from '../src/db/index.js';
import { writeTransaction } from '../src/db/transaction.js';
import {
  enqueueNotification,
  enqueueNotifications,
  MAX_DISPATCH_ATTEMPTS,
  pendingDispatch,
  renderPush,
  type NotificationDraft,
} from '../src/services/notification.js';
import { runPushDispatch, type PushTransport } from '../src/jobs/push-dispatch.js';
import { JOBS, startScheduler, type Job } from '../src/jobs/index.js';
import { makeDriver, makeShift, resetDatabase } from './fixtures.js';

beforeEach(resetDatabase);
afterAll(async () => {
  await db.destroy();
  await pool.end().catch(() => undefined);
});

// --- local fixtures -------------------------------------------------------
// Kept in this file rather than `fixtures.ts`: nothing else in Wave 1 needs a push
// registration, and the shared factory is a file two other lanes are editing.

let endpointSeq = 0;

async function makeSubscription(opts: {
  userId?: string;
  deviceId?: string;
  revoked?: boolean;
} = {}) {
  const n = ++endpointSeq;
  return db
    .insertInto('push_subscription')
    .values({
      user_id: opts.userId ?? null,
      device_id: opts.deviceId ?? null,
      endpoint: `https://push.example/${n}`,
      p256dh: `p256dh-${n}`,
      auth: `auth-${n}`,
      revoked_at: opts.revoked === true ? new Date() : null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

async function makeDevice(label = 'receiver tablet') {
  return db
    .insertInto('device')
    .values({ label })
    .returningAll()
    .executeTakeFirstOrThrow();
}

interface FakeTransport extends PushTransport {
  sent: { subscriptionId: string; body: string }[];
}

/** `onSend` may throw to simulate a gateway status; the default accepts everything. */
function fakeTransport(onSend?: (subscriptionId: string) => void): FakeTransport {
  const sent: { subscriptionId: string; body: string }[] = [];
  return {
    sent,
    async send(target, body) {
      onSend?.(target.subscriptionId);
      sent.push({ subscriptionId: target.subscriptionId, body });
    },
  };
}

function gatewayError(statusCode: number): Error {
  return Object.assign(new Error(`gateway ${statusCode}`), { statusCode });
}

/**
 * Arrange a row as if its last attempt were long ago, so the backoff ladder lets the
 * next sweep pick it up. Direct SQL, like the fixture factory: arranging a
 * precondition, never performing the operation under test.
 */
async function ageLastAttempt(notificationId: string): Promise<void> {
  await db
    .updateTable('notification')
    .set({ last_attempt_at: sql<Date>`now() - interval '2 hours'` })
    .where('id', '=', notificationId)
    .execute();
}

async function readNotification(id: string) {
  return db
    .selectFrom('notification')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
}

async function enqueue(draft: NotificationDraft): Promise<string | null> {
  return writeTransaction((tx) => enqueueNotification(tx, draft));
}

// --- the outbox write path ------------------------------------------------

describe('the notification row is written inside the business transaction', () => {
  it('commits with the caller and is born undelivered', async () => {
    const driver = await makeDriver();
    const shift = await makeShift({ ownerId: driver.id, status: 'CLAIMED' });

    const id = await enqueue({
      event: 'SHIFT_ASSIGNED',
      recipientId: driver.id,
      shiftId: shift.id,
      payload: { route: 'Tuesday North', when: 'Tue Aug 4, 2:00 PM' },
    });
    expect(id).not.toBeNull();

    const row = await readNotification(id as string);
    expect(row.delivered_at).toBeNull();
    expect(row.attempts).toBe(0);
    expect(row.last_attempt_at).toBeNull();
    expect(row.read_at).toBeNull();
    expect(row.payload).toEqual({ route: 'Tuesday North', when: 'Tue Aug 4, 2:00 PM' });
  });

  it('rolls back with the caller — no notification for a business write that failed', async () => {
    const driver = await makeDriver();
    const shift = await makeShift({ ownerId: driver.id, status: 'CLAIMED' });

    await expect(
      writeTransaction(async (tx) => {
        await enqueueNotification(tx, {
          event: 'SHIFT_ASSIGNED',
          recipientId: driver.id,
          shiftId: shift.id,
        });
        throw new Error('business rule rejected the write');
      }),
    ).rejects.toThrow('business rule rejected the write');

    const rows = await db.selectFrom('notification').selectAll().execute();
    expect(rows).toHaveLength(0);
  });

  it('fans out one row per recipient', async () => {
    const a = await makeDriver();
    const b = await makeDriver();
    const shift = await makeShift();

    const ids = await writeTransaction((tx) =>
      enqueueNotifications(tx, [
        { event: 'SHIFT_OPENED', recipientId: a.id, shiftId: shift.id },
        { event: 'SHIFT_OPENED', recipientId: b.id, shiftId: shift.id },
      ]),
    );

    expect(ids).toHaveLength(2);
  });
});

describe('uq_notif_shift_event makes a duplicate send impossible, not unlikely', () => {
  it('absorbs a repeated (event, shift, recipient) — the catch-up sweep guard', async () => {
    const driver = await makeDriver();
    const shift = await makeShift({ ownerId: driver.id, status: 'CLAIMED' });
    const draft: NotificationDraft = {
      event: 'SHIFT_REMINDER',
      recipientId: driver.id,
      shiftId: shift.id,
    };

    const first = await enqueue(draft);
    const second = await enqueue(draft);

    expect(first).not.toBeNull();
    expect(second).toBeNull();

    const rows = await db.selectFrom('notification').selectAll().execute();
    expect(rows).toHaveLength(1);
  });

  it('is scoped to the shift — the same event about another run still sends', async () => {
    const driver = await makeDriver();
    const one = await makeShift({ ownerId: driver.id, status: 'CLAIMED' });
    const two = await makeShift({
      ownerId: driver.id,
      status: 'CLAIMED',
      startsAt: new Date('2026-08-11T14:00:00Z'),
    });

    expect(
      await enqueue({ event: 'SHIFT_REMINDER', recipientId: driver.id, shiftId: one.id }),
    ).not.toBeNull();
    expect(
      await enqueue({ event: 'SHIFT_REMINDER', recipientId: driver.id, shiftId: two.id }),
    ).not.toBeNull();
  });

  it('leaves shiftless events alone — the index is partial for a reason', async () => {
    const staff = await makeDriver({ tier: 'STAFF' });

    // "Driver sets unavailability" has no subject shift, is event-triggered, and
    // fires once by construction — a second one is a second real event.
    expect(
      await enqueue({ event: 'UNAVAILABILITY_DECLARED', recipientId: staff.id }),
    ).not.toBeNull();
    expect(
      await enqueue({ event: 'UNAVAILABILITY_DECLARED', recipientId: staff.id }),
    ).not.toBeNull();

    const rows = await db.selectFrom('notification').selectAll().execute();
    expect(rows).toHaveLength(2);
  });
});

// --- dispatch -------------------------------------------------------------

describe('dispatch drains the outbox outside the transaction', () => {
  it('sends to the recipient’s live endpoint and marks the row delivered', async () => {
    const driver = await makeDriver();
    const subscription = await makeSubscription({ userId: driver.id });
    const shift = await makeShift({ ownerId: driver.id, status: 'CLAIMED' });
    const id = (await enqueue({
      event: 'SHIFT_ASSIGNED',
      recipientId: driver.id,
      shiftId: shift.id,
      payload: { route: 'Tuesday North', when: 'Tue Aug 4, 2:00 PM' },
    })) as string;

    const transport = fakeTransport();
    const summary = await runPushDispatch({ transport });

    expect(summary).toMatchObject({ considered: 1, delivered: 1, failed: 0 });
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]?.subscriptionId).toBe(subscription.id);

    const body = JSON.parse(transport.sent[0]?.body ?? '{}') as Record<string, string>;
    expect(body['title']).toBe("You're on a run");
    expect(body['url']).toBe(`/shifts/${shift.id}`);

    const row = await readNotification(id);
    expect(row.delivered_at).not.toBeNull();
    expect(row.attempts).toBe(1);
    expect(row.last_attempt_at).not.toBeNull();
  });

  it('does not pick a delivered row up again', async () => {
    const driver = await makeDriver();
    await makeSubscription({ userId: driver.id });
    await enqueue({ event: 'UNAVAILABILITY_DECLARED', recipientId: driver.id });

    await runPushDispatch({ transport: fakeTransport() });
    const second = fakeTransport();
    await runPushDispatch({ transport: second });

    expect(second.sent).toHaveLength(0);
  });

  it('reaches every live endpoint a person holds', async () => {
    const driver = await makeDriver();
    await makeSubscription({ userId: driver.id });
    await makeSubscription({ userId: driver.id });
    await enqueue({ event: 'UNAVAILABILITY_DECLARED', recipientId: driver.id });

    const transport = fakeTransport();
    await runPushDispatch({ transport });

    expect(transport.sent).toHaveLength(2);
  });

  it('skips revoked endpoints', async () => {
    const driver = await makeDriver();
    await makeSubscription({ userId: driver.id, revoked: true });
    const id = (await enqueue({
      event: 'UNAVAILABILITY_DECLARED',
      recipientId: driver.id,
    })) as string;

    const transport = fakeTransport();
    await runPushDispatch({ transport });

    expect(transport.sent).toHaveLength(0);
    const row = await readNotification(id);
    expect(row.delivered_at).toBeNull();
  });

  it('delivers a device-scoped row through its own registration', async () => {
    // recipient_id NULL / subscription_id set is the truck-inbound shape
    // (`ck_notif_recipient`). The event itself is Phase 2; the delivery path is not.
    const device = await makeDevice();
    const subscription = await makeSubscription({ deviceId: device.id });
    const inserted = await db
      .insertInto('notification')
      .values({ event: 'TRUCK_INBOUND', subscription_id: subscription.id })
      .returning('id')
      .executeTakeFirstOrThrow();

    const transport = fakeTransport();
    await runPushDispatch({ transport });

    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]?.subscriptionId).toBe(subscription.id);
    expect((await readNotification(inserted.id)).delivered_at).not.toBeNull();
  });

  it('leaves a row pending when the recipient has no registration at all', async () => {
    const driver = await makeDriver();
    const id = (await enqueue({
      event: 'UNAVAILABILITY_DECLARED',
      recipientId: driver.id,
    })) as string;

    await runPushDispatch({ transport: fakeTransport() });

    const row = await readNotification(id);
    expect(row.delivered_at).toBeNull();
    // The inbox still holds it — "zero missed signal for a user who never enables
    // push" (PRD channel strategy).
    expect(row.read_at).toBeNull();
  });
});

describe('410 Gone revokes the registration', () => {
  it('sets revoked_at instead of deleting, and later sweeps skip it', async () => {
    const driver = await makeDriver();
    const subscription = await makeSubscription({ userId: driver.id });
    const id = (await enqueue({
      event: 'UNAVAILABILITY_DECLARED',
      recipientId: driver.id,
    })) as string;

    const gone = fakeTransport(() => {
      throw gatewayError(410);
    });
    await runPushDispatch({ transport: gone });

    const after = await db
      .selectFrom('push_subscription')
      .selectAll()
      .where('id', '=', subscription.id)
      .executeTakeFirstOrThrow();
    expect(after.revoked_at).not.toBeNull();

    const row = await readNotification(id);
    expect(row.delivered_at).toBeNull();
    expect(row.attempts).toBe(1);

    // Next sweep: due again, but there is nothing live to send to.
    await ageLastAttempt(id);
    const second = fakeTransport();
    await runPushDispatch({ transport: second });
    expect(second.sent).toHaveLength(0);
  });
});

describe('retry with backoff, then give up', () => {
  it('holds a failed row back until its backoff has elapsed', async () => {
    const driver = await makeDriver();
    await makeSubscription({ userId: driver.id });
    const id = (await enqueue({
      event: 'UNAVAILABILITY_DECLARED',
      recipientId: driver.id,
    })) as string;

    const failing = fakeTransport(() => {
      throw gatewayError(500);
    });
    await runPushDispatch({ transport: failing });
    expect((await readNotification(id)).attempts).toBe(1);

    // Immediately again: still inside the 1-minute backoff for attempt 2.
    expect(await pendingDispatch()).toHaveLength(0);

    await ageLastAttempt(id);
    expect(await pendingDispatch()).toHaveLength(1);
  });

  it('gives up after the cap and stops selecting the row', async () => {
    const driver = await makeDriver();
    await makeSubscription({ userId: driver.id });
    const id = (await enqueue({
      event: 'UNAVAILABILITY_DECLARED',
      recipientId: driver.id,
    })) as string;

    const failing = fakeTransport(() => {
      throw gatewayError(500);
    });
    for (let i = 0; i < MAX_DISPATCH_ATTEMPTS; i++) {
      await runPushDispatch({ transport: failing });
      await ageLastAttempt(id);
    }

    const row = await readNotification(id);
    expect(row.attempts).toBe(MAX_DISPATCH_ATTEMPTS);
    expect(row.delivered_at).toBeNull();
    // Push is best-effort; the inbox is the source of truth, so giving up is the
    // documented end state and not a data-integrity problem.
    expect(await pendingDispatch()).toHaveLength(0);
  });
});

describe('delivery is at-least-once, deliberately', () => {
  it('re-sends a row whose delivered_at write was lost to a crash', async () => {
    const driver = await makeDriver();
    await makeSubscription({ userId: driver.id });
    const id = (await enqueue({
      event: 'UNAVAILABILITY_DECLARED',
      recipientId: driver.id,
    })) as string;

    await runPushDispatch({ transport: fakeTransport() });

    // The crash window: the push left the box, the mark never landed. Reproduced by
    // putting the row back into the state that crash would have left it in.
    await db
      .updateTable('notification')
      .set({ delivered_at: null })
      .where('id', '=', id)
      .execute();
    await ageLastAttempt(id);

    const second = fakeTransport();
    await runPushDispatch({ transport: second });

    expect(second.sent).toHaveLength(1);
    expect((await readNotification(id)).delivered_at).not.toBeNull();
  });
});

// --- copy -----------------------------------------------------------------

describe('banner copy obeys ui-ux-spec.md §7', () => {
  const FORBIDDEN = [
    'PWA',
    'push subscription',
    'session',
    'payload',
    'endpoint',
    'atomic',
    'instance',
  ];

  it('says something useful for every event, with and without detail', () => {
    for (const event of [
      'SHIFT_ASSIGNED',
      'SHIFT_REMINDER',
      'UNAVAILABILITY_DECLARED',
      'SHIFT_OPENED',
      'SHIFT_AT_RISK',
    ]) {
      for (const payload of [{}, { route: 'Tuesday North', when: 'Tue Aug 4, 2:00 PM' }]) {
        const message = renderPush({
          id: 'n1',
          event,
          recipientId: 'u1',
          subscriptionId: null,
          shiftId: 's1',
          payload,
          attempts: 0,
        });

        expect(message.title.length).toBeGreaterThan(0);
        expect(message.body.length).toBeGreaterThan(0);
        expect(message.url).toBe('/shifts/s1');

        const text = `${message.title} ${message.body}`.toLowerCase();
        for (const word of FORBIDDEN) {
          expect(text, `"${word}" is forbidden in UI copy`).not.toContain(
            word.toLowerCase(),
          );
        }
      }
    }
  });

  it('sends the dock to receiving, not to the driver view of the run', () => {
    // TRUCK_INBOUND is the one device-addressed event, so whoever taps it is
    // whoever is standing at the dock — `/shifts/:id` is the driver's and staff's
    // view of a run and would ask a receiver to be someone they are not (A170).
    const message = renderPush({
      id: 'n1',
      event: 'TRUCK_INBOUND',
      recipientId: null,
      subscriptionId: 'sub1',
      shiftId: 's1',
      payload: { who: 'Karen', route: 'Tuesday North' },
      attempts: 0,
    });

    expect(message.url).toBe('/receive');
    expect(message.title).toBe('Truck inbound');
    expect(message.body).toContain('Karen');
    expect(message.body).toContain('Tuesday North');
  });

  it('still says something useful when the truck alert has no run detail', () => {
    // The dock may have nobody logged in, so this copy has to stand alone.
    const message = renderPush({
      id: 'n1',
      event: 'TRUCK_INBOUND',
      recipientId: null,
      subscriptionId: 'sub1',
      shiftId: 's1',
      payload: {},
      attempts: 0,
    });

    expect(message.body.length).toBeGreaterThan(0);
    const text = `${message.title} ${message.body}`.toLowerCase();
    for (const word of FORBIDDEN) {
      expect(text, `"${word}" is forbidden in UI copy`).not.toContain(word.toLowerCase());
    }
  });

  it('falls back to the inbox when the event has no subject run', () => {
    const message = renderPush({
      id: 'n1',
      event: 'UNAVAILABILITY_DECLARED',
      recipientId: 'u1',
      subscriptionId: null,
      shiftId: null,
      payload: { who: 'Karen' },
      attempts: 0,
    });
    expect(message.url).toBe('/inbox');
    expect(message.title).toContain('Karen');
  });
});

// --- the scheduler --------------------------------------------------------

describe('the scheduler runs catch-up sweeps', () => {
  // The registry is the one list of what runs, so it is asserted exactly rather
  // than loosely: a job that appears here without a wave deciding to add it is the
  // failure this guards against. Wave 2 added session-cleanup and Wave 3 added the
  // three sweeps — each was already scheduled for its wave by registry.ts's own
  // table, so the list is being kept in step with a plan, not widened to fit
  // whatever landed. Updating this assertion is a wave-scoped fact expiring; it is
  // NOT a constraint being relaxed to make a test pass (build-plan §5.5).
  it('registers the jobs waves 1 to 3 and Phase 2 added, and no others', () => {
    expect(JOBS.map((j) => j.name)).toEqual([
      'push-dispatch',
      'session-cleanup',
      'recurrence-materialization',
      'shift-reminder',
      'at-risk',
      // Phase 2: the half of I17 receive-done cannot reach — prefills on a run
      // nobody ever received against. `registry.ts`'s own table scheduled it for
      // this phase, so the list is still being kept in step with a plan.
      'suggestion-sweep',
    ]);
    expect(JOBS.every((j) => j.intervalMs > 0)).toBe(true);
  });

  it('runs a pass at boot — the pass that heals whatever the restart missed', async () => {
    let runs = 0;
    const job: Job = {
      name: 'test-sweep',
      intervalMs: 60_000,
      run: async () => {
        runs += 1;
      },
    };

    const handle = startScheduler([job]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    handle.stop();

    expect(runs).toBe(1);
  });

  it('keeps ticking, and stops when told to', async () => {
    let runs = 0;
    const handle = startScheduler([
      {
        name: 'test-sweep',
        intervalMs: 10,
        run: async () => {
          runs += 1;
        },
      },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 60));
    handle.stop();
    const atStop = runs;
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(atStop).toBeGreaterThan(1);
    expect(runs).toBe(atStop);
  });

  it('survives a job that throws — the API shares this process', async () => {
    let runs = 0;
    const handle = startScheduler([
      {
        name: 'test-sweep',
        intervalMs: 10,
        run: async () => {
          runs += 1;
          throw new Error('sweep blew up');
        },
      },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 60));
    handle.stop();

    expect(runs).toBeGreaterThan(1);
  });

  it('never runs two copies of one job at once', async () => {
    let started = 0;
    let concurrent = 0;
    let maxConcurrent = 0;

    const handle = startScheduler([
      {
        name: 'slow-sweep',
        intervalMs: 5,
        run: async () => {
          started += 1;
          concurrent += 1;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          await new Promise((resolve) => setTimeout(resolve, 30));
          concurrent -= 1;
        },
      },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 100));
    handle.stop();

    expect(started).toBeGreaterThan(1);
    expect(maxConcurrent).toBe(1);
  });
});
