// S1.7's rules, tested without a browser.
//
// There is no jsdom and no component renderer in this repo, and adding one would be
// a dependency (build-plan §3/D5) — so nothing here renders anything. What is
// covered is what `logic.ts` exists for, and the two things a wrong answer would
// break silently rather than loudly:
//
//   1. THE ZONE. This is the one screen that enters a run time, so a conversion
//      running the wrong way writes the wrong instant. The cases below pin the
//      pantry zone against a device zone that is deliberately different.
//   2. THE CONFLICT PATH. Which failures are cap 9's pre-confirm question and which
//      are ordinary refusals, and that the sentence shown is the SERVER's.
//
// Run: npx vitest run --root client

import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../api/errors.ts';
import { rescheduleConflictMessage } from '../../../api/shared.ts';
import type { ShiftStatus, ShiftSummary } from '../../../api/shared.ts';
import {
  COPY,
  buildRequest,
  compareIso,
  currentWindow,
  failureMessage,
  formatDayLabel,
  formatTimeLabel,
  formatWhen,
  isDayOffered,
  isReleaseConflict,
  localTimeOf,
  monthGrid,
  monthOf,
  moveRefusal,
  moveSummary,
  movedMessage,
  runMayHaveChanged,
  sameWindow,
  timeOptions,
  todayInZone,
  validateMove,
  withStartTime,
} from './logic.ts';

/** The pantry. Fixed rather than read from the environment: the point of every zone
 *  case below is that the answer does not depend on where the test is run. */
const PANTRY = 'America/Chicago';

