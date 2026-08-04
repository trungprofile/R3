// S1.2 — the shared shift board. `HOME_PATH` is `/board`, so this is where every
// signed-in user lands.
//
// "Purpose: see every shift and its owner; claim open runs." Everything on it is
// one of those two things: a vertical list of big rows grouped by day, and one
// action — Claim — on the rows that have no owner.
//
// THE BOARD BROWSES; SCHEDULE MANAGES (D63). Staff used to get a per-row Edit that
// deep-linked into S1.6. It was the one place the board addressed you as staff
// rather than as someone looking for a run, and it is gone: S1.6 is one nav entry
// away and is where a run's date, time and route are changed.
//
// The rules it renders are the SERVER's. `architecture.md §4.5`: a client-side
// check is communication, so a driver is not offered a button that would be
// refused; the refusal on `POST /shifts/:id/claim` is the rule itself. Nothing
// below decides who may claim what.
//
// TWO TABS, ONE LEVEL DEEP, SINCE D49. D30 mounted the whole of S1.4 here as a
// `mine` tab, which meant a driver hit a second tab row inside the first. D49 splits
// the two jobs into two sibling pages instead: `/my-shifts` ("Today's pickup", D64) is the
// driver's own runs, and this screen is the claimable board plus the one part of
// S1.4 that has no page of its own — "When I'm away", which §4 gives no nav entry.
// A coordinator who does not drive gets no tab row at all: one tab is noise.
//
// The tab is in the URL (`?tab=`), the pattern S1.8 established: a tab is then a
// link someone can send and a reload lands where it left off — which the old inner
// `runs|away` row, held in local `useState`, could never be. It moves with
// `setQuery`, which replaces rather than pushes — a tab is not a place anyone should
// have to press Back through. `board.ts` holds the values and the reasoning.
//
// Exactly one panel is mounted, which is the other half of `tabPanelProps`'
// contract and also why the board's own state and its fetch live in `RunBoardPanel`
// below rather than up here: on the My shifts tab there is no board to load.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  ChevronLeftIcon,
  ChevronRightIcon,
  EmptyState,
  ErrorBlock,
  List,
  ListItem,
  ListRow,
  Modal,
  Segmented,
  SkeletonRows,
  StatusChip,
  tabPanelProps,
} from '../../../components/index.ts';
import {
  useAsyncData,
  useCurrentUser,
  useRouter,
  useSession,
  useToast,
} from '../../../app/index.ts';
import type { ScreenProps } from '../../../app/index.ts';
import { atLeastTier, hasDuty, todayInZone } from '../../../app/index.ts';
import { displayName } from '../../../api/index.ts';
import { toApiError } from '../../../api/index.ts';
import type { ClaimResult, ClaimScope, ShiftSummary } from '../../../api/shared.ts';
import { AwayPanel } from '../s1-4-my-shifts/index.ts';
import { claimRun, fetchBoard } from './api.ts';
import {
  BOARD_FILTERS,
  BOARD_TABS,
  BOARD_TAB_QUERY_KEY,
  boardTabFromQuery,
  claimRefusal,
  COPY,
  formatWeekRange,
  groupByDay,
  isCurrentWeek,
  nextWeek,
  previousWeek,
  skippedLines,
  timeRange,
  weekEndOf,
  weekStartOf,
  weekdayName,
  withOptimisticClaim,
} from './board.ts';
import type { BoardFilter, BoardRow, BoardTab, BoardViewer, ClaimRefusal } from './board.ts';
import './board.css';

const ID_PREFIX = 's12';

const FILTER_LABELS: Record<BoardFilter, string> = {
  ALL: COPY.filterAll,
  OPEN: COPY.filterOpen,
  MINE: COPY.filterMine,
};

const FILTER_OPTIONS = BOARD_FILTERS.map((value) => ({ value, label: FILTER_LABELS[value] }));

