// Scheduling — publish, edit, move and cancel a pickup shift.
//
// `product-requirement.md` cap 4 (shift & route scheduling), cap 9 (reschedule), the
// staff half of cap 8 (bulk-terminate), and `ui-ux-spec.md S1.6`/`S1.7`. The shift
// STATE MACHINE is `domain-modeling.md §3.1`; this file owns the transitions staff
// drives and nothing else — claim, staff-assign and release are cap 6/8 and live in
// the coverage service, and no code here sets an owner.
//
// Three things about this file are load-bearing rather than stylistic:
//
//   1. EVERY TRANSITION IS A CONDITIONAL UPDATE, with the legal prior states in the
//      predicate (`data-model.md §9`). The precondition IS the optimistic check:
//      `rowcount = 0` means the row was not in a state this transition may leave, so
//      I9 (no cancel from IN_PROGRESS/COMPLETED) and I10 (terminal states) are
//      enforced by the database's view of the row and not by a `SELECT` this code
//      took a moment earlier.
//
//   2. ANY STATEMENT THAT CLEARS `owner_id` ALSO CLEARS `assigned_over_conflict`.
//      `ck_shift_conflict_flag` (migration 0008) does not clear the flag — it makes
//      forgetting to clear it raise. That is deliberate: a loud failure beats a
//      released run silently bannering the next driver about a conflict that was
//      never theirs. Cancel and the reschedule-conflict release are the two such
//      statements here.
//
//   3. PANTRY-LOCAL TIME IS RESOLVED ONCE, HERE, VIA `../time.ts`. Staff schedule in
//      calendar dates and wall-clock times; the stored `starts_at`/`ends_at` are
//      instants. A second implementation of that conversion would agree on every
//      ordinary test and disagree at the spring-forward gap and the doubled autumn
//      hour, so there is exactly one.
//
// Shapes belong to the route layer: these functions return rows, and
// `routes/shifts.ts` turns them into the wire types (`architecture.md §4.3`).

import { sql, type Kysely } from 'kysely';
import { TIERS, tierAtLeast, type ShiftStatus, type Tier } from '../../../shared/src/index.js';
import { rescheduleConflictMessage, type RescheduleConflict } from '../../../shared/src/schedule.js';
import { db } from '../db/index.js';
import type { DB } from '../db/types.js';
import { writeTransaction, type Tx } from '../db/transaction.js';
import { badRequest, conflict, notFound } from '../middleware/error.js';
import {
  addDays,
  formatRange,
  localToInstant,
  parseDate,
  parseTime,
  type CalendarDate,
} from '../time.js';
import { dispatchNow } from '../jobs/push-dispatch.js';
import {
  conflictingAvailabilityBlocks,
  conflictingOwnedShifts,
  eligibleDriverIds,
} from './eligibility.js';
import { enqueueNotifications } from './notification.js';

/** Read-only queries may run at the default isolation level (`architecture.md §4.1`),
 *  so reads take either the pool or an open transaction. A read that gates a write
 *  takes the write's transaction — otherwise the gate is decoration. */
export type Reader = Kysely<DB>;

/** Provenance only (I26). Permission was settled at the route layer before this ran
 *  (`architecture.md §4.3`), and the materialization job has no actor at all. */
export interface ScheduleActor {
  id: string;
}

/** Postgres answers a malformed uuid with 22P02, which would surface as a 500. An
 *  unparseable id is simply a thing that does not exist. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

// ---------------------------------------------------------------------------
// Reading shifts
// ---------------------------------------------------------------------------

export interface ShiftRecord {
  id: string;
  route_id: string;
  route_name: string;
  /** `YYYY-MM-DD`. */
  occurrence_date: string;
  starts_at: Date;
  ends_at: Date;
  status: ShiftStatus;
  owner_id: string | null;
  owner_first_name: string | null;
  owner_last_name: string | null;
  truck_name: string | null;
  recurrence_pattern_id: string | null;
  assigned_over_conflict: boolean;
  staff_note: string | null;
  note: string | null;
  pickup_completed_at: Date | null;
}

