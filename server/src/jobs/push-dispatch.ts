// Push dispatch — the outbox drain (`architecture.md §4.4`).
//
// The `notification` row was committed inside the business transaction; this is the
// half that runs OUTSIDE it, because write transactions are SERIALIZABLE with retry
// and a retried transaction would re-send (§4.1).
//
// Cadence is "on commit + sweep": a business service calls `dispatchNow()` right
// after its transaction commits so a release fans out at once, and the periodic sweep
// is the safety net that makes correctness independent of that call ever happening.
//
// This job opens no transaction of its own. Every write it causes goes through
// `services/notification.ts`, because nothing outside `services/` may open a write
// transaction and a job is outside `services/` (§4.1).

import webpush from 'web-push';
import {
  dispatchTargets,
  MAX_DISPATCH_ATTEMPTS,
  pendingDispatch,
  recordDispatchResult,
  renderPush,
  type DispatchTarget,
  type PendingNotification,
} from '../services/notification.js';
import type { Job } from './scheduler.js';

/** HTTP 410. The subscription is dead — the normal end of its life, not an error. */
const GONE = 410;

/**
 * The network half, isolated behind an interface so tests can fake the transport
 * without faking the database. Tests run against the migrated database (CLAUDE.md);
 * only the wire is substitutable.
 */
export interface PushTransport {
  send: (target: DispatchTarget, body: string) => Promise<void>;
}

function statusCodeOf(err: unknown): number | undefined {
  if (typeof err === 'object' && err !== null && 'statusCode' in err) {
    const code = (err as { statusCode?: unknown }).statusCode;
    if (typeof code === 'number') return code;
  }
  return undefined;
}

function log(payload: Record<string, unknown>): void {
  // §5.4: identifiers only. Never a VAPID key — those are credentials — and never a
  // subscription endpoint, which is a bearer capability in URL form.
  console.log(JSON.stringify(payload));
}

let vapidState: 'unknown' | 'ready' | 'missing' = 'unknown';

/**
 * VAPID comes from the environment (`architecture.md §5.1`: configuration is
 * environment variables from an env file on the box, never committed).
 *
 * Missing keys degrade dispatch to a no-op rather than crashing the process: the
 * in-app inbox is the source of truth, so an unconfigured box loses the alerting
 * layer and nothing else. Logged once, never with a key value.
 */
function vapidReady(): boolean {
  if (vapidState !== 'unknown') return vapidState === 'ready';

  const subject = process.env['VAPID_SUBJECT'];
  const publicKey = process.env['VAPID_PUBLIC_KEY'];
  const privateKey = process.env['VAPID_PRIVATE_KEY'];

  if (!subject || !publicKey || !privateKey) {
    vapidState = 'missing';
    log({ event: 'push_dispatch_unconfigured', missing: 'VAPID environment' });
    return false;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidState = 'ready';
  return true;
}

/** The real transport: VAPID signing plus RFC 8291 payload encryption, via `web-push`. */
export const webPushTransport: PushTransport = {
  async send(target, body) {
    await webpush.sendNotification(
      {
        endpoint: target.endpoint,
        keys: { p256dh: target.p256dh, auth: target.auth },
      },
      body,
    );
  },
};

export interface DispatchOptions {
  transport?: PushTransport;
  limit?: number;
}

export interface DispatchSummary {
  considered: number;
  delivered: number;
  failed: number;
  revoked: number;
  exhausted: number;
}

async function dispatchOne(
  notification: PendingNotification,
  transport: PushTransport,
): Promise<{ delivered: boolean; gone: string[] }> {
  const targets = await dispatchTargets(notification);
  const body = JSON.stringify(renderPush(notification));

  let delivered = false;
  const gone: string[] = [];

  for (const target of targets) {
    try {
      await transport.send(target, body);
      delivered = true;
    } catch (err) {
      const status = statusCodeOf(err);
      if (status === GONE) {
        // A4 / §4.4: revoke, never delete. Every FK is ON DELETE RESTRICT
        // (`data-model.md §0`), so a subscription any session or notification
        // references cannot be deleted at all.
        gone.push(target.subscriptionId);
        log({
          event: 'push_subscription_revoked',
          subscription_id: target.subscriptionId,
          status,
        });
      } else {
        log({
          event: 'push_send_failed',
          notification_id: notification.id,
          subscription_id: target.subscriptionId,
          status: status ?? null,
        });
      }
    }
  }

  return { delivered, gone };
}

/**
 * One catch-up pass over the outbox: everything undelivered, under the attempt cap,
 * and past its backoff.
 *
 * Delivery is at-least-once by design. A crash between a successful send and the
 * `delivered_at` write leaves the row pending, and the next pass re-sends it — a
 * duplicate banner beats a lost reminder (§4.4), so nothing here tries to close that
 * window.
 */
export async function runPushDispatch(
  options: DispatchOptions = {},
): Promise<DispatchSummary> {
  const transport = options.transport ?? webPushTransport;
  const summary: DispatchSummary = {
    considered: 0,
    delivered: 0,
    failed: 0,
    revoked: 0,
    exhausted: 0,
  };

  // The VAPID check is skipped when a transport is injected, so a test never needs
  // deploy credentials to exercise the drain.
  if (options.transport === undefined && !vapidReady()) return summary;

  const pending = await pendingDispatch(options.limit);
  summary.considered = pending.length;

  for (const notification of pending) {
    const { delivered, gone } = await dispatchOne(notification, transport);

    await recordDispatchResult({
      notificationId: notification.id,
      delivered,
      goneSubscriptionIds: gone,
    });

    summary.revoked += gone.length;
    if (delivered) {
      summary.delivered += 1;
    } else {
      summary.failed += 1;
      if (notification.attempts + 1 >= MAX_DISPATCH_ATTEMPTS) {
        summary.exhausted += 1;
        // §5.4 names this one explicitly as a thing to log. It is not a
        // data-integrity problem: the inbox still holds the notification.
        log({
          event: 'push_dispatch_exhausted',
          notification_id: notification.id,
          attempts: notification.attempts + 1,
        });
      }
    }
  }

  return summary;
}

/**
 * The "on commit" half of §4.4's cadence: fire-and-forget, called by a business
 * service after its transaction has committed, so a release fans out immediately
 * instead of waiting for the next sweep. Never awaited by a request path and never
 * able to fail one — the sweep is what makes correctness independent of this call.
 */
export function dispatchNow(options: DispatchOptions = {}): void {
  void runPushDispatch(options).catch((err: unknown) => {
    log({
      event: 'push_dispatch_failed',
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

/**
 * Sweep every minute. §4.4 gives dispatch "on commit + sweep"; a minute is the
 * cadence the reminder and at-risk sweeps already run at, and it bounds how late a
 * notification enqueued by a job (rather than by a request) can be.
 */
export const pushDispatchJob: Job = {
  name: 'push-dispatch',
  intervalMs: 60_000,
  run: async () => {
    await runPushDispatch();
  },
};
