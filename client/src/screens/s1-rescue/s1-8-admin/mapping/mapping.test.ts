// The AGFP→NTFB matching — the rules the editor repeats, tested.
//
// These moved here with the editor (D17, overriding D11). They were S3.1's until
// the pantry chose Admin over the Report screen; the assertions are unchanged,
// because the move was "a route-access change and a screen move, not a data change"
// and a test that had to be rewritten would have meant it was neither.
//
// NOTHING HERE RENDERS. There is no browser or component harness in this repo and
// adding one would be a dependency no lane may add (D5), so the editor's decisions
// were written as functions of plain records precisely so they could be tested. The
// rules themselves — which categories block an export, what I21 does to a removal —
// live in `server/src/services/report.ts` and are tested against a real database in
// `server/test/report-union.test.ts`.
//
// Run: npx vitest run --root client

import { describe, expect, it } from 'vitest';
import type { CategoryMapping, NtfbCategory, UnmappedCategory } from '../../../../api/shared.ts';
import {
  COPY,
  FORBIDDEN_IN_COPY,
  mappedCountLabel,
  mappingRows,
  mappingSavedText,
  mappingTargetLabel,
  normalizeOptional,
  ntfbLabel,
  ntfbNameError,
  ntfbRemovalText,
  pickerOptions,
  sortNtfbCategories,
  storageGapNote,
  weightWithUnit,
} from './mapping.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function unmappedRow(over: Partial<UnmappedCategory> = {}): UnmappedCategory {
  return { categoryId: 'agfp-3', categoryName: 'Produce', total: '1222.35', ...over };
}

function ntfb(over: Partial<NtfbCategory> = {}): NtfbCategory {
  return { id: 'ntfb-1', name: 'Protein', code: '14', active: true, mappedCount: 2, ...over };
}

function mapping(over: Partial<CategoryMapping> = {}): CategoryMapping {
  return {
    categoryId: 'agfp-1',
    categoryName: 'Frozen Meat',
    categoryActive: true,
    ntfbCategoryId: 'ntfb-1',
    ntfbCategoryName: 'Protein',
    storage: 'Frozen',
    ...over,
  };
}

// ---------------------------------------------------------------------------
// The matching rows (D12, D15)
// ---------------------------------------------------------------------------

describe('the matching editor', () => {
  it('puts the categories blocking an export at the top', () => {
    const rows = mappingRows(
      [
        mapping({ categoryId: 'agfp-1', categoryName: 'Frozen Meat' }),
        mapping({
          categoryId: 'agfp-2',
          categoryName: 'Bakery',
          ntfbCategoryId: null,
          ntfbCategoryName: null,
        }),
        mapping({
          categoryId: 'agfp-3',
          categoryName: 'Produce',
          ntfbCategoryId: null,
          ntfbCategoryName: null,
        }),
      ],
      [unmappedRow({ categoryId: 'agfp-3', categoryName: 'Produce' })],
    );
    // Blocking first, then merely unmatched, then matched. Alphabetical order
    // would bury the row somebody came here to fix.
    expect(rows.map((row) => row.categoryId)).toEqual(['agfp-3', 'agfp-2', 'agfp-1']);
    expect(rows[0]?.blockingWeight).toBe('1222.35');
    expect(rows[1]?.blockingWeight).toBeNull();
  });

  it('sorts alphabetically when nothing is blocking, which is Admin’s normal case', () => {
    // Admin renders `<MappingEditor />` with no week and therefore no blocking
    // list. The ranking still has to produce a sensible order rather than the
    // order the server happened to return.
    const rows = mappingRows(
      [
        mapping({ categoryId: 'agfp-1', categoryName: 'Zucchini' }),
        mapping({ categoryId: 'agfp-2', categoryName: 'Apples' }),
      ],
      [],
    );
    expect(rows.map((row) => row.categoryName)).toEqual(['Apples', 'Zucchini']);
    expect(rows.every((row) => row.blockingWeight === null)).toBe(true);
  });

  it('keeps an archived category of ours visible', () => {
    const rows = mappingRows([mapping({ categoryActive: false })], []);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.archived).toBe(true);
  });

  it('says where a category reports, or that it does not yet', () => {
    const [matched] = mappingRows([mapping()], []);
    const [unmatched] = mappingRows(
      [mapping({ ntfbCategoryId: null, ntfbCategoryName: null })],
      [],
    );
    // Category AND storage: together they are one Meal Connect line item (D15),
    // and showing only the category hides half of what the Reporter will type.
    expect(mappingTargetLabel(matched!)).toBe('Protein · Frozen');
    expect(mappingTargetLabel(unmatched!)).toBe(COPY.notMatched);
  });

  it('falls back to the category alone when no storage is set', () => {
    const [row] = mappingRows([mapping({ storage: null })], []);
    expect(mappingTargetLabel(row!)).toBe('Protein');
  });

  it('names a missing storage, but only once the category is matched', () => {
    const [matched] = mappingRows([mapping({ storage: null })], []);
    const [unmatched] = mappingRows(
      [mapping({ ntfbCategoryId: null, ntfbCategoryName: null, storage: null })],
      [],
    );
    expect(storageGapNote(matched!)).toBe(COPY.storageMissing);
    // Nothing to say yet: an unmatched category has a bigger problem, and it is
    // already the one the row is sorted to the top for.
    expect(storageGapNote(unmatched!)).toBeNull();
    expect(storageGapNote(mappingRows([mapping()], [])[0]!)).toBeNull();
  });

  it('offers only live food bank categories, plus leaving it unmatched', () => {
    const options = pickerOptions([
      ntfb({ id: 'a', name: 'Protein', code: '14' }),
      ntfb({ id: 'b', name: 'Archived one', active: false }),
      ntfb({ id: 'c', name: 'Bakery', code: null }),
    ]);
    // Pointing a live category at an archived bucket would build the next
    // unmapped block by hand.
    expect(options.map((option) => option.id)).toEqual(['c', 'a', null]);
    expect(options[options.length - 1]?.label).toBe(COPY.leaveUnmatched);
  });

  it('shows a Meal Connect code when there is one and never invents one', () => {
    // D13: a guessed code is worse than a null, which is why the column is
    // nullable in the first place.
    expect(ntfbLabel({ name: 'Protein', code: '14' })).toBe('Protein (14)');
    expect(ntfbLabel({ name: 'Protein', code: null })).toBe('Protein');
    expect(ntfbLabel({ name: 'Protein', code: '' })).toBe('Protein');
    expect(normalizeOptional('  ')).toBeNull();
    expect(normalizeOptional(' 14 ')).toBe('14');
  });

  it('says how many of ours report under one of theirs (the I21 hint)', () => {
    expect(mappedCountLabel(ntfb({ mappedCount: 0 }))).toBe(COPY.nothingMapped);
    expect(mappedCountLabel(ntfb({ mappedCount: 1 }))).toBe(COPY.oneMapped);
    expect(mappedCountLabel(ntfb({ mappedCount: 3 }))).toContain('3');
  });

  it('lists live categories before archived ones', () => {
    const sorted = sortNtfbCategories([
      ntfb({ id: 'a', name: 'Zucchini', active: true }),
      ntfb({ id: 'b', name: 'Apples', active: false }),
      ntfb({ id: 'c', name: 'Bakery', active: true }),
    ]);
    expect(sorted.map((category) => category.id)).toEqual(['c', 'a', 'b']);
  });

  it('requires a name and invents no other rule', () => {
    // A duplicate-name rule is written down nowhere, so refusing one here would
    // refuse a name the server accepts.
    expect(ntfbNameError('', false)).toBeNull();
    expect(ntfbNameError('  ', true)).toBe(COPY.ntfbNameRequired);
    expect(ntfbNameError('Protein', true)).toBeNull();
  });

  it('reports the I21 answer rather than predicting it', () => {
    expect(ntfbRemovalText('Protein', 'DELETED')).toContain('gone');
    expect(ntfbRemovalText('Protein', 'DEACTIVATED')).toContain('archived');
  });

  it('warns that leaving a category unmatched holds the export up', () => {
    expect(mappingSavedText('Produce', null)).toContain('export');
    expect(mappingSavedText('Produce', 'Protein')).toContain('Protein');
  });

  it('shows a blocking weight the way every other weight is shown', () => {
    // Display only. Nothing here adds weights up, so A165's integer-cent
    // arithmetic did not follow the editor across.
    expect(weightWithUnit('1222.35')).toBe('1222.35 lb');
    expect(weightWithUnit('293.00')).toBe('293 lb');
  });
});

