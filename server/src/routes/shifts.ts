// Scheduling routes — publish, edit, move, cancel a run; create and edit a repeating
// pattern (`product-requirement.md` caps 4 and 9, the staff half of cap 8,
// `ui-ux-spec.md S1.2`/`S1.6`/`S1.7`).
//
// Parse, declare, shape (`architecture.md §4.3`). Not one domain rule lives here: the
// I9/I10 cancel guard, the I20 reschedule conflict list, I23/I24's pattern separation
// and I25's born-CLAIMED gate are all in `services/schedule.ts` and
// `services/recurrence.ts`, because a rule that needs the database is a service rule
// and because the materialization job is a second caller that never touches a route.
//
// EVERY ROUTE DECLARES ITS ACCESS, and the two tiers below are not interchangeable:
//
//   * The board is `{ tier: 'VOLUNTEER' }` — any signed-in user. Cap 5 makes the board
//     the shared, collaborative surface ("all drivers see every shift ... and the
//     owning driver's name"), and names are public-within-org rather than PII
//     (`product-requirement.md §2`). It is deliberately NOT `anyDuty: ['DRIVE']`: a
//     Staff coordinator who does not drive still has to read the board, and tier never
//     confers a duty (§4.3's easy bug).
//   * Every mutation is `{ tier: 'STAFF' }`. Cap 4 and cap 9 give publishing,
//     editing, rescheduling and bulk-terminate to Staff. The comparison is
//     hierarchical (I1) so Admin is admitted by the same declaration, never a second.
//
// Claiming and releasing are NOT here. They are cap 6/8 and belong to the coverage
// lane; nothing in this file sets or clears an owner except cap 9's confirmed release,
// which is the reschedule flow's own half of the capability.
//
// Imported by RELATIVE path, not as `@r3/shared`: inside a git worktree
// `node_modules/@r3/shared` resolves to the main checkout's copy, so a package import
// would typecheck this lane against a different tree (open assumptions A34 / A78).

import type { Tier } from '../../../shared/src/index.js';
import type {
  BulkTerminateResponse,
  CancelShiftResponse,
  CreatePatternResponse,
  CreateShiftResponse,
  DuplicateRunWarning,
  PlannedStop,
  RecurrencePatternSummary,
  RescheduleShiftResponse,
  ShiftDetail,
  ShiftSummary,
  UpdatePatternResponse,
} from '../../../shared/src/schedule.js';
import { notFound } from '../middleware/error.js';
import {
  bulkTerminate,
  cancelShift,
  createShift,
  getShift,
  listShifts,
  rescheduleShift,
  updateShift,
  type DuplicateRun,
  type PlannedStopRecord,
  type ScheduleActor,
  type ShiftRecord,
  type ShiftWithStops,
} from '../services/schedule.js';
import {
  createPattern,
  getPattern,
  listPatterns,
  updatePattern,
  type PatternRecord,
} from '../services/recurrence.js';
import { body, defineRoute, optionalString, requiredString } from './registry.js';

function actorOf(req: { actor?: { id: string; tier: Tier } }): ScheduleActor {
  const actor = req.actor!; // the gate guarantees an actor on every non-public route
  return { id: actor.id };
}

// ---------------------------------------------------------------------------
// Shaping
// ---------------------------------------------------------------------------

/**
 * `ShiftRecord` → the wire.
 *
 * `owner_first_name` / `owner_last_name` go straight through: `pii.ts` is the sole
 * exit path for `app_user`'s PHONE and ADDRESS, and a name is neither
 * (`product-requirement.md §2` — names are public-within-org, shown on the shared
 * board precisely so drivers see who owns each run). Nothing here is owed a shaping
 * step, and routing a name through `shapeUser()` would imply the opposite.
 *
 * Instants are ISO-8601; `occurrenceDate` stays the `YYYY-MM-DD` calendar slot the
 * service read as text.
 */
