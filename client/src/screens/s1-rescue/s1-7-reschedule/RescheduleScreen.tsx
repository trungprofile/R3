// S1.7 — Staff, reschedule. Route `/schedule/:shiftId/reschedule`, `tier: 'STAFF'`
// (hierarchical, so Admin is admitted by the same declaration — I1).
//
// "Flow: move date/time. Owner kept by default. Before confirm, app surfaces any
// conflict with that owner's declared availability. On confirmed conflict, owner is
// released → shift returns to board Open. System never auto-picks a replacement."
//
// THE SUBSTANCE OF THIS SCREEN IS THE CONFLICT PATH, and it is three facts:
//
//   1. The owner comes along by default. Moving a run does not release its driver,
//      so the read-back above the primary action says whose run it stays.
//   2. The conflict is surfaced BEFORE anything changes (PRD cap 9). The
//      unconfirmed `POST .../reschedule` gathers `ownerConflicts()` and throws
//      before its UPDATE, so the 409 leaves the run exactly where it was and the
//      warning is a question, not a report of something already done.
//   3. On confirmation the owner is released and the run goes back to the board as
//      open. NOTHING here suggests a replacement driver, and nothing here may: cap 9
//      states the system never auto-selects one, and offering "an eligible driver"
//      would quietly convert a coordinator's judgement call into the app's.
//
// The rules are the SERVER's. `architecture.md §4.5`: a client-side check is
// communication, so staff are not walked into a request that will be refused; the
// refusal in `services/schedule.ts` is the rule itself. Nothing below decides
// whether a run may move.

import { useCallback, useMemo, useState } from 'react';
import {
  BackLink,
  Button,
  Card,
  ConfirmModal,
  EmptyState,
  ErrorBlock,
  SkeletonRows,
  StatusChip,
} from '../../../components/index.ts';
import { useAsyncData, useRouter, useSession, useToast } from '../../../app/index.ts';
import type { ScreenProps } from '../../../app/index.ts';
import type { ShiftDetail, ShiftSummary } from '../../../api/shared.ts';
import { fetchRun, moveRun } from './api.ts';
import { DayPicker } from './DayPicker.tsx';
import { TimePick } from './TimePick.tsx';
import {
  COPY,
  buildRequest,
  currentWindow,
  failureMessage,
  formatWhen,
  isReleaseConflict,
  minutesOfTime,
  monthOf,
  moveRefusal,
  moveSummary,
  movedMessage,
  runMayHaveChanged,
  timeOptions,
  todayInZone,
  validateMove,
  withStartTime,
} from './logic.ts';
import type { MoveForm } from './logic.ts';
import './reschedule.css';

export function RescheduleScreen({ params }: ScreenProps) {
  const shiftId = params['shiftId'] ?? '';
  const { timezone } = useSession();
  const { go } = useRouter();

  const load = useCallback((signal: AbortSignal) => fetchRun(shiftId, signal), [shiftId]);
  const state = useAsyncData<ShiftDetail>(load);

  if (state.error) return <ErrorBlock error={state.error} onRetry={state.reload} />;

  // The form is not built until the PANTRY's zone is known (A120). This is the one
  // guard that matters on this screen: prefilling from the device's zone would put
  // the device's 9am in the fields, and a coordinator who changes only the day would
  // then submit a wall-clock time nobody chose. `timezone` is non-null for the whole
  // of a signed-in session (`SessionResponse.timezone` is a `string`), so this costs
  // nothing in practice and forecloses the failure entirely.
  if (state.data === null || timezone === null) {
    return state.showLoading || state.data !== null ? (
      <SkeletonRows rows={3} label="Loading this run" />
    ) : null;
  }

  const loaded = state.data;
  return (
    <MoveRun
      key={loaded.id}
      run={loaded}
      timeZone={timezone}
      onStale={state.reload}
      // S1.3 is the run's own page and the screen both S1.2 and S1.6 link into, so it
      // is where a finished move lands — including a released one, whose run is now
      // open and shown there as such.
      onDone={() => go('shift', { shiftId: loaded.id })}
    />
  );
}

// ---------------------------------------------------------------------------
// The move
// ---------------------------------------------------------------------------

interface MoveRunProps {
  run: ShiftSummary;
  /** The pantry's zone (A120). Required, not optional — see the guard above. */
  timeZone: string;
  /** Re-read the run after a refusal that means it changed underneath. */
  onStale: () => void;
  /** Where staff lands once the run has moved: the run's own page (S1.3). */
  onDone: () => void;
}

