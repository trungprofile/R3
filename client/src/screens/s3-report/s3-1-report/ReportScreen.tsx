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
// IT OPENS ON THE RECEIPTS NOW, AND THAT IS THE WHOLE OF D54. It used to open on
// the range's totals with a per-category table under them, and the Meal Connect
// receipts behind a button. The reporter read that page as analysis rather than as
// their job — so they never pressed the button, never reached the drill-in behind
// it, and reported PRD cap 15's weight correction as a feature nobody had built.
// It had been built for months. The fix was not to build it again; it was to put it
// where they already are, on the receipt they are typing into the portal.
//
// WHAT SURVIVES ABOVE THE RECEIPTS: the From/To range control (D41) and the block
// that refuses a range with unmapped weight in it. Nothing else — the totals and the
// table are gone, and Admin metrics is the screen for reading numbers.
//
// THREE THINGS IT MUST NOT GET WRONG:
//
//   1. The range starts NULL, so the first read sends no dates and the SERVER
//      resolves "this week" in the pantry's zone (A120). The client's answer would
//      only agree by luck.
//   2. The receipts are ABSENT while the range is blocked, not empty — the server
//      refuses the export outright (D12, A186), and what replaces them is the
//      explanation of what is missing and who can fix it.
//   3. Every write re-reads BOTH the receipts and the entries behind them. A
//      revised weight moves a line, a receipt total and possibly the trash
//      deduction together (D27); a flipped switch moves a donation between the two
//      sections. Patching either in place would show one of the three changing.
//
// THE MATCHING EDITOR IS NOT HERE (D17, overriding D11). It moved to Admin, and
// since D40 it is the bottom half of Admin's Categories tab. What is left in its
// place is a sentence in the blocked state naming who can clear the block.

