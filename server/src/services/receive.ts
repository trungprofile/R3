// Receiving — PRD cap 14, `ui-ux-spec.md` S2.1b / S2.2 / S2.2b, `domain-modeling.md`
// §3.1 (completion model) and §3.2 (ShiftStop).
//
// The receiver's half of a run: pick the run, weigh it stop by stop, and close it.
// This file holds the transition Phase 1 deliberately did not have — `IN_PROGRESS →
// COMPLETED` — and it is the ONLY place in the codebase that writes it (I11). The
// build plan's D1 said a second completion path would have to be removed in Phase 2;
// there was never a second one to remove, so this is an addition, not a correction.
//
// Three ideas do most of the work here, and all three are easy to get subtly wrong:
//
//   1. **WEIGHED is derived, never stored.** `shiftstop_disposition` has no WEIGHED
//      member (`data-model.md §6`). A stop reads as weighed iff a non-voided
//      `weight_entry` exists for `(shift, donor)` (I12). Every gate below re-derives
//      it rather than trusting a column, because a stored WEIGHED could pass the
//      completion gate on a weight that was later voided and never replaced.
//
//   2. **Weight rows are immutable.** A correction is void-old + insert-new (I13),
//      never an UPDATE of `weight`. The UI presents it as a plain overwrite; the
//      audit trail underneath is what makes a disputed NTFB number answerable.
//
//   3. **Totals are SUM-on-read.** Never stored, never incremented — that is what
//      makes concurrent receivers on the same run safe (`data-model.md §7.1`), and
//      S2.1b explicitly expects two receivers working different stops at once.
//
// Enforcement tiers (`architecture.md §4.1`) — this file is tier 3:
//
//   tier 1  `ck_weight_nonneg` via the column CHECK, the FK to `category`/`donor`
//   tier 2  the receive-done conditional UPDATE (`status='IN_PROGRESS'`) — rowcount
//           0 is a lost race against another receiver closing the same run
//   tier 3  here: I12's cross-row completion gate, I13's void-then-insert, I17's
//           purge, and the edit window
//
// Every write goes through `writeTransaction` (SERIALIZABLE + 40001 retry) and every
// gate's read is taken inside that same transaction.

import { sql } from 'kysely';
import {
  RECEIVE_INCOMPLETE_MESSAGE,
  receiveStopState,
  type CategoryTile,
  type ReceiveDonationSummary,
  type ReceiveDoneSummary,
  type ReceiveRunSummary,
  type ReceiveStopDetail,
  type ReceiveStopState,
  type ReceiveStopSummary,
  type WeightEntrySummary,
} from '../../../shared/src/receive.js';
import { DONATION_WINDOW_CLOSED_MESSAGE } from '../../../shared/src/donation.js';
import { db } from '../db/index.js';
// `donation.ts` owns the unscheduled-donation rows and the window predicate that
// bounds them; this file owns the receiver's screens. Service-to-service calls are
// the established pattern here (`schedule.ts` → `notification.ts`, and `donation.ts`
// → `parseWeight` in this file), and reaching in for the rows beats re-writing the
// same SQL twice. Only function bodies touch the import, so the cycle it completes
// with `donation.ts` is resolved before either is called.
import { listReceiveWorklist } from './donation.js';
import { writeTransaction, type Tx } from '../db/transaction.js';
import { badRequest, conflict, forbidden, notFound } from '../middleware/error.js';
import type { Reader } from './eligibility.js';

export interface ReceiveActor {
  id: string;
}

// ---------------------------------------------------------------------------
// Weight parsing
// ---------------------------------------------------------------------------

/**
 * `numeric(8,2)` — six digits before the point, two after.
 *
 * Parsed from a string and kept as a string all the way to the INSERT. A scale
 * reading crosses this boundary as text on purpose: routing `1222.35` through a
 * JS number and back is a rounding error waiting for a number that happens not to
 * be representable, and this column feeds the NTFB report.
 */
const WEIGHT_PATTERN = /^\d{1,6}(\.\d{1,2})?$/;

export function parseWeight(value: string, field = 'weight'): string {
  const trimmed = value.trim();
  if (!WEIGHT_PATTERN.test(trimmed)) {
    throw badRequest(`${field} must be a number of pounds, like 128 or 12.5.`);
  }
  return trimmed;
}

/** `SUM` over `numeric` returns `numeric`, and an empty set returns NULL. */
function sum(value: string | null): string {
  return value ?? '0.00';
}

