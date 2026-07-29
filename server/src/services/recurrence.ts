// Recurrence — the pattern, and `domain-modeling.md §5.3`'s eager-to-horizon
// materialization.
//
// §5.3 IS A NAMED ALGORITHM IN THE LOCKED DOC. It is implemented here, not
// re-derived:
//
//     for each pattern:
//       for each occurrence date D in [now, horizon]:
//           if pattern.endDate and D > pattern.endDate:  stop this pattern
//           if no Shift exists for (pattern, D):
//               create Shift(pattern, D)
//               if ownerDefault set AND eligible(ownerDefault, this Shift): born CLAIMED
//               else:                                                       born OPEN
//
// Four things this file must get right, each of which is a stated rule rather than an
// implementation preference:
//
//   * **I25 — born-CLAIMED is gated, not automatic.** `eligible()` is evaluated per
//     instance, before the row exists, which is why `eligible()` takes an optional
//     shift id. Without the gate, a block declared *before* its conflicting instance
//     was materialized would never be checked against it (the row did not exist yet)
//     and the job would mint a run overlapping the owner's own availability.
//     `eligible()`'s FIRST conjunct is "driver is active", and materialization is the
//     one call site a deactivated account still reaches — it needs no login — so a
//     pattern whose `ownerDefault` was deactivated months ago stops minting runs to a
//     dead account rather than continuing forever.
//
//   * **I23 / I24 — the pattern changes only by an explicit pattern-level edit.**
//     Nothing in `services/schedule.ts` writes this table; `updatePattern` below is
//     the only thing that does.
//
//   * **The sweep is idempotent.** `uq_shift_occurrence` + `ON CONFLICT DO NOTHING`
//     is what makes re-running safe (`data-model.md §5.3`/§9), and `architecture.md
//     §4.4` requires a catch-up sweep: this asks "which occurrences in range have no
//     row?", never "fire at time T", so a missed tick self-heals.
//
//   * **Local wall clock → instant happens once, via `../time.ts`.** A pattern stores
//     `time` columns in pantry-local wall clock precisely so that a run keeps its
//     clock time across a DST change (`data-model.md §5.2`); a second copy of that
//     conversion would agree on every ordinary test and diverge at the spring-forward
//     gap and the doubled autumn hour.
//
// There is no active/paused flag: `end_date` is the only stop condition (§5.3), and a
// second switch could disagree with it.

import { sql } from 'kysely';
import { writeTransaction, type Tx } from '../db/transaction.js';
import { db } from '../db/index.js';
import { badRequest, notFound } from '../middleware/error.js';
import { addDays, parseDate, parseTime, type CalendarDate } from '../time.js';
import { eligible } from './eligibility.js';
import {
  findDuplicateRuns,
  isUuid,
  isoDate,
  listShiftsByIds,
  pantryToday,
  readConfig,
  requireStops,
  resolveWindow,
  type DuplicateCandidate,
  type DuplicateRun,
  type Reader,
  type ScheduleActor,
  type ShiftRecord,
  type ShiftWindow,
} from './schedule.js';

// ---------------------------------------------------------------------------
// Calendar arithmetic (dates only — zone conversion stays in `../time.ts`)
// ---------------------------------------------------------------------------

/** ISO weekday, 1 = Monday … 7 = Sunday (`data-model.md §5.2`'s `weekdays` column).
 *  A pure calendar fact: no zone is involved in which weekday a date falls on. */
