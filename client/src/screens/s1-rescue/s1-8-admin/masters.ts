// The three master lists, as data.
//
// Donors, trucks and categories are one panel three times over, because
// `domain-modeling.md §3.3` gives all three the same single lifecycle toggle and
// the wire carries the same `active` bit for each (`shared/src/masters.ts`). What
// differs is the field list and the words; that is exactly what a config holds.
//
// Nothing here decides a domain rule. Removal is the server's answer (I21) and the
// active toggle is an ordinary field edit, which I21 always allows.

import type {
  DonorSummary,
  NtfbCategory,
  RemovalOutcome,
  TruckSummary,
} from '../../../api/shared.ts';
import {
  createCategory,
  createDonor,
  createTruck,
  donorPhotoUrl,
  fetchDonors,
  fetchTrucks,
  removeMaster,
  setDonorPhoto,
  updateCategory,
  updateDonor,
  updateTruck,
} from './api.ts';
// D40 — the matching's own requests, reached from the Categories config now that
// the two tabs are one. The `mapping/` folder keeps every RULE (`mapping.ts`);
// what moved is where its controls are drawn.
import { fetchMappings, fetchNtfbCategories, setMapping } from './mapping/api.ts';
// THE RULES, IMPORTED RATHER THAN RESTATED. `mappingRows` is the ordering (worst
// problem at the top), `mappingTargetLabel` is how a target reads with its storage
// beside it (D15's line item), `storageGapNote` is A190's "named but not blocking",
// `pickerOptions` is which food bank categories may be picked, and
// `mappingSavedText` is what the toast says. D40 moved where these are drawn; it
// moved none of them.
import {
  COPY as MAPPING_COPY,
  mappingRows,
  mappingSavedText,
  mappingTargetLabel,
  pickerOptions,
  storageGapNote,
  type MappingRow,
} from './mapping/mapping.ts';
import {
  COPY,
  nullableValue,
  percentError,
  percentFromRate,
  photoChange,
  rateFromPercent,
  trimmedValue,
  type MasterContext,
  type MasterEntity,
  type MasterFieldSpec,
  type MasterRecordView,
} from './logic.ts';

export interface MasterConfig {
  entity: MasterEntity;
  heading: string;
  /** The list's one primary action (§1 principle 1). */
  addLabel: string;
  createTitle: string;
  editTitle: string;
  loadingLabel: string;
  emptyTitle: string;
  emptyBody: string;
  fields: readonly MasterFieldSpec[];
  load: (signal: AbortSignal) => Promise<MasterRecordView[]>;
  /**
   * Anything the FIELDS need that is not a record — D40's only use is the food
   * bank's category list, which is both the `choice` options on a category's
   * editor and the reference section under the list.
   *
   * Optional, and absent on donors and trucks: a config with no choice field has
   * nothing to look up, and making every panel fetch an empty object would be a
   * request per tab switch for nothing.
   */
  loadContext?: (signal: AbortSignal) => Promise<MasterContext>;
  create: (values: Readonly<Record<string, string>>) => Promise<void>;
  /**
   * `active` is §3.3's lifecycle toggle, carried with the field edits so one
   * request cannot half-apply.
   *
   * Takes the RECORD rather than its id, since D20: a photo is not part of the
   * record's JSON, so the only way to know whether it changed is to compare what
   * was loaded with what is on screen. Passing the id alone would leave the donor
   * config guessing, and guessing means a redundant photo write on every save.
   */
  save: (
    record: MasterRecordView,
    values: Readonly<Record<string, string>>,
    active: boolean,
  ) => Promise<void>;
  remove: (id: string) => Promise<RemovalOutcome>;
  /**
   * What the toast says after a save, when "Saved." is not enough (D40).
   *
   * Categories are the only config with one, and it earns its place: a category
   * left unmatched will hold up the report while it carries weight, and that is a
   * consequence a person should hear when they choose it rather than discover on
   * the Report screen a week later. `mappingSavedText` is the sentence, and it
   * lives in `mapping/mapping.ts` with the rest of the matching's words.
   */
  savedText?: (values: Readonly<Record<string, string>>, context: MasterContext) => string;
}

