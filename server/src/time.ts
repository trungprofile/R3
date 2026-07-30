// Pantry-local time — the one place a calendar date or a wall clock becomes an instant.
//
// `domain-modeling.md §5.2` states a shift window as "half-open, pantry-local time", and
// the pantry's zone is `app_config.timezone` — an IANA zone, DST-aware, never a fixed
// offset (`data-model.md §2`). So a date and a time-of-day are resolved to instants HERE,
// on the server, not by whatever zone the driver's phone happens to be in.
//
// No dependency is added for this (build-plan D5): `Intl.DateTimeFormat` already carries
// the zone database. Instant → local is direct; local → instant needs one correction pass,
// because the offset to apply depends on the instant you are trying to find.
//
// WHY THIS IS A MODULE AND NOT A FEW HELPERS INSIDE ONE SERVICE. It was written inside
// `services/availability.ts` in wave 2 and hoisted here before wave 3, which needs exactly
// the same arithmetic for recurrence materialization (`domain-modeling.md §5.3`). Two
// copies would agree on every test anyone bothers to write and disagree at the DST edges —
// the spring-forward gap and the autumn hour that happens twice — which is precisely where
// a materialization bug would be invisible until a clock change made a run vanish or
// double. One implementation, one set of edge cases (wave-2 open assumption A56).

import { badRequest } from './middleware/error.js';

export interface WallTime {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

function zoneParts(instant: Date, timeZone: string): WallTime {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instant);

  const read = (type: string): number => {
    const part = parts.find((p) => p.type === type);
    return part ? Number(part.value) : 0;
  };

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour') % 24,
    minute: read('minute'),
  };
}

/** The zone's UTC offset in milliseconds at a given instant (positive east). */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const w = zoneParts(instant, timeZone);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute) - instant.getTime();
}

/**
 * A pantry-local wall time as an absolute instant.
 *
 * Two passes: the first uses the offset in force at the naive guess, the second re-reads
 * the offset at the instant that produced — which is what makes a window spanning a DST
 * change come out the right length rather than an hour off. A local time that does not
 * exist (the spring-forward gap) resolves to the instant the clock jumped to, and one that
 * happens twice resolves to the first (A56 — neither behaviour is stated by any doc).
 */
export function localToInstant(wall: WallTime, timeZone: string): Date {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  const first = naive - zoneOffsetMs(new Date(naive), timeZone);
  const second = naive - zoneOffsetMs(new Date(first), timeZone);
  return new Date(second);
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;

export function parseDate(value: string, field: string): CalendarDate {
  const match = DATE_PATTERN.exec(value);
  if (!match) throw badRequest(`${field} must be a date, as YYYY-MM-DD.`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // Round-trip through UTC to reject 2026-02-31 and friends. The date is a calendar
  // fact here, not an instant — no zone is involved yet.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw badRequest(`${field} is not a real date.`);
  }
  return { year, month, day };
}

export function parseTime(value: string, field: string): { hour: number; minute: number } {
  const match = TIME_PATTERN.exec(value);
  if (!match) throw badRequest(`${field} must be a time of day, as HH:MM.`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw badRequest(`${field} is not a real time.`);
  return { hour, minute };
}

/**
 * The pantry-local calendar day an instant falls on.
 *
 * The inverse of `localToInstant`, and the reason it lives here rather than in the
 * service that first wanted it: `data-model.md §8` anchors report and metrics day on
 * a *business day*, never on `created_at`. A walk-in logged at 12:30am is still the
 * previous pantry day's intake if the pantry's zone says so, and computing that from
 * the server process's own zone would bucket it a day late whenever the box and the
 * pantry disagree — a bug that only shows up around midnight and only in the report.
 */
export function localCalendarDate(instant: Date, timeZone: string): CalendarDate {
  const w = zoneParts(instant, timeZone);
  return { year: w.year, month: w.month, day: w.day };
}

export function dayNumber(date: CalendarDate): number {
  return Math.floor(Date.UTC(date.year, date.month - 1, date.day) / 86_400_000);
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/**
 * A window as pantry-local wall-clock text, for a notification body.
 *
 * Formatted by the enqueuing service rather than by dispatch (wave-2 open assumption A7):
 * rendering needs `app_config.timezone`, which the writer has to hand and the dispatcher
 * does not. Structural parameter type so any `{ startsAt, endsAt }` fits without this
 * module importing a service.
 */
export function formatRange(
  window: { startsAt: Date; endsAt: Date },
  timeZone: string,
): string {
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${date.format(window.startsAt)} ${time.format(window.startsAt)} – ${date.format(
    window.endsAt,
  )} ${time.format(window.endsAt)}`;
}
