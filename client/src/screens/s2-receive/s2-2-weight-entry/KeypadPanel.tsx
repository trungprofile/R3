// The bottom band of S2.2: what is selected, what is typed, the big keypad, and
// the two things that end a stop.
//
// Numeric input is ALWAYS this keypad and never the system keyboard (§1.5,
// §3) — there is no text field on this screen to focus, so a keyboard cannot
// appear. `NumericKeypad` already ships the decimal point S2.2 needs for scale
// reads and keys of at least 64px; the screen owns the digits so it can show them
// big and tabular.
//
// The typed value is a STRING the whole way (A165). It is displayed as typed and
// sent as typed; nothing on this screen turns a scale reading into a JS number.

import type { ReactNode } from 'react';

import { Button, NumericKeypad } from '../../../components/index.ts';
import type { CategoryTile, ReceiveStopDetail } from '../../../api/shared.ts';
import {
  COPY,
  KEYPAD_MAX_DIGITS,
  canAddWeight,
  canSkipStop,
  formatPounds,
  hasWeights,
} from './weight-entry.ts';

/** The one number being overwritten, while it is being overwritten. */
export interface EditingEntry {
  entryId: string;
  categoryName: string;
  /** Shown so the receiver sees what they are replacing (§6). */
  priorWeight: string;
}

export interface KeypadPanelProps {
  detail: ReceiveStopDetail;
  selectedTile: CategoryTile | null;
  entry: string;
  onEntryChange: (next: string) => void;
  editing: EditingEntry | null;
  busy: boolean;
  onAdd: () => void;
  onSave: () => void;
  onCancelEdit: () => void;
  onRemove: () => void;
  onAdvance: () => void;
  onSkip: () => void;
  /** The stop's notes, rendered at the FOOT of the actions column so they fill
   *  the space beside the keypad instead of sitting under both columns. The
   *  screen owns them; this panel owns only where they land, because only it
   *  knows where the keypad's bottom edge is. */
  notes?: ReactNode;
}

export function KeypadPanel({
  detail,
  selectedTile,
  entry,
  onEntryChange,
  editing,
  busy,
  onAdd,
  onSave,
  onCancelEdit,
  onRemove,
  onAdvance,
  onSkip,
  notes,
}: KeypadPanelProps) {
  const weighed = hasWeights(detail);
  const ready = canAddWeight(entry);
  const target = editing ? editing.categoryName : (selectedTile?.categoryName ?? null);

  return (
    <section className="r3-pad" aria-label={COPY.entryLabel}>
      {/* "Selected: Produce    entry: [ 5 1 6 ] lb" — one line across the band,
          as S2.2 draws it. */}
      <div className="r3-pad__line">
        <p className="r3-pad__selected">
          <span className="r3-pad__label">{editing ? COPY.editingLabel : COPY.selectedLabel}</span>{' '}
          <strong>{target ?? COPY.pickCategory}</strong>
          {editing ? (
            <span className="r3-pad__prior">
              {' · '}
              {COPY.priorValueLabel} {formatPounds(editing.priorWeight)}
            </span>
          ) : null}
        </p>

        {/* The typed digits, big and tabular (§2). `aria-live` so the value is
            announced as it is keyed — there is no input to read back. */}
        <p className="r3-pad__entry" aria-live="polite">
          <span className="r3-pad__digits">{entry === '' ? '0' : entry}</span>
          <span className="r3-pad__unit">{COPY.unit}</span>
        </p>
      </div>

      <div className="r3-pad__keys">
        <NumericKeypad
          value={entry}
          onChange={onEntryChange}
          allowDecimal
          maxLength={KEYPAD_MAX_DIGITS}
          ariaLabel={COPY.keypadLabel}
          disabled={busy}
        />
      </div>

      <div className="r3-pad__actions">
        {editing ? (
          <>
            <Button variant="primary" block loading={busy} disabled={!ready} onClick={onSave}>
              {COPY.saveWeight}
            </Button>
            <div className="r3-pad__row">
              <Button variant="secondary" onClick={onCancelEdit} disabled={busy}>
                {COPY.cancelEdit}
              </Button>
              <Button variant="danger" onClick={onRemove} disabled={busy}>
                {COPY.removeWeight}
              </Button>
            </div>
          </>
        ) : (
          <Button
            variant="primary"
            block
            loading={busy}
            // Disabled rather than hidden: it is the anchor of the screen, and a
            // button that vanished between weights would move everything under
            // the hand of the person using it (§3 prefers hiding, but not for
            // the one control the whole task runs through).
            disabled={!ready || selectedTile === null}
            onClick={onAdd}
          >
            {COPY.addWeight}
          </Button>
        )}

        <p className="r3-pad__total">
          <span className="r3-pad__label">{COPY.stopTotalLabel}</span>
          <strong className="r3-pad__total-value">{formatPounds(detail.stopTotal)}</strong>
        </p>

        <div className="r3-pad__row">
          {/* Resolves nothing — any non-voided weight already made this stop
              WEIGHED (I12). It is the way on to the next store.

              `D37` cut the label to the verb; the stop's name is in the header and
              its total is directly above, so the button does not repeat them. The
              aria label carries the noun for anyone who meets the button without
              that context. */}
          <Button
            variant="secondary"
            aria-label={COPY.markWeighedAria}
            onClick={onAdvance}
            disabled={busy || !weighed}
          >
            {COPY.markWeighed}
          </Button>
          {canSkipStop(detail) ? (
            <Button
              variant="secondary"
              aria-label={COPY.skipStopAria}
              onClick={onSkip}
              disabled={busy}
            >
              {COPY.skipStop}
            </Button>
          ) : null}
        </div>
        {weighed ? null : <p className="r3-pad__hint">{COPY.markWeighedHint}</p>}
        {notes}
      </div>
    </section>
  );
}

/** The panel's read-only twin, for a stop that is skipped or moved: the numbers
 *  and the total, no keypad, and the way on to the next stop. */
export function ClosedPanel({
  detail,
  busy,
  onAdvance,
  notes,
}: {
  detail: ReceiveStopDetail;
  busy: boolean;
  onAdvance: () => void;
  notes?: ReactNode;
}) {
  return (
    <section className="r3-pad r3-pad--closed" aria-label={COPY.stopTotalLabel}>
      <div className="r3-pad__actions">
        <p className="r3-pad__total">
          <span className="r3-pad__label">{COPY.stopTotalLabel}</span>
          <strong className="r3-pad__total-value">{formatPounds(detail.stopTotal)}</strong>
        </p>
        <Button variant="primary" block onClick={onAdvance} disabled={busy}>
          {COPY.nextStop}
        </Button>
        {notes}
      </div>
    </section>
  );
}