// ---------------------------------------------------------------------------
// Donors — cap 2
// ---------------------------------------------------------------------------

/**
 * The pantry's own default rates, as percentages (D27, migration 0017).
 *
 * MIRRORED, NOT FETCHED, and that is a known limitation rather than a shortcut:
 * these live on the `app_config` singleton and no endpoint exposes them to the
 * browser today. They are shown so an admin can see what a blank field will
 * actually do — the alternative is a blank control that silently decides
 * something — and they are communication only. Nothing here is sent; a blank
 * field sends `null` and the SERVER applies whatever `app_config` really holds.
 * The day these become editable, this constant has to come off the wire instead.
 */
const DEFAULT_RATE_PERCENT = {
  trashRateBakery: '10',
  trashRateProduce: '5',
  trashRateDeli: '15',
} as const;

/**
 * The three rate fields (D27).
 *
 * Entered as PERCENTAGES because that is the number on the paper log and the
 * number the pantry said out loud ("10%, 10%, 15%"); stored as the decimal
 * fraction `numeric(5,4)` holds. `logic.ts` owns that conversion, including the
 * blank-versus-zero distinction, which is the part that is easy to lose.
 */
const TRASH_RATE_FIELDS: readonly MasterFieldSpec[] = (
  [
    ['trashRateBakery', 'Bakery trash rate (%)'],
    ['trashRateProduce', 'Produce trash rate (%)'],
    ['trashRateDeli', 'Deli trash rate (%)'],
  ] as const
).map(([key, label], index) => ({
  key,
  label,
  // One heading and one sentence for the group, on the first field only. Saying
  // what the rate does three times over would be the repetition D21 cut.
  ...(index === 0
    ? { section: { title: COPY.rates.sectionTitle, body: COPY.rates.sectionBody } }
    : {}),
  // A blank field decides something, so it says what: the pantry default it will
  // fall back to. An explicit 0 says the other thing, so the two never look alike.
  hintFor: (value: string) => {
    const trimmed = value.trim();
    if (trimmed === '') return `${COPY.rates.usesDefault} ${DEFAULT_RATE_PERCENT[key]}%.`;
    if (Number(trimmed) === 0 && percentError(trimmed) === null) {
      return COPY.rates.explicitZero;
    }
    return undefined;
  },
  validate: percentError,
}));

const DONOR_FIELDS: readonly MasterFieldSpec[] = [
  { key: 'name', label: 'Store name', required: true },
  { key: 'address', label: 'Address', hint: 'What the driver navigates to.' },
  {
    // D20. Optional by design: `null` means "work it out from the address", which
    // is right for almost every store. This is for the one whose address lands on
    // the shop front when the dock is round the back.
    key: 'mapUrl',
    label: 'Map link',
    hint: 'Only if the address does not land in the right place. Paste a link from your maps app.',
  },
  { key: 'contact', label: 'Contact', hint: 'A phone number, an email, or a person.' },
  {
    key: 'note',
    label: 'Permanent note',
    multiline: true,
    // Cap 11 channel 4: the admin's own per-store note, distinct from the three
    // note channels the drivers and coordinators write.
    hint: 'Shown everywhere this store appears. Dock round the back, ask for Sam.',
  },
  {
    // D20. The one non-text field in any master config, and the reason
    // `MasterFieldSpec` grew a kind rather than donors growing their own panel.
    key: 'photo',
    label: 'Photo',
    kind: 'image',
    hint: 'The door or the dock, so a driver who has never been knows they are in the right place.',
  },
  {
    // D27. Until this round the column had NO write path anywhere in the app: it
    // was printed on every receipt for the store and could only be set with
    // hand-written SQL. NTFB issues it, so blank is the normal state for a store
    // nobody has been given one for, and it stays blank rather than being guessed.
    key: 'ntfbDonorCode',
    label: 'Food bank store number',
    hint: 'North Texas Food Bank’s own number for this store. Their picker shows it as H-E-B Food Stores (810).',
  },
  ...TRASH_RATE_FIELDS,
];

