// The active run — the ordered stop list, and "Complete this run" underneath it.
//
// S1.5's rules, in the order they appear there:
//   - big check-off rows, tap to mark picked up
//   - a stop can be skipped, with a reason-free confirm
//   - reordering allowed, and changing order never loses check state
//   - the next unchecked stop is visually the focus (the one primary action)
//   - once no stop is `PENDING`, the finish action appears (I27)
//
// D23 changed the finish action's shape: the button opens a confirm modal
// carrying the stop summary and the run note, and once confirmed this screen is
// `RunSummary` — read only, no actions at all. `pickup_completed_at` still
// completes nothing (I27) and the shift is still `IN_PROGRESS`, because I11
// (locked) makes the receiver's receive-done the only completion and I12 needs
// every stop WEIGHED first. The word on the button is the human's decision (D23);
// the state machine did not move to meet it.
//
// "Visually the focus" is taken literally here: the current stop is the one card
// open, and the rest are one-line rows a tap away (`isStopExpanded`). That is
// presentation and nothing else — the list, its order and every action are
// unchanged, and no rule in this file reads whether a card is open.
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
import { HOME_PATH, useAsyncData, useRouter, useSession, useToast } from '../../../app/index.ts';
import { Button, ConfirmModal, EmptyState } from '../../../components/index.ts';
import type {
  DonationSummary,
  DriverResolution,
  RunDetail,
  RunStopSummary,
} from '../../../api/shared.ts';
import {
  confirmHeadingBack,
  fetchDonorPlaces,
  resolveStop,
  saveOrder,
  saveStopNote,
} from './api.ts';
import {
  COPY,
  NO_STOP_EXPANSION,
  canMoveDown,
  canMoveUp,
  flaggedLine,
  forgetStopExpansion,
  headingBackState,
  isStopExpanded,
  messageFor,
  moveStop,
  nextPendingStop,
  orderedStops,
  placeFor,
  progressLabel,
  reorderPayload,
  shouldReloadAfter,
  stopsOnThisRun,
  toggleStopExpansion,
  type StopExpansion,
} from './logic.ts';
import { AdHocStep } from './AdHocStep.tsx';
import { CompleteRunModal } from './CompleteRunModal.tsx';
import { RunSummary } from './RunSummary.tsx';
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
  // Read before any early return: a hook after a conditional `return` runs on some
  // renders and not others, which is the one thing React's rules forbid outright.
  const { timezone } = useSession();
  const { navigate } = useRouter();
  const [completing, setCompleting] = useState(false);
  const [completeBusy, setCompleteBusy] = useState(false);
  const [flagging, setFlagging] = useState(false);
  // What the driver flagged on this run, for the acknowledgement list. Held here
  // rather than fetched: `GET /shifts/:id/donations` is the RECEIVE duty's, so a
  // driver cannot read back their own flags. Losing the list on reload costs
  // nothing — the rows are safely on the server, waiting on S2.3.
  const [flagged, setFlagged] = useState<DonationSummary[]>([]);
  const [skipTarget, setSkipTarget] = useState<RunStopSummary | null>(null);
  const [busyStopId, setBusyStopId] = useState<string | null>(null);
  // Which cards the driver opened or closed by hand. Empty means "follow the
  // current stop", which is the state a run starts in.
  const [expansion, setExpansion] = useState<StopExpansion>(NO_STOP_EXPANSION);

  // The map link and the photo flag (D20). A second request rather than fields on
  // the run: `RunStopSummary` carries no donor data beyond what it renders, and
  // the run endpoint is not this lane's. Failure is silent on purpose — a driver
  // loses the shortcut to the door, never the stop, so an error block over a
  // working stop list would be the worse trade.
  const places = useAsyncData(fetchDonorPlaces);
  const donors = places.data ?? [];

  const applyStop = (updated: RunStopSummary) => {
    onRun({ ...run, stops: run.stops.map((stop) => (stop.id === updated.id ? updated : stop)) });
  };

  const resolve = async (stop: RunStopSummary, disposition: DriverResolution) => {
    setBusyStopId(stop.id);
    try {
      // Idempotent server-side (A83): a second tap on a bad connection is not an
      // error, and there is no un-check to offer either way.
      applyStop(await resolveStop(run.shiftId, stop.id, disposition));
      // A finished stop closes itself and the focus moves on. Dropping the choice
      // rather than forcing it closed keeps the stop one tap from being reopened,
      // which a driver still needs: the note for the pantry outlives the check-off.
      setExpansion((current) => forgetStopExpansion(current, stop.id));
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

  /**
   * D23's one write. The SAME request as before — `POST /pickup-complete` with
   * the run note — because nothing about the server changed: `pickup_completed_at`
   * is set, the shift stays `IN_PROGRESS` (I27), and the receiver's receive-done
   * is still the only thing that completes it (I11, I12).
   *
   * Afterwards the screen goes home. The run is now a read-only summary and
   * leaving the driver parked on a full-screen takeover with nothing to do on it
   * would be the same dead end the summary exists to avoid.
   */
  const completeRun = async (note: string) => {
    setCompleteBusy(true);
    const trimmed = note.trim();
    try {
      onRun(await confirmHeadingBack(run.shiftId, trimmed === '' ? null : trimmed));
      setCompleting(false);
      toast.success(COPY.completeToast);
      navigate(HOME_PATH);
    } catch (error) {
      toast.error(messageFor(error));
      if (shouldReloadAfter(error)) onReload();
    } finally {
      setCompleteBusy(false);
    }
  };

  const heading = headingBackState(run, timezone ?? undefined);

  // D23: the run is done being worked. No stop list, no note editor, no flag —
  // `actionsFor` returns nothing here, and this is the screen that matches it.
  if (heading.confirmed) return <RunSummary run={run} />;

  if (flagging) {
    return (
      <AdHocStep
        run={run}
        onFlagged={(donation) => setFlagged((current) => [...current, donation])}
        onClose={() => setFlagging(false)}
      />
    );
  }

  const stops = orderedStops(run.stops);
  const onRunStops = stopsOnThisRun(run.stops);
  const focusId = nextPendingStop(run.stops)?.id ?? null;

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
              expanded={isStopExpanded(stop, run.stops, expansion)}
              place={placeFor(stop, donors)}
              busy={busyStopId === stop.id}
              canMoveUp={canMoveUp(run.stops, stop.id)}
              canMoveDown={canMoveDown(run.stops, stop.id)}
              onToggle={() =>
                setExpansion((current) => toggleStopExpansion(current, stop, run.stops))
              }
              onCollect={() => void resolve(stop, 'COLLECTED')}
              onSkip={() => setSkipTarget(stop)}
              onMove={(delta) => void move(stop, delta)}
              onSaveNote={(note) => saveNote(stop, note)}
            />
          ))}
        </ol>
      )}

      {/* I27's gate: on screen only once no stop is left PENDING. Confirming is
          one-way for this screen (D23), so it goes through a modal rather than
          straight onto the wire. */}
      {heading.offered ? (
        <div className="r3-pickup__handoff">
          <div className="r3-pickup__primary">
            <Button variant="primary" block onClick={() => setCompleting(true)}>
              {COPY.completeRun}
            </Button>
          </div>
        </div>
      ) : null}

      {/* Cap 12's driver half. Quiet, below the run's own work and below the one
          primary action, because the main flow is working the planned stops. What
          it records is not a stop (I14) and is deliberately not in the list above:
          it has no position, no disposition, and nothing to check off. */}
      <section className="r3-adhoc" aria-label={COPY.flagAdHoc}>
        {flagged.length > 0 ? (
          <div className="r3-adhoc__flagged">
            <p className="r3-pickup__label">{COPY.flaggedListLabel}</p>
            <ul className="r3-adhoc__list">
              {flagged.map((donation) => (
                <li key={donation.id}>{flaggedLine(donation)}</li>
              ))}
            </ul>
            {/* Kept (D21): the rows really do vanish on reload, and nothing else
                on screen says they are safe on the server. */}
            <p className="r3-pickup__hint">{COPY.flaggedListNote}</p>
          </div>
        ) : null}
        <Button variant="secondary" block onClick={() => setFlagging(true)}>
          {COPY.flagAdHoc}
        </Button>
      </section>

      {completing ? (
        <CompleteRunModal
          run={run}
          // D65: the review shows both halves of what the driver picked up.
          extras={flagged}
          busy={completeBusy}
          onCancel={() => setCompleting(false)}
          onConfirm={(note) => void completeRun(note)}
        />
      ) : null}

      {skipTarget ? (
        // Reason-free confirm (S1.5) that still names the consequence (§6): the
        // machine has no edge back to `PENDING`, so this cannot be undone here.
        <ConfirmModal
          question={COPY.skipQuestion}
          // Two sentences, not an em dash (D21). `ConfirmModal.consequence` is a
          // required prop by design and stays that way: this confirm has no way back.
          consequence={`${skipTarget.donorName}. ${COPY.skipConsequence}`}
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
