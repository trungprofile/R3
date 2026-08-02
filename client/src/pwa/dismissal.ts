// What the user has already waved away, remembered per browser.
//
// §5 says the guide appears on "first visit" — so something has to remember that a
// visit happened. It is browser-local rather than server state on purpose: no table
// holds it (`server/migrations/` is lead-owned, build-plan §3), it is per-BROWSER
// rather than per-person (the same volunteer on a new phone should see the guide
// again), and losing it costs one dismissible card.
//
// A dismissal is never a dead end. §5 keeps the chip visible with "Alerts OFF, tap
// to fix", and tapping it clears this and re-walks the flow.

import type { OnboardingStep } from './onboarding.ts';

const KEY = 'r3.alerts.dismissed';

/** The two methods this needs, so a test can pass a plain object. */
export interface DismissalStore {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

/** Safari in private browsing throws on `localStorage`, and a card that cannot be
 *  dismissed is worse than one that reappears. Every access is guarded. */
export function browserStore(): DismissalStore | null {
  try {
    const store = window.localStorage;
    const probe = `${KEY}.probe`;
    store.setItem(probe, '1');
    store.removeItem(probe);
    return store;
  } catch {
    return null;
  }
}

export function readDismissed(store: DismissalStore | null): OnboardingStep[] {
  if (!store) return [];
  try {
    const raw = store.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed.filter((v) => typeof v === 'string') as OnboardingStep[]) : [];
  } catch {
    return [];
  }
}

export function rememberDismissed(
  store: DismissalStore | null,
  step: OnboardingStep,
): OnboardingStep[] {
  const next = [...new Set([...readDismissed(store), step])];
  try {
    store?.setItem(KEY, JSON.stringify(next));
  } catch {
    // Nothing to do and nothing to say: the card reappears next visit.
  }
  return next;
}

/** What the chip's "tap to fix" does first — the user asked for the flow back. */
export function clearDismissed(store: DismissalStore | null): OnboardingStep[] {
  try {
    store?.removeItem(KEY);
  } catch {
    // As above.
  }
  return [];
}
