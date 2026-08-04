// S2.2b Receive done — the one explicit action that closes out a run (I11).
//
// `ui-ux-spec.md S2.2b`, on the shared tablet in landscape. Reached from S2.1b
// once a run shows "all stops done", or from S2.2's banner. The responsive matrix
// marks this surface `n/a` on a phone, so there is no phone layout here — only a
// wide one that a desktop browser also reads comfortably.
//
// The screen is deliberately almost empty: a list of resolved stops, the run's
// total, and one button. That is the whole point of separating it from S2.2 —
// weighing confirms each entry as you go (PRD cap 14), and this confirms the run
// is finished. Anything else on screen would compete with the one thing to read
// before an irreversible tap.
//
// THREE RULES THIS FILE HOLDS:
//
//   1. A skipped stop prints "skipped", never "0 lb". `total` is null there and
//      the two facts are different (§3.2).
//   2. If the run is not ready, the action is ABSENT, not disabled — and the
//      screen says what is still outstanding. The server refuses it anyway
//      (`RECEIVE_INCOMPLETE_MESSAGE`), but a button that fails is not an
//      interaction (§3: "prefer hiding over disabling").
//   3. `D37`: the same goes for a run that is already closed. It shows the
//      summary and no action — a **Receive done** on a `COMPLETED` run is a
//      button whose only outcome is "That run is already finished." Since `D46`
//      it also names WHO closed it and when, which is the question a second
//      receiver on a shared tablet actually arrives with.
//
// `D37` also makes the confirm reversible. Reaching this screen used to be the end
// of the road: the picker sends a fully-resolved run here rather than into its
// weights, so the only way back to a number was to not have left. **Change a
// weight** is that way back, and it is offered for exactly as long as the server
// would accept the write — BOTH halves of that since `D47`, the run being open and
// the receiver's day window not having lapsed. Submitting is still the only thing
// that is final (I11).
//
// Every state on the screen carries at least one control that leads somewhere. A
// read-only screen with nothing tappable is a dead end, and §3 rules those out in
// their own right — "read only" describes the data, not a reason to trap someone.
// `D43` moved that control to the TOP: one `BackLink`, on every branch, instead of
// three hand-rolled "Back to the runs" buttons at the bottom of three of them.

import { useCallback, useState } from 'react';
import { useAsyncData, useRouter, useSession, useToast } from '../../../app/index.ts';
import type { ScreenProps } from '../../../app/index.ts';
import {
  BackLink,
  Button,
  Card,
  ConfirmModal,
  EmptyState,
  ErrorBlock,
  List,
  ListItem,
  ListRow,
  SkeletonRows,
} from '../../../components/index.ts';
import { RECEIVE_DONE_CONFIRM, RECEIVE_INCOMPLETE_MESSAGE } from '../../../api/shared.ts';
import type { ReceiveDoneLine, ReceiveDoneSummary } from '../../../api/shared.ts';
import { confirmReceiveDone, fetchOpenRun, fetchReceiveDone } from './api.ts';
import type { OpenRunAnswer } from './api.ts';
import {
  COPY,
  canEditWeights,
  doneNotice,
  doneStage,
  firstStopId,
  lineStatus,
  messageFor,
  outstandingLines,
  runTitle,
  shouldReloadAfter,
  signOff,
  signOffTime,
  weightWithUnit,
} from './receive-done.ts';
import './receive-done.css';

function StopLines({ lines, label }: { lines: readonly ReceiveDoneLine[]; label: string }) {
  return (
    <List label={label}>
      {lines.map((line, index) => (
        // Donor name is unique per stop within a run in practice, but the key has
        // to survive a run that visits the same store twice, so it carries the
        // position too.
        <ListItem key={`${line.donorName}-${index}`}>
          <ListRow
            title={line.donorName}
            side={<span className="s22b-state">{lineStatus(line)}</span>}
            ariaLabel={`${line.donorName}, ${lineStatus(line)}`}
          />
        </ListItem>
      ))}
    </List>
  );
}

