// The Runs tab: publish a run, and act on the ones already scheduled.
//
// ONE PRIMARY ACTION AT A TIME (§1.1). The panel is in exactly one of three modes —
// reading the list, filling in the publish form, or editing one run — and each mode
// has a single high-emphasis button. That is why "Publish a run" opens a form rather
// than the form sitting permanently above a list that has its own Save.
//
// THE EDITOR OPENS INSIDE THE ROW IT BELONGS TO. It used to render above the whole
// list, which pushed every row down and left staff reading an editor with no visible
// tie to the run it was editing — on a list grouped by day, with several runs a day,
// that is a real chance of editing the wrong one. It now renders in the `<li>` of the
// selected run, under that row.
//
// A run minted from a repeating pattern no longer answers PRD cap 4's question before
// it opens anything. The choice — this date, or the weekly pattern — moved INTO the
// editor (`RunEditor`), which is where the invariants it protects are documented:
// I23 keeps a per-run edit off the pattern, I24 makes the pattern edit the only thing
// that changes it, and the editor's save path still branches on an explicit scope.
//
// TWO VIEWS OF ONE LIST (D73), and one editor between them. The list is this pantry
// week (D71) and the calendar carries its own range; whichever is on screen decides
// the `from`/`to` of the single fetch, and both open the same `RunEditor` — so the
// calendar adds no write path and no second set of guards to keep in step.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  BackLink,
  Button,
  EmptyState,
  ErrorBlock,
  List,
  ListItem,
  ListRow,
  Segmented,
  SkeletonRows,
  StatusChip,
} from '../../../components/index.ts';
import type { SegmentedOption } from '../../../components/index.ts';
import { useAsyncData, useSession } from '../../../app/index.ts';
import type { RouteDetail, ShiftSummary } from '../../../api/shared.ts';
import { PublishForm } from './PublishForm.tsx';
import { RunCalendar } from './RunCalendar.tsx';
import { RunEditor } from './RunEditor.tsx';
import { fetchRoutes, fetchRuns } from './api.ts';
import {
  COPY,
  calendarBounds,
  formatInstantRange,
  groupRunsByDay,
  initialCalendarView,
  pantryToday,
  runsInRange,
  thisWeekRange,
} from './logic.ts';
import type { CalendarView } from './logic.ts';

type Mode = { kind: 'list' } | { kind: 'publish' } | { kind: 'edit'; shiftId: string };

type ViewId = 'list' | 'calendar';

const VIEWS: readonly SegmentedOption<ViewId>[] = [
  { value: 'list', label: COPY.viewList },
  { value: 'calendar', label: COPY.viewCalendar },
];

export interface RunsPanelProps {
  /** Switch to the Recurring runs tab with this pattern loaded — "Edit the weekly
   *  pattern". Passed through to the editor, where the scope is chosen. */
  onEditPattern: (patternId: string) => void;
}