function shapeShift(record: ShiftRecord): ShiftSummary {
  const ownerName = [record.owner_first_name, record.owner_last_name]
    .filter((part) => part !== null && part !== '')
    .join(' ');

  return {
    id: record.id,
    routeId: record.route_id,
    routeName: record.route_name,
    occurrenceDate: record.occurrence_date,
    startsAt: record.starts_at.toISOString(),
    endsAt: record.ends_at.toISOString(),
    status: record.status,
    ownerId: record.owner_id,
    ownerName: record.owner_id === null || ownerName === '' ? null : ownerName,
    truckName: record.truck_name,
    recurrencePatternId: record.recurrence_pattern_id,
    assignedOverConflict: record.assigned_over_conflict,
    staffNote: record.staff_note,
    note: record.note,
    pickupCompletedAt: record.pickup_completed_at?.toISOString() ?? null,
  };
}

/** Donor `address` is carried through untrimmed — `pii.ts` gates people, not places
 *  (`CLAUDE.md`), and a driver needs the store's address to get there. */
function shapeStop(stop: PlannedStopRecord): PlannedStop {
  return {
    donorId: stop.donor_id,
    donorName: stop.donor_name,
    donorAddress: stop.donor_address,
    position: stop.position,
  };
}

function shapeDetail({ shift, plannedStops }: ShiftWithStops): ShiftDetail {
  return { ...shapeShift(shift), plannedStops: plannedStops.map(shapeStop) };
}

function shapeDuplicate(duplicate: DuplicateRun): DuplicateRunWarning {
  return {
    shiftId: duplicate.shiftId,
    occurrenceDate: duplicate.occurrenceDate,
    routeName: duplicate.routeName,
    startsAt: duplicate.startsAt.toISOString(),
    endsAt: duplicate.endsAt.toISOString(),
  };
}

