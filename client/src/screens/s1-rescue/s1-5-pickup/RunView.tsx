// The active run — the ordered stop list, and "Heading back" underneath it.
//
// S1.5's rules, in the order they appear there:
//   - big check-off rows, tap to mark picked up
//   - a stop can be skipped, with a reason-free confirm
//   - reordering allowed, and changing order never loses check state
//   - the next unchecked stop is visually the focus (the one primary action)
//   - once no stop is `PENDING`, "Heading back" appears (I27)
//
// What is NOT here, deliberately: any action that closes the run. The receiver's
// receive-done is the only completion (I11) and it ships in Phase 2 (D1), so this
// run stays `IN_PROGRESS` — including after "Heading back", which sets a
// timestamp and nothing else (I27).
//
// Reassignment (I30) is staff-only and lives on S1.3. A stop moved off this run
// is shown struck-through and out of every action, so a stop never silently
// vanishes from a list the driver is reading while driving.

import { useState } from 'react';
import { useSession, useToast } from '../../../app/index.ts';
import { Button, ConfirmModal, EmptyState } from '../../../components/index.ts';
import type { DriverResolution, RunDetail, RunStopSummary } from '../../../api/shared.ts';
import { resolveStop, saveOrder, saveStopNote } from './api.ts';
import {
  COPY,
  canMoveDown,
  canMoveUp,
  headingBackState,
  messageFor,
  moveStop,
  nextPendingStop,
  orderedStops,
  progressLabel,
  reorderPayload,
  shouldReloadAfter,
  stopsOnThisRun,
} from './logic.ts';
import { ReviewStep } from './ReviewStep.tsx';
import { StopCard } from './StopCard.tsx';

export interface RunViewProps {
  run: RunDetail;
  onRun: (run: RunDetail) => void;
  /** Re-read the run from the server — used when a write says this screen is out
   *  of date (someone resolved a stop first, or staff moved it off). */
  onReload: () => void;
}

export function RunView({ run, onRun, onReload }: RunViewProps) {
  const toast = useToast();
  const [reviewing, setReviewing] = useState(false);
  const [skipTarget, setSkipTarget] = useState<RunStopSummary | null>(null);
  const [busyStopId, setBusyStopId] = useState<string | null>(null);

  const applyStop = (updated: RunStopSummary) => {
    onRun({ ...run, stops: run.stops.map((stop) => (stop.id === updated.id ? updated : stop)) });
  };

  const resolve = async (stop: RunStopSummary, disposition: DriverResolution) => {
    setBusyStopId(stop.id);
    try {
      // Idempotent server-side (A83): a second tap on a bad connection is not an
      // error, and there is no un-check to offer either way.
      applyStop(await resolveStop(run.shiftId, stop.id, disposition));
    } catch (error) {
      toast.error(messageFor(error));
      if (shouldReloadAfter(error)) onReload();
    } finally {
      setBusyStopId(null);
    }
  };

  const saveNote = async (stop: RunStopSummary, note: string | null): Promise<boolean> => {
    try {
      applyStop(await saveStopNote(run.shiftId, stop.id, note));
      toast.success(COPY.noteSaved);
      return true;
    } catch (error) {
      toast.error(messageFor(error));
      if (shouldReloadAfter(error)) onReload();
      return false;
    }
  };

  const move = async (stop: RunStopSummary, delta: -1 | 1) => {
    // Optimistic: the list moves under the thumb that moved it. Only `position`
    // changes — dispositions and notes ride along untouched (S1.5's edge case).
    const reordered = moveStop(run.stops, stop.id, delta);
    onRun({ ...run, stops: reordered });
    try {
      const saved = await saveOrder(run.shiftId, reorderPayload(reordered));
      onRun({ ...run, stops: saved });
    } catch (error) {
      toast.error(messageFor(error));
      // Put the server's order back rather than leaving the screen showing an
      // order the server never accepted.
      onReload();
    }
  };

  if (reviewing) {
    return <ReviewStep run={run} onRun={onRun} onClose={() => setReviewing(false)} />;
  }

  const stops = orderedStops(run.stops);
  const onRunStops = stopsOnThisRun(run.stops);
  const focusId = nextPendingStop(run.stops)?.id ?? null;
  const { timezone } = useSession();
  const heading = headingBackState(run, timezone ?? undefined);

  return (
    <>
      <header className="r3-pickup__head">
        <h1>{run.routeName}</h1>
        <p className="r3-pickup__meta">
          {run.truckName ? `${COPY.truckLabel}: ${run.truckName}` : null}
          {run.truckName && onRunStops.length > 0 ? ' · ' : null}
          {onRunStops.length > 0 ? progressLabel(run.stops) : null}
        </p>
      </header>

      {run.staffNote ? (
        <section className="r3-pickup__staff-note" aria-label={COPY.staffNoteLabel}>
          <p className="r3-pickup__label">{COPY.staffNoteLabel}</p>
          <p>{run.staffNote}</p>
        </section>
      ) : null}

      {stops.length === 0 ? (
        <EmptyState title={COPY.noStops}>{COPY.noStopsNext}</EmptyState>
      ) : (
        <ol className="r3-stops" aria-label={COPY.stopsLabel}>
          {stops.map((stop, index) => (
            <StopCard
              key={stop.id}
              stop={stop}
              number={index + 1}
              focused={stop.id === focusId}
              busy={busyStopId === stop.id}
              canMoveUp={canMoveUp(run.stops, stop.id)}
              canMoveDown={canMoveDown(run.stops, stop.id)}
              onCollect={() => void resolve(stop, 'COLLECTED')}
              onSkip={() => setSkipTarget(stop)}
              onMove={(delta) => void move(stop, delta)}
              onSaveNote={(note) => saveNote(stop, note)}
            />
          ))}
        </ol>
      )}

      {heading.offered ? (
        <div className="r3-pickup__handoff">
          {heading.confirmed ? (
            <p className="r3-pickup__confirmed">
              <strong>{COPY.confirmedTitle}</strong>
              {heading.confirmedAt ? ` · ${heading.confirmedAt}` : null}
              <br />
              <span className="r3-pickup__hint">{COPY.confirmedHint}</span>
            </p>
          ) : null}
          <div className="r3-pickup__primary">
            <Button
              variant={heading.confirmed ? 'secondary' : 'primary'}
              block
              onClick={() => setReviewing(true)}
            >
              {heading.confirmed ? COPY.reviewAgain : COPY.headingBack}
            </Button>
          </div>
          {heading.confirmed ? null : <p className="r3-pickup__hint">{COPY.headingBackHint}</p>}
        </div>
      ) : null}

      {skipTarget ? (
        // Reason-free confirm (S1.5) that still names the consequence (§6): the
        // machine has no edge back to `PENDING`, so this cannot be undone here.
        <ConfirmModal
          question={COPY.skipQuestion}
          consequence={`${skipTarget.donorName} — ${COPY.skipConsequence}`}
          confirmLabel={COPY.skipConfirm}
          onCancel={() => setSkipTarget(null)}
          onConfirm={() => {
            const stop = skipTarget;
            setSkipTarget(null);
            void resolve(stop, 'SKIPPED');
          }}
        />
      ) : null}
    </>
  );
}