function run(over: Partial<ShiftSummary> = {}): ShiftSummary {
  return {
    id: 'shift-1',
    routeId: 'route-1',
    routeName: 'Riverside',
    occurrenceDate: '2026-08-04',
    // 9:00 AM – 11:00 AM in America/Chicago (CDT, UTC-5) on 2026-08-04.
    startsAt: '2026-08-04T14:00:00.000Z',
    endsAt: '2026-08-04T16:00:00.000Z',
    status: 'CLAIMED' as ShiftStatus,
    ownerId: 'driver-1',
    ownerName: 'Karen Diaz',
    truckName: null,
    recurrencePatternId: null,
    assignedOverConflict: false,
    staffNote: null,
    note: null,
    pickupCompletedAt: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// The pantry's zone (A120)
// ---------------------------------------------------------------------------

describe('the pantry zone, not the device zone', () => {
  it('reads an instant as the wall clock at the PANTRY', () => {
    // 14:00Z is 9:00 in Chicago and 10:00 in New York. If this ever answers the
    // device's clock, the form prefills a time nobody chose.
    expect(localTimeOf('2026-08-04T14:00:00.000Z', 'America/Chicago')).toBe('09:00');
    expect(localTimeOf('2026-08-04T14:00:00.000Z', 'America/New_York')).toBe('10:00');
    expect(localTimeOf('2026-08-04T14:00:00.000Z', 'UTC')).toBe('14:00');
  });

  it('answers midnight as 00:00, never 24:00', () => {
    // An `hour12: false` formatter can resolve to the h24 cycle, and "24:00" is not
    // a `HH:MM` the server accepts (`server/src/time.ts` rejects hour > 23).
    expect(localTimeOf('2026-08-04T05:00:00.000Z', 'America/Chicago')).toBe('00:00');
  });

  it('reads today as the PANTRY reads it, not the device', () => {
    // 03:30Z on the 5th is still the evening of the 4th in Chicago. A coordinator on
    // a laptop east of the pantry must not be offered a day the pantry has not
    // reached.
    const at = new Date('2026-08-05T03:30:00.000Z');
    expect(todayInZone(at, 'America/Chicago')).toBe('2026-08-04');
    expect(todayInZone(at, 'UTC')).toBe('2026-08-05');
  });

  it('renders the run window in the pantry zone and the day from occurrenceDate', () => {
    expect(formatWhen(run(), PANTRY)).toBe('Tuesday, August 4 · 9:00 AM – 11:00 AM');
    // The day never comes from the instant: converting `startsAt` would put an
    // evening run on the next day for anyone east of the pantry.
    expect(formatWhen(run(), 'UTC')).toBe('Tuesday, August 4 · 2:00 PM – 4:00 PM');
  });

  it('names a day from its calendar slot, never from a parsed Date at UTC midnight', () => {
    // `new Date('2026-08-04')` is UTC midnight, which is 2026-08-03 west of
    // Greenwich. Parsing the parts is what makes this impossible.
    expect(formatDayLabel('2026-08-04')).toBe('Tuesday, August 4');
    expect(formatDayLabel('2026-08-09')).toBe('Sunday, August 9');
    expect(formatDayLabel('2027-01-01')).toBe('Friday, January 1');
  });
});

// ---------------------------------------------------------------------------
// Prefill — the run's own window as the starting point
// ---------------------------------------------------------------------------

describe('currentWindow', () => {
  it('prefills the calendar slot verbatim and the times from the pantry clock', () => {
    expect(currentWindow(run(), PANTRY)).toEqual({
      date: '2026-08-04',
      startTime: '09:00',
      endTime: '11:00',
    });
  });

  it('prefills a different wall clock for a different pantry zone', () => {
    // The same stored run, read by a pantry in another zone: the DATE is unchanged
    // (it is a calendar fact the server resolved) and only the clock moves.
    expect(currentWindow(run(), 'America/New_York')).toEqual({
      date: '2026-08-04',
      startTime: '10:00',
      endTime: '12:00',
    });
  });

  it('clamps an end that lands on the next pantry day', () => {
    // The server builds both instants from ONE `date` (`resolveWindow`), so a window
    // crossing pantry midnight cannot be expressed by this form. Clamping is visible;
    // silently sending an end before the start would be refused with a 400.
    const overnight = run({
      startsAt: '2026-08-05T02:00:00.000Z', // 21:00 on the 4th in Chicago
      endsAt: '2026-08-05T05:30:00.000Z', // 00:30 on the 5th in Chicago
    });
    expect(currentWindow(overnight, PANTRY)).toEqual({
      date: '2026-08-04',
      startTime: '21:00',
      endTime: '23:59',
    });
  });
});

// ---------------------------------------------------------------------------
// Which runs can be moved (build-plan D1, I5/I8/I10)
// ---------------------------------------------------------------------------

describe('moveRefusal', () => {
  it('offers the move on the two states the service accepts', () => {
    expect(moveRefusal('OPEN')).toBeNull();
    expect(moveRefusal('CLAIMED')).toBeNull();
  });

  it('refuses a started run, saying so before the request rather than after', () => {
    // `services/schedule.ts`: "Only a run that has not started can be moved."
    expect(moveRefusal('IN_PROGRESS')?.title).toBe(COPY.startedTitle);
    expect(moveRefusal('CANCELLED')?.title).toBe(COPY.cancelledTitle);
  });

  it('answers COMPLETED, which Phase 1 never reaches (build-plan D1)', () => {
    // I11 makes receive-done the only completion action and it ships in Phase 2. The
    // branch exists so it is total; it is expected to stay unexercised.
    expect(moveRefusal('COMPLETED')?.title).toBe(COPY.finishedTitle);
  });
});

// ---------------------------------------------------------------------------
// The day picker's offer
// ---------------------------------------------------------------------------

describe('isDayOffered', () => {
  const today = '2026-08-04';

  it('offers today and every day after it', () => {
    expect(isDayOffered('2026-08-04', today, today)).toBe(true);
    expect(isDayOffered('2026-09-01', today, today)).toBe(true);
  });

  it('does not offer a day that has gone', () => {
    expect(isDayOffered('2026-08-03', today, today)).toBe(false);
  });

  it('always offers the day the run stands on, even a past one', () => {
    // A run that slipped into the past still has to show where it is, or the calendar
    // contradicts the summary card above it.
    expect(isDayOffered('2026-07-30', today, '2026-07-30')).toBe(true);
    expect(isDayOffered('2026-07-29', today, '2026-07-30')).toBe(false);
  });
});

describe('calendar arithmetic', () => {
  it('lays a month out as six weeks of seven, Sunday first', () => {
    const weeks = monthGrid(2026, 8);
    expect(weeks).toHaveLength(6);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    // 2026-08-01 is a Saturday, so the first week is July 26–August 1.
    expect(weeks[0]?.[0]?.iso).toBe('2026-07-26');
    expect(weeks[0]?.[0]?.inMonth).toBe(false);
    expect(weeks[0]?.[6]).toEqual({ iso: '2026-08-01', day: 1, inMonth: true });
  });

  it('opens on the month the run sits in', () => {
    expect(monthOf('2026-08-04')).toEqual({ year: 2026, month: 8 });
    expect(monthOf('2026-12-31')).toEqual({ year: 2026, month: 12 });
  });

  it('compares ISO dates as text, which is why they are text', () => {
    expect(compareIso('2026-08-04', '2026-08-05')).toBe(-1);
    expect(compareIso('2026-08-04', '2026-08-04')).toBe(0);
    expect(compareIso('2026-09-01', '2026-08-31')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Time options
// ---------------------------------------------------------------------------

describe('timeOptions', () => {
  it('runs quarter-hourly from 5am to 10pm, the same steps S1.6 publishes on', () => {
    const options = timeOptions();
    expect(options[0]).toBe('05:00');
    expect(options[1]).toBe('05:15');
    expect(options.at(-1)).toBe('22:00');
    // 17 hours at four steps an hour, plus the closing 22:00.
    expect(options).toHaveLength(69);
  });

  it('carries a run own odd time so moving the day cannot change the hours', () => {
    // 9:07 is on no grid this screen offers. Without `include`, a run standing at
    // that minute would find its own time unselectable, and changing only the DAY
    // would silently change the window too. (9:15 no longer demonstrates this: the
    // quarter-hour list carries it.)
    const options = timeOptions(['09:07']);
    expect(options).toContain('09:07');
    expect(options.indexOf('09:07')).toBe(options.indexOf('09:00') + 1);
  });

  it('does not duplicate a time the grid already has', () => {
    expect(timeOptions(['09:00', '09:00'])).toHaveLength(timeOptions().length);
  });
});

describe('withStartTime', () => {
  it('leaves an end that is still later in the day alone', () => {
    const form = { date: '2026-08-04', startTime: '09:00', endTime: '11:00' };
    expect(withStartTime(form, '10:00')).toEqual({ ...form, startTime: '10:00' });
  });

  it('drags the end along when the new start would swallow it', () => {
    const form = { date: '2026-08-04', startTime: '09:00', endTime: '11:00' };
    expect(withStartTime(form, '11:00')).toEqual({
      date: '2026-08-04',
      startTime: '11:00',
      endTime: '11:15',
    });
  });
});

// ---------------------------------------------------------------------------
// Validation — communication only
// ---------------------------------------------------------------------------

describe('validateMove', () => {
  const current = { date: '2026-08-04', startTime: '09:00', endTime: '11:00' };

  it('accepts a real move', () => {
    expect(validateMove({ ...current, date: '2026-08-11' }, current)).toBeNull();
    expect(validateMove({ ...current, startTime: '10:00' }, current)).toBeNull();
  });

  it('mirrors resolveWindow: the end must be later in the day than the start', () => {
    expect(validateMove({ ...current, endTime: '09:00' }, current)).toBe(COPY.endBeforeStart);
    expect(validateMove({ ...current, endTime: '08:00' }, current)).toBe(COPY.endBeforeStart);
  });

  it('will not send a move that moves nothing', () => {
    // Legal server-side, merely pointless — so this is a nudge, not a rule.
    expect(validateMove({ ...current }, current)).toBe(COPY.unchanged);
    expect(sameWindow({ ...current }, current)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The request: three strings, and no instant anywhere
// ---------------------------------------------------------------------------

describe('buildRequest', () => {
  const form = { date: '2026-08-11', startTime: '09:00', endTime: '11:00' };

  it('sends the calendar date and wall clock unconverted', () => {
    expect(buildRequest(form, false)).toEqual({
      date: '2026-08-11',
      startTime: '09:00',
      endTime: '11:00',
    });
  });

  it('omits confirmRelease on the first attempt, which is what makes it a check', () => {
    expect('confirmRelease' in buildRequest(form, false)).toBe(false);
    expect(buildRequest(form, true).confirmRelease).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The conflict path (PRD cap 9)
// ---------------------------------------------------------------------------

/** A 409 as `api/client.ts` shapes it: `error` becomes `code`, `message` becomes
 *  `detail`. The `conflicts` array in the body is NOT carried through — see the
 *  report's `Assumed:`. */
function conflict409(message: string): ApiError {
  return new ApiError('conflict', {
    status: 409,
    code: 'RESCHEDULE_CONFLICT',
    detail: message,
  });
}

describe('the pre-confirm conflict', () => {
  it('recognises cap 9 by the server code, never by its prose', () => {
    // Branching on a sentence breaks the moment someone rewords it, which is exactly
    // what `ApiError.code` exists for.
    expect(isReleaseConflict(conflict409('anything at all'))).toBe(true);
  });

  it('does not mistake another 409 for a release conflict', () => {
    // "Only a run that has not started can be moved." and "That run just changed."
    // are both 409s and neither offers to release anybody.
    const other = new ApiError('conflict', {
      status: 409,
      detail: 'Only a run that has not started can be moved.',
    });
    expect(isReleaseConflict(other)).toBe(false);
    expect(failureMessage(other)).toBe('Only a run that has not started can be moved.');
  });

  it('shows the SERVER sentence, which is where S1.7 copy is written', () => {
    // `rescheduleConflictMessage()` lives in `shared/src/schedule.ts` so the two
    // halves cannot word S1.7's specified warning differently.
    const sentence = rescheduleConflictMessage('Karen', ['AVAILABILITY_BLOCK']);
    expect(failureMessage(conflict409(sentence))).toBe(sentence);
    // S1.7's voice: the cause and the consequence in one breath.
    expect(sentence).toContain('Karen marked themselves away then.');
    expect(sentence).toContain('releases their run back to the board');
  });

  it('re-reads the run only when the refusal was about the run', () => {
    // "Only a run that has not started can be moved." and "That run just changed."
    // are 409s about the row; a 400 from `resolveWindow` is about the form, and
    // re-fetching then would be a request for nothing.
    expect(runMayHaveChanged(conflict409('That run just changed.'))).toBe(true);
    expect(runMayHaveChanged(new ApiError('not-found', { status: 404 }))).toBe(true);
    expect(runMayHaveChanged(new ApiError('invalid', { status: 400 }))).toBe(false);
  });

  it('falls back to the plain message when the server sent no sentence', () => {
    expect(failureMessage(new ApiError('server'))).toBe(
      'Something went wrong. Tap to try again.',
    );
    expect(failureMessage('not an error at all')).toBe('Something went wrong. Tap to try again.');
  });
});

// ---------------------------------------------------------------------------
// What the screen says
// ---------------------------------------------------------------------------

describe('the read-back above the primary action', () => {
  it('states that the owner is kept, because S1.7 promises it', () => {
    const summary = moveSummary({ date: '2026-08-11', startTime: '09:00', endTime: '11:00' }, run());
    expect(summary).toBe('Tuesday, August 11 · 9:00 AM – 11:00 AM. Karen Diaz keeps this run.');
  });

  it('says nobody has it, rather than naming a driver, on an open run', () => {
    const summary = moveSummary(
      { date: '2026-08-11', startTime: '09:00', endTime: '11:00' },
      run({ status: 'OPEN', ownerId: null, ownerName: null }),
    );
    expect(summary).toContain(COPY.noOwner);
  });
});

describe('what the toast says afterwards', () => {
  it('distinguishes the owner coming along from the owner being let go', () => {
    expect(movedMessage(run(), false)).toBe('Moved. Karen Diaz still has this run.');
    expect(movedMessage(run(), true)).toBe('Moved. Karen Diaz is off this run and it is open again.');
  });

  it('says only that it moved when there was no driver to keep or release', () => {
    expect(movedMessage(run({ ownerId: null, ownerName: null }), false)).toBe(COPY.movedUnowned);
  });
});

// ---------------------------------------------------------------------------
// Copy (§7)
// ---------------------------------------------------------------------------

describe('copy', () => {
  /** Every user-visible sentence this screen owns, resolved. */
  const sentences = Object.values(COPY).map((value) =>
    typeof value === 'function' ? value('Karen') : value,
  );

  it('uses S1.7 primary action verbatim', () => {
    expect(COPY.confirm).toBe('Confirm new time');
  });

  it('avoids every word §7 forbids in the UI', () => {
    const forbidden = [
      'PWA',
      'push subscription',
      'session',
      'payload',
      'endpoint',
      'atomic',
      'instance',
      // The domain says "shift", the UI says "run" (§7 vocabulary).
      'shift',
      'reschedule',
    ];
    for (const sentence of sentences) {
      for (const word of forbidden) {
        expect(sentence.toLowerCase()).not.toContain(word.toLowerCase());
      }
    }
  });

  it('never claims anyone was told', () => {
    // The PRD notification matrix has no "your run was moved" row: a kept owner is
    // sent nothing at all. Copy that implies otherwise would be a lie the screen
    // cannot keep.
    for (const sentence of sentences) {
      expect(sentence.toLowerCase()).not.toContain('notif');
      expect(sentence.toLowerCase()).not.toContain('alert');
      expect(sentence.toLowerCase()).not.toContain('we told');
    }
  });

  it('says no em dash anywhere a user reads (D21)', () => {
    // Two sentences or a comma, never a hyphen swap. The en dash inside a time RANGE
    // is a glyph rather than prose and is not this rule's business.
    for (const sentence of sentences) {
      expect(sentence).not.toContain('—');
    }
  });

  it('names the way out as a destination, not as a sentence (D43)', () => {
    // One way out, at the top, and `BackLink`'s chevron already says "back" — so
    // the label is the place it returns to (S1.3, this run's own page). It also
    // has to survive §7's vocabulary: the UI calls it a run, never a shift.
    expect(COPY.back).toBe('This run');
    expect(COPY.back.toLowerCase()).not.toContain('back');
  });

  it('never offers a replacement driver', () => {
    // Cap 9: "The system never auto-selects a replacement person." The release copy
    // says the opposite out loud, so a coordinator knows the run needs a driver.
    expect(COPY.releaseNoReplacement).toContain('Nobody is picked to take over');
    expect(COPY.releaseNoReplacement).toContain('board as open');
  });

  it('formats a wall clock the way the pantry says it', () => {
    expect(formatTimeLabel('09:00')).toBe('9:00 AM');
    expect(formatTimeLabel('00:30')).toBe('12:30 AM');
    expect(formatTimeLabel('12:00')).toBe('12:00 PM');
    expect(formatTimeLabel('23:59')).toBe('11:59 PM');
  });
});
