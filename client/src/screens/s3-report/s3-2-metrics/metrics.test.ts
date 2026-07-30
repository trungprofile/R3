// S3.2's logic, tested where a wrong answer would be silent.
//
// There is NO browser test harness in this repo — no jsdom, no component renderer
// — and adding one would be a dependency no lane may add (`phase-3-build-plan.md
// §3`). So nothing here renders. What is covered is what a plausible-looking wrong
// number would hide:
//
//   - `previousIntake: null` rendering as a 100% drop, which is the failure the
//     shared type warns about in as many words;
//   - a displayed weight going through a float on its way to the screen (A165);
//   - UNCLAIMED and NO_SHOW being summed into one meaningless count;
//   - the period stepping back by something other than its own length, which
//     would stop matching the comparison the server measures trend against;
//   - a sentence on screen using a word §7 forbids.
//
// Run: npx vitest run --root client

import { describe, expect, it } from 'vitest';
import type {
  CoverageMetrics,
  DriverCoverage,
  IntakeMetrics,
  MissedRun,
  RouteCoverage,
  ShapedUser,
  StoreIntake,
} from '../../../api/shared.ts';
import {
  ANY_FILTER,
  barFor,
  barsFor,
  canGoLater,
  COPY,
  coverageCsv,
  coverageQueryFor,
  csvCell,
  csvFilename,
  csvRow,
  dayLabel,
  DEFAULT_PERIOD_DAYS,
  driverLine,
  driverOptions,
  driversByNoShows,
  failureExplainer,
  failureLabel,
  FORBIDDEN_IN_COPY,
  formatWeight,
  intakeCsv,
  isFiltered,
  maxIntake,
  PERIOD_PRESETS,
  periodFor,
  periodRangeLabel,
  plural,
  presetForDays,
  rangeLabel,
  rateLabel,
  routeLine,
  routeOptions,
  routesByFailures,
  routeFailureTotal,
  runOwnerLabel,
  startTimeLabel,
  storeKey,
  storesByIntake,
  TABS,
  trendFor,
  weightAsNumber,
  weightWithUnit,
} from './metrics.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function store(overrides: Partial<StoreIntake> = {}): StoreIntake {
  return {
    donorId: 'd1',
    donorName: 'Kroger Elm St',
    intake: '1000.00',
    reported: '600.00',
    unreported: '400.00',
    previousIntake: '800.00',
    ...overrides,
  };
}

function intake(overrides: Partial<IntakeMetrics> = {}): IntakeMetrics {
  return {
    from: '2026-03-03',
    to: '2026-03-30',
    stores: [store()],
    totalIntake: '1000.00',
    totalReported: '600.00',
    totalUnreported: '400.00',
    previousFrom: '2026-02-03',
    previousTo: '2026-03-02',
    ...overrides,
  };
}

function run(overrides: Partial<MissedRun> = {}): MissedRun {
  return {
    shiftId: 's1',
    failure: 'UNCLAIMED',
    occurrenceDate: '2026-03-10',
    startsAt: '2026-03-10T15:00:00.000Z',
    routeId: 'r1',
    routeName: 'Tuesday Morning',
    ownerId: null,
    ownerName: null,
    ...overrides,
  };
}

function coverage(overrides: Partial<CoverageMetrics> = {}): CoverageMetrics {
  return {
    from: '2026-03-03',
    to: '2026-03-30',
    runs: [run()],
    unclaimedCount: 1,
    noShowCount: 0,
    scheduledCount: 21,
    byDriver: [],
    byRoute: [{ routeId: 'r1', routeName: 'Tuesday Morning', unclaimed: 1, noShows: 0 }],
    ...overrides,
  };
}

