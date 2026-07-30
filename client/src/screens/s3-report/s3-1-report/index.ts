// S3.1 — Report generation.
//
// The seam: `client/src/main.tsx`'s `SCREENS` registry is wired by the lead, and
// `app/routes.ts` declares the route (`report` duty, desktop). This barrel is the
// only thing that wiring needs to import.

export { ReportScreen } from './ReportScreen.tsx';
export * from './report.ts';
