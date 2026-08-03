// Donor master data — `product-requirement.md` cap 2, `ui-ux-spec.md S1.8` (Donors
// tab). Admin maintains the permanent stores the pantry collects from.
//
// `address` and `contact` are operational: the address is where the driver drives
// and the contact is who they call when the loading dock is locked. They are NOT
// PII in this system's sense (phone/address on `app_user`) and are never shaped
// out — see the scope note in `pii.ts`.

import type { Selectable, SelectQueryBuilder } from 'kysely';
import type { RemovalOutcome } from '../../../shared/src/masters.js';
import { db } from '../db/index.js';
import { writeTransaction, type Tx } from '../db/transaction.js';
import type { DB, Donor } from '../db/types.js';
import { badRequest, conflict, notFound } from '../middleware/error.js';

/**
 * A donor as every reader wants it: the row, plus whether a photo exists.
 *
 * `has_photo` is a flag and never the bytes (D20). The photo lives in its own
 * table precisely so that the board, the route builder, the admin list and the
 * report never carry images; selecting it here would undo that in one line.
 */
export type DonorRecord = Selectable<Donor> & { has_photo: boolean };

/** D27 — the three rates a store may override, keyed the way `category.trash_rate_key`
 *  spells them so the two cannot drift into different vocabularies. */
interface TrashRateInput {
  /** A decimal fraction, 0..1 — `'0.1'` is 10%. `null` clears the override and returns
   *  the store to the pantry default in `app_config`. */
  trashRateBakery?: string | null;
  trashRateProduce?: string | null;
  trashRateDeli?: string | null;
}

export interface CreateDonorInput extends TrashRateInput {
  name: string;
  address?: string | null;
  contact?: string | null;
  note?: string | null;
  /** D20 — an explicit map link. `null` means "derive one from the address". */
  mapUrl?: string | null;
  /** NTFB's number for this store (migration 0013). This is its FIRST write path:
   *  the column has been exported on the report since Phase 3 and could until now only
   *  be populated with hand-written SQL. */
  ntfbDonorCode?: string | null;
}

export interface UpdateDonorInput extends TrashRateInput {
  name?: string;
  address?: string | null;
  contact?: string | null;
  note?: string | null;
  mapUrl?: string | null;
  ntfbDonorCode?: string | null;
  /** `domain-modeling.md §3.3` ACTIVE ⇄ DEACTIVATED. */
  active?: boolean;
}

/** A display name that is only whitespace is not a name. `name` is NOT NULL at the
 *  database and carries no format rule beyond that, so this is the whole check. */
function cleanName(value: string): string {
  const name = value.trim();
  if (name === '') throw badRequest('A donor name is required.');
  return name;
}

/** Optional free text: absent and blank both mean "nothing on file", which the
 *  column spells `NULL`. */
function cleanText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const text = value.trim();
  return text === '' ? null : text;
}

/** SQLSTATE 23503 — foreign_key_violation. */
function isForeignKeyViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === '23503'
  );
}

/** SQLSTATE 23505 — unique_violation. Here it can only be `uq_donor_ntfb_code`: no
 *  other unique index on `donor` exists, and two stores are allowed to share a name. */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === '23505'
  );
}

/** What the admin sees when a rate is out of range. `ck_donor_trash_rates` refuses it
 *  either way (`architecture.md §4.1` tier 1); this only decides what they read. */
const TRASH_RATE_RANGE_MESSAGE =
  'A trash rate has to be between 0 and 1 — 0.1 means 10%.';

/**
 * D27 — a per-store trash rate, or `null` for "use the pantry default".
 *
 * A string in and a string out: the column is `numeric(5,4)` and routing it through a
 * JavaScript number would round-trip a decimal through binary floating point on the way
 * to a column whose whole purpose is exact arithmetic. `Number()` is used to CHECK the
 * value and never to carry it.
 *
 * Blank is `null`, matching `cleanText`: an emptied field on the admin form means the
 * store went back to the default, not that its rate is zero. Those differ — zero
 * deducts nothing, which is a real and different answer.
 */
function cleanRate(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const text = value.trim();
  if (text === '') return null;

  const parsed = Number(text);
  if (!Number.isFinite(parsed)) throw badRequest(TRASH_RATE_RANGE_MESSAGE);
  if (parsed < 0 || parsed > 1) throw badRequest(TRASH_RATE_RANGE_MESSAGE);
  return text;
}

// ---------------------------------------------------------------------------
// Reads. No transaction: `architecture.md §4.1` puts every WRITE through
// `writeTransaction`, and a single-statement read needs no isolation of its own.
// ---------------------------------------------------------------------------

export interface ListDonorsOptions {
  /** The S1.8 admin list wants the deactivated ones too, so it can restore one.
   *  Every other reader is a picker and wants the active set (`data-model.md §0`). */
  includeInactive?: boolean;
}

