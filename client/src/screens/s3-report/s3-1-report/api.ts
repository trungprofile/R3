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
  CategoryMapping,
  CreateNtfbCategoryRequest,
  NtfbCategory,
  RemovalOutcome,
  RemoveMasterResponse,
  ReportEntry,
  ReviseEntryRequest,
  SetMappingRequest,
  UpdateNtfbCategoryRequest,
  WeeklyReport,
} from '../../../api/shared.ts';
import { exportFilename } from './report.ts';

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
// The AGFP→NTFB matching (S3.1 owns it — D11)
// ---------------------------------------------------------------------------

export function fetchNtfbCategories(signal: AbortSignal): Promise<NtfbCategory[]> {
  return api.get<NtfbCategory[]>('/report/ntfb-categories', { signal });
}

export function createNtfbCategory(body: CreateNtfbCategoryRequest): Promise<NtfbCategory> {
  return api.post<NtfbCategory>('/report/ntfb-categories', { body });
}

/** Rename, re-code, or put an archived one back in use (§3.3's reverse arrow).
 *  Archiving is not here: it goes through `removeNtfbCategory`, where I21 decides
 *  which of the two happened. */
export function updateNtfbCategory(
  id: string,
  body: UpdateNtfbCategoryRequest,
): Promise<NtfbCategory[]> {
  return api.patch<NtfbCategory[]>(`/report/ntfb-categories/${encodeURIComponent(id)}`, { body });
}

/** I21, same as every other master record: archived if anything reports under it,
 *  destroyed only when nothing does. The caller does not choose; it is told. */
export async function removeNtfbCategory(id: string): Promise<RemovalOutcome> {
  const response = await api.delete<RemoveMasterResponse>(
    `/report/ntfb-categories/${encodeURIComponent(id)}`,
  );
  return response.outcome;
}

export function fetchMappings(signal: AbortSignal): Promise<CategoryMapping[]> {
  return api.get<CategoryMapping[]>('/report/mappings', { signal });
}

/** Point one AGFP category at a food bank category, or clear it with an explicit
 *  null. Returns the whole mapping list, so the editor never has to patch its own
 *  copy of it. */
export function setMapping(categoryId: string, body: SetMappingRequest): Promise<CategoryMapping[]> {
  return api.put<CategoryMapping[]>(`/report/mappings/${encodeURIComponent(categoryId)}`, { body });
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
