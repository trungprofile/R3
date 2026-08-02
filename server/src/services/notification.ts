// The notification outbox (`architecture.md §4.4`).
//
// The `notification` row IS the outbox: it is written INSIDE the business
// transaction, and the push is dispatched OUTSIDE it, because write transactions
// run SERIALIZABLE with retry (§4.1) and a retried transaction would re-send.
// `enqueueNotification` therefore takes an existing transaction handle rather than
// opening one — the caller's business write and the notification row commit or roll
// back together, or the guarantee is nothing.
//
// Everything here that WRITES goes through `writeTransaction`, including the paths
// the dispatch job calls: nothing outside `services/` opens a write transaction, and
// a job is outside `services/` (§4.1).
//
// Push is best-effort. The in-app inbox is the source of truth (PRD channel
// strategy), so a permanently failed push is not a data-integrity problem: retry
// with backoff, give up after a cap, log. No dead-letter queue, no alerting.

import { sql } from 'kysely';
import { db } from '../db/index.js';
import { writeTransaction, type Tx } from '../db/transaction.js';

// ---------------------------------------------------------------------------
// Event taxonomy
// ---------------------------------------------------------------------------

/**
 * The events of `product-requirement.md §4`'s notification matrix. The matrix owns
 * the recipients and the trigger; the identifier strings are this module's.
 *
 * Complete as of Phase 2: `TRUCK_INBOUND` was the one row the PRD held back ("caps
 * 1–11, 13 minus truck-inbound") and Phase 2 adds it. It is also the only
 * device-scoped event in the matrix — every other row goes to a person.
 */
export const NOTIFICATION_EVENTS = [
  /** Shift assigned / defaulted to you → the owning driver, event-triggered. */
  'SHIFT_ASSIGNED',
  /** Shift reminder, hard-coded 1 h before start → the owning driver, time-triggered. */
  'SHIFT_REMINDER',
  /** Driver sets unavailability → Coordinator (Staff tier and above), event-triggered. */
  'UNAVAILABILITY_DECLARED',
  /** Shift returns to the board as open → Coordinator + eligible drivers, event-triggered. */
  'SHIFT_OPENED',
  /** Shift still open 1 day before start → Coordinator + eligible drivers, time-triggered. */
  'SHIFT_AT_RISK',
  /**
   * Driver tapped "heading back" (I27) → the receiver tablet, event-triggered.
   *
   * The only event addressed to a DEVICE rather than a person: it fires regardless of
   * who, if anyone, is logged in (PRD §2, S2.4), because the point is to reach a dock
   * that may be empty. That makes it the only event `uq_notif_shift_event` does not
   * cover — the index is partial on `recipient_id IS NOT NULL` — so its
   * fire-once-ness comes from the `pickup_completed_at IS NULL` predicate on the
   * milestone that triggers it, not from the dedupe index.
   */
  'TRUCK_INBOUND',
] as const;

export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

/**
 * The time-triggered subset. These are the events a catch-up sweep re-evaluates, so
 * they are the ones the tier-1 partial unique index `uq_notif_shift_event`
 * (`event, shift_id, recipient_id`) protects — a delayed or repeated sweep cannot
 * re-send. Event-triggered notifications fire once by construction (§4.4).
 *
 * KEEP THIS LIST AND MIGRATION 0009 IN LOCKSTEP. The index's `event IN (…)` filter
 * enumerates exactly these strings. Until 0009 the index had no event filter at all
 * and silently swallowed a second `SHIFT_OPENED` for the same run — this constant
 * described the intent correctly while the DDL did something wider, which is why the
 * two are now cross-referenced in both directions. Adding a time-triggered event is
 * an edit here AND a migration.
 */
export const TIME_TRIGGERED_EVENTS: readonly NotificationEvent[] = [
  'SHIFT_REMINDER',
  'SHIFT_AT_RISK',
];

/**
 * Facts the push copy is rendered from. A type alias, not an interface, so it stays
 * assignable to the `jsonb` column's type.
 *
 * `when` arrives pre-formatted because only the enqueuing service has the
 * `app_config.timezone` context that local wall-clock rendering needs; dispatch stays
 * a dumb sender.
 */
