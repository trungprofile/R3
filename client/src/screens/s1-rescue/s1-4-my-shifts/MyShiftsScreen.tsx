// S1.4 — the driver's own runs. Driver, phone-canonical (responsive matrix).
//
// ONE JOB, NO TABS, SINCE D49. S1.4 was specified as "two tabs, 'My runs' and 'When
// I'm away'", and D30 then mounted the whole thing as a tab on the board — so a
// driver met a tab row inside a tab row, with the inner one held in local state
// where no link could reach it. That nesting was the top complaint of round 4.
//
// D49 splits the two halves by what they are for rather than by which screen they
// were specified on:
//
//   * this screen, `/my-shifts`, nav entry "Today's pickup" — today's run and the rest
//     of the week. It is where a driver lands, and it has no tabs.
//   * "When I'm away" — the availability declaration, which §4 gives no nav entry of
//     its own — is now the board's second tab (`/board?tab=away`), where it is
//     linkable and survives a reload.
//
// `AwayPanel` still lives in this folder: it is S1.4's own half of the spec, and the
// board imports it. Which screen mounts a panel is a navigation decision; which
// screen OWNS it is not.
//
// The `embedded` prop is gone with the nesting. This screen is a route again and
// carries its own `<h1>`.
//
// The route is declared `requires: { anyDuty: ['DRIVE'] }` in `app/routes.ts` — set
// membership, never a tier comparison (I2). The shell hides it from anyone else and
// the server refuses it again; neither check is the rule on its own.
//
// No `BackLink` (D43): this screen IS a nav entry, and a nav destination has no
// parent to go back to.

import type { ScreenProps } from '../../../app/index.ts';
import { COPY } from './logic.ts';
import { RunsPanel } from './RunsPanel.tsx';
import './my-shifts.css';

/** `params` stays optional: the registry's `ComponentType<ScreenProps>` is the only
 *  caller, and this screen reads none of them. */
type MyShiftsScreenProps = Partial<ScreenProps>;

export function MyShiftsScreen(_props: MyShiftsScreenProps) {
  return (
    <div className="s14">
      {/* The nav entry's own words, so the heading confirms where the tap landed
          rather than renaming the place. */}
      <h1 className="s14-title">{COPY.pageTitle}</h1>
      <RunsPanel />
    </div>
  );
}
