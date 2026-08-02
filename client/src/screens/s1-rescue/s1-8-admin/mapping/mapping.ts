// The AGFP→NTFB matching: every decision the editor makes, as a function of plain
// records, plus every sentence it says.
//
// WHY THIS FOLDER IS UNDER S1.8 AND NOT S3.1 (D17, overriding D11).
//
// D11 put the matching on the Report screen: it is where the mapping's effect is
// visible, and a Reporter who hits an unmapped category mid-report could fix it
// without changing screens *or* tiers. D11 also said, in as many words, that its
// location was "still the human's to override — moving it to S1.8 is a route-access
// change and a screen move, not a data change", and `ui-ux-spec.md §8`'s own open
// assumption 3 offered "the Report screen (or Admin)" as the choice to make. The
// pantry chose Admin. So this is not a lane overturning a settled decision: it is the
// override D11 was written to allow, and the whole of it is a folder, a copy module
// and one `access` declaration.
//
// What it costs, said out loud rather than discovered: a Reporter blocked by an
// unmapped category can no longer clear the block themselves. S3.1 now points at an
// admin instead of at a second tab. That is the trade the pantry made — the matching
// is master data, it sits beside the other master data, and the people who maintain
// master data are admins.
//
// WHY THE FOOD BANK CATEGORY LIST STARTS EMPTY (D12). Those names are North Texas
// Food Bank's, they appear in no foundation doc, and migration 0012 seeds nothing
// rather than guessing. Inventing them would put fabricated values in the one column
// that decides what the pantry reports, and every gate in this repo would pass while
// it did.
//
// EVERYTHING HERE IS COMMUNICATION ONLY. `services/report.ts` owns the rules — which
// categories block an export, what I21 does to a removal — and re-checks all of them.

import { toApiError } from '../../../../api/index.ts';
import type {
  CategoryMapping,
  NtfbCategory,
  RemovalOutcome,
  UnmappedCategory,
} from '../../../../api/shared.ts';

// ---------------------------------------------------------------------------
// Weights — display only (A165)
// ---------------------------------------------------------------------------

/**
 * A weight as a person reads it: `"293.00"` → `"293"`, `"12.50"` → `"12.5"`.
 *
 * The same rule S3.1 renders weights by, kept here rather than imported so this
 * folder has no cross-screen dependency (no screen in this repo imports another).
 * Only the *display* rule is duplicated: nothing here adds weights up, so none of
 * the integer-cent arithmetic A165 exists to protect came with it.
 */
export function formatWeight(value: string): string {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return trimmed;

  const [whole = '0', fraction] = trimmed.split('.');
  const lead = whole.replace(/^0+(?=\d)/, '');
  if (fraction === undefined) return lead;

  const kept = fraction.replace(/0+$/, '');
  return kept === '' ? lead : `${lead}.${kept}`;
}

/** §7: "Units always shown ('lb')." */
export function weightWithUnit(value: string): string {
  return `${formatWeight(value)} ${COPY.unit}`;
}

// ---------------------------------------------------------------------------
// The matching rows
// ---------------------------------------------------------------------------

export interface MappingRow {
  categoryId: string;
  categoryName: string;
  /** The NTFB category it reports under, or null while unmatched. */
  ntfbCategoryId: string | null;
  ntfbCategoryName: string | null;
  /** The Storage value that goes beside the category on a Meal Connect line item:
   *  `Frozen`, `Dry`, `Refrigeration` on the receipt we have. Null is a gap worth
   *  naming but not a blocker (A190) — the weight still lands in the right
   *  category, and only one of the form's four fields is left blank. */
  storage: string | null;
  /** The AGFP category itself is archived (§3.3). Still shown: archived categories
   *  keep resolving in history and reports. */
  archived: boolean;
  /** Non-null when this category carries weight in a week with nowhere to report
   *  it — the row that is blocking an export. Always null when the editor is
   *  opened from Admin, which has no week on screen to be blocked. */
  blockingWeight: string | null;
}

/**
 * The matching list, ordered so the worst problem is at the top.
 *
 * Categories actually holding a week up come first, then the rest of the unmatched
 * ones, then the matched. Alphabetical order instead would bury the two rows worth
 * fixing somewhere in the middle of eleven.
 */
