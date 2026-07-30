// The four input controls S1.6 needs that `components/index.ts` does not export.
//
// They live here, inside this screen's own folder, because build-plan §3 makes
// `client/src/components/` single-owner and a lane may not add to it. If a second
// screen turns out to want one of these, the lead promotes it (see the report's
// `Assumed:`).
//
// Each one is a VISIBLE set of big targets, never a dropdown, a slider or a native
// date field: §1.5 rules out fragile controls and multi-step pickers where a column
// of buttons or a visible list fits, and §1.2 puts the floor at 44×44px with an 8px
// gap. §1.3's relative units are why nothing here is sized in px.
//
// None of them ever produces an instant. A day is `YYYY-MM-DD` and a time is
// `HH:MM`, both pantry-local, both passed to the server as text (`logic.ts` header).

import { formatMonthLabel, formatTimeLabel, monthGrid, WEEKDAY_INITIALS } from './logic.ts';
import { WEEKDAY_NAMES } from './logic.ts';

// ---------------------------------------------------------------------------
// A month of days
// ---------------------------------------------------------------------------

export interface DayPickerProps {
  /** Month on screen, as `{ year, month }` with month 1-12. */
  month: { year: number; month: number };
  onMonthChange: (month: { year: number; month: number }) => void;
  /** The chosen day, or the start of the chosen range. */
  from: string | null;
  /** The end of the chosen range. Equal to `from` outside range mode. */
  to?: string | null;
  onPick: (iso: string) => void;
  /** Days before this are shown but not offered. */
  earliest: string;
  label: string;
  hint?: string;
}

/**
 * A visible month of big day targets. Two taps make a range where the caller
 * treats them that way (the bulk-terminate range); one tap is a single day.
 *
 * Days before `earliest` — today at the PANTRY, not on this machine — are rendered
 * but not offered: a run cannot be published into the past, and the pantry's
 * calendar is the one the server will evaluate the date against.
 */
export function DayPicker({
  month,
  onMonthChange,
  from,
  to = null,
  onPick,
  earliest,
  label,
  hint,
}: DayPickerProps) {
  const atEarliestMonth = earliest.slice(0, 7) >= `${month.year}-${String(month.month).padStart(2, '0')}`;
  const rangeEnd = to ?? from;

  return (
    <fieldset className="s16-calendar">
      <legend className="s16-label">{label}</legend>
      <div className="s16-calendar__bar">
        {atEarliestMonth ? (
          <span className="s16-calendar__spacer" aria-hidden="true" />
        ) : (
          <button
            type="button"
            className="s16-calendar__nav"
            onClick={() =>
              onMonthChange(
                month.month === 1
                  ? { year: month.year - 1, month: 12 }
                  : { year: month.year, month: month.month - 1 },
              )
            }
            aria-label="Show the month before"
          >
            ‹
          </button>
        )}
        <span className="s16-calendar__month" aria-live="polite">
          {formatMonthLabel(month.year, month.month)}
        </span>
        <button
          type="button"
          className="s16-calendar__nav"
          onClick={() =>
            onMonthChange(
              month.month === 12
                ? { year: month.year + 1, month: 1 }
                : { year: month.year, month: month.month + 1 },
            )
          }
          aria-label="Show the month after"
        >
          ›
        </button>
      </div>

      <div className="s16-calendar__weekdays" aria-hidden="true">
        {WEEKDAY_INITIALS.map((initial, index) => (
          <span key={index} className="s16-calendar__weekday">
            {initial}
          </span>
        ))}
      </div>

      <div className="s16-calendar__grid">
        {monthGrid(month.year, month.month).map((week, weekIndex) =>
          week.map((cell) => {
            // Trailing cells of the six-week grid that belong to another month are
            // spacers, so the columns stay under their weekday headers.
            if (!cell.inMonth) {
              return (
                <span
                  key={`${weekIndex}-${cell.iso}`}
                  className="s16-day s16-day--blank"
                  aria-hidden="true"
                />
              );
            }
            if (cell.iso < earliest) {
              return (
                <span key={cell.iso} className="s16-day s16-day--gone" aria-hidden="true">
                  {cell.day}
                </span>
              );
            }
            const inRange =
              from !== null && rangeEnd !== null && cell.iso >= from && cell.iso <= rangeEnd;
            const edge = cell.iso === from || cell.iso === rangeEnd;
            const classes = ['s16-day'];
            if (inRange) classes.push('s16-day--in-range');
            if (edge) classes.push('s16-day--edge');
            if (cell.iso === earliest) classes.push('s16-day--today');

            return (
              <button
                key={cell.iso}
                type="button"
                className={classes.join(' ')}
                aria-pressed={inRange}
                onClick={() => onPick(cell.iso)}
              >
                {cell.day}
              </button>
            );
          }),
        )}
      </div>
      {hint ? <p className="s16-hint">{hint}</p> : null}
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// A grid of times
// ---------------------------------------------------------------------------

export function TimeChoice({
  label,
  value,
  options,
  onSelect,
}: {
  label: string;
  value: string | null;
  options: readonly string[];
  onSelect: (time: string) => void;
}) {
  return (
    <fieldset className="s16-times">
      <legend className="s16-label">{label}</legend>
      <div className="s16-times__grid">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            className={`s16-time${option === value ? ' s16-time--active' : ''}`}
            aria-pressed={option === value}
            onClick={() => onSelect(option)}
          >
            {formatTimeLabel(option)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Days of the week
// ---------------------------------------------------------------------------

/** Seven toggles, all visible. A repeating run may fall on more than one weekday
 *  (`recurrence_pattern.weekdays` is an array), so these are toggles rather than
 *  the one-of-a-set the segmented control is for. */
export function WeekdayChoice({
  label,
  value,
  onToggle,
}: {
  label: string;
  value: readonly number[];
  onToggle: (day: number) => void;
}) {
  return (
    <fieldset className="s16-weekdays">
      <legend className="s16-label">{label}</legend>
      <div className="s16-weekdays__row">
        {WEEKDAY_NAMES.map((name, index) => {
          const day = index + 1; // ISO: 1 = Monday
          const on = value.includes(day);
          return (
            <button
              key={day}
              type="button"
              className={`s16-weekday${on ? ' s16-weekday--active' : ''}`}
              aria-pressed={on}
              aria-label={name}
              onClick={() => onToggle(day)}
            >
              {name.slice(0, 3)}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// A visible list of things to choose one of
// ---------------------------------------------------------------------------

export interface ChoiceListItem {
  id: string;
  label: string;
  detail?: string;
}

/** Recognition over recall (§1.4): the routes and the drivers are both picked from
 *  a visible list of names, not typed and not opened out of a dropdown. */
export function ChoiceList({
  label,
  items,
  value,
  onSelect,
  empty,
}: {
  label: string;
  items: readonly ChoiceListItem[];
  value: string | null;
  onSelect: (id: string) => void;
  empty?: string;
}) {
  return (
    <fieldset className="s16-choices">
      <legend className="s16-label">{label}</legend>
      {items.length === 0 && empty ? (
        <p className="s16-hint">{empty}</p>
      ) : (
        <div className="s16-choices__list">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`s16-choice${item.id === value ? ' s16-choice--active' : ''}`}
              aria-pressed={item.id === value}
              onClick={() => onSelect(item.id)}
            >
              <span className="s16-choice__label">{item.label}</span>
              {item.detail ? <span className="s16-choice__detail">{item.detail}</span> : null}
            </button>
          ))}
        </div>
      )}
    </fieldset>
  );
}