export interface PlannedStopRecord {
  donor_id: string;
  donor_name: string;
  donor_address: string | null;
  position: number;
}

/**
 * The board query, in one place.
 *
 * `occurrence_date` is read as text on purpose: `pg` parses a bare `date` into a JS
 * `Date` at the **process's** local midnight, so a server running in any zone but the
 * pantry's would render the calendar slot a day out. The column is a calendar fact
 * (`data-model.md §0`), and text is the only lossless way to carry one.
 */
function selectShifts(exec: Reader) {
  return exec
    .selectFrom('shift')
    .innerJoin('route', 'route.id', 'shift.route_id')
    .leftJoin('app_user as owner', 'owner.id', 'shift.owner_id')
    .leftJoin('truck', 'truck.id', 'shift.truck_id')
    .select([
      'shift.id as id',
      'shift.route_id as route_id',
      'route.name as route_name',
      sql<string>`to_char(shift.occurrence_date, 'YYYY-MM-DD')`.as('occurrence_date'),
      'shift.starts_at as starts_at',
      'shift.ends_at as ends_at',
      'shift.status as status',
      'shift.owner_id as owner_id',
      // Names are public-within-org (`product-requirement.md §2`) and are not PII —
      // `pii.ts` gates phone and address. No shaping step is owed here.
      'owner.first_name as owner_first_name',
      'owner.last_name as owner_last_name',
      'truck.truck_name as truck_name',
      'shift.recurrence_pattern_id as recurrence_pattern_id',
      'shift.assigned_over_conflict as assigned_over_conflict',
      'shift.staff_note as staff_note',
      'shift.note as note',
      'shift.pickup_completed_at as pickup_completed_at',
    ]);
}

/** Terminal and removed: `CANCELLED` runs are off the board unless asked for.
 *  `S1.2`'s state list has no cancelled chip, and I10 makes the state terminal. */
export interface ListShiftsOptions {
  /** `YYYY-MM-DD`, inclusive. */
  fromDate?: string | undefined;
  toDate?: string | undefined;
  /** `S1.2`'s "Mine" filter. */
  ownerId?: string | undefined;
  /** `S1.2`'s "Open" filter. */
  openOnly?: boolean | undefined;
  patternId?: string | undefined;
  includeCancelled?: boolean | undefined;
}

export async function listShifts(options: ListShiftsOptions = {}): Promise<ShiftRecord[]> {
  let query = selectShifts(db);

  if (options.fromDate !== undefined) {
    const from = isoDate(parseDate(options.fromDate, 'fromDate'));
    query = query.where(sql<boolean>`shift.occurrence_date >= ${from}::date`);
  }
  if (options.toDate !== undefined) {
    const to = isoDate(parseDate(options.toDate, 'toDate'));
    query = query.where(sql<boolean>`shift.occurrence_date <= ${to}::date`);
  }
  if (options.ownerId !== undefined) {
    if (!isUuid(options.ownerId)) throw badRequest('ownerId must be an id.');
    query = query.where('shift.owner_id', '=', options.ownerId);
  }
  if (options.openOnly) query = query.where('shift.status', '=', 'OPEN');
  if (options.patternId !== undefined) {
    if (!isUuid(options.patternId)) throw badRequest('patternId must be an id.');
    query = query.where('shift.recurrence_pattern_id', '=', options.patternId);
  }
  if (!options.includeCancelled) query = query.where('shift.status', '<>', 'CANCELLED');

  return query.orderBy('shift.starts_at').execute();
}

/** The same rows by id, for a caller that already decided which ones it wants (the
 *  pattern edit's "these were left alone" lists). Order follows `starts_at`. */
export async function listShiftsByIds(
  exec: Reader,
  ids: readonly string[],
): Promise<ShiftRecord[]> {
  if (ids.length === 0) return [];
  return selectShifts(exec)
    .where('shift.id', 'in', [...ids])
    .orderBy('shift.starts_at')
    .execute();
}

