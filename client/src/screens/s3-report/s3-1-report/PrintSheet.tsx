// The Meal Connect worksheet, laid out for paper (D16).
//
// WHY THIS EXISTS AT ALL, AND WHY IT IS NOT A PDF LIBRARY. The pantry asked for
// "PDF". D5 forbids a new dependency, and D13 settled that the target is not a
// document anyone files: Meal Connect has no import, so the artefact's whole job is
// to be the sheet a Reporter reads *while typing receipts into a web form*. A print
// stylesheet plus the browser's own dialogue gives them paper beside the keyboard
// and "Save as PDF" in the same menu, with no library and no second layout engine to
// keep in step with the CSV.
//
// `window.print()` is the entire mechanism. This section is `display: none` on
// screen; under `@media print` it is the only thing left visible (`report.css`).
//
// THE ROWS ARE NOT BUILT HERE. They come from `GET /report/export?format=json`,
// which is the same service call, the same grain and the same refusal as the CSV
// (A186, D12). Re-deriving them from `WeeklyReport` would be a second path to the
// same worksheet — one that cannot refuse, and whose short output is invisible at
// the far end.

import type { ExportSheet } from './api.ts';
import { COPY, exportCells, formatWeekRange, mealConnectAccountNote } from './report.ts';
import type { WeeklyReport } from '../../../api/shared.ts';

export interface PrintSheetProps {
  sheet: ExportSheet;
  /** The agency and food-bank codes. `ui-ux-spec.md` S3.1 calls this "the one thing
   *  the worksheet cannot check for them", and the printed copy is the one that
   *  leaves the screen and gets read on its own, so it is in the header. */
  account: WeeklyReport['mealConnect'];
}

export function PrintSheet({ sheet, account }: PrintSheetProps) {
  return (
    <section className="s31-print" aria-label={COPY.printLabel}>
      <header className="s31-print__head">
        <h2 className="s31-print__title">{COPY.printTitle}</h2>
        <p className="s31-print__week">
          {`${COPY.printWeek} ${formatWeekRange(sheet.weekStart, sheet.weekEnd)}`}
        </p>
        <p className="s31-print__account">{mealConnectAccountNote(account)}</p>
      </header>

      {sheet.rows.length === 0 ? (
        <p className="s31-print__empty">{COPY.printEmpty}</p>
      ) : (
        /* D13's grain and order, untouched: one row per line item, sorted pickup
           date → donor → category, with Receipt Items and Receipt Total repeated on
           every row of a receipt so they can be checked against Meal Connect's
           review screen before Submit. The server decided all of that; this only
           draws it. Headings come from the response rather than from a second copy
           of the column list. */
        <table className="s31-print__table">
          <thead>
            <tr>
              {sheet.columns.map((column) => (
                <th key={column} scope="col">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((row, index) => (
              // Row order IS the data here — two rows of one receipt can be
              // identical in every visible cell but the category, and the index is
              // the only stable identity the worksheet has.
              <tr key={`${row.day}:${row.donor}:${row.ntfbCategory}:${row.storage}:${index}`}>
                {exportCells(row).map((cell, column) => (
                  <td key={sheet.columns[column] ?? String(column)}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