/** `address` and `contact` are shown whole. They are not PII: PII in R3 is phone
 *  and address on a PERSON, and a store's address is where a driver is going
 *  (`CLAUDE.md`, `pii.ts` scope note). */
function donorView(row: DonorSummary): MasterRecordView {
  return {
    id: row.id,
    title: row.name,
    subtitle: row.address ?? row.contact,
    active: row.active,
    values: {
      name: row.name,
      address: row.address ?? '',
      mapUrl: row.mapUrl ?? '',
      contact: row.contact ?? '',
      note: row.note ?? '',
      // D20 — a REFERENCE, never the bytes. `hasPhoto` is a bit on the summary
      // precisely so a list of stores is not a list of images; the browser fetches
      // the one the admin is actually looking at.
      photo: row.hasPhoto ? donorPhotoUrl(row.id) : '',
      ntfbDonorCode: row.ntfbDonorCode ?? '',
      // D27 — `null` becomes a BLANK field, never `0`. A store with no override
      // uses the pantry default; a store with a deliberate 0 wastes nothing. The
      // two are different rows in the database and stay different on screen.
      trashRateBakery: percentFromRate(row.trashRateBakery),
      trashRateProduce: percentFromRate(row.trashRateProduce),
      trashRateDeli: percentFromRate(row.trashRateDeli),
    },
  };
}

export const DONOR_CONFIG: MasterConfig = {
  entity: 'donor',
  heading: 'Donors',
  addLabel: 'Add a store',
  createTitle: 'Add a store',
  editTitle: 'Edit store',
  loadingLabel: 'Loading stores',
  emptyTitle: 'No stores yet.',
  emptyBody: 'Add the stores runs pick up from. A run needs at least one.',
  fields: DONOR_FIELDS,
  load: async (signal) => (await fetchDonors(signal)).map(donorView),
  create: async (values) => {
    // The record first, because the photo route is keyed on an id that does not
    // exist yet. A failure on the second call leaves a donor with no photo, which
    // is a state the screen already has a control for; the reverse ordering would
    // leave bytes belonging to nothing.
    const donor = await createDonor({
      name: trimmedValue(values, 'name'),
      address: nullableValue(values, 'address'),
      mapUrl: nullableValue(values, 'mapUrl'),
      contact: nullableValue(values, 'contact'),
      note: nullableValue(values, 'note'),
      ntfbDonorCode: nullableValue(values, 'ntfbDonorCode'),
      // D27 — the percentage the admin typed, as the decimal fraction the column
      // holds. Blank sends `null`, which leaves the pantry default in force.
      trashRateBakery: rateFromPercent(values['trashRateBakery'] ?? ''),
      trashRateProduce: rateFromPercent(values['trashRateProduce'] ?? ''),
      trashRateDeli: rateFromPercent(values['trashRateDeli'] ?? ''),
    });
    const photo = photoChange('', values['photo'] ?? '');
    if (photo.kind === 'set') await setDonorPhoto(donor.id, photo.dataUrl);
  },
  save: async (record, values, active) => {
    await updateDonor(record.id, {
      name: trimmedValue(values, 'name'),
      address: nullableValue(values, 'address'),
      mapUrl: nullableValue(values, 'mapUrl'),
      contact: nullableValue(values, 'contact'),
      note: nullableValue(values, 'note'),
      ntfbDonorCode: nullableValue(values, 'ntfbDonorCode'),
      // D27 — `null` here is an EXPLICIT clear, not an omission. The PATCH
      // distinguishes absent ("leave it") from null ("back to the pantry
      // default"), and a field the admin emptied means the second.
      trashRateBakery: rateFromPercent(values['trashRateBakery'] ?? ''),
      trashRateProduce: rateFromPercent(values['trashRateProduce'] ?? ''),
      trashRateDeli: rateFromPercent(values['trashRateDeli'] ?? ''),
      active,
    });
    // D20 — a second request only when the photo actually moved. It is separate
    // from the PATCH because the bytes are a separate resource, not because the
    // two are unrelated: a donor edit that touched no photo makes one request.
    const photo = photoChange(record.values['photo'] ?? '', values['photo'] ?? '');
    if (photo.kind === 'set') await setDonorPhoto(record.id, photo.dataUrl);
    else if (photo.kind === 'clear') await setDonorPhoto(record.id, null);
  },
  remove: (id) => removeMaster('/donors', id),
};

