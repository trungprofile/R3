// One stop, as a big check-off row (§3's row contract, grown into a card because
// S1.5 hangs several things off each stop: store, address, a photo of the door,
// a map link, the store's permanent note, and the driver's note for the pantry).
//
// ONE CARD IS OPEN AT A TIME. The head is always a row; the rest appears only
// when the stop is expanded, which by default is the current stop and only the
// current stop (`isStopExpanded`). S1.5 is a full-screen takeover held in one
// hand outdoors, and a driver standing in one store's car park scrolling past
// four other stores' notes is reading the wrong screen. Nothing about resolution
// changes: every stop is still in the list, still in order, still one tap from
// every action it had.
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
import { ChevronRightIcon, ImageIcon, PinIcon } from '../../../components/icons.tsx';
import type { RunStopSummary } from '../../../api/shared.ts';
import {
  COPY,
  canEditNote,
  canResolve,
  mapLinkFor,
  photoAlt,
  photoUrlFor,
  stopToggleLabel,
  type StopPlace,
} from './logic.ts';
import { StopStatusChip } from './StopStatusChip.tsx';

export interface StopCardProps {
  stop: RunStopSummary;
  /** 1-based, as shown. `position` is 0-based and is the server's business. */
  number: number;
  focused: boolean;
  /** Presentation only. Collapsed hides the body, never the stop. */
  expanded: boolean;
  busy: boolean;
  /** The map link and the photo flag, joined in from the donor list (D20). */
  place: StopPlace;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onToggle: () => void;
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
  expanded,
  busy,
  place,
  canMoveUp,
  canMoveDown,
  onToggle,
  onCollect,
  onSkip,
  onMove,
  onSaveNote,
}: StopCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(stop.note ?? '');
  const [saving, setSaving] = useState(false);
  // A photo that 404s or arrives corrupt leaves an empty box with no explanation,
  // which on a phone in a car park reads as "the app is broken". Swapped for a
  // labelled placeholder instead.
  const [photoBroken, setPhotoBroken] = useState(false);

  // A reorder or a check-off replaces the row; keep the field on the saved value.
  useEffect(() => {
    setDraft(stop.note ?? '');
  }, [stop.note]);

  const moved = stop.disposition === 'REASSIGNED';
  const classes = ['r3-stop'];
  if (focused) classes.push('r3-stop--focus');
  if (moved) classes.push('r3-stop--moved');
  if (expanded) classes.push('r3-stop--open');
  if (stop.disposition === 'COLLECTED' || stop.disposition === 'SKIPPED') {
    classes.push('r3-stop--done');
  }

  const mapLink = mapLinkFor(place);

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
      {/* The whole head is the target, so a gloved thumb aims at a 56px row and
          not at a chevron. The chevron is never the only label (§3): the row says
          the store's name and what happened to it, and the button says what
          tapping does. */}
      <button
        type="button"
        className="r3-stop__head"
        aria-expanded={expanded}
        aria-label={stopToggleLabel(stop, expanded)}
        onClick={onToggle}
      >
        <span className="r3-stop__number" aria-hidden="true">
          {number}
        </span>
        <span className="r3-stop__name">{stop.donorName}</span>
        {/* §3's status pill, not grey text: "what is left" is the question this
            list answers, and a to-do stop has to win the row at a glance. The
            word is inside the chip, so colour is never the only signal (§2). */}
        <span className="r3-stop__status">
          <StopStatusChip disposition={stop.disposition} />
        </span>
        <ChevronRightIcon className="r3-stop__chevron" size="1.25em" />
      </button>

      {expanded ? (
        <div className="r3-stop__body">
          {/* A photo of the door answers "which of these six entrances" faster
              than an address does (D20). Only fetched when one exists: the flag
              rides on the donor list and the bytes are their own endpoint, so a
              storeless run costs no image requests at all. */}
          {place.hasPhoto ? (
            photoBroken ? (
              <p className="r3-stop__photo-missing">
                <ImageIcon size="1.25em" /> {COPY.photoUnavailable}
              </p>
            ) : (
              <img
                className="r3-stop__photo"
                src={photoUrlFor(stop.donorId)}
                alt={photoAlt(stop)}
                loading="lazy"
                onError={() => setPhotoBroken(true)}
              />
            )
          ) : null}

          {/* Donor address is operational data a driver needs, never PII —
              `pii.ts` gates people, not places. */}
          {stop.donorAddress ? <p className="r3-stop__address">{stop.donorAddress}</p> : null}

          {/* Leaves R3 for whichever map app the phone owns. A pin plus the words,
              never the pin alone (§3), and a full-width row so it clears the 44px
              floor without a hover state to discover it by. */}
          {mapLink ? (
            <a
              className="r3-stop__map"
              href={mapLink}
              target="_blank"
              rel="noreferrer"
            >
              <PinIcon size="1.25em" />
              <span>{COPY.openInMaps}</span>
            </a>
          ) : null}

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
        </div>
      ) : null}
    </li>
  );
}