/**
 * The screen: a title, the tab row, and whichever panel the URL names (D49).
 *
 * Thin on purpose. Everything the board itself does lives in `RunBoardPanel`, so
 * that a driver sitting on the "When I'm away" tab is not also holding an open
 * request for a week of runs they are not looking at.
 *
 * No `BackLink` (D43): this screen IS a nav entry — "Shift board" — and a nav
 * destination has no parent to go back to.
 */
export function BoardScreen(_props: ScreenProps) {
  const user = useCurrentUser();
  const { query, setQuery } = useRouter();

  // Duty is set membership — a Staff coordinator who does not drive has no
  // availability to declare, so there is no second tab for them and therefore no tab
  // row (I2).
  const canDrive = hasDuty(user, 'DRIVE');
  const tab = boardTabFromQuery(query[BOARD_TAB_QUERY_KEY], canDrive);

  // `setQuery`, never `go`: same path, no history entry (`app/router.tsx`).
  const openTab = (next: BoardTab) => setQuery({ [BOARD_TAB_QUERY_KEY]: next });

  return (
    <div className="r3-board">
      {/* S1.2's own header, verbatim, and the page's one `<h1>`. */}
      <h1 className="r3-board__title r3-board__title--page">{COPY.header}</h1>

      {canDrive ? (
        <div className="r3-board__tabs">
          <Segmented
            mode="tabs"
            idPrefix={ID_PREFIX}
            label={COPY.tabsLabel}
            options={BOARD_TABS}
            value={tab}
            onChange={openTab}
          />
        </div>
      ) : null}

      {/* `tabPanelProps` only where there is a tablist to be the panel OF. Without
          the tab row, `role="tabpanel"` would point `aria-labelledby` at a tab
          nobody rendered — the same failure `Segmented.tsx` warns about from the
          other end. A coordinator who does not drive just gets the board. */}
      <div {...(canDrive ? tabPanelProps(ID_PREFIX, tab) : {})}>
        {tab === 'away' ? <AwayPanel /> : <RunBoardPanel />}
      </div>
    </div>
  );
}

