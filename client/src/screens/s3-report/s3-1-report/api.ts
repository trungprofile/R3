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
// EVERY CALL IS JSON NOW (D29). The export used to be a second, hand-rolled
// `fetch` because it answered with a CSV file, and a file cannot travel through a
// layer that parses JSON — so its refusal path was written twice. The far end
// turned out to be a web form with no import, the file went with it, and the
// export is an ordinary `api.get` like everything else on this screen.

import { api } from '../../../api/index.ts';
import type {
  AttachDonorRequest,
  DonorSummary,
  ReceiptSubmissionRequest,
  ReportEntry,
  ReportExport,
  ReviseEntryRequest,
  WeeklyReport,
} from '../../../api/shared.ts';

/** The window on the wire (D41). Both dates or neither: omitting them asks for
 *  the current pantry-local week, which the SERVER resolves, because the pantry's
 *  zone is what decides which week "now" is in and the client's answer would only
 *  agree by luck. */
export interface RangeQuery {
  from: string;
  to: string;
}

function rangeQuery(range: RangeQuery | null): { from?: string; to?: string } {
  return range === null ? {} : { from: range.from, to: range.to };
}

// ---------------------------------------------------------------------------
// The range
// ---------------------------------------------------------------------------

export function fetchReport(range: RangeQuery | null, signal: AbortSignal): Promise<WeeklyReport> {
  return api.get<WeeklyReport>('/report', { query: rangeQuery(range), signal });
}

/**
 * Every entry in the range — Success Metric 4's "100% of line items resolve to a
 * store-category-day".
 *
 * ASKED ONCE FOR THE WHOLE RANGE (D55), not once per card. The drill-in narrowed
 * this to one AGFP category because it WAS one category; the receipt is a
 * `(pickup date, donor)` and its entries are sifted on the client
 * (`entriesForReceipt`), which keeps a request out from between a reporter and the
 * number they came to fix. A fortnight is a few hundred rows.
 *
 * `categoryId` stays on the signature because the ROUTE still offers it and this is
 * the only caller; nothing on S3.1 passes it today.
 */
export function fetchEntries(
  range: RangeQuery | null,
  signal: AbortSignal,
  categoryId?: string,
): Promise<ReportEntry[]> {
  return api.get<ReportEntry[]>('/report/entries', {
    query: { ...rangeQuery(range), ...(categoryId === undefined ? {} : { categoryId }) },
    signal,
  });
}

/**
 * The Reporter's correction of a weight — void-old + insert-new underneath (I13),
 * a plain overwrite on screen.
 *
 * Deliberately not gated on the receiver's edit window (D14): after that window
 * closes this is the only remaining way to fix a bad number (PRD cap 15).
 *
 * IT ANSWERS WITH THE CATEGORY'S ENTRIES AND S3.1 NO LONGER READS THEM (D54). The
 * response was the drill-in's own re-render, back when the panel was one category;
 * a receipt spans several, so the screen re-reads the range and the receipt sheet
 * together instead — a revised weight moves a receipt line, its total and possibly
 * the trash deduction (D27), and only the server settles all three. The route is
 * unchanged: this is what the screen does with the answer, not what the service
 * sends.
 */
export function reviseWeight(
  id: string,
  body: ReviseEntryRequest,
  range: RangeQuery | null,
): Promise<ReportEntry[]> {
  return api.put<ReportEntry[]>(`/report/weights/${encodeURIComponent(id)}`, {
    body,
    query: rangeQuery(range),
  });
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
// The export — the week's receipts (D29)
// ---------------------------------------------------------------------------

/**
 * Every receipt in the week, in the order they are typed: date, then store.
 *
 * Server-built, and refused outright while a category carrying weight is unmapped
 * (D12, A184). A186 records why that matters and it has not changed: this export
 * exists to be REFUSABLE, because a short submission is invisible at the far end.
 * Re-shaping receipts in the browser would put a second, unrefusable path beside
 * the refusing one. Nothing here rebuilds a line, a total or a checkbox.
 */
export function fetchExport(range: RangeQuery, signal?: AbortSignal): Promise<ReportExport> {
  return api.get<ReportExport>('/report/export', {
    query: rangeQuery(range),
    ...(signal ? { signal } : {}),
  });
}

// ---------------------------------------------------------------------------
// The check-off (D35)
// ---------------------------------------------------------------------------

/**
 * Tick or un-tick one receipt as filed into Meal Connect.
 *
 * `(pickupDate, donorId)` IS the receipt's key and the table's primary key
 * (migration 0018), so there is no id to send and none to have been given first.
 * The un-tick is a real DELETE, which is what makes a mis-tick reversible rather
 * than something to be corrected with a second fact.
 *
 * Neither answers with anything. The screen re-reads the range afterwards, because
 * the tick is a fact two people can be looking at and a locally patched card is
 * exactly the thing this table exists to stop being the source of truth.
 */
export function markSubmitted(body: ReceiptSubmissionRequest): Promise<void> {
  return api.post<void>('/report/submissions', { body });
}

export function clearSubmitted(body: ReceiptSubmissionRequest): Promise<void> {
  return api.delete<void>('/report/submissions', { body });
}

// ---------------------------------------------------------------------------
// Pointing a label-only walk-in at a real store (D72)
// ---------------------------------------------------------------------------

/**
 * The stores a walk-in can be filed under: ACTIVE donors, which is what `GET /donors`
 * answers with by default.
 *
 * Not a report route and deliberately not a new one — donors are master data, the
 * endpoint already exists at `tier: 'VOLUNTEER'`, and a Reporter is at least that
 * (I2, hierarchical). A second list built for this screen would be a second thing to
 * keep in step with the admin's own.
 */
export function fetchDonors(signal?: AbortSignal): Promise<DonorSummary[]> {
  return api.get<DonorSummary[]>('/donors', { ...(signal ? { signal } : {}) });
}

/**
 * File a label-only receipt under a real store.
 *
 * A whole card at a time, because that is what the reporter is looking at. Answers
 * with nothing: the range is re-read afterwards, since the attach moves the row onto
 * another receipt, changes that receipt's trash deduction (D27, the rates are the
 * store's) and makes the card tickable — and only the server settles all three.
 */
export function attachDonor(body: AttachDonorRequest): Promise<void> {
  return api.post<void>('/report/donations/attach-donor', { body });
}
