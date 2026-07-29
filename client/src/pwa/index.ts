// Install + alerts onboarding (`ui-ux-spec.md §5`, PRD cap 13), in one import.
//
// The shell needs three things from here and the rest is internal: the hook, the
// card, and the service-worker navigation listener that makes a tapped alert land
// on the right screen.

export { usePwa } from './usePwa.ts';
export type { PwaValue } from './usePwa.ts';

export { OnboardingCard } from './Onboarding.tsx';
export type { OnboardingCardProps } from './Onboarding.tsx';

export {
  linkManifest,
  onServiceWorkerNavigate,
  registerServiceWorker,
  watchForInstallPrompt,
  SERVICE_WORKER_URL,
  MANIFEST_URL,
} from './serviceWorker.ts';

export { enableAlerts, readAlertsState, syncRegistration } from './alerts.ts';
export type { AlertsState, EnableOutcome } from './alerts.ts';

export { alertsAreOn, visibleStep, COPY, FORBIDDEN_IN_COPY } from './onboarding.ts';
export type { AlertsPermission, OnboardingInput, OnboardingStep, Platform } from './onboarding.ts';

export { detectInstalled, detectPlatform, deviceLabel, readBrowser } from './platform.ts';
