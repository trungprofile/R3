// One run as a LARGE card — `D38`'s first band, and the visual centre of S2.1b.
//
// Same run, same words, same target as `RunCard`; only the shape differs. The band
// is what carries the meaning ("still to weigh"), so the tile must not restate it —
// what it buys is size: a receiver holding a crate at the counter aims at a roughly
// square card rather than at one row among a dozen identical ones, which is the
// complaint `D38` came from.
//
// Not `components/ListRow.tsx`, because this is not a row and dressing one up as a
// square would change the row contract for every screen that uses it (§3). It is
// built from the same pieces the Home hub's cards are (`D22`): the whole card is
// the target, never a link inside it.

import { StopDots } from './RunCard.tsx';
import type { RunCardProps } from './RunCard.tsx';
import { COPY } from './run-picker.ts';

export function RunTile({ card, busy, onOpen }: RunCardProps) {
  const body = (
    <>
      <span className="s21b-tile__head">
        <span className="s21b-tile__label">{card.label}</span>
        <span className="s21b-tile__subtitle">{card.subtitle}</span>
      </span>

      <StopDots stops={card.stops} />

      <span className="s21b-tile__foot">
        <span className="s21b-tile__count">{card.count}</span>
        {card.actionLabel === '' ? null : (
          <span className="s21b-tile__go">
            {card.action === 'RECEIVE_DONE' ? `${COPY.receiveDoneHint}, ` : ''}
            {card.actionLabel}
          </span>
        )}
      </span>
    </>
  );

  // A run with no stops is information only. `ListRow` renders a static row in that
  // case and this does the same: §3 prefers hiding an action over disabling one, and
  // a card that cannot be tapped should not look like one that can.
  if (!card.target) {
    return (
      <div className="s21b-tile s21b-tile--static" aria-label={card.ariaLabel}>
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      className="s21b-tile"
      aria-label={card.ariaLabel}
      disabled={busy}
      onClick={onOpen}
    >
      {body}
    </button>
  );
}
