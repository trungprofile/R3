// S3.1 Report generation — the weekly North Texas Food Bank report, and Phase 3's
// centrepiece. Anyone with the `report` duty, on the shared desktop.
//
// CANONICAL DEVICE IS THE DESKTOP. The responsive matrix marks "Report + metrics"
// `n/a` on a phone and `usable` on a tablet, so there is no phone layout here —
// only a wide one that still reads at tablet width.
//
// WHAT THIS SCREEN IS FOR, in the PRD's terms: Success Metric 3 (the report comes
// out of the system, with no Excel re-summing) and Success Metric 4 (every line
// item resolves to a store, a day and a receiver). Both are visible on this one
// screen — the totals for the first, the drill-in for the second.
//
// THREE THINGS IT MUST NOT GET WRONG:
//
//   1. `reportedTotal` and `intakeTotal` are two numbers, never one. PRD §3 keeps
//      them "distinct and clearly labeled everywhere", and this is the screen
//      most likely to blur them. They are rendered from `totalsView`, which
//      always emits all three with their own words.
//   2. Export is ABSENT while the week is blocked, not disabled — a button that
//      fails is not an interaction (§3: prefer hiding over disabling), and the
//      server refuses it anyway. What replaces it is the explanation and the way
//      to fix it.
//   3. The matching editor is on this screen (D11), one tab away, so a Reporter
//      who hits the block can clear it without changing screens or tiers.

import { useCallback, useState } from 'react';
import { useAsyncData, useSession, useToast, todayInZone } from '../../../app/index.ts';
import type { ScreenProps } from '../../../app/index.ts';
import {
  Button,
  Card,
  EmptyState,
  ErrorBlock,
  Segmented,
  SkeletonRows,
  tabPanelProps,
} from '../../../components/index.ts';
import type { WeeklyReport } from '../../../api/shared.ts';
import { downloadExport, fetchReport } from './api.ts';
import { MappingEditor } from './MappingEditor.tsx';
import { ReportTable } from './ReportTable.tsx';
import {
  BLOCKED_MESSAGE,
  COPY,
  canExport,
  formatWeekRange,
  isCurrentWeek,
  isEmptyWeek,
  isFutureWeek,
  mealConnectAccountNote,
  messageFor,
  nextWeek,
  openRunLabel,
  openRunsNotice,
  previousWeek,
  reportState,
  toggleDrillIn,
  totalsView,
  unmappedSummary,
  weekLabel,
  weekStartOf,
  weightWithUnit,
} from './report.ts';
import './report.css';

const ID_PREFIX = 's31';

type PanelId = 'report' | 'mapping';

const PANELS = [
  { value: 'report' as const, label: COPY.tabReport },
  { value: 'mapping' as const, label: COPY.tabMapping },
];

