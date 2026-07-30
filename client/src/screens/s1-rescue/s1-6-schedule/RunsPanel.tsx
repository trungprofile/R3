// The Runs tab: publish a run, and act on the ones already scheduled.
//
// ONE PRIMARY ACTION AT A TIME (§1.1). The panel is in exactly one of three modes —
// reading the list, filling in the publish form, or editing one run — and each mode
// has a single high-emphasis button. That is why "Publish a run" opens a form rather
// than the form sitting permanently above a list that has its own Save.
//
// A run minted from a repeating pattern asks the question PRD cap 4 requires before
// it opens anything: "Edit just this date, or the weekly pattern?". The two are
// different operations on different rows — I23 keeps a per-run edit off the pattern,
// I24 makes the pattern edit the only thing that changes it — and the prompt is what
// stops staff performing one while intending the other.

import { useCallback, useMemo, useState } from 'react';
import {
  Button,
  EmptyState,
  ErrorBlock,
  List,
  ListItem,
  ListRow,
  Modal,
  SkeletonRows,
  StatusChip,
} from '../../../components/index.ts';
import { useAsyncData, useSession, useToast } from '../../../app/index.ts';
import type { RouteDetail, ShiftSummary } from '../../../api/shared.ts';
import { PublishForm } from './PublishForm.tsx';
import { RunEditor } from './RunEditor.tsx';
import { fetchRoutes, fetchRuns } from './api.ts';
import {
  COPY,
  formatInstantRange,
  groupRunsByDay,
  needsEditScope,
  pantryToday,
} from './logic.ts';

type Mode = { kind: 'list' } | { kind: 'publish' } | { kind: 'edit'; shiftId: string };

export interface RunsPanelProps {
  /** Switch to the Repeating tab with this pattern loaded — "Edit the weekly
   *  pattern". */
  onEditPattern: (patternId: string) => void;
}

export function RunsPanel({ onEditPattern }: RunsPanelProps) {
  const { timezone } = useSession();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  /** The scope prompt for a repeating run, held until staff answers it. */
  const [scopeFor, setScopeFor] = useState<ShiftSummary | null>(null);

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

  const open = (run: ShiftSummary) => {
    if (needsEditScope(run)) setScopeFor(run);
    else setMode({ kind: 'edit', shiftId: run.id });
  };

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

      {mode.kind === 'edit' && editing !== null ? (
        <RunEditor
          run={editing}
          today={today}
          timeZone={timezone}
          onChanged={runs.reload}
          onClose={() => setMode({ kind: 'list' })}
        />
      ) : null}

      <RunsList
        groups={groups}
        showLoading={runs.showLoading}
        error={runs.error}
        onRetry={runs.reload}
        timeZone={timezone}
        selectedId={mode.kind === 'edit' ? mode.shiftId : null}
        onOpen={open}
      />

      {scopeFor !== null ? (
        <Modal
          question={COPY.editScopeQuestion}
          onCancel={() => setScopeFor(null)}
          actions={
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setMode({ kind: 'edit', shiftId: scopeFor.id });
                  setScopeFor(null);
                }}
              >
                {COPY.editThisDate}
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  const patternId = scopeFor.recurrencePatternId;
                  setScopeFor(null);
                  // Non-null by construction: the prompt only opens for a run that
                  // came from a pattern (`needsEditScope`).
                  if (patternId !== null) onEditPattern(patternId);
                  else toast.error(COPY.repeatEmpty);
                }}
              >
                {COPY.editThePattern}
              </Button>
            </>
          }
        >
          {COPY.editScopeConsequence}
        </Modal>
      ) : null}
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
}

function RunsList({
  groups,
  showLoading,
  error,
  onRetry,
  timeZone,
  selectedId,
  onOpen,
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
                  side={<StatusChip status={run.status} />}
                  onClick={() => onOpen(run)}
                  ariaLabel={
                    run.id === selectedId
                      ? `${run.routeName} — open below`
                      : `${run.routeName}, ${group.heading}`
                  }
                />
              </ListItem>
            ))}
          </List>
        </section>
      ))}
    </>
  );
}
