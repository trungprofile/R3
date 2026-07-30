// Registering the service worker, and the two small pieces of browser wiring that
// come with it.
//
// THE WORKER IS PUSH ONLY (`architecture.md §4.5`). `client/src/sw.ts` belongs to
// the notification lane and is deliberately fetch-handler-free: offline support is
// a non-goal and `ui-ux-spec.md §6` requires a blocking "You're offline" banner, so
// a cache-first worker would fake a capability the product does not have. This file
// REGISTERS that worker. It does not extend it, and adding a `fetch` listener there
// is the change that would break the rule.
//
// The URL is fixed at `/sw.js` (`phase-1-state.md` A14): `client/vite.config.ts`
// emits the worker under that exact unhashed name because a registration call has
// to know the URL and a hashed one would change every deploy. Registration is this
// lane's job — nothing called it before now — so A14 is exercised here for the
// first time.

/** A14. Must match `client/vite.config.ts`'s `entryFileNames` for the `sw` entry. */
export const SERVICE_WORKER_URL = '/sw.js';

/** Root scope: alerts are app-wide, and a deep link from a banner may land on any
 *  screen. */
const SCOPE = '/';

let registering: Promise<ServiceWorkerRegistration | null> | null = null;

/**
 * Register once per page load, and hand back the same promise afterwards.
 *
 * Returns null rather than throwing when the browser has no service worker, or when
 * the worker file is not there — which is the normal state under `vite dev`, where
 * only the built bundle emits `/sw.js`. Alerts then read as unavailable and the app
 * is otherwise untouched, because the inbox is the source of truth (PRD channel
 * strategy) and nothing else depends on the worker.
 */
export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (registering) return registering;

  if (!('serviceWorker' in navigator)) {
    registering = Promise.resolve(null);
    return registering;
  }

  registering = navigator.serviceWorker
    .register(SERVICE_WORKER_URL, { scope: SCOPE })
    .then((registration) => registration)
    .catch(() => null);

  return registering;
}

/** Test seam and reload safety: a new page load starts a new registration. */
export function resetServiceWorkerRegistration(): void {
  registering = null;
}

// ---------------------------------------------------------------------------
// Tapping an alert
// ---------------------------------------------------------------------------

/**
 * `sw.ts` answers a `notificationclick` by focusing an open window and posting it
 * `{ type: 'navigate', url }` rather than reloading the app out from under the
 * user. This is the other half of that: the shell owns routing, so it has to be
 * listening.
 *
 * Without this, tapping a banner while R3 is already open focuses the window and
 * does nothing else — S1.9's "tap to act" silently half-works.
 */
export function onServiceWorkerNavigate(handler: (url: string) => void): () => void {
  if (!('serviceWorker' in navigator)) return () => undefined;

  const listener = (event: MessageEvent) => {
    const data = event.data as { type?: unknown; url?: unknown } | null;
    if (data?.type !== 'navigate') return;
    if (typeof data.url !== 'string' || !data.url.startsWith('/')) return;
    handler(data.url);
  };

  navigator.serviceWorker.addEventListener('message', listener);
  return () => navigator.serviceWorker.removeEventListener('message', listener);
}

/** One alert as it reaches an already-open page. Mirrors `sw.ts`'s `PushMessage`. */
export interface ForegroundAlert {
  title: string;
  body: string;
  url: string;
  event: string;
  notificationId: string;
}

/**
 * An alert arriving while R3 is already open.
 *
 * Distinct from `onServiceWorkerNavigate` above, and the difference matters: that one
 * fires when someone TAPS an OS banner, so acting on it is what they asked for. This
 * one fires when a push merely ARRIVES, so the page has been told something and
 * nobody has asked for anything. Only a surface that can interrupt gently should use
 * it — S2.4's dock banner is the one the spec asks for.
 *
 * Delivered to every open window (`sw.ts` posts to all matched clients), so a handler
 * must be idempotent and must not navigate on its own.
 */
export function onForegroundAlert(handler: (alert: ForegroundAlert) => void): () => void {
  if (!('serviceWorker' in navigator)) return () => undefined;

  const listener = (event: MessageEvent) => {
    const data = event.data as Partial<ForegroundAlert> & { type?: unknown };
    if (data?.type !== 'alert') return;
    if (typeof data.event !== 'string' || typeof data.title !== 'string') return;
    handler({
      title: data.title,
      body: typeof data.body === 'string' ? data.body : '',
      url: typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/inbox',
      event: data.event,
      notificationId: typeof data.notificationId === 'string' ? data.notificationId : '',
    });
  };

  navigator.serviceWorker.addEventListener('message', listener);
  return () => navigator.serviceWorker.removeEventListener('message', listener);
}

// ---------------------------------------------------------------------------
// Installability
// ---------------------------------------------------------------------------

/** The web app manifest, served from `client/public/` at a fixed root URL.
 *
 *  The `<link>` is added here rather than in `client/index.html` because that file
 *  is outside this lane's declared file ownership (build-plan §3). Moving it into
 *  the document head is a one-line improvement and changes nothing else — see this
 *  wave's report. */
export const MANIFEST_URL = '/manifest.webmanifest';

export function linkManifest(): void {
  if (typeof document === 'undefined') return;
  if (document.querySelector('link[rel="manifest"]')) return;

  const link = document.createElement('link');
  link.rel = 'manifest';
  link.href = MANIFEST_URL;
  document.head.appendChild(link);
}

/**
 * Chromium fires `beforeinstallprompt` when it is willing to install the app, and
 * lets a page defer that prompt to a moment of its own choosing. §5 wants the
 * install offer inside a card that explains itself, not as a browser bar the user
 * dismisses without reading.
 *
 * The event is fired once, early — often before React has mounted — so it is
 * captured at module load and read later.
 */
export interface InstallPrompt {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

declare global {
  interface WindowEventMap {
    /** Chromium-only and absent from the DOM lib, because it is not a standard.
     *  Declared rather than cast so the listener below stays typed. */
    beforeinstallprompt: Event;
  }
}

let deferredPrompt: InstallPrompt | null = null;
const promptListeners = new Set<() => void>();

function announce(): void {
  for (const listener of promptListeners) listener();
}

export function watchForInstallPrompt(): void {
  if (typeof window === 'undefined') return;

  window.addEventListener('beforeinstallprompt', (event) => {
    // Keep the browser's own bar from appearing: §5 puts the offer in the card.
    event.preventDefault();
    deferredPrompt = event as unknown as InstallPrompt;
    announce();
  });

  // Installed by any route, including the browser's own menu — the guide has
  // nothing left to say, so it stops saying it.
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    announce();
  });
}

export function installPromptAvailable(): boolean {
  return deferredPrompt !== null;
}

export function subscribeToInstallPrompt(listener: () => void): () => void {
  promptListeners.add(listener);
  return () => promptListeners.delete(listener);
}

/** Show the browser's install prompt. Resolves true when the app was installed.
 *  A prompt can only be used once, so it is dropped either way. */
export async function showInstallPrompt(): Promise<boolean> {
  const pending = deferredPrompt;
  if (!pending) return false;
  deferredPrompt = null;

  try {
    await pending.prompt();
    const choice = await pending.userChoice;
    announce();
    return choice.outcome === 'accepted';
  } catch {
    announce();
    return false;
  }
}
