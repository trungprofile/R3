// The week, Monday to Sunday (A178).
//
// This lives here rather than inside a screen because two screens now need the
// same answer: S3.1 cuts the report on it, and S1.2's board defaults to "this
// week" so that a coordinator cross-checking the two is looking at the same seven
// days. It mirrors `weekBounds()` in `server/src/services/report.ts`, which is the
// authority — these functions exist so "This week" is not a round trip to find out
// where the user already is.
//
// Monday-start is not stated by any foundation doc; it is the ISO week and what a
// "weekly report" is normally taken to mean (A178). If the pantry turns out to cut
// its week somewhere else, this file and `weekBounds` change together.
//
// All arithmetic is done in UTC on a `YYYY-MM-DD` civil date. That is not a
// timezone decision — a civil date has no zone, and UTC is simply the arithmetic
// that never crosses a daylight-saving boundary on the way to the answer.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function utcOf(iso: string): Date | null {
  if (!ISO_DATE.test(iso)) return null;
  const time = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(time) ? null : new Date(time);
}

function isoOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** `iso` shifted by whole days. Returns `iso` untouched if it is not a date —
 *  guessing a date the server did not send would be worse than showing what
 *  arrived. */
export function addDaysIso(iso: string, days: number): string {
  const date = utcOf(iso);
  if (!date) return iso;
  date.setUTCDate(date.getUTCDate() + days);
  return isoOf(date);
}

/** Monday = 1 … Sunday = 7. `0` when `iso` is not a date. */
export function isoWeekday(iso: string): number {
  const date = utcOf(iso);
  if (!date) return 0;
  return ((date.getUTCDay() + 6) % 7) + 1;
}

/** The Monday of the week `iso` falls in (A178). */
export function weekStartOf(iso: string): string {
  const weekday = isoWeekday(iso);
  if (weekday === 0) return iso;
  return addDaysIso(iso, -(weekday - 1));
}

/** The Sunday closing the week that starts on `weekStart`. */
export function weekEndOf(weekStart: string): string {
  return addDaysIso(weekStart, 6);
}

export function previousWeek(weekStart: string): string {
  return addDaysIso(weekStart, -7);
}

export function nextWeek(weekStart: string): string {
  return addDaysIso(weekStart, 7);
}

export function isCurrentWeek(weekStart: string, today: string): boolean {
  return weekStart === weekStartOf(today);
}