export type NotificationPayload = {
  /** Route name, e.g. "Tuesday North". */
  route?: string;
  /** Local start time, already formatted, e.g. "Tue Aug 4, 2:00 PM". */
  when?: string;
  /** The person the event is about, when that is not the recipient. */
  who?: string;
};

// ---------------------------------------------------------------------------
// Write path — inside the caller's transaction
// ---------------------------------------------------------------------------

export interface NotificationDraft {
  event: NotificationEvent;
  /** The recipient. Exactly one of this and `subscriptionId` is set (`ck_notif_recipient`). */
  recipientId?: string | null;
  /** Device-scoped delivery: which device's endpoint. Truck-inbound only (Phase 2). */
  subscriptionId?: string | null;
  /** Subject shift: the inbox deep-link anchor and the dedupe key. */
  shiftId?: string | null;
  payload?: NotificationPayload;
}

/**
 * Write one outbox row inside the caller's business transaction.
 *
 * Returns the new notification id, or `null` when an equivalent row already existed —
 * the duplicate-send guard is the tier-1 partial unique index `uq_notif_shift_event`,
 * not job discipline, so a second sweep for the same (event, shift, recipient) is
 * absorbed here rather than producing a second banner (§4.4).
 *
 * The conflict target is left unqualified deliberately: `ON CONFLICT DO NOTHING` with
 * no target covers whichever unique index actually fires, so this call site does not
 * restate the index's partial predicate and drift from the migration that owns it.
 */
export async function enqueueNotification(
  tx: Tx,
  draft: NotificationDraft,
): Promise<string | null> {
  const row = await tx
    .insertInto('notification')
    .values({
      event: draft.event,
      recipient_id: draft.recipientId ?? null,
      subscription_id: draft.subscriptionId ?? null,
      shift_id: draft.shiftId ?? null,
      payload: draft.payload ?? {},
    })
    .onConflict((oc) => oc.doNothing())
    .returning('id')
    .executeTakeFirst();

  return row?.id ?? null;
}

/**
 * Fan-out helper: one row per recipient, same event and subject shift. Returns the ids
 * actually inserted, so a caller can tell a real fan-out from one the dedupe index
 * absorbed.
 */
