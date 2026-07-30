// S2.3 — Unscheduled donation.
//
// The seam: `client/src/main.tsx`'s `SCREENS` registry is wired by the lead, under
// the screen id `donation` (route `/donations/new`, declared in `app/routes.ts`).
// This barrel is the only thing that wiring needs to import.

export { DonationScreen } from './DonationScreen.tsx';
export * from './donation.ts';
