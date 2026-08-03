// S2.1b's rules, tested without a browser.
//
// There is no jsdom and no component renderer in this repo, and adding one would
// be a dependency (build-plan §3/D5) — so nothing here renders anything. What is
// covered is what `run-picker.ts` exists for: the date rule, the order of the list,
// the "N of M done" count, which stop a tap opens, which runs offer Receive done,
// the status-dot mapping, the three list states, and the copy. The report says
// plainly what that leaves uncovered.
//
// Run: npx vitest run --root client

import { describe, expect, it } from 'vitest';
import {
  COPY,
  FORBIDDEN_IN_COPY,
  bandFor,
  calendarDateLabel,
  clockTime,
  compareRuns,
  doneLabel,
  firstUnresolvedStop,
  isResolved,
  listState,
  meridiem,
  orderRuns,
  orderStops,
  runAction,
  runLabel,
  runSubtitle,
  runTarget,
  stopStateLabel,
  stopTone,
  targetForStops,
  toBands,
  toCard,
  toCards,
  weekdayShort,
} from './run-picker.ts';
import type {
  ReceiveRunSummary,
  ReceiveStopState,
  ReceiveStopSummary,
} from '../../../api/shared.ts';

/** The pantry's zone. Deliberately not the machine running the test: a UTC-only
 *  assertion would pass on CI and be wrong at the counter. */
const PANTRY = 'America/Chicago';

function stop(over: Partial<ReceiveStopSummary> = {}): ReceiveStopSummary {
  return {
    id: 'stop-1',
    donorId: 'donor-1',
    donorName: "Sam's",
    position: 0,
    state: 'PENDING' as ReceiveStopState,
    ...over,
  };
}

function run(over: Partial<ReceiveRunSummary> = {}): ReceiveRunSummary {
  const stops = over.stops ?? [stop()];
  const doneCount = stops.filter((each) => isResolved(each.state)).length;
  return {
    shiftId: 'shift-1',
    routeName: 'Riverside',
    ownerName: 'Karen',
    // A Tuesday.
    occurrenceDate: '2026-04-21',
    // 9:00–11:00 in America/Chicago (CDT, UTC-5) on that Tuesday.
    startsAt: '2026-04-21T14:00:00.000Z',
    endsAt: '2026-04-21T16:00:00.000Z',
    doneCount,
    totalCount: stops.length,
    readyForReceiveDone: stops.length > 0 && doneCount === stops.length,
    ...over,
    stops,
  };
}

// ---------------------------------------------------------------------------
// The date rule (S2.1b)
// ---------------------------------------------------------------------------

describe('the run states its own date, never the device"s', () => {
  it('reads a YYYY-MM-DD slot as a local day, never as UTC midnight', () => {
    // `new Date('2026-04-21')` is UTC midnight, which is 2026-04-20 for anyone west
    // of Greenwich. Parsing the parts is what stops the screen naming the wrong day.
    expect(weekdayShort('2026-04-21')).toBe('Tue');
    expect(calendarDateLabel('2026-04-21')).toBe('Tuesday, April 21');
    expect(calendarDateLabel('2026-01-01')).toBe('Thursday, January 1');
  });

  it('names a Tuesday run Tuesday however late it is received', () => {
    // S2.1b's stated case: a Tuesday-night run finally received at 12:30am
    // Wednesday. Nothing in the label depends on when it is read, so there is no
    // "now" to pass — which IS the assertion.
    const tuesdayNight = run({
      occurrenceDate: '2026-04-21',
      startsAt: '2026-04-22T01:00:00.000Z', // 8pm Tuesday in Chicago
      endsAt: '2026-04-22T03:00:00.000Z',
    });
    expect(runSubtitle(tuesdayNight, PANTRY)).toContain('Tuesday, April 21');
    expect(runLabel(tuesdayNight, PANTRY)).toBe("Karen's Tue PM run");
  });

  it('never says "Today" or "Yesterday"', () => {
    // The moment a heading here is relative it is stating a fact about the device
    // rather than about the run, which is the drift the rule exists to prevent.
    const label = runSubtitle(run(), PANTRY);
    expect(label).not.toMatch(/today|yesterday|tomorrow/i);
    for (const sentence of Object.values(COPY)) {
      if (typeof sentence === 'string') expect(sentence).not.toMatch(/\btoday\b/i);
    }
  });

  it('leaves an unparseable date alone rather than inventing one', () => {
    expect(calendarDateLabel('not-a-date')).toBe('not-a-date');
    expect(weekdayShort('not-a-date')).toBe('');
  });
});

