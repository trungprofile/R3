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
  CategoryMapping,
  NtfbCategory,
  ReportEntry,
  UnmappedCategory,
  WeeklyReport,
} from '../../../api/shared.ts';
import {
  BLOCKED_MESSAGE,
  COPY,
  FORBIDDEN_IN_COPY,
  acceptKeypadValue,
  addDaysIso,
  addWeights,
  canExport,
  canSaveWeight,
  entriesTotal,
  entryDescription,
  entrySource,
  exportFilename,
  formatDayLabel,
  formatWeekRange,
  formatWeight,
  groupEntriesByDay,
  hasReportToggle,
  isCurrentWeek,
  isEmptyWeek,
  isFutureWeek,
  isoWeekday,
  mappedCountLabel,
  mappingRows,
  mappingSavedText,
  mappingTargetLabel,
  messageFor,
  missingItems,
  nextWeek,
  normalizeCode,
  normalizeWeight,
  ntfbLabel,
  ntfbNameError,
  ntfbRemovalText,
  openRunLabel,
  openRunsNotice,
  pickerOptions,
  previousWeek,
  reportState,
  reportableChoices,
  reportableSavedText,
  rolledUpNames,
  runStatusWord,
  shouldReloadAfter,
  sortNtfbCategories,
  toggleDrillIn,
  totalsView,
  unmappedSummary,
  weekLabel,
  weekStartOf,
  weightError,
  weightWithUnit,
} from './report.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function report(over: Partial<WeeklyReport> = {}): WeeklyReport {
  return {
    weekStart: '2026-07-27',
    weekEnd: '2026-08-02',
    lines: [
      {
        ntfbCategoryId: 'ntfb-1',
        ntfbCategoryName: 'Protein',
        ntfbCode: '14',
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

function mapping(over: Partial<CategoryMapping> = {}): CategoryMapping {
  return {
    categoryId: 'agfp-1',
    categoryName: 'Frozen Meat',
    categoryActive: true,
    ntfbCategoryId: 'ntfb-1',
    ntfbCategoryName: 'Protein',
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

  it('names the week in words where it can, and by its range otherwise', () => {
    expect(weekLabel('2026-07-27', '2026-07-30')).toBe(COPY.thisWeekHeading);
    expect(weekLabel('2026-07-20', '2026-07-30')).toBe(COPY.lastWeekHeading);
    expect(weekLabel('2026-08-10', '2026-07-30')).toBe(COPY.futureWeekHeading);
    expect(weekLabel('2026-06-01', '2026-07-30')).toBeNull();
  });

  it('says which boundary the week used, at both ends', () => {
    // A178 chose Monday-to-Sunday with no doc to lean on, so the range has to
    // show its working rather than leave a Reporter to infer it.
    const range = formatWeekRange('2026-07-27', '2026-08-02');
    expect(range).toContain('Mon');
    expect(range).toContain('Sun');
    expect(range).toContain('Jul 27');
    expect(range).toContain('Aug 2');
    expect(range).toContain('2026');
  });

  it('states both years when a week straddles new year', () => {
    expect(formatWeekRange('2026-12-28', '2027-01-03')).toContain('2026');
    expect(formatWeekRange('2026-12-28', '2027-01-03')).toContain('2027');
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
  it('emits all three, each with its own words', () => {
    const totals = totalsView(report());
    expect(totals.map((total) => total.key)).toEqual(['reported', 'unreported', 'intake']);
    expect(totals.map((total) => total.value)).toEqual(['324.00', '100.00', '424.00']);
    for (const total of totals) {
      expect(total.label.length).toBeGreaterThan(0);
      expect(total.note.length).toBeGreaterThan(0);
    }
  });

  it('never gives reported and intake the same label', () => {
    // PRD §3 keeps them "distinct and clearly labeled everywhere", and this is
    // the screen most likely to blur them.
    const labels = totalsView(report()).map((total) => total.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) expect(label.toLowerCase()).not.toBe('total');
  });

  it('marks exactly one figure as the one the file carries', () => {
    const primary = totalsView(report()).filter((total) => total.primary);
    expect(primary).toHaveLength(1);
    expect(primary[0]?.key).toBe('reported');
  });

  it('passes the figures the server sent through untouched', () => {
    const totals = totalsView(report({ reportedTotal: '1222.35' }));
    expect(totals[0]?.value).toBe('1222.35');
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

  it('names the downloaded file after the week it covers', () => {
    expect(exportFilename('2026-07-27', '2026-08-02')).toBe(
      'agfp-ntfb-2026-07-27-to-2026-08-02.csv',
    );
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
// The matching editor (D11, D12)
// ---------------------------------------------------------------------------

describe('the matching editor', () => {
  it('puts the categories blocking the export at the top', () => {
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
    // would bury the row the Reporter came to fix.
    expect(rows.map((row) => row.categoryId)).toEqual(['agfp-3', 'agfp-2', 'agfp-1']);
    expect(rows[0]?.blockingWeight).toBe('1222.35');
    expect(rows[1]?.blockingWeight).toBeNull();
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
    expect(mappingTargetLabel(matched!)).toBe('Protein');
    expect(mappingTargetLabel(unmatched!)).toBe(COPY.notMatched);
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
    expect(normalizeCode('  ')).toBeNull();
    expect(normalizeCode(' 14 ')).toBe('14');
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
  formatWeekRange('2026-12-28', '2027-01-03'),
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
  mappingSavedText('Produce', null),
  mappingSavedText('Produce', 'Protein'),
  mappingTargetLabel(mappingRows([mapping({ ntfbCategoryId: null, ntfbCategoryName: null })], [])[0]!),
  mappedCountLabel(ntfb({ mappedCount: 3 })),
  ntfbLabel({ name: 'Protein', code: '14' }),
  ntfbRemovalText('Protein', 'DELETED'),
  ntfbRemovalText('Protein', 'DEACTIVATED'),
  exportFilename('2026-07-27', '2026-08-02'),
  ...totalsView(report()).flatMap((total) => [total.label, total.note]),
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
  });

  it('never presents the export columns as the authoritative Meal Connect shape', () => {
    // D13: "Meal Connect format" is named by the PRD and defined nowhere in this
    // repo. The copy has to say the columns are a guess.
    expect(COPY.exportHint.toLowerCase()).toContain('guess');
  });

  it('names both totals in full wherever they appear', () => {
    expect(COPY.reportedLabel.toLowerCase()).toContain('report');
    expect(COPY.intakeLabel.toLowerCase()).not.toContain('report');
    expect(COPY.unreportedLabel.toLowerCase()).toContain('not reported');
  });
});
