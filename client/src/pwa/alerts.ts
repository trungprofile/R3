// Turning alerts on, end to end: permission, registration with the browser's push
// service, and telling the server about it.
//
// Order matters and is not arbitrary:
//
//   1. ask permission          — must be inside a user gesture, so this is only
//                                ever called from a tap (§5: "One tap.")
//   2. register the worker     — `/sw.js`, push only (`architecture.md §4.5`)
//   3. read the box's key      — absent means alerts are unavailable, not broken
//   4. register with the browser's push service
//   5. hand it to the server   — POST, idempotent, so re-offering costs nothing
//
// Step 5 is repeated on every start by `syncRegistration()`. That is the whole
// recovery story for a registration the server never received: no bookkeeping, no
// reconciliation job, just an idempotent write that happens to be correct. The
// server's matching half is `uq_push_endpoint` plus an upsert.
//
// A registration is never DELETED from here. `data-model.md §0` makes every FK
// `ON DELETE RESTRICT`, so a dead one is soft-revoked by dispatch on a `410 Gone`
// (`architecture.md §4.4`) — the normal end of its life, not an error.

import { api } from '../api/client.ts';
import type { PushConfigResponse, PushRegistrationResponse } from '../api/shared.ts';
import { deviceLabel, readBrowser, type BrowserCapability } from './platform.ts';
import { registerServiceWorker } from './serviceWorker.ts';

const PATHS = {
  config: '/push/config',
  register: '/push/subscriptions',
} as const;

/**
 * The VAPID key arrives base64url and the browser wants bytes.
 *
 * Exported because it is the one piece of this file that is pure and worth a test:
 * a wrong conversion produces a registration the push service accepts and the
 * server can never deliver to.
 */
export function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);

  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export type EnableOutcome =
  /** Alerts are on and the server knows where to send them. */
  | 'on'
  /** The user said no, or the browser is blocking. Recoverable, and the chip says so. */
  | 'denied'
  /** This browser cannot do alerts at all (iOS in a tab, an old desktop browser). */
  | 'unsupported'
  /** The box has no key configured. Nothing the user can act on. */
  | 'unavailable'
  /** Something else went wrong. §6: recoverable, and never a code on screen. */
  | 'failed';

export interface AlertsState extends BrowserCapability {
  registered: boolean;
  keyConfigured: boolean;
}

async function readKey(): Promise<string | null> {
  try {
    const config = await api.get<PushConfigResponse>(PATHS.config);
    return config.publicKey;
  } catch {
    return null;
  }
}

/** The registration this browser currently holds, if any. */
async function currentRegistration(): Promise<PushSubscription | null> {
  const worker = await registerServiceWorker();
  if (!worker) return null;
  try {
    return await worker.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/**
 * Where the app stands, for the chip and for the onboarding machine.
 *
 * "Registered" is asked of the browser, not remembered: a browser can drop a
 * registration on its own (data cleared, a long-idle install), and a remembered
 * "yes" would leave the chip claiming alerts are on while nothing arrives — the
 * exact silent failure §5's chip exists to expose.
 */
export async function readAlertsState(): Promise<AlertsState> {
  const browser = readBrowser();

  if (!browser.alertsSupported) {
    return { ...browser, registered: false, keyConfigured: false };
  }

  const [key, registration] = await Promise.all([readKey(), currentRegistration()]);
  return {
    ...browser,
    registered: registration !== null,
    keyConfigured: key !== null,
  };
}

async function sendToServer(
  registration: PushSubscription,
  browser: BrowserCapability,
): Promise<void> {
  const json = registration.toJSON();
  const keys = json.keys ?? {};
  if (!json.endpoint || !keys['p256dh'] || !keys['auth']) throw new Error('incomplete');

  await api.post<PushRegistrationResponse>(PATHS.register, {
    body: {
      endpoint: json.endpoint,
      keys: { p256dh: keys['p256dh'], auth: keys['auth'] },
      label: deviceLabel(browser.platform, browser.installed),
    },
  });
}

/**
 * Re-offer whatever this browser already holds, silently, on every start.
 *
 * Never prompts: it does nothing at all unless permission is already granted, so it
 * cannot ambush a user who has not asked for alerts. If permission is granted but
 * the browser has dropped its registration, this quietly makes a new one — allowed
 * without a gesture precisely because the user already said yes.
 */
export async function syncRegistration(): Promise<void> {
  const browser = readBrowser();
  if (!browser.alertsSupported || browser.permission !== 'granted') return;

  try {
    const key = await readKey();
    if (key === null) return;

    const worker = await registerServiceWorker();
    if (!worker) return;

    const registration =
      (await worker.pushManager.getSubscription()) ?? (await subscribe(worker, key));
    if (registration) await sendToServer(registration, browser);
  } catch {
    // Best-effort by design (`architecture.md §4.4`): the inbox still has
    // everything, so a failed sync is not worth a message the user cannot act on.
  }
}

async function subscribe(
  worker: ServiceWorkerRegistration,
  key: string,
): Promise<PushSubscription | null> {
  try {
    return await worker.pushManager.subscribe({
      // Required by Chromium, and true: `sw.ts` shows a banner for every message
      // it receives. Silent push is not something R3 wants to be able to do.
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    });
  } catch {
    // The usual cause is an existing registration made against a different key —
    // a redeployed box with new VAPID keys. Drop the browser's side and retry
    // once. The server's row is left alone: it is revoked on its next `410`, and
    // there is no delete path (`data-model.md §0`).
    const stale = await worker.pushManager.getSubscription();
    if (!stale) return null;
    await stale.unsubscribe().catch(() => undefined);
    try {
      return await worker.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
    } catch {
      return null;
    }
  }
}

/**
 * The one tap behind §5's "Turn on alerts" and behind the chip's "tap to fix".
 *
 * MUST be called from a user gesture: `Notification.requestPermission()` is
 * ignored otherwise on every browser that matters.
 */
export async function enableAlerts(): Promise<EnableOutcome> {
  const browser = readBrowser();
  if (!browser.alertsSupported) return 'unsupported';

  let permission: NotificationPermission;
  try {
    permission = await Notification.requestPermission();
  } catch {
    return 'failed';
  }
  // A browser already holding "denied" resolves immediately without showing
  // anything, which is why §5's copy has to point at browser settings rather than
  // promising another prompt.
  if (permission !== 'granted') return 'denied';

  try {
    const key = await readKey();
    if (key === null) return 'unavailable';

    const worker = await registerServiceWorker();
    if (!worker) return 'unsupported';

    const registration =
      (await worker.pushManager.getSubscription()) ?? (await subscribe(worker, key));
    if (!registration) return 'failed';

    await sendToServer(registration, browser);
    return 'on';
  } catch {
    return 'failed';
  }
}
