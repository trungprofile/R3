// One category tile — a column of the paper sheet.
//
// S2.2: the tile is a big target that selects the category, carries the LIVE
// subtotal (this is the hand arithmetic the screen exists to kill), and lists the
// numbers under it "gapless, no line #s" — the log had no line numbers and the
// receiver counts nothing.
//
// The tiles render from `detail.tiles`, which is live active-category data
// (S1.8), never a list of the 11 AGFP names written into the client. A category
// the admin adds appears here without a deploy; one they archive stops being
// offered while its numbers keep showing.
//
// Tapping a number is the ✎ overwrite. It is a plain edit and says nothing about
// how it is stored (I13 is the server's business, §6).

import type { CategoryTile as CategoryTileData, WeightEntrySummary } from '../../../api/shared.ts';
import { COPY, formatPounds, formatWeight } from './weight-entry.ts';

export interface CategoryTileProps {
  tile: CategoryTileData;
  selected: boolean;
  /** The entry being overwritten right now, if it is one of this tile's. */
  editingEntryId: string | null;
  /** A skipped or moved stop shows its numbers and takes no new ones. */
  open: boolean;
  onSelect: () => void;
  onEditEntry: (entry: WeightEntrySummary) => void;
}

export function CategoryTile({
  tile,
  selected,
  editingEntryId,
  open,
  onSelect,
  onEditEntry,
}: CategoryTileProps) {
  const classes = ['r3-tile'];
  if (selected) classes.push('r3-tile--selected');
  if (!open) classes.push('r3-tile--closed');

  return (
    <li className={classes.join(' ')}>
      <button
        type="button"
        className="r3-tile__pick"
        // A toggle in a set where one is chosen: `aria-pressed` says which,
        // without claiming this is a tab (it switches nothing).
        aria-pressed={selected}
        disabled={!open}
        onClick={onSelect}
      >
        <span className="r3-tile__name">{tile.categoryName}</span>
        <span className="r3-tile__subtotal">{formatPounds(tile.subtotal)}</span>
      </button>

      {tile.entries.length > 0 ? (
        <ul className="r3-tile__entries" aria-label={`${tile.categoryName} weights`}>
          {tile.entries.map((entry) => {
            const editing = entry.id === editingEntryId;
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  className={`r3-entry${editing ? ' r3-entry--editing' : ''}`}
                  disabled={!open}
                  // The visible text is the number alone (paper-parity); the
                  // label spells out what tapping it does and who logged it,
                  // which is attribution the sheet always carried (cap 14).
                  aria-label={`${COPY.editingLabel} ${formatPounds(entry.weight)}, ${tile.categoryName}, ${entry.createdByName}`}
                  onClick={() => onEditEntry(entry)}
                >
                  <span className="r3-entry__weight">{formatWeight(entry.weight)}</span>
                  <span className="r3-entry__pencil" aria-hidden="true">
                    ✎
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}