export function mappingRows(
  mappings: readonly CategoryMapping[],
  unmapped: readonly UnmappedCategory[],
): MappingRow[] {
  const blocking = new Map(unmapped.map((row) => [row.categoryId, row.total]));

  const rows: MappingRow[] = mappings.map((mapping) => ({
    categoryId: mapping.categoryId,
    categoryName: mapping.categoryName,
    ntfbCategoryId: mapping.ntfbCategoryId,
    ntfbCategoryName: mapping.ntfbCategoryName,
    storage: mapping.storage,
    archived: !mapping.categoryActive,
    blockingWeight: blocking.get(mapping.categoryId) ?? null,
  }));

  const rank = (row: MappingRow): number => {
    if (row.blockingWeight !== null) return 0;
    if (row.ntfbCategoryId === null) return 1;
    return 2;
  };

  return rows.sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    return a.categoryName.localeCompare(b.categoryName);
  });
}

/**
 * What a matching row says on its right-hand side.
 *
 * Category and storage together, because together they are one Meal Connect line
 * item (D15). "Produce · Refrigeration" is what the Reporter will actually type,
 * and showing only half of it hides half the mapping.
 */
export function mappingTargetLabel(row: MappingRow): string {
  if (row.ntfbCategoryName === null) return COPY.notMatched;
  if (row.storage === null || row.storage === '') return row.ntfbCategoryName;
  return `${row.ntfbCategoryName} · ${row.storage}`;
}

/** Named on the row rather than left to be discovered at the far end: a mapped
 *  category with no storage still exports (A190), but leaves the Reporter guessing
 *  at one of the four fields the form asks for. */
export function storageGapNote(row: MappingRow): string | null {
  if (row.ntfbCategoryId === null) return null;
  return row.storage === null || row.storage === '' ? COPY.storageMissing : null;
}

/** The picker's options: the food bank categories still in use, by name, plus the
 *  explicit "leave it unmatched". Archived ones are left out — pointing a live
 *  category at an archived bucket would build the next unmapped block by hand. */
export function pickerOptions(
  categories: readonly NtfbCategory[],
): { id: string | null; label: string }[] {
  const active = categories
    .filter((category) => category.active)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((category) => ({ id: category.id as string | null, label: ntfbLabel(category) }));
  return [...active, { id: null, label: COPY.leaveUnmatched }];
}

/** "Produce (14)" — the code shown beside the name when Meal Connect has one.
 *  Null stays absent rather than printing "null" or a guessed code (D13).
 *  S3.1 names its report lines by the same rule; see `reportLineTitle` there. */
export function ntfbLabel(category: Pick<NtfbCategory, 'name' | 'code'>): string {
  return category.code === null || category.code === ''
    ? category.name
    : `${category.name} (${category.code})`;
}

/** How many AGFP categories report under one food bank category — the I21
 *  delete/archive hint, said as a sentence rather than a bare count. */
export function mappedCountLabel(category: NtfbCategory): string {
  if (category.mappedCount === 0) return COPY.nothingMapped;
  if (category.mappedCount === 1) return COPY.oneMapped;
  return `${category.mappedCount} ${COPY.manyMapped}`;
}

/** In-use categories first, archived ones after, each alphabetical. Archived stay
 *  visible so one archived by mistake can be put back (§3.3's reverse arrow). */