export function isoWeekday(date: CalendarDate): number {
  const dow = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

/** Postgres renders a `time` as `HH:MM:SS`; the wire and `parseTime` speak `HH:MM`. */
function clockText(value: string): string {
  return value.slice(0, 5);
}

// ---------------------------------------------------------------------------
// Reading patterns
// ---------------------------------------------------------------------------

export interface PatternRecord {
  id: string;
  route_id: string;
  route_name: string;
  weekdays: number[];
  /** `HH:MM`, pantry-local wall clock. */
  start_time: string;
  end_time: string;
  /** `YYYY-MM-DD` or null (open-ended). */
  end_date: string | null;
  owner_default_id: string | null;
  owner_default_first_name: string | null;
  owner_default_last_name: string | null;
  created_at: Date;
}

/** `end_date` is read as text for the same reason `shift.occurrence_date` is
 *  (`services/schedule.ts`): `pg` parses a bare `date` at the process's local
 *  midnight, which is a different day in the wrong zone. */
function selectPatterns(exec: Reader) {
  return exec
    .selectFrom('recurrence_pattern')
    .innerJoin('route', 'route.id', 'recurrence_pattern.route_id')
    .leftJoin('app_user as owner', 'owner.id', 'recurrence_pattern.owner_default_id')
    .select([
      'recurrence_pattern.id as id',
      'recurrence_pattern.route_id as route_id',
      'route.name as route_name',
      'recurrence_pattern.weekdays as weekdays',
      'recurrence_pattern.start_time as start_time',
      'recurrence_pattern.end_time as end_time',
      sql<string | null>`to_char(recurrence_pattern.end_date, 'YYYY-MM-DD')`.as('end_date'),
      'recurrence_pattern.owner_default_id as owner_default_id',
      'owner.first_name as owner_default_first_name',
      'owner.last_name as owner_default_last_name',
      'recurrence_pattern.created_at as created_at',
    ]);
}

function normalizeRecord<T extends { start_time: string; end_time: string }>(row: T): T {
  return { ...row, start_time: clockText(row.start_time), end_time: clockText(row.end_time) };
}

export async function listPatterns(): Promise<PatternRecord[]> {
  const rows = await selectPatterns(db).orderBy('recurrence_pattern.created_at').execute();
  return rows.map(normalizeRecord);
}

export async function getPattern(patternId: string): Promise<PatternRecord | null> {
  if (!isUuid(patternId)) return null;
  const row = await selectPatterns(db)
    .where('recurrence_pattern.id', '=', patternId)
    .executeTakeFirst();
  return row ? normalizeRecord(row) : null;
}

async function readPattern(tx: Tx, patternId: string): Promise<PatternRecord> {
  const row = await selectPatterns(tx)
    .where('recurrence_pattern.id', '=', patternId)
    .executeTakeFirst();
  if (!row) throw notFound('No such repeating run.');
  return normalizeRecord(row);
}

// ---------------------------------------------------------------------------
// The occurrence sequence
// ---------------------------------------------------------------------------

export interface PatternRule {
  weekdays: readonly number[];
  /** `HH:MM`. */
  startTime: string;
  endTime: string;
  /** `YYYY-MM-DD`, inclusive, or null for open-ended. */
  endDate: string | null;
}

/**
 * The dates a pattern generates, from `from` out to `horizonDays` later, inclusive.
 *
 * §5.3's two stop conditions, and they belong to different owners: `endDate` is
 * staff/domain ("the series is over") and stops this pattern outright; `horizon` is
 * system/storage ("rows are pre-built this far") and merely bounds this pass, so an
 * open-ended pattern regenerates out to the horizon forever, one window at a time.
 *
 * Date strings compare correctly as strings in `YYYY-MM-DD`, which is why the endDate
 * test needs no date arithmetic of its own.
 */
export function occurrenceDates(
  rule: Pick<PatternRule, 'weekdays' | 'endDate'>,
  from: CalendarDate,
  horizonDays: number,
): CalendarDate[] {
  const wanted = new Set(rule.weekdays);
  const dates: CalendarDate[] = [];

  for (let offset = 0; offset <= horizonDays; offset++) {
    const date = addDays(from, offset);
    // §5.3: `if pattern.endDate and D > pattern.endDate: stop this pattern`.
    if (rule.endDate !== null && isoDate(date) > rule.endDate) break;
    if (!wanted.has(isoWeekday(date))) continue;
    dates.push(date);
  }

  return dates;
}

/** Each generated date as the instants a `shift` row stores. */
export function patternWindows(
  rule: PatternRule,
  timeZone: string,
  from: CalendarDate,
  horizonDays: number,
): ShiftWindow[] {
  return occurrenceDates(rule, from, horizonDays).map((date) =>
    resolveWindow(date, rule.startTime, rule.endTime, timeZone),
  );
}

// ---------------------------------------------------------------------------
// Materialization (§5.3)
// ---------------------------------------------------------------------------

export interface MaterializationResult {
  patternId: string;
  created: number;
  /** How many of `created` were born CLAIMED (I25). */
  bornClaimed: number;
}

/**
 * Mint every missing instance of one pattern out to the horizon.
 *
 * Takes the caller's transaction, because I25's gate and the insert it gates have to
 * share one: `eligible()` read outside the write is decoration (`architecture.md
 * §4.1`). Every entry point below wraps this in `writeTransaction`.
 *
 * `now` is the lower bound §5.3 writes as `[now, horizon]`. An occurrence whose window
 * has already begun is not minted: the sweep would otherwise mint a run nobody can
 * take, which reads as MISSED in the reporting doc's derivation the moment it exists.
 * Idempotency is unaffected — an instance minted yesterday for today is already there
 * and stays there.
 */
async function materializeIn(
  tx: Tx,
  patternId: string,
  now: Date,
): Promise<MaterializationResult> {
  const config = await readConfig(tx);
  const pattern = await tx
    .selectFrom('recurrence_pattern')
    .select([
      'id',
      'route_id',
      'weekdays',
      'start_time',
      'end_time',
      'owner_default_id',
      'created_by',
      sql<string | null>`to_char(end_date, 'YYYY-MM-DD')`.as('end_date'),
    ])
    .where('id', '=', patternId)
    .executeTakeFirst();

  if (!pattern) return { patternId, created: 0, bornClaimed: 0 };

  const today = await pantryToday(tx, config.timezone, now);
  const windows = patternWindows(
    {
      weekdays: pattern.weekdays,
      startTime: clockText(pattern.start_time),
      endTime: clockText(pattern.end_time),
      endDate: pattern.end_date,
    },
    config.timezone,
    today,
    config.horizon_days,
  ).filter((window) => window.startsAt.getTime() >= now.getTime());

  // "if no Shift exists for (pattern, D)" — asked of the database, once, so the sweep
  // is a catch-up question and not a memory of what it did last time (§4.4).
  const existing = await tx
    .selectFrom('shift')
    .select(sql<string>`to_char(occurrence_date, 'YYYY-MM-DD')`.as('occurrence_date'))
    .where('recurrence_pattern_id', '=', patternId)
    .execute();
  const already = new Set(existing.map((row) => row.occurrence_date));

  let created = 0;
  let bornClaimed = 0;

  for (const window of windows) {
    if (already.has(window.occurrenceDate)) continue;

    // I25 — born CLAIMED only if `ownerDefault` is set AND `eligible()` holds for
    // THIS instance. Evaluated before the row exists, hence no `id`. `eligible()`
    // itself is `domain-modeling.md §5.2` and is imported, never restated.
    const born =
      pattern.owner_default_id !== null &&
      (await eligible(tx, pattern.owner_default_id, {
        startsAt: window.startsAt,
        endsAt: window.endsAt,
      }));

    const inserted = await tx
      .insertInto('shift')
      .values({
        recurrence_pattern_id: patternId,
        route_id: pattern.route_id,
        occurrence_date: window.occurrenceDate,
        starts_at: window.startsAt,
        ends_at: window.endsAt,
        status: born ? 'CLAIMED' : 'OPEN',
        owner_id: born ? pattern.owner_default_id : null,
        // `assigned_over_conflict` is left at its default false: materialization is
        // gated by `eligible()` and so can never produce a conflicting assignment
        // (migration 0008's column comment says exactly this).
        //
        // Provenance: a minted shift's author is the pattern's author
        // (`data-model.md §5.3`). There is deliberately no system user.
        created_by: pattern.created_by,
        updated_by: pattern.created_by,
      })
      // Idempotency (`data-model.md §9`). The `already` set above skips the common
      // case; this is the backstop for two passes racing, and it is what makes the
      // sweep safe to run late, twice, or after an outage.
      .onConflict((oc) => oc.constraint('uq_shift_occurrence').doNothing())
      .returning('id')
      .executeTakeFirst();

    if (inserted) {
      created++;
      if (born) bornClaimed++;
    }
  }

  return { patternId, created, bornClaimed };
}

/** One pattern, in its own transaction. */
export async function materializePattern(
  patternId: string,
  now: Date = new Date(),
): Promise<MaterializationResult> {
  if (!isUuid(patternId)) throw notFound('No such repeating run.');
  return writeTransaction((tx) => materializeIn(tx, patternId, now));
}

export interface SweepResult {
  patterns: number;
  created: number;
  bornClaimed: number;
  /** Patterns whose pass threw. The next sweep retries them; one bad pattern must
   *  not stop the rest, and a catch-up sweep loses nothing by being late. */
  failed: string[];
}

/**
 * The rolling sweep — every pattern, one transaction each.
 *
 * A transaction per pattern rather than one for the lot: `architecture.md §4.1` puts
 * the boundary at the use case, and "materialize this series to the horizon" is one.
 * It also bounds a SERIALIZABLE retry to a single series instead of replaying the
 * whole roster.
 */
export async function materializeDuePatterns(now: Date = new Date()): Promise<SweepResult> {
  const patterns = await db.selectFrom('recurrence_pattern').select('id').execute();

  const result: SweepResult = { patterns: patterns.length, created: 0, bornClaimed: 0, failed: [] };
  for (const pattern of patterns) {
    try {
      const one = await materializePattern(pattern.id, now);
      result.created += one.created;
      result.bornClaimed += one.bornClaimed;
    } catch {
      result.failed.push(pattern.id);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Pattern create / edit
// ---------------------------------------------------------------------------

function validWeekdays(value: unknown): number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw badRequest('Pick at least one day of the week.');
  }
  const days = new Set<number>();
  for (const raw of value) {
    const day = Number(raw);
    // Mirrors `ck_rp_weekdays` (tier 1). The constraint is the enforcement; this
    // exists so a bad day reads as a sentence rather than a constraint violation.
    if (!Number.isInteger(day) || day < 1 || day > 7) {
      throw badRequest('Days of the week must be 1 (Monday) through 7 (Sunday).');
    }
    days.add(day);
  }
  return [...days].sort((a, b) => a - b);
}

export interface CreatePatternParams {
  routeId: string;
  weekdays: number[];
  startTime: string;
  endTime: string;
  endDate?: string | null;
  /** First date the series generates from. Defaults to today, pantry-local. */
  startDate?: string | null;
}

export interface CreatePatternResult {
  pattern: PatternRecord;
  materialized: number;
  duplicates: DuplicateRun[];
}

/**
 * Create a weekly pattern and materialize it eagerly to the horizon.
 *
 * Eager, in the same transaction, because §5.3 is "eager-to-horizon": the instances
 * are plain rows from the moment the pattern exists, individually claimable and
 * individually editable, and nothing anywhere expands a pattern virtually.
 *
 * `owner_default_id` is deliberately NOT settable here. It is set by "claim all
 * future" and by staff-assign (PRD cap 6, `domain-modeling.md §5.3` `claim-all`),
 * both of which owe the driver an eligibility answer — a warning and an explicit
 * confirmation in the staff case, with the resulting shift flagged. A new pattern
 * therefore mints `OPEN` instances, and I25's born-CLAIMED path opens up once an
 * owner default exists.
 */
export async function createPattern(
  actor: ScheduleActor,
  params: CreatePatternParams,
): Promise<CreatePatternResult> {
  if (!isUuid(params.routeId)) throw badRequest('Pick a route for this repeating run.');
  const weekdays = validWeekdays(params.weekdays);
  const endDate =
    params.endDate === undefined || params.endDate === null
      ? null
      : isoDate(parseDate(params.endDate, 'endDate'));

  const created = await writeTransaction(async (tx) => {
    const config = await readConfig(tx);
    const today = await pantryToday(tx, config.timezone);
    const from =
      params.startDate === undefined || params.startDate === null
        ? today
        : parseDate(params.startDate, 'startDate');

    // Validates the intra-day rule (`ck_rp_window`, §5.3) before anything is written.
    resolveWindow(today, params.startTime, params.endTime, config.timezone);

    const route = await tx
      .selectFrom('route')
      .select(['id', 'deactivated_at'])
      .where('id', '=', params.routeId)
      .executeTakeFirst();
    if (!route) throw badRequest('That route no longer exists.');
    // I21 — an archived route is hidden from new use.
    if (route.deactivated_at !== null) {
      throw badRequest('That route is archived. Restore it before scheduling on it.');
    }
    await requireStops(tx, route.id);

    const pattern = await tx
      .insertInto('recurrence_pattern')
      .values({
        route_id: route.id,
        weekdays,
        start_time: params.startTime,
        end_time: params.endTime,
        end_date: endDate,
        owner_default_id: null,
        // I26 + `data-model.md §5.2`: the pattern's author is what a minted shift's
        // `created_by` resolves to, since the job has no logged-in user.
        created_by: actor.id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    // The soft duplicate-run check (`data-model.md §5.3`), surfaced only here where
    // staff is present. Never blocks, and the rolling job never runs it.
    const candidates: DuplicateCandidate[] = patternWindows(
      { weekdays, startTime: params.startTime, endTime: params.endTime, endDate },
      config.timezone,
      from,
      config.horizon_days,
    ).map((window) => ({ ...window, routeId: route.id }));
    const duplicates = await findDuplicateRuns(tx, candidates, pattern.id);

    const materialized = await materializeIn(
      tx,
      pattern.id,
      // A pattern that starts in the future materializes from its own start date, so
      // the lower bound is the later of "now" and that date's first instant.
      laterOf(new Date(), candidates[0]?.startsAt),
    );

    return {
      pattern: await readPattern(tx, pattern.id),
      materialized: materialized.created,
      duplicates,
    };
  });

  return created;
}

function laterOf(now: Date, other: Date | undefined): Date {
  if (other === undefined) return now;
  return other.getTime() > now.getTime() ? other : now;
}

export interface UpdatePatternParams {
  routeId?: string;
  weekdays?: number[];
  startTime?: string;
  endTime?: string;
  /** `null` clears it, reopening an open-ended series. */
  endDate?: string | null;
}

export interface UpdatePatternResult {
  pattern: PatternRecord;
  /** Future unclaimed instances moved onto the new window. */
  moved: number;
  ownedInstances: ShiftRecord[];
  offPatternInstances: ShiftRecord[];
  materialized: number;
}

/**
 * Edit the pattern itself — `S1.6`'s "Edit the weekly pattern", as against "Edit just
 * this date" (`services/schedule.ts`).
 *
 * I24: this is the only thing in the codebase that writes `recurrence_pattern` after
 * creation. I23's converse holds by construction — no per-instance operation reaches
 * this function.
 *
 * What happens to instances that already exist is NOT stated by any doc, so the
 * reading here is the one most consistent with what §5.3 does say, and it is recorded
 * as an assumption in this wave's report:
 *
 *   * **Future instances still on the pattern and still `OPEN`** are moved onto the
 *     new window. Otherwise "edit the weekly pattern" would visibly do nothing for a
 *     year, since the dates it would re-mint already exist and `uq_shift_occurrence`
 *     absorbs them.
 *   * **Instances with an owner (or already started) are left exactly where they
 *     were**, and returned. Moving an owned run is cap 9, and cap 9 requires staff to
 *     see that driver's conflicts and confirm the release; a pattern edit cannot make
 *     that decision on their behalf for a year of runs at once.
 *   * **Instances the edited pattern would no longer generate are left in place**,
 *     and returned. §5.3 is explicit that neither stop condition retracts
 *     already-materialized instances — ending part of a series is staff's explicit
 *     bulk-terminate.
 */
export async function updatePattern(
  actor: ScheduleActor,
  patternId: string,
  params: UpdatePatternParams,
): Promise<UpdatePatternResult> {
  if (!isUuid(patternId)) throw notFound('No such repeating run.');
  if (params.routeId !== undefined && !isUuid(params.routeId)) {
    throw badRequest('That route no longer exists.');
  }

  return writeTransaction(async (tx) => {
    const config = await readConfig(tx);
    const before = await readPattern(tx, patternId);

    const weekdays =
      params.weekdays === undefined ? before.weekdays : validWeekdays(params.weekdays);
    const startTime = params.startTime ?? before.start_time;
    const endTime = params.endTime ?? before.end_time;
    const endDate =
      params.endDate === undefined
        ? before.end_date
        : params.endDate === null
          ? null
          : isoDate(parseDate(params.endDate, 'endDate'));
    const routeId = params.routeId ?? before.route_id;

    const today = await pantryToday(tx, config.timezone);
    // Validates the intra-day rule before anything is written (`ck_rp_window`).
    resolveWindow(today, startTime, endTime, config.timezone);
    // Both are checked again on the new route, for the same I21 reason as create.
    if (routeId !== before.route_id) {
      const route = await tx
        .selectFrom('route')
        .select(['id', 'deactivated_at'])
        .where('id', '=', routeId)
        .executeTakeFirst();
      if (!route) throw badRequest('That route no longer exists.');
      if (route.deactivated_at !== null) {
        throw badRequest('That route is archived. Restore it before scheduling on it.');
      }
      await requireStops(tx, routeId);
    }

    // I24 — the explicit pattern-level edit.
    await tx
      .updateTable('recurrence_pattern')
      .set({
        route_id: routeId,
        weekdays,
        start_time: startTime,
        end_time: endTime,
        end_date: endDate,
      })
      .where('id', '=', patternId)
      .execute();

    const { moved, ownedInstances, offPatternInstances } = await applyToFutureInstances(
      tx,
      { patternId, weekdays, startTime, endTime, endDate, routeId },
      config.timezone,
      today,
      actor,
    );

    const materialized = await materializeIn(tx, patternId, new Date());

    return {
      pattern: await readPattern(tx, patternId),
      moved,
      ownedInstances,
      offPatternInstances,
      materialized: materialized.created,
    };
  });
}

interface AppliedRule {
  patternId: string;
  weekdays: number[];
  startTime: string;
  endTime: string;
  endDate: string | null;
  routeId: string;
}

async function applyToFutureInstances(
  tx: Tx,
  rule: AppliedRule,
  timeZone: string,
  today: CalendarDate,
  actor: ScheduleActor,
): Promise<{ moved: number; ownedInstances: ShiftRecord[]; offPatternInstances: ShiftRecord[] }> {
  const wanted = new Set(rule.weekdays);
  const from = isoDate(today);

  const instances = await tx
    .selectFrom('shift')
    .select([
      'id',
      'status',
      'owner_id',
      sql<string>`to_char(occurrence_date, 'YYYY-MM-DD')`.as('occurrence_date'),
    ])
    .where('recurrence_pattern_id', '=', rule.patternId)
    .where(sql<boolean>`occurrence_date >= ${from}::date`)
    // A CANCELLED instance is terminal (I10) and is neither moved nor reported.
    .where('status', '<>', 'CANCELLED')
    .execute();

  let moved = 0;
  const ownedIds: string[] = [];
  const offPatternIds: string[] = [];

  for (const instance of instances) {
    const date = parseDate(instance.occurrence_date, 'occurrenceDate');
    const onPattern =
      wanted.has(isoWeekday(date)) &&
      (rule.endDate === null || instance.occurrence_date <= rule.endDate);

    if (!onPattern) {
      offPatternIds.push(instance.id);
      continue;
    }
    if (instance.status !== 'OPEN') {
      ownedIds.push(instance.id);
      continue;
    }

    const window = resolveWindow(date, rule.startTime, rule.endTime, timeZone);
    await tx
      .updateTable('shift')
      .set({
        route_id: rule.routeId,
        starts_at: window.startsAt,
        ends_at: window.endsAt,
        updated_by: actor.id,
        updated_at: sql<Date>`now()`,
      })
      .where('id', '=', instance.id)
      // Still OPEN when the write lands, or it belongs to the owned list instead.
      // The predicate is the optimistic check (`data-model.md §9`).
      .where('status', '=', 'OPEN')
      .execute();
    moved++;
  }

  return {
    moved,
    ownedInstances: await instancesByIds(tx, ownedIds),
    offPatternInstances: await instancesByIds(tx, offPatternIds),
  };
}

async function instancesByIds(tx: Tx, ids: readonly string[]): Promise<ShiftRecord[]> {
  return listShiftsByIds(tx, ids);
}