function RunBoardPanel() {
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
  /** D52: the last refusal, pinned to the row that caused it. A toast is transient
   *  and the commonest refusal — I20's overlapping claim — is a standing fact about
   *  that row, so the row keeps the server's sentence until something changes it. */
  const [refusal, setRefusal] = useState<ClaimRefusal | null>(null);

  // The PANTRY's today, not the device's (A138). It decides which week the board
  // opens on, so a device that has rolled over past midnight would otherwise land on
  // next week and show the pantry an empty board.
  const today = todayInZone(timezone);

  /**
   * Which week is on screen. Null is "this week", resolved on every render rather
   * than pinned at mount: the pantry's zone arrives with the session (A120), so a
   * Monday computed once would be the DEVICE's Monday and would never correct
   * itself. Once someone steps a week it is explicit from then on — the same shape
   * S3.1 uses for the report's week.
   *
   * The window is Monday to Sunday (A178), which is `weekBounds()` on the server and
   * therefore the week S3.1 reports on. Staff cross-check the board against the
   * report, and two screens disagreeing about which seven days "this week" means
   * would make that comparison quietly wrong.
   */
  const [pinnedWeek, setPinnedWeek] = useState<string | null>(null);
  const weekStart = pinnedWeek ?? weekStartOf(today);
  const weekEnd = weekEndOf(weekStart);

  const load = useCallback(
    (signal: AbortSignal) => fetchBoard(filter, weekStart, weekEnd, signal),
    [filter, weekStart, weekEnd],
  );
  const state = useAsyncData<ShiftSummary[]>(load);

  // A partial-claim summary belongs to the week it happened in; carrying it across
  // would leave a Monday's skipped dates sitting above a different week's runs. The
  // same is true of a refusal (D52) — it names one row, and that row is not on
  // screen any more.
  function goToWeek(next: string | null) {
    setPinnedWeek(next);
    setPartial(null);
    setRefusal(null);
  }

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
    // `today` is the pantry's, not the device's (A138) — it decides which heading
    // reads "Today"/"Tomorrow", so passing it is not optional dressing.
    return groupByDay(shown, viewer, Date.now(), today);
  }, [state.data, claimedNow, viewer, user, today]);

  async function runClaim(shift: ShiftSummary, scope: ClaimScope) {
    setScopePrompt(null);
    setBusyId(shift.id);
    setClaimedNow(shift.id); // §6: "claiming a shift updates instantly"
    // A fresh attempt clears the last refusal: the sentence on the row describes the
    // answer to the PREVIOUS request, and leaving it up beside a spinner would say
    // the new one had already failed.
    setRefusal(null);
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
      // that time. Cancel it first." — so it is shown verbatim rather than
      // re-worded here.
      const error = toApiError(cause);
      setClaimedNow(null); // §6: "revert with a clear toast"
      toast.error(error.detail ?? error.message);
      // ...and D52: the same sentence stays on the row it belongs to. Both, not
      // either — the toast is what a driver watching the button sees, and the row is
      // what is still there when they scroll back to work out what happened.
      setRefusal(claimRefusal(cause, shift.id));
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
    <>
      <div className="r3-board__head">
        {/* The title sat here until D30 moved it up to the screen, above the tab
            row, where a page heading belongs. What is left is the two controls,
            still on their own line at EVERY width (A5) — the desktop rule that used
            to lay this out as a row put the title, the week nav and the filter on
            one line and squeezed "Pickup runs" onto two.

            Which week, then which runs within it. The two controls are grouped in
            that order because the week is the wider cut: changing it changes what
            All · Open · Mine is filtering. S3.1's week nav is the same
            three-target row with the same words. */}
        <div className="r3-board__controls">
          <div className="r3-board__week" role="group" aria-label={COPY.weekNavLabel}>
            <Button
              variant="secondary"
              aria-label={COPY.previousWeek}
              onClick={() => goToWeek(previousWeek(weekStart))}
            >
              <ChevronLeftIcon />
            </Button>
            <p className="r3-board__week-range">{formatWeekRange(weekStart, weekEnd)}</p>
            <Button
              variant="secondary"
              aria-label={COPY.nextWeek}
              onClick={() => goToWeek(nextWeek(weekStart))}
            >
              <ChevronRightIcon />
            </Button>
            {/* Absent while it would do nothing (§3 prefers hiding to disabling),
                so its presence is itself the signal that you are away from this
                week. */}
            {isCurrentWeek(weekStart, today) ? null : (
              <Button variant="secondary" onClick={() => goToWeek(null)}>
                {COPY.thisWeek}
              </Button>
            )}
          </div>

          <Segmented
            label={COPY.filterLabel}
            options={FILTER_OPTIONS}
            value={filter}
            onChange={(next) => {
              setFilter(next);
              setPartial(null);
              setRefusal(null);
            }}
          />
        </div>
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
        refusal={refusal}
        timeZone={timezone}
        onClaim={onClaim}
        onOpen={(shiftId) => go('shift', { shiftId })}
      />

      {scopePrompt ? (
        <ClaimScopePrompt
          shift={scopePrompt}
          timeZone={timezone}
          busy={busyId === scopePrompt.id}
          onCancel={() => setScopePrompt(null)}
          onChoose={(scope) => void runClaim(scopePrompt, scope)}
        />
      ) : null}

      {showSkipped && partial ? (
        <SkippedRuns result={partial} today={today} onClose={() => setShowSkipped(false)} />
      ) : null}
    </>
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
  /** D52: the one row, if any, carrying a refused claim. */
  refusal: ClaimRefusal | null;
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
  refusal,
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
                  refusedReason={refusal?.shiftId === row.shift.id ? refusal.reason : null}
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
  /** D52: the server's refusal sentence for THIS row, or null. */
  refusedReason: string | null;
  /** The pantry's zone, so a row reads the same on any device (A120). */
  timeZone: string | null;
  onClaim: (shift: ShiftSummary) => void;
  onOpen: (shiftId: string) => void;
}

