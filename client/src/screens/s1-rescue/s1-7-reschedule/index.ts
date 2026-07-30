// S1.7 — Staff, reschedule.
//
// The seam: `client/src/main.tsx`'s `SCREENS` registry is wired by the lead at
// merge, under the screen id `reschedule` (route `/schedule/:shiftId/reschedule`,
// declared in `app/routes.ts` with `requires: { tier: 'STAFF' }`). This barrel is
// the only thing that wiring needs to import.

export { RescheduleScreen } from './RescheduleScreen.tsx';
export * from './logic.ts';
