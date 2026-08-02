// The Recurring runs tab: the builder, the list of repeating runs, and staff's
// bulk-terminate.
//
// One primary action per mode (§1.1), same as the Runs tab: the list's primary opens
// the builder, and the builder's primary saves. The builder for an EXISTING rule
// renders inside that rule's own list row, so it appears where staff clicked instead
// of above a list that shifts down under them.
//
// The terminate range is the one destructive thing on this screen that is not a
// single row, so its confirm names the consequence twice over: these runs cannot come
// back (I10 — `CANCELLED` is terminal, and this is NOT the driver's release, which
// returns runs to the board), and the repeating run keeps making runs past the range
// unless staff also gives it an end date. Both of those are properties of
// `domain-modeling.md §5.3`, not of this screen.

import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
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
import { useAsyncData, useSession, useToast } from '../../../app/index.ts';
import type { RecurrencePatternSummary, RouteDetail } from '../../../api/shared.ts';
import { PatternForm } from './PatternForm.tsx';
import { DayPicker } from './controls.tsx';
import { fetchPatterns, fetchRoutes, terminatePattern } from './api.ts';
import {
  COPY,
  EMPTY_PATTERN,
  failureMessage,
  monthOf,
  pantryToday,
  patternFormOf,
  patternLine,
  pickRangeDay,
  validateTerminate,
} from './logic.ts';
import type { PatternForm as PatternFormState, TerminateRange } from './logic.ts';

export interface PatternsPanelProps {
  /** Set when the Runs tab sent staff here with "Edit the weekly pattern". */
  editPatternId: string | null;
  /** Called once that hand-off has been taken up, so a later tab switch does not
   *  reopen the same editor. */
  onEditConsumed: () => void;
}

