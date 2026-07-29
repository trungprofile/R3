// "Heading back" — the short review screen behind the button (S1.5, I27).
//
// Shift summary, stop by stop, each stop's note, the driver's whole-run note as a
// last edit, and one action. Confirming sets `Shift.pickup_completed_at`.
//
// THREE THINGS THIS SCREEN IS NOT, and the copy has to hold all three:
//
//   1. It is not a completion. The shift stays `IN_PROGRESS` (I27), and in Phase 1
//      it stays there permanently — the receiver's receive-done is the only
//      completion action and it ships in Phase 2 (I11, build-plan D1).
//   2. It is not required. A driver who never taps it causes no problem; the
//      receiver resolves stops normally without the signal. So nothing here may
//      read as a step that was skipped.
//   3. It does not tell the pantry. The truck-inbound alert is the one piece of
//      cap 13 held back to Phase 2 (PRD §5) and the server enqueues nothing, so
//      no sentence here may claim the receiver was notified.
//
// Confirming a second time is harmless: the milestone keeps its first timestamp
// (A89). Once it is set, the primary action becomes a plain note save, because
// the run note stays editable while the shift is `IN_PROGRESS` (A90) and that is
// all a re-open is for.

import { useState } from 'react';
import { useToast } from '../../../app/index.ts';
import { Button, TextInput } from '../../../components/index.ts';
import type { RunDetail } from '../../../api/shared.ts';
import { confirmHeadingBack, saveRunNote } from './api.ts';
import { COPY, headingBackState, messageFor, reviewLines } from './logic.ts';

export interface ReviewStepProps {
  run: RunDetail;
  onRun: (run: RunDetail) => void;
  onClose: () => void;
}

export function ReviewStep({ run, onRun, onClose }: ReviewStepProps) {
  const toast = useToast();
  const [draft, setDraft] = useState(run.note ?? '');
  const [busy, setBusy] = useState(false);
  const { confirmed } = headingBackState(run);

  const submit = async () => {
    setBusy(true);
    const trimmed = draft.trim();
    const note = trimmed === '' ? null : trimmed;
    try {
      // Already confirmed: the note is the only thing left to write, and the
      // milestone would not move anyway.
      const updated = confirmed
        ? await saveRunNote(run.shiftId, note)
        : await confirmHeadingBack(run.shiftId, note);
      onRun(updated);
      // The toast is the light confirmation; the run screen behind it now carries
      // the standing "marked as heading back" line, so this is never the only
      // signal (§3).
      toast.success(confirmed ? COPY.noteSaved : COPY.headingBackToast);
      onClose();
    } catch (error) {
      toast.error(messageFor(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header className="r3-pickup__head">
        <h1>{COPY.reviewTitle}</h1>
        <p className="r3-pickup__meta">
          {run.routeName}
          {run.truckName ? ` · ${run.truckName}` : null}
        </p>
      </header>

      <p className="r3-pickup__hint">{COPY.reviewIntro}</p>

      <ul className="r3-review" aria-label={COPY.stopsLabel}>
        {reviewLines(run.stops).map((line) => (
          <li key={line.id} className="r3-review__line">
            <span className="r3-review__name">{line.name}</span>
            <span className="r3-review__status">{line.status}</span>
            {line.note ? <span className="r3-review__note">{line.note}</span> : null}
          </li>
        ))}
      </ul>

      <TextInput
        label={COPY.runNoteLabel}
        hint={COPY.runNoteHint}
        value={draft}
        onChange={setDraft}
        multiline
        disabled={busy}
      />

      <div className="r3-pickup__primary">
        <Button variant="primary" block loading={busy} onClick={() => void submit()}>
          {confirmed ? COPY.saveRunNote : COPY.confirmHeadingBack}
        </Button>
        <Button variant="secondary" block disabled={busy} onClick={onClose}>
          {COPY.backToStops}
        </Button>
      </div>
    </>
  );
}
