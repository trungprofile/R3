// Unplanned intake — PRD cap 12, `ui-ux-spec.md` S1.5 (driver flag) / S2.3 (receiver
// record & confirm), `domain-modeling.md §2.3` and I14–I18.
//
// `UnscheduledDonation` is food that was NOT on the staff's plan. It reaches the
// system two ways, and the entity is the same either way:
//
//   driver-add        driver flags an ad-hoc pickup mid-run → `SUGGESTED`, no weight,
//                     a prefill for the receiver. NEVER writes a `ShiftStop` (I14) —
//                     that is what keeps planned and unplanned structurally disjoint
//                     rather than a matter of reading the data right.
//   receiver-authored a walk-in or a relayed store call, logged at the dock → born
//                     `CONFIRMED`, weight required (I16a).
//
// The grain is one row per category, exactly as for `weight_entry`: the two are PEERS
// (I18), sharing a shape but never referencing each other, and the report unions them.
// A donation spanning three categories is three rows.
//
// `reportable` is the one flag `weight_entry` does not have, and I15 says why: planned
// intake is reportable by construction, so a scheduled weight needs no flag, while an
// unscheduled one might be a store call (report it) or a neighbour's garden surplus
// (do not). Default ON.
//
// Enforcement tiers (`architecture.md §4.1`) — this file is tier 3:
//
//   tier 1  `ck_ud_source_exclusive`, `ck_ud_confirmed_weight` (I16a),
//           `ck_ud_i16b_source` (I16b) — all three are real CHECKs in migration 0011
//   tier 3  here: I29's on-route guard (cross-table, so no CHECK can express it),
//           I17's SUGGESTED-only-from-driver-add rule, and the edit window

import { sql } from 'kysely';
import {
  DONATION_ON_ROUTE_MESSAGE,
  DONATION_SOURCE_REQUIRED_MESSAGE,
  DONATION_WINDOW_CLOSED_MESSAGE,
  type DonationSource,
  type DonationSummary,
} from '../../../shared/src/donation.js';
import { db } from '../db/index.js';
import { writeTransaction, type Tx } from '../db/transaction.js';
import { badRequest, conflict, forbidden, notFound } from '../middleware/error.js';
import { localCalendarDate } from '../time.js';
import { isoDate } from './schedule.js';
import { parseWeight } from './receive.js';
import type { Reader } from './eligibility.js';

export interface DonationActor {
  id: string;
}

// ---------------------------------------------------------------------------
// Source resolution (derived, never stored)
// ---------------------------------------------------------------------------

interface SourceInput {
  donorId?: string | null;
  donorLabel?: string | null;
}

interface ResolvedSource {
  donorId: string | null;
  donorLabel: string | null;
}

/**
 * `donor_id` XOR `donor_label` XOR neither.
 *
 * `ck_ud_source_exclusive` refuses both at the storage layer; this refuses it with a
 * sentence a person can act on. Blank label text is normalised to NULL so an empty
 * input box does not become a donation attributed to the empty string — which would
 * satisfy I16b's "source present" while attributing the food to nobody.
 */
function resolveSource(input: SourceInput): ResolvedSource {
  const label = input.donorLabel?.trim();
  const donorId = input.donorId ?? null;
  const donorLabel = label === undefined || label === '' ? null : label;

  if (donorId !== null && donorLabel !== null) {
    throw badRequest('Pick a store from the list or type a name, not both.');
  }
  return { donorId, donorLabel };
}

function sourceOf(row: { donorId: string | null; donorLabel: string | null }): DonationSource {
  if (row.donorId !== null) return 'MASTER';
  if (row.donorLabel !== null) return 'LABEL';
  return 'ANON';
}

