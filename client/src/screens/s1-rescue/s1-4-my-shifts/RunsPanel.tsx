// "My runs" — every run this driver owns, split into what is coming and what has
// been.
//
// The row is the whole target (§3) and opens the run itself (S1.3), which is where
// **Release run** lives. Release is deliberately NOT duplicated here: S1.3 owns
// that action and its "just this one, or this and future?" prompt, and a second
// entry point would be a second confirm dialog to keep in step with it.
//
// A run that has started stays `IN_PROGRESS` for good in Phase 1 (build-plan D1),
// so an old in-progress run sitting in "Earlier" is the expected result of I11,
// not a stuck row to explain away in copy.

import { Button, EmptyState, ErrorBlock, List, ListItem, ListRow, SkeletonRows, StatusChip } from '../../../components/index.ts';
import { useAsyncData, useRouter } from '../../../app/index.ts';
import { useCallback } from 'react';
import { fetchMyRuns } from './data.ts';
import { formatRunWhen, groupRuns } from './logic.ts';
import type { ShiftSummary } from '../../../api/shared.ts';

function RunRow({ run, now, onOpen }: { run: ShiftSummary; now: Date; onOpen: () => void }) {
  return (
    <ListItem>
      <ListRow
        title={run.routeName}
        subtitle={formatRunWhen(run, now)}
        {...(run.truckName ? { meta: run.truckName } : {})}
        // Every row here is one this driver owns, so CLAIMED renders as the
        // ownership overlay "Mine" (§3) rather than the neutral Claimed chip.
        side={<StatusChip status={run.status} mine />}
        onClick={onOpen}
        ariaLabel={`${run.routeName}, ${formatRunWhen(run, now)}`}
      />
    </ListItem>
  );
}

export function RunsPanel() {
  const { go } = useRouter();
  const load = useCallback((signal: AbortSignal) => fetchMyRuns(signal), []);
  const state = useAsyncData(load);
  const now = new Date();

  if (state.error) return <ErrorBlock error={state.error} onRetry={state.reload} />;
  // Nothing at all under 300ms (§6) — `showLoading` already carries the delay.
  if (state.data === null) {
    return state.showLoading ? <SkeletonRows rows={4} label="Loading your runs" /> : null;
  }

  const { upcoming, past } = groupRuns(state.data, now.getTime());

  if (upcoming.length === 0 && past.length === 0) {
    return (
      <EmptyState
        title="You're not on any runs yet."
        action={
          <Button variant="primary" onClick={() => go('board')}>
            See open runs
          </Button>
        }
      >
        Open runs are on the board — take one from there.
      </EmptyState>
    );
  }

  return (
    <>
      <h2 className="s14-heading">Coming up</h2>
      {upcoming.length === 0 ? (
        <EmptyState
          title="Nothing coming up."
          action={
            <Button variant="primary" onClick={() => go('board')}>
              See open runs
            </Button>
          }
        >
          Open runs are on the board — take one from there.
        </EmptyState>
      ) : (
        <List label="Your runs coming up">
          {upcoming.map((run) => (
            <RunRow
              key={run.id}
              run={run}
              now={now}
              onOpen={() => go('shift', { shiftId: run.id })}
            />
          ))}
        </List>
      )}

      {past.length > 0 ? (
        <>
          <h2 className="s14-heading">Earlier</h2>
          <List label="Your earlier runs">
            {past.map((run) => (
              <RunRow
                key={run.id}
                run={run}
                now={now}
                onOpen={() => go('shift', { shiftId: run.id })}
              />
            ))}
          </List>
        </>
      ) : null}
    </>
  );
}
