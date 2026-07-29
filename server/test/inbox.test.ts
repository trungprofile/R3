// The inbox service — the read half of the outbox (S1.9, PRD channel strategy).
//
// Against the MIGRATED database, never a fixture schema (CLAUDE.md): `ck_notif_recipient`
// is the constraint that makes "device-scoped rows have exactly one of recipient and
// subscription" true, and a mock would happily let this suite invent a row the schema
// forbids — which is the only way the device-scoped exclusion below could pass while
// being wrong.
//
// Rows are arranged through `enqueueNotification`, the real write path, because it is
// not what is under test here: reading is.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/index.js';
import { writeTransaction } from '../src/db/transaction.js';
import {
  listInbox,
  markAllRead,
  markRead,
  unreadCount,
  INBOX_PAGE_MAX,
} from '../src/services/inbox.js';
import {
  enqueueNotification,
  type NotificationDraft,
} from '../src/services/notification.js';
import { makeDriver, makeShift, makeUser, resetDatabase } from './fixtures.js';

afterAll(async () => {
  await db.destroy();
  await pool.end().catch(() => undefined);
});

beforeEach(async () => {
  await resetDatabase();
});

/** One outbox row, through the path production uses. Each in its own transaction so
 *  `now()` differs between them — `created_at` is the sort key under test. */
async function enqueue(draft: NotificationDraft): Promise<string> {
  const id = await writeTransaction((tx) => enqueueNotification(tx, draft));
  if (id === null) throw new Error('the dedupe index absorbed a fixture row');
  return id;
}

/** A device-scoped row: `recipient_id IS NULL`, `subscription_id` set. Truck-inbound
 *  is Phase 2, but the schema already permits the shape and this suite asserts it
 *  never reaches an inbox. */
