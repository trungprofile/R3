// S2.4 truck-inbound alert — the banner itself.
//
// `ui-ux-spec.md S2.4`: "full-width banner at top + sound … Dismiss is large. Does
// not require login to show. If someone is mid-weighing, it banners above without
// stealing the keypad."
//
// THE LAST CLAUSE IS THE DESIGN. This is not a modal and must never become one:
//   - no scrim, so nothing below it is dimmed or swallowed
//   - no focus trap and no autofocus, so a receiver mid-number keeps their caret
//   - it sits ABOVE the page rather than inside it, so nothing reflows under a
//     thumb that was already moving toward a keypad key
// A blocking dialog here would interrupt exactly the task the alert is telling
// them to hurry up and finish.
//
// It takes its alert as a prop and owns no delivery. The device-scoped alert
// arrives through the service worker, which this lane does not own — see
// `truck-inbound.ts` and the wave report for the wiring the shell adds.
//
// Canonical surface is the shared tablet in landscape; it needs no phone layout,
// and the row simply wraps if it is ever narrower than the text (§ responsive
// matrix: weight entry is n/a on phone).

import { useEffect } from 'react';
import { Button } from '../../../components/index.ts';
import {
  TRUCK_INBOUND_COPY,
  playTruckInboundChime,
  queuedLabel,
  truckInboundBody,
  truckInboundDetail,
} from './truck-inbound.ts';
import type { TruckInboundAlert } from './truck-inbound.ts';
import './truck-inbound.css';

export interface TruckInboundBannerProps {
  /** The alert on screen, or null for no banner. */
  alert: TruckInboundAlert | null;
  /** Large Dismiss. Takes the id so dismissing the visible one cannot clear a
   *  later arrival that slipped in behind it. */
  onDismiss: (id: string) => void;
  /** How many more are waiting. Shown only above zero. */
  queued?: number;
  /**
   * The sound. Defaults to the built-in chime; pass `null` to render silently.
   *
   * A chime that cannot play is not an error and is never surfaced: browsers hold
   * audio until the document has been interacted with, and a dock tablet may not
   * have been touched since it was unlocked. `armTruckInboundSound()` from the
   * first tap anywhere is the fix, and it belongs to whoever owns the shell.
   */
  playSound?: (() => void) | null;
}

export function TruckInboundBanner({
  alert,
  onDismiss,
  queued = 0,
  playSound,
}: TruckInboundBannerProps) {
  const alertId = alert?.id ?? null;

  useEffect(() => {
    if (alertId === null) return;
    if (playSound === null) return;
    if (playSound !== undefined) {
      playSound();
      return;
    }
    // Best-effort and self-swallowing: `playTruckInboundChime` resolves with what
    // happened rather than throwing, and nothing on screen depends on it.
    void playTruckInboundChime();
    // Keyed on the id so a second truck chimes again and a re-render does not.
  }, [alertId, playSound]);

  if (alert === null) return null;

  const detail = truckInboundDetail(alert);
  const more = queuedLabel(queued);

  return (
    // `role="alert"` announces it without moving focus — the receiver keeps their
    // place in the keypad, which is the whole point of not being a dialog.
    <div className="r3-inbound" role="alert" aria-label={TRUCK_INBOUND_COPY.regionLabel}>
      <div className="r3-inbound__text">
        <p className="r3-inbound__title">{TRUCK_INBOUND_COPY.title}</p>
        <p className="r3-inbound__body">{truckInboundBody(alert)}</p>
        {detail ? <p className="r3-inbound__detail">{detail}</p> : null}
        {more ? <p className="r3-inbound__more">{more}</p> : null}
      </div>
      <div className="r3-inbound__action">
        <Button variant="secondary" onClick={() => onDismiss(alert.id)}>
          {TRUCK_INBOUND_COPY.dismiss}
        </Button>
      </div>
    </div>
  );
}
