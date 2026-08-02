// Pickup execution — PRD cap 10, `ui-ux-spec.md S1.5`, `domain-modeling.md §3.1/§3.2`.
//
// The driver's half of a run: start it (pick a truck, snapshot the route), resolve
// each stop, write the two note channels that belong to the run, and — optionally —
// raise the I27 handoff. Plus the staff-only mid-run reassignment (I30) and the
// 1-hour reminder sweep's write path, because a job may not open a transaction of its
// own (`architecture.md §4.1`).
//
// THE RUN NEVER CLOSES HERE, AND THAT IS THE POINT (build-plan D1). I11 makes the
// receiver's receive-done the only completion action and the receiver ships in
// Phase 2, so a started Phase-1 shift stays `IN_PROGRESS` permanently — after the
// last stop is resolved, after `pickup_completed_at` is set, forever. There is
// deliberately no close-run function, no auto-complete, and no other transition into
// `COMPLETED` in this file: a second completion path would contradict I11 and would
// have to be removed again in Phase 2.
//
// Three enforcement tiers are in play (`architecture.md §4.1`), and this file is only
// the third of them:
//
//   tier 1  `ck_shift_truck` (I8), `uq_shift_stop_donor` (I28),
//           `uq_shift_stop_position` (deferred), `ck_shift_owner` (I7)
//   tier 2  the conditional-UPDATE predicates of `data-model.md §9` — start is
//           `status='CLAIMED' AND owner_id=:me`, and rowcount 0 IS the lost race
//   tier 3  here: I5's snapshot, I27's cross-row gate, I30's close-old + insert-new
//
// Every write goes through `writeTransaction` (SERIALIZABLE + 40001 retry) and every
// gate's read is taken inside that same transaction — a gate whose read happens
// outside its write is decoration (§4.1).

import { sql } from 'kysely';
import { tierAtLeast, type Tier } from '../../../shared/src/index.js';
import {
  DRIVER_RESOLUTIONS,
  PICKUP_INCOMPLETE_MESSAGE,
  type DriverResolution,
  type ReassignStopResponse,
  type RunDetail,
  type RunStopSummary,
} from '../../../shared/src/execution.js';
import { db } from '../db/index.js';
import type { ShiftstopDisposition } from '../db/types.js';
import { writeTransaction, type Tx } from '../db/transaction.js';
import { badRequest, conflict, forbidden, notFound } from '../middleware/error.js';
import { formatRange } from '../time.js';
import { dispatchNow } from '../jobs/push-dispatch.js';
import { enqueueNotifications } from './notification.js';
import type { Reader } from './eligibility.js';

export interface ExecutionActor {
  id: string;
  tier: Tier;
}

/**
 * The dispositions that count as driver-side resolution — the I27 gate's set.
 *
 * I27 states it as `{COLLECTED, SKIPPED}`; `domain-modeling.md §3.2`'s last bullet
 * states the same gate as `{COLLECTED, SKIPPED, REASSIGNED}`, because a `REASSIGNED`
 * stop is terminal and "excluded from this shift's completion gate" — it is no longer
 * this run's to resolve. The locked doc settles its own wording, so `REASSIGNED`
 * counts; `data-model.md §6` writes the milestone gate out the same way.
 */
const RESOLVED_FOR_HANDOFF: readonly ShiftstopDisposition[] = [
  'COLLECTED',
  'SKIPPED',
  'REASSIGNED',
];

/** I30: only an unresolved stop may move — by stored disposition. The other half of
 *  "unresolved", the "not yet weighed" clause, is a separate check in `reassignStop`
 *  because it is a cross-table read (`weight_entry`) that no disposition can express.
 *  Phase 1 could not make that check at all; the table it needs arrived with D3. */
const MOVABLE_DISPOSITIONS: readonly ShiftstopDisposition[] = ['PENDING', 'COLLECTED'];

// ---------------------------------------------------------------------------
// Reading a run
// ---------------------------------------------------------------------------

/**
 * The run as one payload.
 *
 * Donor name, address and permanent note are joined LIVE through `shift_stop.donor_id`
 * (I5): the snapshot freezes which donors and in what order, never their details, so
 * an address corrected mid-run reaches the driver. Donor address is operational data,
 * not PII — `pii.ts` gates people, not places (`CLAUDE.md`).
 */
