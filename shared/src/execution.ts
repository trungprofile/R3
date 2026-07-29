// API shapes for pickup execution — PRD cap 10, `ui-ux-spec.md S1.5` (driver run)
// and the staff-only reassign action on `S1.3`.
//
// Same rule as `index.ts`: zero runtime dependencies. The `import type` line below is
// erased at compile time and emits no runtime edge, which is deliberate —
// re-declaring `ShiftStatus` / `ShiftStopDisposition` here would be a second copy of
// a native Postgres enum (`data-model.md §1`) free to drift from the first.
//
// What this file does NOT describe, and why:
//
//   - There is no "close the run" request. I11 makes the receiver's receive-done the
//     only completion action and it ships in Phase 2 (build-plan D1), so a Phase-1
//     run stays `IN_PROGRESS` after the last stop is resolved.
//   - `WEIGHED` is not a disposition. It is a read-time projection over non-voided
//     `WeightEntry` rows (I12) and `weight_entry` is a Phase-2 table (build-plan D3).
//   - Nothing here carries a copied donor name or address for the sake of the
//     snapshot. I5 freezes *which donors, in what order*, and keeps a live `Donor`
//     FK, so the donor fields below render current values on purpose.

import type { ShiftStatus, ShiftStopDisposition } from './index.js';

// ---------------------------------------------------------------------------
// Reading the run (S1.5 active view, S1.3 stop list)
// ---------------------------------------------------------------------------

/**
 * One `ShiftStop` as the driver's run screen and the staff shift detail render it.
 *
 * `donorName` / `donorAddress` / `donorNote` are read live through the snapshot's
 * `Donor` FK (I5) — an address correction reaches a run in flight, while *which*
 * donors and in what order does not. Donor address is operational data a driver
 * needs, never PII: `pii.ts` gates people, not places (`CLAUDE.md`).
 */
export interface RunStopSummary {
  id: string;
  donorId: string;
  donorName: string;
  donorAddress: string | null;
  /** `Donor.note` — the admin's permanent per-store note (cap 11, channel 4). */
  donorNote: string | null;
  /** Ascending, contiguous from 0. Reordering mid-run rewrites this, never state. */
  position: number;
  disposition: ShiftStopDisposition;
  /** `ShiftStop.note` — driver→receiver, this stop only (cap 11, channel 2). */
  note: string | null;
}

/** The run as one payload: shift, truck, both note channels, and the stops. */
export interface RunDetail {
  shiftId: string;
  status: ShiftStatus;
  routeId: string;
  routeName: string;
  /** ISO-8601 instant. */
  startsAt: string;
  endsAt: string;
  ownerId: string | null;
  /** Null until the driver picks one at start (I8). */
  truckId: string | null;
  truckName: string | null;
  /** `Shift.note` — the driver's one whole-run remark (cap 11, channel 3). */
  note: string | null;
  /** `Shift.staff_note` — coordinator→driver, read-only to the driver (channel 1). */
  staffNote: string | null;
  /** I27 handoff milestone. Non-null does NOT mean completed — `status` stays
   *  `IN_PROGRESS` (build-plan D1). */
  pickupCompletedAt: string | null;
  /** I20's staff-assign exemption: drives S1.3's persistent banner. */
  assignedOverConflict: boolean;
  /** Empty until the run starts — ShiftStop rows exist only from `IN_PROGRESS`
   *  onward (I5). */
  stops: RunStopSummary[];
}

// ---------------------------------------------------------------------------
// Starting the run (S1.5 "one big step — pick a truck")
// ---------------------------------------------------------------------------

/** The whole start payload. The route is already bound (I4 — staff bound it at
 *  scheduling) and the driver is known from the session, so a truck is all that is
 *  left to choose. */
export interface StartRunRequest {
  truckId: string;
}

// ---------------------------------------------------------------------------
// Resolving a stop (S1.5 check-off / skip)
// ---------------------------------------------------------------------------

/**
 * The two dispositions a *driver* may set. The rest of the enum is not theirs:
 * `PENDING` is set by the system at snapshot time, and `REASSIGNED` is staff-only
 * (I30). `WEIGHED` is derived and never written at all (I12).
 */
export const DRIVER_RESOLUTIONS = ['COLLECTED', 'SKIPPED'] as const;
export type DriverResolution = (typeof DRIVER_RESOLUTIONS)[number];

export interface ResolveStopRequest {
  disposition: DriverResolution;
  /** Optional driver→receiver note, saved with the same tap. */
  note?: string | null;
}

/** A note edit on its own — S1.5 puts the note field on the stop, not on the
 *  check-off. Last write wins (`data-model.md §9`, field edits). */
export interface StopNoteRequest {
  note: string | null;
}

/**
 * Drag-and-drop reorder (S1.5). The list carries the order, so the server assigns
 * positions and a client can never submit a sparse or colliding sequence — the same
 * contract the route builder uses (`routes.ts`). Must name every stop of the shift.
 */
export interface ReorderStopsRequest {
  stopIds: string[];
}

/** The driver's whole-run note (cap 11, channel 3), editable on the review screen. */
export interface RunNoteRequest {
  note: string | null;
}

// ---------------------------------------------------------------------------
// Heading back (I27)
// ---------------------------------------------------------------------------

/**
 * "Confirm — heading back" (S1.5). The review screen may carry a last edit of the
 * run note, so it rides along rather than needing a second request.
 *
 * Sets `Shift.pickup_completed_at`. A handoff signal, not a completion: the shift
 * stays `IN_PROGRESS` (I27).
 */
export interface CompletePickupRequest {
  note?: string | null;
}

/** The refusal when a stop is still `PENDING`. S1.5 hides the button until every
 *  stop is resolved, so this is the server saying the same thing again — a
 *  client-side check is communication only. */
export const PICKUP_INCOMPLETE_MESSAGE =
  'Finish or skip every stop before you head back.';

// ---------------------------------------------------------------------------
// Mid-run reassignment (I30, staff-only — S1.3)
// ---------------------------------------------------------------------------

/**
 * Move one unresolved stop to another driver's run. Never an in-place `shift_id`
 * update: the source stop becomes `REASSIGNED` and the destination gets a NEW row,
 * because a `ShiftStop` is a frozen per-shift snapshot (I5/I30).
 */
export interface ReassignStopRequest {
  /** The destination run. Must be a different, already-started shift — I5 puts stop
   *  rows on a shift only from `IN_PROGRESS` onward, so a not-yet-started run has no
   *  stop list to append to. */
  toShiftId: string;
}

export interface ReassignStopResponse {
  /** The source stop, now `REASSIGNED` — terminal, and excluded from that shift's
   *  gates (I30). */
  from: RunStopSummary;
  /** The brand-new stop on the destination run: fresh position, `PENDING`. */
  to: RunStopSummary;
}
