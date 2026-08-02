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

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Button,
  EmptyState,
  ErrorBlock,
  List,
  ListItem,
  ListRow,
  SkeletonRows,
  StatusChip,
} from '../../../components/index.ts';
import { useAsyncData, useSession } from '../../../app/index.ts';
import type { RouteDetail, ShiftSummary } from '../../../api/shared.ts';
import { PublishForm } from './PublishForm.tsx';
import { RunEditor } from './RunEditor.tsx';
import { fetchRoutes, fetchRuns } from './api.ts';
import { COPY, formatInstantRange, groupRunsByDay, pantryToday } from './logic.ts';

type Mode = { kind: 'list' } | { kind: 'publish' } | { kind: 'edit'; shiftId: string };

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

  const loadRuns = useCallback((signal: AbortSignal) => fetchRuns(today, signal), [today]);
  const runs = useAsyncData<ShiftSummary[]>(loadRuns);

  // Active routes only — an archived one is hidden from new use (I21), which is
  // exactly what publishing onto it would be.
  const loadRoutes = useCallback((signal: AbortSignal) => fetchRoutes(false, signal), []);
  const routes = useAsyncData<RouteDetail[]>(loadRoutes);

  const groups = useMemo(() => groupRunsByDay(runs.data ?? [], today), [runs.data, today]);
  const editing =
    mode.kind === 'edit'
      ? (runs.data ?? []).find((run) => run.id === mode.shiftId) ?? null
      : null;

  // A run being edited can leave the list under staff's feet — someone else
  // cancelled it, or it moved out of the window. Without this the panel sits in
  // edit mode with nothing to edit AND no primary action, since the Publish button
  // is hidden while editing.
  useEffect(() => {
    if (mode.kind === 'edit' && runs.data !== null && editing === null) {
      setMode({ kind: 'list' });
    }
  }, [mode, runs.data, editing]);

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
          <PublishForm
            routes={routes.data ?? []}
            today={today}
            onPublished={() => {
              runs.reload();
              setMode({ kind: 'list' });
            }}
          />
          <Button variant="secondary" onClick={() => setMode({ kind: 'list' })}>
            Back to the runs
          </Button>
        </>
      ) : null}

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
        renderEditor={(run) => (
          <div className="s16-list-editor">
            <RunEditor
              key={run.id}
              run={run}
              today={today}
              timeZone={timezone}
              onChanged={runs.reload}
              onClose={() => setMode({ kind: 'list' })}
              onEditPattern={onEditPattern}
            />
          </div>
        )}
      />
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
          <h3 className="s16-day__heading">{group.heading}</h3>
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
