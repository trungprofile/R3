// The persistent stop-status strip — S2.2's "Stops: Sam's✓ · Kroger● · Aldi●".
//
// It is the stop picker as well as the status line: tapping a store switches the
// sheet to it, which is how a receiver moves between the stores on one run
// (S2.1b, "tapping a stop within S2.2 is how the receiver navigates"). §1.5 rules
// out a dropdown for exactly this — every stop is visible and one tap away.
//
// The strip never navigates on its own. It reports the tap; the screen decides,
// because a number left on the keypad has to be warned about first (S2.2 edge).

import type { ReceiveStopSummary } from '../../../api/shared.ts';
import { COPY, orderedStops, progressLabel, stopStateLabel, stopStateMark } from './weight-entry.ts';

export interface StopStripProps {
  stops: readonly ReceiveStopSummary[];
  currentStopId: string;
  onPick: (stopId: string) => void;
}

export function StopStrip({ stops, currentStopId, onPick }: StopStripProps) {
  if (stops.length === 0) return null;

  return (
    <nav className="r3-strip" aria-label={COPY.stopsLabel}>
      <ul className="r3-strip__list">
        {orderedStops(stops).map((stop) => {
          const current = stop.id === currentStopId;
          const classes = ['r3-strip__stop'];
          if (current) classes.push('r3-strip__stop--current');
          if (stop.state === 'WEIGHED') classes.push('r3-strip__stop--weighed');
          if (stop.state === 'SKIPPED' || stop.state === 'REASSIGNED') {
            classes.push('r3-strip__stop--closed');
          }

          return (
            <li key={stop.id}>
              <button
                type="button"
                className={classes.join(' ')}
                // The strip is a set of destinations, not a form control: the
                // current one is announced, and it is still tappable so a
                // re-tap is a harmless no-op rather than a dead target.
                aria-current={current ? 'true' : undefined}
                onClick={() => onPick(stop.id)}
              >
                <span className="r3-strip__name">{stop.donorName}</span>
                <span className="r3-strip__mark" aria-hidden="true">
                  {stopStateMark(stop.state)}
                </span>
                <span className="r3-strip__state">{stopStateLabel(stop.state)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="r3-strip__progress">{progressLabel(stops)}</p>
    </nav>
  );
}
