// The in-app inbox — reading what the outbox wrote (S1.9, PRD channel strategy).
//
// `services/notification.ts` owns the WRITE half: rows are enqueued inside the
// business transaction and a sweep pushes them out. This file is the READ half, and
// it is the one that matters most: "in-app flags are the source of truth. Every
// notification lands in the in-app inbox with read/unread state, regardless of push"
// (`product-requirement.md`, channel strategy). A push that never arrives costs
// nothing as long as this query is correct.
//
// Three rules this file exists to hold:
//
//   1. A USER READS THEIR OWN INBOX AND NOBODY ELSE'S. Every query below filters on
//      `recipient_id = actor.id`, including the two writes — the ownership predicate
//      is part of the UPDATE, not a check taken beforehand, so there is no window in
//      which it is true when read and false when written. The route layer declares a
//      tier; it cannot express "yours", so that rule is here (`architecture.md §4.3`:
//      a rule that needs the row lives in the service).
//
//   2. DEVICE-SCOPED ROWS ARE NOT INBOX ROWS. `recipient_id IS NULL` with
//      `subscription_id` set is the truck-inbound carve-out (`data-model.md §11`),
//      and the column comment is explicit: those rows "have no inbox reader and are
//      never marked read". Filtering on a concrete `recipient_id` excludes them by
//      construction rather than by a rule someone has to remember.
//
//   3. MARKING READ IS A WRITE, so it goes through `writeTransaction` like every
//      other write in the application (`architecture.md §4.1`), and nothing outside
//      `services/` opens one.
//
// No `app_user` row is read here, so `pii.ts` has no part to play: a notification
// carries a rendered name at most (`payload.who`), and names are never gated —
// public-within-org by design (`pii.ts`, `product-requirement.md §2`).

import { sql } from 'kysely';
import { db } from '../db/index.js';
import { writeTransaction } from '../db/transaction.js';
import { notFound } from '../middleware/error.js';
import { renderPush, type NotificationPayload } from './notification.js';
import { isUuid, readConfig, type Reader } from './schedule.js';

/** Provenance is not a concern here; the inbox only ever needs whose it is. */
export interface InboxActor {
  id: string;
}

/** One row of S1.9's list: "event text, time, tap to act" (`ui-ux-spec.md §3`). */
export interface InboxItem {
  id: string;
  /** The taxonomy string from `services/notification.ts`. Never rendered raw. */
  event: string;
  /** The one-line sentence. Same words the banner used — see `describe()`. */
  title: string;
  /** Which run it was about, pre-formatted, or null when the event has no window. */
  detail: string | null;
  /** Where "tap to act" lands. Identical to the push banner's deep link. */
  url: string;
  shiftId: string | null;
  /** `read_at IS NULL` is unread (`data-model.md §11`). */
  read: boolean;
  createdAt: string;
  /** Pantry-local, already formatted for reading: "Tue 9:00 AM". */
  when: string;
}

export interface InboxPage {
  items: InboxItem[];
  /** The top bar's bell (S1.9). Returned with the list so the two never disagree. */
  unreadCount: number;
}

export interface ListInboxOptions {
  limit?: number;
  unreadOnly?: boolean;
}

export interface MarkReadResult {
  id: string;
  readAt: string;
  unreadCount: number;
}

export interface MarkAllReadResult {
  marked: number;
  unreadCount: number;
}

/** ~15 pickups a week across fewer than ten users: the whole inbox is small, and a
 *  page this size is a bound rather than a paging scheme. */
export const INBOX_PAGE_DEFAULT = 50;
export const INBOX_PAGE_MAX = 200;

const GONE = 'That alert is no longer in your inbox.';

function pageSize(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) return INBOX_PAGE_DEFAULT;
  const whole = Math.floor(requested);
  if (whole < 1) return 1;
  return Math.min(whole, INBOX_PAGE_MAX);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * When it arrived, in the pantry's zone.
 *
 * Formatted on the server for the same reason `payload.when` is (`time.ts`, wave-2
 * assumption A7): the zone is `app_config.timezone`, which the server has and the
 * browser does not — a driver whose phone is in another zone must still read the
 * pantry's clock.
 *
 * Recent rows say which day and what time, older ones only the date: a weekday name
 * two weeks out identifies nothing.
 */
function formatArrival(createdAt: Date, timeZone: string, now: Date): string {
  const recent = now.getTime() - createdAt.getTime() < WEEK_MS;
  return new Intl.DateTimeFormat(
    'en-US',
    recent
      ? { timeZone, weekday: 'short', hour: 'numeric', minute: '2-digit' }
      : { timeZone, month: 'short', day: 'numeric' },
  ).format(createdAt);
}

interface NotificationRow {
  id: string;
  event: string;
  shift_id: string | null;
  payload: unknown;
  read_at: Date | null;
  created_at: Date;
}

/**
 * The sentence and the deep link, both taken from `renderPush`.
 *
 * ONE COPY SOURCE ON PURPOSE. The banner and the inbox row are the same event said
 * to the same person, and the inbox is the fallback for a banner that never arrived
 * — two independently written strings would drift into two accounts of one event.
 * More sharply, `renderPush` already computes the destination (`/shifts/:id` when
 * there is a subject shift, else `/inbox`) and `sw.ts` hands that URL to the running
 * app, so deriving a second one here would be a second URL scheme for one tap.
 *
 * Only the fallback body is dropped: "Open R3 to see the details" is banner copy,
 * and the reader of this row is already in R3.
 */
