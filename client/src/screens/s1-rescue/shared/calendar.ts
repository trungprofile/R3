// Calendar-date arithmetic and the month grid, shared by the S1 screens that draw
// one.
//
// Extracted rather than copied. S1.4's away-date picker and S1.6's day pickers had
// byte-identical `monthGrid` / `nextMonth` / `previousMonth` / `formatMonthLabel` /
// `WEEKDAY_INITIALS`, and D73 needed a fourth caller — a grid the whole Runs tab is
// read off. Four copies of a six-week grid is four chances to disagree about which
// day a month opens on, and there is no visual test that would catch the drift.
//
// A DATE HERE IS TEXT, never a `Date`. `YYYY-MM-DD` is a civil date and has no zone;
// the arithmetic below runs in UTC purely because UTC is the calendar that never
// crosses a daylight-saving boundary on the way to the answer. Nothing here reads a
// clock, so nothing here can be device-local by accident — which is the bug A120
// exists about, and the reason the pantry's own "today" is passed IN by the caller
// rather than computed here.
//
// The screens keep their own `WEEKDAY_NAMES`, day labels and copy: those differ per
// screen (S1.4 names days Sunday-first, S1.6 uses the ISO Monday-first order its
// recurrence rules are stored in), and folding them together would be a change in
// behaviour rather than a de-duplication.

export interface CalendarDate {
  year: number;
  /** 1-12. */
  month: number;
  day: number;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** Sunday-first column headers for a day grid (US pantry) — what the pickers use. */
export const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

/** The same seven headers cut Monday-first, for a grid on A178's week. The board,
 *  S3.1 and D71's runs list all cut the week Monday to Sunday, so a calendar beside
 *  them has to open on the same day or "this week" means two things one screen
 *  apart. */
export const WEEKDAY_INITIALS_MONDAY = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

/** Which day a grid's first column is: 0 = Sunday (the pickers), 1 = Monday (A178). */
export type FirstWeekday = 0 | 1;

export function parseIsoDate(value: string): CalendarDate | null {
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

export function isoOf(date: CalendarDate): string {
  const mm = String(date.month).padStart(2, '0');
  const dd = String(date.day).padStart(2, '0');
  return `${date.year}-${mm}-${dd}`;
}

export function addDaysIso(iso: string, days: number): string {
  const date = parseIsoDate(iso);
  if (!date) return iso;
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return isoOf({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  });
}

/** ISO date strings sort lexicographically; this only names why. */
export function compareIso(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Day-of-week index of a calendar date, 0 = Sunday. Calendar arithmetic only —
 *  which weekday a date falls on involves no zone. */
export function weekdayIndex(date: CalendarDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

export function formatMonthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1] ?? ''} ${year}`;
}

export interface MonthCell {
  iso: string;
  day: number;
  /** False for the leading/trailing days that only fill the grid out. */
  inMonth: boolean;
}

/**
 * A month as six weeks of seven cells — the shape a grid renders.
 *
 * Always six rows, never five: a grid that changes height as you page through the
 * year moves everything under it, and the last row is filler the caller renders as
 * a spacer.
 */
export function monthGrid(
  year: number,
  month: number,
  firstWeekday: FirstWeekday = 0,
): MonthCell[][] {
  const first: CalendarDate = { year, month, day: 1 };
  const lead = (weekdayIndex(first) - firstWeekday + 7) % 7;
  const start = addDaysIso(isoOf(first), -lead);

  const weeks: MonthCell[][] = [];
  for (let week = 0; week < 6; week += 1) {
    const cells: MonthCell[] = [];
    for (let index = 0; index < 7; index += 1) {
      const iso = addDaysIso(start, week * 7 + index);
      const date = parseIsoDate(iso);
      cells.push({
        iso,
        day: date?.day ?? 1,
        inMonth: date?.month === month && date.year === year,
      });
    }
    weeks.push(cells);
  }
  return weeks;
}

export function nextMonth(year: number, month: number): { year: number; month: number } {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

export function previousMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}
