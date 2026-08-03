// "Complete this run" — the confirm behind the button (D23, S1.5, I27).
//
// A modal rather than a screen of its own: what it asks is one question with one
// consequence, which is `components/Modal.tsx`'s whole contract (§3, §6). The
// stop summary and the run-note field ride inside it so the driver reviews and
// writes in the same place they confirm, instead of on a page they can leave
// halfway through.
//
// WHAT CONFIRMING DOES, EXACTLY: `POST /shifts/:id/pickup-complete`. It sets
// `Shift.pickup_completed_at` and carries the run note. That is all it has ever
// done and D23 changed none of it.
//
// WHAT IT DOES NOT DO, despite the word on the button:
//
//   - It does not complete the shift. `I11` is locked and names the receiver's
//     receive-done as the ONLY completion action, and `I12` will not let a shift
//     reach `COMPLETED` until every stop is `WEIGHED` — which needs a scale the
//     driver does not have. The shift is still `IN_PROGRESS` afterwards (`I27`).
//   - It is not required. A driver who never taps it causes no problem; the
//     receiver resolves stops normally without the signal.
//
// The label is the human's decision, recorded in D23 and taken as asked. The
// state machine is not changing to match it.

import { useState } from 'react';
import { Button, Modal, TextInput } from '../../../components/index.ts';
import type { RunDetail } from '../../../api/shared.ts';
import { StopStatusChip } from './StopStatusChip.tsx';
import { COPY, reviewLines } from './logic.ts';

export interface CompleteRunModalProps {
  run: RunDetail;
  busy: boolean;
  /** The note as typed. The caller trims it and nulls an empty one before it
   *  goes on the wire. */
  onConfirm: (note: string) => void;
  onCancel: () => void;
}

export function CompleteRunModal({ run, busy, onConfirm, onCancel }: CompleteRunModalProps) {
  const [draft, setDraft] = useState(run.note ?? '');

  return (
    <Modal
      question={COPY.completeQuestion}
      onCancel={onCancel}
      cancelLabel={COPY.backToStops}
      actions={
        <Button variant="primary" loading={busy} onClick={() => onConfirm(draft)}>
          {COPY.completeConfirm}
        </Button>
      }
    >
      {/* §6's confirm pattern: name the consequence, never "Are you sure?". The
          one that matters here is that the note stops being editable. */}
      <p className="r3-complete__consequence">{COPY.completeConsequence}</p>

      <ul className="r3-review" aria-label={COPY.stopsLabel}>
        {reviewLines(run.stops).map((line) => (
          <li key={line.id} className="r3-review__line">
            <span className="r3-review__name">{line.name}</span>
            <StopStatusChip disposition={line.disposition} />
            {line.note ? <span className="r3-review__note">{line.note}</span> : null}
          </li>
        ))}
      </ul>

      {/* No hint under it (D21). "Note about the whole run" over an empty box says
          what to put in it, and the consequence above already says it locks. */}
      <TextInput
        label={COPY.runNoteLabel}
        value={draft}
        onChange={setDraft}
        multiline
        disabled={busy}
      />
    </Modal>
  );
}
