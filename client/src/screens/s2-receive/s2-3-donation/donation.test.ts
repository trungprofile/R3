// S2.3 unscheduled donation — the rules this screen repeats, tested.
//
// NOTHING HERE RENDERS. There is no browser or component harness in this repo and
// adding one (jsdom, a renderer) would be a dependency no lane may add
// (build-plan §3/D5), so the screen's decisions were written as functions of
// plain records precisely so they could be tested at all.
//
// These are communication-only rules — `server/test/donation.test.ts` covers
// I15/I16/I17/I29 where they are actually enforced, against the migrated
// database. The four a wrong client answer would break silently:
//
//   I16b   blank attribution is legal ONLY with the report toggle off
//   XOR    a donor id and a label are never both sent
//   confirm  an absent field means "keep the driver's", so switching the source
//            on a prefill has to send an explicit null
//   A165   a weight is a decimal STRING and is never routed through a number
//
// Run: npx vitest run --root client

import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../api/index.ts';
import {
  DONATION_SOURCE_REQUIRED_MESSAGE,
  REPORTABLE_EXPLAINER,
} from '../../../api/shared.ts';
import type { CategorySummary, DonationSummary, DonorSummary } from '../../../api/shared.ts';
import {
  COPY,
  FORBIDDEN_IN_COPY,
  canEdit,
  confirmBody,
  createBody,
  describeRow,
  donorName,
  draftFrom,
  emptyDraft,
  formatWeight,
  hasSource,
  isSubmittable,
  isWeight,
  messageFor,
  nextInSameDonation,
  pickableDonors,
  removeRow,
  shouldReloadAfter,
  splitWorklist,
  tileCategories,
  upsertRow,
  validateDraft,
  weightWithUnit,
} from './donation.ts';
import type { DonationDraft } from './donation.ts';

// ---------------------------------------------------------------------------

function row(over: Partial<DonationSummary> = {}): DonationSummary {
  return {
    id: 'don-1',
    shiftId: 'shift-1',
    status: 'SUGGESTED',
    source: 'MASTER',
    donorId: 'donor-1',
    donorLabel: null,
    donorDisplay: "Sam's",
    categoryId: 'cat-1',
    categoryName: 'Produce',
    weight: null,
    reportable: true,
    receivedDate: '2026-04-23',
    note: null,
    createdByName: 'Karen',
    createdAt: '2026-04-23T15:00:00.000Z',
    editableByReceiver: true,
    ...over,
  };
}