export interface ShiftWithStops {
  shift: ShiftRecord;
  /** The ROUTE's stops. I5 puts `shift_stop` rows on a shift only from IN_PROGRESS
   *  onward, so a scheduled run's stop list is still the template's. */
  plannedStops: PlannedStopRecord[];
}

export async function getShift(shiftId: string): Promise<ShiftWithStops | null> {
  if (!isUuid(shiftId)) return null;

  const shift = await selectShifts(db).where('shift.id', '=', shiftId).executeTakeFirst();
  if (!shift) return null;

  return { shift, plannedStops: await plannedStops(db, shift.route_id) };
}

async function plannedStops(exec: Reader, routeId: string): Promise<PlannedStopRecord[]> {
  return exec
    .selectFrom('route_stop')
    .innerJoin('donor', 'donor.id', 'route_stop.donor_id')
    .select([
      'route_stop.donor_id as donor_id',
      'donor.name as donor_name',
      'donor.address as donor_address',
      'route_stop.position as position',
    ])
    .where('route_stop.route_id', '=', routeId)
    .orderBy('route_stop.position')
    .execute();
}

async function readShift(tx: Tx, shiftId: string): Promise<ShiftRecord> {
  const row = await selectShifts(tx).where('shift.id', '=', shiftId).executeTakeFirst();
  if (!row) throw notFound('No such run.');
  return row;
}

// ---------------------------------------------------------------------------
// Pantry-local windows
// ---------------------------------------------------------------------------

/** A `CalendarDate` as `YYYY-MM-DD`. The storage form of a calendar slot. */
export function isoDate(date: CalendarDate): string {
  const mm = String(date.month).padStart(2, '0');
  const dd = String(date.day).padStart(2, '0');
  return `${date.year}-${mm}-${dd}`;
}

export interface ShiftWindow {
  occurrenceDate: string;
  startsAt: Date;
  endsAt: Date;
}

/**
 * A date plus two wall-clock times as the stored instants.
 *
 * Intra-day, `end > start` — `domain-modeling.md §5.3` states it for recurrence
 * windows ("no overnight pickups. A run that would cross midnight is split into two
 * patterns") and the same sentence is the reason a one-off cannot cross midnight
 * either. `ck_shift_window` only knows `ends_at > starts_at`, which an overnight
 * window would satisfy, so this is the check that holds it.
 */
export function resolveWindow(
  date: CalendarDate,
  startTime: string,
  endTime: string,
  timeZone: string,
): ShiftWindow {
  const start = parseTime(startTime, 'startTime');
  const end = parseTime(endTime, 'endTime');
  if (end.hour * 60 + end.minute <= start.hour * 60 + start.minute) {
    throw badRequest('The end time must be later in the day than the start time.');
  }
  return {
    occurrenceDate: isoDate(date),
    startsAt: localToInstant({ ...date, ...start }, timeZone),
    endsAt: localToInstant({ ...date, ...end }, timeZone),
  };
}

/** `app_config` is a singleton seeded by migration 0001 (`data-model.md §2`). */
export async function readConfig(
  exec: Reader,
): Promise<{ timezone: string; horizon_days: number }> {
  return exec
    .selectFrom('app_config')
    .select(['timezone', 'horizon_days'])
    .executeTakeFirstOrThrow();
}

/**
 * Today, in the pantry's zone.
 *
 * Asked of Postgres rather than computed here: the zone conversion already exists in
 * two DST-aware implementations (`Intl` in `../time.ts`, and the server's own tz
 * database), and adding a third in this file is exactly what the `time.ts` hoist was
 * meant to prevent. `now` is injectable so a test can place "today" without moving
 * the machine clock.
 */
