// S3.1 report generation — the rules this screen repeats, tested.
//
// NOTHING HERE RENDERS. There is no browser or component harness in this repo and
// adding one (jsdom, a renderer) would be a dependency no lane may add
// (`phase-3-build-plan.md §3`), so the screen's decisions were written as
// functions of plain records precisely so they could be tested at all. No
// database either — `server/test/report-union.test.ts` covers the union where it
// is actually computed.
//
// These are communication-only rules. The five a wrong client answer would break
// silently, and which are therefore worth a test:
//
//   D12   unmapped weight is named and the export is not offered
//   A184  an open run is surfaced and does NOT block
//   PRD §3  reported / unreported / intake are three labelled numbers, never one
//   §1.3  weights add up in integer cents, never in a float
//   A178  the week runs Monday to Sunday, and navigation stays on that grid
//
// Run: npx vitest run --root client

import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../api/index.ts';
import { EXPORT_BLOCKED_MESSAGE } from '../../../api/shared.ts';
import type {
  NtfbCategory,
  Receipt,
  ReceiptLine,
  ReceiptNote,
  ReportEntry,
  ReportExport,
  UnmappedCategory,
  WeeklyReport,
} from '../../../api/shared.ts';
import {
  BLOCKED_MESSAGE,
  COPY,
  FORBIDDEN_IN_COPY,
  PRINT_BODY_CLASS,
  acceptKeypadValue,
  addDaysIso,
  addWeights,
  canExport,
  canSaveWeight,
  checkboxDescription,
  drillTotals,
  entriesTotal,
  entryDescription,
  entrySource,
  formatDayLabel,
  formatReceiptDate,
  formatDateRange,
  formatWeight,
  groupEntriesByDay,
  hasReportToggle,
  isCurrentWeek,
  isEmptyExport,
  isEmptyWeek,
  isFutureWeek,
  isoWeekday,
  messageFor,
  missingItems,
  nextWeek,
  normalizeWeight,
  noteAuthorLabel,
  noteRoleLabel,
  ntfbLabel,
  openRunLabel,
  openRunsNotice,
  previousWeek,
  receiptDonorLabel,
  receiptEmptyText,
  receiptKey,
  receiptLineLabel,
  receiptLineSource,
  reportLineTitle,
  reportState,
  reportableChoices,
  reportableSavedText,
  rolledUpNames,
  runStatusWord,
  shouldReloadAfter,
  subtractWeights,
  toggleDrillIn,
  totalsView,
  unmappedSummary,
  weekStartOf,
  weightError,
  weightWithUnit,
  // D41 — the window is a From/To range now, defaulting to this week.
  defaultRange,
  isThisWeek,
  isValidRange,
  rangeError,
  rangeHeading,
  // D35 — the Meal Connect check-off.
  canMarkSubmitted,
  formatSubmittedAt,
  markSubmittedQuestion,
  receiptRowDescription,
  receiptRowTitle,
  submittedLabel,
  submittedProgress,
} from './report.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function report(over: Partial<WeeklyReport> = {}): WeeklyReport {
  return {
    from: '2026-07-27',
    to: '2026-08-02',
    lines: [
      {
        ntfbCategoryId: 'ntfb-1',
        ntfbCategoryName: 'Protein',
        ntfbCode: '14',
        storage: 'Frozen',
        agfpCategories: [
          { categoryId: 'agfp-1', categoryName: 'Frozen Meat', total: '293.00' },
          { categoryId: 'agfp-2', categoryName: 'Deli', total: '31.00' },
        ],
        total: '324.00',
      },
    ],
    unmapped: [],
    reportedTotal: '324.00',
    intakeTotal: '424.00',
    unreportedTotal: '100.00',
    readyToExport: true,
    openRuns: [],
    mealConnect: { agencyCode: '026357P', foodBank: 'North Texas Food Bank', foodBankCode: '24' },
    ...over,
  };
}

function unmappedRow(over: Partial<UnmappedCategory> = {}): UnmappedCategory {
  return { categoryId: 'agfp-3', categoryName: 'Produce', total: '1222.35', ...over };
}

function entry(over: Partial<ReportEntry> = {}): ReportEntry {
  return {
    id: 'entry-1',
    kind: 'WEIGHT',
    day: '2026-07-28',
    donorName: "Sam's",
    donorCode: '6228',
    categoryId: 'agfp-1',
    categoryName: 'Frozen Meat',
    weight: '293.00',
    reportable: true,
    receiverName: 'Karen',
    shiftId: 'shift-1',
    routeName: 'Tue AM run',
    receiverWindowOpen: false,
    ...over,
  };
}

function ntfb(over: Partial<NtfbCategory> = {}): NtfbCategory {
  return { id: 'ntfb-1', name: 'Protein', code: '14', active: true, mappedCount: 2, ...over };
}

function line(over: Partial<ReceiptLine> = {}): ReceiptLine {
  return {
    ntfbCategory: 'Bread',
    storage: 'Dry',
    pounds: '744',
    agfpCategory: 'Bakery',
    computed: false,
    ...over,
  };
}

/** The receipt from the pantry's own paper log, as `phases-1-3.md` records it:
 *  bakery 827 gross at 10%, deli 53 at 15%, and a 460 lb computed Trash line. */
