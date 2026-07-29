// Driver availability — `product-requirement.md` cap 7, `ui-ux-spec.md S1.4`.
//
// "A driver marks unavailability as a date range or a specific time window within
// given dates … Declaring a block that overlaps a shift the driver does own (claimed
// or in-progress) is rejected — the driver must cancel/release that shift first."
//
// That rejection is `domain-modeling.md §5.2`'s second `eligible()` call site, and
// it is deliberately narrower than the full predicate: the declaration gate asks
// only about **owned CLAIMED / IN_PROGRESS shifts**. It does not ask about the
// driver's other blocks (blocks may overlap each other freely — their union is what
// eligibility reads) and it does not ask about the Drive duty (a duty gate is
// answerable from the session and lives at the route layer, `architecture.md §4.3`).
//
// It is a gate, never a sweep: an existing owned shift is never auto-released to
// make room for a block. I20's "never overlaps" therefore holds by construction on
// both sides — you cannot claim into a block, and you cannot declare a block over a
// claim.
//
// Every write here goes through `writeTransaction` (SERIALIZABLE + 40001 retry), and
// the gate's read is taken inside that transaction: under READ COMMITTED a claim
// landing between the check and the insert is exactly the write skew §4.1 describes.

import { TIERS, tierAtLeast, type Tier } from '../../../shared/src/index.js';
import {
  AVAILABILITY_CONFLICT_IN_PROGRESS,
  AVAILABILITY_CONFLICT_RELEASABLE,
  type AvailabilityBlockSummary,
  type AvailabilityConflict,
  type AvailabilityKind,
} from '../../../shared/src/availability.js';
import { db } from '../db/index.js';
import { writeTransaction, type Tx } from '../db/transaction.js';
import { badRequest, conflict, forbidden, notFound } from '../middleware/error.js';
import { dispatchNow } from '../jobs/push-dispatch.js';
import { enqueueNotifications } from './notification.js';
import { conflictingOwnedShifts, type TimeWindow } from './eligibility.js';

// ---------------------------------------------------------------------------
// Pantry-local time
//
// §5.2 states the window as "half-open, pantry-local time", and the pantry's zone is
// `app_config.timezone` (an IANA zone, DST-aware, never a fixed offset —
// `data-model.md §2`). A calendar date and a wall-clock time are therefore resolved
// to instants HERE, on the server, not by whatever timezone the driver's phone
// happens to be in.
//
// No dependency is added for this: `Intl.DateTimeFormat` already knows the zone
// database. Converting an instant to local wall time is direct; the inverse needs
// one correction pass, because the offset to apply depends on the instant you are
// trying to find.
// ---------------------------------------------------------------------------

interface WallTime {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

function zoneParts(instant: Date, timeZone: string): WallTime {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instant);

  const read = (type: string): number => {
    const part = parts.find((p) => p.type === type);
    return part ? Number(part.value) : 0;
  };

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour') % 24,
    minute: read('minute'),
  };
}

/** The zone's UTC offset in milliseconds at a given instant (positive east). */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const w = zoneParts(instant, timeZone);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute) - instant.getTime();
}

/**
 * A pantry-local wall time as an absolute instant.
 *
 * Two passes: the first uses the offset in force at the naive guess, the second
 * re-reads the offset at the instant that produced — which is what makes a window
 * spanning a DST change come out the right length rather than an hour off. A local
 * time that does not exist (the spring-forward gap) resolves to the instant the
 * clock jumped to, and one that happens twice resolves to the first.
 */
