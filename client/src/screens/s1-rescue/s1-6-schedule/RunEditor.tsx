// One run, edited in the row it sits in — and, when it came from a repeating rule,
// the choice of WHICH thing is being edited.
//
// THE SCOPE IS THE LOAD-BEARING PART, and moving it did not soften it. It used to be
// a modal asked before the editor opened; it is now a two-option control inside the
// editor, defaulted to "This run". What did not change is that the SAVE PATH still
// branches on it:
//
//   * "This run" renders the per-instance actions and nothing else. I23 — a
//     per-instance edit never mutates the RecurrencePattern — holds because no call
//     reachable from that branch writes `recurrence_pattern`: `PATCH /shifts/:id`,
//     assign, unassign and cancel are all shift-row writes.
//   * The pattern scope renders exactly one thing: the hand-off to the Recurring
//     runs tab, where `PATCH /patterns/:id` is made against the stored rule. I24 —
//     the pattern changes only via an explicit pattern-level edit — holds because
//     that hand-off is the only route to it and staff had to choose it.
//
// The two branches are mutually exclusive by construction rather than by discipline,
// so "This run" cannot reach the pattern write even by accident.
//
// PRD cap 4: "edit a single recurring instance without breaking the pattern."
// `PATCH /shifts/:id` carries no date or time field at all, so the one edit that
// *would* need the owner's conflicts (cap 9's move) cannot be smuggled through it.
// Moving the date or time leaves for S1.7, which owes staff that conflict list.
//
// Four actions, three of them hidden rather than disabled when the domain refuses
// them (§3 prefers hiding): a run that has started cannot change hands (I5/I8 —
// its truck is picked and its stops are snapshotted), cannot be cancelled (I9) and
// cannot be moved. The server refuses each again; none of this is the rule.

import { useState } from 'react';
import { Button, Card, ConfirmModal, Segmented, TextInput } from '../../../components/index.ts';
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
  needsEditScope,
  patternScopeLabel,
} from './logic.ts';

/** Which row a save would land on. Never widened to a third value: these are the
 *  two operations `domain-modeling.md §5.3` names (`edit-one` and the pattern
 *  edit), and I23/I24 are stated about exactly this pair. */
type EditScope = 'RUN' | 'PATTERN';

export interface RunEditorProps {
  run: ShiftSummary;
  /** Today at the pantry, for the date label only. */
  today: string;
  /** The pantry's zone (A120); null before the sign-in has loaded. */
  timeZone: string | null;
  onChanged: () => void;
  onClose: () => void;
  /** I24's explicit pattern-level edit: switch to the Recurring runs tab with the
   *  stored rule loaded. Reached only from the pattern scope below. */
  onEditPattern: (patternId: string) => void;
}

export function RunEditor({
  run,
  today,
  timeZone,
  onChanged,
  onClose,
  onEditPattern,
}: RunEditorProps) {
  const toast = useToast();
  const { go } = useRouter();
  const [scope, setScope] = useState<EditScope>('RUN');
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

  const patternId = run.recurrencePatternId;

  return (
    <Card ariaLabel={`${run.routeName}, ${when}`}>
      <h3 className="s16-editor__title">{run.routeName}</h3>
      <p className="s16-editor__when">{when}</p>
      <p className="s16-editor__owner">{run.ownerName ?? COPY.unowned}</p>

      {needsEditScope(run) ? (
        <div className="s16-scope">
          {/* Visible label and `Segmented`'s own group name are the same sentence,
              so the accessible name is the text a sighted user is reading. */}
          <p className="s16-label">{COPY.editScopeQuestion}</p>
          <Segmented
            label={COPY.editScopeQuestion}
            options={[
              { value: 'RUN', label: COPY.scopeThisRun },
              { value: 'PATTERN', label: patternScopeLabel(run) },
            ]}
            value={scope}
            onChange={setScope}
          />
          {/* Kept under D21: neither consequence is visible from the control. */}
          <p className="s16-hint">{COPY.editScopeConsequence}</p>
        </div>
      ) : null}

      {scope === 'PATTERN' && patternId !== null ? (
        // I24's explicit pattern-level edit, and the ONLY thing this branch offers.
        // The rule is edited on the Recurring runs tab against the stored row; no
        // per-run action is rendered here, so a pattern-scoped editor cannot write a
        // shift and a run-scoped one cannot write the pattern (I23).
        <div className="s16-actions">
          <Button variant="primary" onClick={() => onEditPattern(patternId)}>
            {COPY.editThePattern}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            {COPY.closeEditor}
          </Button>
        </div>
      ) : (
        <>
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
                  before it moves anything, and `PATCH /shifts/:id` carries no date
                  or time to move with. Everything else about the run is edited here. */}
              {canMoveRun(run) ? (
                <Button variant="secondary" onClick={() => go('reschedule', { shiftId: run.id })}>
                  {COPY.moveRun}
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
        </>
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
