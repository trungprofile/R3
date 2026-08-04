// The Runs tab's second view (D73) — the same runs, laid on a calendar.
//
// A VIEW, NOT A SCREEN, and deliberately not a second editor. Tapping a run opens
// the `RunEditor` the list already opens, so every guard it carries comes with it:
// `canSetDriver` / `canCancelRun` / `canMoveRun` are all OPEN||CLAIMED, and each has
// a server twin (`services/coverage.ts`'s assign, `services/schedule.ts`'s move and
// cancel). Nothing here writes anything, so an IN_PROGRESS or COMPLETED run opens
// with the note field and the Done button and no actions at all — exactly what it
// does from the list.
//
// A CELL SHOWS THE ROUTE AND THE DRIVER AND NOTHING ELSE. Times, stop counts and
// notes are in the editor one tap away. A cell that tries to be the run detail stops
// being readable at the glance the whole view exists for.
//
// BELOW THE TABLET BREAKPOINT THERE IS NO GRID. Seven columns on a 375px phone is
// unreadable, and S1.6 is a desk screen (§8, and the responsive matrix marks
// scheduling "cramped" on a phone). The range still means what it means; it is drawn
// as a day-grouped list instead, which is the shape the Runs list already uses.
//
// No calendar library. D5 rules out a dependency, and `../shared/calendar.ts` had
// the month grid already.

import type { ReactNode } from 'react';
import { EmptyState, ErrorBlock, List, ListItem, SkeletonRows, Segmented } from '../../../components/index.ts';
import type { SegmentedOption } from '../../../components/index.ts';
import { useViewport } from '../../../app/index.ts';
import type { ShiftSummary } from '../../../api/shared.ts';
import { DayPicker } from './controls.tsx';
import {
  COPY,
  WEEKDAY_INITIALS_MONDAY,
  calendarLabel,
  calendarWeeks,
  canStepCalendar,
  dayHeading,
  groupRunsByDay,
  monthOf,
  pickRangeDay,
  runCellLabel,
  stepCalendar,
} from './logic.ts';
import type { CalendarRangeKind, CalendarView } from './logic.ts';

const RANGES: readonly SegmentedOption<CalendarRangeKind>[] = [
  { value: 'DAY', label: COPY.rangeDay },
  { value: 'WEEK', label: COPY.rangeWeek },
  { value: 'MONTH', label: COPY.rangeMonth },
  { value: 'CUSTOM', label: COPY.rangeCustom },
];

export interface RunCalendarProps {
  view: CalendarView;
  onViewChange: (view: CalendarView) => void;
  runs: ShiftSummary[];
  showLoading: boolean;
  error: unknown;
  onRetry: () => void;
  /** Today at the pantry (A120) — the day labels and the ring are read off it,
   *  never off the device clock. */
  today: string;
  selectedId: string | null;
  onOpen: (run: ShiftSummary) => void;
  /** The one editor, rendered under whichever cell or row is open. */
  renderEditor: (run: ShiftSummary) => ReactNode;
}

