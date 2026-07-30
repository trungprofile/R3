// The day picker for "move it to".
//
// A visible month of big day targets, not a native date field and not a dropdown:
// §1.5 rules out fragile controls and multi-step pickers, and §1.4 asks for
// recognition — a coordinator moving a run to next Tuesday can see next Tuesday.
//
// SINGLE-SELECT, unlike S1.4's `DayRangePicker`: a run moves to one day. It is a
// separate component in this folder rather than an import from S1.4's, because a
// screen folder is private to its lane (build-plan §3). Two lanes now want a
// calendar, which is the lead's signal to promote one — see the report's `Assumed:`.

import {
  WEEKDAY_INITIALS,
  formatMonthLabel,
  isDayOffered,
  monthGrid,
  nextMonth,
  parseIsoDate,
  previousMonth,
} from './logic.ts';

export interface DayPickerProps {
  /** `YYYY-MM-DD`, pantry-local. */
  value: string;
  onPick: (iso: string) => void;
  /** Month on screen, as `{ year, month }` with month 1-12. */
  month: { year: number; month: number };
  onMonthChange: (month: { year: number; month: number }) => void;
  /** Today in the PANTRY's zone (A120), never the device's. */
  today: string;
  /** The day the run stands on now. Always offered, even if it has gone by. */
  currentDate: string;
}

export function DayPicker({
  value,
  onPick,
  month,
  onMonthChange,
  today,
  currentDate,
}: DayPickerProps) {
  // The first month worth showing is whichever of today and the run's own day comes
  // first: a run that has slipped into the past is still reachable, and nothing
  // earlier than that has a selectable day in it.
  const floor = currentDate < today ? currentDate : today;
  const floorParts = parseIsoDate(floor);
  const atFloor =
    floorParts !== null &&
    (floorParts.year > month.year ||
      (floorParts.year === month.year && floorParts.month >= month.month));

  return (
    <div className="s17-calendar">
      <div className="s17-calendar__bar">
        {atFloor ? (
          <span className="s17-calendar__spacer" aria-hidden="true" />
        ) : (
          <button
            type="button"
            className="s17-calendar__nav"
            onClick={() => onMonthChange(previousMonth(month.year, month.month))}
            aria-label="Show the month before"
          >
            ‹
          </button>
        )}
        <span className="s17-calendar__month" aria-live="polite">
          {formatMonthLabel(month.year, month.month)}
        </span>
        <button
          type="button"
          className="s17-calendar__nav"
          onClick={() => onMonthChange(nextMonth(month.year, month.month))}
          aria-label="Show the month after"
        >
          ›
        </button>
      </div>

      <div className="s17-calendar__weekdays" aria-hidden="true">
        {WEEKDAY_INITIALS.map((initial, index) => (
          <span key={index} className="s17-calendar__weekday">
            {initial}
          </span>
        ))}
      </div>

      <div className="s17-calendar__grid">
        {monthGrid(month.year, month.month).map((week, weekIndex) =>
          week.map((cell) => {
            // Trailing cells of the six-week grid that belong to another month are
            // held as spacers, so the columns stay under their weekday headers.
            if (!cell.inMonth) {
              return (
                <span
                  key={`${weekIndex}-${cell.iso}`}
                  className="s17-day s17-day--blank"
                  aria-hidden="true"
                />
              );
            }

            if (!isDayOffered(cell.iso, today, currentDate)) {
              return (
                <span key={cell.iso} className="s17-day s17-day--gone" aria-hidden="true">
                  {cell.day}
                </span>
              );
            }

            const classes = ['s17-day'];
            if (cell.iso === value) classes.push('s17-day--picked');
            if (cell.iso === today) classes.push('s17-day--today');
            if (cell.iso === currentDate) classes.push('s17-day--current');

            return (
              <button
                key={cell.iso}
                type="button"
                className={classes.join(' ')}
                aria-pressed={cell.iso === value}
                onClick={() => onPick(cell.iso)}
              >
                {cell.day}
              </button>
            );
          }),
        )}
      </div>
    </div>
  );
}