/** `has_photo` as a correlated EXISTS, so a donor read is still one round trip and
 *  still never touches `donor_photo.bytes` (D20). */
function withPhotoFlag(qb: SelectQueryBuilder<DB, 'donor', object>) {
  return qb.selectAll('donor').select((eb) =>
    eb
      .exists(
        eb
          .selectFrom('donor_photo')
          .select('donor_photo.donor_id')
          .whereRef('donor_photo.donor_id', '=', 'donor.id'),
      )
      .as('has_photo'),
  );
}

/** Kysely types `exists()` as `SqlBool` — `boolean | number` — because SQLite has
 *  no boolean. Postgres returns a real one, so this narrows at the read boundary
 *  rather than letting `number` leak into the service's public type. */
function narrowPhotoFlag<T extends { has_photo: boolean | number }>(
  row: T,
): T & { has_photo: boolean } {
  return { ...row, has_photo: Boolean(row.has_photo) };
}

export async function listDonors(
  options: ListDonorsOptions = {},
): Promise<DonorRecord[]> {
  let query = withPhotoFlag(db.selectFrom('donor')).orderBy('name');
  if (options.includeInactive !== true) {
    // I21 — active reads filter on the soft-delete predicate; `ix_donor_active`
    // is the partial index for exactly this (`data-model.md §12`).
    query = query.where('deactivated_at', 'is', null);
  }
  return (await query.execute()).map(narrowPhotoFlag);
}