export function PatternsPanel({ editPatternId, onEditConsumed }: PatternsPanelProps) {
  const { timezone } = useSession();
  const today = pantryToday(new Date(), timezone);

  const loadPatterns = useCallback((signal: AbortSignal) => fetchPatterns(signal), []);
  const patterns = useAsyncData<RecurrencePatternSummary[]>(loadPatterns);
  const loadRoutes = useCallback((signal: AbortSignal) => fetchRoutes(false, signal), []);
  const routes = useAsyncData<RouteDetail[]>(loadRoutes);

  const [form, setForm] = useState<PatternFormState | null>(null);

  // The hand-off from the Runs tab's "Edit the weekly pattern". It waits for the
  // list, because the form is built from the stored rule rather than from the run
  // that was tapped — I24's edit is on the pattern, not on an occurrence of it.
  useEffect(() => {
    if (editPatternId === null) return;
    const found = (patterns.data ?? []).find((pattern) => pattern.id === editPatternId);
    if (!found) return;
    setForm(patternFormOf(found));
    onEditConsumed();
  }, [editPatternId, patterns.data, onEditConsumed]);

  return (
    <div className="s16-panel">
      <div className="s16-panel__head">
        <h2 className="s16-heading">{COPY.tabRepeating}</h2>
        {form === null ? (
          <Button variant="primary" onClick={() => setForm(EMPTY_PATTERN)}>
            {COPY.repeatHeading}
          </Button>
        ) : null}
      </div>

      {/* A NEW repeating run has no row to open inside, so it builds at the top —
          the one case where the editor is not attached to a list item. */}
      {form !== null && form.patternId === null ? (
        <>
          <PatternForm
            key="new"
            form={form}
            onChange={setForm}
            routes={routes.data ?? []}
            onSaved={patterns.reload}
          />
          <Button variant="secondary" onClick={() => setForm(null)}>
            Back to the list
          </Button>
        </>
      ) : null}

      <PatternList
        patterns={patterns.data ?? []}
        today={today}
        showLoading={patterns.showLoading}
        error={patterns.error}
        onRetry={patterns.reload}
        selectedId={form?.patternId ?? null}
        onOpen={(pattern) => setForm(patternFormOf(pattern))}
        // Drawn inside the open repeating run's own list item. Both children are
        // keyed by which pattern it is: each holds a month and a draft range in
        // local state, and switching between two patterns without remounting would
        // carry one's working state onto the other.
        renderEditor={(pattern) =>
          form === null || form.patternId !== pattern.id ? null : (
            <div className="s16-list-editor">
              <PatternForm
                key={pattern.id}
                form={form}
                onChange={setForm}
                routes={routes.data ?? []}
                onSaved={patterns.reload}
              />
              <TerminateRangeForm
                key={`terminate-${pattern.id}`}
                patternId={pattern.id}
                today={today}
                onTerminated={patterns.reload}
              />
              <Button variant="secondary" onClick={() => setForm(null)}>
                Back to the list
              </Button>
            </div>
          )
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The list, and its three states (§3)
// ---------------------------------------------------------------------------

function PatternList({
  patterns,
  today,
  showLoading,
  error,
  onRetry,
  selectedId,
  onOpen,
  renderEditor,
}: {
  patterns: readonly RecurrencePatternSummary[];
  today: string;
  showLoading: boolean;
  error: unknown;
  onRetry: () => void;
  selectedId: string | null;
  onOpen: (pattern: RecurrencePatternSummary) => void;
  /** Drawn inside the open repeating run's own list item, under its row. */
  renderEditor: (pattern: RecurrencePatternSummary) => ReactNode;
}) {
  if (showLoading && patterns.length === 0) {
    return <SkeletonRows rows={3} label="Loading recurring runs" />;
  }
  if (error) return <ErrorBlock error={error} onRetry={onRetry} />;
  if (patterns.length === 0) {
    return <EmptyState title={COPY.repeatEmpty}>{COPY.repeatEmptyBody}</EmptyState>;
  }

  return (
    <List label={COPY.tabRepeating}>
      {patterns.map((pattern) => (
        <ListItem key={pattern.id}>
          <ListRow
            title={pattern.routeName}
            subtitle={patternLine(pattern, today)}
            meta={
              // "Claim every Tuesday" set this, or a staff assign did. It is the
              // driver a newly minted run is born CLAIMED to, when I25's gate lets it.
              pattern.ownerDefaultName !== null ? (
                <span className="s16-run__owner">{pattern.ownerDefaultName}</span>
              ) : null
            }
            onClick={() => onOpen(pattern)}
            ariaLabel={
              pattern.id === selectedId
                ? `${pattern.routeName}, open for editing`
                : `${pattern.routeName}, ${patternLine(pattern, today)}`
            }
          />
          {pattern.id === selectedId ? renderEditor(pattern) : null}
        </ListItem>
      ))}
    </List>
  );
}

// ---------------------------------------------------------------------------
// Bulk-terminate (§5.3)
// ---------------------------------------------------------------------------

function TerminateRangeForm({
  patternId,
  today,
  onTerminated,
}: {
  patternId: string;
  today: string;
  onTerminated: () => void;
}) {
  const toast = useToast();
  const [range, setRange] = useState<TerminateRange>({ fromDate: null, toDate: null });
  const [month, setMonth] = useState(() => monthOf(today, { year: 2026, month: 1 }));
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const go = async () => {
    if (range.fromDate === null || range.toDate === null) return;
    setBusy(true);
    setProblem(null);
    try {
      const result = await terminatePattern(patternId, {
        fromDate: range.fromDate,
        toDate: range.toDate,
      });
      toast.success(COPY.terminated(result.cancelled));
      setRange({ fromDate: null, toDate: null });
      setConfirming(false);
      onTerminated();
    } catch (cause) {
      setConfirming(false);
      setProblem(failureMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card ariaLabel={COPY.terminateHeading}>
      <h3 className="s16-heading">{COPY.terminateHeading}</h3>
      <p className="s16-hint">{COPY.terminateHint}</p>

      <DayPicker
        label={COPY.terminate}
        month={month}
        onMonthChange={setMonth}
        from={range.fromDate}
        to={range.toDate}
        earliest={today}
        onPick={(iso) => {
          setProblem(null);
          setRange((current) => pickRangeDay(current, iso));
        }}
      />

      {problem ? (
        <p className="s16-problem" role="alert">
          {problem}
        </p>
      ) : null}

      <Button
        variant="danger"
        onClick={() => {
          const invalid = validateTerminate(range);
          if (invalid !== null) {
            setProblem(invalid);
            return;
          }
          setConfirming(true);
        }}
      >
        {COPY.terminateGo}
      </Button>

      {confirming ? (
        <ConfirmModal
          question={COPY.terminateConfirm}
          consequence={COPY.terminateConsequence}
          confirmLabel={COPY.terminateGo}
          busy={busy}
          onConfirm={() => void go()}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </Card>
  );
}
