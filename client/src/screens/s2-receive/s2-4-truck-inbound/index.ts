// S2.4 Truck-inbound alert.
//
// Unlike every S1.x screen, this exports no screen component and gets no route:
// S2.4 is a DEVICE-LEVEL banner (`ui-ux-spec.md §4`, "Truck-inbound is a
// device-level banner … fires regardless of login"), so the shell mounts it beside
// the offline banner rather than the router resolving it. The lead owns that
// mount and the delivery wiring — see the wave report.
//
// The logic is exported alongside the component because the shell is the thing
// that has to hold the queue: an alert can arrive while any screen is open, or
// none.

export { TruckInboundBanner } from './TruckInboundBanner.tsx';
export type { TruckInboundBannerProps } from './TruckInboundBanner.tsx';

/** The listening half, injected into the shell from `main.tsx` — `app/` may not
 *  import from `screens/`, so the shell takes it as a prop the way it takes the
 *  screen registry. */
export { TruckInboundHost } from './TruckInboundHost.tsx';

export {
  EMPTY_TRUCK_INBOUND_STATE,
  MAX_QUEUED_ALERTS,
  TRUCK_INBOUND_COPY,
  TRUCK_INBOUND_EVENT,
  TRUCK_INBOUND_MESSAGE_TYPE,
  armTruckInboundSound,
  currentTruckInbound,
  dismissTruckInbound,
  parseTruckInboundMessage,
  playTruckInboundChime,
  queuedLabel,
  queuedTruckInbound,
  receiveTruckInbound,
  truckInboundBody,
  truckInboundDetail,
} from './truck-inbound.ts';
export type { ChimeOutcome, TruckInboundAlert, TruckInboundState } from './truck-inbound.ts';
