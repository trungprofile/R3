// "Edit just this date" — one run, edited without touching the repeating run it
// came from.
//
// PRD cap 4: "edit a single recurring instance without breaking the pattern." I23 is
// what makes that true — nothing reachable from here writes `recurrence_pattern` —
// and `PATCH /shifts/:id` carries no date or time field at all, so the one edit that
// *would* need the owner's conflicts (cap 9's move) cannot be smuggled through it.
// Moving the date or time leaves for S1.7, which owes staff that conflict list.
//
// Four actions, three of them hidden rather than disabled when the domain refuses
// them (§3 prefers hiding): a run that has started cannot change hands (I5/I8 —
// its truck is picked and its stops are snapshotted), cannot be cancelled (I9) and
// cannot be moved. The server refuses each again; none of this is the rule.

import { useState } from 'react';
import { Button, Card, ConfirmModal, TextInput } from '../../../components/index.ts';
import { useRouter, useToast } from '../../../app/index.ts';
import type { ShiftSummary } from '../../../api/shared.ts';
import { AssignDriver } from './AssignDriver.tsx';
import { cancelRun, saveRunNote, unassignDriver } from './api.ts';
import {
  COPY,
  canCancelRun,
  canMoveRun,
  canSetDriver,
  failureMessage,
  formatDayLabel,
  formatInstantRange,
} from './logic.ts';

export interface RunEditorProps {
  run: ShiftSummary;
  /** Today at the pantry, for the date label only. */
  today: string;
  /** The pantry's zone (A120); null before the sign-in has loaded. */
  timeZone: string | null;
  onChanged: () => void;
  onClose: () => void;
}

export function RunEditor({ run, today, timeZone, onChanged, onClose }: RunEditorProps) {
  const toast = useToast();
  const { go } = useRouter();
  const [note, setNote] = useState(run.staffNote ?? '');
  const [savingNote, setSavingNote] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [confirm, setConfirm] = useState<'cancel' | 'unassign' | null>(null);
  const [busy, setBusy] = useState(false);

  const when = `${formatDayLabel(run.occurrenceDate, today)} · ${formatInstantRange(
    run.startsAt,
    run.endsAt,
    timeZone ?? undefined,
  )}`;

  const saveNote = async () => {
    setSavingNote(true);
    setProblem(null);
    try {
      const trimmed = note.trim();
      await saveRunNote(run.id, trimmed === '' ? null : trimmed);
      toast.success(COPY.noteSaved);
      onChanged();
    } catch (cause) {
      setProblem(failureMessage(cause));
    } finally {
      setSavingNote(false);
    }
  };

  const doCancel = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await cancelRun(run.id);
      toast.success(COPY.cancelledRun);
      setConfirm(null);
      onChanged();
      onClose();
    } catch (cause) {
      setConfirm(null);
      setProblem(failureMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const doUnassign = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await unassignDriver(run.id);
      toast.success(COPY.driverCleared);
      setConfirm(null);
      onChanged();
    } catch (cause) {
      setConfirm(null);
      setProblem(failureMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card ariaLabel={`${run.routeName}, ${when}`}>
      <h3 className="s16-editor__title">{run.routeName}</h3>
      <p className="s16-editor__when">{when}</p>
      <p className="s16-editor__owner">{run.ownerName ?? COPY.unowned}</p>

      {/* Cap 11 channel 1 — the coordinator→driver note, this run only. */}
      <TextInput label={COPY.runNote} value={note} multiline onChange={setNote} />
      <Button variant="primary" loading={savingNote} onClick={() => void saveNote()}>
        {COPY.saveNote}
      </Button>

      {problem ? (
        <p className="s16-problem" role="alert">
          {problem}
        </p>
      ) : null}

      {assigning && canSetDriver(run) ? (
        <AssignDriver
          run={run}
          onAssigned={onChanged}
          onClose={() => setAssigning(false)}
        />
      ) : (
        <div className="s16-actions">
          {canSetDriver(run) ? (
            <Button variant="secondary" onClick={() => setAssigning(true)}>
              {COPY.assign}
            </Button>
          ) : null}
          {run.ownerId !== null && canSetDriver(run) ? (
            <Button variant="secondary" onClick={() => setConfirm('unassign')}>
              {COPY.clearDriver}
            </Button>
          ) : null}
          {/* Cap 9 lives on S1.7 because it has to show the owner's conflicts
              before it moves anything. */}
          {canMoveRun(run) ? (
            <Button variant="secondary" onClick={() => go('reschedule', { shiftId: run.id })}>
              {COPY.moveDateTime}
            </Button>
          ) : null}
          {canCancelRun(run) ? (
            <Button variant="danger" onClick={() => setConfirm('cancel')}>
              {COPY.cancelRun}
            </Button>
          ) : null}
          <Button variant="secondary" onClick={onClose}>
            {COPY.closeEditor}
          </Button>
        </div>
      )}

      {confirm === 'cancel' ? (
        <ConfirmModal
          question={COPY.cancelRunQuestion}
          consequence={COPY.cancelRunConsequence}
          confirmLabel={COPY.cancelRunGo}
          busy={busy}
          onConfirm={() => void doCancel()}
          onCancel={() => setConfirm(null)}
        />
      ) : null}

      {confirm === 'unassign' ? (
        <ConfirmModal
          question={COPY.clearDriverQuestion}
          consequence={COPY.clearDriverConsequence}
          confirmLabel={COPY.clearDriverGo}
          busy={busy}
          onConfirm={() => void doUnassign()}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
    </Card>
  );
}