// ---------------------------------------------------------------------------
// Copy (§7, D21)
// ---------------------------------------------------------------------------

describe('microcopy', () => {
  const sentences = [
    ...Object.values(COPY),
    mappingTargetLabel(mappingRows([mapping()], [])[0]!),
    mappingTargetLabel(mappingRows([mapping({ ntfbCategoryId: null, ntfbCategoryName: null })], [])[0]!),
    mappingSavedText('Produce', null),
    mappingSavedText('Produce', 'Protein'),
    mappedCountLabel(ntfb({ mappedCount: 3 })),
    ntfbLabel({ name: 'Protein', code: '14' }),
    ntfbRemovalText('Protein', 'DELETED'),
    ntfbRemovalText('Protein', 'DEACTIVATED'),
    storageGapNote(mappingRows([mapping({ storage: null })], [])[0]!) ?? '',
    weightWithUnit('1222.35'),
  ];

  it('says something everywhere', () => {
    for (const sentence of Object.values(COPY)) expect(sentence.length).toBeGreaterThan(0);
  });

  it('uses no forbidden word (§7)', () => {
    for (const sentence of sentences) {
      for (const word of FORBIDDEN_IN_COPY) {
        expect(sentence.toLowerCase()).not.toContain(word);
      }
    }
  });

  it('uses no em dash (D21)', () => {
    // Two sentences or a comma, never a hyphen swap. The rule is about prose the
    // pantry reads; the only em dashes left in this folder are in comments.
    for (const sentence of sentences) expect(sentence).not.toContain('—');
  });

  it('points at the panel beside it, not at another screen', () => {
    // This sentence used to read "An admin adds ours under Admin → Categories",
    // written from the Report screen. Both halves are in Admin now, so a
    // cross-screen pointer would be sending somebody to where they are (D17).
    expect(COPY.mappingEmptyBody).toContain('Categories');
    expect(COPY.mappingEmptyBody).not.toContain('Admin');
  });

  it('keeps the remap warning, which nothing else says', () => {
    // A181: every week is computed on read, so a remap changes what an
    // already-exported week would say. The person it surprises is the Reporter,
    // who is no longer the person making the change — which makes this the LAST
    // sentence D21 would cut, not a candidate for it.
    expect(COPY.remapNotice.toLowerCase()).toContain('every week');
    expect(COPY.remapNotice.toLowerCase()).toContain('exported');
  });
});
