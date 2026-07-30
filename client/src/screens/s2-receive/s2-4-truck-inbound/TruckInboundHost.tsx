// The half of S2.4 that listens, and the reason it lives here rather than in `app/`.
//
// The banner is a device-level surface, not a screen: it fires "regardless of who,
// if anyone, is logged in" (`ui-ux-spec.md` S2.4, PRD §2), so the router never
// resolves it and the shell mounts it beside the offline banner instead. But `app/`
// must not import from `screens/` — the shell takes its screens as a prop from
// `main.tsx` precisely so the dependency runs one way — so this container is
// injected the same way `useUnreadCount` is, and the knowledge of what a
// truck-inbound message looks like stays in the folder that owns S2.4.
//
// Everything here is wiring; the rules are in `truck-inbound.ts` and tested there.

import { useCallback, useEffect, useState } from 'react';
import { onServiceWorkerAlert } from '../../../pwa/index.ts';
import { TruckInboundBanner } from './TruckInboundBanner.tsx';
import {
  armTruckInboundSound,
  currentTruckInbound,
  dismissTruckInbound,
  EMPTY_TRUCK_INBOUND_STATE,
  parseTruckInboundMessage,
  queuedTruckInbound,
  receiveTruckInbound,
  type TruckInboundState,
} from './truck-inbound.ts';

export function TruckInboundHost() {
  const [state, setState] = useState<TruckInboundState>(EMPTY_TRUCK_INBOUND_STATE);

  useEffect(
    () =>
      onServiceWorkerAlert((message) => {
        const alert = parseTruckInboundMessage(message);
        if (alert === null) return;
        // Queued, not replaced: the pantry runs several routes a day and
        // `completePickup` fans out per device, so two trucks can be heading back
        // at once and the second must not silently overwrite the first.
        setState((current) => receiveTruckInbound(current, alert));
      }),
    [],
  );

  // Browsers hold audio until the document has been interacted with, and a dock
  // tablet may not have been touched since it was unlocked. The first tap anywhere
  // is what unlocks the chime — there is no way to ask for it in advance, and a
  // chime that cannot play is never surfaced as an error.
  useEffect(() => {
    const arm = () => armTruckInboundSound();
    window.addEventListener('pointerdown', arm, { once: true });
    window.addEventListener('keydown', arm, { once: true });
    return () => {
      window.removeEventListener('pointerdown', arm);
      window.removeEventListener('keydown', arm);
    };
  }, []);

  const dismiss = useCallback((id: string) => {
    setState((current) => dismissTruckInbound(current, id));
  }, []);

  return (
    <TruckInboundBanner
      alert={currentTruckInbound(state)}
      onDismiss={dismiss}
      queued={queuedTruckInbound(state)}
    />
  );
}