export async function pantryToday(
  exec: Reader,
  timeZone: string,
  now?: Date,
): Promise<CalendarDate> {
  const instant = now ?? new Date();
  const result = await sql<{ today: string }>`
    SELECT to_char((${instant}::timestamptz AT TIME ZONE ${timeZone})::date, 'YYYY-MM-DD') AS today
  `.execute(exec);
  return parseDate(result.rows[0]!.today, 'today');
}

// ---------------------------------------------------------------------------
// Duplicate-run soft check (`data-model.md §5.3`)
// ---------------------------------------------------------------------------

export interface DuplicateRun {
  shiftId: string;
  occurrenceDate: string;
  routeName: string;
  startsAt: Date;
  endsAt: Date;
}

export interface DuplicateCandidate extends ShiftWindow {
  routeId: string;
}

/**
 * `real_conflict` from `data-model.md §5.3`: same calendar slot, same window to the
 * instant, same donor set, published from a *different* pattern, not cancelled.
 *
 * **A SOFT CHECK, NEVER A CONSTRAINT.** Cross-pattern overlapping runs are legitimate
 * — two trucks, two routes, same hour — so there is no unique index behind this and
 * nothing here blocks a write. It is surfaced at pattern and one-off create, where a
 * staff member is standing there to judge it; the rolling materialization job never
 * calls it (§5.3: "the rolling job never conflict-checks").
 *
 * `stop_set` is read from the ROUTE, not from `shift_stop`: I5 means an unstarted
 * shift has no snapshot rows at all, and a duplicate is by definition a run that has
 * not happened yet.
 */
export async function findDuplicateRuns(
  exec: Reader,
  candidates: readonly DuplicateCandidate[],
  patternId: string | null,
): Promise<DuplicateRun[]> {
  if (candidates.length === 0) return [];

  const dates = [...new Set(candidates.map((c) => c.occurrenceDate))];
  const rows = await exec
    .selectFrom('shift')
    .innerJoin('route', 'route.id', 'shift.route_id')
    .select([
      'shift.id as id',
      'shift.route_id as route_id',
      'route.name as route_name',
      sql<string>`to_char(shift.occurrence_date, 'YYYY-MM-DD')`.as('occurrence_date'),
      'shift.starts_at as starts_at',
      'shift.ends_at as ends_at',
    ])
    .where(sql<boolean>`shift.occurrence_date = ANY(${dates}::date[])`)
    // CANCELLED runs do not count — they are terminal and off the board.
    .where('shift.status', '<>', 'CANCELLED')
    // `IS DISTINCT FROM`, exactly as §5.3 writes it. For a one-off (`patternId` null)
    // this matches only pattern-minted runs: two identical one-offs are not a
    // "duplicate run" under that formula, because staff published each deliberately.
    .where(sql<boolean>`shift.recurrence_pattern_id IS DISTINCT FROM ${patternId}::uuid`)
    .execute();

  if (rows.length === 0) return [];

  const routeIds = [...new Set([...rows.map((r) => r.route_id), ...candidates.map((c) => c.routeId)])];
  const stopSets = await donorSetsByRoute(exec, routeIds);

  const duplicates: DuplicateRun[] = [];
  for (const candidate of candidates) {
    const mine = stopSets.get(candidate.routeId) ?? '';
    for (const row of rows) {
      if (row.occurrence_date !== candidate.occurrenceDate) continue;
      if (row.starts_at.getTime() !== candidate.startsAt.getTime()) continue;
      if (row.ends_at.getTime() !== candidate.endsAt.getTime()) continue;
      // Donor-id SET, order-insensitive (§5.3).
      if ((stopSets.get(row.route_id) ?? '') !== mine) continue;
      duplicates.push({
        shiftId: row.id,
        occurrenceDate: row.occurrence_date,
        routeName: row.route_name,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
      });
    }
  }
  return duplicates;
}