function Row({ row, busy, refusedReason, timeZone, onClaim, onOpen }: RowProps) {
  const { shift } = row;
  const when = timeRange(shift.startsAt, shift.endsAt, timeZone ?? undefined);
  const owner = shift.ownerName ?? COPY.unowned;

  const chip = (
    <StatusChip
      status={shift.status}
      mine={row.mine}
      atRisk={row.atRisk}
      // D48. `IN_PROGRESS` + this timestamp reads "Returning"; the status itself is
      // untouched, because I27 is a milestone and not a state.
      pickupCompletedAt={shift.pickupCompletedAt}
    />
  );

  // D52. Under the row, not inside it: a `<button>` cannot nest inside the
  // `<button>` a tappable row is, and on an open row the side slot is already
  // spoken for. `role="status"` so a screen reader hears the refusal arrive without
  // the focus being moved off the Claim button the driver just pressed.
  const refused = refusedReason ? (
    <p className="r3-board__refused" role="status" aria-label={COPY.refusedLabel}>
      {refusedReason}
    </p>
  ) : null;

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
  //
  // NO CHIP HERE (D53). The chip would read "Open", the button reads "Claim" and the
  // meta line already reads "OPEN" — three statements of one fact in one row, and
  // the one the round-4 pass reported as noise. The button is the strongest of the
  // three and the only one that also says what to do about it. Every other row keeps
  // its chip: there the chip is the only thing carrying the status.
  if (row.action === 'CLAIM') {
    return (
      <div className="r3-board__row">
        <ListRow
          title={shift.routeName}
          subtitle={when}
          meta={meta}
          side={
            <span className="r3-board__side">
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
        {refused}
      </div>
    );
  }

  if (row.action === 'DETAIL') {
    return (
      <div className="r3-board__row">
        <ListRow
          title={shift.routeName}
          subtitle={when}
          meta={meta}
          side={chip}
          onClick={() => onOpen(shift.id)}
        />
        {refused}
      </div>
    );
  }

  return (
    <div className="r3-board__row">
      <ListRow title={shift.routeName} subtitle={when} meta={meta} side={chip} />
      {refused}
    </div>
  );
}

// ---------------------------------------------------------------------------
// "Claim every Tuesday run, or just this one?"
// ---------------------------------------------------------------------------

interface ClaimScopePromptProps {
  shift: ShiftSummary;
  /** Pantry zone (A120) — the prompt names the run, and a run's window is a
   *  pantry-local fact. */
  timeZone: string | null;
  busy: boolean;
  onCancel: () => void;
  onChoose: (scope: ClaimScope) => void;
}

/**
 * A repeating run sends nothing on the first tap: it asks first, and the answer is
 * what carries the scope. Correct — but round 4 read the same non-event ("I pressed
 * Claim and nothing happened") as the broken button, so the prompt has to be
 * impossible to take for a no-op. `Modal` already does most of that work: a scrim
 * over the page, `role="dialog" aria-modal`, focus moved into it and Escape to
 * leave. What it did not do is say WHICH run was tapped, so a driver who hit the
 * wrong row had nothing to check it against. It does now.
 */
function ClaimScopePrompt({
  shift,
  timeZone,
  busy,
  onCancel,
  onChoose,
}: ClaimScopePromptProps) {
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
      <p className="r3-board__scope-run">
        {COPY.scopeRun(
          shift.routeName,
          timeRange(shift.startsAt, shift.endsAt, timeZone ?? undefined),
        )}
      </p>
      <p className="r3-board__scope-note">{COPY.scopeConsequence}</p>
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

function SkippedRuns({
  result,
  today,
  onClose,
}: {
  result: ClaimResult;
  /** The pantry's today (A138) — the skipped list dates runs too. */
  today: string;
  onClose: () => void;
}) {
  const lines = skippedLines(result.skipped, today);

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
