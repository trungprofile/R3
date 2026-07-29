// S1.5 Driver pickup execution.
//
// The lead wires this into `main.tsx`'s SCREENS registry at merge, under screen
// id `pickup` (`app/routes.ts`: `/pickup/:shiftId`, `fullScreen: true`,
// `requires: { anyDuty: ['DRIVE'] }`). This lane exports and wires nothing.

export { PickupScreen } from './PickupScreen.tsx';
