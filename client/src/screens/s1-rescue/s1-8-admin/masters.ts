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
  CategorySummary,
  DonorSummary,
  RemovalOutcome,
  TruckSummary,
} from '../../../api/shared.ts';
import {
  createCategory,
  createDonor,
  createTruck,
  donorPhotoUrl,
  fetchCategories,
  fetchDonors,
  fetchTrucks,
  removeMaster,
  setDonorPhoto,
  updateCategory,
  updateDonor,
  updateTruck,
} from './api.ts';
import {
  nullableValue,
  photoChange,
  trimmedValue,
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
}

// ---------------------------------------------------------------------------
// Donors — cap 2
// ---------------------------------------------------------------------------

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

const CATEGORY_FIELDS: readonly MasterFieldSpec[] = [
  { key: 'name', label: 'Category name', required: true },
];

function categoryView(row: CategorySummary): MasterRecordView {
  return {
    id: row.id,
    title: row.name,
    subtitle: null,
    active: row.active,
    values: { name: row.name },
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
  load: async (signal) => (await fetchCategories(signal)).map(categoryView),
  create: async (values) => {
    await createCategory({ name: trimmedValue(values, 'name') });
  },
  save: async (record, values, active) => {
    await updateCategory(record.id, { name: trimmedValue(values, 'name'), active });
  },
  remove: (id) => removeMaster('/categories', id),
};

/** Exported for the test that holds every field label and empty state to §7. */
export const MASTER_CONFIGS: readonly MasterConfig[] = [
  DONOR_CONFIG,
  TRUCK_CONFIG,
  CATEGORY_CONFIG,
];
