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
import { COPY } from './run-picker.ts';
import type { RunCardView } from './run-picker.ts';

/** The stop strip: "Sam's ✓weighed · Kroger ●pending" (S2.1b). The glyph is
 *  decoration — the state WORD carries the meaning, so colour and shape are never
 *  the only signal (§1: big, clear, calm). */
function StopDots({ stops }: { stops: RunCardView['stops'] }) {
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
          {/* S2.2b's own name on the affordance that leads there, so the receiver
              meets the same two words twice rather than two wordings once. */}
          {card.action === 'RECEIVE_DONE' ? `${COPY.receiveDoneHint}, ` : ''}
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
        meta={<StopDots stops={card.stops} />}
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