// ---------------------------------------------------------------------------
// The edit window (`domain-modeling.md §3.1`, `app_config.receiver_edit_window_days`)
// ---------------------------------------------------------------------------

/**
 * Whether the receiver may still change this run's intake.
 *
 * `N` days from shift start, after which editing is Reporter-only and lives on S3.1
 * (Phase 3). Deliberately **not** applied to receive-done itself: closing the run is
 * the completion action (I11), not an edit, and gating it would make a run whose
 * window lapsed permanently unclosable — there is no other transition into
 * `COMPLETED` to rescue it.
 */
/**
 * The predicate itself, as SQL over an already-joined `shift` and `app_config`.
 *
 * One implementation, two readers: the gate below and the picker's per-row
 * `editWindowOpen` (`D66`). A second copy in the list query is a second thing to
 * keep in step with `app_config`, and the two would answer differently the day the
 * window changes.
 */
const WINDOW_OPEN_SQL = sql<boolean>`shift.starts_at + (app_config.receiver_edit_window_days * interval '1 day') > now()`;

async function receiverWindowOpen(reader: Reader, shiftId: string): Promise<boolean> {
  const row = await reader
    .selectFrom('shift')
    .innerJoin('app_config', (join) => join.onTrue())
    .select(WINDOW_OPEN_SQL.as('open'))
    .where('shift.id', '=', shiftId)
    .executeTakeFirst();

  return row?.open ?? false;
}

async function requireWindowOpen(tx: Tx, shiftId: string): Promise<void> {
  if (!(await receiverWindowOpen(tx, shiftId))) {
    throw forbidden(DONATION_WINDOW_CLOSED_MESSAGE);
  }
}

// ---------------------------------------------------------------------------
// The WEIGHED projection (I12)
// ---------------------------------------------------------------------------

interface StopRow {
  id: string;
  donorId: string;
  donorName: string;
  position: number;
  disposition: 'PENDING' | 'COLLECTED' | 'SKIPPED' | 'REASSIGNED';
  /** Kysely types an EXISTS as `SqlBool` (`boolean | number`) because drivers differ
   *  on what they return; `summarize` coerces rather than trusting one of them. */
  weighed: boolean | number;
}

/**
 * Every stop of a shift with its derived state.
 *
 * The `weighed` flag is a correlated EXISTS over non-voided `weight_entry` rows for
 * the same `(shift, donor)` — the shape `ix_weight_active` is built for. It joins on
 * donor rather than on a stop FK because `weight_entry` deliberately has none (I13):
 * receiving is dock-side and decoupled from the driver's per-stop check-off.
 */
async function readStopRows(reader: Reader, shiftId: string): Promise<StopRow[]> {
  return reader
    .selectFrom('shift_stop')
    .innerJoin('donor', 'donor.id', 'shift_stop.donor_id')
    .select((eb) => [
      'shift_stop.id as id',
      'shift_stop.donor_id as donorId',
      'donor.name as donorName',
      'shift_stop.position as position',
      'shift_stop.disposition as disposition',
      eb
        .exists(
          eb
            .selectFrom('weight_entry')
            .select('weight_entry.id')
            .whereRef('weight_entry.shift_id', '=', 'shift_stop.shift_id')
            .whereRef('weight_entry.donor_id', '=', 'shift_stop.donor_id')
            .where('weight_entry.voided', '=', false),
        )
        .as('weighed'),
    ])
    .where('shift_stop.shift_id', '=', shiftId)
    .orderBy('shift_stop.position')
    .execute();
}

function summarize(row: StopRow): ReceiveStopSummary {
  return {
    id: row.id,
    donorId: row.donorId,
    donorName: row.donorName,
    position: row.position,
    state: receiveStopState(row.disposition, Boolean(row.weighed)),
  };
}

/** I12's gate, evaluated over the projection rather than over stored dispositions. */
function allResolved(stops: ReceiveStopSummary[]): boolean {
  return stops.every(
    (s) => s.state === 'WEIGHED' || s.state === 'SKIPPED' || s.state === 'REASSIGNED',
  );
}

// ---------------------------------------------------------------------------
// S2.1b — the run picker
// ---------------------------------------------------------------------------

