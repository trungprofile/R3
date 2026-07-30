// Handing a file to the browser. The only DOM this screen owns that is not JSX,
// which is why it is here and not in `metrics.ts` — that file is pure so it can be
// tested without a browser, and this cannot be.
//
// S3.2's "read + export" with no server round trip: the CSV is built by
// `metrics.ts` from data already on screen (there is no metrics export route — the
// server's only export is S3.1's Meal Connect file, a different file for a
// different reader, D13). No dependency; Phase 3 added none.

/** Save `contents` as `filename`. The object URL is released immediately after the
 *  click — it holds the whole file in memory until it is. */
export function downloadCsv(filename: string, contents: string): void {
  // A BOM, so Excel opens a UTF-8 CSV as UTF-8. Without it a store name carrying
  // an accent arrives mangled in the one place these numbers get re-read.
  const blob = new Blob([`﻿${contents}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
