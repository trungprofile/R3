// S3.1 Report generation — the North Texas Food Bank report, and Phase 3's
// centrepiece. Anyone with the `report` duty, on the shared desktop.
//
// CANONICAL DEVICE IS THE DESKTOP. The responsive matrix marks "Report + metrics"
// `n/a` on a phone and `usable` on a tablet, so there is no phone layout here —
// only a wide one that still reads at tablet width.
//
// WHAT THIS SCREEN IS FOR, in the PRD's terms: Success Metric 3 (the report comes
// out of the system, with no Excel re-summing) and Success Metric 4 (every line
// item resolves to a store, a day and a receiver).
//
// THE ORDER CHANGED, AND THE ORDER IS THE POINT (D34). The screen used to open on
// three totals in a card, with the export two scrolls below them. But the totals
// are a CHECK and the Meal Connect report is the JOB, so the report is now the one
// primary action and it sits at the top; two small figures sit under it, and the
// per-NTFB-category table sits under those, for the reporter who is reconciling
// rather than filing. Printing moved INSIDE the report view, where the cards are —
// a print button on a screen with nothing to print hands the browser a blank page.
//
// THREE THINGS IT MUST NOT GET WRONG:
//
//   1. `reportedTotal` and `intakeTotal` are two numbers, never one. PRD §3 keeps
//      them "distinct and clearly labeled everywhere", and this is the screen
//      most likely to blur them. They come from `totalsView`, which always emits
//      both with their own words — see `report.ts` for why the captions under
//      them went and what carries the distinction now.
//   2. The report is ABSENT while the range is blocked, not disabled — a button
//      that fails is not an interaction (§3: prefer hiding over disabling), and
//      the server refuses it anyway. What replaces it is the explanation.
//   3. There is ONE way out and it ends at the printer (D29). The CSV is gone, and
//      with it the second refusal path that had to be kept in step with the first.
//
// THE MATCHING EDITOR IS NO LONGER HERE (D17, overriding D11). It moved to Admin,
// and since D40 it is the bottom half of Admin's Categories tab. What is left in
// its place is a sentence in the blocked state naming who can clear the block.

import { useCallback, useEffect, useState } from 'react';
import { useAsyncData, useSession, useToast, todayInZone } from '../../../app/index.ts';
import type { ScreenProps } from '../../../app/index.ts';
import {
  Button,
  EmptyState,
  ErrorBlock,
  SkeletonRows,
} from '../../../components/index.ts';
import type { ReportExport, WeeklyReport } from '../../../api/shared.ts';
import { fetchExport, fetchReport } from './api.ts';
import { Receipts } from './Receipts.tsx';
import { ReportTable } from './ReportTable.tsx';
import {
  BLOCKED_MESSAGE,
  COPY,
  PRINT_BODY_CLASS,
  canExport,
  defaultRange,
  isEmptyWeek,
  isThisWeek,
  isValidRange,
  messageFor,
  openRunLabel,
  openRunsNotice,
  rangeError,
  rangeHeading,
  reportState,
  toggleDrillIn,
  totalsView,
  unmappedSummary,
  weightWithUnit,
  type DateRange,
} from './report.ts';
import './report.css';

