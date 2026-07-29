// S1.2 — shared shift board. The barrel `main.tsx`'s screen registry imports from:
//
//   board: BoardScreen,        S1.2
//
// The registry entry is the lead's to write at merge; everything else about this
// screen lives in this folder.

export { BoardScreen } from './Board.tsx';

// Exported for tests and for anyone tracing S1.2's rules back to the spec. Nothing
// outside this folder needs them.
export {
  AT_RISK_LEAD_MS,
  BOARD_FILTERS,
  COPY,
  actionFor,
  dayHeading,
  groupByDay,
  isAtRisk,
  isoWeekday,
  parseCalendarDate,
  skippedLines,
  timeRange,
  todayCalendarDate,
  weekdayName,
  withOptimisticClaim,
} from './board.ts';
export type { BoardFilter, BoardRow, BoardViewer, DayGroup, RowAction } from './board.ts';