async function enqueueDeviceScoped(): Promise<string> {
  const device = await db
    .insertInto('device')
    .values({ label: 'receiver tablet' })
    .returning('id')
    .executeTakeFirstOrThrow();

  const subscription = await db
    .insertInto('push_subscription')
    .values({
      device_id: device.id,
      endpoint: `https://push.example/${device.id}`,
      p256dh: 'key',
      auth: 'auth',
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  return enqueue({ event: 'SHIFT_OPENED', subscriptionId: subscription.id });
}

describe('listInbox', () => {
  it('returns the caller’s own rows, newest first', async () => {
    const driver = await makeDriver();
    const first = await enqueue({ event: 'SHIFT_ASSIGNED', recipientId: driver.id });
    const second = await enqueue({ event: 'SHIFT_OPENED', recipientId: driver.id });

    const page = await listInbox({ id: driver.id });
    expect(page.items.map((item) => item.id)).toEqual([second, first]);
    expect(page.unreadCount).toBe(2);
  });

  it('never returns another user’s rows', async () => {
    const mine = await makeDriver();
    const theirs = await makeDriver();
    await enqueue({ event: 'SHIFT_ASSIGNED', recipientId: theirs.id });

    const page = await listInbox({ id: mine.id });
    expect(page.items).toEqual([]);
    expect(page.unreadCount).toBe(0);
    // The row exists — it is simply not this user's.
    expect(await db.selectFrom('notification').selectAll().execute()).toHaveLength(1);
  });

  it('excludes device-scoped rows from every inbox and from the count', async () => {
    // `data-model.md §11`: a row with a NULL recipient "has no inbox reader and is
    // never marked read". Truck-inbound is the only such event, and it is Phase 2.
    const driver = await makeDriver();
    await enqueueDeviceScoped();

    expect((await listInbox({ id: driver.id })).items).toEqual([]);
    expect(await unreadCount({ id: driver.id })).toBe(0);
  });

  it('reports read state per row and counts only the unread', async () => {
    const driver = await makeDriver();
    const read = await enqueue({ event: 'SHIFT_ASSIGNED', recipientId: driver.id });
    await enqueue({ event: 'SHIFT_OPENED', recipientId: driver.id });
    await markRead({ id: driver.id }, read);

    const page = await listInbox({ id: driver.id });
    expect(page.unreadCount).toBe(1);
    expect(page.items.find((item) => item.id === read)?.read).toBe(true);
  });

  it('narrows to unread on request without changing the count', async () => {
    const driver = await makeDriver();
    const read = await enqueue({ event: 'SHIFT_ASSIGNED', recipientId: driver.id });
    const unread = await enqueue({ event: 'SHIFT_OPENED', recipientId: driver.id });
    await markRead({ id: driver.id }, read);

    const page = await listInbox({ id: driver.id }, { unreadOnly: true });
    expect(page.items.map((item) => item.id)).toEqual([unread]);
    expect(page.unreadCount).toBe(1);
  });

  it('bounds the page', async () => {
    const driver = await makeDriver();
    await enqueue({ event: 'SHIFT_ASSIGNED', recipientId: driver.id });
    await enqueue({ event: 'SHIFT_OPENED', recipientId: driver.id });

    expect((await listInbox({ id: driver.id }, { limit: 1 })).items).toHaveLength(1);
    // Still the true total: the bell counts what is unread, not what fits on a page.
    expect((await listInbox({ id: driver.id }, { limit: 1 })).unreadCount).toBe(2);
    expect((await listInbox({ id: driver.id }, { limit: INBOX_PAGE_MAX + 500 })).items)
      .toHaveLength(2);
  });
});

describe('row rendering', () => {
  it('deep-links to the subject shift, and to the inbox when there is none', async () => {
    // The same destination `renderPush` gives the banner and `sw.ts` hands the running
    // app. One URL scheme for one tap.
    const driver = await makeDriver();
    const shift = await makeShift({ ownerId: driver.id, status: 'CLAIMED' });
    await enqueue({
      event: 'SHIFT_ASSIGNED',
      recipientId: driver.id,
      shiftId: shift.id,
      payload: { route: 'Tuesday North', when: 'Tue Aug 4, 2:00 PM' },
    });
    await enqueue({
      event: 'UNAVAILABILITY_DECLARED',
      recipientId: driver.id,
      payload: { who: 'Karen' },
    });

    const [withoutShift, withShift] = (await listInbox({ id: driver.id })).items;
    expect(withShift?.url).toBe(`/shifts/${shift.id}`);
    expect(withoutShift?.url).toBe('/inbox');
  });

  it('says what happened without the banner that may never have arrived', async () => {
    const driver = await makeDriver();
    await enqueue({
      event: 'SHIFT_ASSIGNED',
      recipientId: driver.id,
      payload: { route: 'Tuesday North', when: 'Tue Aug 4, 2:00 PM' },
    });

    const [item] = (await listInbox({ id: driver.id })).items;
    expect(item?.title).toBe("You're on a run");
    expect(item?.detail).toBe('Tue Aug 4, 2:00 PM — Tuesday North');
    // A time to read, formatted in the pantry's zone by the server.
    expect(item?.when).toMatch(/\d/);
    expect(item?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('carries no detail rather than banner filler when the payload is bare', async () => {
    const driver = await makeDriver();
    await enqueue({ event: 'SHIFT_REMINDER', recipientId: driver.id });

    const [item] = (await listInbox({ id: driver.id })).items;
    expect(item?.detail).toBeNull();
  });
});

describe('markRead', () => {
  it('marks the caller’s own row and returns the new count', async () => {
    const driver = await makeDriver();
    const id = await enqueue({ event: 'SHIFT_ASSIGNED', recipientId: driver.id });
    await enqueue({ event: 'SHIFT_OPENED', recipientId: driver.id });

    const result = await markRead({ id: driver.id }, id);
    expect(result.unreadCount).toBe(1);
    expect(result.readAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('is idempotent — a second tap keeps the first timestamp', async () => {
    const driver = await makeDriver();
    const id = await enqueue({ event: 'SHIFT_ASSIGNED', recipientId: driver.id });

    const first = await markRead({ id: driver.id }, id);
    const second = await markRead({ id: driver.id }, id);
    expect(second.readAt).toBe(first.readAt);
    expect(second.unreadCount).toBe(0);
  });

  it('refuses another user’s row, and leaves it unread', async () => {
    const mine = await makeDriver();
    const theirs = await makeDriver();
    const id = await enqueue({ event: 'SHIFT_ASSIGNED', recipientId: theirs.id });

    // 404, not 403: "not yours" and "not there" must be indistinguishable, or the
    // inbox becomes a probe for other people's ids.
    await expect(markRead({ id: mine.id }, id)).rejects.toMatchObject({ status: 404 });
    expect(await unreadCount({ id: theirs.id })).toBe(1);
  });

  it('answers an unknown or malformed id the same way', async () => {
    const driver = await makeDriver();
    await expect(
      markRead({ id: driver.id }, '00000000-0000-4000-8000-000000000000'),
    ).rejects.toMatchObject({ status: 404 });
    // A malformed uuid is a thing that does not exist, not a 500 from 22P02.
    await expect(markRead({ id: driver.id }, 'not-a-uuid')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('never marks a device-scoped row read', async () => {
    const driver = await makeDriver();
    const id = await enqueueDeviceScoped();

    await expect(markRead({ id: driver.id }, id)).rejects.toMatchObject({ status: 404 });
    const row = await db
      .selectFrom('notification')
      .select('read_at')
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(row.read_at).toBeNull();
  });
});

describe('markAllRead', () => {
  it('clears the caller’s unread and nobody else’s', async () => {
    const mine = await makeDriver();
    const theirs = await makeDriver();
    await enqueue({ event: 'SHIFT_ASSIGNED', recipientId: mine.id });
    await enqueue({ event: 'SHIFT_OPENED', recipientId: mine.id });
    await enqueue({ event: 'SHIFT_ASSIGNED', recipientId: theirs.id });
    await enqueueDeviceScoped();

    const result = await markAllRead({ id: mine.id });
    expect(result).toEqual({ marked: 2, unreadCount: 0 });
    expect(await unreadCount({ id: theirs.id })).toBe(1);

    const device = await db
      .selectFrom('notification')
      .select('read_at')
      .where('recipient_id', 'is', null)
      .executeTakeFirstOrThrow();
    expect(device.read_at).toBeNull();
  });

  it('is a no-op on an empty inbox', async () => {
    const staff = await makeUser({ tier: 'STAFF' });
    expect(await markAllRead({ id: staff.id })).toEqual({ marked: 0, unreadCount: 0 });
  });
});