export function ReceiveDoneScreen({ params }: ScreenProps) {
  const shiftId = params['shiftId'] ?? '';
  const { go } = useRouter();
  const toast = useToast();
  // The pantry's zone, for the sign-off time (`D46`, A120). Null until the session
  // lands, which `signOffTime` reads as "fall back to the device".
  const { timezone } = useSession();

  const load = useCallback(
    (signal: AbortSignal) => fetchReceiveDone(shiftId, signal),
    [shiftId],
  );
  const remote = useAsyncData<ReceiveDoneSummary>(load);

  // Is the run still open for receiving? (`D37`) The summary cannot say — see
  // `fetchOpenRun`. A failure here is not an error state: the screen falls back to
  // what it always did, and the server is what decides.
  const loadOpen = useCallback(
    (signal: AbortSignal) => fetchOpenRun(shiftId, signal),
    [shiftId],
  );
  const openRun = useAsyncData<OpenRunAnswer>(loadOpen);

  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  const finish = async () => {
    setBusy(true);
    try {
      const result = await confirmReceiveDone(shiftId);
      setAsking(false);
      // The toast is the light confirmation; S2.1b behind it no longer lists this
      // run, which is the standing signal (§3: a toast is never the only one).
      toast.success(doneNotice(result.purgedSuggestions));
      // Home, not the picker (`D37`). `ui-ux-spec.md` S2.2b says "returns to S2.1b";
      // that predates Home existing (`D22`). A receiver who has just closed a run is
      // as likely to be finished for the day as to be starting the next one, and the
      // hub offers both without deciding for them — including the duties this person
      // holds besides receiving, which the picker cannot reach.
      go('home');
    } catch (error) {
      setAsking(false);
      toast.error(messageFor(error));
      // Someone else weighed the last stop, or closed the run from the other
      // tablet. Both are ordinary on a shared device and both are fixed by a
      // re-read rather than by asking the receiver to do anything — and the run's
      // open-ness is re-read with it, since "already finished" is one of the two
      // refusals this catches (`D37`).
      if (shouldReloadAfter(error)) {
        remote.reload();
        openRun.reload();
      }
    } finally {
      setBusy(false);
    }
  };

  if (remote.error) {
    return (
      <div className="s22b">
        <ErrorBlock error={remote.error} onRetry={remote.reload} />
      </div>
    );
  }
  if (remote.data === null) {
    // Nothing at all under 300ms (§6) — `showLoading` already carries the delay.
    return remote.showLoading ? (
      <div className="s22b">
        <SkeletonRows rows={4} label={COPY.loading} />
      </div>
    ) : null;
  }

  const summary = remote.data;
  // `null` — "could not find out" — while the second read is in flight and after it
  // failed. `doneStage` reads that as the old behaviour, never as "closed" (`D37`).
  const stillOpen = openRun.data === null ? null : openRun.data.run !== null;
  const stage = doneStage(summary, stillOpen);
  const outstanding = outstandingLines(summary);

  /** The way back into the weights, or null when there is nowhere to go back to:
   *  the run is closed, its receiver edit window has lapsed (`D47`), or it has no
   *  stops to open a sheet on. */
  const openRunData = openRun.data?.run ?? null;
  const editStopId =
    canEditWeights(stillOpen, summary.editWindowOpen) && openRunData
      ? firstStopId(openRunData)
      : null;

  /** Who confirmed receive-done, on a run that has been (`D46`). */
  const closedBy = signOff(summary);

  const lede =
    stage === 'CLOSED' ? COPY.closed : stage === 'CONFIRM' ? COPY.ready : COPY.notReady;

  return (
    <div className="s22b">
      {/* `D43`: one way out, at the top, on every branch — including BLOCKED,
          which no longer carries a button of its own. A back control at the
          bottom is only reachable after scrolling past everything the person
          wanted to leave. */}
      <BackLink label={COPY.backToRuns} onBack={() => go('receive-runs')} />

      <header className="s22b-head">
        <h1 className="s22b-title">{runTitle(summary)}</h1>
        <p className="s22b-lede">{lede}</p>
      </header>

      {summary.lines.length === 0 ? (
        // A run with no stops closes vacuously (I12) — so once it has, "you can
        // finish it whenever you like" is no longer true and must not be said.
        <EmptyState title={COPY.noStops}>
          {stage === 'CLOSED' ? COPY.closedHint : COPY.noStopsHint}
        </EmptyState>
      ) : (
        <Card ariaLabel={COPY.linesLabel}>
          <StopLines lines={summary.lines} label={COPY.linesLabel} />
          <p className="s22b-total">
            <span className="s22b-total__label">{COPY.runTotalLabel}</span>
            <span className="r3-numeric">{weightWithUnit(summary.runTotal)}</span>
          </p>
        </Card>
      )}

      {stage === 'CLOSED' ? (
        // Finished. The summary above is the whole screen; what used to be here was
        // a button whose only possible outcome was a refusal (`D37`, I11). Not a
        // dead end — the way out is the BackLink at the top (`D43`).
        <div className="s22b-actions">
          {/* `D46`: WHO finished it, and when. The screen used to say only that the
              run was closed, which on a shared tablet leaves a second receiver
              guessing whether it was them, their colleague, or a mistake. There is
              no `completed_by` column; the server reads the last writer, which is
              sound only because I10 makes COMPLETED terminal — the assumption is
              recorded beside the query, not here. Absent rather than guessed if the
              server did not send both halves. */}
          {closedBy ? (
            <p className="s22b-signoff">
              <span className="s22b-signoff__label">{COPY.signedOffLabel}</span>{' '}
              <strong>{closedBy.name}</strong>
              {' · '}
              {signOffTime(closedBy.at, timezone)}
            </p>
          ) : null}
          <p className="s22b-closed" role="status">
            {COPY.closedHint} {COPY.closedNext}
          </p>
        </div>
      ) : stage === 'CONFIRM' ? (
        <div className="s22b-actions">
          <p className="s22b-hint">{COPY.readyHint}</p>
          {/* §1.1: exactly one high-emphasis button on the screen. */}
          <Button variant="primary" onClick={() => setAsking(true)}>
            {COPY.receiveDone}
          </Button>
          {/* `D37`: the confirm is reversible until it is submitted. The picker
              sends a fully-resolved run straight here, so without this there is no
              route back to a number the receiver wants to change.
              `D47`: and it is offered only while the server would still take the
              write — being IN_PROGRESS was half the guard, the day window is the
              other half, and `editWindowOpen` is now on the payload. */}
          {editStopId ? (
            <>
              <Button
                variant="secondary"
                onClick={() => go('receive-stop', { shiftId, stopId: editStopId })}
              >
                {COPY.editWeights}
              </Button>
              <p className="s22b-hint">{COPY.editHint}</p>
            </>
          ) : null}
        </div>
      ) : (
        // Not offered, not disabled. The gate is I12's and the server holds it;
        // this half of the screen exists so the receiver knows what to go and do.
        <div className="s22b-actions">
          <p className="s22b-blocked" role="status">
            {RECEIVE_INCOMPLETE_MESSAGE}
          </p>
          {outstanding.length > 0 ? (
            <>
              <h2 className="s22b-subhead">{COPY.outstandingLabel}</h2>
              <StopLines lines={outstanding} label={COPY.outstandingLabel} />
            </>
          ) : null}
          {/* No **Change a weight** here on purpose: with a stop still unresolved
              the receiver's next step is that stop, not an old number, and the
              picker already routes a tap to the first unresolved one (S2.1b). A
              second door onto a different stop would be a choice nobody asked for.

              And no bottom button either, since `D43` — the BackLink at the top is
              the way out, which is what §3's dead-end rule asks for. */}
        </div>
      )}

      {asking ? (
        // §6: the destructive confirm names the consequence, Cancel is the calm
        // default (it takes focus), and the confirm button is red. The sentence is
        // `RECEIVE_DONE_CONFIRM` from `shared/src/receive.ts` — one copy, shared
        // with the server that refuses the same action.
        <ConfirmModal
          question={COPY.confirmQuestion}
          consequence={RECEIVE_DONE_CONFIRM}
          confirmLabel={COPY.receiveDone}
          destructive
          busy={busy}
          onConfirm={() => void finish()}
          onCancel={() => setAsking(false)}
        />
      ) : null}
    </div>
  );
}