function receipt(over: Partial<Receipt> = {}): Receipt {
  return {
    pickupDate: '2026-03-20',
    donorId: 'donor-1',
    donorName: 'H-E-B Food Stores',
    donorCode: '810',
    lines: [
      line(),
      line({ ntfbCategory: 'Prepared Meal', storage: 'Frozen', pounds: '45', agfpCategory: 'Deli' }),
      line({
        ntfbCategory: 'Prepared Meal',
        storage: 'Frozen',
        pounds: '120',
        agfpCategory: 'Frz Non Meat',
      }),
      line({
        ntfbCategory: 'Trash',
        storage: 'Dry',
        pounds: '460',
        agfpCategory: '',
        computed: true,
      }),
    ],
    itemCount: 4,
    totalPounds: '1369',
    notAttempted: false,
    noPounds: false,
    notes: [],
    submitted: null,
    ...over,
  };
}

/** The same receipt, already filed into Meal Connect (D35). */
function submittedReceipt(over: Partial<Receipt> = {}): Receipt {
  return receipt({
    submitted: { submittedAt: '2026-03-21T16:12:00.000Z', submittedBy: 'Karen Diaz' },
    ...over,
  });
}

function note(over: Partial<ReceiptNote> = {}): ReceiptNote {
  return { role: 'DRIVER', author: 'Karen', text: 'Store was not open.', ...over };
}