async function readRun(reader: Reader, shiftId: string): Promise<RunDetail> {
  const shift = await reader
    .selectFrom('shift')
    .innerJoin('route', 'route.id', 'shift.route_id')
    .leftJoin('truck', 'truck.id', 'shift.truck_id')
    .select([
      'shift.id as id',
      'shift.status as status',
      'shift.route_id as routeId',
      'route.name as routeName',
      'shift.starts_at as startsAt',
      'shift.ends_at as endsAt',
      'shift.owner_id as ownerId',
      'shift.truck_id as truckId',
      'truck.truck_name as truckName',
      'shift.note as note',
      'shift.staff_note as staffNote',
      'shift.pickup_completed_at as pickupCompletedAt',
      'shift.assigned_over_conflict as assignedOverConflict',
    ])
    .where('shift.id', '=', shiftId)
    .executeTakeFirst();

  if (!shift) throw notFound('No such run.');

  const stops = await readStops(reader, shiftId);

  return {
    shiftId: shift.id,
    status: shift.status,
    routeId: shift.routeId,
    routeName: shift.routeName,
    startsAt: shift.startsAt.toISOString(),
    endsAt: shift.endsAt.toISOString(),
    ownerId: shift.ownerId,
    truckId: shift.truckId,
    truckName: shift.truckName,
    note: shift.note,
    staffNote: shift.staffNote,
    pickupCompletedAt: shift.pickupCompletedAt?.toISOString() ?? null,
    assignedOverConflict: shift.assignedOverConflict,
    stops,
  };
}

async function readStops(reader: Reader, shiftId: string): Promise<RunStopSummary[]> {
  const rows = await reader
    .selectFrom('shift_stop')
    .innerJoin('donor', 'donor.id', 'shift_stop.donor_id')
    .select([
      'shift_stop.id as id',
      'shift_stop.donor_id as donorId',
      'donor.name as donorName',
      'donor.address as donorAddress',
      'donor.note as donorNote',
      'shift_stop.position as position',
      'shift_stop.disposition as disposition',
      'shift_stop.note as note',
    ])
    .where('shift_stop.shift_id', '=', shiftId)
    .orderBy('shift_stop.position')
    .execute();

  return rows.map((row) => ({ ...row }));
}

async function readStop(reader: Reader, stopId: string): Promise<RunStopSummary> {
  const rows = await reader
    .selectFrom('shift_stop')
    .innerJoin('donor', 'donor.id', 'shift_stop.donor_id')
    .select([
      'shift_stop.id as id',
      'shift_stop.donor_id as donorId',
      'donor.name as donorName',
      'donor.address as donorAddress',
      'donor.note as donorNote',
      'shift_stop.position as position',
      'shift_stop.disposition as disposition',
      'shift_stop.note as note',
    ])
    .where('shift_stop.id', '=', stopId)
    .execute();

  const stop = rows[0];
  if (!stop) throw notFound('No such stop.');
  return stop;
}

/**
 * Read a run. The owner always may; Staff and above may because
 * `product-requirement.md §2` gives them "operational status across all volunteers",
 * and S1.3's staff desktop view is where the reassign action lives.
 *
 * Hierarchical (`>=`), never an equality test — requiring Staff admits Admin (I1).
 * Read-only, so no transaction (§4.1 permits the default isolation for reads).
 */
export async function getRun(actor: ExecutionActor, shiftId: string): Promise<RunDetail> {
  const run = await readRun(db, shiftId);
  if (run.ownerId !== actor.id && !tierAtLeast(actor.tier, 'STAFF')) {
    throw forbidden('That run is not yours.');
  }
  return run;
}

// ---------------------------------------------------------------------------
// Start (CLAIMED -> IN_PROGRESS)
// ---------------------------------------------------------------------------

interface ShiftGuard {
  status: string;
  ownerId: string | null;
  routeId: string;
}

async function loadShiftGuard(tx: Tx, shiftId: string): Promise<ShiftGuard> {
  const row = await tx
    .selectFrom('shift')
    .select(['status', 'owner_id as ownerId', 'route_id as routeId'])
    .where('id', '=', shiftId)
    .executeTakeFirst();
  if (!row) throw notFound('No such run.');
  return row;
}