function user(overrides: Partial<ShapedUser> = {}): ShapedUser {
  return {
    id: 'u1',
    username: 'karensmith',
    firstName: 'Karen',
    lastName: 'Smith',
    tier: 'VOLUNTEER',
    duties: ['DRIVE'],
    active: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Weights — printed as text, never as arithmetic (A165)
// ---------------------------------------------------------------------------

describe('weights', () => {
  it('reads a numeric(8,2) string the way a person does', () => {
    expect(formatWeight('2192.00')).toBe('2192');
    expect(formatWeight('12.50')).toBe('12.5');
    expect(formatWeight('12.05')).toBe('12.05');
    expect(formatWeight('0.00')).toBe('0');
    expect(formatWeight('640')).toBe('640');
  });

  it('always shows the unit (§7)', () => {
    expect(weightWithUnit('1222.35')).toBe('1222.35 lb');
  });

  it('does not round-trip a displayed figure through a float', () => {
    // The number that motivates the rule: `Number('1222.35')` is not 1222.35.
    const exact = '99999.99';
    expect(formatWeight(exact)).toBe('99999.99');
    expect(weightWithUnit(exact)).toBe('99999.99 lb');
  });

  it('parses only for geometry, and never fails the chart on one odd row', () => {
    expect(weightAsNumber('1000.00')).toBe(1000);
    expect(weightAsNumber('')).toBe(0);
    expect(weightAsNumber('not a weight')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The period (A179)
// ---------------------------------------------------------------------------

describe('the period', () => {
  it('defaults to the last 28 days, the same window the server would pick', () => {
    expect(DEFAULT_PERIOD_DAYS).toBe(28);
    expect(periodFor('2026-03-30', DEFAULT_PERIOD_DAYS)).toEqual({
      from: '2026-03-03',
      to: '2026-03-30',
    });
  });

  it('steps back by the period’s own length, which is what trend compares against', () => {
    const current = intake();
    const earlier = periodFor('2026-03-30', 28, 1);
    // The server's `previousFrom`/`previousTo` for the current window. Stepping
    // back once must land exactly on it, or "Earlier" would show a period the
    // trend column was never measured against.
    expect(earlier).toEqual({ from: current.previousFrom, to: current.previousTo });
  });

  it('steps back further without overlapping', () => {
    expect(periodFor('2026-03-30', 7, 0)).toEqual({ from: '2026-03-24', to: '2026-03-30' });
    expect(periodFor('2026-03-30', 7, 1)).toEqual({ from: '2026-03-17', to: '2026-03-23' });
    expect(periodFor('2026-03-30', 7, 2)).toEqual({ from: '2026-03-10', to: '2026-03-16' });
  });

  it('crosses a month and a year boundary by the calendar, not by 30-day months', () => {
    expect(periodFor('2026-01-05', 28)).toEqual({ from: '2025-12-09', to: '2026-01-05' });
  });

  it('offers whole weeks only, so the comparison stays like-for-like', () => {
    for (const preset of PERIOD_PRESETS) {
      expect(preset.days % 7).toBe(0);
      expect(preset.value).toBe(String(preset.days));
    }
    expect(presetForDays(28)?.label).toBe('4 weeks');
    expect(presetForDays(31)).toBeNull();
  });

  it('does not offer a period later than today', () => {
    expect(canGoLater(0)).toBe(false);
    expect(canGoLater(1)).toBe(true);
  });
});

describe('date labels', () => {
  it('repeats the month only when it changes', () => {
    expect(rangeLabel('2026-03-03', '2026-03-30')).toBe('March 3 – 30, 2026');
    expect(rangeLabel('2026-03-03', '2026-04-06')).toBe('March 3 – April 6, 2026');
  });

  it('names both years when the range crosses one', () => {
    expect(rangeLabel('2025-12-30', '2026-01-26')).toBe('December 30, 2025 – January 26, 2026');
  });

  it('labels a period from its own bounds', () => {
    expect(periodRangeLabel({ from: '2026-03-03', to: '2026-03-30' })).toBe('March 3 – 30, 2026');
  });

  it('reads a YYYY-MM-DD as a local day, not a UTC instant', () => {
    // `new Date('2026-03-01')` is midnight UTC and prints as February 28 for
    // anyone west of Greenwich. A missed run's date is a pantry-local slot.
    expect(dayLabel('2026-03-01')).toBe('March 1, 2026');
  });

  it('states a run’s time in the pantry’s zone, not the machine’s', () => {
    // Same instant, two zones. The pantry's is the one that means anything: a 9am
    // run is 9am at the pantry, not on whatever desktop is reading the metrics.
    expect(startTimeLabel('2026-03-03T15:00:00.000Z', 'America/Chicago')).toBe('9:00 AM');
    expect(startTimeLabel('2026-03-03T15:00:00.000Z', 'UTC')).toBe('3:00 PM');
  });

  it('follows the zone across a daylight-saving change', () => {
    // 2026's US change is March 8. The same 15:00Z is 9am before it and 10am
    // after, and the zone — not a fixed offset — is what knows that.
    expect(startTimeLabel('2026-03-10T15:00:00.000Z', 'America/Chicago')).toBe('10:00 AM');
  });

  it('says nothing rather than "Invalid Date" for a time it cannot read', () => {
    expect(startTimeLabel('not a time', 'UTC')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Trend — the null-is-not-zero rule
// ---------------------------------------------------------------------------

describe('trend', () => {
  it('has NO trend for a store with no prior period, and states no percentage', () => {
    const trend = trendFor('500.00', null);
    expect(trend.direction).toBe('NO_HISTORY');
    expect(trend.percent).toBeNull();
    expect(trend.label).not.toContain('%');
    expect(trend.label).toBe(COPY.intake.trendNone);
  });

  it('never renders a missing prior period as a 100% drop', () => {
    // The exact failure `shared/src/metrics.ts` warns about: a store that did not
    // exist last period has no trend, not a catastrophic one.
    const absent = trendFor('0.00', null);
    expect(absent.direction).not.toBe('DOWN');
    expect(absent.percent).not.toBe(-100);
  });

  it('does report a real collapse as one', () => {
    const collapsed = trendFor('0.00', '800.00');
    expect(collapsed.direction).toBe('DOWN');
    expect(collapsed.percent).toBe(-100);
    expect(collapsed.label).toBe('down 100%');
  });

  it('reads a rise and a fall as whole percents', () => {
    expect(trendFor('1000.00', '800.00').label).toBe('up 25%');
    expect(trendFor('600.00', '800.00').label).toBe('down 25%');
  });

  it('calls an unchanged store unchanged', () => {
    const level = trendFor('800.00', '800.00');
    expect(level.direction).toBe('LEVEL');
    expect(level.label).toBe(COPY.intake.trendLevel);
  });

  it('does not say "0%" for a store that moved slightly', () => {
    const tiny = trendFor('800.20', '800.00');
    expect(tiny.direction).toBe('UP');
    expect(tiny.label).toBe(COPY.intake.trendUpTiny);
    expect(tiny.label).not.toContain('0%');
  });

  it('says a rise from nothing in words, because a percentage of zero is not a number', () => {
    const fromNothing = trendFor('500.00', '0.00');
    expect(fromNothing.direction).toBe('UP');
    expect(fromNothing.percent).toBeNull();
    expect(fromNothing.label).toBe(COPY.intake.trendUpFromNothing);
  });

  it('treats zero against zero as no change, not as a rise', () => {
    expect(trendFor('0.00', '0.00').direction).toBe('LEVEL');
  });
});

// ---------------------------------------------------------------------------
// Bars — geometry only
// ---------------------------------------------------------------------------

describe('bars', () => {
  it('scales every bar against the largest intake in the period', () => {
    const stores = [
      store({ donorId: 'a', donorName: 'A', intake: '1000.00', reported: '500.00' }),
      store({ donorId: 'b', donorName: 'B', intake: '250.00', reported: '250.00' }),
    ];
    expect(maxIntake(stores)).toBe(1000);
    const bars = barsFor(stores);
    expect(bars[0]?.widthPercent).toBe(100);
    expect(bars[1]?.widthPercent).toBe(25);
  });

  it('splits each bar into reported and not, which is the boundary drawn', () => {
    const bar = barFor(store({ intake: '1000.00', reported: '600.00' }), 1000);
    expect(bar.reportedPercent).toBe(60);
  });

  it('draws nothing rather than dividing by zero', () => {
    const empty = barFor(store({ intake: '0.00', reported: '0.00' }), 0);
    expect(empty.widthPercent).toBe(0);
    expect(empty.reportedPercent).toBe(0);
  });

  it('never draws past the end of the track', () => {
    // Defensive: `reported` should never exceed `intake`, but a bar wider than its
    // own track would break the layout rather than announce the anomaly.
    const odd = barFor(store({ intake: '100.00', reported: '150.00' }), 50);
    expect(odd.widthPercent).toBe(100);
    expect(odd.reportedPercent).toBe(100);
  });

  it('orders stores by intake, with the name breaking a tie so reloads agree', () => {
    const stores = [
      store({ donorId: 'b', donorName: 'Zeta', intake: '500.00' }),
      store({ donorId: 'a', donorName: 'Alpha', intake: '500.00' }),
      store({ donorId: 'c', donorName: 'Big', intake: '900.00' }),
    ];
    expect(storesByIntake(stores).map((each) => each.donorName)).toEqual([
      'Big',
      'Alpha',
      'Zeta',
    ]);
  });

  it('keys a labelled donation that has no donor id', () => {
    expect(storeKey(store({ donorId: 'd1' }))).toBe('d1');
    expect(storeKey(store({ donorId: null, donorName: 'Unattributed' }))).toBe(
      'label:Unattributed',
    );
  });
});

// ---------------------------------------------------------------------------
// Coverage — the split is the whole value (I7)
// ---------------------------------------------------------------------------

describe('coverage', () => {
  it('names the two failures separately and explains each', () => {
    expect(failureLabel('UNCLAIMED')).toBe('Unclaimed');
    expect(failureLabel('NO_SHOW')).toBe('No-show');
    expect(failureExplainer('UNCLAIMED')).not.toBe(failureExplainer('NO_SHOW'));
  });

  it('never rolls the two counts into one number', () => {
    const data = coverage({ unclaimedCount: 3, noShowCount: 2 });
    // A route line carries both, side by side, and neither is their sum.
    const line = routeLine({ routeId: 'r', routeName: 'R', unclaimed: 3, noShows: 2 });
    expect(line).toContain('3 unclaimed');
    expect(line).toContain('2 no-shows');
    expect(line).not.toContain('5');
    expect(data.unclaimedCount + data.noShowCount).toBe(5); // the number nobody shows
  });

  it('turns a count into a rate with the denominator, and refuses to when there is none', () => {
    expect(rateLabel(3, 21)).toBe('3 of 21 scheduled runs');
    expect(rateLabel(1, 1)).toBe('1 of 1 scheduled run');
    expect(rateLabel(0, 0)).toBeNull();
  });

  it('counts in plain plurals', () => {
    expect(plural(1, 'no-show', 'no-shows')).toBe('1 no-show');
    expect(plural(0, 'no-show', 'no-shows')).toBe('0 no-shows');
  });

  it('states a driver’s count and stops there', () => {
    const driver: DriverCoverage = { ownerId: 'u1', ownerName: 'Karen Smith', noShows: 3 };
    expect(driverLine(driver)).toBe('3 no-shows');
    // §7: plain and non-judgemental. No verdict on the person is composed here.
    expect(driverLine(driver).toLowerCase()).not.toContain('flake');
    expect(driverLine(driver).toLowerCase()).not.toContain('unreliable');
  });

  it('orders drivers by no-shows, name ascending on a tie', () => {
    const drivers: DriverCoverage[] = [
      { ownerId: '2', ownerName: 'Zoe', noShows: 1 },
      { ownerId: '3', ownerName: 'Alan', noShows: 1 },
      { ownerId: '1', ownerName: 'Karen', noShows: 3 },
    ];
    expect(driversByNoShows(drivers).map((each) => each.ownerName)).toEqual([
      'Karen',
      'Alan',
      'Zoe',
    ]);
  });

  it('orders routes by both failures together, name ascending on a tie', () => {
    const routes: RouteCoverage[] = [
      { routeId: '1', routeName: 'Zeta', unclaimed: 1, noShows: 1 },
      { routeId: '2', routeName: 'Alpha', unclaimed: 2, noShows: 0 },
      { routeId: '3', routeName: 'Busy', unclaimed: 3, noShows: 2 },
    ];
    expect(routeFailureTotal(routes[2] as RouteCoverage)).toBe(5);
    expect(routesByFailures(routes).map((each) => each.routeName)).toEqual([
      'Busy',
      'Alpha',
      'Zeta',
    ]);
  });

  it('says nobody took an unclaimed run rather than leaving the cell blank', () => {
    expect(runOwnerLabel(run({ ownerName: null }))).toBe(COPY.coverage.nobodyClaimed);
    expect(runOwnerLabel(run({ ownerName: 'Karen Smith' }))).toBe('Karen Smith');
  });

  it('leaves the sorts alone when there is nothing to sort', () => {
    expect(driversByNoShows([])).toEqual([]);
    expect(routesByFailures([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

describe('filters', () => {
  it('offers drivers only — duty is set membership (I2), never implied by a tier', () => {
    const options = driverOptions([
      user({ id: 'u1', firstName: 'Karen', lastName: 'Smith', duties: ['DRIVE'] }),
      user({ id: 'u2', firstName: 'Ray', lastName: 'Ortiz', duties: ['RECEIVE'] }),
      user({ id: 'u3', firstName: 'Ann', lastName: 'Ng', tier: 'ADMIN', duties: [] }),
    ]);
    expect(options.map((each) => each.value)).toEqual([ANY_FILTER, 'u1']);
  });

  it('keeps a deactivated driver, because their missed runs are still in range', () => {
    const options = driverOptions([
      user({ id: 'u1', firstName: 'Karen', lastName: 'Smith', active: false }),
    ]);
    expect(options.map((each) => each.value)).toContain('u1');
  });

  it('sorts both pickers by name, with the "any" choice first', () => {
    const drivers = driverOptions([
      user({ id: 'u2', firstName: 'Zoe', lastName: 'Adams' }),
      user({ id: 'u1', firstName: 'Alan', lastName: 'Bell' }),
    ]);
    expect(drivers.map((each) => each.label)).toEqual(['Any driver', 'Alan Bell', 'Zoe Adams']);

    const routes = routeOptions([
      { id: 'r2', name: 'Thursday Evening' },
      { id: 'r1', name: 'Monday Morning' },
    ]);
    expect(routes.map((each) => each.label)).toEqual([
      'Any route',
      'Monday Morning',
      'Thursday Evening',
    ]);
  });

  it('omits an unset filter rather than sending it', () => {
    const period = { from: '2026-03-03', to: '2026-03-30' };
    expect(coverageQueryFor(period, ANY_FILTER, ANY_FILTER)).toEqual({
      from: '2026-03-03',
      to: '2026-03-30',
    });
    expect(coverageQueryFor(period, 'u1', ANY_FILTER)).toEqual({
      from: '2026-03-03',
      to: '2026-03-30',
      driverId: 'u1',
    });
    expect(coverageQueryFor(period, 'u1', 'r1').routeId).toBe('r1');
  });

  it('knows when a filter is narrowing the table', () => {
    expect(isFiltered(ANY_FILTER, ANY_FILTER)).toBe(false);
    expect(isFiltered('u1', ANY_FILTER)).toBe(true);
    expect(isFiltered(ANY_FILTER, 'r1')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Export (S3.2: "read + export")
// ---------------------------------------------------------------------------

describe('export', () => {
  it('quotes a cell that would otherwise split into two columns', () => {
    expect(csvCell('Kroger Elm St')).toBe('Kroger Elm St');
    expect(csvCell('Kroger, Elm St')).toBe('"Kroger, Elm St"');
    expect(csvCell('The "big" one')).toBe('"The ""big"" one"');
    expect(csvRow(['a', 'b,c'])).toBe('a,"b,c"');
  });

  it('keeps intake, reported and unreported as three columns', () => {
    const csv = intakeCsv(intake());
    const header = csv.split('\r\n')[0] ?? '';
    expect(header).toContain('Intake (lb)');
    expect(header).toContain('Reported to food bank (lb)');
    expect(header).toContain('Not reported (lb)');
  });

  it('writes the weight it was given, digit for digit', () => {
    const csv = intakeCsv(
      intake({
        stores: [store({ intake: '1222.35', reported: '1222.35', unreported: '0.00' })],
        totalIntake: '1222.35',
        totalReported: '1222.35',
        totalUnreported: '0.00',
      }),
    );
    expect(csv).toContain('1222.35');
    expect(csv).not.toContain('1222.3500');
  });

  it('carries the totals row the screen shows', () => {
    expect(intakeCsv(intake())).toContain(COPY.intake.totalsRow);
  });

  it('writes one row per missed run, with what happened spelled out', () => {
    const csv = coverageCsv(
      coverage({
        runs: [
          run({ shiftId: 's1', failure: 'UNCLAIMED', ownerName: null }),
          run({ shiftId: 's2', failure: 'NO_SHOW', ownerId: 'u1', ownerName: 'Karen Smith' }),
        ],
      }),
      'UTC',
    );
    const lines = csv.trimEnd().split('\r\n');
    expect(lines).toHaveLength(3); // header + two runs
    expect(lines[1]).toContain('Unclaimed');
    expect(lines[2]).toContain('No-show');
    expect(lines[2]).toContain('Karen Smith');
  });

  it('names the file after the period, so two downloads do not collide', () => {
    expect(csvFilename('intake', { from: '2026-03-03', to: '2026-03-30' })).toBe(
      'metrics-intake-2026-03-03-to-2026-03-30.csv',
    );
  });
});

// ---------------------------------------------------------------------------
// Microcopy (§7)
//
// The sweep covers the WHOLE copy surface: every fixed string in `COPY`, and
// every sentence the screen composes from data. A forbidden word is just as
// forbidden when it arrives through a template.
// ---------------------------------------------------------------------------

function fixedStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (value !== null && typeof value === 'object') {
    return Object.values(value).flatMap(fixedStrings);
  }
  return []; // functions are swept below, called with representative data
}

const COMPOSED = [
  COPY.intake.comparedWith('2026-02-03', '2026-03-02'),
  trendFor('1000.00', '800.00').label,
  trendFor('600.00', '800.00').label,
  trendFor('800.00', '800.00').label,
  trendFor('500.00', null).label,
  trendFor('500.00', '0.00').label,
  trendFor('800.20', '800.00').label,
  driverLine({ ownerId: 'u1', ownerName: 'Karen Smith', noShows: 3 }),
  routeLine({ routeId: 'r1', routeName: 'Tuesday Morning', unclaimed: 2, noShows: 1 }),
  rateLabel(3, 21) ?? '',
  failureLabel('UNCLAIMED'),
  failureLabel('NO_SHOW'),
  failureExplainer('UNCLAIMED'),
  failureExplainer('NO_SHOW'),
  runOwnerLabel(run({ ownerName: null })),
  rangeLabel('2026-03-03', '2026-03-30'),
  rangeLabel('2025-12-30', '2026-01-26'),
  dayLabel('2026-03-10'),
  weightWithUnit('1222.35'),
  plural(1, 'no-show', 'no-shows'),
  ...TABS.map((tab) => tab.label),
  ...PERIOD_PRESETS.map((preset) => preset.label),
  COPY.coverage.anyDriver,
  COPY.coverage.anyRoute,
];

describe('microcopy', () => {
  const sentences = [...fixedStrings(COPY), ...COMPOSED];

  it('says something everywhere', () => {
    expect(sentences.length).toBeGreaterThan(40);
    for (const sentence of sentences) expect(sentence.length).toBeGreaterThan(0);
  });

  it('uses no forbidden word (§7), composed sentences included', () => {
    for (const sentence of sentences) {
      for (const word of FORBIDDEN_IN_COPY) {
        expect(sentence.toLowerCase()).not.toContain(word);
      }
    }
  });

  it('labels intake and food-bank-reported as two distinct numbers (PRD §3)', () => {
    expect(COPY.intake.colIntake).not.toBe(COPY.intake.colReported);
    expect(COPY.intake.colUnreported).not.toBe(COPY.intake.colReported);
    // The screen says the boundary out loud rather than leaving it to be inferred
    // from two column headings.
    expect(COPY.intake.lede.toLowerCase()).toContain('different numbers');
  });

  it('reads an empty missed-runs period as the good news it is', () => {
    expect(COPY.coverage.emptyTitle).toBe('No missed runs in this period.');
    expect(COPY.coverage.emptyBody.toLowerCase()).toContain('cancelled');
  });

  it('has exactly S3.2’s two tabs', () => {
    expect(TABS.map((tab) => tab.value)).toEqual(['intake', 'coverage']);
  });
});