// ---------------------------------------------------------------------------
// Trucks — cap 3
// ---------------------------------------------------------------------------

const TRUCK_FIELDS: readonly MasterFieldSpec[] = [
  { key: 'truckName', label: 'Truck name', required: true },
  { key: 'plate', label: 'Plate' },
];

function truckView(row: TruckSummary): MasterRecordView {
  return {
    id: row.id,
    title: row.truckName,
    subtitle: row.plate,
    active: row.active,
    values: { truckName: row.truckName, plate: row.plate ?? '' },
  };
}

export const TRUCK_CONFIG: MasterConfig = {
  entity: 'truck',
  heading: 'Trucks',
  addLabel: 'Add a truck',
  createTitle: 'Add a truck',
  editTitle: 'Edit truck',
  loadingLabel: 'Loading trucks',
  emptyTitle: 'No trucks yet.',
  emptyBody: 'Add one. A driver picks a truck when they start a run.',
  fields: TRUCK_FIELDS,
  load: async (signal) => (await fetchTrucks(signal)).map(truckView),
  create: async (values) => {
    await createTruck({
      truckName: trimmedValue(values, 'truckName'),
      plate: nullableValue(values, 'plate'),
    });
  },
  save: async (record, values, active) => {
    await updateTruck(record.id, {
      truckName: trimmedValue(values, 'truckName'),
      plate: nullableValue(values, 'plate'),
      active,
    });
  },
  remove: (id) => removeMaster('/trucks', id),
};

// ---------------------------------------------------------------------------
// Categories — cap 17, shipping in Phase 1 by build-plan D2
//
// Nothing consumes a category until Phase 2's weight entry, where the ACTIVE set
// renders the S2.2 keypad tiles. So this list looks inert on purpose — that is
// correct, not missing.
// ---------------------------------------------------------------------------

/**
 * The three fields of a category, and two of them arrived with D40.
 *
 * WHERE A CATEGORY REPORTS IS PART OF CONFIGURING IT. Until D40 the target and the
 * storage lived on a separate "Category matching" tab (D17), so an admin adding
 * `Frz Non Meat` filled in a name, saved, changed tab, found the same category
 * again and only then said where it reports. Two of those steps existed because
 * the controls were in two places. They are one form now.
 *
 * The pair is a Meal Connect LINE ITEM (D15): the food bank's category and the
 * storage beside it. They are saved in one request for the same reason the old
 * picker sent them together — saving separately leaves a window where the mapping
 * reads "Produce, frozen" because the old storage outlived the old category.
 */
const CATEGORY_FIELDS: readonly MasterFieldSpec[] = [
  { key: 'name', label: 'Category name', required: true },
  {
    key: 'ntfbCategoryId',
    label: COPY.mapping.targetField,
    kind: 'choice',
    // A181, said where the remapping now happens: every range is computed on read,
    // so a matching changed today changes what an already-filed week WOULD say if
    // it were filed again. `remapNotice` is that sentence, and it is the mapping
    // module's rather than a second copy of it.
    section: { title: COPY.mapping.sectionTitle, body: MAPPING_COPY.remapNotice },
    // `pickerOptions` decides this, not this file: active categories only, plus the
    // explicit "leave it unmatched". Pointing a live category at an archived bucket
    // would be the next blocked export built by hand (D12), and that rule is
    // written down once.
    options: (context: MasterContext) =>
      pickerOptions(context.ntfbCategories as readonly NtfbCategory[]).map((option) => ({
        // `''` is the explicit "none" on a string field; `null` is what it becomes
        // on the wire (`SetMappingRequest`).
        value: option.id ?? '',
        label: option.label,
      })),
  },
  {
    key: 'storage',
    label: MAPPING_COPY.storageField,
    hint: MAPPING_COPY.storageHint,
  },
];

