// API shapes for receiving — PRD cap 14, `ui-ux-spec.md` S2.1b / S2.2 / S2.2b.
//
// Same rule as `index.ts`: zero runtime dependencies.
//
// The one idea this file exists to carry across the wire is that **`WEIGHED` is not
// a stored disposition**. `shiftstop_disposition` has four members (`data-model.md
// §6`) and `WEIGHED` is none of them — a stop reads as weighed iff a non-voided
// `weight_entry` exists for `(shift, donor)` (I12). So the receiver's screens cannot
// use `ShiftStopDisposition`: they need the projection, which is why
// `ReceiveStopState` below is a wider type and not a re-export.
//
// A stored `WEIGHED` would let a voided-then-abandoned weight pass the completion
// gate, which is the exact failure I12 exists to prevent.

import type { ShiftStopDisposition } from './index.js';

// ---------------------------------------------------------------------------
// The WEIGHED projection (I12)
// ---------------------------------------------------------------------------

/**
 * A stop as the *receiver* sees it: the four stored dispositions plus the derived
 * `WEIGHED`.
 *
 * Derived, never written. `PENDING` and `COLLECTED` are the two unresolved states —
 * `COLLECTED` means the driver picked it up and the receiver has not weighed it yet,
 * so it still blocks receive-done (I12 admits only `{WEIGHED, SKIPPED, REASSIGNED}`).
 */
export const RECEIVE_STOP_STATES = [
  'PENDING',
  'COLLECTED',
  'WEIGHED',
  'SKIPPED',
  'REASSIGNED',
] as const;
export type ReceiveStopState = (typeof RECEIVE_STOP_STATES)[number];

/** The three states I12 accepts as resolved for receive-done. */
export const RECEIVE_RESOLVED_STATES: readonly ReceiveStopState[] = [
  'WEIGHED',
  'SKIPPED',
  'REASSIGNED',
];

/** Project a stored disposition plus the weighed-exists fact into the read state. */
export function receiveStopState(
  disposition: ShiftStopDisposition,
  hasNonVoidedWeight: boolean,
): ReceiveStopState {
  // Order matters. A SKIPPED or REASSIGNED stop stays what it is even if a weight
  // row exists for its donor: `SKIPPED` is an explicit stored decision (§3.2) and
  // `REASSIGNED` is terminal (I30), while an off-route weight_entry for the same
  // donor is allowed and must not silently un-skip a stop the driver skipped.
  if (disposition === 'SKIPPED' || disposition === 'REASSIGNED') return disposition;
  return hasNonVoidedWeight ? 'WEIGHED' : disposition;
}

// ---------------------------------------------------------------------------
// S2.1b — run picker
// ---------------------------------------------------------------------------

/** One stop, as the picker's status-dot row and S2.2's stop strip render it. */
export interface ReceiveStopSummary {
  id: string;
  donorId: string;
  donorName: string;
  position: number;
  state: ReceiveStopState;
}

/**
 * One run on the picker.
 *
 * `occurrenceDate` is the shift's own date and **never the device's today** — if a
 * Tuesday-night run is received at 12:30am Wednesday, the report still buckets that
 * weight to Tuesday (`data-model.md §8`), so showing the shift's date here is what
 * makes the screen agree with the report (S2.1b).
 */
export interface ReceiveRunSummary {
  shiftId: string;
  routeName: string;
  /** The driver's name, for "Karen's Tue AM run". Public-within-org, never PII. */
  ownerName: string | null;
  /** `YYYY-MM-DD`, pantry-local. Not an instant — it is a business day. */
  occurrenceDate: string;
  startsAt: string;
  endsAt: string;
  stops: ReceiveStopSummary[];
  /** Stops in `RECEIVE_RESOLVED_STATES`, for the "N of M done" count. */
  doneCount: number;
  totalCount: number;
  /** True once every stop is resolved — S2.2b becomes reachable (I12). */
  readyForReceiveDone: boolean;
}

// ---------------------------------------------------------------------------
// S2.2 — the sheet
// ---------------------------------------------------------------------------