function shapePattern(record: PatternRecord): RecurrencePatternSummary {
  const ownerName = [record.owner_default_first_name, record.owner_default_last_name]
    .filter((part) => part !== null && part !== '')
    .join(' ');

  return {
    id: record.id,
    routeId: record.route_id,
    routeName: record.route_name,
    // ISO weekdays, ascending — the service sorts them (`ck_rp_weekdays`).
    weekdays: record.weekdays,
    startTime: record.start_time,
    endTime: record.end_time,
    endDate: record.end_date,
    ownerDefaultId: record.owner_default_id,
    ownerDefaultName:
      record.owner_default_id === null || ownerName === '' ? null : ownerName,
    createdAt: record.created_at.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Query parsing
// ---------------------------------------------------------------------------

function flag(value: unknown): boolean {
  return value === 'true' || value === '1';
}

function optionalQuery(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** A weekday list off the wire. Range and duplicate handling belong to the service,
 *  which mirrors `ck_rp_weekdays`; this only rejects a non-array. */
function weekdaysOf(source: Record<string, unknown>): number[] {
  return source['weekdays'] as number[];
}

export const shiftRoutes = [
  // -------------------------------------------------------------------------
  // The shared board (cap 5, S1.2)
  // -------------------------------------------------------------------------

  /**
   * The board. `?from=&to=` bound the window, `?mine=true` is S1.2's "Mine" filter and
   * `?open=true` its "Open" one; `CANCELLED` runs are off the board unless asked for,
   * since I10 makes the state terminal and S1.2 has no cancelled chip.
   */
  defineRoute({
    method: 'get',
    path: '/shifts',
    access: { tier: 'VOLUNTEER' },
    handler: async (req, res) => {
      const actor = actorOf(req);
      const shifts = await listShifts({
        fromDate: optionalQuery(req.query['from']),
        toDate: optionalQuery(req.query['to']),
        ...(flag(req.query['mine']) ? { ownerId: actor.id } : {}),
        openOnly: flag(req.query['open']),
        patternId: optionalQuery(req.query['patternId']),
        includeCancelled: flag(req.query['includeCancelled']),
      });
      const payload: ShiftSummary[] = shifts.map(shapeShift);
      res.json(payload);
    },
  }),

  /** One run, with the ROUTE's stops. I5 puts `shift_stop` rows on a shift only from
   *  IN_PROGRESS onward, so a scheduled run's list is still the template's. */
  defineRoute({
    method: 'get',
    path: '/shifts/:id',
    access: { tier: 'VOLUNTEER' },
    handler: async (req, res) => {
      const shift = await getShift(String(req.params['id']));
      if (!shift) throw notFound('No such run.');
      const payload: ShiftDetail = shapeDetail(shift);
      res.json(payload);
    },
  }),

  // -------------------------------------------------------------------------
  // Publish, edit, move, cancel (caps 4 and 9, S1.6/S1.7)
  // -------------------------------------------------------------------------

  /** Publish a one-off run. No truck field (I8) and no owner field: a shift exists
   *  independently of any driver (cap 4). `duplicates` is a warning, never a refusal. */
  defineRoute({
    method: 'post',
    path: '/shifts',
    access: { tier: 'STAFF' },
    handler: async (req, res) => {
      const input = body(req);
      const created = await createShift(actorOf(req), {
        routeId: requiredString(input, 'routeId'),
        date: requiredString(input, 'date'),
        startTime: requiredString(input, 'startTime'),
        endTime: requiredString(input, 'endTime'),
        staffNote: optionalString(input, 'staffNote') ?? null,
      });
      const payload: CreateShiftResponse = {
        shift: shapeDetail(created.shift),
        duplicates: created.duplicates.map(shapeDuplicate),
      };
      res.status(201).json(payload);
    },
  }),

  /** "Edit just this date" (S1.6). Date and time are not here — moving a run is a
   *  reschedule, which owes staff the owner's conflicts first. */
  defineRoute({
    method: 'patch',
    path: '/shifts/:id',
    access: { tier: 'STAFF' },
    handler: async (req, res) => {
      const input = body(req);
      const updated = await updateShift(actorOf(req), String(req.params['id']), {
        staffNote: optionalString(input, 'staffNote'),
      });
      const payload: ShiftSummary = shapeShift(updated);
      res.json(payload);
    },
  }),

  /**
   * Reschedule (cap 9, S1.7). Its own path rather than a field on PATCH because it is
   * a two-step flow: an unconfirmed move onto a window the owner cannot work is
   * refused with 409 `RESCHEDULE_CONFLICT` and the conflicts attached, and only
   * `confirmRelease` moves the run and releases the owner back to the board.
   */
  defineRoute({
    method: 'post',
    path: '/shifts/:id/reschedule',
    access: { tier: 'STAFF' },
    handler: async (req, res) => {
      const input = body(req);
      const result = await rescheduleShift(actorOf(req), String(req.params['id']), {
        date: requiredString(input, 'date'),
        startTime: requiredString(input, 'startTime'),
        endTime: requiredString(input, 'endTime'),
        confirmRelease: input['confirmRelease'] === true,
      });
      const payload: RescheduleShiftResponse = {
        shift: shapeShift(result.shift),
        released: result.released,
      };
      res.json(payload);
    },
  }),

  /** Staff removes a run (`domain-modeling.md §3.1`). The service's predicate carries
   *  I9 and I10; a run that has started answers 409, not 200. */
  defineRoute({
    method: 'delete',
    path: '/shifts/:id',
    access: { tier: 'STAFF' },
    handler: async (req, res) => {
      const cancelled = await cancelShift(actorOf(req), String(req.params['id']));
      const payload: CancelShiftResponse = { shift: shapeShift(cancelled) };
      res.json(payload);
    },
  }),

  // -------------------------------------------------------------------------
  // Recurrence patterns (S1.6's recurring builder, §5.3)
  // -------------------------------------------------------------------------

  /** Staff-only: the pattern list is a scheduling surface, and the board already
   *  carries `recurrencePatternId` for the driver-facing "repeats weekly" tag. */
  defineRoute({
    method: 'get',
    path: '/patterns',
    access: { tier: 'STAFF' },
    handler: async (_req, res) => {
      const payload: RecurrencePatternSummary[] = (await listPatterns()).map(shapePattern);
      res.json(payload);
    },
  }),

  defineRoute({
    method: 'get',
    path: '/patterns/:id',
    access: { tier: 'STAFF' },
    handler: async (req, res) => {
      const pattern = await getPattern(String(req.params['id']));
      if (!pattern) throw notFound('No such repeating run.');
      const payload: RecurrencePatternSummary = shapePattern(pattern);
      res.json(payload);
    },
  }),

  /** Create a weekly pattern. Materialization is eager to the horizon (§5.3), so the
   *  response reports how many instances this minted. No `ownerDefault` field —
   *  that is claim-all / staff-assign (cap 6), and it owes an eligibility answer. */
  defineRoute({
    method: 'post',
    path: '/patterns',
    access: { tier: 'STAFF' },
    handler: async (req, res) => {
      const input = body(req);
      const created = await createPattern(actorOf(req), {
        routeId: requiredString(input, 'routeId'),
        weekdays: weekdaysOf(input),
        startTime: requiredString(input, 'startTime'),
        endTime: requiredString(input, 'endTime'),
        endDate: optionalString(input, 'endDate') ?? null,
      });
      const payload: CreatePatternResponse = {
        pattern: shapePattern(created.pattern),
        materialized: created.materialized,
        duplicates: created.duplicates.map(shapeDuplicate),
      };
      res.status(201).json(payload);
    },
  }),

  /** "Edit the weekly pattern" (S1.6) — I24's explicit pattern-level edit, and the
   *  only write to `recurrence_pattern` after creation. */
  defineRoute({
    method: 'patch',
    path: '/patterns/:id',
    access: { tier: 'STAFF' },
    handler: async (req, res) => {
      const input = body(req);
      const updated = await updatePattern(actorOf(req), String(req.params['id']), {
        ...(input['routeId'] !== undefined
          ? { routeId: requiredString(input, 'routeId') }
          : {}),
        ...(input['weekdays'] !== undefined ? { weekdays: weekdaysOf(input) } : {}),
        ...(input['startTime'] !== undefined
          ? { startTime: requiredString(input, 'startTime') }
          : {}),
        ...(input['endTime'] !== undefined
          ? { endTime: requiredString(input, 'endTime') }
          : {}),
        // `null` clears the end date, reopening an open-ended series; absent leaves
        // it alone. The difference is the whole reason this is a PATCH.
        ...(input['endDate'] !== undefined
          ? { endDate: optionalString(input, 'endDate') ?? null }
          : {}),
      });
      const payload: UpdatePatternResponse = {
        pattern: shapePattern(updated.pattern),
        moved: updated.moved,
        ownedInstances: updated.ownedInstances.map(shapeShift),
        offPatternInstances: updated.offPatternInstances.map(shapeShift),
        materialized: updated.materialized,
        duplicates: updated.duplicates.map(shapeDuplicate),
      };
      res.json(payload);
    },
  }),

  /**
   * Staff-only bulk-terminate (§5.3): `CANCELLED`, terminal, over `[fromDate, toDate]`.
   *
   * NOT the driver's release-range, which returns instances to `OPEN` and is cap 8 in
   * the coverage lane. Its own path, and a POST rather than a DELETE, because the
   * range is a body and because the pattern keeps generating past it.
   */
  defineRoute({
    method: 'post',
    path: '/patterns/:id/terminate',
    access: { tier: 'STAFF' },
    handler: async (req, res) => {
      const input = body(req);
      const cancelled = await bulkTerminate(
        actorOf(req),
        String(req.params['id']),
        requiredString(input, 'fromDate'),
        requiredString(input, 'toDate'),
      );
      const payload: BulkTerminateResponse = { cancelled };
      res.json(payload);
    },
  }),
];
