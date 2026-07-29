// S1.4 — My shifts + availability.
//
// The seam: `client/src/main.tsx`'s `SCREENS` registry is wired by the lead at
// merge, under the screen id `my-shifts` (route `/my-shifts`, declared in
// `app/routes.ts`). This barrel is the only thing that wiring needs to import.

export { MyShiftsScreen } from './MyShiftsScreen.tsx';
export * from './logic.ts';
