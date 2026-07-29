// Alert registrations — the write half of `push_subscription` (`data-model.md §11`).
//
// One browser hands the server one registration; the dispatch job
// (`jobs/push-dispatch.ts`) reads them back. This service is the only thing that
// writes the table on a request path, and it opens the transaction itself because
// nothing outside `services/` may (`architecture.md §4.1`).
//
// TWO KINDS OF OWNER, never both (`ck_push_owner`):
//
//   personal browser   -> user_id  set. The driver's phone. Every event in the
//                         PRD §4 matrix that names a person lands here.
//   registered device  -> device_id set. The receiver tablet: `product-requirement.md
//                         §2` gives it "a device-level push subscription used only for
//                         the truck-inbound alert… a notification endpoint, not a
//                         login", and `architecture.md §4.2` binds it to the `device`
//                         row so that losing the shared-device marker also stops the
//                         alerts — security state that degrades invisibly is tied to
//                         something operationally visible.
//
// Which one is decided HERE, from the confirmed device marker, never from anything
// the client asks for. A driver who signs in at the pantry tablet must not turn the
// shared tablet into a delivery point for their own runs.
//
// THERE IS NO DELETE PATH, deliberately. A dead registration is soft-revoked
// (`revoked_at`, set by dispatch on a `410 Gone`) because `data-model.md §0` makes
// every FK `ON DELETE RESTRICT` — a row any notification references cannot be
// removed at all, and a hard delete would take with it the record of which device a
// past alert reached (`architecture.md §4.4`).

import { sql } from 'kysely';
import type { PushScope } from '../../../shared/src/index.js';
import { writeTransaction } from '../db/transaction.js';
import { badRequest } from '../middleware/error.js';

export interface RegisterSubscriptionInput {
  /** The signed-in user. There is no anonymous registration: the gate requires a
   *  session before this is reached. */
  userId: string;
  /** The shared device this browser presented, ALREADY confirmed against the
   *  `device` table by the caller. Null means unregistered, i.e. personal
   *  (`architecture.md §4.2` — the enumerated set is the shared one). */
  deviceId: string | null;
  endpoint: string;
  p256dh: string;
  auth: string;
  /** Free text for whoever reads the table later ("iPhone", "Android phone"). */
  label?: string | null;
}

export interface RegisteredSubscription {
  id: string;
  scope: PushScope;
}

/** A push endpoint is a bearer capability in URL form (§5.4 — never logged). It
 *  must at least be an absolute `https` URL before it is stored. */
function checkEndpoint(value: string): string {
  const endpoint = value.trim();
  if (endpoint === '') throw badRequest('Alerts could not be turned on.');

  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw badRequest('Alerts could not be turned on.');
  }
  if (url.protocol !== 'https:') throw badRequest('Alerts could not be turned on.');
  return endpoint;
}

function checkKey(value: string): string {
  const key = value.trim();
  // RFC 8291 keys are base64url. Length is not checked: the gateway and the
  // `web-push` library are the authorities on their own encoding, and a stricter
  // rule here would reject a future key format for no gain.
  if (key === '' || !/^[A-Za-z0-9_-]+=*$/.test(key)) {
    throw badRequest('Alerts could not be turned on.');
  }
  return key;
}

/**
 * Store one browser's registration, or refresh the one already stored for that
 * endpoint.
 *
 * Idempotent by `uq_push_endpoint`: a browser re-offering the same endpoint —
 * which is what happens on every app start, and is how a registration the server
 * never received heals itself — updates the existing row rather than failing or
 * doubling it.
 *
 * A re-offered endpoint also CLEARS `revoked_at`. Revocation records that the
 * gateway said the endpoint was dead (`architecture.md §4.4`); a browser
 * presenting that same endpoint again is the gateway's answer being superseded,
 * and the unique index means a second, live row for it cannot exist. Clearing the
 * timestamp is therefore the only way back to live, and deleting is unavailable
 * by design (see the header).
 */
export async function registerSubscription(
  input: RegisterSubscriptionInput,
): Promise<RegisteredSubscription> {
  const endpoint = checkEndpoint(input.endpoint);
  const p256dh = checkKey(input.p256dh);
  const auth = checkKey(input.auth);
  const label = input.label?.trim() ? input.label.trim().slice(0, 60) : null;

  // ck_push_owner: exactly one owner column is set. A registered device owns the
  // registration outright — the person signed in at the moment is irrelevant to a
  // device-scoped alert, which "fires regardless of who, if anyone, is logged in"
  // (`product-requirement.md §2`).
  const deviceScoped = input.deviceId !== null;

  const row = await writeTransaction(async (tx) =>
    tx
      .insertInto('push_subscription')
      .values({
        user_id: deviceScoped ? null : input.userId,
        device_id: input.deviceId,
        endpoint,
        p256dh,
        auth,
        label,
      })
      .onConflict((oc) =>
        oc.column('endpoint').doUpdateSet({
          user_id: deviceScoped ? null : input.userId,
          device_id: input.deviceId,
          p256dh,
          auth,
          // A refresh that carries no label must not erase one already there.
          label: label ?? sql<string | null>`push_subscription.label`,
          revoked_at: null,
        }),
      )
      .returning('id')
      .executeTakeFirstOrThrow(),
  );

  return { id: row.id, scope: deviceScoped ? 'DEVICE' : 'USER' };
}

/**
 * The VAPID application server key the browser needs to register at all.
 *
 * Configuration, not a domain rule — it is an environment variable on the box
 * (`architecture.md §5.1`), and it is a PUBLIC key: it is handed to every browser
 * by design. The private half never leaves `jobs/push-dispatch.ts`.
 *
 * Null when unset. An unconfigured box loses the alerting layer and nothing else,
 * because the in-app inbox is the source of truth (PRD channel strategy) — the same
 * degradation dispatch already chose rather than crashing the process.
 */
export function vapidPublicKey(): string | null {
  const key = process.env['VAPID_PUBLIC_KEY'];
  return key && key.trim() !== '' ? key.trim() : null;
}