/**
 * The runs a receiver can work on.
 *
 * Filtered on `status = 'IN_PROGRESS'` and nothing else, which is narrower than S2.1b's
 * first sentence and wider than its parenthetical — the screen says both "shifts with
 * at least one unresolved stop" and "completed runs (… + receive-done already done)
 * drop off the list", and those describe different sets. The stricter reading is the
 * drafting slip: it would hide a run the moment its last stop was weighed, and S2.2b
 * is reached "from S2.1b once a run shows 'all stops done'" — so a fully-weighed run
 * must still be listed or receive-done becomes unreachable and the run can never
 * close. `readyForReceiveDone` is what the screen keys the S2.2b affordance off.
 *
 * Not filtered to `occurrence_date = today` either, for the reason S2.1b itself gives
 * for showing the shift's own date: receiving legitimately lags past midnight, and a
 * Tuesday run received at 12:30am Wednesday must still be reachable. At ~15 pickups a
 * week (PRD §6) an unclosed run from last week is a short list entry, not noise —
 * and hiding it would strand it permanently (A162).
 *
 * A run CLOSED TODAY is listed as well, read-only. Receive-done used to make a run
 * disappear the moment it was confirmed — the one moment a receiver is most likely
 * to want another look at what they just weighed. It is bounded to the PANTRY's
 * today (`app_config.timezone`, never the server or device clock), because that is
 * the span of one receiver's shift; anything older is the report's job. Being
 * COMPLETED is terminal (I10), so nothing on such a row is offered as an action.
 *
 * `D66` adds the edit window as a per-row FLAG and deliberately not as a `WHERE`.
 * Filtering lapsed runs out would strand them for the same reason a `today` bound
 * would, and worse: `receiveDone` is not window-gated (closing a run is the
 * completion action I11, not an edit) and this list is its only route, so a run
 * dropped from here can never reach `COMPLETED`. The client bands them separately
 * instead — still listed, no longer offered as something to weigh.
 */
export async function listReceivableRuns(): Promise<ReceiveRunSummary[]> {
  const shifts = await db
    .selectFrom('shift')
    .innerJoin('route', 'route.id', 'shift.route_id')
    .innerJoin('app_config', (join) => join.onTrue())
    .leftJoin('app_user as owner', 'owner.id', 'shift.owner_id')
    .select([
      'shift.id as shiftId',
      'route.name as routeName',
      sql<string | null>`concat_ws(' ', owner.first_name, owner.last_name)`.as('ownerName'),
      sql<string>`to_char(shift.occurrence_date, 'YYYY-MM-DD')`.as('occurrenceDate'),
      'shift.starts_at as startsAt',
      'shift.ends_at as endsAt',
      // I27 — a milestone inside IN_PROGRESS, never a status. Read, never written
      // here; the picker turns it into one line of copy (`D48`).
      'shift.pickup_completed_at as pickupCompletedAt',
      'shift.status as status',
      WINDOW_OPEN_SQL.as('editWindowOpen'),
    ])
    // IN_PROGRESS is the working set. A run CLOSED TODAY joins it too — read-only,
    // and only for the pantry's current day — so the receiver can still see what
    // they weighed this shift. Receive-done used to make a run vanish the instant
    // it was confirmed, which is the one moment a receiver most wants to look back
    // at it. Bounded to today because that is the span of a receiver's own memory
    // of the work; yesterday's numbers are the report's job, not this screen's.
    .where((eb) =>
      eb.or([
        eb('shift.status', '=', 'IN_PROGRESS'),
        eb.and([
          eb('shift.status', '=', 'COMPLETED'),
          eb(
            'shift.occurrence_date',
            '=',
            sql<Date>`(now() at time zone app_config.timezone)::date`,
          ),
        ]),
      ]),
    )
    .orderBy('shift.starts_at')
    .execute();

  const runs: ReceiveRunSummary[] = [];
  for (const shift of shifts) {
    const stops = (await readStopRows(db, shift.shiftId)).map(summarize);
    const doneCount = stops.filter(
      (s) => s.state === 'WEIGHED' || s.state === 'SKIPPED' || s.state === 'REASSIGNED',
    ).length;

    runs.push({
      shiftId: shift.shiftId,
      routeName: shift.routeName,
      // Empty name means no owner; `concat_ws` yields '' rather than NULL for that.
      ownerName: shift.ownerName === null || shift.ownerName === '' ? null : shift.ownerName,
      occurrenceDate: shift.occurrenceDate,
      startsAt: shift.startsAt.toISOString(),
      endsAt: shift.endsAt.toISOString(),
      stops,
      doneCount,
      totalCount: stops.length,
      readyForReceiveDone: stops.length > 0 && allResolved(stops),
      editWindowOpen: Boolean(shift.editWindowOpen),
      pickupCompletedAt: shift.pickupCompletedAt?.toISOString() ?? null,
      // Terminal (I10), so the client shows the numbers and offers nothing.
      closed: shift.status === 'COMPLETED',
    });
  }

  return runs;
}