export function localToInstant(wall: WallTime, timeZone: string): Date {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  const first = naive - zoneOffsetMs(new Date(naive), timeZone);
  const second = naive - zoneOffsetMs(new Date(first), timeZone);
  return new Date(second);
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

function parseDate(value: string, field: string): CalendarDate {
  const match = DATE_PATTERN.exec(value);
  if (!match) throw badRequest(`${field} must be a date, as YYYY-MM-DD.`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // Round-trip through UTC to reject 2026-02-31 and friends. The date is a
  // calendar fact here, not an instant — no zone is involved yet.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw badRequest(`${field} is not a real date.`);
  }
  return { year, month, day };
}

function parseTime(value: string, field: string): { hour: number; minute: number } {
  const match = TIME_PATTERN.exec(value);
  if (!match) throw badRequest(`${field} must be a time of day, as HH:MM.`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw badRequest(`${field} is not a real time.`);
  return { hour, minute };
}

function dayNumber(date: CalendarDate): number {
  return Math.floor(Date.UTC(date.year, date.month - 1, date.day) / 86_400_000);
}

function addDays(date: CalendarDate, days: number): CalendarDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

// ---------------------------------------------------------------------------
// Expanding a declaration into blocks
// ---------------------------------------------------------------------------

export interface DeclareAvailabilityInput {
  kind: AvailabilityKind;
  fromDate: string;
  toDate: string;
  startTime?: string | undefined;
  endTime?: string | undefined;
}

/**
 * S1.4's two entry shapes, resolved to the rows `data-model.md §10` actually stores.
 *
 * A block is ONE contiguous `[starts_at, ends_at)`, so a clock window repeated over
 * five dates is five rows. Doing the expansion here rather than in the client keeps
 * two things true: the pantry's timezone decides where a day starts, and the whole
 * declaration passes the I20 gate or none of it is written.
 *
 * `DATES` runs from 00:00 local on `fromDate` to 00:00 local on the day AFTER
 * `toDate` — a single half-open span, not one row per day, because a multi-day
 * absence is genuinely contiguous and `§5.2`'s overlap test reads it identically.
 */
export function expandDeclaration(
  input: DeclareAvailabilityInput,
  timeZone: string,
  maxDays: number,
): TimeWindow[] {
  if (input.kind !== 'DATES' && input.kind !== 'WINDOW') {
    throw badRequest('kind must be DATES or WINDOW.');
  }

  const from = parseDate(input.fromDate, 'fromDate');
  const to = parseDate(input.toDate, 'toDate');

  const span = dayNumber(to) - dayNumber(from) + 1;
  if (span < 1) throw badRequest('toDate must be on or after fromDate.');
  if (span > maxDays) {
    // Bounded by the materialization horizon: nothing exists to be unavailable
    // for beyond it (`domain-modeling.md §5.3`, `app_config.horizon_days`), and an
    // unbounded WINDOW expansion is one row per day forever.
    throw badRequest(`A single declaration may cover at most ${maxDays} days.`);
  }

  if (input.kind === 'DATES') {
    if (input.startTime !== undefined || input.endTime !== undefined) {
      throw badRequest('A whole-day range takes no start or end time.');
    }
    const dayAfter = addDays(to, 1);
    return [
      {
        startsAt: localToInstant({ ...from, hour: 0, minute: 0 }, timeZone),
        endsAt: localToInstant({ ...dayAfter, hour: 0, minute: 0 }, timeZone),
      },
    ];
  }

  if (input.startTime === undefined || input.endTime === undefined) {
    throw badRequest('A time window needs both startTime and endTime.');
  }
  const start = parseTime(input.startTime, 'startTime');
  const end = parseTime(input.endTime, 'endTime');
  // Intra-day, for the reason `domain-modeling.md §5.3` gives recurrence windows:
  // an overnight span is two things, not one. An overnight absence is a DATES range.
  if (end.hour * 60 + end.minute <= start.hour * 60 + start.minute) {
    throw badRequest('endTime must be later in the day than startTime.');
  }

  const windows: TimeWindow[] = [];
  for (let offset = 0; offset < span; offset++) {
    const date = addDays(from, offset);
    windows.push({
      startsAt: localToInstant({ ...date, ...start }, timeZone),
      endsAt: localToInstant({ ...date, ...end }, timeZone),
    });
  }
  return windows;
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

function toConflict(owned: {
  shiftId: string;
  status: string;
  startsAt: Date;
  endsAt: Date;
  routeName: string;
}): AvailabilityConflict {
  return {
    shiftId: owned.shiftId,
    status: owned.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'CLAIMED',
    startsAt: owned.startsAt.toISOString(),
    endsAt: owned.endsAt.toISOString(),
    routeName: owned.routeName,
    // I9 blocks cancelling from IN_PROGRESS, so that run cannot be cleared out of
    // the way — §5.2 says the block "simply cannot be declared until the run
    // finishes", and S1.4 has a separate sentence for exactly that case.
    releasable: owned.status !== 'IN_PROGRESS',
  };
}

/**
 * The declaration gate (I20, `§5.2`). Returns every owned CLAIMED / IN_PROGRESS
 * shift standing in the way of any window in the declaration.
 *
 * Read-only and exported so a screen can preview the refusal before the driver taps
 * Save — client-side checks are communication only, and this is the same predicate
 * the write path runs again inside its transaction.
 */
export async function declarationConflicts(
  reader: Parameters<typeof conflictingOwnedShifts>[0],
  driverId: string,
  windows: readonly TimeWindow[],
): Promise<AvailabilityConflict[]> {
  const seen = new Set<string>();
  const conflicts: AvailabilityConflict[] = [];

  for (const window of windows) {
    for (const owned of await conflictingOwnedShifts(reader, driverId, window)) {
      if (seen.has(owned.shiftId)) continue;
      seen.add(owned.shiftId);
      conflicts.push(toConflict(owned));
    }
  }

  return conflicts;
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export interface AvailabilityActor {
  id: string;
  tier: Tier;
}

function toSummary(row: {
  id: string;
  user_id: string;
  starts_at: Date;
  ends_at: Date;
  created_at: Date;
}): AvailabilityBlockSummary {
  return {
    id: row.id,
    userId: row.user_id,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    createdAt: row.created_at.toISOString(),
  };
}

/** Tiers that count as a coordinator for the notification matrix's "Coordinator
 *  (Staff) only" row. Derived, not written out: I1 makes tiers hierarchical, so
 *  Admin is a coordinator too, and an equality test here would silently drop them. */
const COORDINATOR_TIERS: Tier[] = TIERS.filter((tier) => tierAtLeast(tier, 'STAFF'));

function formatRange(window: TimeWindow, timeZone: string): string {
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${date.format(window.startsAt)} ${time.format(window.startsAt)} – ${date.format(
    window.endsAt,
  )} ${time.format(window.endsAt)}`;
}

/**
 * Declare unavailability. The subject is always the acting driver: PRD cap 7 is a
 * driver capability and no doc gives staff a declare-on-behalf action, so there is
 * no `userId` parameter to get wrong.
 *
 * One transaction for the use case (`architecture.md §4.1`): the I20 gate's read,
 * every insert, and the coordinator notification's outbox rows commit together or
 * not at all. The push itself is dispatched after commit, never inside — a
 * SERIALIZABLE retry would re-send it (§4.4).
 */
export async function declareAvailability(
  actor: AvailabilityActor,
  input: DeclareAvailabilityInput,
): Promise<AvailabilityBlockSummary[]> {
  const blocks = await writeTransaction(async (tx) => {
    const config = await tx
      .selectFrom('app_config')
      .select(['timezone', 'horizon_days'])
      .executeTakeFirstOrThrow();

    const windows = expandDeclaration(input, config.timezone, config.horizon_days);

    // The gate. Read inside this transaction, so a claim racing this declaration is
    // caught by SSI rather than slipping between a check and an insert (§4.1).
    const conflicts = await declarationConflicts(tx, actor.id, windows);
    if (conflicts.length > 0) {
      const stuck = conflicts.some((c) => !c.releasable);
      throw conflict(
        stuck ? AVAILABILITY_CONFLICT_IN_PROGRESS : AVAILABILITY_CONFLICT_RELEASABLE,
        { error: 'AVAILABILITY_CONFLICT', conflicts },
      );
    }

    const inserted = await tx
      .insertInto('availability_block')
      .values(
        windows.map((window) => ({
          user_id: actor.id,
          starts_at: window.startsAt,
          ends_at: window.endsAt,
        })),
      )
      .returningAll()
      .execute();

    await notifyCoordinators(tx, actor.id, windows, config.timezone);

    return inserted.map(toSummary);
  });

  // Outside the transaction, fire-and-forget (§4.4). The sweep is what makes
  // delivery correct; this only makes it prompt.
  dispatchNow();

  return blocks;
}

/**
 * "Driver sets unavailability → Coordinator (Staff) only, push + flag, event"
 * (`product-requirement.md §4` notification matrix). No shift is the subject, so the
 * row carries `shift_id = null` and the tier-1 dedupe index does not apply — every
 * declaration is its own event.
 */
async function notifyCoordinators(
  tx: Tx,
  driverId: string,
  windows: readonly TimeWindow[],
  timeZone: string,
): Promise<void> {
  const driver = await tx
    .selectFrom('app_user')
    .select(['first_name', 'last_name'])
    .where('id', '=', driverId)
    .executeTakeFirstOrThrow();

  const coordinators = await tx
    .selectFrom('app_user')
    .select('id')
    .where('tier', 'in', COORDINATOR_TIERS)
    // A deactivated coordinator cannot read an inbox (I21 — hidden from new use).
    .where('deactivated_at', 'is', null)
    .execute();

  const first = windows[0];
  const last = windows[windows.length - 1];
  const when =
    first && last
      ? formatRange({ startsAt: first.startsAt, endsAt: last.endsAt }, timeZone)
      : undefined;

  await enqueueNotifications(
    tx,
    coordinators.map((coordinator) => ({
      event: 'UNAVAILABILITY_DECLARED' as const,
      recipientId: coordinator.id,
      payload: {
        who: `${driver.first_name} ${driver.last_name}`,
        ...(when !== undefined ? { when } : {}),
      },
    })),
  );
}

/**
 * Withdraw a block the driver declared.
 *
 * A hard delete, not a soft one: I21's soft-delete rule enumerates Donor, Category,
 * Truck and User, and no row anywhere references an `availability_block` — the
 * eligibility overlap reads the table live, so a withdrawn block has no history to
 * preserve. Ownership is a resource rule and therefore checked here, in the
 * transaction, not at the route (`architecture.md §4.3`).
 */
export async function withdrawAvailability(
  actor: AvailabilityActor,
  blockId: string,
): Promise<void> {
  await writeTransaction(async (tx) => {
    const block = await tx
      .selectFrom('availability_block')
      .select(['id', 'user_id'])
      .where('id', '=', blockId)
      .executeTakeFirst();

    if (!block) throw notFound('No such availability block.');
    if (block.user_id !== actor.id) {
      throw forbidden('You can only change your own availability.');
    }

    await tx.deleteFrom('availability_block').where('id', '=', blockId).execute();
  });
}

/**
 * A driver's declared unavailability.
 *
 * Reading someone else's requires Staff and above: `product-requirement.md §2` gives
 * Staff "operational status across all volunteers (availability, assignments …)".
 * Hierarchical, so Admin passes (I1) — never an equality test. Read-only, so no
 * transaction (§4.1 permits the default isolation for reads).
 */
export async function listAvailability(
  actor: AvailabilityActor,
  subjectId?: string,
): Promise<AvailabilityBlockSummary[]> {
  const userId = subjectId ?? actor.id;
  if (userId !== actor.id && !tierAtLeast(actor.tier, 'STAFF')) {
    throw forbidden("You can only see your own availability.");
  }

  const rows = await db
    .selectFrom('availability_block')
    .selectAll()
    .where('user_id', '=', userId)
    .orderBy('starts_at')
    .execute();

  return rows.map(toSummary);
}
