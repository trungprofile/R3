// Which phone am I on, and am I installed yet — `ui-ux-spec.md §5` ("Detect iOS
// vs Android and show the matching 2-step illustration").
//
// This is the one place in R3 that sniffs a user-agent string, and it is defensible
// only because of what it decides: WHICH PICTURE TO DRAW. Nothing here gates a
// capability — what the browser can actually do is asked of the browser
// (`alerts.ts` feature-detects), never inferred from its name. A wrong guess here
// shows the wrong two-step guide; it can never wrongly enable or disable anything.
//
// Pure functions taking their inputs as arguments, so the branches are testable
// without a browser (build-plan §3/D5 — no test harness may be added).

import type { AlertsPermission, Platform } from './onboarding.ts';

/**
 * iPadOS 13+ reports itself as "Macintosh" and is distinguishable only by having a
 * touch screen. Getting this wrong would show an iPad user the Android guide, which
 * is the one platform where the guide is load-bearing: on iOS there is no alert at
 * all until the app is on the home screen.
 */
export function detectPlatform(userAgent: string, maxTouchPoints: number): Platform {
  const ua = userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return 'ios';
  if (ua.includes('macintosh') && maxTouchPoints > 1) return 'ios';
  if (ua.includes('android')) return 'android';
  return 'other';
}

/** Home screen, not a browser tab. `display-mode: standalone` is the standard
 *  answer; `navigator.standalone` is the iOS-only one that predates it. */
export function detectInstalled(
  displayModeStandalone: boolean,
  iosStandalone: boolean | undefined,
): boolean {
  return displayModeStandalone || iosStandalone === true;
}

export interface BrowserCapability {
  platform: Platform;
  installed: boolean;
  alertsSupported: boolean;
  permission: AlertsPermission;
}

/** Read the live browser. The only impure function in this file, and it does
 *  nothing but read. */
export function readBrowser(): BrowserCapability {
  const nav = navigator as Navigator & { standalone?: boolean };

  const standalone =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches;

  // All three, because a browser can have one without the others — notably iOS
  // Safari in a tab, which has a service worker and no `Notification` at all.
  const alertsSupported =
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  return {
    platform: detectPlatform(navigator.userAgent, navigator.maxTouchPoints ?? 0),
    installed: detectInstalled(standalone, nav.standalone),
    alertsSupported,
    permission: alertsSupported ? Notification.permission : 'unsupported',
  };
}

/** What the admin sees against a registration in the table. Not UI copy — it never
 *  reaches a screen — but it is the only thing distinguishing two rows for the same
 *  person, so it is worth being a sentence rather than a token. */
export function deviceLabel(platform: Platform, installed: boolean): string {
  const base =
    platform === 'ios' ? 'iPhone or iPad' : platform === 'android' ? 'Android phone' : 'Computer';
  return installed ? `${base} (home screen)` : base;
}
