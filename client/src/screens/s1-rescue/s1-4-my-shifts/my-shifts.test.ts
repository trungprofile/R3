// S1.4's logic, tested where a wrong answer would be silent.
//
// There is NO browser test harness in this repo — no jsdom, no component renderer
// — and adding one would be a dependency (build-plan §3/D5). So nothing here
// renders: these cover the calendar arithmetic, the past/future split, the request
// the form builds and the sentences it shows. What is not covered is stated in the
// report rather than implied by a green run.
//
// Instants are built with `new Date(y, m, d, h, min)` — the DEVICE's zone, the same
// frame `logic.ts` renders them in — so the assertions hold under any TZ the suite
// happens to run in.
//
// Run: npx vitest run --root client

import { describe, expect, it } from 'vitest';
import {
  COPY,
  EMPTY_FORM,
  addDaysIso,
  bandRuns,
  buildDeclaration,
  compareIso,
  daysBetweenIso,
  describeBlock,
  failureMessage,
  formatDayLabel,
  formatRunHours,
  formatRunWhen,
  formatTimeLabel,
  groupBlocks,
  isDayInRange,
  minutesOfTime,
  monthGrid,
  nextMonth,
  parseIsoDate,
  pickDay,
  previousMonth,
  summarySentence,
  timeOptions,
  todayIso,
  validateForm,
} from './logic.ts';
import type { AwayForm } from './logic.ts';
import { ApiError } from '../../../api/index.ts';
import type { AvailabilityBlockSummary, ShiftSummary } from '../../../api/shared.ts';

const NOW = new Date(2026, 7, 3, 9, 30); // Mon 3 Aug 2026, 9:30am local

function instant(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
): string {
  return new Date(year, month - 1, day, hour, minute).toISOString();
}

function block(
  id: string,
  startsAt: string,
  endsAt: string,
): AvailabilityBlockSummary {
  return { id, userId: 'me', startsAt, endsAt, createdAt: startsAt };
}

function run(overrides: Partial<ShiftSummary> = {}): ShiftSummary {
  return {
    id: 's1',
    routeId: 'r1',
    routeName: 'North loop',
    occurrenceDate: '2026-08-04',
    startsAt: instant(2026, 8, 4, 9, 0),
    endsAt: instant(2026, 8, 4, 12, 0),
    status: 'CLAIMED',
    ownerId: 'me',
    ownerName: 'Karen Holt',
    truckName: null,
    recurrencePatternId: null,
    assignedOverConflict: false,
    staffNote: null,
    note: null,
    pickupCompletedAt: null,
    ...overrides,
  };
}

