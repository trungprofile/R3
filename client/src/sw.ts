// Service worker — registered for PUSH ONLY (`architecture.md §4.5`).
//
// Offline support is an explicit non-goal, and `ui-ux-spec.md §6` requires a
// blocking "You're offline" banner. So this worker must NOT adopt a cache-first
// strategy that lets the app shell load and appear functional without a network —
// that would fake a capability the product deliberately lacks. There is deliberately
// no `fetch` listener below, and adding one is the change that would break this.
//
// Push delivery is at-least-once; a duplicate banner beats a lost reminder. A
// `410 Gone` on dispatch means this registration is dead (uninstalled, permission
// revoked) and the server marks it revoked rather than deleting it — every FK is
// `ON DELETE RESTRICT` (`data-model.md §0`, §11), so the row cannot be removed once
// a session or a past alert references it. The normal end of its life, not an error.
//
// Every user-visible string here obeys `ui-ux-spec.md §7`.

export {};

declare const self: ServiceWorkerGlobalScope;

/** What `services/notification.ts` renders and the dispatch job sends. */
interface PushMessage {
  title: string;
  body: string;
  /** S1.9's "tap to act" deep link. */
  url: string;
  event: string;
  notificationId: string;
  /** The raw facts the copy was rendered from. The OS banner below ignores them;
   *  an in-page surface (S2.4's dock banner) composes its own line from them. */
  route?: string;
  who?: string;
  when?: string;
}

/**
 * Anything unreadable still surfaces something actionable — the alert exists to get
 * the user into the app, where the inbox is the source of truth (PRD channel
 * strategy).
 */
const FALLBACK: PushMessage = {
  title: 'R3',
  body: 'Open R3 to see what changed.',
  url: '/inbox',
  event: 'UNKNOWN',
  notificationId: '',
};

function parse(event: PushEvent): PushMessage {
  if (event.data === null) return FALLBACK;
  try {
    const data = event.data.json() as Partial<PushMessage>;
    return {
      title: typeof data.title === 'string' ? data.title : FALLBACK.title,
      body: typeof data.body === 'string' ? data.body : FALLBACK.body,
      url: typeof data.url === 'string' ? data.url : FALLBACK.url,
      event: typeof data.event === 'string' ? data.event : FALLBACK.event,
      notificationId:
        typeof data.notificationId === 'string'
          ? data.notificationId
          : FALLBACK.notificationId,
      ...(typeof data.route === 'string' ? { route: data.route } : {}),
      ...(typeof data.who === 'string' ? { who: data.who } : {}),
      ...(typeof data.when === 'string' ? { when: data.when } : {}),
    };
  } catch {
    return FALLBACK;
  }
}

// Take over as soon as installed. A worker whose only job is showing alerts has
// nothing in flight worth waiting for, and a driver who just finished setup should
// get the next alert rather than the one after it.
self.addEventListener('install', () => {
  void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/**
 * Tell any open window what just arrived.
 *
 * The OS banner below is the right surface for a phone in someone's pocket. It is the
 * wrong one for the shared receiver tablet, which sits face-up on the dock with R3
 * already open: `ui-ux-spec.md` S2.4 asks for a full-width in-page banner there,
 * loud enough to notice across a room and — critically — one that "banners above
 * without stealing the keypad" from whoever is mid-weighing.
 *
 * So the page gets the same message, and decides for itself whether it has a surface
 * for it. Posting to every matched client rather than focusing one: nothing has been
 * tapped here, and stealing focus on a push would be hostile.
 */
async function tellOpenWindows(message: PushMessage): Promise<void> {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of windows) {
    client.postMessage({ type: 'alert', ...message });
  }
}

self.addEventListener('push', (event) => {
  const message = parse(event);
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(message.title, {
        body: message.body,
        // At-least-once delivery means the same alert can arrive twice. Tagging by the
        // server's row id collapses the repeat into one banner instead of suppressing
        // the send — the trade `architecture.md §4.4` chose deliberately.
        tag: message.notificationId !== '' ? message.notificationId : message.event,
        data: { url: message.url },
      }),
      tellOpenWindows(message),
    ]),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data as { url?: unknown } | null;
  const url = typeof data?.url === 'string' ? data.url : '/inbox';

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      for (const client of windows) {
        if ('focus' in client) {
          await client.focus();
          // The shell owns routing, so hand it the destination rather than reloading
          // a running app out from under the user.
          client.postMessage({ type: 'navigate', url });
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