async function donorSetsByRoute(
  exec: Reader,
  routeIds: readonly string[],
): Promise<Map<string, string>> {
  const sets = new Map<string, string[]>();
  if (routeIds.length === 0) return new Map();

  const rows = await exec
    .selectFrom('route_stop')
    .select(['route_id', 'donor_id'])
    .where('route_id', 'in', [...routeIds])
    .execute();

  for (const row of rows) {
    const held = sets.get(row.route_id) ?? [];
    held.push(row.donor_id);
    sets.set(row.route_id, held);
  }

  const keyed = new Map<string, string>();
  for (const [routeId, donors] of sets) keyed.set(routeId, [...donors].sort().join(','));
  return keyed;
}

// ---------------------------------------------------------------------------
// Publish (PRD cap 4, S1.6)
// ---------------------------------------------------------------------------

export interface CreateShiftParams {
  routeId: string;
  date: string;
  startTime: string;
  endTime: string;
  staffNote?: string | null;
}

export interface CreateShiftResult {
  shift: ShiftWithStops;
  duplicates: DuplicateRun[];
}

/**
 * Publish a one-off shift.
 *
 * I4 — the route is bound here, at schedule time, and is required. I8 — no truck; the
 * driver picks one at start. No owner: "shifts exist independently of any driver"
 * (PRD cap 4), so a published run is `OPEN` and `ck_shift_owner` would reject
 * anything else.
 *
 * `recurrence_pattern_id` stays NULL, which is what makes a one-off a one-off, and
 * `uq_shift_occurrence`'s default NULLS DISTINCT is what lets two of them share a day
 * (`data-model.md §5.3` — do not change that to NULLS NOT DISTINCT).
 */