/**
 * S2.1b's unscheduled-donation panel (`D67`, widened from counts to rows by `D76`).
 *
 * Its own function rather than a widening of `listReceivableRuns`: a walk-in has no
 * shift, so it is not a row of that list and joining it in would make the list's
 * membership rule (A162) answer two questions at once.
 *
 * "Today" is the PANTRY's calendar day, taken from `app_config.timezone` — the same
 * zone `createDonation` stamps `received_date` from, so this count and the rows it
 * describes agree. Never the server's clock and never the device's.
 *
 * `app_config` leads the join so the aggregate still returns a row when no donation
 * exists at all; the panel is shown in every state, including that one.
 *
 * The rows come from `listReceiveWorklist` rather than being re-queried here, and
 * `pendingCount` is `suggested.length` rather than a second `count(*)` — the contract
 * says the two agree, so the only way to keep them agreeing under a concurrent flag
 * is to derive one from the other. That also carries `D77`'s window bound onto the
 * count for free: a lapsed suggestion is neither listed nor counted.
 */
export async function readDonationSummary(): Promise<ReceiveDonationSummary> {
  const { suggested, recorded, recordedTotal } = await listReceiveWorklist();

  // Both counts are the lengths of the lists they head, not a separate aggregate.
  // A count that disagrees with the rows under it is worse than no count, and two
  // round trips against a non-serializable reader is exactly how they come to
  // disagree — a walk-in recorded between the two queries would have been counted
  // and not listed.
  return {
    recordedCount: recorded.length,
    recordedTotal: sum(recordedTotal),
    pendingCount: suggested.length,
    suggested,
    recorded,
  };
}

// ---------------------------------------------------------------------------
// S2.2 — the sheet
// ---------------------------------------------------------------------------

interface StopContext {
  stopId: string;
  shiftId: string;
  donorId: string;
  donorName: string;
  donorNote: string | null;
  stopNote: string | null;
  runNote: string | null;
  driverName: string | null;
  status: string;
  disposition: 'PENDING' | 'COLLECTED' | 'SKIPPED' | 'REASSIGNED';
}

async function loadStop(reader: Reader, shiftId: string, stopId: string): Promise<StopContext> {
  const row = await reader
    .selectFrom('shift_stop')
    .innerJoin('donor', 'donor.id', 'shift_stop.donor_id')
    .innerJoin('shift', 'shift.id', 'shift_stop.shift_id')
    // LEFT: a stop can be read on a run with no owner. Both notes below then fall
    // back to naming the role instead of a person, rather than disappearing.
    .leftJoin('app_user as owner', 'owner.id', 'shift.owner_id')
    .select([
      'shift_stop.id as stopId',
      'shift_stop.shift_id as shiftId',
      'shift_stop.donor_id as donorId',
      'donor.name as donorName',
      // Donor address/notes are operational data the receiver needs, never PII —
      // `pii.ts` gates people, not places (`CLAUDE.md`).
      'donor.note as donorNote',
      'shift_stop.note as stopNote',
      'shift.note as runNote',
      // Who wrote the two driver-authored notes. A name, not PII: `pii.ts` gates
      // phone and address, and the receiver already sees this driver's name on the
      // run they picked. It is here so a note can say whose it is on one line.
      sql<string | null>`concat_ws(' ', owner.first_name, owner.last_name)`.as('driverName'),
      'shift.status as status',
      'shift_stop.disposition as disposition',
    ])
    .where('shift_stop.id', '=', stopId)
    .where('shift_stop.shift_id', '=', shiftId)
    .executeTakeFirst();

  if (!row) throw notFound('No such stop on that run.');
  return row;
}

/**
 * One stop's sheet: every active category as a tile, each with its running entries
 * and its live subtotal.
 *
 * Tiles come from live `category` data filtered to active (S1.8, I21) — never a
 * hardcoded list — so archiving a category removes it from new entry while its
 * history keeps resolving. A category that already carries entries on this stop is
 * shown even if it has since been archived, because hiding it would make the stop's
 * total disagree with the numbers underneath it.
 */
