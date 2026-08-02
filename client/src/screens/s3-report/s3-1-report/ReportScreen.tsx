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
//      server refuses it anyway. What replaces it is the explanation.
//   3. The two ways out carry the SAME worksheet. The CSV and the printed sheet
//      are one server call, one grain and one refusal (D16, A186); nothing here
//      re-shapes a row.
//
// THE MATCHING EDITOR IS NO LONGER HERE (D17, overriding D11). It moved to Admin,
// which is what took the tab strip with it: `ui-ux-spec.md §3` has no one-tab
// `Segmented`, and a strip of one is a control that cannot do anything. What is
// left in its place is a sentence in the blocked state naming who can clear the
// block, because a Reporter without the Admin tier now cannot.

import { useCallback, useState } from 'react';
import { useAsyncData, useSession, useToast, todayInZone } from '../../../app/index.ts';
import type { ScreenProps } from '../../../app/index.ts';
import {
  Button,
  Card,
  EmptyState,
  ErrorBlock,
  PrinterIcon,
  SkeletonRows,
} from '../../../components/index.ts';
import type { WeeklyReport } from '../../../api/shared.ts';
import { downloadExport, fetchExportRows, fetchReport, type ExportSheet } from './api.ts';
import { PrintSheet } from './PrintSheet.tsx';
import { ReportTable } from './ReportTable.tsx';
import {
  BLOCKED_MESSAGE,
  COPY,
  canExport,
  formatWeekRange,
  isCurrentWeek,
  isEmptyWeek,
  messageFor,
  mealConnectAccountNote,
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

export function ReportScreen(_props: ScreenProps) {
  const { timezone } = useSession();
  const toast = useToast();

  // Null means "whatever week the pantry is in", which the SERVER resolves — the
  // pantry's zone decides that and the client's answer would only agree by luck
  // (A120). Once the Reporter navigates, the week is explicit from then on.
  const [week, setWeek] = useState<string | null>(null);
  const [openCategoryId, setOpenCategoryId] = useState<string | null>(null);
  const [exported, setExported] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [printing, setPrinting] = useState(false);
  /** The rows behind the printed sheet, fetched on demand. Held rather than
   *  fetched with the week because most visits never print, and a worksheet built
   *  and thrown away every time the week changes is a request nobody asked for. */
  const [sheet, setSheet] = useState<ExportSheet | null>(null);

  const load = useCallback((signal: AbortSignal) => fetchReport(week, signal), [week]);
  const remote = useAsyncData<WeeklyReport>(load);

  const goToWeek = (next: string) => {
    setWeek(next);
    setOpenCategoryId(null);
    // A download belongs to the week it came from; carrying either the "exported"
    // state or last week's printable rows across would tell the Reporter they had
    // something they do not have.
    setExported(false);
    setSheet(null);
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

  /**
   * Print, or save as PDF — the browser's dialogue offers both (D16).
   *
   * Fetched THEN printed, in that order and awaited: `window.print()` is
   * synchronous and photographs the DOM as it stands, so printing before the rows
   * arrive would produce a sheet with a heading and nothing under it. A refusal
   * (an unmapped category carrying weight) surfaces as a toast and no dialogue
   * opens, which is the same refusal the CSV gets because it is the same call.
   */
  const runPrint = async (report: WeeklyReport) => {
    setPrinting(true);
    try {
      const fetched = await fetchExportRows(report.weekStart);
      setSheet(fetched);
      // One frame, so React has committed the section before the browser
      // photographs the page.
      await new Promise((resolve) => requestAnimationFrame(resolve));
      window.print();
    } catch (cause) {
      toast.error(messageFor(cause));
    } finally {
      setPrinting(false);
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
          {/* Where the "Match the categories" primary used to be. The matching is
              Admin's now (D17) and a Reporter may not hold the tier, so this says
              who to ask rather than offering a button that would 403. */}
          <p className="s31-blocked__detail">{COPY.matchingIsInAdmin}</p>
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
                {total.note !== null ? (
                  <span className="s31-total__note">{total.note}</span>
                ) : null}
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
          onToggle={(categoryId) => setOpenCategoryId((current) => toggleDrillIn(current, categoryId))}
          onChanged={remote.reload}
        />
      )}

      {/* §1.1: exactly one high-emphasis button per screen, and here it is
          Export. Print sits beside it as a secondary — same worksheet, other
          medium, and offering two primaries would be the violation §1.1 names.
          While the week is blocked there is neither: the server refuses both, and
          a button that fails is not an interaction.

          An open drill-in steps Export down too. The drill-in's weight edit
          carries its own primary (Save), and the two render at the same time —
          which is the §1.1 violation `doc-qa` caught. Export yields rather than
          the form's Save, because a Reporter with an entry open is inspecting or
          correcting a number, and exporting the week mid-correction is the wrong
          thing to point at. Zero high-emphasis buttons is allowed; two is not. */}
      {canExport(report) ? (
        <div className="s31-export">
          {state === 'EXPORTED' ? (
            <p className="s31-note" role="status">
              {COPY.exportedNote}
            </p>
          ) : null}
          <div className="s31-export__actions">
            <Button
              variant={openCategoryId === null ? 'primary' : 'secondary'}
              onClick={() => void runExport(report)}
              loading={exporting}
            >
              {COPY.export}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void runPrint(report)}
              loading={printing}
            >
              {/* Icon plus words, never the icon alone (§3): "Print" and "Save as
                  PDF" are the same button here and only the label can say so. */}
              <PrinterIcon />
              {printing ? COPY.printing : COPY.print}
            </Button>
          </div>
          {/* D13: the file is a worksheet for a form somebody types into, not
              something that gets uploaded — so the hint says what to do with it,
              and the line under it names the account it belongs in. That is the
              one check the worksheet itself cannot make. */}
          <p className="s31-note">{COPY.exportHint}</p>
          <p className="s31-note">{mealConnectAccountNote(report.mealConnect)}</p>
        </div>
      ) : null}

      {/* Hidden on screen; under `@media print` it is the only thing on the page
          (`report.css`). Rendered only once a Print has actually fetched rows, so
          an accidental Ctrl-P before then prints the screen rather than a heading
          with nothing under it. */}
      {sheet !== null ? <PrintSheet sheet={sheet} account={report.mealConnect} /> : null}
    </div>
  );
}
