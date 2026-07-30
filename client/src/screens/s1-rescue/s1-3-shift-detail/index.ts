// S1.3 Shift detail.
//
// The lead wires this into `main.tsx`'s SCREENS registry at merge, under screen id
// `shift` (`app/routes.ts`: `/shifts/:shiftId`, phase 1, no `requires` — the board
// is a shared surface and both of this screen's users open rows from it, so what a
// viewer may DO here is decided per action rather than at the route). This lane
// exports and wires nothing.

export { ShiftDetailScreen } from './ShiftDetailScreen.tsx';