export function RunsPanel({ onEditPattern }: RunsPanelProps) {
  const { timezone } = useSession();
  const [mode, setMode] = useState<Mode>({ kind: 'list' });

  // Today at the PANTRY, not on this machine (A120): it bounds which runs are
  // fetched and which days the publish form offers, and a staff laptop in another
  // zone must not shift either.
  const today = pantryToday(new Date(), timezone);

  const [view, setView] = useState<ViewId>('list');
  const [calendar, setCalendar] = useState<CalendarView>(() => initialCalendarView(today));

  // WHAT IS ON SCREEN DECIDES WHAT IS FETCHED. The list is D71's bound — the pantry
  // week, Monday to Sunday (A178) — and the calendar's range is whatever staff set.
  // Neither is unbounded, which is the whole of D71: `GET /shifts` with only a
  // `from` is every run that will ever exist.
  const range = useMemo(
    () => (view === 'list' ? thisWeekRange(today) : calendarBounds(calendar)),
    [view, today, calendar],
  );

  const loadRuns = useCallback(
    (signal: AbortSignal) => fetchRuns(range.from, range.to, signal),
    [range],
  );
  const runs = useAsyncData<ShiftSummary[]>(loadRuns);
  // Filtered again on arrival: a response for the range staff have just left must
  // not paint into the one they are standing in.
  const inRange = useMemo(() => runsInRange(runs.data ?? [], range), [runs.data, range]);

  // Active routes only — an archived one is hidden from new use (I21), which is
  // exactly what publishing onto it would be.
  const loadRoutes = useCallback((signal: AbortSignal) => fetchRoutes(false, signal), []);
  const routes = useAsyncData<RouteDetail[]>(loadRoutes);

  const groups = useMemo(() => groupRunsByDay(inRange, today), [inRange, today]);
  const editing =
    mode.kind === 'edit' ? inRange.find((run) => run.id === mode.shiftId) ?? null : null;

  // A run being edited can leave the list under staff's feet — someone else
  // cancelled it, or it moved out of the window. Without this the panel sits in
  // edit mode with nothing to edit AND no primary action, since the Publish button
  // is hidden while editing.
  useEffect(() => {
    if (mode.kind === 'edit' && runs.data !== null && editing === null) {
      setMode({ kind: 'list' });
    }
  }, [mode, runs.data, editing]);

  // ONE EDITOR, both views (D73). It carries its own guards — `canSetDriver`,
  // `canCancelRun` and `canMoveRun` are all OPEN||CLAIMED, each with a server twin
  // — so an IN_PROGRESS or COMPLETED run opens from the calendar with the same
  // actions hidden that the list hides. The calendar adds no write path.
  //
  // Keyed by the run: the editor holds the note draft and the chosen scope in local
  // state, and switching runs without remounting would carry one run's draft onto
  // another.
  const renderEditor = (run: ShiftSummary) => (
    <RunEditor
      key={run.id}
      run={run}
      today={today}
      timeZone={timezone}
      onChanged={runs.reload}
      onClose={() => setMode({ kind: 'list' })}
      onEditPattern={onEditPattern}
    />
  );

  return (
    <div className="s16-panel">
      <div className="s16-panel__head">
        <h2 className="s16-heading">{COPY.runsHeading}</h2>
        {/* The panel's one primary action while the list is being read. */}
        {mode.kind === 'list' ? (
          <Button variant="primary" onClick={() => setMode({ kind: 'publish' })}>
            {COPY.publishHeading}
          </Button>
        ) : null}
      </div>

      {mode.kind === 'publish' ? (
        <>
          {/* §3's one way out, at the top of the thing it leaves and before that
              thing's heading (D43). The destination is a mode of this panel, not
              a URL — which is what BackLink is for — and the label is the list it
              returns to, in the words that list uses. */}
          <BackLink label={COPY.runsHeading} onBack={() => setMode({ kind: 'list' })} />
          <PublishForm
            routes={routes.data ?? []}
            today={today}
            onPublished={() => {
              runs.reload();
              setMode({ kind: 'list' });
            }}
          />
        </>
      ) : null}

      {/* D73's view switch. `filter` mode, not `tabs`: both views show the same
          runs and neither mounts a different panel, so these are two ways of
          looking at one list rather than two places to be. */}
      {mode.kind === 'publish' ? null : (
        <Segmented label={COPY.viewLabel} options={VIEWS} value={view} onChange={setView} />
      )}

      {view === 'calendar' ? (
        <RunCalendar
          view={calendar}
          onViewChange={(next) => {
            setCalendar(next);
            // The open editor belongs to a run that may not be in the new range.
            setMode({ kind: 'list' });
          }}
          runs={inRange}
          showLoading={runs.showLoading}
          error={runs.error}
          onRetry={runs.reload}
          today={today}
          selectedId={mode.kind === 'edit' ? mode.shiftId : null}
          onOpen={(run) => setMode({ kind: 'edit', shiftId: run.id })}
          renderEditor={renderEditor}
        />
      ) : (
        <RunsList
          groups={groups}
          showLoading={runs.showLoading}
          error={runs.error}
          onRetry={runs.reload}
          timeZone={timezone}
          selectedId={mode.kind === 'edit' ? mode.shiftId : null}
          onOpen={(run) => setMode({ kind: 'edit', shiftId: run.id })}
          // Rendered inside the selected row rather than passed as an element, so the
          // list does not have to know what an editor is. Keyed by the run: the editor
          // holds the note draft and the chosen scope in local state, and switching
          // runs without remounting would carry one run's draft onto another.
          renderEditor={(run) => <div className="s16-list-editor">{renderEditor(run)}</div>}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The list, and its three states (§3: "every list defines all three")
// ---------------------------------------------------------------------------

interface RunsListProps {
  groups: ReturnType<typeof groupRunsByDay>;
  showLoading: boolean;
  error: unknown;
  onRetry: () => void;
  timeZone: string | null;
  selectedId: string | null;
  onOpen: (run: ShiftSummary) => void;
  /** Drawn inside the selected run's own list item, under its row. */
  renderEditor: (run: ShiftSummary) => ReactNode;
}

function RunsList({
  groups,
  showLoading,
  error,
  onRetry,
  timeZone,
  selectedId,
  onOpen,
  renderEditor,
}: RunsListProps) {
  if (showLoading && groups.length === 0) return <SkeletonRows rows={5} label="Loading runs" />;
  if (error) return <ErrorBlock error={error} onRetry={onRetry} />;
  if (groups.length === 0) {
    return <EmptyState title={COPY.runsEmpty}>{COPY.runsEmptyBody}</EmptyState>;
  }

  return (
    <>
      {groups.map((group) => (
        <section className="s16-day" key={group.date}>
          {/* Two spans, not one string: the date half is held on one line by
              `.s16-day__date`, so "Aug 3" cannot be split across a wrap. The
              heading itself still breaks at the comma where it has to. */}
          <h3 className="s16-day__heading">
            {group.headingParts.lead},{' '}
            <span className="s16-day__date">{group.headingParts.date}</span>
          </h3>
          <List label={group.heading}>
            {group.runs.map((run) => (
              <ListItem key={run.id}>
                <ListRow
                  title={run.routeName}
                  subtitle={formatInstantRange(run.startsAt, run.endsAt, timeZone ?? undefined)}
                  meta={
                    <>
                      <span className="s16-run__owner">{run.ownerName ?? COPY.unowned}</span>
                      {run.recurrencePatternId !== null ? (
                        <span className="s16-run__tag">{COPY.repeatsTag}</span>
                      ) : null}
                      {/* I20's staff-assign exemption left its mark on this run:
                          the driver sees the same flag on their own view. */}
                      {run.assignedOverConflict ? (
                        <span className="s16-run__tag s16-run__tag--warn">
                          {COPY.conflictTag}
                        </span>
                      ) : null}
                    </>
                  }
                  side={
                    <>
                      <StatusChip status={run.status} />
                      {/* The whole row is the target (§3), so this names what the
                          row does rather than being a second control inside it.
                          Hidden from the reader, which has the row's own label. */}
                      <span className="s16-run__edit" aria-hidden="true">
                        {COPY.moveDateTime}
                      </span>
                    </>
                  }
                  onClick={() => onOpen(run)}
                  ariaLabel={
                    run.id === selectedId
                      ? `${run.routeName}, open for editing`
                      : `${run.routeName}, ${group.heading}`
                  }
                />
                {run.id === selectedId ? renderEditor(run) : null}
              </ListItem>
            ))}
          </List>
        </section>
      ))}
    </>
  );
}