export function ReportScreen(_props: ScreenProps) {
  const { timezone } = useSession();
  const toast = useToast();
  const today = todayInZone(timezone);

  /**
   * The window, as two dates (D41).
   *
   * Null until the pantry's zone has arrived, so the FIRST read sends no dates and
   * the server resolves "this week" in the zone that decides which week now is in
   * (A120). Once the Reporter touches a field the range is explicit from then on,
   * and the server is asked for exactly what is in the two fields.
   */
  const [range, setRange] = useState<DateRange | null>(null);
  const [openCategoryId, setOpenCategoryId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  /** The range's receipts, fetched on demand. Held rather than fetched with the
   *  range because most visits never file anything, and a set of cards built and
   *  thrown away every time a date changes is a request nobody asked for. */
  const [sheet, setSheet] = useState<ReportExport | null>(null);

  const load = useCallback((signal: AbortSignal) => fetchReport(range, signal), [range]);
  const remote = useAsyncData<WeeklyReport>(load);

  /**
   * THE PRINT RULE LIVES ON THE BODY, AND ONLY WHILE THERE ARE RECEIPTS.
   *
   * Printing one section means hiding the rest of the page, and `report.css` may
   * not name the shell's classes to do it. Left unscoped, that rule outlived this
   * screen: a stylesheet is loaded once and never unloaded, so after one visit to
   * the report EVERY other screen printed blank. QA round 2 found it. The class
   * goes on for exactly as long as there is something to print and comes off on
   * unmount, so no other screen can inherit it.
   */
  useEffect(() => {
    if (sheet === null) return;
    document.body.classList.add(PRINT_BODY_CLASS);
    return () => document.body.classList.remove(PRINT_BODY_CLASS);
  }, [sheet]);

  /** The range on screen, resolved: the server's answer while nothing has been
   *  typed, the two fields once something has. */
  const shownRange: DateRange =
    range ??
    (remote.data !== null
      ? { from: remote.data.from, to: remote.data.to }
      : defaultRange(today));

  const editRange = (next: DateRange) => {
    setRange(next);
    setOpenCategoryId(null);
    // Receipts belong to the dates they came from; carrying the last set across
    // would put the wrong numbers in front of someone about to type them.
    setSheet(null);
  };

  /**
   * The report — the range's receipts, on screen and ready for the printer (D29).
   *
   * A refusal (a category carrying weight with no NTFB category) arrives as an
   * `ApiError` with the server's own sentence on it and nothing is shown, which is
   * the point of the export being server-built (A186).
   */
  const openReport = async (report: WeeklyReport) => {
    setExporting(true);
    try {
      setSheet(await fetchExport({ from: report.from, to: report.to }));
    } catch (cause) {
      // The server refuses a blocked range with its own sentence; anything else
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
  const state = reportState(report, sheet !== null);
  const unmapped = unmappedSummary(report.unmapped);
  const openRuns = openRunsNotice(report.openRuns);
  const dateError = rangeError(shownRange);

  // THE REPORT VIEW TAKES THE WHOLE SCREEN (D34/D35). A reporter works one store
  // at a time, one card against one portal screen, and leaving the range's totals
  // and the category table above them is a page to scroll past fifteen times.
  if (sheet !== null) {
    return (
      <div className="s31">
        <h1 className="s31-title">{COPY.title}</h1>
        <Receipts
          sheet={sheet}
          timezone={timezone ?? undefined}
          onBack={() => setSheet(null)}
          onChanged={async () => {
            // Re-read rather than patch the card in place: a tick is a fact two
            // reporters can be looking at, and the server's answer is the one that
            // settles who filed it.
            setSheet(await fetchExport({ from: sheet.from, to: sheet.to }));
          }}
        />
      </div>
    );
  }

  return (
    <div className="s31">
      <h1 className="s31-title">{COPY.title}</h1>

      {/* Pick the dates (D41). Two fields and one shortcut back to this week —
          §1.5 rules out a dropdown, and a pair of date inputs is what a range
          actually is. The heading above them names the range where it has a name
          ("This week"), which is §1.4's recognition over recall. */}
      <section className="s31-range" aria-label={COPY.rangeLabel}>
        <p className="s31-range__name">{rangeHeading(shownRange, today)}</p>
        <div className="s31-range__fields">
          <DateField
            label={COPY.fromLabel}
            value={shownRange.from}
            onChange={(from) => editRange({ ...shownRange, from })}
          />
          <DateField
            label={COPY.toLabel}
            value={shownRange.to}
            onChange={(to) => editRange({ ...shownRange, to })}
          />
          {isThisWeek(shownRange, today) ? null : (
            <Button variant="secondary" onClick={() => editRange(defaultRange(today))}>
              {COPY.thisWeek}
            </Button>
          )}
        </div>
        {dateError !== null ? (
          <p className="s31-error" role="alert">
            {dateError}
          </p>
        ) : null}
      </section>

      {/* The blocked state leads, above the action it is blocking.
          D12: unmapped weight is surfaced and refuses the report, because a short
          submission that looks complete is worse than none. */}
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
          {/* The matching is Admin's now (D17) and a Reporter may not hold the
              tier, so this says who to ask rather than offering a button that
              would 403. D40 merged it into the Categories tab; the sentence names
              where it is today. */}
          <p className="s31-blocked__detail">{COPY.matchingIsInAdmin}</p>
        </section>
      ) : null}

      {/* §1.1: exactly one high-emphasis button per screen, and D34 puts it here,
          at the top, because it is the job. While the range is blocked there is
          none: the server refuses, and a button that fails is not an interaction.

          An open drill-in steps it down to secondary. The drill-in's weight edit
          carries its own primary (Save) and the two render at the same time, which
          is the §1.1 violation `doc-qa` caught. This yields rather than the form's
          Save, because a Reporter with an entry open is inspecting or correcting a
          number, and opening the report mid-correction is the wrong thing to point
          at. Zero high-emphasis buttons is allowed; two is not. */}
      {canExport(report) ? (
        <div className="s31-export">
          <Button
            variant={openCategoryId === null ? 'primary' : 'secondary'}
            onClick={() => void openReport(report)}
            loading={exporting}
            disabled={!isValidRange(shownRange)}
          >
            {COPY.export}
          </Button>
          {/* D13: Meal Connect has no import, so the hint says what the cards are
              FOR rather than implying anything gets sent. */}
          <p className="s31-note">{COPY.exportHint}</p>
        </div>
      ) : null}

      {/* PRD §3: intake and reported stay two distinct, clearly labelled numbers.
          Both come out of one function so neither can be shown alone. Small and
          compact, under the action (D34) — "received but not reported" is the
          difference between them and no longer has a figure of its own. */}
      <dl className="s31-totals s31-totals--compact" aria-label={COPY.totalsLabel}>
        {totalsView(report).map((total) => (
          <div className="s31-total" key={total.key}>
            <dt className="s31-total__label">{total.label}</dt>
            <dd className="s31-total__value r3-numeric">{weightWithUnit(total.value)}</dd>
          </div>
        ))}
      </dl>

      {/* Open runs are surfaced and do NOT block (A184): the submission would
          merely be early, and only the Reporter knows whether the dates are really
          done. */}
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

      {isEmptyWeek(report) ? (
        <EmptyState title={COPY.emptyWeekTitle}>{COPY.emptyWeekBody}</EmptyState>
      ) : (
        <ReportTable
          report={report}
          range={shownRange}
          openCategoryId={openCategoryId}
          onToggle={(categoryId) =>
            setOpenCategoryId((current) => toggleDrillIn(current, categoryId))
          }
          onChanged={remote.reload}
        />
      )}
    </div>
  );
}

/**
 * A `YYYY-MM-DD` field.
 *
 * `components/TextInput` takes `text` or `password` only and `components/` is not
 * this screen's to widen, so the native date control is spelled out here rather
 * than by loosening a contract every screen depends on. It is one `<input>` and a
 * label, which is what `TextInput` is; what it is NOT is a second general-purpose
 * field control, and nothing outside this screen imports it.
 *
 * §1.5 rules out a dropdown where a visible control fits, and the browser's own
 * date picker is the one control on this screen a person already knows how to use.
 */
function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="r3-field s31-range__field">
      <span className="r3-field__label">{label}</span>
      <input
        className="r3-field__control"
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