import { useCallback, useEffect, useState } from 'react';
import { useAsyncData, useSession, useToast, todayInZone } from '../../../app/index.ts';
import type { ScreenProps } from '../../../app/index.ts';
import { Button, ErrorBlock, SkeletonRows } from '../../../components/index.ts';
import type { ReportEntry, ReportExport, WeeklyReport } from '../../../api/shared.ts';
import { fetchEntries, fetchExport, fetchReport } from './api.ts';
import { Receipts } from './Receipts.tsx';
import {
  BLOCKED_MESSAGE,
  COPY,
  PRINT_BODY_CLASS,
  canExport,
  defaultRange,
  isThisWeek,
  messageFor,
  openRunLabel,
  openRunsNotice,
  rangeError,
  rangeHeading,
  reportState,
  unmappedSummary,
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

  const load = useCallback((signal: AbortSignal) => fetchReport(range, signal), [range]);
  const remote = useAsyncData<WeeklyReport>(load);

  /** The range's receipts and the entries behind them. Both are fetched as soon as
   *  the range resolves — this is the screen now, not a view behind a button. */
  const [sheet, setSheet] = useState<ReportExport | null>(null);
  const [entries, setEntries] = useState<readonly ReportEntry[] | null>(null);

  const report = remote.data;
  const ready = report !== null && canExport(report);
  const from = report?.from ?? null;
  const to = report?.to ?? null;

  /**
   * Read the receipts for whatever range the server just resolved.
   *
   * Keyed on the server's OWN `from`/`to` rather than on the two fields, so the
   * first paint — where the client sent no dates at all — asks the export for the
   * same week the report came back for.
   *
   * A refusal (a category carrying weight with no NTFB category) arrives as an
   * `ApiError` with the server's own sentence on it and nothing is shown, which is
   * the point of the export being server-built (A186). It should not happen here,
   * because `readyToExport` gates the call — but the gate is communication and the
   * refusal is the rule (§4.5).
   */
  const readSheet = useCallback(async () => {
    if (from === null || to === null || !ready) {
      setSheet(null);
      setEntries(null);
      return;
    }
    try {
      // Together, because a correction moves both and a screen showing one of them
      // updated is worse than a screen showing neither.
      const [nextSheet, nextEntries] = await Promise.all([
        fetchExport({ from, to }),
        fetchEntries({ from, to }, new AbortController().signal),
      ]);
      setSheet(nextSheet);
      setEntries(nextEntries);
    } catch (cause) {
      // The server refuses a blocked range with its own sentence; anything else
      // gets the plain per-kind message. Never a code (§6).
      toast.error(messageFor(cause));
    }
    // Deliberately keyed on the WINDOW and nothing else. `toast` is stable for the
    // life of the screen and naming it would re-run the read on every render, which
    // on this screen means re-fetching fifteen receipts while somebody is typing.
  }, [from, to, ready]);

  useEffect(() => {
    void readSheet();
  }, [readSheet]);

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
    (report !== null ? { from: report.from, to: report.to } : defaultRange(today));

  const editRange = (next: DateRange) => {
    setRange(next);
    // Receipts belong to the dates they came from; carrying the last set across
    // would put the wrong numbers in front of someone about to type them.
    setSheet(null);
    setEntries(null);
  };

  /** Told after every write. The report is re-read as well as the receipts: an
   *  unmapped category can appear or clear from another desk, and it is what
   *  decides whether there is anything to type at all. */
  const afterWrite = async () => {
    remote.reload();
    await readSheet();
  };

  const dateError = rangeError(shownRange);

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
            onChange={(nextFrom) => editRange({ ...shownRange, from: nextFrom })}
          />
          <DateField
            label={COPY.toLabel}
            value={shownRange.to}
            onChange={(nextTo) => editRange({ ...shownRange, to: nextTo })}
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

      {remote.error !== null ? (
        <ErrorBlock error={remote.error} onRetry={remote.reload} />
      ) : null}

      {report === null ? (
        // Skeleton rows, never a bare spinner, and nothing at all under 300ms (§6).
        remote.showLoading ? <SkeletonRows rows={6} label={COPY.loading} /> : null
      ) : (
        <>
          {/* The blocked state leads, in place of the receipts it is blocking.
              D12: unmapped weight is surfaced and refuses the report, because a
              short submission that looks complete is worse than none. */}
          {reportState(report, sheet !== null) === 'INCOMPLETE' ? (
            <section className="s31-blocked" role="status" aria-label={COPY.blockedLabel}>
              <h2 className="s31-blocked__title">{COPY.blockedTitle}</h2>
              <p className="s31-blocked__body">{BLOCKED_MESSAGE}</p>
              {unmappedSummary(report.unmapped) !== null ? (
                <p className="s31-blocked__detail">
                  <span className="s31-blocked__label">{COPY.unmappedLabel}</span>
                  {unmappedSummary(report.unmapped)}
                </p>
              ) : null}
              {/* The matching is Admin's now (D17) and a Reporter may not hold the
                  tier, so this says who to ask rather than offering a button that
                  would 403. D40 merged it into the Categories tab; the sentence
                  names where it is today. */}
              <p className="s31-blocked__detail">{COPY.matchingIsInAdmin}</p>
            </section>
          ) : null}

          {/* Open runs are surfaced and do NOT block (A184): the submission would
              merely be early, and only the Reporter knows whether the dates are
              really done. */}
          {openRunsNotice(report.openRuns) !== null ? (
            <section className="s31-open-runs" aria-label={COPY.openRunsLabel}>
              <h2 className="s31-subheading">{COPY.openRunsLabel}</h2>
              <p className="s31-note">{openRunsNotice(report.openRuns)}</p>
              <ul className="s31-open-runs__list">
                {report.openRuns.map((run) => (
                  <li key={run.shiftId}>{openRunLabel(run)}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {sheet !== null ? (
            <Receipts
              sheet={sheet}
              entries={entries}
              range={{ from: sheet.from, to: sheet.to }}
              timezone={timezone ?? undefined}
              onChanged={afterWrite}
            />
          ) : ready ? (
            <SkeletonRows rows={6} label={COPY.loading} />
          ) : null}
        </>
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