/**
 * Start the run: `CLAIMED → IN_PROGRESS`, truck picked, route snapshotted — one
 * transaction, because `domain-modeling.md §3.1` makes them one event and I8 makes
 * them inseparable anyway (`ck_shift_truck` rejects a `truck_id` on a `CLAIMED` row,
 * so the truck cannot be set before the transition or after it in a second statement
 * without a moment where the row is illegal).
 *
 * The transition is `data-model.md §9`'s conditional UPDATE verbatim: the precondition
 * IS the optimistic check and `rowcount = 0` means the state moved under us. The
 * re-read after a miss only produces the message.
 */
export async function startRun(
  actor: ExecutionActor,
  shiftId: string,
  input: { truckId: string },
): Promise<RunDetail> {
  return writeTransaction(async (tx) => {
    const truck = await tx
      .selectFrom('truck')
      .select(['id', 'deactivated_at'])
      .where('id', '=', input.truckId)
      .executeTakeFirst();
    if (!truck) throw notFound('No such truck.');
    // I21 / `domain-modeling.md §3.3`: an inactive truck is hidden from driver
    // selection, not deleted. The picker already filters them; this is the server
    // saying it again, because a client-side check is communication only.
    if (truck.deactivated_at !== null) {
      throw conflict('That truck is out of service. Pick another.');
    }

    const shift = await loadShiftGuard(tx, shiftId);

    // Tier 2 (`data-model.md §9`, "start"). Truck and status move in one statement.
    const updated = await tx
      .updateTable('shift')
      .set({
        status: 'IN_PROGRESS',
        truck_id: input.truckId,
        updated_by: actor.id,
        updated_at: sql<Date>`now()`,
      })
      .where('id', '=', shiftId)
      .where('status', '=', 'CLAIMED')
      .where('owner_id', '=', actor.id)
      .executeTakeFirst();

    if (updated.numUpdatedRows === 0n) {
      if (shift.ownerId !== actor.id) throw forbidden('That run is not yours.');
      if (shift.status === 'IN_PROGRESS') throw conflict('That run is already started.');
      throw conflict('That run cannot be started from its current state.');
    }

    // I5 — the snapshot, taken HERE and only here. Copied from the route's ordered
    // RouteStops at start; positions are renumbered from 0 so the snapshot's order is
    // its own fact rather than an echo of whatever numbering the template holds. The
    // donor is a live FK, not a copy (I5/I6): editing the route afterwards can never
    // reach these rows, but a donor's address correction does.
    const template = await tx
      .selectFrom('route_stop')
      .select(['donor_id'])
      .where('route_id', '=', shift.routeId)
      .orderBy('position')
      .execute();

    if (template.length > 0) {
      // I28 holds on the way in: `uq_shift_stop_donor` is tier 1, and a route cannot
      // list a donor twice either (same invariant, route side).
      await tx
        .insertInto('shift_stop')
        .values(
          template.map((stop, position) => ({
            shift_id: shiftId,
            donor_id: stop.donor_id,
            position,
          })),
        )
        .execute();
    }

    return readRun(tx, shiftId);
  });
}

// ---------------------------------------------------------------------------
// Resolving stops
// ---------------------------------------------------------------------------

interface StopContext {
  stopId: string;
  disposition: ShiftstopDisposition;
  shiftStatus: string;
  ownerId: string | null;
}

/**
 * Load a stop with its shift, and check the two things every driver-side write needs:
 * the actor owns the run, and the run is in progress.
 *
 * Ownership is a resource rule — it needs the row, not just the session — so it is
 * enforced here in the transaction rather than at the route (`architecture.md §4.3`).
 */
async function loadOwnedStop(
  tx: Tx,
  actor: ExecutionActor,
  shiftId: string,
  stopId: string,
): Promise<StopContext> {
  const row = await tx
    .selectFrom('shift_stop')
    .innerJoin('shift', 'shift.id', 'shift_stop.shift_id')
    .select([
      'shift_stop.id as stopId',
      'shift_stop.disposition as disposition',
      'shift_stop.shift_id as shiftId',
      'shift.status as shiftStatus',
      'shift.owner_id as ownerId',
    ])
    .where('shift_stop.id', '=', stopId)
    .executeTakeFirst();

  if (!row || row.shiftId !== shiftId) throw notFound('No such stop.');
  if (row.ownerId !== actor.id) throw forbidden('That run is not yours.');
  // I5: stops exist only from IN_PROGRESS onward, so anything else is a run that has
  // moved on — a driver cannot check off a stop on a run they have not started.
  if (row.shiftStatus !== 'IN_PROGRESS') {
    throw conflict('That run is not in progress.');
  }
  return {
    stopId: row.stopId,
    disposition: row.disposition,
    shiftStatus: row.shiftStatus,
    ownerId: row.ownerId,
  };
}

