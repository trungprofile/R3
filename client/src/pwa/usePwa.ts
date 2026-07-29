// The onboarding flow as the shell sees it: one hook, three answers.
//
//   alertsEnabled  -> the §5 chip in the top bar. `undefined` until known, which is
//                     how `TopBar` knows to render no chip yet rather than a wrong one.
//   step           -> which §5 card to show, if any (`onboarding.ts` decides).
//   fix            -> what the chip's "tap to fix" does.
//
// Everything the browser is asked is asked again on demand, never remembered: a
// permission can be revoked in browser settings while the app is open, and a stale
// "Alerts ON" is the one thing §5's chip exists to prevent.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  enableAlerts,
  readAlertsState,
  syncRegistration,
  type AlertsState,
  type EnableOutcome,
} from './alerts.ts';
import {
  browserStore,
  clearDismissed,
  readDismissed,
  rememberDismissed,
  type DismissalStore,
} from './dismissal.ts';
import { alertsAreOn, visibleStep, type OnboardingStep } from './onboarding.ts';
import {
  installPromptAvailable,
  registerServiceWorker,
  showInstallPrompt,
  subscribeToInstallPrompt,
} from './serviceWorker.ts';

export interface PwaValue {
  /** For `TopBar`'s chip. Undefined while the browser has not answered yet. */
  alertsEnabled: boolean | undefined;
  /** The §5 card to render, or `none`. */
  step: OnboardingStep;
  /** A one-tap install is available (Chromium only). */
  canPromptInstall: boolean;
  /** A tap is in flight; the card's action shows it rather than firing twice. */
  busy: boolean;
  /** Non-null after a tap that did not end with alerts on. */
  outcome: EnableOutcome | null;
  enable: () => Promise<void>;
  install: () => Promise<void>;
  dismiss: () => void;
  /** The chip's "tap to fix": clear every dismissal and walk the flow again. */
  fix: () => Promise<void>;
}

export function usePwa(active: boolean): PwaValue {
  const [state, setState] = useState<AlertsState | null>(null);
  const [dismissed, setDismissed] = useState<OnboardingStep[]>([]);
  const [canPromptInstall, setCanPromptInstall] = useState(installPromptAvailable);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<EnableOutcome | null>(null);
  const store = useRef<DismissalStore | null>(null);

  const refresh = useCallback(async () => {
    setState(await readAlertsState());
  }, []);

  useEffect(() => {
    // Nothing runs before someone is signed in: registering for alerts requires a
    // session (the routes declare `{ tier: 'VOLUNTEER' }`), and §5 puts onboarding
    // after login. The login screen stays a login screen.
    if (!active) return;
    let cancelled = false;

    store.current = browserStore();
    setDismissed(readDismissed(store.current));

    void (async () => {
      // Register the worker up front: it is what an alert is delivered to, and it
      // is push only — never cache-first (`architecture.md §4.5`).
      await registerServiceWorker();
      // Re-offer an existing registration the server may never have received.
      // Silent, and a no-op unless permission is already granted.
      await syncRegistration();
      if (!cancelled) await refresh();
    })();

    return () => {
      cancelled = true;
    };
  }, [active, refresh]);

  useEffect(() => subscribeToInstallPrompt(() => setCanPromptInstall(installPromptAvailable())), []);

  // A browser that comes back to the foreground may have had its permission
  // changed in settings while R3 sat there. Cheap to re-ask, and the alternative
  // is a chip that lies until the next reload.
  useEffect(() => {
    if (!active) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [active, refresh]);

  const enable = useCallback(async () => {
    setBusy(true);
    try {
      const result = await enableAlerts();
      setOutcome(result === 'on' ? null : result);
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const install = useCallback(async () => {
    setBusy(true);
    try {
      const installed = await showInstallPrompt();
      setCanPromptInstall(installPromptAvailable());
      // An accepted install changes what the flow should offer next — on iOS it is
      // the difference between "you cannot have alerts" and "turn them on".
      if (installed) await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const step = useMemo<OnboardingStep>(
    () => (state ? visibleStep(state, dismissed) : 'none'),
    [state, dismissed],
  );

  const dismiss = useCallback(() => {
    if (step === 'none') return;
    setDismissed(rememberDismissed(store.current, step));
  }, [step]);

  const fix = useCallback(async () => {
    setDismissed(clearDismissed(store.current));
    setOutcome(null);
    // Straight into the permission flow in the same tap — §5's "Tapping re-walks
    // the permission flow". Awaiting anything first would break the user-gesture
    // chain `Notification.requestPermission()` requires; on a browser that cannot
    // do alerts this returns immediately and the card explains why.
    await enable();
  }, [enable]);

  return {
    alertsEnabled: state ? alertsAreOn(state) : undefined,
    step,
    canPromptInstall,
    busy,
    outcome,
    enable,
    install,
    dismiss,
    fix,
  };
}
