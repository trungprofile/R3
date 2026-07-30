// S2.2 Weight entry.
//
// The lead wires this into `main.tsx`'s SCREENS registry at merge, under screen
// id `receive-stop` (`app/routes.ts`: `/receive/:shiftId/stops/:stopId`,
// `requires: { anyDuty: ['RECEIVE'] }`). This lane exports and wires nothing.

export { WeightEntryScreen } from './WeightEntryScreen.tsx';