export function RunCalendar({
  view,
  onViewChange,
  runs,
  showLoading,
  error,
  onRetry,
  today,
  selectedId,
  onOpen,
  renderEditor,
}: RunCalendarProps) {
  const viewport = useViewport();
  // Week and month are the only ranges with a grid, and only above the phone
  // breakpoint. Everything else reads as a day-grouped list.
  const asGrid = viewport !== 'phone' && (view.kind === 'WEEK' || view.kind === 'MONTH');
  const weeks = asGrid ? calendarWeeks(view, runs) : [];
  const groups = asGrid ? [] : groupRunsByDay(runs, today);
  const selected = runs.find((run) => run.id === selectedId) ?? null;

  return (
    <div className="s16-cal">
      <Segmented
        label={COPY.rangeLabel}
        options={RANGES}
        value={view.kind}
        onChange={(kind) => onViewChange({ ...view, kind })}
      />

      {view.kind === 'CUSTOM' ? (
        // The same two-tap range the bulk terminate uses (`pickRangeDay`), and the
        // same picker — with no floor, because browsing back over a week that has
        // already happened is the point of a custom range.
        <DayPicker
          label={COPY.rangeCustom}
          hint={COPY.rangeCustomHint}
          month={monthOf(view.custom.fromDate ?? view.anchor, { year: 2026, month: 1 })}
          onMonthChange={(month) =>
            onViewChange({
              ...view,
              anchor: `${month.year}-${String(month.month).padStart(2, '0')}-01`,
            })
          }
          from={view.custom.fromDate}
          to={view.custom.toDate}
          today={today}
          onPick={(iso) => onViewChange({ ...view, custom: pickRangeDay(view.custom, iso) })}
        />
      ) : null}

      <div className="s16-cal__bar">
        {canStepCalendar(view) ? (
          <button
            type="button"
            className="s16-calendar__nav"
            onClick={() => onViewChange(stepCalendar(view, -1))}
            aria-label={COPY.calendarPrevious}
          >
            ‹
          </button>
        ) : (
          <span className="s16-calendar__spacer" aria-hidden="true" />
        )}
        <span className="s16-cal__label" aria-live="polite">
          {calendarLabel(view, today)}
        </span>
        {canStepCalendar(view) ? (
          <button
            type="button"
            className="s16-calendar__nav"
            onClick={() => onViewChange(stepCalendar(view, 1))}
            aria-label={COPY.calendarNext}
          >
            ›
          </button>
        ) : (
          <span className="s16-calendar__spacer" aria-hidden="true" />
        )}
      </div>

      {showLoading && runs.length === 0 ? (
        <SkeletonRows rows={5} label="Loading runs" />
      ) : error ? (
        <ErrorBlock error={error} onRetry={onRetry} />
      ) : asGrid ? (
        <>
          <div className="s16-cal__weekdays" aria-hidden="true">
            {WEEKDAY_INITIALS_MONDAY.map((initial, index) => (
              <span key={index} className="s16-calendar__weekday">
                {initial}
              </span>
            ))}
          </div>
          <div className="s16-cal__grid">
            {weeks.map((week, weekIndex) =>
              week.map((cell) => (
                <div
                  key={`${weekIndex}-${cell.iso}`}
                  className={`s16-cell${cell.inRange ? '' : ' s16-cell--outside'}`}
                >
                  <span className="s16-cell__day">{cell.day}</span>
                  <ul
                    className="s16-cell__runs"
                    aria-label={COPY.calendarCellLabel(dayHeading(cell.iso, today), cell.runs.length)}
                  >
                    {cell.runs.map((run) => (
                      <li key={run.id}>
                        <button
                          type="button"
                          className={`s16-cell__run${run.id === selectedId ? ' s16-cell__run--open' : ''}`}
                          aria-pressed={run.id === selectedId}
                          onClick={() => onOpen(run)}
                        >
                          {runCellLabel(run)}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )),
            )}
          </div>
          {/* One editor, under the grid rather than inside a cell: a cell is too
              small to hold a form, and the grid must not reflow as one opens. */}
          {selected !== null ? (
            <div className="s16-list-editor">{renderEditor(selected)}</div>
          ) : null}
        </>
      ) : groups.length === 0 ? (
        <EmptyState title={COPY.calendarEmpty}>{COPY.calendarEmptyBody}</EmptyState>
      ) : (
        <>
          {viewport === 'phone' && (view.kind === 'WEEK' || view.kind === 'MONTH') ? (
            <p className="s16-hint">{COPY.calendarListOnly}</p>
          ) : null}
          {groups.map((group) => (
            <section className="s16-day" key={group.date}>
              <h3 className="s16-day__heading">
                {group.headingParts.lead},{' '}
                <span className="s16-day__date">{group.headingParts.date}</span>
              </h3>
              <List label={group.heading}>
                {group.runs.map((run) => (
                  <ListItem key={run.id}>
                    <button
                      type="button"
                      className={`s16-cal__row${run.id === selectedId ? ' s16-cal__row--open' : ''}`}
                      aria-pressed={run.id === selectedId}
                      onClick={() => onOpen(run)}
                    >
                      {runCellLabel(run)}
                    </button>
                    {run.id === selectedId ? (
                      <div className="s16-list-editor">{renderEditor(run)}</div>
                    ) : null}
                  </ListItem>
                ))}
              </List>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