/**
 * Check off or skip one stop (S1.5).
 *
 * `domain-modeling.md §3.2` gives the driver exactly two edges, both out of
 * `PENDING`: collect and skip. `COLLECTED → SKIPPED` exists but belongs to the
 * receiver ("nothing came"), and `REASSIGNED` is terminal and staff-only (I30) — so
 * the conditional UPDATE's predicate is `disposition = 'PENDING'` and nothing here
 * can walk the machine backwards. There is no un-check action because the state
 * machine has no edge back to `PENDING`.
 *
 * Re-sending the disposition a stop already holds succeeds without a write: a driver
 * double-tapping on a flaky phone connection is not a lost race.
 */
export async function resolveStop(
  actor: ExecutionActor,
  shiftId: string,
  stopId: string,
  input: { disposition: DriverResolution; note?: string | null },
): Promise<RunStopSummary> {
  if (!DRIVER_RESOLUTIONS.includes(input.disposition)) {
    throw badRequest('disposition must be COLLECTED or SKIPPED.');
  }

  return writeTransaction(async (tx) => {
    const stop = await loadOwnedStop(tx, actor, shiftId, stopId);

    if (stop.disposition === input.disposition) {
      if (input.note !== undefined) await writeStopNote(tx, stopId, input.note);
      return readStop(tx, stopId);
    }
    if (stop.disposition === 'REASSIGNED') {
      throw conflict('That stop was moved to another run.');
    }
    if (stop.disposition === 'COLLECTED') {
      // §3.2: COLLECTED → SKIPPED is the receiver's edge, not the driver's.
      throw conflict('That stop is already checked off.');
    }

    const updated = await tx
      .updateTable('shift_stop')
      .set({
        disposition: input.disposition,
        ...(input.note !== undefined ? { note: input.note } : {}),
      })
      .where('id', '=', stopId)
      .where('disposition', '=', 'PENDING')
      .executeTakeFirst();

    if (updated.numUpdatedRows === 0n) {
      throw conflict('That stop was already resolved.');
    }

    return readStop(tx, stopId);
  });
}

async function writeStopNote(tx: Tx, stopId: string, note: string | null): Promise<void> {
  // A plain field edit: last write wins, no prior value worth preserving
  // (`data-model.md §9`). `shift_stop` carries no provenance columns — the run's
  // author is on `shift` (I26).
  await tx.updateTable('shift_stop').set({ note }).where('id', '=', stopId).execute();
}

/**
 * The driver→receiver note for one stop (cap 11, channel 2). Its own action because
 * S1.5 puts the field on the stop rather than on the check-off, and the receiver
 * reads it at weight entry whether the stop was collected or skipped.
 */
export async function setStopNote(
  actor: ExecutionActor,
  shiftId: string,
  stopId: string,
  note: string | null,
): Promise<RunStopSummary> {
  return writeTransaction(async (tx) => {
    await loadOwnedStop(tx, actor, shiftId, stopId);
    await writeStopNote(tx, stopId, note);
    return readStop(tx, stopId);
  });
}

/**
 * Reorder the stop list mid-run (S1.5: drag handles, "changing order never loses
 * check state" — this writes `position` and nothing else).
 *
 * `stopIds` carries the order, so the server assigns the numbers and a client cannot
 * submit a sparse or colliding sequence. It must name every stop of this run that is
 * still on it: `REASSIGNED` stops are off this run's list (S1.3 shows them
 * struck-through, S1.5 not at all), so they are not sent and are pushed to the end
 * here, keeping their relative order.
 *
 * Positions collide transiently while the loop runs; `uq_shift_stop_position` is
 * DEFERRABLE INITIALLY DEFERRED and is checked at commit (`data-model.md §6`).
 */