export async function readStopSheet(
  reader: Reader,
  shiftId: string,
  stopId: string,
): Promise<ReceiveStopDetail> {
  const stop = await loadStop(reader, shiftId, stopId);

  const entries = await reader
    .selectFrom('weight_entry')
    .innerJoin('category', 'category.id', 'weight_entry.category_id')
    .innerJoin('app_user', 'app_user.id', 'weight_entry.created_by')
    .select([
      'weight_entry.id as id',
      'weight_entry.category_id as categoryId',
      'category.name as categoryName',
      sql<string>`weight_entry.weight::text`.as('weight'),
      'weight_entry.note as note',
      'weight_entry.created_at as createdAt',
      sql<string>`concat_ws(' ', app_user.first_name, app_user.last_name)`.as('createdByName'),
    ])
    .where('weight_entry.shift_id', '=', shiftId)
    .where('weight_entry.donor_id', '=', stop.donorId)
    .where('weight_entry.voided', '=', false)
    .orderBy('weight_entry.created_at')
    .execute();

  const activeCategories = await reader
    .selectFrom('category')
    .select(['id', 'name'])
    .where('deactivated_at', 'is', null)
    .orderBy('name')
    .execute();

  const byCategory = new Map<string, { name: string; entries: WeightEntrySummary[] }>();
  for (const c of activeCategories) byCategory.set(c.id, { name: c.name, entries: [] });

  for (const e of entries) {
    let bucket = byCategory.get(e.categoryId);
    if (!bucket) {
      // Archived after these entries were logged. Kept visible so the stop total
      // and the numbers under the tiles agree.
      bucket = { name: e.categoryName, entries: [] };
      byCategory.set(e.categoryId, bucket);
    }
    bucket.entries.push({
      id: e.id,
      weight: e.weight,
      note: e.note,
      createdAt: e.createdAt.toISOString(),
      createdByName: e.createdByName,
    });
  }

  const tiles: CategoryTile[] = [...byCategory.entries()].map(([categoryId, bucket]) => ({
    categoryId,
    categoryName: bucket.name,
    entries: bucket.entries,
    subtotal: addAll(bucket.entries.map((e) => e.weight)),
  }));

  return {
    shiftId,
    stopId,
    donorId: stop.donorId,
    donorName: stop.donorName,
    state: receiveStopState(stop.disposition, entries.length > 0),
    stopNote: stop.stopNote,
    donorNote: stop.donorNote,
    runNote: stop.runNote,
    driverName: stop.driverName === null || stop.driverName === '' ? null : stop.driverName,
    tiles,
    stopTotal: addAll(entries.map((e) => e.weight)),
  };
}

/**
 * Sum decimal strings without going through a float.
 *
 * `numeric(8,2)` is exactly two decimal places, so scaling by 100 makes every value
 * an integer and the addition exact. Done here rather than in SQL because the tile
 * subtotals are already in memory — a second round trip per tile would be eleven
 * queries to add up numbers we are holding.
 */