function sheet(over: Partial<ReportExport> = {}): ReportExport {
  return {
    from: '2026-03-16',
    to: '2026-03-22',
    receipts: [receipt()],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// The week (A178 — Monday to Sunday)
// ---------------------------------------------------------------------------

describe('the report week', () => {
  it('starts on Monday', () => {
    // 2026-07-27 is a Monday; 2026-08-02 the Sunday that closes the same week.
    expect(isoWeekday('2026-07-27')).toBe(1);
    expect(isoWeekday('2026-08-02')).toBe(7);
    expect(weekStartOf('2026-07-27')).toBe('2026-07-27');
    expect(weekStartOf('2026-07-30')).toBe('2026-07-27');
    expect(weekStartOf('2026-08-02')).toBe('2026-07-27');
  });

  it('moves a whole week at a time and stays on the Monday grid', () => {
    expect(previousWeek('2026-07-27')).toBe('2026-07-20');
    expect(nextWeek('2026-07-27')).toBe('2026-08-03');
    expect(isoWeekday(previousWeek('2026-07-27'))).toBe(1);
    expect(isoWeekday(nextWeek('2026-07-27'))).toBe(1);
  });

  it('crosses a month, a year and a leap day without a timezone shifting it', () => {
    expect(addDaysIso('2026-12-28', 7)).toBe('2027-01-04');
    expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29');
    expect(weekStartOf('2027-01-01')).toBe('2026-12-28');
  });

  it('leaves a value that is not a date alone rather than guessing one', () => {
    expect(addDaysIso('not-a-date', 7)).toBe('not-a-date');
    expect(weekStartOf('')).toBe('');
  });

  it('defaults the range to the week containing the pantry today (D41, A178)', () => {
    // The window is two dates now, and the DEFAULT is the load-bearing half: the
    // same Monday-to-Sunday week `weekBounds()` cuts on the server, S1.2's board
    // opens on, and (since D39) Admin metrics opens on. All of them read
    // `app/week.ts` or its server mirror, so no two screens can disagree about
    // what "this week" means.
    expect(defaultRange('2026-07-30')).toEqual({ from: '2026-07-27', to: '2026-08-02' });
    expect(defaultRange('2026-07-27')).toEqual({ from: '2026-07-27', to: '2026-08-02' });
    expect(defaultRange('2026-08-02')).toEqual({ from: '2026-07-27', to: '2026-08-02' });
    expect(isThisWeek(defaultRange('2026-07-30'), '2026-07-30')).toBe(true);
    expect(isThisWeek({ from: '2026-07-27', to: '2026-08-09' }, '2026-07-30')).toBe(false);
  });

  it('refuses a backwards or half-typed range, in the field it was typed in', () => {
    // Communication only: the SERVER refuses a backwards range too (`resolveRange`).
    // This exists so a Reporter sees the typo beside the two fields that made it,
    // rather than in a toast after a round trip.
    expect(rangeError({ from: '2026-07-27', to: '2026-08-02' })).toBeNull();
    expect(rangeError({ from: '2026-07-27', to: '2026-07-27' })).toBeNull();
    expect(rangeError({ from: '2026-08-02', to: '2026-07-27' })).toBe(COPY.rangeBackwards);
    expect(rangeError({ from: '', to: '2026-07-27' })).toBe(COPY.rangeIncomplete);
    expect(rangeError({ from: '2026-07-27', to: 'nope' })).toBe(COPY.rangeIncomplete);
    expect(isValidRange({ from: '2026-08-02', to: '2026-07-27' })).toBe(false);
  });

  it('names the range where it has a name, and shows the dates where it does not', () => {
    // §1.4, recognition over recall. Most ranges have no name now that any two
    // dates are reachable, and for those the dates ARE the answer.
    expect(rangeHeading({ from: '2026-07-27', to: '2026-08-02' }, '2026-07-30')).toBe(
      COPY.thisWeekHeading,
    );
    expect(rangeHeading({ from: '2026-07-20', to: '2026-07-26' }, '2026-07-30')).toBe(
      COPY.lastWeekHeading,
    );
    // A fortnight is not a week and is not named one.
    const fortnight = rangeHeading({ from: '2026-07-20', to: '2026-08-02' }, '2026-07-30');
    expect(fortnight).toContain('Jul 20');
    expect(fortnight).toContain('Aug 2');
  });

  it('names a week that has not happened rather than showing a bare zero', () => {
    // `weekLabel` used to answer this and D41 folded it into `rangeHeading`: the
    // same three phrases, asked of two dates instead of one, falling back to the
    // dates themselves rather than to null. Navigating into a future week is
    // allowed and shows an empty one, which is a true answer — but the screen says
    // so, so nobody reads "0 lb" as a bad week.
    expect(rangeHeading({ from: '2026-08-10', to: '2026-08-16' }, '2026-07-30')).toBe(
      COPY.futureWeekHeading,
    );
    expect(isFutureWeek('2026-08-10', '2026-07-30')).toBe(true);
    expect(isFutureWeek('2026-07-20', '2026-07-30')).toBe(false);
  });

  it('says which boundary the week used, at both ends', () => {
    // A178 chose Monday-to-Sunday with no doc to lean on, so the range has to
    // show its working rather than leave a Reporter to infer it.
    const range = formatDateRange('2026-07-27', '2026-08-02');
    expect(range).toContain('Mon');
    expect(range).toContain('Sun');
    expect(range).toContain('Jul 27');
    expect(range).toContain('Aug 2');
    expect(range).toContain('2026');
  });

  it('states both years when a week straddles new year', () => {
    expect(formatDateRange('2026-12-28', '2027-01-03')).toContain('2026');
    expect(formatDateRange('2026-12-28', '2027-01-03')).toContain('2027');
  });

  it('knows the current week and a week that has not happened', () => {
    expect(isCurrentWeek('2026-07-27', '2026-07-30')).toBe(true);
    expect(isCurrentWeek('2026-07-20', '2026-07-30')).toBe(false);
    expect(isFutureWeek('2026-08-03', '2026-07-30')).toBe(true);
    expect(isFutureWeek('2026-07-27', '2026-07-30')).toBe(false);
    expect(isFutureWeek('2026-07-20', '2026-07-30')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Weights — decimal strings, never a JS number (A165)
// ---------------------------------------------------------------------------

describe('weights', () => {
  it('reads a stored weight the way the paper sheet did', () => {
    expect(formatWeight('293.00')).toBe('293');
    expect(formatWeight('12.50')).toBe('12.5');
    expect(formatWeight('1222.35')).toBe('1222.35');
    expect(formatWeight('0.05')).toBe('0.05');
  });

  it('always shows the unit (§7)', () => {
    expect(weightWithUnit('293.00')).toBe('293 lb');
  });

  it('shows anything that is not a plain decimal exactly as it arrived', () => {
    expect(formatWeight('nonsense')).toBe('nonsense');
  });

  it('adds in integer cents, not in a float', () => {
    // The float answer to this is 0.30000000000000004, and it would land in the
    // column the food bank reads (`phase-3-build-plan.md §1.3`).
    expect(addWeights(['0.10', '0.20'])).toBe('0.30');
    expect(addWeights(['1222.35', '293.00', '31.00'])).toBe('1546.35');
    expect(addWeights([])).toBe('0.00');
  });

  it('refuses to total a malformed figure rather than dropping it', () => {
    // Silently skipping it would understate the total by exactly the amount
    // nobody noticed — the failure D12 exists to prevent, one level down.
    expect(addWeights(['12.00', 'nonsense'])).toBeNull();
    expect(entriesTotal([entry({ weight: 'nonsense' })])).toBeNull();
  });

  it('totals the entries behind a number', () => {
    expect(entriesTotal([entry({ weight: '61.00' }), entry({ weight: '232.00' })])).toBe('293.00');
  });

  it('stops the keypad at what numeric(8,2) holds', () => {
    expect(acceptKeypadValue('12', '123')).toBe('123');
    expect(acceptKeypadValue('123456', '1234567')).toBe('123456');
    expect(acceptKeypadValue('12.34', '12.345')).toBe('12.34');
    expect(acceptKeypadValue('12', '12a')).toBe('12');
  });

  it('sends the digits that were typed', () => {
    expect(normalizeWeight('12.')).toBe('12');
    expect(normalizeWeight(' 007 ')).toBe('7');
    expect(canSaveWeight('12.35')).toBe(true);
    expect(canSaveWeight('0')).toBe(true);
    expect(canSaveWeight('')).toBe(false);
    expect(canSaveWeight('.')).toBe(false);
  });

  it('says nothing until the Reporter has tried to save', () => {
    expect(weightError('', false)).toBeNull();
    expect(weightError('', true)).toBe(COPY.weightRequired);
    expect(weightError('1234567', true)).toBe(COPY.weightTooLong);
    expect(weightError('12.35', true)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The two totals, never conflated (PRD §3)
// ---------------------------------------------------------------------------

describe('totals', () => {
  it('emits TWO figures, together, each with its own words (D34)', () => {
    // Three became two. "Received but not reported" is `intake - reported` and can
    // be read straight off the pair, so the third figure was earning its place by
    // being derivable — the same argument D21 makes about a hint that restates its
    // control.
    const totals = totalsView(report());
    expect(totals.map((total) => total.key)).toEqual(['intake', 'reported']);
    expect(totals.map((total) => total.value)).toEqual(['424.00', '324.00']);
    for (const total of totals) expect(total.label.length).toBeGreaterThan(0);
  });

  it('still emits both together, so neither can be shown alone (PRD §3)', () => {
    // The reason this is one function rather than two field reads: a lone big
    // number with no label is exactly how intake and NTFB-reported get conflated,
    // and `domain-modeling.md §6` is locked about them being different unions.
    expect(totalsView(report())).toHaveLength(2);
    expect(totalsView(report({ intakeTotal: '0.00', reportedTotal: '0.00' }))).toHaveLength(2);
  });

  it('never gives reported and intake the same label', () => {
    // PRD §3 keeps them "distinct and clearly labeled everywhere", and this is
    // the screen most likely to blur them. Since D34 deleted the captions, the
    // labels are the ONLY place the distinction is drawn, so they carry it.
    const labels = totalsView(report()).map((total) => total.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) expect(label.toLowerCase()).not.toBe('total');
  });

  it('carries no per-figure caption any more (D34)', () => {
    // The captions went with the reorder. D28's whole-pound note did NOT go: it
    // explains why this screen and Admin metrics report the same range a pound
    // apart, and it moved to the report view, beside the figures a reporter types.
    for (const total of totalsView(report())) {
      expect(Object.keys(total)).toEqual(['key', 'label', 'value']);
    }
    expect(COPY.wholePoundsNote.toLowerCase()).toContain('whole pounds');
    expect(COPY.wholePoundsNote.toLowerCase()).toContain('metrics');
  });

  it('passes the figures the server sent through untouched', () => {
    const totals = totalsView(report({ reportedTotal: '1222.35' }));
    expect(totals[1]?.value).toBe('1222.35');
  });
});

// ---------------------------------------------------------------------------
// The export block (D12) and the incomplete week (A184)
// ---------------------------------------------------------------------------

describe('the export decision', () => {
  it('offers the export only when the server says the week is ready', () => {
    expect(canExport(report())).toBe(true);
    expect(canExport(report({ readyToExport: false }))).toBe(false);
  });

  it('trusts readyToExport rather than re-deriving it from the unmapped list', () => {
    // The server computes it over the same union that produces the file. A second
    // implementation here would be free to disagree with the thing it guards.
    const server = report({ readyToExport: false, unmapped: [] });
    expect(canExport(server)).toBe(false);
    expect(reportState(server, false)).toBe('INCOMPLETE');
  });

  it('walks the three states S3.1 names', () => {
    expect(reportState(report({ readyToExport: false }), false)).toBe('INCOMPLETE');
    expect(reportState(report(), false)).toBe('READY');
    expect(reportState(report(), true)).toBe('EXPORTED');
    // A blocked week is never "exported", whatever the local flag says.
    expect(reportState(report({ readyToExport: false }), true)).toBe('INCOMPLETE');
  });

  it('names the unmapped categories rather than counting them', () => {
    const summary = unmappedSummary([unmappedRow(), unmappedRow({ categoryName: 'Bakery' })]);
    expect(summary).toContain('Produce');
    expect(summary).toContain('Bakery');
    expect(summary).toContain('2');
  });

  it('says nothing when nothing is unmapped', () => {
    expect(unmappedSummary([])).toBeNull();
  });

  it('shares one sentence with the server that refuses the same export', () => {
    expect(BLOCKED_MESSAGE).toBe(EXPORT_BLOCKED_MESSAGE);
  });

  it('surfaces an open run without letting it block (A184)', () => {
    const week = report({
      openRuns: [
        { shiftId: 'shift-9', routeName: 'Tue AM run', occurrenceDate: '2026-07-28', status: 'OPEN' },
      ],
    });
    expect(canExport(week)).toBe(true);
    expect(reportState(week, false)).toBe('READY');
    expect(openRunsNotice(week.openRuns)).not.toBeNull();
  });

  it('lists the blocking problem before the informational one', () => {
    const week = report({
      readyToExport: false,
      unmapped: [unmappedRow()],
      openRuns: [
        { shiftId: 'shift-9', routeName: 'Tue AM run', occurrenceDate: '2026-07-28', status: 'OPEN' },
      ],
    });
    const items = missingItems(week);
    expect(items).toHaveLength(2);
    expect(items[0]).toContain('Produce');
    expect(items[1]).toContain('run');
  });

  it('says nothing is missing on a clean week', () => {
    expect(missingItems(report())).toEqual([]);
  });

  it('puts a run status in plain words, never the database word', () => {
    expect(runStatusWord('OPEN')).toBe(COPY.runOpen);
    expect(runStatusWord('IN_PROGRESS')).toBe(COPY.runInProgress);
    expect(runStatusWord('SOMETHING_NEW')).toBe(COPY.runUnfinished);
    for (const status of ['OPEN', 'CLAIMED', 'IN_PROGRESS', 'SOMETHING_NEW']) {
      expect(runStatusWord(status)).not.toContain('_');
    }
  });

  it('names an open run by its route, day and state', () => {
    const label = openRunLabel({
      shiftId: 'shift-9',
      routeName: 'Tue AM run',
      occurrenceDate: '2026-07-28',
      status: 'OPEN',
    });
    expect(label).toContain('Tue AM run');
    expect(label).toContain('Jul 28');
    expect(label).toContain(COPY.runOpen);
  });

});

// ---------------------------------------------------------------------------
// The receipt view (D29)
//
// The receipts themselves are the SERVER's, fetched from `GET /report/export` and
// never rebuilt here (A186, D12) — `server/test/` is where the arithmetic and the
// conservation property are proved. What is testable on this side is everything
// the CARD says about a receipt: how each field is named, which half of the card
// it belongs to, and the three cases where a card would otherwise read as broken.
// ---------------------------------------------------------------------------

describe('the receipt view', () => {
  it('writes the pickup date the way the portal takes it', () => {
    // Deliberately not the app's `Mar 20`: this line is copied into a field.
    expect(formatReceiptDate('2026-03-20')).toBe('03/20/2026');
    expect(formatReceiptDate('not-a-date')).toBe('not-a-date');
  });

  it('names the store the way the food bank`s own picker does', () => {
    expect(receiptDonorLabel(receipt())).toBe('H-E-B Food Stores (810)');
  });

  it('shows no code for a store nobody has one for, rather than a guessed one', () => {
    // D13: the code is NTFB's to issue. A walk-in label has no donor row at all.
    expect(receiptDonorLabel(receipt({ donorCode: null }))).toBe('H-E-B Food Stores');
    expect(receiptDonorLabel(receipt({ donorCode: '' }))).toBe('H-E-B Food Stores');
  });

  it('says a checkbox`s state in words, never by the box alone (§3)', () => {
    expect(checkboxDescription(true, COPY.noPoundsBox)).toContain(COPY.ticked);
    expect(checkboxDescription(false, COPY.noPoundsBox)).toContain(COPY.notTicked);
    expect(checkboxDescription(true, COPY.noPoundsBox)).toContain(COPY.noPoundsBox);
  });

  it('tells two identical Prepared Meal lines apart by their pounds', () => {
    // The whole reason our own half of the card exists: the Description column is
    // gone, Deli and Frz Non Meat both report as `Prepared Meal / Frozen`, and the
    // pair alone cannot say which row is which.
    const [, deli, frz] = receipt().lines;
    expect(receiptLineLabel(deli!)).toBe('Prepared Meal, Frozen, 45 lb');
    expect(receiptLineLabel(frz!)).toBe('Prepared Meal, Frozen, 120 lb');
    expect(receiptLineLabel(deli!)).not.toBe(receiptLineLabel(frz!));
    expect(receiptLineSource(deli!)).toBe('Deli');
    expect(receiptLineSource(frz!)).toBe('Frz Non Meat');
  });

  it('says where the Trash line came from instead of naming a category (D27)', () => {
    // Nothing was ever weighed into it, so "no category" would send a Reporter
    // looking for a paper log that does not exist.
    const trash = receipt().lines[3]!;
    expect(trash.computed).toBe(true);
    expect(receiptLineSource(trash)).toBe(COPY.computedLine);
    expect(receiptLineSource(trash).toLowerCase()).toContain('weighed');
  });

  it('names a line with no category of ours rather than showing a blank', () => {
    expect(receiptLineSource(line({ agfpCategory: '' }))).toBe(COPY.noAgfpCategory);
  });

  it('says a missing storage requirement out loud', () => {
    // A blank storage is one of the form's four fields empty and does NOT block
    // the export, unlike an unmapped category — so it is named, not hidden.
    expect(receiptLineLabel(line({ storage: '' }))).toContain(COPY.noStorage);
  });

  it('explains an empty receipt rather than leaving a card that looks broken', () => {
    // D29's whole point: a skipped stop and a run nobody worked produced NO export
    // row at all, so those pickups were invisible to the food bank. An empty table
    // with nothing said over it reads as a load that failed.
    const skipped = receipt({ lines: [], notAttempted: true, itemCount: 0, totalPounds: '0' });
    expect(receiptEmptyText(skipped)).toBe(COPY.notAttemptedBody);

    const nothing = receipt({ lines: [], noPounds: true, itemCount: 0, totalPounds: '0' });
    expect(receiptEmptyText(nothing)).toBe(COPY.noPoundsBody);

    // Neither box ticked and still no lines: unlikely, and still not a blank card.
    expect(receiptEmptyText(receipt({ lines: [] }))).toBe(COPY.noLinesBody);
  });

  it('says nothing about emptiness on a receipt that has lines', () => {
    expect(receiptEmptyText(receipt())).toBeNull();
  });

  it('labels every note channel in a volunteer`s words', () => {
    const roles = ['COORDINATOR', 'DRIVER', 'STOP', 'RECEIVER', 'DONATION'] as const;
    const labels = roles.map(noteRoleLabel);
    // Five channels, five distinct words, none of them the wire's own.
    expect(new Set(labels).size).toBe(roles.length);
    for (const label of labels) expect(label).not.toMatch(/[A-Z]{2,}/);
  });

  it('names the writer where there is one, and never invents one', () => {
    // A coordinator note stores no author; naming whoever last touched the shift
    // would put the wrong person's name on a remark.
    expect(noteAuthorLabel(note())).toBe('Driver (Karen)');
    expect(noteAuthorLabel(note({ role: 'COORDINATOR', author: null }))).toBe(
      COPY.roleCoordinator,
    );
    expect(noteAuthorLabel(note({ author: '' }))).toBe(COPY.roleDriver);
  });

  it('keeps two receipts apart even when the store is a free-text walk-in label', () => {
    const a = receipt({ donorName: 'A neighbour', donorCode: null });
    expect(receiptKey(a, 0)).not.toBe(receiptKey(a, 1));
  });

  it('knows a week with nothing to type', () => {
    expect(isEmptyExport(sheet({ receipts: [] }))).toBe(true);
    expect(isEmptyExport(sheet())).toBe(false);
  });

  it('keeps the print rule behind a class that only exists while receipts do', () => {
    // The defect this replaces: `report.css` held a bare `body * { visibility:
    // hidden }`, and a stylesheet is loaded once and never unloaded — so after one
    // visit to the report, Ctrl+P on any other screen printed a blank page. Every
    // print rule now sits behind this class, which the screen adds while the
    // receipts are mounted and removes on unmount.
    expect(PRINT_BODY_CLASS).toBe('s31-print-mode');
  });
});

// ---------------------------------------------------------------------------
// The table and the drill-in (Success Metric 4)
// ---------------------------------------------------------------------------

describe('the table', () => {
  it('knows a week with nothing in it', () => {
    expect(isEmptyWeek(report({ lines: [], unmapped: [] }))).toBe(true);
    // A week whose only weight is unmapped is NOT empty — there is something to
    // report, and it is exactly what the block is about.
    expect(isEmptyWeek(report({ lines: [], unmapped: [unmappedRow()] }))).toBe(false);
    expect(isEmptyWeek(report())).toBe(false);
  });

  it('names the AGFP categories rolled into one food bank line', () => {
    expect(rolledUpNames(report().lines[0]!)).toBe('Frozen Meat, Deli');
  });

  it('opens one drill-in at a time, and closes the open one', () => {
    expect(toggleDrillIn(null, 'agfp-1')).toBe('agfp-1');
    expect(toggleDrillIn('agfp-1', 'agfp-2')).toBe('agfp-2');
    expect(toggleDrillIn('agfp-1', 'agfp-1')).toBeNull();
  });
});

describe('the drill-in', () => {
  it('groups entries under their day, oldest first', () => {
    const days = groupEntriesByDay([
      entry({ id: 'b', day: '2026-07-30' }),
      entry({ id: 'a', day: '2026-07-28' }),
      entry({ id: 'c', day: '2026-07-28' }),
    ]);
    expect(days.map((day) => day.day)).toEqual(['2026-07-28', '2026-07-30']);
    expect(days[0]?.entries.map((each) => each.id)).toEqual(['a', 'c']);
    expect(days[0]?.label).toBe(formatDayLabel('2026-07-28'));
  });

  it('carries the four facts Success Metric 4 asks for', () => {
    const description = entryDescription(entry());
    expect(description).toContain("Sam's"); // store
    expect(description).toContain('Jul 28'); // day
    expect(description).toContain('Karen'); // receiver (I26)
    expect(description).toContain('293 lb'); // weight
  });

  it('says a walk-in came from nowhere in particular', () => {
    // An unscheduled donation has no shift by construction, so it has no route.
    expect(entrySource(entry({ shiftId: null, routeName: null }))).toBe(COPY.walkIn);
    expect(entrySource(entry())).toBe('Tue AM run');
  });

  it('puts the report switch on a donation and never on a weight', () => {
    // I15: scheduled intake is reportable by construction and carries no flag.
    expect(hasReportToggle(entry({ kind: 'DONATION' }))).toBe(true);
    expect(hasReportToggle(entry({ kind: 'WEIGHT' }))).toBe(false);
  });

  it('offers exactly two sides of the switch', () => {
    expect(reportableChoices().map((choice) => choice.value)).toEqual(['on', 'off']);
  });

  it('says which side of the report a donation landed on', () => {
    expect(reportableSavedText("Sam's", true)).toContain("Sam's");
    expect(reportableSavedText("Sam's", false)).toContain('own totals');
  });

  it('marks an unreported donation in its description', () => {
    const description = entryDescription(entry({ kind: 'DONATION', reportable: false }));
    expect(description).toContain(COPY.notReported);
  });
});

// ---------------------------------------------------------------------------
// The drill-in`s trash arithmetic (D27, D28)
//
// The bug this exists to prevent, and it is a silent one: since D27 the AGFP total
// above the entries is NET of the deduction, while the entries are what was
// weighed. One subtotal under them would disagree with the figure a few lines up
// by exactly the deduction, on the one panel a Reporter opens to check a number
// they doubt.
// ---------------------------------------------------------------------------

describe('the trash deduction, in the drill-in', () => {
  it('subtracts exactly, in integer cents', () => {
    expect(subtractWeights('827.00', '744.00')).toBe('83.00');
    expect(subtractWeights('0.30', '0.10')).toBe('0.20');
    expect(subtractWeights('12.00', 'nonsense')).toBeNull();
  });

  it('refuses to go below zero rather than showing a negative deduction', () => {
    // Whole-pound rounding can put a net a pound ABOVE the raw sum on a category
    // nobody deducts from. That is not a deduction, and three lines claiming it is
    // would be worse than the one line it replaces.
    expect(subtractWeights('744.00', '827.00')).toBeNull();
  });

  it('shows the arithmetic when the line is net of a deduction', () => {
    // The pantry's own sheet: 827 gross bakery at 10%, 83 deducted, 744 reported.
    const entries = [entry({ weight: '500.00' }), entry({ id: 'b', weight: '327.00' })];
    const totals = drillTotals(entries, '744.00');
    expect(totals.deduction).toEqual({ gross: '827.00', deducted: '83.00', net: '744.00' });
  });

  it('makes the three numbers close, whatever the rounding did', () => {
    // The deduction is DERIVED BY SUBTRACTION rather than recomputed from a rate,
    // so gross − deducted == net by construction. A second implementation of
    // `domain-modeling.md §5.4`'s rounding order here would be free to disagree
    // with the very figure it is explaining.
    const totals = drillTotals([entry({ weight: '3691.25' })], '3322.00');
    const { gross, deducted, net } = totals.deduction!;
    expect(subtractWeights(gross, deducted)).toBe(addWeights([net]));
  });

  it('counts only the reportable entries into the gross', () => {
    // A donation with the switch off is shown in the list and marked, but it never
    // reached the line above. Counting it here would inflate the "deduction" by
    // the amount somebody chose not to report.
    const entries = [
      entry({ weight: '827.00' }),
      entry({ id: 'off', kind: 'DONATION', weight: '100.00', reportable: false }),
    ];
    const totals = drillTotals(entries, '744.00');
    expect(totals.deduction?.gross).toBe('827.00');
    expect(totals.deduction?.deducted).toBe('83.00');
    // The subtotal over the rows still adds up every row on screen.
    expect(totals.shown).toBe('927.00');
  });

  it('leaves the other nine categories exactly as they were', () => {
    // No rate, no deduction, no extra lines: the panel shows the single subtotal
    // it always did.
    const totals = drillTotals([entry({ weight: '293.00' })], '293.00');
    expect(totals.deduction).toBeNull();
    expect(totals.shown).toBe('293.00');
  });

  it('shows no subtotal at all rather than a wrong one', () => {
    const totals = drillTotals([entry({ weight: 'nonsense' })], '293.00');
    expect(totals.shown).toBeNull();
    expect(totals.deduction).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Errors (§6)
// ---------------------------------------------------------------------------

describe('errors', () => {
  it('prefers the sentence the server sent, and never shows a code', () => {
    expect(messageFor(new ApiError('conflict', { detail: 'Someone matched it first.' }))).toBe(
      'Someone matched it first.',
    );
    expect(messageFor(new ApiError('server', { code: 'REPORT_BLOCKED' }))).not.toContain(
      'REPORT_BLOCKED',
    );
    expect(messageFor('a bare throw').length).toBeGreaterThan(0);
  });

  it('re-reads when someone else changed the week first', () => {
    expect(shouldReloadAfter(new ApiError('conflict'))).toBe(true);
    expect(shouldReloadAfter(new ApiError('not-found'))).toBe(true);
    expect(shouldReloadAfter(new ApiError('offline'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Copy (§7)
//
// The sweep covers the whole copy surface, not just the table: every sentence
// this screen composes from data goes through it too, because that is where a
// forbidden word would arrive without anyone typing it into `COPY`.
// ---------------------------------------------------------------------------

const COMPOSED: string[] = [
  BLOCKED_MESSAGE,
  formatDateRange('2026-12-28', '2027-01-03'),
  formatDayLabel('2026-07-28'),
  weightWithUnit('1222.35'),
  unmappedSummary([unmappedRow(), unmappedRow({ categoryName: 'Bakery' })]) ?? '',
  openRunsNotice([
    { shiftId: 's', routeName: 'Tue AM run', occurrenceDate: '2026-07-28', status: 'OPEN' },
  ]) ?? '',
  openRunLabel({
    shiftId: 's',
    routeName: 'Tue AM run',
    occurrenceDate: '2026-07-28',
    status: 'IN_PROGRESS',
  }),
  entryDescription(entry({ kind: 'DONATION', reportable: false })),
  entrySource(entry({ shiftId: null, routeName: null })),
  reportableSavedText("Sam's", true),
  reportableSavedText("Sam's", false),
  reportLineTitle({ ntfbCategoryName: 'Protein', ntfbCode: '14', storage: 'Frozen' }),
  ntfbLabel({ name: 'Protein', code: '14' }),
  // The receipt card composes several sentences from data, and that is where a
  // forbidden word arrives without anyone typing it into `COPY`.
  receiptDonorLabel(receipt()),
  receiptDonorLabel(receipt({ donorCode: null })),
  receiptLineLabel(receipt().lines[1]!),
  receiptLineLabel(line({ storage: '' })),
  receiptLineSource(receipt().lines[3]!),
  receiptEmptyText(receipt({ lines: [], notAttempted: true })) ?? '',
  noteAuthorLabel(note()),
  noteAuthorLabel(note({ role: 'COORDINATOR', author: null })),
  checkboxDescription(true, COPY.notAttemptedBox),
  ...(['COORDINATOR', 'DRIVER', 'STOP', 'RECEIVER', 'DONATION'] as const).map(noteRoleLabel),
  ...totalsView(report()).map((total) => total.label),
  // D35's check-off composes several sentences from data, which is where a
  // forbidden word arrives without anyone typing it into `COPY`.
  receiptRowTitle(receipt()),
  receiptRowDescription(receipt(), 'America/Chicago'),
  receiptRowDescription(submittedReceipt(), 'America/Chicago'),
  submittedLabel(receipt()),
  submittedLabel(submittedReceipt(), 'America/Chicago'),
  submittedLabel(receipt({ donorId: null })),
  submittedProgress(sheet()),
  submittedProgress(sheet({ receipts: [submittedReceipt()] })),
  submittedProgress(sheet({ receipts: [] })),
  markSubmittedQuestion(receipt()),
  rangeHeading({ from: '2026-07-27', to: '2026-08-02' }, '2026-07-29'),
  rangeHeading({ from: '2026-07-20', to: '2026-08-09' }, '2026-07-29'),
  ...reportableChoices().map((choice) => choice.label),
  ...['OPEN', 'CLAIMED', 'IN_PROGRESS', 'ANYTHING'].map(runStatusWord),
];

describe('microcopy', () => {
  const sentences = [...Object.values(COPY), ...COMPOSED];

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

  it('never promises an undo on a weight', () => {
    // §6: editing a weight looks like a plain overwrite. The void trail
    // underneath (I13) is the server's business and has no UI here.
    for (const sentence of sentences) {
      expect(sentence.toLowerCase()).not.toContain('undo');
      expect(sentence.toLowerCase()).not.toContain('version history');
    }
    // D35's check-off IS reversible — un-ticking is a DELETE — and says so in
    // plain words rather than borrowing the one word this screen reserves for the
    // thing it does not offer.
    expect(COPY.markConsequence.toLowerCase()).toContain('change it back');
  });

  it('never says or implies the file is submitted for them', () => {
    // D13, as a real receipt settled it: Meal Connect has no import. A Reporter
    // types the receipts in by hand, so the hint has to describe what is on screen
    // and must not suggest anything was sent.
    const hint = COPY.exportHint.toLowerCase();
    for (const promise of ['submitted', 'sends', 'sent to', 'uploads', 'uploaded']) {
      expect(hint).not.toContain(promise);
    }
    expect(hint).toContain('meal connect');
  });

  it('no longer prints the agency line anywhere (D25)', () => {
    // The person entering the submission is already signed in to the account it
    // belongs to, so the codes were one more line to read past. The `mealConnect`
    // field stays on the API shape; nothing on this screen reads it.
    expect(Object.keys(COPY)).not.toContain('exportAccount');
    for (const sentence of sentences) {
      expect(sentence).not.toContain('026357P');
      expect(sentence.toLowerCase()).not.toContain('under agency');
    }
  });

  it('keeps the words Meal Connect puts on its own form', () => {
    // The one place in R3 where somebody else's vocabulary beats ours: a Reporter
    // is matching a label on screen to a label on a web page, so renaming
    // `Storage Requirement` to something plainer would break the match.
    expect(COPY.colStorage).toBe('Storage Requirement');
    expect(COPY.itemCount).toBe('Number of Items');
    expect(COPY.totalPounds).toBe('Total Pounds');
    expect(COPY.notAttemptedBox).toBe('Scheduled Pickup Not Attempted');
    expect(COPY.noPoundsBox).toBe('No Pounds');
  });

  it('says the three trash numbers apart, and says why they differ (D21, D27)', () => {
    // §7 keeps "what a number means where two similar numbers sit together", and
    // three of them sit together here. The note is the only place on the screen
    // that says a deduction happened at all.
    const labels = [COPY.drillGrossLabel, COPY.drillDeductLabel, COPY.drillNetLabel];
    expect(new Set(labels).size).toBe(3);
    expect(COPY.drillDeductNote.toLowerCase()).toContain('never weighed');
    expect(COPY.drillDeductNote.toLowerCase()).toContain('does not change');
  });

  it('uses no em dash (D21)', () => {
    // Two sentences or a comma, never a hyphen swap. The one exception is not
    // prose: `DrillIn.tsx` draws a bare em dash as the empty-value glyph in the
    // weight keypad's draft line, which is a symbol rather than a sentence and is
    // not in this sweep.
    for (const sentence of sentences) expect(sentence).not.toContain('—');
  });

  it('marks our own half of the card as never typed into the portal (D29)', () => {
    // Without it, a Reporter has no way to know which lines are the portal's
    // fields and which are ours. It is the sentence that makes the rest of the
    // card safe to read top to bottom.
    expect(COPY.oursNote.toLowerCase()).toContain('meal connect');
    expect(COPY.oursNote.toLowerCase()).toContain('none of this');
  });

  it('cut the hints that only restated the control under them (D21)', () => {
    // Each of these was a sentence whose whole content was visible in the widget
    // it sat above. What survived the cut is anything a person could not
    // otherwise see: `intakeNote` and `unreportedNote` (locked §6 keeps intake
    // and NTFB-reported distinguishable) and, in Admin, `remapNotice`.
    const keys = Object.keys(COPY);
    for (const gone of ['pickerHint', 'tableHint', 'reportedNote', 'futureWeekNote']) {
      expect(keys).not.toContain(gone);
    }
    // D29 took the CSV and everything that only described a file.
    for (const gone of ['exportDone', 'exportedTitle', 'printing', 'printLabel']) {
      expect(keys).not.toContain(gone);
    }
    // D34 took the two remaining figure captions and `exportedNote`. The captions
    // were kept under D21 as the only place the two unions were distinguished in
    // words; the LABELS carry that now, and the assertion below holds them to it.
    for (const gone of ['intakeNote', 'unreportedNote', 'unreportedLabel', 'exportedNote']) {
      expect(keys).not.toContain(gone);
    }
  });

  it('keeps the export hint short enough to be read (D21)', () => {
    // It was the longest string in the app, and said three times over what the
    // column headings already say. What it must still carry is the check Meal
    // Connect's review screen offers before Submit.
    expect(COPY.exportHint.length).toBeLessThan(200);
    expect(COPY.exportHint).toContain('Meal Connect');
  });

  it('says who can clear the block, now that the Reporter cannot (D17)', () => {
    // The matching moved to Admin, so the primary button that used to sit in the
    // blocked state became a sentence about somewhere else. Leaving nothing at
    // all would strand a Reporter in front of a block with no next step.
    expect(COPY.matchingIsInAdmin.toLowerCase()).toContain('admin');
    expect(Object.keys(COPY)).not.toContain('goToMatching');
    expect(Object.keys(COPY)).not.toContain('tabMapping');
  });

  it('offers the print sheet as a sheet, not as a file that gets sent (D16)', () => {
    // Same rule as the export hint: nothing may imply Meal Connect receives
    // anything. "Save as PDF" is the browser's own wording and is what the
    // Reporter will look for in the dialogue.
    expect(COPY.print.toLowerCase()).toContain('pdf');
    expect(COPY.print.toLowerCase()).toContain('print');
    for (const promise of ['submitted', 'uploads', 'uploaded', 'sends']) {
      expect(COPY.print.toLowerCase()).not.toContain(promise);
    }
  });

  it('names both totals in full wherever they appear', () => {
    // With the captions gone (D34) these two labels ARE the key data boundary on
    // this screen, so neither may shorten to "Total".
    expect(COPY.reportedLabel.toLowerCase()).toContain('report');
    expect(COPY.intakeLabel.toLowerCase()).not.toContain('report');
    expect(COPY.intakeLabel.toLowerCase()).not.toBe('total');
  });

  it('offers one primary action, named for the job (D34)', () => {
    // Two buttons became one: "Export for Meal Connect" and "Print or save as PDF"
    // sat side by side, the second unusable until the first had been pressed, and
    // neither was what a reporter would call the thing they came to do.
    expect(COPY.export).toBe('Meal Connect Report');
  });
});
