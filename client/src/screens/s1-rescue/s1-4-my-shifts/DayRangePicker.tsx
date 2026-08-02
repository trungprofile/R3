// The day picker for "When I'm away".
//
// A visible month of big day targets, not a dropdown and not a native date field:
// §1.5 rules out fragile controls and multi-step pickers, and §1.4 asks for
// recognition — a driver going away next week can see next week.
//
// Two taps make a range (`pickDay`). Days before today are not offered: a run in
// the past cannot be filled by the coordinator either way, so a past-dated block —
// which the server does accept (state A60) — has nothing left to affect.

import {
  WEEKDAY_INITIALS,
  compareIso,
  formatMonthLabel,
  isDayInRange,
  monthGrid,
  nextMonth,
  parseIsoDate,
  previousMonth,
  todayIso,
} from './logic.ts';
import type { AwayForm } from './logic.ts';

export interface DayRangePickerProps {
  form: AwayForm;
  onPick: (iso: string) => void;
  /** Month on screen, as `{ year, month }` with month 1-12. */
  month: { year: number; month: number };
  onMonthChange: (month: { year: number; month: number }) => void;
  now: Date;
}

export function DayRangePicker({
  form,
  onPick,
  month,
  onMonthChange,
  now,
}: DayRangePickerProps) {
  const today = todayIso(now);
  const todayParts = parseIsoDate(today);
  const atFirstMonth =
    todayParts !== null &&
    (todayParts.year > month.year ||
      (todayParts.year === month.year && todayParts.month >= month.month));

  return (
    <div className="s14-calendar">
      <div className="s14-calendar__bar">
        {atFirstMonth ? (
          <span className="s14-calendar__spacer" aria-hidden="true" />
        ) : (
          <button
            type="button"
            className="s14-calendar__nav"
            onClick={() => onMonthChange(previousMonth(month.year, month.month))}
            aria-label="Show the month before"
          >
            ‹
          </button>
        )}
        <span className="s14-calendar__month" aria-live="polite">
          {formatMonthLabel(month.year, month.month)}
        </span>
        <button
          type="button"
          className="s14-calendar__nav"
          onClick={() => onMonthChange(nextMonth(month.year, month.month))}
          aria-label="Show the month after"
        >
          ›
        </button>
      </div>

      <div className="s14-calendar__weekdays" aria-hidden="true">
        {WEEKDAY_INITIALS.map((initial, index) => (
          <span key={index} className="s14-calendar__weekday">
            {initial}
          </span>
        ))}
      </div>

      <div className="s14-calendar__grid">
        {monthGrid(month.year, month.month).map((week, weekIndex) =>
          week.map((cell) => {
            // Trailing cells of the six-week grid that belong to another month are
            // held as spacers, so the columns stay under their weekday headers.
            if (!cell.inMonth) {
              return (
                <span
                  key={`${weekIndex}-${cell.iso}`}
                  className="s14-day s14-day--blank"
                  aria-hidden="true"
                />
              );
            }
            const isPast = compareIso(cell.iso, today) < 0;
            const selected = isDayInRange(form, cell.iso);
            const edge = cell.iso === form.fromDate || cell.iso === form.toDate;
            const classes = ['s14-day'];
            if (selected) classes.push('s14-day--in-range');
            if (edge) classes.push('s14-day--edge');
            if (cell.iso === today) classes.push('s14-day--today');

            if (isPast) {
              return (
                <span key={cell.iso} className="s14-day s14-day--gone" aria-hidden="true">
                  {cell.day}
                </span>
              );
            }

            return (
              <button
                key={cell.iso}
                type="button"
                className={classes.join(' ')}
                aria-pressed={selected}
                onClick={() => onPick(cell.iso)}
              >
                {cell.day}
              </button>
            );
          }),
        )}
      </div>
      <p className="s14-hint">Tap a second day to cover everything in between.</p>
    </div>
  );
}
