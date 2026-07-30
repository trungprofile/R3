// S2.1b — the run picker.
//
// The seam: `client/src/main.tsx`'s `SCREENS` registry is wired by the lead at
// merge, under the screen id `receive-runs` (route `/receive`, declared in
// `app/routes.ts` with `requires: { anyDuty: ['RECEIVE'] }`). This barrel is the
// only thing that wiring needs to import.

export { RunPickerScreen } from './RunPickerScreen.tsx';
export * from './run-picker.ts';