export async function reorderStops(
  actor: ExecutionActor,
  shiftId: string,
  stopIds: readonly string[],
): Promise<RunStopSummary[]> {
  return writeTransaction(async (tx) => {
    const shift = await loadShiftGuard(tx, shiftId);
    if (shift.ownerId !== actor.id) throw forbidden('That run is not yours.');
    if (shift.status !== 'IN_PROGRESS') throw conflict('That run is not in progress.');

    const current = await tx
      .selectFrom('shift_stop')
      .select(['id', 'disposition'])
      .where('shift_id', '=', shiftId)
      .orderBy('position')
      .execute();

    const onTheRun = current.filter((s) => s.disposition !== 'REASSIGNED');
    const submitted = new Set(stopIds);
    if (
      submitted.size !== stopIds.length ||
      submitted.size !== onTheRun.length ||
      onTheRun.some((s) => !submitted.has(s.id))
    ) {
      throw badRequest('stopIds must list every stop on this run exactly once.');
    }

    const ordered = [
      ...stopIds,
      ...current.filter((s) => s.disposition === 'REASSIGNED').map((s) => s.id),
    ];

    for (const [position, id] of ordered.entries()) {
      await tx.updateTable('shift_stop').set({ position }).where('id', '=', id).execute();
    }

    return readStops(tx, shiftId);
  });
}

// ---------------------------------------------------------------------------
// The run note (cap 11, channel 3)
// ---------------------------------------------------------------------------

/**
 * `Shift.note` — the driver's one whole-run remark, distinct storage from
 * `Shift.staff_note` (coordinator→driver) and from every `ShiftStop.note`. Written
 * during the run and on S1.5's review screen, which calls it the last chance before
 * the receiver sees it.
 *
 * Stamps `updated_by` (I26, last-writer). LWW, like every field edit
 * (`data-model.md §9`).
 */
export async function setRunNote(
  actor: ExecutionActor,
  shiftId: string,
  note: string | null,
): Promise<RunDetail> {
  return writeTransaction(async (tx) => {
    const shift = await loadShiftGuard(tx, shiftId);
    if (shift.ownerId !== actor.id) throw forbidden('That run is not yours.');
    if (shift.status !== 'IN_PROGRESS') throw conflict('That run is not in progress.');

    await tx
      .updateTable('shift')
      .set({ note, updated_by: actor.id, updated_at: sql<Date>`now()` })
      .where('id', '=', shiftId)
      .execute();

    return readRun(tx, shiftId);
  });
}

// ---------------------------------------------------------------------------
// Heading back (I27)
// ---------------------------------------------------------------------------

/**
 * Set `Shift.pickup_completed_at` — "done / heading back".
 *
 * I27, in three parts, all of them load-bearing:
 *
 *   1. **Gate.** Settable only once every ShiftStop is driver-resolved. Cross-row, so
 *      no CHECK can express it (`data-model.md §6`) — it is tier 3, read inside this
 *      transaction alongside its write.
 *   2. **Not a state change.** The shift stays `IN_PROGRESS`. The UPDATE below
 *      deliberately does not touch `status`, and the test suite asserts the run is
 *      still `IN_PROGRESS` afterwards. Only the receiver's receive-done closes a
 *      shift (I11), and that ships in Phase 2 (build-plan D1).
 *   3. **Trigger.** Setting it fires the Receiver notification — the truck-inbound
 *      alert (PRD cap 10; S1.5 "fires the truck-inbound push, device-scoped, S2.4").
 *      Phase 1 wrote the milestone and enqueued nothing, because truck-inbound was
 *      the one part of cap 13 the PRD held back. Phase 2 connects it, and the wiring
 *      is deliberately gated on the milestone actually being NEW: see below.
 *
 * Idempotent: a second confirm keeps the first timestamp. The milestone is the moment
 * the driver said they were heading back, and there is only one of those — which is
 * also what stops a second tap from banging the dock's tablet a second time, since
 * `TRUCK_INBOUND` is device-scoped and therefore outside `uq_notif_shift_event`'s
 * partial index (`recipient_id IS NOT NULL`). The dedupe here is the rowcount, not
 * the constraint.
 */
