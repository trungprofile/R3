// S1.4 — My shifts + availability.
//
// The seam: `client/src/main.tsx`'s `SCREENS` registry is wired by the lead at
// merge, under the screen id `my-shifts` (route `/my-shifts`, declared in
// `app/routes.ts`). This barrel is the only thing that wiring needs to import.

export { MyShiftsScreen } from './MyShiftsScreen.tsx';
/** Mounted by S1.2 as its "When I'm away" tab since D49. It stays declared here
 *  because it is S1.4's half of the spec; only where it is rendered moved. */
export { AwayPanel } from './AwayPanel.tsx';
export * from './logic.ts';