function addAll(values: string[]): string {
  const cents = values.reduce((acc, v) => acc + Math.round(Number(v) * 100), 0);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Guard shared by every write: the run must be open for receiving. */
async function requireReceivable(tx: Tx, shiftId: string): Promise<void> {
  const shift = await tx
    .selectFrom('shift')
    .select(['status'])
    .where('id', '=', shiftId)
    .executeTakeFirst();

  if (!shift) throw notFound('No such run.');
  if (shift.status === 'COMPLETED') {
    throw conflict('That run is already finished.');
  }
  if (shift.status !== 'IN_PROGRESS') {
    // Stops exist only from IN_PROGRESS onward (I5), so this is unreachable through
    // the UI — it is the server refusing a request the screen could not have made.
    throw conflict('That run has not started yet.');
  }
}

/**
 * Add one weight (S2.2 "Add weight"). Confirms immediately — PRD cap 14 puts no
 * separate sign-off at the entry level, so there is no draft row and no submit step.
 *
 * The donor comes from the stop rather than the request: the sheet is scoped to one
 * stop, and letting a client name the donor would be a way to write a weight against
 * a store that is not on this run. The schema permits exactly that (off-route donors
 * are allowed, I13) — the UI simply does not offer it, so neither does this.
 */
export async function addWeight(
  actor: ReceiveActor,
  shiftId: string,
  stopId: string,
  input: { categoryId: string; weight: string; note?: string | null },
): Promise<ReceiveStopDetail> {
  const weight = parseWeight(input.weight);

  return writeTransaction(async (tx) => {
    await requireReceivable(tx, shiftId);
    await requireWindowOpen(tx, shiftId);
    const stop = await loadStop(tx, shiftId, stopId);

    if (stop.disposition === 'REASSIGNED') {
      // Terminal and no longer this run's to resolve (I30).
      throw conflict('That stop was moved to another run.');
    }

    const category = await tx
      .selectFrom('category')
      .select(['id'])
      .where('id', '=', input.categoryId)
      .where('deactivated_at', 'is', null)
      .executeTakeFirst();

    if (!category) throw badRequest('Pick a category that is still in use.');

    await tx
      .insertInto('weight_entry')
      .values({
        shift_id: shiftId,
        donor_id: stop.donorId,
        category_id: input.categoryId,
        weight,
        note: input.note ?? null,
        created_by: actor.id,
        updated_by: actor.id,
      })
      .execute();

    return readStopSheet(tx, shiftId, stopId);
  });
}

/**
 * Overwrite an entry (the ✎ on S2.2) — void the old row, insert a new one (I13).
 *
 * Presented to the receiver as a plain edit with no undo and no history UI
 * (`product-requirement.md` out-of-scope list says so explicitly). The audit trail is
 * real underneath; it is just not a screen.
 *
 * The void is a conditional UPDATE on `voided = false`, so two receivers racing to
 * correct the same number produce one void and one refusal rather than two new rows
 * and a doubled total.
 */
export async function reviseWeight(
  actor: ReceiveActor,
  shiftId: string,
  stopId: string,
  entryId: string,
  input: { weight: string; note?: string | null },
): Promise<ReceiveStopDetail> {
  const weight = parseWeight(input.weight);

  return writeTransaction(async (tx) => {
    await requireReceivable(tx, shiftId);
    await requireWindowOpen(tx, shiftId);
    const stop = await loadStop(tx, shiftId, stopId);

    const existing = await tx
      .selectFrom('weight_entry')
      .select(['id', 'category_id', 'note'])
      .where('id', '=', entryId)
      .where('shift_id', '=', shiftId)
      .where('donor_id', '=', stop.donorId)
      .executeTakeFirst();

    if (!existing) throw notFound('No such weight on this stop.');

    const voided = await tx
      .updateTable('weight_entry')
      .set({ voided: true, updated_by: actor.id, updated_at: sql<Date>`now()` })
      .where('id', '=', entryId)
      .where('voided', '=', false)
      .executeTakeFirst();

    if (Number(voided.numUpdatedRows) === 0) {
      throw conflict('Someone already changed that number. Take another look.');
    }

    await tx
      .insertInto('weight_entry')
      .values({
        shift_id: shiftId,
        donor_id: stop.donorId,
        // The category is not editable through this path: changing it would be a
        // different entry, and S2.2's ✎ edits the number in place on its own tile.
        category_id: existing.category_id,
        weight,
        note: input.note === undefined ? existing.note : input.note,
        created_by: actor.id,
        updated_by: actor.id,
      })
      .execute();

    return readStopSheet(tx, shiftId, stopId);
  });
}

/**
 * Void an entry outright — the correction path with no replacement.
 *
 * Not on S2.2 (which only offers overwrite), but the domain distinguishes "this
 * number was wrong" from "this number should be different", and a weight logged
 * against the wrong stop has no correct replacement value to type.
 */
export async function voidWeight(
  actor: ReceiveActor,
  shiftId: string,
  stopId: string,
  entryId: string,
): Promise<ReceiveStopDetail> {
  return writeTransaction(async (tx) => {
    await requireReceivable(tx, shiftId);
    await requireWindowOpen(tx, shiftId);
    const stop = await loadStop(tx, shiftId, stopId);

    const result = await tx
      .updateTable('weight_entry')
      .set({ voided: true, updated_by: actor.id, updated_at: sql<Date>`now()` })
      .where('id', '=', entryId)
      .where('shift_id', '=', shiftId)
      .where('donor_id', '=', stop.donorId)
      .where('voided', '=', false)
      .executeTakeFirst();

    // Idempotent by design (`data-model.md §7.1`): rowcount 0 means it was already
    // voided, which is the state the caller asked for.
    if (Number(result.numUpdatedRows) === 0) {
      const exists = await tx
        .selectFrom('weight_entry')
        .select('id')
        .where('id', '=', entryId)
        .where('shift_id', '=', shiftId)
        .executeTakeFirst();
      if (!exists) throw notFound('No such weight on this stop.');
    }

    return readStopSheet(tx, shiftId, stopId);
  });
}

/**
 * "Skip stop" — nothing came from this store (§3.2, receiver branch).
 *
 * `SKIPPED` is an explicit stored disposition and **no phantom zero row** is written:
 * a skipped stop contributes nothing to any sum, and storing a 0 would make "we
 * received nothing" indistinguishable from "we received zero pounds" in the report.
 *
 * Refused when the stop already carries weight. S2.2 confirms because a skip cannot
 * be undone from that screen, but the real reason it is one-way is that un-skipping
 * has no meaning — the driver's own SKIPPED carries over to the receiver untouched.
 */
export async function skipStop(
  actor: ReceiveActor,
  shiftId: string,
  stopId: string,
  input: { note?: string | null } = {},
): Promise<ReceiveStopDetail> {
  return writeTransaction(async (tx) => {
    await requireReceivable(tx, shiftId);
    await requireWindowOpen(tx, shiftId);
    const stop = await loadStop(tx, shiftId, stopId);

    if (stop.disposition === 'REASSIGNED') {
      throw conflict('That stop was moved to another run.');
    }

    const weighed = await tx
      .selectFrom('weight_entry')
      .select('id')
      .where('shift_id', '=', shiftId)
      .where('donor_id', '=', stop.donorId)
      .where('voided', '=', false)
      .executeTakeFirst();

    if (weighed) {
      throw conflict('That stop already has weights. Remove them before skipping it.');
    }

    await tx
      .updateTable('shift_stop')
      .set({
        disposition: 'SKIPPED',
        ...(input.note === undefined ? {} : { note: input.note }),
      })
      .where('id', '=', stopId)
      .execute();

    // The run's own provenance stamp: the receiver touched this shift (I26).
    await tx
      .updateTable('shift')
      .set({ updated_by: actor.id, updated_at: sql<Date>`now()` })
      .where('id', '=', shiftId)
      .execute();

    return readStopSheet(tx, shiftId, stopId);
  });
}

// ---------------------------------------------------------------------------
// S2.2b — receive done (I11 / I12)
// ---------------------------------------------------------------------------

/**
 * The summary S2.2b renders before the one irreversible tap.
 *
 * Two fields here are read-only surfacings of things the write paths in this file
 * already decide, added by `D46` and `D47` so the screen stops offering a control
 * the server would refuse and stops going silent about who finished a run.
 */
export async function readReceiveDone(shiftId: string): Promise<ReceiveDoneSummary> {
  const shift = await db
    .selectFrom('shift')
    .innerJoin('route', 'route.id', 'shift.route_id')
    .leftJoin('app_user as owner', 'owner.id', 'shift.owner_id')
    // The shift's last writer (I26). On a COMPLETED run this is the person who
    // confirmed receive-done — see the assumption below.
    .leftJoin('app_user as writer', 'writer.id', 'shift.updated_by')
    .select([
      'shift.id as shiftId',
      'route.name as routeName',
      sql<string | null>`concat_ws(' ', owner.first_name, owner.last_name)`.as('ownerName'),
      'shift.status as status',
      sql<string | null>`concat_ws(' ', writer.first_name, writer.last_name)`.as('writerName'),
      'shift.updated_at as updatedAt',
    ])
    .where('shift.id', '=', shiftId)
    .executeTakeFirst();

  if (!shift) throw notFound('No such run.');

  const stops = (await readStopRows(db, shiftId)).map(summarize);

  const totals = await db
    .selectFrom('weight_entry')
    .select(['donor_id as donorId', sql<string | null>`sum(weight)::text`.as('total')])
    .where('shift_id', '=', shiftId)
    .where('voided', '=', false)
    .groupBy('donor_id')
    .execute();

  const byDonor = new Map(totals.map((t) => [t.donorId, sum(t.total)]));

  // `D47`. The SAME predicate every receiver write is gated on, evaluated once for
  // the screen instead of a second time in different words. Not a new rule and not
  // a second implementation of one — `requireWindowOpen` still runs on the write.
  const editWindowOpen = await receiverWindowOpen(db, shiftId);

  // `D46`. ASSUMED: on a COMPLETED shift, `updated_by`/`updated_at` name whoever
  // confirmed receive-done. There is no `completed_by` column and this adds none.
  // The inference rests on TWO invariants together and is only sound while both
  // hold:
  //   I10  COMPLETED is TERMINAL — nothing transitions out of it, so no later
  //        write can land on this row and displace the name.
  //   I11  `receiveDone()` below is the ONLY writer of IN_PROGRESS → COMPLETED,
  //        and it stamps `updated_by` with its actor in the same UPDATE.
  // Together those make "the last writer of a completed shift" and "the person who
  // closed it" the same person. If I10 ever stops being terminal — a reopen path, an
  // admin correction that touches `shift` — this silently starts naming the wrong
  // volunteer on a screen whose whole job is attribution. Store the attribution
  // properly at that point rather than patching here.
  //
  // Null while the run is open, deliberately: `updated_by` there is merely the last
  // person to touch the shift (a skip stamps it, see `skipStop`), which is a
  // different fact and must not be printed as this one.
  const completed = shift.status === 'COMPLETED';
  const writerName =
    shift.writerName === null || shift.writerName === '' ? null : shift.writerName;

  return {
    shiftId: shift.shiftId,
    routeName: shift.routeName,
    ownerName: shift.ownerName === null || shift.ownerName === '' ? null : shift.ownerName,
    editWindowOpen,
    completedBy: completed ? writerName : null,
    completedAt: completed ? shift.updatedAt.toISOString() : null,
    lines: stops.map((s) => ({
      donorName: s.donorName,
      state: s.state,
      // Null, not "0.00", for a stop that produced nothing — S2.2b prints "skipped"
      // rather than a weight, and the two are different facts.
      total: s.state === 'WEIGHED' ? (byDonor.get(s.donorId) ?? '0.00') : null,
    })),
    runTotal: addAll([...byDonor.values()]),
    readyForReceiveDone: stops.length > 0 && allResolved(stops),
  };
}

/**
 * Receive-done — the one completion action (I11).
 *
 * Three things happen in one transaction, and the order matters:
 *
 *   1. **The I12 gate**, re-derived here rather than trusted from the caller: every
 *      stop must project to WEIGHED, SKIPPED or REASSIGNED. This is the hard gate
 *      that guarantees no silently-dropped pickup reaches NTFB, so it is read inside
 *      the same transaction that writes the transition — a gate read outside its
 *      write is decoration.
 *
 *   2. **The transition**, as a conditional UPDATE on `status = 'IN_PROGRESS'`
 *      (`data-model.md §9`). Rowcount 0 means another receiver closed this run
 *      first, which is a lost race and not an error worth alarming anyone about.
 *
 *   3. **The I17 purge**, inline in this transaction: any `SUGGESTED` donation still
 *      hanging off this shift is hard-deleted. A driver-flagged pickup the receiver
 *      never confirmed is a prefill nobody acted on — it has no weight, so it has no
 *      ledger value, and leaving it would strand a row that no screen can reach once
 *      the run is closed.
 *
 * There is deliberately no undo. A correction after this point is the void-and-reweigh
 * path (I13), not a state change — `COMPLETED` is terminal (I10).
 */
export async function receiveDone(
  actor: ReceiveActor,
  shiftId: string,
): Promise<{ shiftId: string; purgedSuggestions: number }> {
  return writeTransaction(async (tx) => {
    const shift = await tx
      .selectFrom('shift')
      .select(['id', 'status'])
      .where('id', '=', shiftId)
      .executeTakeFirst();

    if (!shift) throw notFound('No such run.');
    if (shift.status === 'COMPLETED') throw conflict('That run is already finished.');
    if (shift.status !== 'IN_PROGRESS') throw conflict('That run has not started yet.');

    const stops = (await readStopRows(tx, shiftId)).map(summarize);
    if (stops.length === 0 || !allResolved(stops)) {
      throw conflict(RECEIVE_INCOMPLETE_MESSAGE);
    }

    const updated = await tx
      .updateTable('shift')
      .set({ status: 'COMPLETED', updated_by: actor.id, updated_at: sql<Date>`now()` })
      .where('id', '=', shiftId)
      .where('status', '=', 'IN_PROGRESS')
      .executeTakeFirst();

    if (Number(updated.numUpdatedRows) === 0) {
      throw conflict('That run is already finished.');
    }

    const purged = await tx
      .deleteFrom('unscheduled_donation')
      .where('shift_id', '=', shiftId)
      .where('status', '=', 'SUGGESTED')
      .executeTakeFirst();

    return { shiftId, purgedSuggestions: Number(purged.numDeletedRows) };
  });
}

/** Exposed for the routes layer's read of a single run's stop list. */
export async function readRunStops(shiftId: string): Promise<ReceiveStopSummary[]> {
  return (await readStopRows(db, shiftId)).map(summarize);
}

/** Exported for the I21 predicate in `donor.ts` / `category.ts` / `user.ts`. */
export type { ReceiveStopState };