export async function completePickup(
  actor: ExecutionActor,
  shiftId: string,
  input: { note?: string | null } = {},
): Promise<RunDetail> {
  const { detail, alerted } = await writeTransaction(async (tx) => {
    const shift = await loadShiftGuard(tx, shiftId);
    if (shift.ownerId !== actor.id) throw forbidden('That run is not yours.');
    if (shift.status !== 'IN_PROGRESS') throw conflict('That run is not in progress.');

    const unresolved = await tx
      .selectFrom('shift_stop')
      .select('id')
      .where('shift_id', '=', shiftId)
      .where('disposition', 'not in', [...RESOLVED_FOR_HANDOFF])
      .execute();

    if (unresolved.length > 0) throw conflict(PICKUP_INCOMPLETE_MESSAGE);

    const milestone = await tx
      .updateTable('shift')
      .set({
        // `status` is deliberately absent: I27 is a milestone within IN_PROGRESS.
        pickup_completed_at: sql<Date>`now()`,
        updated_by: actor.id,
        updated_at: sql<Date>`now()`,
      })
      .where('id', '=', shiftId)
      // Keeps the first confirm's timestamp; a second tap only carries the note.
      .where('pickup_completed_at', 'is', null)
      .executeTakeFirst();

    // Rowcount 1 = the milestone is new, so this is the tap that means "heading
    // back". Rowcount 0 = a repeat confirm, and the dock has already been told.
    const firstConfirm = Number(milestone.numUpdatedRows) > 0;

    // S1.5's review screen carries a last edit of the whole-run note. Separate
    // statement so it applies on a second confirm too, where the milestone write
    // above is a no-op by design.
    if (input.note !== undefined) {
      await tx
        .updateTable('shift')
        .set({ note: input.note, updated_by: actor.id, updated_at: sql<Date>`now()` })
        .where('id', '=', shiftId)
        .execute();
    }

    // Truck inbound → the receiver tablet's DEVICE subscriptions (PRD matrix, S2.4).
    // Fan-out is over `device_id IS NOT NULL` live rows: the alert has to reach a
    // dock that may have nobody logged in, so it is addressed to the endpoint rather
    // than to a person. `recipient_id` stays null, which `ck_notif_recipient` requires
    // as the other half of the pair.
    //
    // Enqueued INSIDE this transaction (§4.4): the outbox row and the milestone commit
    // together, so a rolled-back milestone cannot leave the dock expecting a truck.
    let alerted = 0;
    if (firstConfirm) {
      const config = await tx
        .selectFrom('app_config')
        .select('timezone')
        .executeTakeFirstOrThrow();

      const run = await tx
        .selectFrom('shift')
        .innerJoin('route', 'route.id', 'shift.route_id')
        .leftJoin('app_user as owner', 'owner.id', 'shift.owner_id')
        .select([
          'route.name as routeName',
          sql<string | null>`concat_ws(' ', owner.first_name, owner.last_name)`.as('ownerName'),
          'shift.starts_at as startsAt',
          'shift.ends_at as endsAt',
        ])
        .where('shift.id', '=', shiftId)
        .executeTakeFirstOrThrow();

      const devices = await tx
        .selectFrom('push_subscription')
        .select('id')
        .where('device_id', 'is not', null)
        .where('revoked_at', 'is', null)
        .execute();

      const ids = await enqueueNotifications(
        tx,
        devices.map((device) => ({
          event: 'TRUCK_INBOUND' as const,
          subscriptionId: device.id,
          shiftId,
          payload: {
            route: run.routeName,
            who: run.ownerName === null || run.ownerName === '' ? undefined : run.ownerName,
            when: formatRange({ startsAt: run.startsAt, endsAt: run.endsAt }, config.timezone),
          },
        })),
      );
      alerted = ids.length;
    }

    return { detail: await readRun(tx, shiftId), alerted };
  });

  // Outside the transaction (§4.1 obligation 3): a SERIALIZABLE retry would re-send.
  // Dispatch's own sweep is what makes delivery correct; this only makes it prompt,
  // which for "the truck is pulling in" is most of the value.
  if (alerted > 0) dispatchNow();

  return detail;
}

// ---------------------------------------------------------------------------
// Mid-run reassignment (I30)
// ---------------------------------------------------------------------------

