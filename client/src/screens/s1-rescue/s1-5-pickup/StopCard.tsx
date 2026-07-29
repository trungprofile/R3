// One stop, as a big check-off row (§3's row contract, grown into a card because
// S1.5 hangs four things off each stop: store, address, the store's permanent
// note, and the driver's note for the pantry).
//
// The next unchecked stop is the focus — an orange bar and the screen's one
// primary button (§1.1, §2: orange is fill-or-accent, never text).
//
// Ordering is two big buttons rather than a drag handle. S1.5 says "drag handle,
// large", but HTML drag-and-drop does not fire on touch and a hand-rolled touch
// drag is exactly the "fragile control" §1.5 rules out — while a library is a
// dependency this lane may not add (build-plan §3). Move up / move down keeps
// one-handed use, keeps the 44px floor, and works for a screen reader. Recorded
// under `Assumed:`.

import { useEffect, useState } from 'react';
import { Button, TextInput } from '../../../components/index.ts';
import type { RunStopSummary } from '../../../api/shared.ts';
import { COPY, canEditNote, canResolve, stopStatusLabel } from './logic.ts';

export interface StopCardProps {
  stop: RunStopSummary;
  /** 1-based, as shown. `position` is 0-based and is the server's business. */
  number: number;
  focused: boolean;
  busy: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onCollect: () => void;
  onSkip: () => void;
  onMove: (delta: -1 | 1) => void;
  /** Resolves true when the note reached the server, so the editor stays open on
   *  a failure instead of pretending it saved. */
  onSaveNote: (note: string | null) => Promise<boolean>;
}

export function StopCard({
  stop,
  number,
  focused,
  busy,
  canMoveUp,
  canMoveDown,
  onCollect,
  onSkip,
  onMove,
  onSaveNote,
}: StopCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(stop.note ?? '');
  const [saving, setSaving] = useState(false);

  // A reorder or a check-off replaces the row; keep the field on the saved value.
  useEffect(() => {
    setDraft(stop.note ?? '');
  }, [stop.note]);

  const moved = stop.disposition === 'REASSIGNED';
  const classes = ['r3-stop'];
  if (focused) classes.push('r3-stop--focus');
  if (moved) classes.push('r3-stop--moved');
  if (stop.disposition === 'COLLECTED' || stop.disposition === 'SKIPPED') {
    classes.push('r3-stop--done');
  }

  const save = async () => {
    setSaving(true);
    try {
      const trimmed = draft.trim();
      if (await onSaveNote(trimmed === '' ? null : trimmed)) setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <li className={classes.join(' ')}>
      <div className="r3-stop__head">
        <span className="r3-stop__number" aria-hidden="true">
          {number}
        </span>
        <span className="r3-stop__name">{stop.donorName}</span>
        <span className="r3-stop__status">{stopStatusLabel(stop.disposition)}</span>
      </div>

      {/* Donor address is operational data a driver needs, never PII — `pii.ts`
          gates people, not places. */}
      {stop.donorAddress ? <p className="r3-stop__address">{stop.donorAddress}</p> : null}

      {stop.donorNote ? (
        <p className="r3-stop__store-note">
          <span className="r3-pickup__label">{COPY.storeNoteLabel}</span> {stop.donorNote}
        </p>
      ) : null}

      {moved ? <p className="r3-stop__hint">{COPY.movedHint}</p> : null}

      {!moved && !editing && stop.note ? (
        <p className="r3-stop__note">
          <span className="r3-pickup__label">{COPY.stopNoteLabel}</span> {stop.note}
        </p>
      ) : null}

      {canEditNote(stop) ? (
        editing ? (
          <div className="r3-stop__note-editor">
            <TextInput
              label={COPY.stopNoteLabel}
              value={draft}
              onChange={setDraft}
              multiline
              disabled={saving}
            />
            <div className="r3-stop__actions">
              <Button variant="secondary" loading={saving} onClick={() => void save()}>
                {COPY.saveNote}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setDraft(stop.note ?? '');
                  setEditing(false);
                }}
              >
                {COPY.cancel}
              </Button>
            </div>
          </div>
        ) : (
          <div className="r3-stop__actions">
            <Button variant="secondary" onClick={() => setEditing(true)}>
              {stop.note ? COPY.editStopNote : COPY.addStopNote}
            </Button>
          </div>
        )
      ) : null}

      {canResolve(stop) ? (
        <div className="r3-stop__actions r3-stop__actions--resolve">
          <Button
            variant={focused ? 'primary' : 'secondary'}
            block
            loading={busy}
            onClick={onCollect}
          >
            {COPY.pickedUp}
          </Button>
          <Button variant="secondary" block disabled={busy} onClick={onSkip}>
            {COPY.skip}
          </Button>
        </div>
      ) : null}

      {canMoveUp || canMoveDown ? (
        <div className="r3-stop__actions r3-stop__actions--order">
          {canMoveUp ? (
            <Button
              variant="secondary"
              onClick={() => onMove(-1)}
              aria-label={`${COPY.moveUp}: ${stop.donorName}`}
            >
              {COPY.moveUp}
            </Button>
          ) : null}
          {canMoveDown ? (
            <Button
              variant="secondary"
              onClick={() => onMove(1)}
              aria-label={`${COPY.moveDown}: ${stop.donorName}`}
            >
              {COPY.moveDown}
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