export async function getDonor(donorId: string): Promise<DonorRecord | undefined> {
  const row = await withPhotoFlag(db.selectFrom('donor'))
    .where('id', '=', donorId)
    .executeTakeFirst();
  return row === undefined ? undefined : narrowPhotoFlag(row);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createDonor(input: CreateDonorInput): Promise<DonorRecord> {
  const name = cleanName(input.name);
  // Parsed BEFORE the transaction opens, for the same reason `decodePhoto` is: it is
  // pure validation, and `writeTransaction` may run its callback more than once.
  const rates = {
    trash_rate_bakery: cleanRate(input.trashRateBakery),
    trash_rate_produce: cleanRate(input.trashRateProduce),
    trash_rate_deli: cleanRate(input.trashRateDeli),
  };

  return writeTransaction(async (tx) => {
    try {
      const row = await tx
        .insertInto('donor')
        .values({
          name,
          address: cleanText(input.address),
          contact: cleanText(input.contact),
          note: cleanText(input.note),
          map_url: cleanText(input.mapUrl),
          ntfb_donor_code: cleanText(input.ntfbDonorCode),
          ...rates,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      // A donor that was created a statement ago cannot have a photo. Stated
      // rather than re-queried.
      return { ...row, has_photo: false };
    } catch (err) {
      throw asDonorCodeConflict(err);
    }
  });
}

/** `uq_donor_ntfb_code` (0013) as a sentence. Two stores sharing one NTFB number is a
 *  data-entry mistake, and the admin is the one who can fix it — a 500 with a
 *  correlation id is not. Anything else is rethrown untouched. */
function asDonorCodeConflict(err: unknown): unknown {
  if (isUniqueViolation(err)) {
    return conflict('Another store already uses that food bank number.');
  }
  return err;
}

/**
 * I21 — field edits are always allowed; soft-delete governs removal only. A
 * deactivated donor can still be renamed or have its note corrected, and that is
 * deliberate: the row is still referenced by history that renders through a live
 * FK (`domain-modeling.md §2.3`, ShiftStop keeps a live Donor FK).
 *
 * `active` is the one field here that is not an ordinary edit — it is §3.3's
 * single lifecycle toggle, stored as the one physical bit `deactivated_at`.
 */
export async function updateDonor(
  donorId: string,
  patch: UpdateDonorInput,
): Promise<DonorRecord> {
  const values: {
    name?: string;
    address?: string | null;
    contact?: string | null;
    note?: string | null;
    map_url?: string | null;
    ntfb_donor_code?: string | null;
    trash_rate_bakery?: string | null;
    trash_rate_produce?: string | null;
    trash_rate_deli?: string | null;
    deactivated_at?: Date | null;
  } = {};

  if (patch.name !== undefined) values.name = cleanName(patch.name);
  if (patch.address !== undefined) values.address = cleanText(patch.address);
  if (patch.contact !== undefined) values.contact = cleanText(patch.contact);
  if (patch.note !== undefined) values.note = cleanText(patch.note);
  if (patch.mapUrl !== undefined) values.map_url = cleanText(patch.mapUrl);
  if (patch.ntfbDonorCode !== undefined) {
    values.ntfb_donor_code = cleanText(patch.ntfbDonorCode);
  }
  // D27 — absent means "leave it", explicit null means "back to the pantry default".
  // `cleanRate` collapses blank to null, so an emptied form field clears the override.
  if (patch.trashRateBakery !== undefined) {
    values.trash_rate_bakery = cleanRate(patch.trashRateBakery);
  }
  if (patch.trashRateProduce !== undefined) {
    values.trash_rate_produce = cleanRate(patch.trashRateProduce);
  }
  if (patch.trashRateDeli !== undefined) {
    values.trash_rate_deli = cleanRate(patch.trashRateDeli);
  }

  return writeTransaction(async (tx) => {
    const current = await tx
      .selectFrom('donor')
      .select(['id', 'deactivated_at'])
      .where('id', '=', donorId)
      .executeTakeFirst();
    if (!current) throw notFound('No such donor.');

    if (patch.active !== undefined) {
      // Toggling to the state it already holds must not restamp the instant —
      // "deactivated since" is information the admin screen shows.
      if (patch.active) values.deactivated_at = null;
      else values.deactivated_at = current.deactivated_at ?? new Date();
    }

    if (Object.keys(values).length === 0) throw badRequest('Nothing to change.');

    let row;
    try {
      row = await tx
        .updateTable('donor')
        .set(values)
        .where('id', '=', donorId)
        .returningAll()
        .executeTakeFirstOrThrow();
    } catch (err) {
      throw asDonorCodeConflict(err);
    }

    // The photo is not among the editable fields, so this reads the flag rather
    // than assuming it. Same transaction, so it cannot see a half-applied state.
    const photo = await tx
      .selectFrom('donor_photo')
      .select('donor_id')
      .where('donor_id', '=', donorId)
      .executeTakeFirst();

    return { ...row, has_photo: photo !== undefined };
  });
}

// ---------------------------------------------------------------------------
// The store photo (D20)
// ---------------------------------------------------------------------------

/** What the photo endpoint streams. Bytes and mime travel together: a browser
 *  cannot render one without the other. */
export interface DonorPhotoRecord {
  bytes: Buffer;
  mime: string;
  updatedAt: Date;
}

/** The two `donor_photo.mime`'s CHECK admits (migration 0014). Restated here so a
 *  wrong file is a sentence the admin can act on rather than a 23514 that reaches
 *  `errorHandler` as a 500. The CHECK is still the guard that cannot be bypassed
 *  (`architecture.md §4.1` tier 1); this only decides what the person reads. */
const PHOTO_MIME_TYPES: readonly string[] = ['image/jpeg', 'image/png'];

/** `donor_photo_size`'s upper bound, restated for the same reason. */
const MAX_PHOTO_BYTES = 400_000;

/** `data:<mime>;base64,<payload>` and nothing else. A data URL is how the photo
 *  arrives (`masters.ts` `SetDonorPhotoRequest`): multipart would need a parsing
 *  dependency, which no lane may add (D5). */
const PHOTO_DATA_URL = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([a-z0-9+/\s]+={0,2})$/i;

/**
 * A data URL as bytes, or a refusal a driver's admin can act on.
 *
 * Every check here has a CHECK constraint behind it. This exists for the message,
 * not for the correctness — the same rule is enforced again one layer down, which
 * is the point of §4.1's tiers.
 */
function decodePhoto(dataUrl: string): { bytes: Buffer; mime: string } {
  const match = PHOTO_DATA_URL.exec(dataUrl.trim());
  if (!match) {
    throw badRequest('That does not look like a photo. Choose an image and try again.');
  }

  const mime = match[1]!.toLowerCase();
  if (!PHOTO_MIME_TYPES.includes(mime)) {
    throw badRequest('A store photo has to be a JPEG or a PNG.');
  }

  const bytes = Buffer.from(match[2]!, 'base64');
  if (bytes.length === 0) {
    throw badRequest('That photo is empty. Choose an image and try again.');
  }
  if (bytes.length > MAX_PHOTO_BYTES) {
    throw badRequest('That photo is too big. It has to be under 400 KB.');
  }

  return { bytes, mime };
}

/** The bytes, on their own endpoint. Nothing else in this file selects them (D20):
 *  the flag `has_photo` is what every list carries. */
export async function getDonorPhoto(
  donorId: string,
): Promise<DonorPhotoRecord | undefined> {
  const row = await db
    .selectFrom('donor_photo')
    .select(['bytes', 'mime', 'updated_at'])
    .where('donor_id', '=', donorId)
    .executeTakeFirst();
  if (row === undefined) return undefined;
  return { bytes: row.bytes, mime: row.mime, updatedAt: row.updated_at };
}

/**
 * Set or clear the photo. `null` clears it.
 *
 * Returns the donor, so the caller's `hasPhoto` is right without a second read.
 */
export async function setDonorPhoto(
  donorId: string,
  dataUrl: string | null,
): Promise<DonorRecord> {
  // Decoded BEFORE the transaction opens. It is pure CPU on a request-sized
  // string, and `writeTransaction` may run its callback more than once (40001
  // retry) — there is no reason to redo it inside every attempt.
  const photo = dataUrl === null ? null : decodePhoto(dataUrl);

  return writeTransaction(async (tx) => {
    const donor = await tx
      .selectFrom('donor')
      .selectAll()
      .where('id', '=', donorId)
      .executeTakeFirst();
    if (!donor) throw notFound('No such donor.');

    if (photo === null) {
      await tx.deleteFrom('donor_photo').where('donor_id', '=', donorId).execute();
      return { ...donor, has_photo: false };
    }

    // One photo per store: `donor_id` is the PRIMARY KEY, so replacing is an
    // UPSERT and there is no way to accumulate versions of the same door.
    // `updated_at` is written explicitly because its DEFAULT fires on insert only.
    await tx
      .insertInto('donor_photo')
      .values({ donor_id: donorId, bytes: photo.bytes, mime: photo.mime })
      .onConflict((oc) =>
        oc.column('donor_id').doUpdateSet({
          bytes: photo.bytes,
          mime: photo.mime,
          updated_at: new Date(),
        }),
      )
      .execute();

    return { ...donor, has_photo: true };
  });
}

/**
 * I21 — "has referencing history" for a Donor.
 *
 * ONE function, deliberately (build-plan D3), and Phase 2 is where that decision paid
 * off: `weight_entry.donor_id` and `unscheduled_donation.donor_id` (`data-model.md
 * §7`) arrived, and extending this predicate was the two probes below rather than a
 * hunt through call sites. Nothing else in the codebase may ask this question a
 * second way.
 *
 * Advisory only. The real guard is the blanket `ON DELETE RESTRICT` on every FK
 * (`data-model.md §0`): the DELETE below succeeds iff zero rows reference the row.
 * This picks the branch and produces the friendly outcome; it is not correctness.
 */
export async function donorHasHistory(tx: Tx, donorId: string): Promise<boolean> {
  const routeStop = await tx
    .selectFrom('route_stop')
    .select('id')
    .where('donor_id', '=', donorId)
    .executeTakeFirst();
  if (routeStop) return true;

  const shiftStop = await tx
    .selectFrom('shift_stop')
    .select('id')
    .where('donor_id', '=', donorId)
    .executeTakeFirst();
  if (shiftStop) return true;

  // Phase 2 (§7). Voided weights count: a voided row is retained for audit and is
  // still a reference, so hard-deleting the donor it credits would take the audit
  // trail with it — which is the one thing voiding exists to keep.
  const weight = await tx
    .selectFrom('weight_entry')
    .select('id')
    .where('donor_id', '=', donorId)
    .executeTakeFirst();
  if (weight) return true;

  const donation = await tx
    .selectFrom('unscheduled_donation')
    .select('id')
    .where('donor_id', '=', donorId)
    .executeTakeFirst();
  return donation !== undefined;
}

/**
 * I21 — soft-delete when the donor has referencing history, hard-delete when it has
 * none (the escape hatch for a mistaken create). The caller does not choose which.
 */
export async function removeDonor(donorId: string): Promise<RemovalOutcome> {
  return writeTransaction(async (tx) => {
    const donor = await tx
      .selectFrom('donor')
      .select(['id', 'deactivated_at'])
      .where('id', '=', donorId)
      .executeTakeFirst();
    if (!donor) throw notFound('No such donor.');

    if (await donorHasHistory(tx, donorId)) {
      await tx
        .updateTable('donor')
        .set({ deactivated_at: donor.deactivated_at ?? new Date() })
        .where('id', '=', donorId)
        .execute();
      return 'DEACTIVATED';
    }

    try {
      // A photo is not history, so it does not make a donor undeletable — but its
      // FK is `ON DELETE RESTRICT` like every other one in the schema
      // (`data-model.md §0`, migration 0014), so it has to go first and inside
      // this transaction. `donorHasHistory` deliberately does NOT probe for it:
      // that predicate answers "would deleting this lose something", and a
      // photograph of a loading dock is not something history needs back.
      await tx.deleteFrom('donor_photo').where('donor_id', '=', donorId).execute();
      await tx.deleteFrom('donor').where('id', '=', donorId).execute();
    } catch (err) {
      // A writer that created history between the predicate and the DELETE is
      // normally caught by SERIALIZABLE and re-run (`db/transaction.ts`). This
      // turns the residual case into the 409 it is, rather than a 500 with a
      // correlation id pointing at a race nobody can act on.
      if (isForeignKeyViolation(err)) {
        throw conflict('That donor is now used by a run. Open it again and retry.');
      }
      throw err;
    }
    return 'DELETED';
  });
}