describe('calendar arithmetic (no zone involved)', () => {
  it('parses and rejects dates', () => {
    expect(parseIsoDate('2026-08-04')).toEqual({ year: 2026, month: 8, day: 4 });
    expect(parseIsoDate('2026-02-31')).toBeNull();
    expect(parseIsoDate('4 Aug')).toBeNull();
  });

  it('adds days across a month and a year boundary', () => {
    expect(addDaysIso('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysIso('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('counts days between dates', () => {
    expect(daysBetweenIso('2026-08-03', '2026-08-07')).toBe(4);
    expect(daysBetweenIso('2026-08-03', '2026-08-03')).toBe(0);
  });

  it('orders ISO dates as text', () => {
    expect(compareIso('2026-08-03', '2026-08-04')).toBe(-1);
    expect(compareIso('2026-09-01', '2026-08-31')).toBe(1);
  });

  it('reads the device day', () => {
    expect(todayIso(NOW)).toBe('2026-08-03');
  });

  it('builds a six-week grid starting on the Sunday before the first', () => {
    const grid = monthGrid(2026, 8);
    expect(grid).toHaveLength(6);
    expect(grid.every((week) => week.length === 7)).toBe(true);
    // 1 Aug 2026 is a Saturday, so the grid opens on Sun 26 Jul.
    expect(grid[0]?.[0]?.iso).toBe('2026-07-26');
    expect(grid[0]?.[0]?.inMonth).toBe(false);
    expect(grid[0]?.[6]?.iso).toBe('2026-08-01');
    expect(grid[0]?.[6]?.inMonth).toBe(true);
  });

  it('steps months across the year boundary', () => {
    expect(nextMonth(2026, 12)).toEqual({ year: 2027, month: 1 });
    expect(previousMonth(2026, 1)).toEqual({ year: 2025, month: 12 });
  });

  it('labels a day, adding the year only when it is not this one', () => {
    expect(formatDayLabel('2026-08-04', NOW)).toBe('Tue, Aug 4');
    expect(formatDayLabel('2027-01-01', NOW)).toBe('Fri, Jan 1, 2027');
  });
});

describe('wall clock', () => {
  it('offers half-hour steps through the working day', () => {
    const options = timeOptions();
    expect(options[0]).toBe('05:00');
    expect(options.at(-1)).toBe('22:00');
    expect(options).toContain('09:30');
    expect(minutesOfTime('09:30')).toBe(570);
  });

  it('renders 12-hour clock labels', () => {
    expect(formatTimeLabel('09:00')).toBe('9:00 AM');
    expect(formatTimeLabel('12:00')).toBe('12:00 PM');
    expect(formatTimeLabel('00:30')).toBe('12:30 AM');
    expect(formatTimeLabel('13:45')).toBe('1:45 PM');
  });
});

describe('today, then this week (D49)', () => {
  // The pantry week NOW falls in: Mon 3 Aug – Sun 9 Aug 2026.
  const TODAY = '2026-08-03';
  const WEEK_START = '2026-08-03';
  const WEEK_END = '2026-08-09';

  /** A run on a given pantry-local calendar slot. Only `occurrenceDate` decides the
   *  band, which is the point — no clock is consulted anywhere below. */
  function on(date: string, over: Partial<ShiftSummary> = {}): ShiftSummary {
    return run({ occurrenceDate: date, id: date, ...over });
  }

  it("puts today's runs in their own band and the rest of the week in the other", () => {
    const bands = bandRuns(
      [on('2026-08-06'), on('2026-08-03'), on('2026-08-01')],
      TODAY,
      WEEK_START,
      WEEK_END,
    );
    expect(bands.today.map((r) => r.id)).toEqual(['2026-08-03']);
    // Saturday the 1st is outside the Mon-to-Sun week, so it is not in the band.
    expect(bands.week.map((r) => r.id)).toEqual(['2026-08-06']);
  });

  it('keeps the days already gone in This week, completed and upcoming together', () => {
    // The old split hid them under "Earlier". "Did I do Monday?" is a question this
    // screen has to answer, and Monday is part of this week whether or not it is over.
    const bands = bandRuns(
      [on('2026-08-04'), on('2026-08-07')],
      '2026-08-05',
      WEEK_START,
      WEEK_END,
    );
    expect(bands.week.map((r) => r.id)).toEqual(['2026-08-04', '2026-08-07']);
    expect(bands.today).toHaveLength(0);
  });

  it('reads the week in calendar order, and today in start order', () => {
    const early = on('2026-08-03', { id: 'early', startsAt: instant(2026, 8, 3, 7, 0) });
    const late = on('2026-08-03', { id: 'late', startsAt: instant(2026, 8, 3, 16, 0) });
    const bands = bandRuns(
      [late, early, on('2026-08-09'), on('2026-08-05')],
      TODAY,
      WEEK_START,
      WEEK_END,
    );
    expect(bands.today.map((r) => r.id)).toEqual(['early', 'late']);
    expect(bands.week.map((r) => r.id)).toEqual(['2026-08-05', '2026-08-09']);
  });

  it('bands on the PANTRY calendar, never on the device clock', () => {
    // The whole reason this changed. A run at 10pm pantry-time on the 3rd is already
    // the 4th on a device an hour or two east; `occurrenceDate` is the slot the
    // server resolved against `app_config.timezone`, and it is the only input.
    const lateRun = on('2026-08-03', {
      startsAt: instant(2026, 8, 3, 22, 0),
      endsAt: instant(2026, 8, 4, 1, 0),
    });
    expect(bandRuns([lateRun], '2026-08-03', WEEK_START, WEEK_END).today).toHaveLength(1);
    // And it is NOT today on the 4th, however the device's clock reads.
    expect(bandRuns([lateRun], '2026-08-04', WEEK_START, WEEK_END).today).toHaveLength(0);
  });

  it('counts runs outside the week instead of dropping them', () => {
    // This page has no week control; the board's Mine filter does. A run claimed for
    // next Tuesday must not vanish from the only screen that lists a driver's runs.
    const bands = bandRuns(
      [on('2026-08-12'), on('2026-07-20'), on('2026-08-05')],
      TODAY,
      WEEK_START,
      WEEK_END,
    );
    expect(bands.laterCount).toBe(2);
    expect(bands.week.map((r) => r.id)).toEqual(['2026-08-05']);
  });

  it('keeps an old IN_PROGRESS run in its own week — D1: Phase 1 has no COMPLETED', () => {
    // Nothing here reads `status` as a proxy for "over", so a run that never reached
    // COMPLETED lands on its calendar day like any other.
    const stale = on('2026-08-04', { status: 'IN_PROGRESS' });
    const bands = bandRuns([stale], '2026-08-06', WEEK_START, WEEK_END);
    expect(bands.week.map((r) => r.status)).toEqual(['IN_PROGRESS']);
  });

  it('dates a row from occurrenceDate, not from the instant', () => {
    // A late run whose window crosses midnight in the device's zone still reads as
    // its own pantry-local calendar slot — the frame the board and the report use.
    const late = run({
      occurrenceDate: '2026-08-04',
      startsAt: instant(2026, 8, 4, 22, 0),
      endsAt: instant(2026, 8, 5, 1, 0),
    });
    expect(formatRunWhen(late, NOW)).toBe('Tue, Aug 4 · 10:00 PM – 1:00 AM');
  });

  it("reads a run's hours in the PANTRY's zone when the session has one (A120)", () => {
    // A fixed instant, so this asserts the zone and not the machine the suite is on.
    const fixed = run({
      startsAt: '2026-08-04T13:00:00.000Z',
      endsAt: '2026-08-04T15:00:00.000Z',
    });
    expect(formatRunHours(fixed, 'UTC')).toBe('1:00 PM – 3:00 PM');
    expect(formatRunHours(fixed, 'America/Chicago')).toBe('8:00 AM – 10:00 AM');
    expect(formatRunWhen(fixed, NOW, 'UTC')).toBe('Tue, Aug 4 · 1:00 PM – 3:00 PM');
  });
});

describe('reading blocks back', () => {
  it('names a whole-day block by its last INCLUDED day (endsAt is exclusive)', () => {
    const view = describeBlock(
      block('b1', instant(2026, 8, 3, 0, 0), instant(2026, 8, 6, 0, 0)),
      NOW,
    );
    expect(view.allDay).toBe(true);
    expect(view.label).toBe('All day · Mon, Aug 3 – Wed, Aug 5');
  });

  it('names a single whole day without a range', () => {
    const view = describeBlock(
      block('b2', instant(2026, 8, 3, 0, 0), instant(2026, 8, 4, 0, 0)),
      NOW,
    );
    expect(view.label).toBe('All day · Mon, Aug 3');
  });

  it('names an intra-day window with its hours', () => {
    const view = describeBlock(
      block('b3', instant(2026, 8, 4, 9, 0), instant(2026, 8, 4, 12, 0)),
      NOW,
    );
    expect(view.allDay).toBe(false);
    expect(view.label).toBe('Tue, Aug 4 · 9:00 AM – 12:00 PM');
  });

  it('lists a multi-date WINDOW declaration as one row per date (A58)', () => {
    // The server expands "9-12, Tue to Thu" into three rows; each is withdrawn on
    // its own, so the screen must not merge them into one line with one Remove.
    const rows = [
      block('d1', instant(2026, 8, 4, 9), instant(2026, 8, 4, 12)),
      block('d2', instant(2026, 8, 5, 9), instant(2026, 8, 5, 12)),
      block('d3', instant(2026, 8, 6, 9), instant(2026, 8, 6, 12)),
    ];
    const { upcoming } = groupBlocks(rows, NOW);
    expect(upcoming.map((view) => view.id)).toEqual(['d1', 'd2', 'd3']);
  });

  it('splits blocks past/future on their end, newest-first in the past', () => {
    const old1 = block('o1', instant(2026, 7, 1, 0), instant(2026, 7, 2, 0));
    const old2 = block('o2', instant(2026, 7, 20, 0), instant(2026, 7, 21, 0));
    const soon = block('s1', instant(2026, 8, 10, 0), instant(2026, 8, 11, 0));
    const { upcoming, past } = groupBlocks([old1, soon, old2], NOW);
    expect(upcoming.map((v) => v.id)).toEqual(['s1']);
    expect(past.map((v) => v.id)).toEqual(['o2', 'o1']);
  });
});

describe('the away form', () => {
  const days = (from: string, to: string): AwayForm => ({
    ...EMPTY_FORM,
    fromDate: from,
    toDate: to,
  });

  it('makes a range in two taps and starts over on the third', () => {
    const one = pickDay(EMPTY_FORM, '2026-08-04');
    expect([one.fromDate, one.toDate]).toEqual(['2026-08-04', '2026-08-04']);

    const range = pickDay(one, '2026-08-07');
    expect([range.fromDate, range.toDate]).toEqual(['2026-08-04', '2026-08-07']);

    const restarted = pickDay(range, '2026-08-20');
    expect([restarted.fromDate, restarted.toDate]).toEqual(['2026-08-20', '2026-08-20']);
  });

  it('extends backwards when the second tap is earlier', () => {
    const range = pickDay(pickDay(EMPTY_FORM, '2026-08-07'), '2026-08-04');
    expect([range.fromDate, range.toDate]).toEqual(['2026-08-04', '2026-08-07']);
  });

  it('knows which days are inside the range', () => {
    const form = days('2026-08-04', '2026-08-07');
    expect(isDayInRange(form, '2026-08-04')).toBe(true);
    expect(isDayInRange(form, '2026-08-06')).toBe(true);
    expect(isDayInRange(form, '2026-08-08')).toBe(false);
    expect(isDayInRange(EMPTY_FORM, '2026-08-04')).toBe(false);
  });

  it('will not build a declaration with no days picked', () => {
    expect(validateForm(EMPTY_FORM)).toBe(COPY.noDays);
    expect(buildDeclaration(EMPTY_FORM)).toBeNull();
  });

  it('builds a whole-day declaration as dates only — no times (A55)', () => {
    expect(buildDeclaration(days('2026-08-04', '2026-08-07'))).toEqual({
      kind: 'DATES',
      fromDate: '2026-08-04',
      toDate: '2026-08-07',
    });
  });

  it('requires both times for a window, and an end later in the day (A57)', () => {
    const partial: AwayForm = { ...days('2026-08-04', '2026-08-04'), kind: 'WINDOW' };
    expect(validateForm(partial)).toBe(COPY.noTimes);

    const backwards: AwayForm = { ...partial, startTime: '12:00', endTime: '09:00' };
    expect(validateForm(backwards)).toBe(COPY.endBeforeStart);
    expect(buildDeclaration(backwards)).toBeNull();

    const equal: AwayForm = { ...partial, startTime: '09:00', endTime: '09:00' };
    expect(validateForm(equal)).toBe(COPY.endBeforeStart);

    const good: AwayForm = { ...partial, startTime: '09:00', endTime: '12:00' };
    expect(validateForm(good)).toBeNull();
    expect(buildDeclaration(good)).toEqual({
      kind: 'WINDOW',
      fromDate: '2026-08-04',
      toDate: '2026-08-04',
      startTime: '09:00',
      endTime: '12:00',
    });
  });

  it('sends dates and clock times, never an instant', () => {
    const request = buildDeclaration({
      ...days('2026-08-04', '2026-08-06'),
      kind: 'WINDOW',
      startTime: '09:00',
      endTime: '12:00',
    });
    for (const value of Object.values(request ?? {})) {
      expect(String(value)).not.toContain('T');
      expect(String(value)).not.toContain('Z');
    }
  });

  it('reads the declaration back as a sentence', () => {
    expect(summarySentence(days('2026-08-04', '2026-08-04'), NOW)).toBe(
      "You'll be away all day on Tue, Aug 4.",
    );
    expect(summarySentence(days('2026-08-04', '2026-08-07'), NOW)).toBe(
      "You'll be away all day, Tue, Aug 4 to Fri, Aug 7.",
    );
    expect(
      summarySentence(
        { ...days('2026-08-04', '2026-08-06'), kind: 'WINDOW', startTime: '09:00', endTime: '12:00' },
        NOW,
      ),
    ).toBe("You'll be away 9:00 AM – 12:00 PM on every day from Tue, Aug 4 to Thu, Aug 6.");
    expect(summarySentence(EMPTY_FORM, NOW)).toBeNull();
  });
});

describe('a refused save', () => {
  it("shows the server's own sentence for I20's declaration gate", () => {
    // S1.4's two refusals differ by whether the run can still be released, and
    // `services/availability.ts` picks between them — the client must not decide
    // again from a second copy of the rule.
    const releasable = new ApiError('conflict', {
      status: 409,
      detail: 'You own a run in this window. Cancel it first.',
    });
    expect(failureMessage(releasable)).toBe('You own a run in this window. Cancel it first.');

    const inProgress = new ApiError('conflict', {
      status: 409,
      detail: "This run is in progress and can't be cancelled. Try again once it's done.",
    });
    expect(failureMessage(inProgress)).toBe(
      "This run is in progress and can't be cancelled. Try again once it's done.",
    );
  });

  it('falls back to the plain error text when the server sent no detail', () => {
    expect(failureMessage(new ApiError('offline'))).toBe(
      "You're offline. R3 needs a connection.",
    );
    expect(failureMessage(new Error('boom'))).toBe('Something went wrong. Tap to try again.');
  });

  it('never puts a correlation id on screen', () => {
    const withId = new ApiError('server', { status: 500, correlationId: 'abc-123' });
    expect(failureMessage(withId)).not.toContain('abc-123');
  });
});

describe('microcopy (§7)', () => {
  const FORBIDDEN = ['PWA', 'push subscription', 'session', 'payload', 'endpoint', 'atomic', 'instance'];

  it('uses none of the forbidden words', () => {
    const strings = [
      ...Object.values(COPY),
      summarySentence({ ...EMPTY_FORM, fromDate: '2026-08-04', toDate: '2026-08-04' }, NOW) ?? '',
    ];
    for (const line of strings) {
      for (const word of FORBIDDEN) {
        expect(line.toLowerCase()).not.toContain(word.toLowerCase());
      }
    }
  });

  it("keeps S1.4's explanation verbatim", () => {
    expect(COPY.explain).toBe(
      "Telling us you're away helps the coordinator fill runs. It won't cancel runs you already own. You'll need to cancel those yourself first.",
    );
  });
});