function donor(over: Partial<DonorSummary> = {}): DonorSummary {
  return {
    id: 'donor-1',
    name: "Sam's",
    address: null,
    contact: null,
    note: null,
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function category(over: Partial<CategorySummary> = {}): CategorySummary {
  return {
    id: 'cat-1',
    name: 'Produce',
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

/** A draft that would submit cleanly, for tests that vary one thing. */
function goodDraft(over: Partial<DonationDraft> = {}): DonationDraft {
  return { ...emptyDraft(), donorId: 'donor-1', categoryId: 'cat-1', weight: '87.5', ...over };
}

// ---------------------------------------------------------------------------
// Weights (A165)
// ---------------------------------------------------------------------------

describe('weights', () => {
  it('accepts what numeric(8,2) accepts and nothing else', () => {
    expect(isWeight('128')).toBe(true);
    expect(isWeight('12.5')).toBe(true);
    expect(isWeight('999999.99')).toBe(true);
    expect(isWeight('')).toBe(false);
    expect(isWeight('12.345')).toBe(false);
    expect(isWeight('1234567')).toBe(false);
    expect(isWeight('-5')).toBe(false);
    expect(isWeight('twelve')).toBe(false);
  });

  it('formats without going through a number', () => {
    expect(formatWeight('87.50')).toBe('87.5');
    expect(formatWeight('120.00')).toBe('120');
    expect(formatWeight('12.05')).toBe('12.05');
    expect(formatWeight('1222.35')).toBe('1222.35');
    expect(weightWithUnit('87.50')).toBe('87.5 lb');
  });

  it('sends the digits exactly as typed', () => {
    // The whole reason the column crosses the wire as text: this value is not
    // representable in binary floating point and it feeds the NTFB report.
    expect(createBody(goodDraft({ weight: '1222.35' })).weight).toBe('1222.35');
  });
});

// ---------------------------------------------------------------------------
// I16b — attribution is optional only when the report toggle is off
// ---------------------------------------------------------------------------

describe('the report toggle and the donor', () => {
  it('defaults to ON (I15)', () => {
    expect(emptyDraft().reportable).toBe(true);
  });

  it('refuses a blank donor while reporting, with the server’s own sentence', () => {
    const anonymous = goodDraft({ sourceMode: 'ANON', donorId: null, reportable: true });
    expect(validateDraft(anonymous).donor).toBe(DONATION_SOURCE_REQUIRED_MESSAGE);
    expect(isSubmittable(anonymous)).toBe(false);
  });

  it('allows a blank donor once the toggle is off', () => {
    const anonymous = goodDraft({ sourceMode: 'ANON', donorId: null, reportable: false });
    expect(validateDraft(anonymous).donor).toBeUndefined();
    expect(isSubmittable(anonymous)).toBe(true);
  });

  it('treats an all-whitespace typed name as no name at all', () => {
    // `resolveSource` normalises blank label text to NULL server-side, so a form
    // that called "   " a source would satisfy I16b here and be refused there.
    const blank = goodDraft({ sourceMode: 'LABEL', donorId: null, donorLabel: '   ' });
    expect(hasSource(blank)).toBe(false);
    expect(validateDraft(blank).donor).toBe(DONATION_SOURCE_REQUIRED_MESSAGE);
  });

  it('counts a typed name as a source', () => {
    const typed = goodDraft({ sourceMode: 'LABEL', donorId: null, donorLabel: 'A neighbour' });
    expect(hasSource(typed)).toBe(true);
    expect(isSubmittable(typed)).toBe(true);
  });

  it('ignores a stale donor id once the mode moved off the list', () => {
    // Switching to "Type a name" must not keep the previously tapped store alive
    // as a hidden source — that is how "both" gets sent.
    const switched = goodDraft({ sourceMode: 'LABEL', donorId: 'donor-1', donorLabel: '' });
    expect(hasSource(switched)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Request bodies — never both columns
// ---------------------------------------------------------------------------

describe('createBody', () => {
  it('sends a store id and no label', () => {
    const body = createBody(goodDraft({ sourceMode: 'MASTER', donorId: 'donor-1' }));
    expect(body.donorId).toBe('donor-1');
    expect(body.donorLabel).toBeUndefined();
  });

  it('sends a label and no store id', () => {
    const body = createBody(
      goodDraft({ sourceMode: 'LABEL', donorId: 'donor-1', donorLabel: '  A neighbour  ' }),
    );
    expect(body.donorLabel).toBe('A neighbour');
    expect(body.donorId).toBeUndefined();
  });

  it('sends neither for an anonymous walk-in', () => {
    const body = createBody(
      goodDraft({ sourceMode: 'ANON', donorId: 'donor-1', donorLabel: 'x', reportable: false }),
    );
    expect(body.donorId).toBeUndefined();
    expect(body.donorLabel).toBeUndefined();
  });

  it('never sends both columns, in any mode', () => {
    for (const mode of ['MASTER', 'LABEL', 'ANON'] as const) {
      const body = createBody(
        goodDraft({ sourceMode: mode, donorId: 'donor-1', donorLabel: 'A neighbour' }),
      );
      const both = body.donorId != null && body.donorLabel != null;
      expect(both).toBe(false);
    }
  });

  it('carries the report flag and a trimmed note, or null', () => {
    expect(createBody(goodDraft({ reportable: false })).reportable).toBe(false);
    expect(createBody(goodDraft({ note: '  by the door  ' })).note).toBe('by the door');
    expect(createBody(goodDraft({ note: '   ' })).note).toBeNull();
  });
});

describe('confirmBody', () => {
  it('clears the driver’s store with an explicit null when the receiver types a name', () => {
    // `confirmDonation` reads an ABSENT field as "keep what the driver flagged".
    // Omitting `donorId` here would keep the store AND add a label, which is the
    // one combination `ck_ud_source_exclusive` refuses.
    const body = confirmBody(
      goodDraft({ sourceMode: 'LABEL', donorId: 'donor-1', donorLabel: 'A neighbour' }),
    );
    expect(body.donorId).toBeNull();
    expect(body.donorLabel).toBe('A neighbour');
  });

  it('clears the driver’s label with an explicit null when the receiver picks a store', () => {
    const body = confirmBody(
      goodDraft({ sourceMode: 'MASTER', donorId: 'donor-2', donorLabel: 'A neighbour' }),
    );
    expect(body.donorId).toBe('donor-2');
    expect(body.donorLabel).toBeNull();
  });

  it('clears both for an anonymous confirm', () => {
    const body = confirmBody(
      goodDraft({ sourceMode: 'ANON', donorId: 'donor-1', donorLabel: 'x', reportable: false }),
    );
    expect(body.donorId).toBeNull();
    expect(body.donorLabel).toBeNull();
  });

  it('re-supplies the category, because the driver’s pick is a prefill (D8)', () => {
    expect(confirmBody(goodDraft({ categoryId: 'cat-9' })).categoryId).toBe('cat-9');
  });
});

// ---------------------------------------------------------------------------
// The prefill path (I17)
// ---------------------------------------------------------------------------

describe('draftFrom', () => {
  it('brings the driver’s donor, category and note across', () => {
    const draft = draftFrom(row({ note: 'left on the dock', categoryId: 'cat-3' }));
    expect(draft.sourceMode).toBe('MASTER');
    expect(draft.donorId).toBe('donor-1');
    expect(draft.categoryId).toBe('cat-3');
    expect(draft.note).toBe('left on the dock');
  });

  it('brings no weight, because a SUGGESTED row has none', () => {
    // I16a exempts `weight` while SUGGESTED and supplying one is exactly what the
    // receiver is here for.
    expect(draftFrom(row({ weight: null })).weight).toBe('');
    expect(isSubmittable(draftFrom(row()))).toBe(false);
  });

  it('carries a free-text label across as the typed mode', () => {
    const draft = draftFrom(
      row({ source: 'LABEL', donorId: null, donorLabel: 'A neighbour', donorDisplay: 'A neighbour' }),
    );
    expect(draft.sourceMode).toBe('LABEL');
    expect(draft.donorLabel).toBe('A neighbour');
    expect(draft.donorId).toBeNull();
  });

  it('keeps the driver’s report flag rather than resetting it to the default', () => {
    expect(draftFrom(row({ reportable: false })).reportable).toBe(false);
  });
});

describe('nextInSameDonation', () => {
  it('keeps the source and the report choice, clears the entry (I18)', () => {
    // The grain is one row per category, so a three-category donation is three
    // submissions — re-picking the store each time would be three times the work.
    const next = nextInSameDonation(
      goodDraft({ note: 'by the door', reportable: false, sourceMode: 'MASTER' }),
    );
    expect(next.donorId).toBe('donor-1');
    expect(next.reportable).toBe(false);
    expect(next.note).toBe('by the door');
    expect(next.categoryId).toBeNull();
    expect(next.weight).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Validation, generally
// ---------------------------------------------------------------------------

describe('validateDraft', () => {
  it('asks for a category', () => {
    expect(validateDraft(goodDraft({ categoryId: null })).category).toBe(COPY.categoryRequired);
  });

  it('asks for a weight, and says what a weight looks like', () => {
    expect(validateDraft(goodDraft({ weight: '' })).weight).toBe(COPY.weightRequired);
    expect(validateDraft(goodDraft({ weight: '12.345' })).weight).toBe(COPY.weightInvalid);
  });

  it('finds nothing wrong with a complete draft', () => {
    expect(validateDraft(goodDraft())).toEqual({});
    expect(isSubmittable(goodDraft())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The worklist
// ---------------------------------------------------------------------------

describe('splitWorklist', () => {
  const rows = [
    row({ id: 'a', status: 'CONFIRMED', createdAt: '2026-04-21T10:00:00.000Z' }),
    row({ id: 'b', status: 'SUGGESTED', createdAt: '2026-04-23T10:00:00.000Z' }),
    row({ id: 'c', status: 'SUGGESTED', createdAt: '2026-04-24T10:00:00.000Z' }),
    row({ id: 'd', status: 'CONFIRMED', createdAt: '2026-04-24T11:00:00.000Z' }),
  ];

  it('separates what is waiting from what is recorded', () => {
    const { pending, recorded } = splitWorklist(rows);
    expect(pending.map((r) => r.id)).toEqual(['c', 'b']);
    expect(recorded.map((r) => r.id)).toEqual(['d', 'a']);
  });

  it('does not mutate what it was given', () => {
    const before = rows.map((r) => r.id);
    splitWorklist(rows);
    expect(rows.map((r) => r.id)).toEqual(before);
  });
});

describe('upsertRow / removeRow', () => {
  it('replaces a row in place when the server returns it updated', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b' })];
    const next = upsertRow(rows, row({ id: 'b', status: 'CONFIRMED', weight: '10.00' }));
    expect(next.map((r) => r.id)).toEqual(['a', 'b']);
    expect(next[1]?.status).toBe('CONFIRMED');
  });

  it('puts a brand-new row at the top', () => {
    expect(upsertRow([row({ id: 'a' })], row({ id: 'z' })).map((r) => r.id)).toEqual(['z', 'a']);
  });

  it('drops a discarded prefill', () => {
    expect(removeRow([row({ id: 'a' }), row({ id: 'b' })], 'a').map((r) => r.id)).toEqual(['b']);
  });
});

describe('describeRow', () => {
  it('says a prefill has no weight yet rather than printing a zero', () => {
    expect(describeRow(row({ weight: null }))).toBe('Produce · no weight yet');
  });

  it('prints a confirmed weight with its unit', () => {
    expect(describeRow(row({ status: 'CONFIRMED', weight: '87.50' }))).toBe('Produce · 87.5 lb');
  });
});

describe('canEdit', () => {
  it('follows the server’s window, never a local clock (D9)', () => {
    expect(canEdit(row({ editableByReceiver: true }))).toBe(true);
    expect(canEdit(row({ editableByReceiver: false }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Pickers
// ---------------------------------------------------------------------------

describe('pickers', () => {
  it('shows only active categories, alphabetically', () => {
    const tiles = tileCategories([
      category({ id: '1', name: 'Produce' }),
      category({ id: '2', name: 'Bakery' }),
      category({ id: '3', name: 'Old thing', active: false }),
    ]);
    expect(tiles.map((c) => c.name)).toEqual(['Bakery', 'Produce']);
  });

  it('shows only active donors, alphabetically', () => {
    const donors = pickableDonors(
      [
        donor({ id: '1', name: "Sam's" }),
        donor({ id: '2', name: 'Aldi' }),
        donor({ id: '3', name: 'Closed store', active: false }),
      ],
      null,
    );
    expect(donors.map((d) => d.name)).toEqual(['Aldi', "Sam's"]);
  });

  it('keeps an archived store visible when a prefill points at it', () => {
    // Hiding it would make the server's refusal baffling: the receiver would see
    // an empty picker and no explanation of what the driver had chosen.
    const donors = pickableDonors([donor({ id: '3', name: 'Closed store', active: false })], '3');
    expect(donors.map((d) => d.id)).toEqual(['3']);
  });

  it('names a store, or nothing when none is chosen', () => {
    expect(donorName([donor()], 'donor-1')).toBe("Sam's");
    expect(donorName([donor()], null)).toBeNull();
    expect(donorName([donor()], 'missing')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Errors (§6)
// ---------------------------------------------------------------------------

describe('errors', () => {
  it('prefers the server’s own sentence', () => {
    const refusal = new ApiError('conflict', {
      detail: 'That store is already a stop on this run — add its weight to the stop instead.',
    });
    expect(messageFor(refusal)).toContain('already a stop on this run');
  });

  it('falls back to a plain message, never a code', () => {
    const message = messageFor(new ApiError('server', { correlationId: 'abc-123' }));
    expect(message.length).toBeGreaterThan(0);
    expect(message).not.toContain('abc-123');
  });

  it('re-reads when someone else got there first', () => {
    expect(shouldReloadAfter(new ApiError('conflict'))).toBe(true);
    expect(shouldReloadAfter(new ApiError('not-found'))).toBe(true);
    expect(shouldReloadAfter(new ApiError('invalid'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Copy (§7)
// ---------------------------------------------------------------------------

describe('microcopy', () => {
  const sentences = Object.values(COPY);

  it('says something everywhere', () => {
    for (const sentence of sentences) expect(sentence.length).toBeGreaterThan(0);
  });

  it('uses no forbidden word', () => {
    for (const sentence of sentences) {
      for (const word of FORBIDDEN_IN_COPY) {
        expect(sentence.toLowerCase()).not.toContain(word);
      }
    }
  });

  it('labels the toggle exactly as the spec words it', () => {
    expect(COPY.reportLabel).toBe('Report this to North Texas Food Bank');
  });

  it('does not restate the shared copy it is required to quote verbatim', () => {
    // `REPORTABLE_EXPLAINER` and `DONATION_SOURCE_REQUIRED_MESSAGE` live in
    // `shared/src/donation.ts` and are used from there. A second copy would drift
    // away from the sentence the server refuses with.
    for (const sentence of sentences) {
      expect(sentence).not.toBe(REPORTABLE_EXPLAINER);
      expect(sentence).not.toBe(DONATION_SOURCE_REQUIRED_MESSAGE);
    }
  });
});