function MoveRun({ run, timeZone, onStale, onDone }: MoveRunProps) {
  const toast = useToast();

  // The run's own window, converted once from its instants. Also the thing "nothing
  // changed" is measured against.
  const current = useMemo<MoveForm>(() => currentWindow(run, timeZone), [run, timeZone]);
  const [form, setForm] = useState<MoveForm>(current);
  const [month, setMonth] = useState(() => monthOf(current.date));
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** A surfaced conflict, held with the exact window it was raised against so the
   *  confirmed call cannot move the run onto a different one than staff was warned
   *  about. */
  const [pending, setPending] = useState<{ form: MoveForm; warning: string } | null>(null);

  const today = todayInZone(new Date(), timeZone);
  const refusal = moveRefusal(run.status);

  // The run's own times are merged into the grid, so a run standing at 9:15 stays
  // selectable and moving it to another day does not silently change its hours.
  const starts = timeOptions([current.startTime, form.startTime]);
  const ends = timeOptions([current.endTime, form.endTime]).filter(
    (time) => minutesOfTime(time) > minutesOfTime(form.startTime),
  );

  async function submit(target: MoveForm, confirmRelease: boolean) {
    setSaving(true);
    setProblem(null);
    try {
      const result = await moveRun(run.id, buildRequest(target, confirmRelease));
      setPending(null);
      // `released` comes from the server, not from what this screen guessed: it is
      // the difference between "the driver came along" and "the driver was let go".
      toast.success(movedMessage(run, result.released));
      onDone();
    } catch (cause) {
      // Cap 9's pre-confirm surface. The service threw before its UPDATE, so the run
      // has NOT moved and no owner has been released — this is a question.
      if (!confirmRelease && isReleaseConflict(cause)) {
        setPending({ form: target, warning: failureMessage(cause) });
        return;
      }
      setPending(null);
      setProblem(failureMessage(cause));
      // A refusal about the RUN — started, cancelled, or moved by someone else — means
      // the screen is describing a row that no longer exists in that shape, so re-read
      // it. A refusal about the REQUEST leaves the run alone and needs no fetch.
      if (runMayHaveChanged(cause)) onStale();
    } finally {
      setSaving(false);
    }
  }

  function onConfirm() {
    const invalid = validateMove(form, current);
    if (invalid !== null) {
      setProblem(invalid);
      return;
    }
    void submit(form, false);
  }

  return (
    <div className="s17-screen">
      {/* §3's one way out, at the top and before the heading (D43). It is here in
          BOTH states on purpose. The refusal below is a dead end — a run that has
          started, been cancelled or finished cannot be moved — and §3 says a dead
          end must carry the way out as a CONTROL rather than as advice. This is
          that control: `BackLink` renders a button, and putting it above the
          heading rather than inside the empty state means a coordinator finds the
          exit in the same place whichever of the two they land on. */}
      <BackLink label={COPY.back} onBack={onDone} />

      <h1 className="s17-title">{COPY.header}</h1>

      <RunNow run={run} timeZone={timeZone} />

      {refusal ? (
        <EmptyState title={refusal.title}>{refusal.body}</EmptyState>
      ) : (
        <section className="s17-form" aria-label={COPY.newHeading}>
          <h2 className="s17-heading">{COPY.newHeading}</h2>

          <fieldset className="s17-days">
            <legend className="s17-label">{COPY.dateLabel}</legend>
            <DayPicker
              value={form.date}
              month={month}
              today={today}
              currentDate={current.date}
              onMonthChange={setMonth}
              onPick={(iso) => {
                setProblem(null);
                setForm((state) => ({ ...state, date: iso }));
              }}
            />
          </fieldset>

          {/* Kept under D21: the times are the PANTRY's, which the control cannot
              show and a coordinator in another zone would otherwise assume wrong. */}
          <p className="s17-hint">{COPY.timeHint}</p>
          <TimePick
            label={COPY.startLabel}
            value={form.startTime}
            options={starts}
            onSelect={(time) => {
              setProblem(null);
              setForm((state) => withStartTime(state, time));
            }}
          />
          <TimePick
            label={COPY.endLabel}
            value={form.endTime}
            options={ends}
            onSelect={(time) => {
              setProblem(null);
              setForm((state) => ({ ...state, endTime: time }));
            }}
          />

          {/* The read-back. S1.7's "owner kept by default" is stated, not implied. */}
          <p className="s17-summary">{moveSummary(form, run)}</p>

          {problem ? (
            <p className="s17-error" role="alert">
              {problem}
            </p>
          ) : null}

          <div className="s17-actions">
            {/* §1 principle 1: the screen's one high-emphasis button, and since
                D43 the only button here. The form IS the screen — its cancel went
                to exactly where the BackLink above goes, so keeping both would be
                one destination wearing two labels. */}
            <Button variant="primary" loading={saving} onClick={onConfirm}>
              {COPY.confirm}
            </Button>
          </div>
        </section>
      )}

      {pending ? (
        <ConfirmModal
          question={COPY.releaseQuestion}
          // The conflict sentence is the SERVER's — S1.7 fixes its wording and
          // `rescheduleConflictMessage()` in `shared/src/schedule.ts` writes it once
          // for both halves. The second sentence is cap 9's "never auto-picks a
          // replacement", which the spec states as a rule and gives no copy for.
          consequence={`${pending.warning} ${COPY.releaseNoReplacement}`}
          confirmLabel={COPY.releaseConfirm}
          busy={saving}
          onConfirm={() => void submit(pending.form, true)}
          // Cancelling leaves the conflict on screen as the reason. §3: a modal that
          // took the only statement of the problem away with it would leave the
          // coordinator looking at a window they have no reason to distrust.
          onCancel={() => {
            setProblem(pending.warning);
            setPending(null);
          }}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Where the run stands now
// ---------------------------------------------------------------------------

function RunNow({ run, timeZone }: { run: ShiftSummary; timeZone: string }) {
  return (
    <Card ariaLabel={COPY.nowHeading}>
      <p className="s17-now__label">{COPY.nowHeading}</p>
      <p className="s17-now__route">{run.routeName}</p>
      {/* Pantry-local throughout (A120): the day is `occurrenceDate` and the times
       *  are its instants read in the pantry's zone. */}
      <p className="s17-now__when">{formatWhen(run, timeZone)}</p>
      <p className="s17-now__owner">
        <span className="s17-now__driver">{run.ownerName ?? COPY.unowned}</span>
        <StatusChip status={run.status} />
      </p>
    </Card>
  );
}
