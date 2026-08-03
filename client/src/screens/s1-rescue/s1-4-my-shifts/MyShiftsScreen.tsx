// S1.4 — My shifts + availability. Driver, phone-canonical (responsive matrix).
//
// "Layout: two tabs, 'My runs' (list) and 'When I'm away'." Availability lives
// inside My Shifts and has no nav entry of its own (§4), which is why it is a tab
// here rather than a screen.
//
// The screen is reached at `/my-shifts`, declared `requires: { anyDuty: ['DRIVE'] }`
// in `app/routes.ts` — set membership, never a tier comparison (I2). The shell
// hides it from anyone else and the server refuses it again; neither check is the
// rule on its own.
//
// TWO WAYS IN SINCE D30. Its nav entry is gone — a driver was carrying two entries
// for one job — and the board (S1.2) mounts this same component as its second tab.
// The route stays: a bookmark, and the Home hub's "My shifts" card, both still point
// here, and a screen that is only ever a tab is a screen you cannot link to.
//
// The two mountings differ in exactly one thing, `embedded`, and it is a heading
// question rather than a behavioural one. See the prop.

import { useState } from 'react';
import type { ScreenProps } from '../../../app/index.ts';
import { Segmented, tabPanelProps } from '../../../components/index.ts';
import type { SegmentedOption } from '../../../components/index.ts';
import { AwayPanel } from './AwayPanel.tsx';
import { RunsPanel } from './RunsPanel.tsx';
import './my-shifts.css';

type TabId = 'runs' | 'away';

/** `mode="tabs"`, not the default filter mode: these switch which panel is
 *  mounted rather than narrowing a list that stays on screen (§3). */
const TABS: readonly SegmentedOption<TabId>[] = [
  { value: 'runs', label: 'My runs' },
  { value: 'away', label: "When I'm away" },
];

/** `params` is optional because the board mounts this as a tab rather than as a
 *  route, and a tab has no `:params` to hand it. Still assignable to the registry's
 *  `ComponentType<ScreenProps>`, which is the only other caller. */
interface MyShiftsScreenProps extends Partial<ScreenProps> {
  /**
   * D30 — mounted inside another screen's tab rather than as `/my-shifts`.
   *
   * Drops this screen's own `<h1>`, and nothing else. The board already carries the
   * page heading and a selected tab reading "My shifts", so a second `<h1>` would be
   * both a repeated word on screen and two top-level headings in one document.
   */
  embedded?: boolean;
}

export function MyShiftsScreen({ embedded = false }: MyShiftsScreenProps) {
  const [tab, setTab] = useState<TabId>('runs');

  return (
    <div className="s14">
      {/* Matches the tab or card that leads here ("My shifts"), so the heading
          confirms where the tap landed rather than renaming the place. Absent when
          the board owns the page heading (D30). */}
      {embedded ? null : <h1 className="s14-title">My shifts</h1>}
      <Segmented
        mode="tabs"
        idPrefix="s14"
        label="My runs and time away"
        options={TABS}
        value={tab}
        onChange={setTab}
      />
      <div className="s14-panel" {...tabPanelProps('s14', tab)}>
        {tab === 'runs' ? <RunsPanel /> : <AwayPanel />}
      </div>
    </div>
  );
}