/**
 * Move one unresolved stop to another run (staff-only, S1.3).
 *
 * **Close old + insert new, never an in-place `shift_id` update** (I30). A
 * `ShiftStop` is a frozen per-shift snapshot owned by exactly one Shift (I5);
 * re-pointing the FK would silently rewrite the source run's history to say the stop
 * was never on it. So the source row's disposition becomes `REASSIGNED` — terminal,
 * and excluded from that shift's gates — and the destination gets a brand-new row,
 * appended at the end of that driver's stop list with a fresh position and `PENDING`.
 *
 * I28 holds independently on both shifts and needs no relaxing: the two rows live on
 * two different shifts. The destination's own `uq_shift_stop_donor` is tier 1 and
 * would raise anyway; the check below exists to say why in a sentence.
 */
export async function reassignStop(
  actor: ExecutionActor,
  shiftId: string,
  stopId: string,
  input: { toShiftId: string },
): Promise<ReassignStopResponse> {
  if (input.toShiftId === shiftId) {
    throw badRequest('Pick a different run to move the stop to.');
  }

  return writeTransaction(async (tx) => {
    const source = await tx
      .selectFrom('shift_stop')
      .innerJoin('shift', 'shift.id', 'shift_stop.shift_id')
      .select([
        'shift_stop.id as stopId',
        'shift_stop.donor_id as donorId',
        'shift_stop.disposition as disposition',
        'shift_stop.shift_id as shiftId',
        'shift.status as shiftStatus',
      ])
      .where('shift_stop.id', '=', stopId)
      .executeTakeFirst();

    if (!source || source.shiftId !== shiftId) throw notFound('No such stop.');
    if (source.shiftStatus !== 'IN_PROGRESS') {
      throw conflict('That run is not in progress.');
    }
    if (!MOVABLE_DISPOSITIONS.includes(source.disposition)) {
      // I30: only PENDING or unweighed-COLLECTED may move. A resolved stop is not
      // "in" the stop list to move any more.
      throw conflict('That stop is already resolved. There is nothing left to move.');
    }

    // The "unweighed" half of I30's eligibility, live from Phase 2 onward. A stop
    // that has already produced a `weight_entry` projects to WEIGHED (I12) and is
    // therefore resolved, even though its stored disposition still reads COLLECTED —
    // WEIGHED is never stored, so the disposition check above cannot see it. Moving
    // such a stop would strand its weights on a run that no longer lists it.
    const weighed = await tx
      .selectFrom('weight_entry')
      .select('id')
      .where('shift_id', '=', source.shiftId)
      .where('donor_id', '=', source.donorId)
      .where('voided', '=', false)
      .executeTakeFirst();

    if (weighed) {
      throw conflict('That stop has already been weighed. There is nothing left to move.');
    }

    const destination = await tx
      .selectFrom('shift')
      .select(['id', 'status'])
      .where('id', '=', input.toShiftId)
      .executeTakeFirst();

    if (!destination) throw notFound('No such run to move the stop to.');
    // I5 puts ShiftStop rows on a shift only from IN_PROGRESS onward, so a run that
    // has not started has no stop list to append to — and its snapshot, taken later
    // from the route template, would not contain this stop.
    if (destination.status !== 'IN_PROGRESS') {
      throw conflict('That run has not started, so it has no stop list yet.');
    }

    const clash = await tx
      .selectFrom('shift_stop')
      .select('id')
      .where('shift_id', '=', input.toShiftId)
      .where('donor_id', '=', source.donorId)
      .executeTakeFirst();
    if (clash) {
      // I28 — a donor appears at most once among a shift's stops.
      throw conflict('That run already has a stop for this store.');
    }

    const moved = await tx
      .updateTable('shift_stop')
      .set({ disposition: 'REASSIGNED' })
      .where('id', '=', stopId)
      .where('disposition', 'in', [...MOVABLE_DISPOSITIONS])
      .executeTakeFirst();
    if (moved.numUpdatedRows === 0n) {
      throw conflict('That stop was resolved while you were moving it.');
    }

    const tail = await tx
      .selectFrom('shift_stop')
      .select(({ fn }) => fn.max<number>('position').as('maxPosition'))
      .where('shift_id', '=', input.toShiftId)
      .executeTakeFirst();

    const inserted = await tx
      .insertInto('shift_stop')
      .values({
        shift_id: input.toShiftId,
        donor_id: source.donorId,
        // Appended at the end of that driver's current stop list (I30).
        position: (tail?.maxPosition ?? -1) + 1,
        // Fresh: the new driver has not been there yet. The source stop's
        // driver→receiver note stays with the visit that did not happen.
        disposition: 'PENDING',
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    return {
      from: await readStop(tx, stopId),
      to: await readStop(tx, inserted.id),
    };
  });
}

// ---------------------------------------------------------------------------
// The 1-hour shift reminder (§4.4, PRD notification matrix)
// ---------------------------------------------------------------------------

/**
 * "Shift reminder (hard-coded 1-hour offset before start) → the owning driver,
 * push + flag, time-triggered" (`product-requirement.md §4`).
 *
 * A CATCH-UP SWEEP, not a timer (`architecture.md §4.4`): it asks the database what
 * is due and unhandled, so a missed tick or a restart delays a reminder instead of
 * losing it. "Unhandled" is the `NOT EXISTS` below — and the guarantee behind it is
 * the tier-1 partial index `uq_notif_shift_event`, which makes a duplicate send
 * impossible rather than unlikely; `enqueueNotification` absorbs the conflict.
 *
 * This write path lives in `services/` because `jobs/reminder.ts` may not open a
 * transaction of its own: nothing outside `services/` does (§4.1). The job is a
 * one-line call.
 *
 * Bounded on BOTH sides of now: a run whose start has already passed gets no
 * reminder. Catch-up heals a late tick, but "your run starts in an hour" about a run
 * that began two hours ago is a false statement, and the driver who missed it is a
 * NO_SHOW the reporting doc already counts (`domain-modeling.md §3.1`).
 */
export async function sendDueShiftReminders(): Promise<number> {
  const sent = await writeTransaction(async (tx) => {
    const config = await tx
      .selectFrom('app_config')
      .select('timezone')
      .executeTakeFirstOrThrow();

    const due = await tx
      .selectFrom('shift')
      .innerJoin('route', 'route.id', 'shift.route_id')
      .innerJoin('app_user', 'app_user.id', 'shift.owner_id')
      .select([
        'shift.id as shiftId',
        'shift.owner_id as ownerId',
        'shift.starts_at as startsAt',
        'shift.ends_at as endsAt',
        'route.name as routeName',
      ])
      // The matrix's recipient is "the owning driver". A run already IN_PROGRESS
      // needs no reminder — its driver is on it — and an OPEN one has nobody to
      // remind (that gap is the at-risk alert's, a different row of the matrix).
      .where('shift.status', '=', 'CLAIMED')
      // I21: a deactivated account is hidden from new use and cannot sign in to read
      // an inbox. The fan-out filters them for the same reason (`architecture.md
      // §4.1`, `eligible()`'s active clause).
      .where('app_user.deactivated_at', 'is', null)
      .where(sql<boolean>`shift.starts_at > now()`)
      .where(sql<boolean>`shift.starts_at <= now() + interval '1 hour'`)
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('notification')
              .select(sql<number>`1`.as('one'))
              .where('notification.event', '=', 'SHIFT_REMINDER')
              .whereRef('notification.shift_id', '=', 'shift.id')
              .whereRef('notification.recipient_id', '=', 'shift.owner_id'),
          ),
        ),
      )
      .execute();

    const ids = await enqueueNotifications(
      tx,
      due.map((run) => ({
        event: 'SHIFT_REMINDER' as const,
        recipientId: run.ownerId,
        shiftId: run.shiftId,
        payload: {
          route: run.routeName,
          // Pre-formatted here because only this side has `app_config.timezone`;
          // dispatch stays a dumb sender (open assumption A7). One implementation of
          // the arithmetic, in `../time.ts` — never a second copy.
          when: formatRange({ startsAt: run.startsAt, endsAt: run.endsAt }, config.timezone),
        },
      })),
    );

    return ids.length;
  });

  // Outside the transaction (§4.1 obligation 3 / §4.4): a SERIALIZABLE retry would
  // re-send. The sweep in `push-dispatch.ts` is what makes delivery correct; this
  // only makes it prompt.
  if (sent > 0) dispatchNow();

  return sent;
}