export async function createShift(
  actor: ScheduleActor,
  params: CreateShiftParams,
): Promise<CreateShiftResult> {
  if (!isUuid(params.routeId)) throw badRequest('Pick a route for this run.');
  const date = parseDate(params.date, 'date');

  return writeTransaction(async (tx) => {
    const config = await readConfig(tx);
    const window = resolveWindow(date, params.startTime, params.endTime, config.timezone);

    const route = await tx
      .selectFrom('route')
      .select(['id', 'deactivated_at'])
      .where('id', '=', params.routeId)
      .executeTakeFirst();
    if (!route) throw badRequest('That route no longer exists.');
    // I21 — an archived route is hidden from new use, and scheduling against it is
    // new use. Runs already bound to it are untouched.
    if (route.deactivated_at !== null) {
      throw badRequest('That route is archived. Restore it before scheduling on it.');
    }
    await requireStops(tx, route.id);

    const duplicates = await findDuplicateRuns(
      tx,
      [{ ...window, routeId: route.id }],
      null,
    );

    const inserted = await tx
      .insertInto('shift')
      .values({
        recurrence_pattern_id: null,
        route_id: route.id,
        occurrence_date: window.occurrenceDate,
        starts_at: window.startsAt,
        ends_at: window.endsAt,
        status: 'OPEN',
        owner_id: null,
        staff_note: params.staffNote ?? null,
        created_by: actor.id,
        updated_by: actor.id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const shift = await readShift(tx, inserted.id);
    return {
      shift: { shift, plannedStops: await plannedStops(tx, shift.route_id) },
      duplicates,
    };
  });
}

/** `domain-modeling.md §2.2`: a Route contains 1..N RouteStops. A run against an
 *  empty route would start into an empty snapshot (I5), so it is refused here. */
export async function requireStops(exec: Reader, routeId: string): Promise<void> {
  const stop = await exec
    .selectFrom('route_stop')
    .select('id')
    .where('route_id', '=', routeId)
    .executeTakeFirst();
  if (!stop) throw badRequest('That route has no stores on it yet.');
}

// ---------------------------------------------------------------------------
// Edit one instance (§5.3 `edit-one`, I23)
// ---------------------------------------------------------------------------

export interface UpdateShiftParams {
  staffNote?: string | null;
}

/**
 * Edit a single shift.
 *
 * I23 — nothing here reads or writes `recurrence_pattern`, which is the whole
 * enforcement: a per-instance edit never mutates the pattern, whether or not this
 * instance was minted from one. Editing "just this date" and editing "the weekly
 * pattern" are two different operations in two different files (`S1.6`).
 *
 * `staff_note` is the coordinator→driver channel (PRD cap 11, channel 1), edited from
 * S1.3's desktop view. It is its own column and shares storage with none of the other
 * three note channels.
 */
export async function updateShift(
  actor: ScheduleActor,
  shiftId: string,
  params: UpdateShiftParams,
): Promise<ShiftRecord> {
  if (!isUuid(shiftId)) throw notFound('No such run.');
  if (params.staffNote === undefined) throw badRequest('Nothing to change.');

  return writeTransaction(async (tx) => {
    const existing = await tx
      .selectFrom('shift')
      .select('id')
      .where('id', '=', shiftId)
      .executeTakeFirst();
    if (!existing) throw notFound('No such run.');

    await tx
      .updateTable('shift')
      .set({
        staff_note: params.staffNote ?? null,
        updated_by: actor.id,
        updated_at: sql<Date>`now()`,
      })
      .where('id', '=', shiftId)
      .execute();

    return readShift(tx, shiftId);
  });
}

// ---------------------------------------------------------------------------
// Reschedule (PRD cap 9, S1.7)
// ---------------------------------------------------------------------------

export interface RescheduleParams {
  date: string;
  startTime: string;
  endTime: string;
  /** Staff has seen the conflicts and accepts that the owner is released. */
  confirmRelease?: boolean;
}

export interface RescheduleResult {
  shift: ShiftRecord;
  released: boolean;
}

/**
 * Move a shift's date/time. "The owner is kept by default; the app surfaces any
 * conflict with that driver's declared availability before Staff confirms. On a
 * confirmed conflict, the owner is released and the shift returns to the board. The
 * system never auto-selects a replacement person." (PRD cap 9.)
 *
 * The conflict test is I20's two overlap clauses against the NEW window — the
 * driver's blocks and their other CLAIMED/IN_PROGRESS runs — with this shift excluded
 * from the second, since a run never disqualifies itself. It is deliberately not the
 * full `eligible()`: cap 9 asks whether the owner can still do THIS run at a new
 * time, and their duty and account status did not change by moving it.
 *
 * Both reads happen inside the write transaction, at SERIALIZABLE, so a claim landing
 * between the check and the move is caught by SSI rather than slipping through
 * (`architecture.md §4.1`).
 */
export async function rescheduleShift(
  actor: ScheduleActor,
  shiftId: string,
  params: RescheduleParams,
): Promise<RescheduleResult> {
  if (!isUuid(shiftId)) throw notFound('No such run.');
  const date = parseDate(params.date, 'date');

  const result = await writeTransaction(async (tx) => {
    const config = await readConfig(tx);
    const window = resolveWindow(date, params.startTime, params.endTime, config.timezone);
    const shift = await readShift(tx, shiftId);

    // A started run has a truck, a snapshot and a driver mid-route (I5/I8); a
    // terminal one is terminal (I10). Only a run that has not started can be moved.
    if (shift.status !== 'OPEN' && shift.status !== 'CLAIMED') {
      throw conflict('Only a run that has not started can be moved.');
    }

    let released = false;
    if (shift.owner_id !== null) {
      const conflicts = await ownerConflicts(tx, shift.owner_id, shiftId, window);
      if (conflicts.length > 0) {
        if (params.confirmRelease !== true) {
          const owner = `${shift.owner_first_name ?? ''} ${shift.owner_last_name ?? ''}`.trim();
          throw conflict(
            rescheduleConflictMessage(owner === '' ? 'That driver' : owner, conflicts.map((c) => c.kind)),
            { error: 'RESCHEDULE_CONFLICT', conflicts },
          );
        }
        released = true;
      }
    }

    const updated = await tx
      .updateTable('shift')
      .set({
        occurrence_date: window.occurrenceDate,
        starts_at: window.startsAt,
        ends_at: window.endsAt,
        updated_by: actor.id,
        updated_at: sql<Date>`now()`,
        // The release half of cap 9. `assigned_over_conflict` MUST be cleared in the
        // same statement as `owner_id`: `ck_shift_conflict_flag` forbids a flagged
        // shift with no owner, so omitting it raises instead of leaving the next
        // driver a stale banner (migration 0008, `data-model.md §9`).
        ...(released
          ? { status: 'OPEN' as const, owner_id: null, assigned_over_conflict: false }
          : {}),
      })
      // The conditional predicate is the optimistic check (`data-model.md §9`).
      .where('id', '=', shiftId)
      .where('status', 'in', ['OPEN', 'CLAIMED'])
      .executeTakeFirst();

    if (Number(updated.numUpdatedRows) === 0) {
      throw conflict('That run just changed. Reload and try again.');
    }

    const after = await readShift(tx, shiftId);
    if (released) {
      // "Shift returns to the board as open — release (cap 8), RESCHEDULE CONFLICT
      // (cap 9), or staff unassign" → Coordinator + eligible drivers
      // (`product-requirement.md §4` matrix).
      await notifyShiftOpened(tx, after, config.timezone);
    }
    return { shift: after, released };
  });

  // Outside the transaction, always (§4.4): a SERIALIZABLE retry would re-send. The
  // sweep is what makes delivery correct; this only makes it prompt.
  if (result.released) dispatchNow();
  return result;
}

/** I20's two overlap clauses against a proposed window, as S1.7's warning list. */
async function ownerConflicts(
  tx: Tx,
  ownerId: string,
  shiftId: string,
  window: ShiftWindow,
): Promise<RescheduleConflict[]> {
  const conflicts: RescheduleConflict[] = [];

  for (const block of await conflictingAvailabilityBlocks(tx, ownerId, window)) {
    conflicts.push({
      kind: 'AVAILABILITY_BLOCK',
      startsAt: block.startsAt.toISOString(),
      endsAt: block.endsAt.toISOString(),
    });
  }
  for (const owned of await conflictingOwnedShifts(tx, ownerId, window, {
    excludeShiftId: shiftId,
  })) {
    conflicts.push({
      kind: 'OWNED_SHIFT',
      startsAt: owned.startsAt.toISOString(),
      endsAt: owned.endsAt.toISOString(),
      shiftId: owned.shiftId,
      routeName: owned.routeName,
    });
  }

  return conflicts;
}

/**
 * The `SHIFT_OPENED` fan-out: Coordinator + eligible drivers.
 *
 * Coordinators are derived from the tier order rather than written out — I1 makes
 * tiers hierarchical, so Admin is a coordinator too and an equality test would
 * silently drop them. Eligible drivers are `eligible()` over the whole roster,
 * computed at send time against the NEW window (`product-requirement.md §4`).
 */
async function notifyShiftOpened(
  tx: Tx,
  shift: ShiftRecord,
  timeZone: string,
): Promise<void> {
  const coordinatorTiers: Tier[] = TIERS.filter((tier) => tierAtLeast(tier, 'STAFF'));
  const coordinators = await tx
    .selectFrom('app_user')
    .select('id')
    // A deactivated coordinator cannot read an inbox (I21 — hidden from new use).
    .where('deactivated_at', 'is', null)
    .where('tier', 'in', coordinatorTiers)
    .execute();

  const drivers = await eligibleDriverIds(tx, {
    id: shift.id,
    startsAt: shift.starts_at,
    endsAt: shift.ends_at,
  });

  const recipients = new Set([...coordinators.map((c) => c.id), ...drivers]);
  await enqueueNotifications(
    tx,
    [...recipients].map((recipientId) => ({
      event: 'SHIFT_OPENED' as const,
      recipientId,
      shiftId: shift.id,
      payload: {
        route: shift.route_name,
        when: formatRange({ startsAt: shift.starts_at, endsAt: shift.ends_at }, timeZone),
      },
    })),
  );
}

// ---------------------------------------------------------------------------
// Cancel (staff removes — §3.1) and bulk-terminate (§5.3)
// ---------------------------------------------------------------------------

/**
 * Staff cancels a run. `OPEN | CLAIMED → CANCELLED`, terminal.
 *
 * The predicate carries I9 (no transition into CANCELLED from IN_PROGRESS or
 * COMPLETED) and I10 (CANCELLED is terminal, so a second cancel matches nothing).
 * `owner_id` is cleared in the same UPDATE per `domain-modeling.md §2.2` — the bumped
 * driver's identity is deliberately not retained on the row — and the conflict flag
 * goes with it, or `ck_shift_conflict_flag` raises.
 *
 * No notification: the §4 matrix's board-reopened event says "Never from CANCELLED,
 * which is terminal", and the matrix has no cancelled-run event of its own.
 */
export async function cancelShift(
  actor: ScheduleActor,
  shiftId: string,
): Promise<ShiftRecord> {
  if (!isUuid(shiftId)) throw notFound('No such run.');

  return writeTransaction(async (tx) => {
    const existing = await tx
      .selectFrom('shift')
      .select('id')
      .where('id', '=', shiftId)
      .executeTakeFirst();
    if (!existing) throw notFound('No such run.');

    const updated = await tx
      .updateTable('shift')
      .set({
        status: 'CANCELLED',
        owner_id: null,
        assigned_over_conflict: false,
        updated_by: actor.id,
        updated_at: sql<Date>`now()`,
      })
      .where('id', '=', shiftId)
      .where('status', 'in', ['OPEN', 'CLAIMED'])
      .executeTakeFirst();

    if (Number(updated.numUpdatedRows) === 0) {
      // I9 / I10, reported as a sentence rather than as a constraint violation.
      throw conflict('That run has already started or finished — it cannot be cancelled.');
    }

    return readShift(tx, shiftId);
  });
}

/**
 * Staff-only bulk-terminate (`domain-modeling.md §5.3`).
 *
 * `CANCELLED` (terminal) on a pattern's instances in `[fromDate, toDate]`. NOT the
 * driver's release-range, which returns instances to `OPEN` and belongs to coverage:
 * this one permanently kills those runs, and the pattern keeps generating beyond the
 * range unless staff also sets `endDate`.
 *
 * The same predicate as single cancel, applied over a range: instances that are
 * IN_PROGRESS, COMPLETED or already CANCELLED are skipped rather than failing the
 * batch, which is I9/I10 holding per row.
 */
export async function bulkTerminate(
  actor: ScheduleActor,
  patternId: string,
  fromDate: string,
  toDate: string,
): Promise<number> {
  if (!isUuid(patternId)) throw notFound('No such pattern.');
  const from = isoDate(parseDate(fromDate, 'fromDate'));
  const to = isoDate(parseDate(toDate, 'toDate'));
  if (to < from) throw badRequest('toDate must be on or after fromDate.');

  return writeTransaction(async (tx) => {
    const pattern = await tx
      .selectFrom('recurrence_pattern')
      .select('id')
      .where('id', '=', patternId)
      .executeTakeFirst();
    if (!pattern) throw notFound('No such pattern.');

    const updated = await tx
      .updateTable('shift')
      .set({
        status: 'CANCELLED',
        owner_id: null,
        assigned_over_conflict: false,
        updated_by: actor.id,
        updated_at: sql<Date>`now()`,
      })
      .where('recurrence_pattern_id', '=', patternId)
      .where(sql<boolean>`shift.occurrence_date BETWEEN ${from}::date AND ${to}::date`)
      .where('status', 'in', ['OPEN', 'CLAIMED'])
      .executeTakeFirst();

    return Number(updated.numUpdatedRows);
  });
}

/** Tomorrow, pantry-local — the first date a pattern edit may rewrite. Exported so
 *  the recurrence service and its tests agree on where "future" starts. */
export function nextDay(date: CalendarDate): CalendarDate {
  return addDays(date, 1);
}
