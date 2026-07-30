// The three note channels S2.2 shows and the receiver authors none of.
//
//   stopNote   driver → receiver, this stop only (`ShiftStop.note`, cap 11
//              channel 2). Under the header, because it is about the crates in
//              front of them right now.
//   donorNote  the store's permanent note, set by an admin (`Donor.note`).
//   runNote    the driver's remark about the whole run (`Shift.note`), behind a
//              small "run notes" expander "so it doesn't compete with the
//              per-stop note for space" (S2.2).
//
// All read-only. There is no field on this screen to write any of them.

import { useState } from 'react';
import type { ReceiveStopDetail } from '../../../api/shared.ts';
import { COPY } from './weight-entry.ts';

export function StopNotes({ detail }: { detail: ReceiveStopDetail }) {
  const [runNoteOpen, setRunNoteOpen] = useState(false);

  return (
    <div className="r3-notes">
      {detail.stopNote ? (
        <p className="r3-note r3-note--stop">
          <span className="r3-note__label">{COPY.stopNoteLabel}</span>
          <span className="r3-note__body">{detail.stopNote}</span>
        </p>
      ) : null}

      {detail.donorNote ? (
        <p className="r3-note">
          <span className="r3-note__label">{COPY.donorNoteLabel}</span>
          <span className="r3-note__body">{detail.donorNote}</span>
        </p>
      ) : null}

      {detail.runNote ? (
        <div className="r3-notes__run">
          <button
            type="button"
            className="r3-notes__toggle"
            aria-expanded={runNoteOpen}
            onClick={() => setRunNoteOpen((open) => !open)}
          >
            {COPY.runNotesToggle}
          </button>
          {runNoteOpen ? (
            <p className="r3-note">
              <span className="r3-note__label">{COPY.runNoteLabel}</span>
              <span className="r3-note__body">{detail.runNote}</span>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