/** I16b, refused before the CHECK fires so the receiver gets a usable message. */
function requireSourceWhenReportable(source: ResolvedSource, reportable: boolean): void {
  if (reportable && source.donorId === null && source.donorLabel === null) {
    throw badRequest(DONATION_SOURCE_REQUIRED_MESSAGE);
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const DONATION_COLUMNS = [
  'unscheduled_donation.id as id',
  'unscheduled_donation.shift_id as shiftId',
  'unscheduled_donation.status as status',
  'unscheduled_donation.donor_id as donorId',
  'unscheduled_donation.donor_label as donorLabel',
  'unscheduled_donation.category_id as categoryId',
  'unscheduled_donation.reportable as reportable',
  'unscheduled_donation.note as note',
  'unscheduled_donation.created_at as createdAt',
] as const;

async function readDonations(
  reader: Reader,
  apply: (qb: ReturnType<typeof donationQuery>) => ReturnType<typeof donationQuery>,
): Promise<DonationSummary[]> {
  const rows = await apply(donationQuery(reader)).execute();

  return rows.map((r) => {
    const source = sourceOf(r);
    return {
      id: r.id,
      shiftId: r.shiftId,
      status: r.status,
      source,
      donorId: r.donorId,
      donorLabel: r.donorLabel,
      // `data-model.md §8`: an anonymous walk-in collapses into one "unattributed"
      // bucket in the report. The same word is used here so the two agree on screen.
      donorDisplay: r.donorName ?? r.donorLabel ?? 'Unattributed',
      categoryId: r.categoryId,
      categoryName: r.categoryName,
      weight: r.weight,
      reportable: r.reportable,
      receivedDate: r.receivedDate,
      note: r.note,
      createdByName: r.createdByName,
      createdAt: r.createdAt.toISOString(),
      editableByReceiver: r.editable,
    };
  });
}

function donationQuery(reader: Reader) {
  return reader
    .selectFrom('unscheduled_donation')
    .innerJoin('category', 'category.id', 'unscheduled_donation.category_id')
    .innerJoin('app_user', 'app_user.id', 'unscheduled_donation.created_by')
    .leftJoin('donor', 'donor.id', 'unscheduled_donation.donor_id')
    .leftJoin('shift', 'shift.id', 'unscheduled_donation.shift_id')
    .innerJoin('app_config', (join) => join.onTrue())
    .select([
      ...DONATION_COLUMNS,
      'category.name as categoryName',
      'donor.name as donorName',
      sql<string | null>`unscheduled_donation.weight::text`.as('weight'),
      sql<string>`to_char(unscheduled_donation.received_date, 'YYYY-MM-DD')`.as('receivedDate'),
      sql<string>`concat_ws(' ', app_user.first_name, app_user.last_name)`.as('createdByName'),
      // The window runs from the shift's start for a driver-add, and from the row's
      // own creation for a walk-in that has no shift to anchor to.
      sql<boolean>`
        coalesce(shift.starts_at, unscheduled_donation.created_at)
          + (app_config.receiver_edit_window_days * interval '1 day') > now()
      `.as('editable'),
    ]);
}

/** Every donation attached to one run — S2.3's prefill list and S2.2's badge. */
export async function listDonationsForShift(shiftId: string): Promise<DonationSummary[]> {
  return readDonations(db, (qb) =>
    qb.where('unscheduled_donation.shift_id', '=', shiftId).orderBy('unscheduled_donation.created_at'),
  );
}

/**
 * The receiver's S2.3 worklist: everything still awaiting confirmation, across runs,
 * plus recent confirmed rows so an edit is reachable without hunting.
 */
export async function listOpenDonations(): Promise<DonationSummary[]> {
  return readDonations(db, (qb) =>
    qb
      .where((eb) =>
        eb.or([
          eb('unscheduled_donation.status', '=', 'SUGGESTED'),
          sql<boolean>`unscheduled_donation.created_at > now() - interval '7 days'`,
        ]),
      )
      .orderBy('unscheduled_donation.created_at', 'desc'),
  );
}

async function readOne(reader: Reader, id: string): Promise<DonationSummary> {
  const rows = await readDonations(reader, (qb) => qb.where('unscheduled_donation.id', '=', id));
  const row = rows[0];
  if (!row) throw notFound('No such donation.');
  return row;
}

// ---------------------------------------------------------------------------
// S1.5 — the driver's flag (I14, I17, I29)
// ---------------------------------------------------------------------------

/**
 * Flag an ad-hoc pickup mid-run.
 *
 * Creates a `SUGGESTED` row and **nothing else** — no `ShiftStop`, no weight, no
 * change to the planned route (I14). The driver is telling the receiver "something
 * extra is coming"; the receiver is the one who weighs it and confirms it.
 *
 * The I29 guard is the interesting part and it is cross-table, so no CHECK can carry
 * it: if this donor is already a stop on this run, the food belongs on that stop as
 * another `weight_entry` (the grain already allows many rows per shift+donor+category)
 * and not here. Refusing keeps "planned" and "unplanned" disjoint by construction
 * rather than by convention, which is what lets the report trust the split.
 *
 * `categoryId` is required by the locked doc even though S1.5's prose says the control
 * is "just a donor picker … and an optional note" — see `shared/src/donation.ts`
 * `FlagAdHocRequest` and build-plan D8 for why that conflict resolves this way.
 */
export async function flagAdHoc(
  actor: DonationActor,
  shiftId: string,
  input: {
    donorId?: string | null;
    donorLabel?: string | null;
    categoryId: string;
    note?: string | null;
  },
): Promise<DonationSummary> {
  const source = resolveSource(input);

  return writeTransaction(async (tx) => {
    const shift = await tx
      .selectFrom('shift')
      .select([
        'id',
        'status',
        'owner_id as ownerId',
        sql<string>`to_char(occurrence_date, 'YYYY-MM-DD')`.as('occurrenceDate'),
      ])
      .where('id', '=', shiftId)
      .executeTakeFirst();

    if (!shift) throw notFound('No such run.');
    if (shift.ownerId !== actor.id) throw forbidden('That run is not yours.');
    if (shift.status !== 'IN_PROGRESS') throw conflict('That run is not in progress.');

    await requireActiveCategory(tx, input.categoryId);

    if (source.donorId !== null) {
      await requireActiveDonor(tx, source.donorId);

      // I29. Read inside the transaction that writes, so a stop being added
      // concurrently cannot slip past between the check and the insert.
      const onRoute = await tx
        .selectFrom('shift_stop')
        .select('id')
        .where('shift_id', '=', shiftId)
        .where('donor_id', '=', source.donorId)
        .executeTakeFirst();

      if (onRoute) throw conflict(DONATION_ON_ROUTE_MESSAGE);
    }

    const row = await tx
      .insertInto('unscheduled_donation')
      .values({
        shift_id: shiftId,
        donor_id: source.donorId,
        donor_label: source.donorLabel,
        category_id: input.categoryId,
        // NULL while SUGGESTED — I16a only requires a weight once CONFIRMED, and the
        // driver has no scale.
        weight: null,
        status: 'SUGGESTED',
        // `data-model.md §8`: a driver-add buckets to the run's own day, so a late
        // evening pickup reports against the run rather than against midnight.
        received_date: shift.occurrenceDate,
        note: input.note ?? null,
        created_by: actor.id,
        updated_by: actor.id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    return readOne(tx, row.id);
  });
}

// ---------------------------------------------------------------------------
// S2.3 — the receiver's record and confirm
// ---------------------------------------------------------------------------

async function requireActiveCategory(tx: Tx, categoryId: string): Promise<void> {
  const category = await tx
    .selectFrom('category')
    .select('id')
    .where('id', '=', categoryId)
    .where('deactivated_at', 'is', null)
    .executeTakeFirst();
  if (!category) throw badRequest('Pick a category that is still in use.');
}

async function requireActiveDonor(tx: Tx, donorId: string): Promise<void> {
  const donor = await tx
    .selectFrom('donor')
    .select('id')
    .where('id', '=', donorId)
    .where('deactivated_at', 'is', null)
    .executeTakeFirst();
  if (!donor) throw badRequest('Pick a store that is still in use.');
}

/**
 * Record a donation from scratch (S2.3).
 *
 * Born `CONFIRMED`, so the weight is required (I16a) — there is no receiver-authored
 * `SUGGESTED`: that status means "a driver flagged this and nobody has weighed it
 * yet" (I17), and a receiver standing at the scale is the person who weighs it.
 *
 * No `shift_id`. A receiver-authored donation is off-plan by definition and buckets
 * to the receive day (`data-model.md §8`), which is also why `received_date` is
 * computed from the pantry's own zone rather than the server's.
 */
export async function createDonation(
  actor: DonationActor,
  input: {
    donorId?: string | null;
    donorLabel?: string | null;
    categoryId: string;
    weight: string;
    reportable?: boolean;
    note?: string | null;
  },
): Promise<DonationSummary> {
  const source = resolveSource(input);
  const reportable = input.reportable ?? true; // I15 — default ON
  const weight = parseWeight(input.weight);
  requireSourceWhenReportable(source, reportable);

  return writeTransaction(async (tx) => {
    await requireActiveCategory(tx, input.categoryId);
    if (source.donorId !== null) await requireActiveDonor(tx, source.donorId);

    const { timezone } = await tx
      .selectFrom('app_config')
      .select('timezone')
      .executeTakeFirstOrThrow();

    const row = await tx
      .insertInto('unscheduled_donation')
      .values({
        shift_id: null,
        donor_id: source.donorId,
        donor_label: source.donorLabel,
        category_id: input.categoryId,
        weight,
        status: 'CONFIRMED',
        reportable,
        received_date: isoDate(localCalendarDate(new Date(), timezone)),
        note: input.note ?? null,
        created_by: actor.id,
        updated_by: actor.id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    return readOne(tx, row.id);
  });
}

/**
 * Confirm a driver-flagged row: `SUGGESTED → CONFIRMED`.
 *
 * Every field may be re-supplied because the driver's flag is a prefill, not a
 * commitment — the receiver sees the food and may correct the donor or the category
 * the driver guessed at. Only the shift stays put: it records where the food came
 * from, which the receiver is not in a position to revise.
 *
 * The transition is a conditional UPDATE on `status = 'SUGGESTED'`, so a second
 * receiver confirming the same prefill gets a refusal rather than silently
 * overwriting the first one's weight.
 */
export async function confirmDonation(
  actor: DonationActor,
  id: string,
  input: {
    weight: string;
    categoryId?: string;
    donorId?: string | null;
    donorLabel?: string | null;
    reportable?: boolean;
    note?: string | null;
  },
): Promise<DonationSummary> {
  const weight = parseWeight(input.weight);

  return writeTransaction(async (tx) => {
    const existing = await tx
      .selectFrom('unscheduled_donation')
      .select([
        'id',
        'shift_id as shiftId',
        'status',
        'donor_id as donorId',
        'donor_label as donorLabel',
        'category_id as categoryId',
        'reportable',
        'note',
      ])
      .where('id', '=', id)
      .executeTakeFirst();

    if (!existing) throw notFound('No such donation.');
    if (existing.status !== 'SUGGESTED') {
      throw conflict('That donation was already recorded.');
    }
    await requireEditable(tx, id);

    // Absent means "keep what the driver flagged"; explicit null means "clear it".
    const source = resolveSource({
      donorId: input.donorId === undefined ? existing.donorId : input.donorId,
      donorLabel: input.donorLabel === undefined ? existing.donorLabel : input.donorLabel,
    });
    const reportable = input.reportable ?? existing.reportable;
    requireSourceWhenReportable(source, reportable);

    const categoryId = input.categoryId ?? existing.categoryId;
    await requireActiveCategory(tx, categoryId);
    if (source.donorId !== null) await requireActiveDonor(tx, source.donorId);

    // I29 again: the receiver may have re-pointed this at a donor that IS on the run.
    if (source.donorId !== null && existing.shiftId !== null) {
      const onRoute = await tx
        .selectFrom('shift_stop')
        .select('id')
        .where('shift_id', '=', existing.shiftId)
        .where('donor_id', '=', source.donorId)
        .executeTakeFirst();
      if (onRoute) throw conflict(DONATION_ON_ROUTE_MESSAGE);
    }

    const updated = await tx
      .updateTable('unscheduled_donation')
      .set({
        status: 'CONFIRMED',
        weight,
        donor_id: source.donorId,
        donor_label: source.donorLabel,
        category_id: categoryId,
        reportable,
        note: input.note === undefined ? existing.note : input.note,
        updated_by: actor.id,
        updated_at: sql<Date>`now()`,
      })
      .where('id', '=', id)
      .where('status', '=', 'SUGGESTED')
      .executeTakeFirst();

    if (Number(updated.numUpdatedRows) === 0) {
      throw conflict('That donation was already recorded.');
    }

    return readOne(tx, id);
  });
}

/** The edit window, shared by confirm and the `reportable` toggle. */
async function requireEditable(tx: Tx, id: string): Promise<void> {
  const row = await tx
    .selectFrom('unscheduled_donation')
    .leftJoin('shift', 'shift.id', 'unscheduled_donation.shift_id')
    .innerJoin('app_config', (join) => join.onTrue())
    .select(
      sql<boolean>`
        coalesce(shift.starts_at, unscheduled_donation.created_at)
          + (app_config.receiver_edit_window_days * interval '1 day') > now()
      `.as('editable'),
    )
    .where('unscheduled_donation.id', '=', id)
    .executeTakeFirst();

  if (!row?.editable) throw forbidden(DONATION_WINDOW_CLOSED_MESSAGE);
}

/**
 * Flip `reportable` — a plain field edit, last write wins, stamped with who and when
 * (PRD cap 15).
 *
 * Deliberately NOT the void-and-reinsert path weights take. The flag carries no
 * weight and has no prior value worth preserving as a row, and the PRD says so in as
 * many words. The boundary it controls is the one S2.3 has to make visible: ON feeds
 * the NTFB report, OFF is counted in the pantry's own totals and never reported.
 *
 * ## Who may still flip it, and when
 *
 * `enforceWindow` is the whole of the difference between the two callers, and getting
 * it wrong makes the flag permanently uneditable rather than merely restricted:
 *
 *   - **The receiver (S2.3)** passes it `true`. Their access ends `N` days after the
 *     shift starts (`domain-modeling.md §2.3`: "receiver-editable in window, then
 *     Reporter only").
 *   - **The Reporter (S3.1)** passes it `false`. After the window closes their
 *     drill-in is the ONLY remaining way to correct the entry — PRD cap 15 and
 *     `ui-ux-spec.md` S3.1 both say so, and S3.1 names the reportable toggle in the
 *     same breath as the weight edit.
 *
 * One service rather than two so I16b is checked in exactly one place; the window is
 * the only thing the callers disagree about, so it is the only thing parameterised.
 */
export async function setReportable(
  actor: DonationActor,
  id: string,
  reportable: boolean,
  options: { enforceWindow?: boolean } = {},
): Promise<DonationSummary> {
  const enforceWindow = options.enforceWindow ?? true;

  return writeTransaction(async (tx) => {
    const existing = await tx
      .selectFrom('unscheduled_donation')
      .select(['id', 'status', 'donor_id as donorId', 'donor_label as donorLabel'])
      .where('id', '=', id)
      .executeTakeFirst();

    if (!existing) throw notFound('No such donation.');
    if (enforceWindow) await requireEditable(tx, id);

    // I16b: turning reporting ON for an anonymous row would violate the CHECK. Say
    // why instead of letting the constraint surface as a 500.
    if (existing.status === 'CONFIRMED') {
      requireSourceWhenReportable(
        { donorId: existing.donorId, donorLabel: existing.donorLabel },
        reportable,
      );
    }

    await tx
      .updateTable('unscheduled_donation')
      .set({ reportable, updated_by: actor.id, updated_at: sql<Date>`now()` })
      .where('id', '=', id)
      .execute();

    return readOne(tx, id);
  });
}

/**
 * Delete an unconfirmed prefill (S2.3 "not a real pickup").
 *
 * Hard-delete, allowed because a `SUGGESTED` row has no children and no ledger value
 * (`data-model.md §7.2`). A `CONFIRMED` row is intake and is never deleted — the
 * correction path for that is `reportable` or, in Phase 3, the Reporter's edit.
 */
export async function discardSuggestion(actor: DonationActor, id: string): Promise<void> {
  await writeTransaction(async (tx) => {
    const result = await tx
      .deleteFrom('unscheduled_donation')
      .where('id', '=', id)
      .where('status', '=', 'SUGGESTED')
      .executeTakeFirst();

    if (Number(result.numDeletedRows) === 0) {
      const exists = await tx
        .selectFrom('unscheduled_donation')
        .select('id')
        .where('id', '=', id)
        .executeTakeFirst();
      if (!exists) throw notFound('No such donation.');
      throw conflict('That donation was already recorded and cannot be removed.');
    }
    // `actor` is unused on a delete — there is no row left to stamp. Kept in the
    // signature so the route layer passes the actor uniformly and an audit trail can
    // be added here without changing every call site.
    void actor;
  });
}

// ---------------------------------------------------------------------------
// I17 — the expiry sweep's write path
// ---------------------------------------------------------------------------

/**
 * Delete `SUGGESTED` rows whose shift's edit window has expired.
 *
 * The other half of I17. Receive-done purges inline, but a shift that is never
 * received against would keep its prefills forever, so the daily sweep catches those.
 *
 * Phrased as "what is due and unhandled?" rather than "fire at time T" (`CLAUDE.md`),
 * so a missed tick self-heals on the next run instead of leaving rows stranded.
 *
 * Lives in `services/` because a job may not open a write transaction of its own
 * (`architecture.md §4.1`); `jobs/suggestion-sweep.ts` calls in here.
 */
export async function purgeExpiredSuggestions(): Promise<number> {
  return writeTransaction(async (tx) => {
    const result = await tx
      .deleteFrom('unscheduled_donation')
      .where('status', '=', 'SUGGESTED')
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('shift')
            .innerJoin('app_config', (join) => join.onTrue())
            .select('shift.id')
            .whereRef('shift.id', '=', 'unscheduled_donation.shift_id')
            // Single-argument `where`, as everywhere else a raw predicate is used
            // (`schedule.ts`): the three-argument form appends `= $1` and yields
            // `a <= b = true`, which is a syntax error rather than a tautology.
            .where(
              sql<boolean>`shift.starts_at + (app_config.receiver_edit_window_days * interval '1 day') <= now()`,
            ),
        ),
      )
      .executeTakeFirst();

    return Number(result.numDeletedRows);
  });
}
