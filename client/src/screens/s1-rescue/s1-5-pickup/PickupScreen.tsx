// S1.5 Driver pickup execution — the full-screen takeover.
//
// `ui-ux-spec.md S1.5`, held in one hand, in a truck, possibly on bad signal. No
// nav and nothing on screen the task does not need (§1.7): one route, its stops,
// and the one thing to do next.
//
// The screen has three faces and this file only picks between them:
//   - START   `CLAIMED`: one big step, pick a truck (I8). Starting takes the I5
//             snapshot server-side.
//   - ACTIVE  `IN_PROGRESS`: the stop list, and — once no stop is `PENDING` —
//             "Heading back" (I27).
//   - nothing to do here, for a run that is not this driver's to run.
//
// `route.fullScreen` in `app/routes.ts` is what removes the nav; the shell reads
// it. This lane does not edit that file.

import { useCallback, useEffect, useState } from 'react';
import { useAsyncData, useCurrentUser, useRouter } from '../../../app/index.ts';
import type { ScreenProps } from '../../../app/index.ts';
import { Button, EmptyState, ErrorBlock, SkeletonRows } from '../../../components/index.ts';
import type { RunDetail } from '../../../api/shared.ts';
import { fetchRun } from './api.ts';
import { COPY, phaseFor } from './logic.ts';
import { RunView } from './RunView.tsx';
import { StartStep } from './StartStep.tsx';
import './pickup.css';

export function PickupScreen({ params }: ScreenProps) {
  const shiftId = params['shiftId'] ?? '';
  const viewer = useCurrentUser();
  const { go } = useRouter();

  const load = useCallback((signal: AbortSignal) => fetchRun(shiftId, signal), [shiftId]);
  const remote = useAsyncData<RunDetail>(load);

  // The run is edited in place by every action on this screen, so it is state
  // here rather than read straight off the fetch. Each write returns the updated
  // row and replaces it — no second round trip on a phone with one bar.
  const [run, setRun] = useState<RunDetail | null>(null);
  useEffect(() => {
    if (remote.data) setRun(remote.data);
  }, [remote.data]);

  if (!run) {
    if (remote.error) {
      return (
        <div className="r3-pickup">
          <ErrorBlock error={remote.error} onRetry={remote.reload} />
        </div>
      );
    }
    if (remote.showLoading) {
      return (
        <div className="r3-pickup">
          <SkeletonRows rows={4} label={COPY.loadingRun} />
        </div>
      );
    }
    // Under 300ms, nothing at all (§6).
    return null;
  }

  const phase = phaseFor(run, viewer.id);

  if (phase.kind === 'unavailable') {
    return (
      <div className="r3-pickup">
        <EmptyState
          title={phase.title}
          action={
            <Button variant="primary" onClick={() => go('board')}>
              {COPY.goToBoard}
            </Button>
          }
        >
          {phase.next}
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="r3-pickup">
      {phase.kind === 'start' ? (
        <StartStep run={run} onStarted={setRun} />
      ) : (
        <RunView run={run} onRun={setRun} onReload={remote.reload} />
      )}
    </div>
  );
}