describe('clock times are the pantry"s (A120)', () => {
  it('formats a run window in the pantry zone, not the device zone', () => {
    expect(clockTime('2026-04-21T14:00:00.000Z', PANTRY)).toBe('9:00 AM');
    expect(clockTime('2026-04-21T14:00:00.000Z', 'UTC')).toBe('2:00 PM');
  });

  it('reads AM/PM off the pantry clock, not off the ISO string', () => {
    // 01:00Z is 8pm the previous evening in Chicago. Taking the hour from the
    // instant would call this an AM run.
    expect(meridiem('2026-04-22T01:00:00.000Z', PANTRY)).toBe('PM');
    expect(meridiem('2026-04-21T14:00:00.000Z', PANTRY)).toBe('AM');
  });

  it('says nothing rather than "Invalid Date" for a broken instant', () => {
    expect(clockTime('nope', PANTRY)).toBe('');
    expect(meridiem('nope', PANTRY)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// The run label and subtitle
// ---------------------------------------------------------------------------

describe('run label', () => {
  it('is S2.1b"s own name for a run', () => {
    expect(runLabel(run(), PANTRY)).toBe("Karen's Tue AM run");
    expect(runLabel(run({ ownerName: 'Miguel' }), PANTRY)).toBe("Miguel's Tue AM run");
  });

  it('drops the possessive rather than inventing an owner', () => {
    expect(runLabel(run({ ownerName: null }), PANTRY)).toBe('Tue AM run');
  });

  it('spells every possessive one way', () => {
    // "Chris's", not "Chris'" — one rule, so no name is spelled two ways depending
    // on its last letter.
    expect(runLabel(run({ ownerName: 'Chris' }), PANTRY)).toBe("Chris's Tue AM run");
  });

  it('keeps the route name and the window on the line below', () => {
    expect(runSubtitle(run(), PANTRY)).toBe('Riverside · Tuesday, April 21 · 9:00 AM – 11:00 AM');
  });
});

// ---------------------------------------------------------------------------
// Stops and their dots
// ---------------------------------------------------------------------------

describe('status dots', () => {
  it('draws the three S2.1b names', () => {
    expect(stopTone('PENDING')).toBe('pending');
    expect(stopTone('WEIGHED')).toBe('weighed');
    expect(stopTone('SKIPPED')).toBe('skipped');
  });

  it('draws COLLECTED as pending, because it is still work to do (I12)', () => {
    // The driver picked it up and nobody has weighed it. I12 admits only
    // {WEIGHED, SKIPPED, REASSIGNED}, so it still blocks receive-done.
    expect(stopTone('COLLECTED')).toBe('pending');
    expect(stopStateLabel('COLLECTED')).toBe('pending');
    expect(isResolved('COLLECTED')).toBe(false);
  });

  it('gives REASSIGNED a dot of its own rather than calling it skipped', () => {
    // It counts as resolved (I12) but is neither weighed nor skipped, and drawing
    // it as either would state something untrue.
    expect(stopTone('REASSIGNED')).toBe('moved');
    expect(stopStateLabel('REASSIGNED')).toBe('moved');
    expect(isResolved('REASSIGNED')).toBe(true);
  });

  it('pairs every dot with a word, so colour is never the only signal', () => {
    for (const state of ['PENDING', 'COLLECTED', 'WEIGHED', 'SKIPPED', 'REASSIGNED'] as const) {
      expect(stopStateLabel(state).length).toBeGreaterThan(0);
    }
  });

  it('agrees with I12"s resolved set', () => {
    expect(isResolved('PENDING')).toBe(false);
    expect(isResolved('WEIGHED')).toBe(true);
    expect(isResolved('SKIPPED')).toBe(true);
  });
});

describe('stop order', () => {
  const shuffled = [
    stop({ id: 'c', donorName: 'Aldi', position: 2 }),
    stop({ id: 'a', donorName: "Sam's", position: 0 }),
    stop({ id: 'b', donorName: 'Kroger', position: 1 }),
  ];

  it('follows the route, not the order the rows arrived', () => {
    expect(orderStops(shuffled).map((each) => each.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate what it was given', () => {
    const before = shuffled.map((each) => each.id);
    orderStops(shuffled);
    expect(shuffled.map((each) => each.id)).toEqual(before);
  });
});

describe('the stop a tap opens', () => {
  const stops = [
    stop({ id: 'a', donorName: "Sam's", position: 0, state: 'WEIGHED' }),
    stop({ id: 'b', donorName: 'Kroger', position: 1, state: 'PENDING' }),
    stop({ id: 'c', donorName: 'Aldi', position: 2, state: 'PENDING' }),
  ];

  it('is the FIRST unresolved stop in route order (S2.1b)', () => {
    expect(firstUnresolvedStop(stops)?.id).toBe('b');
  });

  it('skips past a stop resolved any of the three ways', () => {
    const mixed = [
      stop({ id: 'a', position: 0, state: 'WEIGHED' }),
      stop({ id: 'b', position: 1, state: 'SKIPPED' }),
      stop({ id: 'c', position: 2, state: 'REASSIGNED' }),
      stop({ id: 'd', position: 3, state: 'COLLECTED' }),
    ];
    expect(firstUnresolvedStop(mixed)?.id).toBe('d');
  });

  it('finds nothing when every stop is resolved', () => {
    expect(firstUnresolvedStop([stop({ state: 'WEIGHED' })])).toBeNull();
    expect(firstUnresolvedStop([])).toBeNull();
  });

  it('ignores the order the rows arrived in', () => {
    expect(firstUnresolvedStop([...stops].reverse())?.id).toBe('b');
  });
});

// ---------------------------------------------------------------------------
// What the card offers
// ---------------------------------------------------------------------------

describe('run action', () => {
  it('sends a run with work left to S2.2, for its first unresolved stop', () => {
    const target = run({
      stops: [
        stop({ id: 'a', position: 0, state: 'WEIGHED' }),
        stop({ id: 'b', position: 1, state: 'PENDING' }),
      ],
    });
    expect(runAction(target)).toBe('WEIGH');
    expect(runTarget(target)).toEqual({
      screen: 'receive-stop',
      params: { shiftId: 'shift-1', stopId: 'b' },
    });
  });

  it('offers Receive done instead once the server says the run is ready', () => {
    const ready = run({ stops: [stop({ state: 'WEIGHED' })] });
    expect(ready.readyForReceiveDone).toBe(true);
    expect(runAction(ready)).toBe('RECEIVE_DONE');
    expect(runTarget(ready)).toEqual({
      screen: 'receive-done',
      params: { shiftId: 'shift-1' },
    });
  });

  it('takes readyForReceiveDone at its word rather than recomputing the gate', () => {
    // A second implementation of I12 on the client is a second thing to keep in
    // step with the server, and the two would eventually disagree. If the server
    // says not ready, the screen weighs — even when every stop looks resolved.
    const disagreeing = run({
      stops: [stop({ id: 'a', position: 0, state: 'WEIGHED' })],
      readyForReceiveDone: false,
    });
    expect(runAction(disagreeing)).toBe('NONE');
  });

  it('offers nothing on a run with no stops at all', () => {
    // It can be neither weighed nor closed — I12 needs at least one resolved stop —
    // so the card carries no target rather than a tap that leads nowhere.
    const empty = run({ stops: [] });
    expect(empty.readyForReceiveDone).toBe(false);
    expect(runAction(empty)).toBe('NONE');
    expect(runTarget(empty)).toBeNull();
  });
});

describe('the freshness re-read on tap', () => {
  // S2.1b: several receivers work the same run's stops at once, so the card may be
  // pointing at a store someone else weighed a minute ago.
  it('moves the target on when the stop it named was resolved meanwhile', () => {
    expect(
      targetForStops('shift-1', [
        stop({ id: 'a', position: 0, state: 'WEIGHED' }),
        stop({ id: 'b', position: 1, state: 'WEIGHED' }),
        stop({ id: 'c', position: 2, state: 'PENDING' }),
      ]),
    ).toEqual({ screen: 'receive-stop', params: { shiftId: 'shift-1', stopId: 'c' } });
  });

  it('sends the last receiver standing to Receive done', () => {
    expect(targetForStops('shift-1', [stop({ state: 'SKIPPED' })])).toEqual({
      screen: 'receive-done',
      params: { shiftId: 'shift-1' },
    });
  });

  it('has nowhere to send anyone on a run with no stops', () => {
    expect(targetForStops('shift-1', [])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// "N of M done"
// ---------------------------------------------------------------------------

describe('the done count', () => {
  it('is S2.1b"s wording', () => {
    const partial = run({
      stops: [
        stop({ id: 'a', position: 0, state: 'WEIGHED' }),
        stop({ id: 'b', position: 1, state: 'SKIPPED' }),
        stop({ id: 'c', position: 2, state: 'PENDING' }),
      ],
    });
    expect(doneLabel(partial)).toBe('2 of 3 done');
    expect(doneLabel(run({ stops: [stop({ state: 'PENDING' })] }))).toBe('0 of 1 done');
  });

  it('uses the server"s counts rather than re-counting the rows', () => {
    // `doneCount`/`totalCount` are the server's own answer; the stop list is a
    // display of it. Counting again here would let the two disagree on screen.
    const stated = run({ stops: [stop()], doneCount: 7, totalCount: 9 });
    expect(doneLabel(stated)).toBe('7 of 9 done');
  });

  it('says what is wrong instead of "0 of 0 done"', () => {
    expect(toCard(run({ stops: [] }), PANTRY).count).toBe(COPY.noStops);
  });
});

// ---------------------------------------------------------------------------
// The order of the list
// ---------------------------------------------------------------------------

describe('list order', () => {
  const ready = run({
    shiftId: 'ready',
    occurrenceDate: '2026-04-20',
    startsAt: '2026-04-20T14:00:00.000Z',
    stops: [stop({ state: 'WEIGHED' })],
  });
  const older = run({
    shiftId: 'older',
    occurrenceDate: '2026-04-14',
    startsAt: '2026-04-14T14:00:00.000Z',
    stops: [stop({ state: 'PENDING' })],
  });
  const newer = run({
    shiftId: 'newer',
    occurrenceDate: '2026-04-21',
    startsAt: '2026-04-21T14:00:00.000Z',
    stops: [stop({ state: 'PENDING' })],
  });

  it('puts runs with weighing left above runs waiting only to be closed', () => {
    expect(orderRuns([ready, newer]).map((each) => each.shiftId)).toEqual(['newer', 'ready']);
  });

  it('leads with the oldest run, so a stale one cannot sink out of sight', () => {
    // The list is not bounded to today (A162), so an unclosed run from last week is
    // a real row — and burying it is how it stays unclosed.
    expect(orderRuns([newer, older]).map((each) => each.shiftId)).toEqual(['older', 'newer']);
  });

  it('breaks a same-day tie by start time, then by route name', () => {
    const early = run({ shiftId: 'early', startsAt: '2026-04-21T12:00:00.000Z' });
    const late = run({ shiftId: 'late', startsAt: '2026-04-21T18:00:00.000Z' });
    expect(orderRuns([late, early]).map((each) => each.shiftId)).toEqual(['early', 'late']);

    const alpha = run({ shiftId: 'alpha', routeName: 'Aldine' });
    const zeta = run({ shiftId: 'zeta', routeName: 'Zephyr' });
    expect(orderRuns([zeta, alpha]).map((each) => each.shiftId)).toEqual(['alpha', 'zeta']);
  });

  it('is a total order — comparing a run with itself is a tie', () => {
    expect(compareRuns(newer, newer)).toBe(0);
    expect(Math.sign(compareRuns(older, newer))).toBe(-Math.sign(compareRuns(newer, older)));
  });

  it('does not mutate what it was given', () => {
    const given = [newer, older, ready];
    orderRuns(given);
    expect(given.map((each) => each.shiftId)).toEqual(['newer', 'older', 'ready']);
  });
});

// ---------------------------------------------------------------------------
// The three bands (`D38`)
// ---------------------------------------------------------------------------

describe('the three bands', () => {
  // The PANTRY's today, passed in. The screen reads it from `todayInZone(timezone)`
  // and never from `new Date()` — passing it as an argument is what makes that
  // testable at all, and what stops this file asserting against the machine clock.
  const TODAY = '2026-04-21';

  const todayToWeigh = run({
    shiftId: 'today-todo',
    occurrenceDate: TODAY,
    stops: [stop({ state: 'PENDING' })],
  });
  const todayReady = run({
    shiftId: 'today-ready',
    occurrenceDate: TODAY,
    stops: [stop({ state: 'WEIGHED' })],
  });
  const tomorrow = run({
    shiftId: 'tomorrow',
    occurrenceDate: '2026-04-22',
    stops: [stop({ state: 'PENDING' })],
  });
  const lastWeek = run({
    shiftId: 'last-week',
    occurrenceDate: '2026-04-14',
    stops: [stop({ state: 'PENDING' })],
  });

  it('leads with today"s runs that still want weighing', () => {
    expect(bandFor(todayToWeigh, TODAY)).toBe('EXPECTED');
  });

  it('puts a run waiting only on its closing tap in the second band', () => {
    expect(bandFor(todayReady, TODAY)).toBe('FINISHED');
  });

  it('folds tomorrow away, so it cannot be tapped by mistake', () => {
    // The complaint `D38` came from: tomorrow's run sat close enough to today's to
    // be hit by accident.
    expect(bandFor(tomorrow, TODAY)).toBe('LATER');
  });

  it('keeps an overdue run in the leading band, not behind the disclosure', () => {
    // A run left unclosed from last week is not "later this week", and the list is
    // not bounded to today (A162) — burying it in a band that is closed by default
    // is how it stays unclosed.
    expect(bandFor(lastWeek, TODAY)).toBe('EXPECTED');
    const overdueButWeighed = run({
      occurrenceDate: '2026-04-14',
      stops: [stop({ state: 'WEIGHED' })],
    });
    expect(bandFor(overdueButWeighed, TODAY)).toBe('FINISHED');
  });

  it('compares calendar slots as strings, never through a Date', () => {
    // `YYYY-MM-DD` sorts lexicographically the way it sorts chronologically, so the
    // comparison cannot pick up a zone on the way through — which is the whole
    // reason a bare date is never handed to `new Date()` on this screen.
    expect(bandFor(run({ occurrenceDate: '2026-12-31' }), '2027-01-01')).toBe('EXPECTED');
    expect(bandFor(run({ occurrenceDate: '2027-01-01' }), '2026-12-31')).toBe('LATER');
  });

  it('splits the list into the three bands, oldest first inside each', () => {
    const bands = toBands([tomorrow, todayReady, todayToWeigh, lastWeek], TODAY, PANTRY);
    expect(bands.expected.map((each) => each.run.shiftId)).toEqual(['last-week', 'today-todo']);
    expect(bands.finished.map((each) => each.run.shiftId)).toEqual(['today-ready']);
    expect(bands.later.map((each) => each.run.shiftId)).toEqual(['tomorrow']);
  });

  it('drops no run on the floor', () => {
    const runs = [tomorrow, todayReady, todayToWeigh, lastWeek];
    const bands = toBands(runs, TODAY, PANTRY);
    expect(bands.expected.length + bands.finished.length + bands.later.length).toBe(runs.length);
  });

  it('gives every band the same cards the flat list built', () => {
    // Banding is a regrouping, not a second rendering: a card says the same thing
    // in either treatment.
    const bands = toBands([todayToWeigh], TODAY, PANTRY);
    expect(bands.expected[0]).toEqual(toCards([todayToWeigh], PANTRY)[0]);
  });
});

// ---------------------------------------------------------------------------
// The card as a whole
// ---------------------------------------------------------------------------

describe('card view', () => {
  const card = toCard(
    run({
      stops: [
        stop({ id: 'a', donorName: "Sam's", position: 0, state: 'WEIGHED' }),
        stop({ id: 'b', donorName: 'Kroger', position: 1, state: 'PENDING' }),
        stop({ id: 'c', donorName: 'Aldi', position: 2, state: 'PENDING' }),
      ],
    }),
    PANTRY,
  );

  it('shows the run"s stops in route order with their dots', () => {
    expect(card.stops.map((each) => [each.donorName, each.tone])).toEqual([
      ["Sam's", 'weighed'],
      ['Kroger', 'pending'],
      ['Aldi', 'pending'],
    ]);
  });

  it('names the stop the tap opens, so it is not a guess', () => {
    expect(card.count).toBe('1 of 3 done');
    expect(card.action).toBe('WEIGH');
    expect(card.actionLabel).toBe('Next: Kroger');
  });

  it('says Receive done on a ready run', () => {
    const ready = toCard(run({ stops: [stop({ state: 'WEIGHED' })] }), PANTRY);
    expect(ready.actionLabel).toBe(COPY.receiveDone);
  });

  it('gives a screen reader the whole row as one sentence', () => {
    expect(card.ariaLabel).toContain("Karen's Tue AM run");
    expect(card.ariaLabel).toContain('Tuesday, April 21');
    expect(card.ariaLabel).toContain('1 of 3 done');
    expect(card.ariaLabel).toContain('Next: Kroger');
  });

  it('orders the cards as it orders the runs', () => {
    const cards = toCards(
      [
        run({ shiftId: 'ready', stops: [stop({ state: 'WEIGHED' })] }),
        run({ shiftId: 'todo', stops: [stop({ state: 'PENDING' })] }),
      ],
      PANTRY,
    );
    expect(cards.map((each) => each.run.shiftId)).toEqual(['todo', 'ready']);
  });
});

// ---------------------------------------------------------------------------
// The three list states (§3, §6)
// ---------------------------------------------------------------------------

describe('list states', () => {
  it('shows nothing at all for the first 300ms (§6)', () => {
    expect(listState(null, null, false)).toBe('BLANK');
  });

  it('shows skeleton rows once loading is admitted, never a bare spinner', () => {
    expect(listState(null, null, true)).toBe('LOADING');
  });

  it('shows the plain retryable error when there is nothing to show instead', () => {
    expect(listState(null, new Error('down'), true)).toBe('ERROR');
    expect(listState([], new Error('down'), false)).toBe('ERROR');
  });

  it('shows the instructive empty state on a loaded empty list', () => {
    expect(listState([], null, false)).toBe('EMPTY');
  });

  it('keeps rows on screen through a slow or failed refresh', () => {
    // A receiver mid-shift should not watch the list they are using dissolve into
    // skeletons because a refresh was slow, nor lose it to an error block.
    const rows = [run()];
    expect(listState(rows, null, true)).toBe('RUNS');
    expect(listState(rows, new Error('down'), false)).toBe('RUNS');
  });
});

// ---------------------------------------------------------------------------
// Microcopy (§7)
// ---------------------------------------------------------------------------

describe('microcopy', () => {
  const sentences: string[] = [
    ...Object.values(COPY).flatMap((value) => (typeof value === 'string' ? [value] : [])),
    COPY.doneCount(2, 3),
    COPY.nextStop('Kroger'),
    COPY.bandLaterCount(3),
    COPY.runAria("Karen's Tue AM run", 'Riverside', '2 of 3 done', 'Next: Kroger'),
  ];

  it('says something everywhere', () => {
    for (const sentence of sentences) expect(sentence.length).toBeGreaterThan(0);
  });

  it('uses no forbidden word', () => {
    for (const sentence of sentences) {
      for (const word of FORBIDDEN_IN_COPY) {
        expect(sentence.toLowerCase(), `forbidden word in: ${sentence}`).not.toContain(word);
      }
    }
  });

  it('keeps S2.1b"s fixed copy verbatim', () => {
    expect(COPY.header).toBe('Which run are you receiving?');
    expect(COPY.receiveDone).toBe('Receive done');
    expect(COPY.unscheduled).toBe('Unscheduled donation');
    expect(COPY.doneCount(2, 3)).toBe('2 of 3 done');
  });

  it('names each band by what it is, never by when it is (`D38`)', () => {
    // The bands are computed from the PANTRY's today, but no heading may say so:
    // the moment one reads "Today" it is a claim about a clock, and the date rule
    // this file exists for says every date on screen is the run's own. The general
    // ban above already covers "today"; these are the headings it applies to.
    for (const heading of [COPY.bandExpected, COPY.bandFinished, COPY.bandLater]) {
      expect(heading).not.toMatch(/today|yesterday|tomorrow/i);
      expect(heading.length).toBeGreaterThan(0);
    }
    expect(COPY.bandLaterCount(3)).toContain('3');
  });

  it('does not call a run "finished" before it is closed (I11)', () => {
    // The second band's runs have every stop resolved and are still IN_PROGRESS —
    // receive-done is the only thing that finishes one, and it has not happened.
    expect(COPY.bandFinished.toLowerCase()).not.toContain('finished');
  });

  it('makes the empty state instructive, not just "nothing here" (§6)', () => {
    expect(COPY.emptyBody).toMatch(/driver starts it/);
    expect(COPY.emptyBody).toMatch(/Unscheduled donation/);
  });

  it('says "run", never "shift"', () => {
    // The user's word is "run" (§7: "Open runs", not "Unassigned shifts"). "shift"
    // is the table's word and belongs in the code, not on the tablet.
    for (const sentence of sentences) expect(sentence.toLowerCase()).not.toContain('shift');
  });
});