function describe(row: NotificationRow): { title: string; detail: string | null; url: string } {
  const payload = (row.payload ?? {}) as NotificationPayload;
  const rendered = renderPush({
    id: row.id,
    event: row.event,
    recipientId: null,
    subscriptionId: null,
    shiftId: row.shift_id,
    payload,
    attempts: 0,
  });
  const detail = [payload.when, payload.route].filter(Boolean).join(', ');
  return { title: rendered.title, detail: detail === '' ? null : detail, url: rendered.url };
}

function toItem(row: NotificationRow, timeZone: string, now: Date): InboxItem {
  const { title, detail, url } = describe(row);
  return {
    id: row.id,
    event: row.event,
    title,
    detail,
    url,
    shiftId: row.shift_id,
    read: row.read_at !== null,
    createdAt: row.created_at.toISOString(),
    when: formatArrival(row.created_at, timeZone, now),
  };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * `count(*)::int` rather than Kysely's count helper: `count(*)` is a bigint, which
 * `pg` hands back as a string, and a bell reading "12" as `"12"` is a bug that
 * typechecks. The cast happens in Postgres, where the value cannot be that large.
 *
 * Served by `ix_notif_unread (recipient_id, created_at) WHERE read_at IS NULL AND
 * recipient_id IS NOT NULL` (`data-model.md §12`), which was built for this query.
 */
async function countUnreadIn(exec: Reader, userId: string): Promise<number> {
  const row = await exec
    .selectFrom('notification')
    .select(sql<number>`count(*)::int`.as('count'))
    .where('recipient_id', '=', userId)
    .where('read_at', 'is', null)
    .executeTakeFirstOrThrow();
  return row.count;
}

/** The bell's number on its own, for a caller that does not want the list. */
export async function unreadCount(actor: InboxActor): Promise<number> {
  return countUnreadIn(db, actor.id);
}

/**
 * The caller's own inbox, newest first (S1.9).
 *
 * Read-only, so the default isolation level is correct (`architecture.md §4.1`).
 * `id` breaks the tie on `created_at`, which two rows of one fan-out share to the
 * microsecond often enough to make an unordered list visibly reshuffle between
 * refreshes.
 */
export async function listInbox(
  actor: InboxActor,
  options: ListInboxOptions = {},
): Promise<InboxPage> {
  const { timezone } = await readConfig(db);

  let query = db
    .selectFrom('notification')
    .select(['id', 'event', 'shift_id', 'payload', 'read_at', 'created_at'])
    // Ownership, and the device-scoped exclusion, in one predicate: a row with a
    // NULL `recipient_id` is the truck-inbound carve-out and has no inbox reader
    // (`data-model.md §11`).
    .where('recipient_id', '=', actor.id)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(pageSize(options.limit));

  if (options.unreadOnly === true) query = query.where('read_at', 'is', null);

  const rows = await query.execute();
  const now = new Date();

  return {
    items: rows.map((row) => toItem(row as NotificationRow, timezone, now)),
    unreadCount: await countUnreadIn(db, actor.id),
  };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Mark one alert read.
 *
 * Idempotent: a row that is already read keeps its first `read_at`, because that
 * timestamp records when the user actually saw it and a second tap is not a second
 * reading. The `read_at IS NULL` predicate is what makes that true under concurrency
 * rather than under discipline.
 *
 * Another user's row and a row that does not exist answer the same way — 404 — so
 * the inbox cannot be probed for whether an id belongs to someone else.
 */
export async function markRead(
  actor: InboxActor,
  notificationId: string,
): Promise<MarkReadResult> {
  if (!isUuid(notificationId)) throw notFound(GONE);

  const result = await writeTransaction(async (tx) => {
    const updated = await tx
      .updateTable('notification')
      .set({ read_at: sql<Date>`now()` })
      .where('id', '=', notificationId)
      // Ownership is IN the write predicate, not checked ahead of it.
      .where('recipient_id', '=', actor.id)
      .where('read_at', 'is', null)
      .returning('read_at')
      .executeTakeFirst();

    // Nothing updated: either it was already read, or it is not this user's row.
    // Re-read under the same predicate to tell those apart.
    const readAt =
      updated?.read_at ??
      (
        await tx
          .selectFrom('notification')
          .select('read_at')
          .where('id', '=', notificationId)
          .where('recipient_id', '=', actor.id)
          .executeTakeFirst()
      )?.read_at ??
      null;

    if (readAt === null) return null;
    return { readAt, unreadCount: await countUnreadIn(tx, actor.id) };
  });

  if (result === null) throw notFound(GONE);

  return {
    id: notificationId,
    readAt: result.readAt.toISOString(),
    unreadCount: result.unreadCount,
  };
}

/**
 * Mark everything unread as read.
 *
 * One statement, so a coordinator who was fanned out to about a dozen open runs does
 * not clear the bell one deep-link at a time — tapping a row navigates away from the
 * inbox, which makes "tap each one" a dozen round trips rather than a dozen taps.
 * The affordance is not in the UI spec; the report records that.
 */
export async function markAllRead(actor: InboxActor): Promise<MarkAllReadResult> {
  return writeTransaction(async (tx) => {
    const marked = await tx
      .updateTable('notification')
      .set({ read_at: sql<Date>`now()` })
      .where('recipient_id', '=', actor.id)
      .where('read_at', 'is', null)
      .returning('id')
      .execute();

    return { marked: marked.length, unreadCount: await countUnreadIn(tx, actor.id) };
  });
}