export async function enqueueNotifications(
  tx: Tx,
  drafts: readonly NotificationDraft[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const draft of drafts) {
    const id = await enqueueNotification(tx, draft);
    if (id !== null) ids.push(id);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Dispatch state
// ---------------------------------------------------------------------------

/**
 * Attempts before dispatch gives up on a notification. Push is best-effort and the
 * inbox already holds the signal, so "give up after a cap and log" is the documented
 * ceiling (§4.4). The ladder below spends ~80 minutes on a row before dropping it.
 */
export const MAX_DISPATCH_ATTEMPTS = 5;

/** Backoff before the next attempt, indexed by attempts already made. */
export const DISPATCH_BACKOFF_MINUTES = [0, 1, 5, 15, 60] as const;

export interface PendingNotification {
  id: string;
  event: string;
  recipientId: string | null;
  subscriptionId: string | null;
  shiftId: string | null;
  payload: NotificationPayload;
  attempts: number;
}

export interface DispatchTarget {
  subscriptionId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * "What is due and unhandled?" — never "fire at time T" (§4.4). Undelivered, under the
 * attempt cap, past its backoff, oldest first. Read-only, so it runs at the default
 * isolation level (§4.1 permits that for reads).
 */
export async function pendingDispatch(limit = 50): Promise<PendingNotification[]> {
  const rows = await db
    .selectFrom('notification')
    .select([
      'id',
      'event',
      'recipient_id',
      'subscription_id',
      'shift_id',
      'payload',
      'attempts',
    ])
    .where('delivered_at', 'is', null)
    .where('attempts', '<', MAX_DISPATCH_ATTEMPTS)
    // The backoff ladder, in SQL, so "is it due" is answered by the database clock
    // rather than by a process that may have just restarted. Kept in step with
    // DISPATCH_BACKOFF_MINUTES above.
    // The parentheses are load-bearing: without them the OR would escape the AND
    // chain above and re-select delivered or exhausted rows.
    .where(
      sql<boolean>`(last_attempt_at IS NULL OR last_attempt_at <= now() - (
        CASE attempts
          WHEN 0 THEN interval '0 minutes'
          WHEN 1 THEN interval '1 minute'
          WHEN 2 THEN interval '5 minutes'
          WHEN 3 THEN interval '15 minutes'
          ELSE        interval '60 minutes'
        END))`,
    )
    .orderBy('created_at', 'asc')
    .limit(limit)
    .execute();

  return rows.map((r) => ({
    id: r.id,
    event: r.event,
    recipientId: r.recipient_id,
    subscriptionId: r.subscription_id,
    shiftId: r.shift_id,
    payload: (r.payload ?? {}) as NotificationPayload,
    attempts: r.attempts,
  }));
}

/**
 * The live endpoints a notification should reach.
 *
 * A person may hold several (phone, desktop); a device-scoped row names exactly one.
 * Revoked rows are skipped — a `410 Gone` is the normal end of a subscription's life,
 * and revocation is how that is recorded, because every FK is `ON DELETE RESTRICT` so
 * the row cannot be deleted once anything references it (`data-model.md §0`, §11).
 *
 * A recipient with no live endpoint yields nothing: the row stays undelivered and the
 * inbox still holds it, which is the PRD's "zero missed signal for a user who never
 * enables push".
 */
export async function dispatchTargets(
  notification: PendingNotification,
): Promise<DispatchTarget[]> {
  let query = db
    .selectFrom('push_subscription')
    .select(['id', 'endpoint', 'p256dh', 'auth'])
    .where('revoked_at', 'is', null);

  query =
    notification.recipientId !== null
      ? query.where('user_id', '=', notification.recipientId)
      : query.where('id', '=', notification.subscriptionId);

  const rows = await query.execute();
  return rows.map((r) => ({
    subscriptionId: r.id,
    endpoint: r.endpoint,
    p256dh: r.p256dh,
    auth: r.auth,
  }));
}

export interface DispatchResult {
  notificationId: string;
  /** True when at least one endpoint accepted the push. */
  delivered: boolean;
  /** Subscriptions the gateway answered `410 Gone` for. */
  goneSubscriptionIds?: readonly string[];
}

/**
 * Record one dispatch pass: bump `attempts`, stamp `last_attempt_at`, set
 * `delivered_at` on success, and revoke any subscription the gateway reported gone.
 *
 * Delivery is at-least-once on purpose (§4.4): a crash between "push sent" and this
 * write leaves the row pending and the next sweep re-sends it. A duplicate banner
 * beats a lost reminder, so there is deliberately no machinery here making it
 * exactly-once.
 */
export async function recordDispatchResult(result: DispatchResult): Promise<void> {
  await writeTransaction(async (tx) => {
    await tx
      .updateTable('notification')
      .set({
        attempts: sql<number>`attempts + 1`,
        last_attempt_at: sql<Date>`now()`,
        ...(result.delivered ? { delivered_at: sql<Date>`now()` } : {}),
      })
      .where('id', '=', result.notificationId)
      // Never un-deliver a row a concurrent pass already completed.
      .where('delivered_at', 'is', null)
      .execute();

    for (const subscriptionId of result.goneSubscriptionIds ?? []) {
      await revokeSubscriptionIn(tx, subscriptionId);
    }
  });
}

/**
 * `410 Gone` → revoke. The subscription is dead (app uninstalled, permission
 * revoked); this is the normal end of its life, not an error, and dispatch skips
 * revoked rows from here on. Revoked rather than deleted because `data-model.md §0`
 * makes every FK `ON DELETE RESTRICT`, so a subscription that any session or
 * notification references cannot be removed at all — and a hard delete would take
 * with it the record of which device a past alert reached.
 */
export async function revokeSubscription(subscriptionId: string): Promise<void> {
  await writeTransaction((tx) => revokeSubscriptionIn(tx, subscriptionId));
}

async function revokeSubscriptionIn(tx: Tx, subscriptionId: string): Promise<void> {
  await tx
    .updateTable('push_subscription')
    .set({ revoked_at: sql<Date>`now()` })
    .where('id', '=', subscriptionId)
    // Idempotent: the first revocation timestamp is the true one, and two passes can
    // both see a gone endpoint before either has recorded it.
    .where('revoked_at', 'is', null)
    .execute();
}

// ---------------------------------------------------------------------------
// Push copy
// ---------------------------------------------------------------------------

export interface PushMessage {
  title: string;
  body: string;
  /** Where tapping the banner lands — S1.9's "tap to act" deep link. */
  url: string;
  event: string;
  notificationId: string;
  /**
   * The raw facts the copy above was rendered from, carried alongside it.
   *
   * The OS banner uses `title`/`body` and nothing else. An in-page surface can want
   * to say the same thing differently — S2.4's dock banner leads with the driver's
   * name ("Karen's run returning") because that is what a receiver recognises from
   * the run picker, and it has room for a quieter second line the OS banner does
   * not. Sending the facts as well as the sentence is what lets it do that without
   * a second copy of the copy drifting from this one.
   *
   * Still pre-formatted where formatting needs the pantry's zone: `when` is words,
   * not a timestamp, because only the enqueuing service has `app_config.timezone`.
   */
  route?: string;
  who?: string;
  when?: string;
}

/**
 * Render the banner text for one notification.
 *
 * `ui-ux-spec.md §7`: plain, short, second person; the user's word is "run", not
 * "shift"; and the vocabulary this subsystem is built out of is forbidden in copy.
 * Detail is optional, because the inbox — not the banner — is the source of truth, so
 * a notification enqueued with a bare payload still says something useful.
 */
export function renderPush(notification: PendingNotification): PushMessage {
  const { route, when, who } = notification.payload ?? {};
  const run = [when, route].filter(Boolean).join(', ');
  const detail = run !== '' ? run : 'Open R3 to see the details.';

  let title: string;
  let body: string;

  switch (notification.event) {
    case 'SHIFT_ASSIGNED':
      title = "You're on a run";
      body = detail;
      break;
    case 'SHIFT_REMINDER':
      title = 'Your run starts in an hour';
      body = detail;
      break;
    case 'UNAVAILABILITY_DECLARED':
      title = who != null && who !== '' ? `${who} set time off` : 'A driver set time off';
      body = run !== '' ? run : 'Open R3 to see the dates.';
      break;
    case 'SHIFT_OPENED':
      title = 'A run needs a driver';
      body = run !== '' ? `${run}. Tap to take it.` : 'Tap to see it on the board.';
      break;
    case 'SHIFT_AT_RISK':
      title = 'A run is still open for tomorrow';
      body = run !== '' ? `${run}. Tap to take it.` : 'Tap to see it on the board.';
      break;
    case 'TRUCK_INBOUND':
      // S2.4's banner. Addressed to a dock that may have nobody logged in, so the
      // copy has to stand alone — "who" is the driver heading back, and the route
      // says which run, because a receiver may be expecting more than one.
      title = 'Truck inbound';
      body =
        who != null && who !== ''
          ? `${who} is heading back${route != null && route !== '' ? ` from ${route}` : ''}.`
          : 'A driver is heading back with a pickup.';
      break;
    default:
      title = 'R3';
      body = detail;
      break;
  }

  return {
    title,
    body,
    url: deepLinkFor(notification),
    event: notification.event,
    notificationId: notification.id,
    // Omitted rather than sent as null: this is JSON on a size-limited push channel,
    // and an absent key and a null one mean the same thing to every reader.
    ...(route != null && route !== '' ? { route } : {}),
    ...(who != null && who !== '' ? { who } : {}),
    ...(when != null && when !== '' ? { when } : {}),
  };
}

/**
 * Where tapping the banner lands.
 *
 * Every person-addressed event deep-links to its shift, which is S1.9's "tap to act".
 * `TRUCK_INBOUND` is the exception, and for the reason that makes it exceptional at
 * all: it is addressed to a DEVICE, so the person who taps it is whoever is standing
 * at the dock. `/shifts/:id` is the driver's and staff's view of a run and would ask
 * a receiver to be someone they are not; `/receive` is the screen they actually need,
 * and it is where they would have gone anyway (Phase-2 A170).
 */
function deepLinkFor(notification: PendingNotification): string {
  if (notification.event === 'TRUCK_INBOUND') return '/receive';
  return notification.shiftId !== null ? `/shifts/${notification.shiftId}` : '/inbox';
}
