// S1.2 — the shared shift board. `HOME_PATH` is `/board`, so this is where every
// signed-in user lands.
//
// "Purpose: see every shift and its owner; claim open runs." Everything on it is
// one of those two things: a vertical list of big rows grouped by day, and one
// action — Claim — on the rows that have no owner.
//
// The rules it renders are the SERVER's. `architecture.md §4.5`: a client-side
// check is communication, so a driver is not offered a button that would be
// refused; the refusal on `POST /shifts/:id/claim` is the rule itself. Nothing
// below decides who may claim what.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  EmptyState,
  ErrorBlock,
  List,
  ListItem,
  ListRow,
  Modal,
  SkeletonRows,
  StatusChip,
} from '../../../components/index.ts';
import {
  useAsyncData,
  useCurrentUser,
  useRouter,
  useSession,
  useToast,
} from '../../../app/index.ts';
import type { ScreenProps } from '../../../app/index.ts';
import { atLeastTier, hasDuty } from '../../../app/index.ts';
import { displayName } from '../../../api/index.ts';
import { toApiError } from '../../../api/index.ts';
import type { ClaimResult, ClaimScope, ShiftSummary } from '../../../api/shared.ts';
import { claimRun, fetchBoard } from './api.ts';
import { Segmented } from './Segmented.tsx';
import {
  BOARD_FILTERS,
  COPY,
  groupByDay,
  skippedLines,
  timeRange,
  todayCalendarDate,
  weekdayName,
  withOptimisticClaim,
} from './board.ts';
import type { BoardFilter, BoardRow, BoardViewer } from './board.ts';
import './board.css';

const FILTER_LABELS: Record<BoardFilter, string> = {
  ALL: COPY.filterAll,
  OPEN: COPY.filterOpen,
  MINE: COPY.filterMine,
};

const FILTER_OPTIONS = BOARD_FILTERS.map((value) => ({ value, label: FILTER_LABELS[value] }));

