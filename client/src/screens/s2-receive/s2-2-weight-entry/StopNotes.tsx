// The three note channels S2.2 shows and the receiver authors none of.
//
//   stopNote   driver → receiver, this stop only (`ShiftStop.note`, cap 11
//              channel 2). The one they act on, so it keeps the orange rule.
//   donorNote  the store's permanent note, set by an admin (`Donor.note`).
//   runNote    the driver's remark about the whole run (`Shift.note`).
//
// `D68` — SHOWN, NOT TOGGLED. The run note used to sit behind a "Run notes"
// disclosure so it "doesn't compete with the per-stop note for space" (S2.2). On
// the docked tablet that cost a 44px target to read one line, and the pass found
// it was simply never opened — a note nobody reads is the same as no note.
//
// ONE LINE EACH, and the label names its author. A label stacked over its body
// cost two lines apiece on the screen with the least room to spare, and "About
// the whole run" told the receiver something the position already told them. Who
// wrote it is the part they cannot see, and it is what decides how much the note
// is worth acting on: a driver's remark about this morning is not an admin's
// standing note about the door.
//
// The block sits in the entry column beside the keypad and is capped to its
// height, scrolling inside itself past that. It is the one thing on this screen
// allowed to take leftover space, because it is the only thing whose length the
// pantry does not control — and it must still never push a control off screen.
//
// All read-only. There is no field on this screen to write any of them.

import type { ReceiveStopDetail } from '../../../api/shared.ts';
import { COPY } from './weight-entry.ts';

function Note({ label, body, stop = false }: { label: string; body: string; stop?: boolean }) {
  return (
    <p className={stop ? 'r3-note r3-note--stop' : 'r3-note'}>
      <span className="r3-note__label">{label}</span> {body}
    </p>
  );
}

export function StopNotes({ detail }: { detail: ReceiveStopDetail }) {
  return (
    <div className="r3-notes">
      {detail.stopNote ? (
        <Note label={COPY.stopNoteLabel(detail.driverName)} body={detail.stopNote} stop />
      ) : null}
      {detail.donorNote ? <Note label={COPY.donorNoteLabel} body={detail.donorNote} /> : null}
      {detail.runNote ? (
        <Note label={COPY.runNoteLabel(detail.driverName)} body={detail.runNote} />
      ) : null}
    </div>
  );
}
