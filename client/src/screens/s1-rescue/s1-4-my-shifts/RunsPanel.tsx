// "Today's pickup" — today's run, then the rest of the week (D49).
//
// This used to be the "My runs" half of a tabbed S1.4, which was itself the second
// tab of the board: two nested tab rows for one job. D49 makes it a page of its own
// at `/my-shifts`, with no tabs at all, and the only thing that had to stay behind —
// "When I'm away" — is a tab on the board instead.
//
// The two bands are not the old two. "Coming up / Earlier" sorted by the clock; this
// sorts by the pantry's CALENDAR, because the driver reading it is usually standing
// in the car park about to do the run. Today is large and first. The week around it
// is a compact summary, completed and upcoming together, so "did I do Monday?" and
// "what is Thursday?" are one screen and not two.
//
// The row is the whole target (§3) and opens the run itself (S1.3), which is where
// **Release run** lives. Release is deliberately NOT duplicated here: S1.3 owns that
// action and its "just this one, or this and future?" prompt, and a second entry
// point would be a second confirm dialog to keep in step with it.

import { useCallback } from 'react';
import {
  Button,
  Card,
  EmptyState,
  ErrorBlock,
  List,
  ListItem,
  ListRow,
  SkeletonRows,
  StatusChip,
} from '../../../components/index.ts';
import { useAsyncData, useRouter, useSession, todayInZone } from '../../../app/index.ts';
import { weekEndOf, weekStartOf } from '../../../app/week.ts';
import { fetchMyRuns } from './data.ts';
import { COPY, bandRuns, formatRunHours, formatRunWhen } from './logic.ts';
import type { ShiftSummary } from '../../../api/shared.ts';

/**
 * Today's run, as the one thing on screen that is not a list.
 *
 * A card rather than a big row because it is not one of a set — it is the job. Route
 * name, hours, truck, and the chip that says whether the driver has started it or is
 * already on the way back (D48).
 */
function TodayCard({
  run,
  timeZone,
  onOpen,
}: {
  run: ShiftSummary;
  timeZone: string | null;
  onOpen: () => void;
}) {
  return (
    <Card ariaLabel={run.routeName}>
      <div className="s14-today">
        <div className="s14-today__head">
          <h3 className="s14-today__route">{run.routeName}</h3>
          {/* D48: `IN_PROGRESS` with `pickup_completed_at` set reads "Returning".
              The run has not completed — I27 is a milestone inside IN_PROGRESS and
              only the receiver's receive-done closes a shift (I11). */}
          <StatusChip
            status={run.status}
            mine
            pickupCompletedAt={run.pickupCompletedAt}
          />
        </div>
        <p className="s14-today__when">{formatRunHours(run, timeZone)}</p>
        {run.truckName ? <p className="s14-today__truck">{run.truckName}</p> : null}
        {/* `block`: the card's one action, full width — the easiest thing to hit
            one-handed in a truck (§1.2). */}
        <Button variant="primary" block onClick={onOpen}>
          {COPY.openRun}
        </Button>
      </div>
    </Card>
  );
}

/** One line of "This week" — small, because the week is context and today is the
 *  work. Same chip rules as the card above. */
function WeekRow({
  run,
  now,
  timeZone,
  onOpen,
}: {
  run: ShiftSummary;
  now: Date;
  timeZone: string | null;
  onOpen: () => void;
}) {
  const when = formatRunWhen(run, now, timeZone);
  return (
    <ListItem>
      <ListRow
        title={run.routeName}
        subtitle={when}
        {...(run.truckName ? { meta: run.truckName } : {})}
        // Every row here is one this driver owns, so CLAIMED renders as the
        // ownership overlay "Mine" (§3) rather than the neutral Claimed chip.
        side={<StatusChip status={run.status} mine pickupCompletedAt={run.pickupCompletedAt} />}
        onClick={onOpen}
        ariaLabel={`${run.routeName}, ${when}`}
      />
    </ListItem>
  );
}

export function RunsPanel() {
  const { go } = useRouter();
  const { timezone } = useSession();
  const load = useCallback((signal: AbortSignal) => fetchMyRuns(signal), []);
  const state = useAsyncData(load);
  const now = new Date();

  // The PANTRY's today (A120), never the device's. This panel used to ask
  // `new Date()`, which put a run in the wrong band for any driver whose phone had
  // rolled past midnight before the pantry had — and "is this run today?" is exactly
  // the question that must not be answered by the device.
  const today = todayInZone(timezone);
  const weekStart = weekStartOf(today);
  const weekEnd = weekEndOf(weekStart);

  if (state.error) return <ErrorBlock error={state.error} onRetry={state.reload} />;
  // Nothing at all under 300ms (§6) — `showLoading` already carries the delay.
  if (state.data === null) {
    return state.showLoading ? <SkeletonRows rows={4} label="Loading your runs" /> : null;
  }

  const bands = bandRuns(state.data, today, weekStart, weekEnd);
  const openRun = (run: ShiftSummary) => go('shift', { shiftId: run.id });

  if (bands.today.length === 0 && bands.week.length === 0 && bands.laterCount === 0) {
    return (
      <EmptyState
        title={COPY.noRuns}
        action={
          <Button variant="primary" onClick={() => go('board')}>
            {COPY.seeBoard}
          </Button>
        }
      >
        {COPY.noRunsBody}
      </EmptyState>
    );
  }

  return (
    <>
      <h2 className="s14-heading">{COPY.todayHeading}</h2>
      {bands.today.length === 0 ? (
        <EmptyState
          title={COPY.noneToday}
          action={
            <Button variant="primary" onClick={() => go('board')}>
              {COPY.seeBoard}
            </Button>
          }
        >
          {COPY.noneTodayBody}
        </EmptyState>
      ) : (
        <div className="s14-today-list">
          {bands.today.map((run) => (
            <TodayCard
              key={run.id}
              run={run}
              timeZone={timezone}
              onOpen={() => openRun(run)}
            />
          ))}
        </div>
      )}

      <h2 className="s14-heading">{COPY.weekHeading}</h2>
      {bands.week.length === 0 ? (
        <p className="s14-hint">{COPY.restOfWeekEmpty}</p>
      ) : (
        <List label="Your runs this week">
          {bands.week.map((run) => (
            <WeekRow
              key={run.id}
              run={run}
              now={now}
              timeZone={timezone}
              onOpen={() => openRun(run)}
            />
          ))}
        </List>
      )}

      {/* A run beyond this week is not shown and must not be silently dropped: this
          page has no week control (it is about now), and the board's Mine filter
          does. So the count is turned into directions rather than a third band. */}
      {bands.laterCount > 0 ? <p className="s14-hint">{COPY.laterElsewhere}</p> : null}
    </>
  );
}
