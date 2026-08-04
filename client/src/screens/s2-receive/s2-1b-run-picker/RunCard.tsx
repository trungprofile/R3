// One run, as one big tappable row (§3's big-list-row contract, which is what
// S2.1b's boxes are at tablet size).
//
// The whole row is the target — not a link inside it — so a volunteer wearing
// gloves at a counter has the full width to hit. That is `components/ListRow.tsx`
// and not a hand-rolled card: §3's contract is one component, and a screen growing
// its own row is how two screens end up with two different minimum heights.
//
// Everything inside `ListRow`'s slots is inline-level, because the component
// separates them with `<br>` inside spans. The dot strip is a flex `<span>` for
// that reason and not a `<ul>`.

import { ListItem, ListRow } from '../../../components/index.ts';
import type { RunCardView } from './run-picker.ts';

/** The stop strip: "Sam's ✓weighed · Kroger ●pending" (S2.1b). The glyph is
 *  decoration — the state WORD carries the meaning, so colour and shape are never
 *  the only signal (§1: big, clear, calm).
 *
 *  Exported for `RunTile` (`D38`): a run says the same thing about its stops in
 *  either treatment, and two copies of it would eventually say two things. */
export function StopDots({ stops }: { stops: RunCardView['stops'] }) {
  return (
    <span className="s21b-stops">
      {stops.map((stop) => (
        <span className={`s21b-stop s21b-stop--${stop.tone}`} key={stop.id}>
          <span className="s21b-stop__dot" aria-hidden="true" />
          <span className="s21b-stop__name">{stop.donorName}</span>
          <span className="s21b-stop__state">{stop.label}</span>
        </span>
      ))}
    </span>
  );
}

export interface RunCardProps {
  card: RunCardView;
  /** Waiting on the stop re-read that decides where the tap lands. */
  busy: boolean;
  onOpen: () => void;
}

export function RunCard({ card, busy, onOpen }: RunCardProps) {
  const side = (
    <span className="s21b-side">
      <span className="s21b-side__count">{card.count}</span>
      {card.actionLabel === '' ? null : (
        <span
          className={
            card.action === 'RECEIVE_DONE' ? 's21b-side__go s21b-side__go--done' : 's21b-side__go'
          }
        >
          {/* The label says what the tap DOES and nothing else. It used to be
              prefixed with "All stops done, " — a completed fact in front of an
              action, which read as "this run is already closed". */}
          {card.actionLabel}
        </span>
      )}
    </span>
  );

  return (
    <ListItem>
      <ListRow
        title={card.label}
        subtitle={card.subtitle}
        meta={
          <>
            <StopDots stops={card.stops} />
            {/* `D66` — why a lapsed run is here and what is still possible on it.
                Inside the row, not the band heading, because the heading names the
                group and this is the sentence that says the run is not stuck. */}
            {card.notice === null ? null : (
              <span className="s21b-notice">{card.notice}</span>
            )}
          </>
        }
        side={side}
        ariaLabel={card.ariaLabel}
        // A run with no stops is information only: `ListRow` renders a static row
        // when no handler is given, so there is no target to tap and nothing to
        // explain away. §3 prefers hiding an action over disabling one.
        {...(card.target && !busy ? { onClick: onOpen } : {})}
      />
    </ListItem>
  );
}
