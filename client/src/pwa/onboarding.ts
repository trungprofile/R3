// The onboarding state machine and its copy — `ui-ux-spec.md §5`, PRD cap 13
// ("Guided, platform-aware install + permission onboarding is required").
//
// PURE ON PURPOSE. Nothing here touches `window`, `navigator` or the network: the
// whole decision is a function of a plain record, so the branch a user actually
// lands in is testable without a browser (there is no component test harness in
// this repo, and adding one would be a dependency — build-plan §3/D5).
//
// The shape of the flow, from §5:
//
//   phone, not installed  -> one card, "Add R3 to your home screen", with the
//                            2-step guide for THAT platform. iOS must install
//                            before alerts are possible at all, and says so.
//   after install         -> one prompt, "Turn on alerts…". One tap.
//   any state             -> the chip in the top bar says ON or "OFF, tap to fix",
//                            and tapping re-walks this flow.
//
// The app is fully usable with alerts off and THE COPY MUST NEVER IMPLY OTHERWISE
// (§5). Every card below therefore says where the same information already is: the
// inbox, which is the source of truth regardless of push (PRD channel strategy).

export type Platform = 'ios' | 'android' | 'other';

/** `Notification.permission`, plus the case where the browser has no such thing —
 *  iOS Safari in a tab, where the whole API is absent until installed. */
export type AlertsPermission = 'default' | 'granted' | 'denied' | 'unsupported';

export type OnboardingStep =
  | 'none'
  | 'install-ios'
  | 'install-android'
  | 'enable-alerts'
  | 'blocked';

export interface OnboardingInput {
  platform: Platform;
  /** Running from the home screen rather than a browser tab. */
  installed: boolean;
  /** The browser can register for alerts at all (worker + push + notifications). */
  alertsSupported: boolean;
  permission: AlertsPermission;
  /** This browser holds a registration the server has been told about. */
  registered: boolean;
  /** The box has a key to register against (`architecture.md §5.1`). Absent means
   *  alerts are unavailable for reasons no volunteer can act on. */
  keyConfigured: boolean;
}

/** What the chip reports. Permission alone is not enough: a granted permission with
 *  no registration delivers nothing, which is precisely the silent failure §5's chip
 *  exists to surface. */
export function alertsAreOn(input: OnboardingInput): boolean {
  return input.permission === 'granted' && input.registered;
}

/**
 * The one card to show right now, or `none`.
 *
 * `dismissed` is what the user has already waved away. Dismissal never blocks the
 * next stage: an Android user who skips the install guide still gets the alerts
 * prompt, because on Android alerts work without installing. On iOS they do not, so
 * a dismissed guide ends the flow — offering "turn on alerts" there would be
 * offering a button that cannot work.
 */
export function visibleStep(
  input: OnboardingInput,
  dismissed: readonly OnboardingStep[] = [],
): OnboardingStep {
  if (alertsAreOn(input)) return 'none';
  const waved = (step: OnboardingStep) => dismissed.includes(step);

  if (input.platform === 'ios' && !input.installed) {
    return waved('install-ios') ? 'none' : 'install-ios';
  }

  if (input.platform === 'android' && !input.installed && !waved('install-android')) {
    return 'install-android';
  }

  // A desktop browser with no push, or a box with no keys: nothing to ask for, so
  // ask for nothing. Nagging about a state the user cannot change would break §5's
  // "the app is fully usable with alerts off".
  if (!input.alertsSupported || !input.keyConfigured) return 'none';

  if (input.permission === 'denied') return waved('blocked') ? 'none' : 'blocked';

  return waved('enable-alerts') ? 'none' : 'enable-alerts';
}

// ---------------------------------------------------------------------------
// Copy (`ui-ux-spec.md §5` and §7: plain, short, second person; and none of §7's
// forbidden vocabulary — "PWA", "push subscription", "session", "payload",
// "endpoint", "atomic", "instance"). Kept beside the machine so a test can hold
// the copy to that list.
// ---------------------------------------------------------------------------

export interface StepCopy {
  title: string;
  /** Absent where the title already says it: §7's plain-and-short rule, and D21
   *  (a hint that only restates the control above it is deleted, not reworded). */
  body?: string;
  /** The platform's two steps, §5's "matching 2-step illustration". */
  steps?: [string, string];
  /** The one high-emphasis action (§1 principle 1), where the step has one. */
  action?: string;
  dismiss: string;
  /** Always present: the inbox is the source of truth, and the user is told so. */
  reassurance: string;
}

const INBOX_REASSURANCE = 'You can use R3 without alerts. Everything also lands in your inbox.';

export const COPY: Record<Exclude<OnboardingStep, 'none'>, StepCopy> = {
  'install-ios': {
    title: 'Add R3 to your home screen',
    body: 'It works like an app, and on an iPhone or iPad it is the only way R3 can alert you.',
    steps: [
      'Tap the Share button at the bottom of Safari.',
      'Scroll down, tap "Add to Home Screen", then tap Add.',
    ],
    dismiss: 'Not now',
    reassurance: INBOX_REASSURANCE,
  },
  'install-android': {
    title: 'Add R3 to your home screen',
    body: 'It works like an app, and it can alert you about open runs.',
    steps: [
      'Tap the menu button at the top right of your browser.',
      'Choose "Add to Home screen", then tap Add.',
    ],
    action: 'Add to home screen',
    dismiss: 'Not now',
    reassurance: INBOX_REASSURANCE,
  },
  'enable-alerts': {
    title: 'Turn on alerts',
    action: 'Turn on alerts',
    dismiss: 'Not now',
    reassurance: INBOX_REASSURANCE,
  },
  blocked: {
    // §6's error pattern: what happened + what to do. No code, ever.
    title: 'Alerts are blocked',
    body: 'Your browser is blocking alerts for R3. Allow them in your browser settings for this site, then try again.',
    action: 'Try again',
    dismiss: 'Not now',
    reassurance: INBOX_REASSURANCE,
  },
};

/** Words `ui-ux-spec.md §7` forbids on screen. Exported so the copy test and any
 *  later screen can hold themselves to the same list. */
export const FORBIDDEN_IN_COPY = [
  'pwa',
  'push subscription',
  'session',
  'payload',
  'endpoint',
  'atomic',
  'instance',
] as const;