/** One non-voided weight row under a category tile. */
export interface WeightEntrySummary {
  id: string;
  /** Decimal string, not a number: `numeric(8,2)` survives the wire as text so a
   *  scale reading like `1222.35` cannot pick up a float rounding error. */
  weight: string;
  note: string | null;
  createdAt: string;
  /** Who logged it (I26). The sheet is attributed per PRD cap 14. */
  createdByName: string;
}

/** One category tile: its running entries and its live subtotal. */
export interface CategoryTile {
  categoryId: string;
  categoryName: string;
  entries: WeightEntrySummary[];
  /** `SUM(weight) WHERE NOT voided`, computed on read and never stored (I13). */
  subtotal: string;
}

/**
 * S2.2 for one stop of one run.
 *
 * All three read-only note channels of cap 11 that the receiver is shown, and none
 * they author: `stopNote` (driver→receiver, channel 2), `donorNote` (admin's
 * permanent per-store note, channel 4), `runNote` (the driver's whole-run remark,
 * channel 3, behind the "run notes" expander).
 */
export interface ReceiveStopDetail {
  shiftId: string;
  stopId: string;
  donorId: string;
  donorName: string;
  state: ReceiveStopState;
  stopNote: string | null;
  donorNote: string | null;
  runNote: string | null;
  /** Active categories only (S1.8) — the tile set renders from live data, never a
   *  hardcoded list, so an archived category disappears from new entry while its
   *  history keeps resolving. Tiles with no entries yet are present with subtotal 0. */
  tiles: CategoryTile[];
  /** `SUM` across every tile — the sheet's "This stop's total". */
  stopTotal: string;
}

/**
 * Add one weight. Confirms immediately (PRD cap 14 — no separate sign-off at the
 * entry level), so there is no draft state to submit.
 *
 * `weight` is a string for the same reason it is one on the way out.
 */
export interface AddWeightRequest {
  categoryId: string;
  weight: string;
  note?: string | null;
}

/**
 * Overwrite an entry (the ✎ affordance on S2.2).
 *
 * Presented to the receiver as a simple edit with no undo and no history UI, and
 * implemented underneath as void-old + insert-new, because weight rows are immutable
 * (I13). The response therefore carries a *different* entry id than the one edited.
 */
export interface ReviseWeightRequest {
  weight: string;
  note?: string | null;
}

/** The receiver's skip — "nothing came from this store" (§3.2, receiver branch). */
export interface SkipStopRequest {
  note?: string | null;
}

// ---------------------------------------------------------------------------
// S2.2b — receive done
// ---------------------------------------------------------------------------

/** One line of the receive-done summary. */
export interface ReceiveDoneLine {
  donorName: string;
  state: ReceiveStopState;
  /** Null for a skipped stop — no phantom zero row is stored (§3.2). */
  total: string | null;
}

export interface ReceiveDoneSummary {
  shiftId: string;
  routeName: string;
  ownerName: string | null;
  lines: ReceiveDoneLine[];
  runTotal: string;
  readyForReceiveDone: boolean;
}

/**
 * The refusal when a stop is still unresolved. S2.2b is not offered unless the run
 * is ready, so this is the server saying the same thing again — a client-side check
 * is communication only (`CLAUDE.md`).
 */
export const RECEIVE_INCOMPLETE_MESSAGE =
  'Every stop needs a weight or a skip before you can finish this run.';

/**
 * Receive-done is the one completion action (I11) and has no undo.
 *
 * The second sentence used to read "You can still fix a weight afterwards." That
 * was FALSE for the person reading it: `requireReceivable()` refuses every receiver
 * write once the shift is `COMPLETED`, so the modal promised something the server
 * denies. Corrections after close belong to the Reporter (D14), which is who the
 * receiver has to go and find — so the copy names them rather than implying the
 * receiver can come back to it.
 */
export const RECEIVE_DONE_CONFIRM =
  'This closes out the run. After this you cannot change a weight yourself — ask whoever does the reporting.';
