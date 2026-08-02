// The requests S3.1 makes, and no others.
//
// Everything goes through the typed fetch layer (`client/src/api/client.ts`) so
// each call carries the sign-in cookie, turns every failure into one plain
// message (§6) and raises the blocking offline banner. A raw `fetch` from a
// screen misses all three.
//
// NOTHING HERE RETRIES. §6 makes retry a visible affordance the Reporter taps,
// never a silent loop behind a spinner.
//
// Two calls cannot use `api` as it stands and say why at their own definitions:
// the PUTs (`api` has no `put` yet) and the export (a CSV file, not JSON). Both
// reuse `client.ts`'s exported primitives rather than re-deciding anything.

import {
  ApiError,
  api,
  isOnline,
  kindForStatus,
  reportActivity,
  reportNetworkFailure,
  reportNetworkSuccess,
} from '../../../api/index.ts';
import type {
  ExportRow,
  ReportEntry,
  ReviseEntryRequest,
  WeeklyReport,
} from '../../../api/shared.ts';
import { exportFilename } from './report.ts';

/**
 * What `GET /report/export?format=json` answers with.
 *
 * Declared here rather than in `shared/src/report.ts` because this lane does not
 * own that file. `ExportRow` and `EXPORT_COLUMNS` — the two things that actually
 * define the worksheet — are already shared; this is the envelope around them, and
 * it belongs beside the call that reads it until somebody moves it.
 */
export interface ExportSheet {
  weekStart: string;
  weekEnd: string;
  /** `EXPORT_COLUMNS`, echoed by the server so the printed headings and the CSV
   *  headings come from one array rather than from two that agree today. */
  columns: string[];
  rows: ExportRow[];
}

/** Omitting `week` asks for the current pantry-local week — the server resolves
 *  it, because the pantry's zone is what decides which week "now" is in and the
 *  client's answer would only agree by luck. */
function weekQuery(week: string | null): { week?: string } {
  return week === null ? {} : { week };
}

// ---------------------------------------------------------------------------
// The week
// ---------------------------------------------------------------------------

export function fetchReport(week: string | null, signal: AbortSignal): Promise<WeeklyReport> {
  return api.get<WeeklyReport>('/report', { query: weekQuery(week), signal });
}

/**
 * The drill-in — Success Metric 4's "100% of line items resolve to a
 * store-category-day", narrowed to one AGFP category.
 *
 * Narrowed by AGFP category and not by NTFB category because that is the grain
 * the route offers, and it is also the grain that answers the question: two AGFP
 * categories can share one NTFB bucket, so "which entries made this number" is
 * only well-posed one level down.
 */
export function fetchEntries(
  week: string | null,
  categoryId: string,
  signal: AbortSignal,
): Promise<ReportEntry[]> {
  return api.get<ReportEntry[]>('/report/entries', {
    query: { ...weekQuery(week), categoryId },
    signal,
  });
}

/**
 * The Reporter's correction of a weight — void-old + insert-new underneath (I13),
 * a plain overwrite on screen.
 *
 * Deliberately not gated on the receiver's edit window (D14): after that window
 * closes this is the only remaining way to fix a bad number (PRD cap 15). Returns
 * the category's entries as they now stand, so the drill-in re-renders from the
 * server's answer rather than from a guess about what the write did.
 */
export function reviseWeight(id: string, body: ReviseEntryRequest): Promise<ReportEntry[]> {
  return api.put<ReportEntry[]>(`/report/weights/${encodeURIComponent(id)}`, { body });
}

/**
 * The report switch on a donation. A plain field edit, last write wins (cap 15) —
 * not the void-and-insert an edited weight goes through, and it calls the same
 * service the receiver's S2.3 calls so I16b is checked in one place.
 *
 * The response is the updated donation; this screen re-reads the week instead of
 * threading it through, because flipping the switch moves weight between
 * `reportedTotal` and `unreportedTotal` and both have to change together.
 */