/**
 * One category row, built from the MATCHING list rather than from the category
 * list.
 *
 * `listMappings()` returns every category with its name, its active flag and where
 * it reports, so it is a strictly larger answer than `listCategories()` and one
 * request instead of two. `mappingRows` is what turns it into rows, in the order
 * it has always ordered them: unmatched first, because those are the ones holding
 * a report up.
 */
function categoryView(row: MappingRow): MasterRecordView {
  return {
    id: row.categoryId,
    title: row.categoryName,
    // Where it reports, on the row itself: the whole point of the merge is that an
    // admin can see the matching without opening anything. `mappingTargetLabel`
    // pairs the category with its storage because together they are one Meal
    // Connect line item (D15); `storageGapNote` names a missing storage, which
    // A190 says is worth saying and does not block the report.
    subtitle: [mappingTargetLabel(row), storageGapNote(row)].filter((part) => part !== null).join(', '),
    active: !row.archived,
    values: {
      name: row.categoryName,
      // `''` is the explicit "not matched", which keeps this a plain string field
      // like every other one. `null` on the wire is what it becomes.
      ntfbCategoryId: row.ntfbCategoryId ?? '',
      storage: row.storage ?? '',
    },
  };
}

/** The target and the storage, as `setMapping` takes them. `''` is an explicit
 *  clear, which also clears the storage — a line item with no category is not one
 *  (`services/report.ts`). */
function mappingFrom(values: Readonly<Record<string, string>>) {
  const target = (values['ntfbCategoryId'] ?? '').trim();
  return {
    ntfbCategoryId: target === '' ? null : target,
    storage: nullableValue(values, 'storage'),
  };
}

export const CATEGORY_CONFIG: MasterConfig = {
  entity: 'category',
  heading: 'Categories',
  addLabel: 'Add a category',
  createTitle: 'Add a category',
  editTitle: 'Edit category',
  loadingLabel: 'Loading categories',
  emptyTitle: 'No categories yet.',
  emptyBody: 'These are what weights get counted under. Add the first one.',
  fields: CATEGORY_FIELDS,
  // `mappingRows` with no blocking list: Admin has no report on screen to be held
  // up, so nothing sorts to the very top for that reason. Unmatched categories
  // still lead, which is the ordering an admin came here to act on.
  load: async (signal) => mappingRows(await fetchMappings(signal), []).map(categoryView),
  loadContext: async (signal) => ({ ntfbCategories: await fetchNtfbCategories(signal) }),
  savedText: (values, context) => {
    const target = (values['ntfbCategoryId'] ?? '').trim();
    const named = context.ntfbCategories.find((category) => category.id === target);
    return mappingSavedText(trimmedValue(values, 'name'), named?.name ?? null);
  },
  create: async (values) => {
    // The category first: `setMapping` is keyed on an id that does not exist yet.
    // A failure on the second call leaves an unmatched category, which is a state
    // the screen already has a control for and the export already refuses on
    // (D12); the reverse ordering would point a mapping at nothing.
    const category = await createCategory({ name: trimmedValue(values, 'name') });
    const mapping = mappingFrom(values);
    if (mapping.ntfbCategoryId !== null) await setMapping(category.id, mapping);
  },
  save: async (record, values, active) => {
    await updateCategory(record.id, { name: trimmedValue(values, 'name'), active });
    const mapping = mappingFrom(values);
    const unchanged =
      (record.values['ntfbCategoryId'] ?? '') === (mapping.ntfbCategoryId ?? '') &&
      (record.values['storage'] ?? '') === (mapping.storage ?? '');
    // A second request only when the matching actually moved. A181 is why this is
    // worth checking rather than always writing: a remap re-reports history, and a
    // write that changes nothing still counts as one on any audit that ever reads
    // this table.
    if (!unchanged) await setMapping(record.id, mapping);
  },
  remove: (id) => removeMaster('/categories', id),
};

/** Exported for the test that holds every field label and empty state to §7. */
export const MASTER_CONFIGS: readonly MasterConfig[] = [
  DONOR_CONFIG,
  TRUCK_CONFIG,
  CATEGORY_CONFIG,
];
