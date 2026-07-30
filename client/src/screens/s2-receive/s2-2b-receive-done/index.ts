// S2.2b — Receive done.
//
// The seam: `client/src/main.tsx`'s `SCREENS` registry is wired by the lead, under
// the screen id `receive-done` (route `/receive/:shiftId/done`, declared in
// `app/routes.ts`). This barrel is the only thing that wiring needs to import.

export { ReceiveDoneScreen } from './ReceiveDoneScreen.tsx';
export * from './receive-done.ts';