export function ReportScreen(_props: ScreenProps) {
  const { timezone } = useSession();
  const toast = useToast();

  // Null means "whatever week the pantry is in", which the SERVER resolves — the
  // pantry's zone decides that and the client's answer would only agree by luck
  // (A120). Once the Reporter navigates, the week is explicit from then on.
  const [week, setWeek] = useState<string | null>(null);
  const [panel, setPanel] = useState<PanelId>('report');
  const [openCategoryId, setOpenCategoryId] = useState<string | null>(null);
  const [exported, setExported] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = useCallback((signal: AbortSignal) => fetchReport(week, signal), [week]);
  const remote = useAsyncData<WeeklyReport>(load);

  const goToWeek = (next: string) => {
    setWeek(next);
    setOpenCategoryId(null);
    // A download belongs to the week it came from; carrying the "exported" state
    // across would tell the Reporter they had a file they do not have.
    setExported(false);
  };

  const runExport = async (report: WeeklyReport) => {
    setExporting(true);
    try {
      await downloadExport(report.weekStart, report.weekEnd);
      setExported(true);
      toast.success(COPY.exportDone);
    } catch (cause) {
      // The server refuses a blocked week with its own sentence; anything else
      // gets the plain per-kind message. Never a code (§6).
      toast.error(messageFor(cause));
    } finally {
      setExporting(false);
    }
  };

  if (remote.error !== null) {
    return (
      <div className="s31">
        <h1 className="s31-title">{COPY.title}</h1>
        <ErrorBlock error={remote.error} onRetry={remote.reload} />
      </div>
    );
  }

  if (remote.data === null) {
    // Skeleton rows, never a bare spinner, and nothing at all under 300ms (§6).
    return (
      <div className="s31">
        <h1 className="s31-title">{COPY.title}</h1>
        {remote.showLoading ? <SkeletonRows rows={6} label={COPY.loading} /> : null}
      </div>
    );
  }

  const report = remote.data;
  const today = todayInZone(timezone);
  const label = weekLabel(report.weekStart, today);
  const state = reportState(report, exported);
  const unmapped = unmappedSummary(report.unmapped);
  const openRuns = openRunsNotice(report.openRuns);

  return (
    <div className="s31">
      <h1 className="s31-title">{COPY.title}</h1>

      {/* Pick a week — S3.1's first line. Three big targets in a row, all three
          always visible; §1.5 rules out a date dropdown for this. */}
      <div className="s31-week" role="group" aria-label={COPY.weekNavLabel}>
        <Button variant="secondary" onClick={() => goToWeek(previousWeek(report.weekStart))}>
          {COPY.previousWeek}
        </Button>
        <div className="s31-week__label">
          {label !== null ? <p className="s31-week__name">{label}</p> : null}
          <p className="s31-week__range">{formatWeekRange(report.weekStart, report.weekEnd)}</p>
        </div>
        <Button variant="secondary" onClick={() => goToWeek(nextWeek(report.weekStart))}>
          {COPY.nextWeek}
        </Button>
        {isCurrentWeek(report.weekStart, today) ? null : (
          <Button variant="secondary" onClick={() => goToWeek(weekStartOf(today))}>
            {COPY.thisWeek}
          </Button>
        )}
      </div>

      {isFutureWeek(report.weekStart, today) ? (
        <p className="s31-note" role="status">
          {COPY.futureWeekNote}
        </p>
      ) : null}

      <Segmented
        mode="tabs"
        idPrefix={ID_PREFIX}
        label={COPY.tabsLabel}
        options={PANELS}
        value={panel}
        onChange={setPanel}
      />

      <div className="s31-panel" {...tabPanelProps(ID_PREFIX, panel)}>
        {panel === 'mapping' ? (
          <MappingEditor unmapped={report.unmapped} onChanged={remote.reload} />
        ) : (
          <>
            {/* The blocked state leads, above everything else it is blocking.
                D12: unmapped weight is surfaced and refuses the export, because a
                short file that looks complete is worse than no file. */}
            {state === 'INCOMPLETE' ? (
              <section className="s31-blocked" role="status" aria-label={COPY.blockedLabel}>
                <h2 className="s31-blocked__title">{COPY.blockedTitle}</h2>
                <p className="s31-blocked__body">{BLOCKED_MESSAGE}</p>
                {unmapped !== null ? (
                  <p className="s31-blocked__detail">
                    <span className="s31-blocked__label">{COPY.unmappedLabel}</span>
                    {unmapped}
                  </p>
                ) : null}
                <Button variant="primary" onClick={() => setPanel('mapping')}>
                  {COPY.goToMatching}
                </Button>
              </section>
            ) : null}

            {/* Open runs are surfaced and do NOT block (A184): the file would
                merely be early, and only the Reporter knows whether the week is
                really over. */}
            {openRuns !== null ? (
              <section className="s31-open-runs" aria-label={COPY.openRunsLabel}>
                <h2 className="s31-subheading">{COPY.openRunsLabel}</h2>
                <p className="s31-note">{openRuns}</p>
                <ul className="s31-open-runs__list">
                  {report.openRuns.map((run) => (
                    <li key={run.shiftId}>{openRunLabel(run)}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            {/* PRD §3: intake and reported stay two distinct, clearly labelled
                numbers. All three come out of one function so none can be shown
                alone. */}
            <Card ariaLabel={COPY.totalsLabel}>
              <h2 className="s31-subheading">{COPY.totalsLabel}</h2>
              <dl className="s31-totals">
                {totalsView(report).map((total) => (
                  <div
                    className={total.primary ? 's31-total s31-total--primary' : 's31-total'}
                    key={total.key}
                  >
                    <dt className="s31-total__label">{total.label}</dt>
                    <dd className="s31-total__value">
                      <span className="r3-numeric">{weightWithUnit(total.value)}</span>
                      <span className="s31-total__note">{total.note}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </Card>

            {isEmptyWeek(report) ? (
              <EmptyState title={COPY.emptyWeekTitle}>{COPY.emptyWeekBody}</EmptyState>
            ) : (
              <ReportTable
                report={report}
                week={report.weekStart}
                openCategoryId={openCategoryId}
                onToggle={(categoryId) =>
                  setOpenCategoryId((current) => toggleDrillIn(current, categoryId))
                }
                onChanged={remote.reload}
              />
            )}

            {/* §1.1: exactly one high-emphasis button per screen, and on the
                report panel it is Export. While the week is blocked there is no
                Export at all — the primary above belongs to the block instead.

                An open drill-in yields it too. The drill-in's weight edit carries
                its own primary (Save), and the two render at the same time — which
                is the §1.1 violation `doc-qa` caught. Export steps down rather than
                the form's Save, because a Reporter with an entry open is inspecting
                or correcting a number, and exporting the week mid-correction is the
                wrong thing to point at. Zero high-emphasis buttons is allowed; two
                is not. */}
            {canExport(report) ? (
              <div className="s31-export">
                {state === 'EXPORTED' ? (
                  <p className="s31-note" role="status">
                    {COPY.exportedNote}
                  </p>
                ) : null}
                <Button
                  variant={openCategoryId === null ? 'primary' : 'secondary'}
                  onClick={() => void runExport(report)}
                  loading={exporting}
                >
                  {COPY.export}
                </Button>
                {/* D13: the file is a worksheet for a form somebody types into,
                    not something that gets uploaded — so the hint says what to do
                    with it, and the line under it names the account it belongs in.
                    That is the one check the worksheet itself cannot make. */}
                <p className="s31-note">{COPY.exportHint}</p>
                <p className="s31-note">{mealConnectAccountNote(report.mealConnect)}</p>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