export function BoardScreen(_props: ScreenProps) {
  const user = useCurrentUser();
  const { timezone } = useSession();
  const { go } = useRouter();
  const toast = useToast();

  const [filter, setFilter] = useState<BoardFilter>('ALL');
  /** §6's optimistic claim, held apart from the fetched list so a revert is one
   *  `setState(null)` rather than a second copy of the board to keep in step. */
  const [claimedNow, setClaimedNow] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** The repeating-run prompt: "Claim every Tuesday run, or just this one?" */
  const [scopePrompt, setScopePrompt] = useState<ShiftSummary | null>(null);
  /** A series claim that skipped at least one run. Kept on screen after the toast
   *  has gone, because S1.2 wants a link to the skipped dates and §3 forbids a
   *  toast being the only signal for something that mattered. */
  const [partial, setPartial] = useState<ClaimResult | null>(null);
  const [showSkipped, setShowSkipped] = useState(false);

  const today = todayCalendarDate();
  const load = useCallback(
    (signal: AbortSignal) => fetchBoard(filter, today, signal),
    [filter, today],
  );
  const state = useAsyncData<ShiftSummary[]>(load);

  // The optimistic row stands until the server's own answer replaces it. Dropping
  // it the moment the request resolves would flash the run back to OPEN for as long
  // as the reload takes, which is exactly the flicker §6's "updates instantly" is
  // there to avoid.
  useEffect(() => setClaimedNow(null), [state.data]);

  const viewer = useMemo<BoardViewer>(
    () => ({
      id: user.id,
      // Tier is hierarchical, so Admin passes a Staff floor without being named (I1).
      isStaff: atLeastTier(user, 'STAFF'),
      // Duty is set membership — a Staff coordinator who does not drive cannot
      // claim, and the server declares `anyDuty: ['DRIVE']` on claim for that
      // reason (I2).
      canDrive: hasDuty(user, 'DRIVE'),
    }),
    [user],
  );

  const groups = useMemo(() => {
    const shifts = state.data ?? [];
    const shown = claimedNow
      ? withOptimisticClaim(shifts, claimedNow, { id: user.id, name: displayName(user) })
      : shifts;
    return groupByDay(shown, viewer);
  }, [state.data, claimedNow, viewer, user]);

  async function runClaim(shift: ShiftSummary, scope: ClaimScope) {
    setScopePrompt(null);
    setBusyId(shift.id);
    setClaimedNow(shift.id); // §6: "claiming a shift updates instantly"
    try {
      const result = await claimRun(shift.id, scope);
      // Partial success IS success (PRD cap 6): the runs that conflicted were
      // skipped by I20's gate, never force-claimed. S1.2 shows the summary only
      // when something was skipped; a full claim gets the unremarkable toast.
      if (result.partial) {
        setPartial(result);
        toast.show(result.claimed.length === 0 ? 'error' : 'success', result.summary, {
          label: COPY.seeSkipped,
          onClick: () => setShowSkipped(true),
        });
      } else {
        setPartial(null);
        toast.success(result.summary);
      }
    } catch (cause) {
      // The lost race, and every other refusal. The server already wrote the
      // sentence — "That run was just taken by Karen.", "You already have a run at
      // that time — release it first." — so it is shown verbatim rather than
      // re-worded here.
      const error = toApiError(cause);
      setClaimedNow(null); // §6: "revert with a clear toast"
      toast.error(error.detail ?? error.message);
    } finally {
      setBusyId(null);
      state.reload();
    }
  }

  function onClaim(shift: ShiftSummary) {
    // S1.2: a repeating run asks first. A one-off has nothing to ask about.
    if (shift.recurrencePatternId !== null) setScopePrompt(shift);
    else void runClaim(shift, 'ONE');
  }

  return (
    <div className="r3-board">
      <div className="r3-board__head">
        <h1 className="r3-board__title">{COPY.header}</h1>
        <Segmented
          label={COPY.filterLabel}
          options={FILTER_OPTIONS}
          value={filter}
          onChange={(next) => {
            setFilter(next);
            setPartial(null);
          }}
        />
      </div>

      {partial ? (
        <PartialSummary
          result={partial}
          onSee={() => setShowSkipped(true)}
          onDismiss={() => setPartial(null)}
        />
      ) : null}

      <BoardBody
        groups={groups}
        filter={filter}
        showLoading={state.showLoading}
        error={state.error}
        onRetry={state.reload}
        busyId={busyId}
        timeZone={timezone}
        onClaim={onClaim}
        onOpen={(shiftId) => go('shift', { shiftId })}
      />

      {scopePrompt ? (
        <ClaimScopePrompt
          shift={scopePrompt}
          busy={busyId === scopePrompt.id}
          onCancel={() => setScopePrompt(null)}
          onChoose={(scope) => void runClaim(scopePrompt, scope)}
        />
      ) : null}

      {showSkipped && partial ? (
        <SkippedRuns result={partial} onClose={() => setShowSkipped(false)} />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The list, and its three states (§3: "every list defines all three")
// ---------------------------------------------------------------------------

interface BoardBodyProps {
  groups: ReturnType<typeof groupByDay>;
  filter: BoardFilter;
  showLoading: boolean;
  error: unknown;
  onRetry: () => void;
  busyId: string | null;
  /** Pantry zone from the session (A120); null until it loads. */
  timeZone: string | null;
  onClaim: (shift: ShiftSummary) => void;
  onOpen: (shiftId: string) => void;
}

function BoardBody({
  groups,
  filter,
  showLoading,
  error,
  onRetry,
  busyId,
  timeZone,
  onClaim,
  onOpen,
}: BoardBodyProps) {
  // Loading first, and only after 300ms (§6) — skeleton rows sized like the real
  // ones so the board does not jump when they are replaced.
  if (showLoading && groups.length === 0) return <SkeletonRows rows={5} label="Loading runs" />;
  // Offline is a blocking banner the shell raises globally (§6); this is the
  // recoverable, plain, code-free error the same pattern asks for otherwise.
  if (error) return <ErrorBlock error={error} onRetry={onRetry} />;
  if (groups.length === 0) return <BoardEmpty filter={filter} />;

  return (
    <>
      {groups.map((group) => (
        <section className="r3-board__day" key={group.date}>
          <h2 className="r3-board__day-heading">{group.heading}</h2>
          <List label={group.heading}>
            {group.rows.map((row) => (
              <ListItem key={row.shift.id}>
                <Row
                  row={row}
                  busy={busyId === row.shift.id}
                  timeZone={timeZone}
                  onClaim={onClaim}
                  onOpen={onOpen}
                />
              </ListItem>
            ))}
          </List>
        </section>
      ))}
    </>
  );
}

/** §6: empty states are instructive — "say what to do next, not just nothing here". */
function BoardEmpty({ filter }: { filter: BoardFilter }) {
  if (filter === 'OPEN') {
    return <EmptyState title={COPY.emptyOpen}>{COPY.emptyOpenBody}</EmptyState>;
  }
  if (filter === 'MINE') {
    return <EmptyState title={COPY.emptyMine}>{COPY.emptyMineBody}</EmptyState>;
  }
  return <EmptyState title={COPY.emptyAll}>{COPY.emptyAllBody}</EmptyState>;
}

// ---------------------------------------------------------------------------
// One row
//
// S1.2: "Each row: date/time, route name, truck, owner name (or 'OPEN'), status
// chip." The date is the day heading above; the row carries the rest.
// ---------------------------------------------------------------------------

interface RowProps {
  row: BoardRow;
  busy: boolean;
  /** The pantry's zone, so a row reads the same on any device (A120). */
  timeZone: string | null;
  onClaim: (shift: ShiftSummary) => void;
  onOpen: (shiftId: string) => void;
}

function Row({ row, busy, timeZone, onClaim, onOpen }: RowProps) {
  const { shift } = row;
  const when = timeRange(shift.startsAt, shift.endsAt, timeZone ?? undefined);
  const owner = shift.ownerName ?? COPY.unowned;

  const chip = (
    <StatusChip status={shift.status} mine={row.mine} atRisk={row.atRisk} />
  );

  const meta = (
    <>
      <span className="r3-board__owner">{owner}</span>
      {shift.truckName ? <span className="r3-board__truck">{shift.truckName}</span> : null}
      {row.repeats ? <span className="r3-board__repeats">{COPY.repeatsTag}</span> : null}
    </>
  );

  // A Claim button cannot live inside a row that is itself a button, so an open row
  // is a static row carrying its own action. That matches S1.2 anyway: an open
  // row's one action is Claim, not "open the detail".
  if (row.action === 'CLAIM') {
    return (
      <ListRow
        title={shift.routeName}
        subtitle={when}
        meta={meta}
        side={
          <span className="r3-board__side">
            {chip}
            <Button
              variant="primary"
              loading={busy}
              onClick={() => onClaim(shift)}
              aria-label={COPY.claimAria(shift.routeName, when)}
            >
              {COPY.claim}
            </Button>
          </span>
        }
      />
    );
  }

  if (row.action === 'DETAIL') {
    return (
      <ListRow
        title={shift.routeName}
        subtitle={when}
        meta={meta}
        side={chip}
        onClick={() => onOpen(shift.id)}
      />
    );
  }

  return <ListRow title={shift.routeName} subtitle={when} meta={meta} side={chip} />;
}

// ---------------------------------------------------------------------------
// "Claim every Tuesday run, or just this one?"
// ---------------------------------------------------------------------------

interface ClaimScopePromptProps {
  shift: ShiftSummary;
  busy: boolean;
  onCancel: () => void;
  onChoose: (scope: ClaimScope) => void;
}

function ClaimScopePrompt({ shift, busy, onCancel, onChoose }: ClaimScopePromptProps) {
  // Named from this run's own calendar slot, which is the day S1.2's sentence is
  // about. A pattern repeating on several weekdays is described by the server's
  // own `summary` afterwards (`weekdayLabel`), so the two never contradict.
  const weekday = weekdayName(shift.occurrenceDate);

  return (
    <Modal
      question={COPY.scopeQuestion(weekday)}
      onCancel={onCancel}
      actions={
        <>
          <Button variant="secondary" onClick={() => onChoose('ONE')} loading={busy}>
            {COPY.scopeOne}
          </Button>
          <Button variant="primary" onClick={() => onChoose('SERIES')} loading={busy}>
            {COPY.scopeSeries(weekday)}
          </Button>
        </>
      }
    >
      {COPY.scopeConsequence}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Partial success (S1.2)
// ---------------------------------------------------------------------------

function PartialSummary({
  result,
  onSee,
  onDismiss,
}: {
  result: ClaimResult;
  onSee: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="r3-board__summary">
      <Card ariaLabel={COPY.skippedTitle}>
        <p className="r3-board__summary-text">{result.summary}</p>
        <div className="r3-board__summary-actions">
          <Button variant="secondary" onClick={onSee}>
            {COPY.seeSkipped}
          </Button>
          <Button variant="secondary" onClick={onDismiss}>
            {COPY.dismissSummary}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function SkippedRuns({ result, onClose }: { result: ClaimResult; onClose: () => void }) {
  const lines = skippedLines(result.skipped);

  return (
    <Modal
      question={COPY.skippedTitle}
      onCancel={onClose}
      showCancel={false}
      actions={
        <Button variant="primary" onClick={onClose}>
          {COPY.skippedDone}
        </Button>
      }
    >
      <ul className="r3-board__skipped">
        {lines.map((line) => (
          <li className="r3-board__skipped-item" key={line.shiftId}>
            <span className="r3-board__skipped-when">{line.when}</span>
            <span className="r3-board__skipped-route">{line.routeName}</span>
            <span className="r3-board__skipped-reason">{line.reason}</span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