export function setReportable(id: string, reportable: boolean): Promise<unknown> {
  return api.patch<unknown>(`/report/donations/${encodeURIComponent(id)}/reportable`, {
    body: { reportable },
  });
}

// ---------------------------------------------------------------------------
// The printed worksheet (D16)
// ---------------------------------------------------------------------------

/**
 * The same worksheet the CSV is built from, as JSON, for the print view.
 *
 * `?format=json` on the SAME route, answered by the SAME service call, and refused
 * by the same conflict when a category carrying weight is unmapped (D12, A184).
 * That sameness is the point and is not a convenience: A186 records that S3.1's
 * export is server-built *precisely so it can refuse to emit a short one*, unlike
 * S3.2's client-built metrics CSV. Re-shaping these rows in the browser would put a
 * second, unrefusable path to the same file next to the refusing one, and the short
 * report it could emit is invisible at the far end — the failure Success Metric 4
 * exists to kill.
 *
 * This one CAN go through `api`: it is JSON, so a refusal arrives as an `ApiError`
 * with the server's own sentence on it, exactly like every other call here.
 */
export function fetchExportRows(week: string, signal?: AbortSignal): Promise<ExportSheet> {
  return api.get<ExportSheet>('/report/export', {
    query: { week, format: 'json' },
    ...(signal ? { signal } : {}),
  });
}

// ---------------------------------------------------------------------------
// Export — a CSV file, not JSON
// ---------------------------------------------------------------------------

/**
 * Downloads the week's Meal Connect file.
 *
 * Fetched rather than pointed at with a plain link, for one reason: the server
 * refuses the export while a category carrying weight is unmapped, and a link
 * would answer that refusal by navigating away from the report into an error
 * body. Reading the response here means a refusal arrives as an `ApiError` the
 * screen can say out loud, exactly like every other failure (§6).
 *
 * The filename comes from `content-disposition` when the server sent one, so the
 * file on the Reporter's desktop is named by the thing that produced it rather
 * than by a second guess at the same convention.
 */
export async function downloadExport(week: string, weekEnd: string): Promise<void> {
  if (!isOnline()) throw new ApiError('offline');

  const url = `/api/report/export?week=${encodeURIComponent(week)}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'text/csv' },
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    reportNetworkFailure();
    throw new ApiError('offline');
  }

  reportNetworkSuccess();
  if (response.ok) reportActivity();

  if (!response.ok) {
    const detail = await readMessage(response);
    throw new ApiError(kindForStatus(response.status), {
      status: response.status,
      ...(detail === null ? {} : { detail }),
    });
  }

  const blob = await response.blob();
  const name = filenameFrom(response) ?? exportFilename(week, weekEnd);
  saveBlob(blob, name);
}

/**
 * The refusal body, when the export is blocked.
 *
 * The download is the one call on this screen that cannot go through `api`: it
 * returns a FILE, and `api` parses JSON. So its failure path is hand-rolled, and this
 * is the piece that turns a 409 into the sentence `EXPORT_BLOCKED_MESSAGE` puts on
 * screen rather than a bare status (§6: plain, never a raw code).
 */
async function readMessage(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { message?: unknown };
    return typeof body.message === 'string' ? body.message : null;
  } catch {
    // A refusal with no JSON body is still a refusal; the caller has a status.
    return null;
  }
}

/** `attachment; filename="agfp-ntfb-2026-07-27-to-2026-08-02.csv"` → the name. */
function filenameFrom(response: Response): string | null {
  const header = response.headers.get('content-disposition');
  if (header === null) return null;
  const match = /filename="([^"]+)"/.exec(header);
  return match?.[1] ?? null;
}

/** The one DOM trick on this screen: an object URL behind a synthetic click, so
 *  the browser writes the file with its own download UI instead of the page
 *  navigating to it. Revoked immediately — the browser has already read it. */
function saveBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}
