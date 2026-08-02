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
// TWO RULES THIS FILE HOLDS:
//
//   1. A skipped stop prints "skipped", never "0 lb". `total` is null there and
//      the two facts are different (§3.2).
//   2. If the run is not ready, the action is ABSENT, not disabled — and the
//      screen says what is still outstanding. The server refuses it anyway
//      (`RECEIVE_INCOMPLETE_MESSAGE`), but a button that fails is not an
//      interaction (§3: "prefer hiding over disabling").

import { useCallback, useState } from 'react';
import { useAsyncData, useRouter, useToast } from '../../../app/index.ts';
import type { ScreenProps } from '../../../app/index.ts';
import {
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
import { confirmReceiveDone, fetchReceiveDone } from './api.ts';
import {
  COPY,
  canFinish,
  doneNotice,
  lineStatus,
  messageFor,
  outstandingLines,
  runTitle,
  shouldReloadAfter,
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

  const load = useCallback(
    (signal: AbortSignal) => fetchReceiveDone(shiftId, signal),
    [shiftId],
  );
  const remote = useAsyncData<ReceiveDoneSummary>(load);

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
      go('receive-runs');
    } catch (error) {
      setAsking(false);
      toast.error(messageFor(error));
      // Someone else weighed the last stop, or closed the run from the other
      // tablet. Both are ordinary on a shared device and both are fixed by a
      // re-read rather than by asking the receiver to do anything.
      if (shouldReloadAfter(error)) remote.reload();
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
  const ready = canFinish(summary);
  const outstanding = outstandingLines(summary);

  return (
    <div className="s22b">
      <header className="s22b-head">
        <h1 className="s22b-title">{runTitle(summary)}</h1>
        <p className="s22b-lede">{ready ? COPY.ready : COPY.notReady}</p>
      </header>

      {summary.lines.length === 0 ? (
        <EmptyState title={COPY.noStops}>{COPY.noStopsHint}</EmptyState>
      ) : (
        <Card ariaLabel={COPY.linesLabel}>
          <StopLines lines={summary.lines} label={COPY.linesLabel} />
          <p className="s22b-total">
            <span className="s22b-total__label">{COPY.runTotalLabel}</span>
            <span className="r3-numeric">{weightWithUnit(summary.runTotal)}</span>
          </p>
        </Card>
      )}

      {ready ? (
        <div className="s22b-actions">
          <p className="s22b-hint">{COPY.readyHint}</p>
          {/* §1.1: exactly one high-emphasis button on the screen. */}
          <Button variant="primary" onClick={() => setAsking(true)}>
            {COPY.receiveDone}
          </Button>
          <Button variant="secondary" onClick={() => go('receive-runs')}>
            {COPY.backToRuns}
          </Button>
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
          <Button variant="primary" onClick={() => go('receive-runs')}>
            {COPY.backToRuns}
          </Button>
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