export function sortNtfbCategories(categories: readonly NtfbCategory[]): NtfbCategory[] {
  return categories.slice().sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/** Required, and nothing else. A duplicate-name rule is not written down anywhere,
 *  and inventing one here would refuse a name the server accepts. */
export function ntfbNameError(raw: string, attempted: boolean): string | null {
  if (!attempted) return null;
  return raw.trim() === '' ? COPY.ntfbNameRequired : null;
}

/** An empty optional field is *absent*, not `""` — `ntfb_category.code` and
 *  `category.ntfb_storage` are both nullable exactly so an unknown stays unknown
 *  rather than becoming an empty string that reads as an answer (D13). */
export function normalizeOptional(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/** I21's answer, reported rather than predicted: the domain decides whether a
 *  removal archived or destroyed, and this says which happened. */
export function ntfbRemovalText(name: string, outcome: RemovalOutcome): string {
  return outcome === 'DELETED'
    ? `${name} is gone. Nothing reported under it.`
    : `${name} is archived. Past reports still resolve it.`;
}

/** What the toast says once a category is pointed somewhere (or nowhere). */
export function mappingSavedText(categoryName: string, ntfbName: string | null): string {
  return ntfbName === null
    ? `${categoryName} is not matched to anything. It will hold up the export while it carries weight.`
    : `${categoryName} reports under ${ntfbName}.`;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** The server's own sentence when it sent one, otherwise the plain per-kind
 *  message. Never a code, never the correlation identifier (§6). */
export function messageFor(error: unknown): string {
  const apiError = toApiError(error);
  return apiError.detail ?? apiError.message;
}

// ---------------------------------------------------------------------------
// Copy (§7: plain, short, second person; no jargon, and no em dashes — D21)
// ---------------------------------------------------------------------------

/** Forbidden in any UI string (`ui-ux-spec.md §7`). Pinned by a test rather than
 *  by good intentions. Each screen module carries its own copy of the list, which
 *  is the convention every other screen here already follows. */
export const FORBIDDEN_IN_COPY = [
  'pwa',
  'push subscription',
  'session',
  'payload',
  'endpoint',
  'atomic',
  'instance',
] as const;

export const COPY = {
  unit: 'lb',

  // --- our categories, and where each one reports --------------------------
  mappingHeading: 'Which food bank category does each of ours report under?',
  mappingIntro:
    'Our categories are on the left. Point each one at the North Texas Food Bank category it belongs to, and say which storage it goes under. Two of ours can share one of theirs, under different storage if that is what they are.',
  mappingLabel: 'Our categories',
  mappingEmptyTitle: 'No categories of our own yet.',
  /** Was a cross-screen pointer written from the Report screen ("an admin adds ours
   *  under Admin → Categories"). Both halves live in Admin now, so it points at the
   *  panel beside this one instead of at another screen and another tier. */
  mappingEmptyBody: 'Add ours on the Categories tab first. Nothing can be reported until they are there.',
  notMatched: 'Not matched yet',
  archivedCategory: 'Archived',
  blockingTail: 'this week, with nowhere to report it',
  pickerLabel: 'Report this under',
  pickerCurrent: 'Chosen now',
  leaveUnmatched: 'Leave it unmatched',
  back: 'Back',

  /** Storage is the other half of a Meal Connect line item (D15), so it is chosen in
   *  the same breath as the category rather than on a screen of its own. Free text
   *  and three examples, not a fixed list: those three are what one receipt showed,
   *  and the pantry's form is the authority on the rest (migration 0013). */
  storageField: 'Storage (optional)',
  storageHint:
    'The Storage the food bank’s form asks for beside the category, usually Frozen, Dry or Refrigeration. Copy their wording.',
  storageMissing: 'No storage set',

  /** A181, said out loud where the remapping happens. Every week is computed on
   *  read, so a mapping changed today changes what an already-exported week *would*
   *  say if exported again. That is correct — a mapping states what a category is,
   *  not what it was — but it is not obvious, and the person it surprises is the
   *  Reporter, who is no longer the person making the change. */
  remapNotice:
    'Matching applies to every week, not just this one. A week someone already exported would come out differently if they exported it again.',

  // --- the food bank's own list --------------------------------------------
  ntfbHeading: 'North Texas Food Bank categories',
  ntfbIntro:
    'These are the food bank’s own names, so R3 ships without them. Nobody here can invent them without getting the report wrong. Add the ones on your submission form.',
  ntfbLabel: 'Food bank categories',
  ntfbEmptyTitle: 'No food bank categories yet.',
  ntfbEmptyBody:
    'Add the categories from your North Texas Food Bank submission form. Nothing can be reported until at least one is here.',
  ntfbLoading: 'Loading the categories',
  addNtfb: 'Add a category',
  createNtfbTitle: 'Add a food bank category',
  editNtfbTitle: 'Edit food bank category',
  ntfbNameField: 'Category name',
  ntfbNameHint: 'Exactly as the food bank writes it.',
  ntfbCodeField: 'Code (optional)',
  ntfbCodeHint: 'Only if your submission form uses a code. Leave it empty if you are not sure.',
  ntfbNameRequired: 'Type the category name.',
  saveNtfb: 'Save',
  createNtfb: 'Add category',
  removeNtfb: 'Remove',
  removeQuestion: 'Remove this category?',
  removeConsequence:
    'If any of our categories still report under it, it is archived instead. Past reports keep working either way.',
  /** Archiving happens through Remove, where I21 decides; only the way back is a
   *  plain field edit (`shared/src/report.ts`, `UpdateNtfbCategoryRequest`). */
  reactivate: 'Put back in use',
  reactivated: 'Back in use.',
  ntfbSaved: 'Saved.',
  nothingMapped: 'Nothing reports under this yet',
  oneMapped: 'One of our categories reports under this',
  manyMapped: 'of our categories report under this',
} as const;
