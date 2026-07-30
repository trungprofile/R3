// S1.6's one export. `main.tsx`'s `SCREENS` registry imports from here — the lead
// adds that line at merge (build-plan §3: `main.tsx` is single-owner), so this file
// is the whole seam between the shell and the screen.

export { ScheduleScreen } from './ScheduleScreen.tsx';
