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

import { useState } from 'react';
import type { ScreenProps } from '../../../app/index.ts';
import { AwayPanel } from './AwayPanel.tsx';
import { RunsPanel } from './RunsPanel.tsx';
import { Tabs } from './Tabs.tsx';
import type { TabDef } from './Tabs.tsx';
import './my-shifts.css';

type TabId = 'runs' | 'away';

const TABS: readonly TabDef<TabId>[] = [
  { id: 'runs', label: 'My runs' },
  { id: 'away', label: "When I'm away" },
];

export function MyShiftsScreen(_props: ScreenProps) {
  const [tab, setTab] = useState<TabId>('runs');

  return (
    <div className="s14">
      {/* Matches the nav item that leads here ("My Shifts", `app/nav.tsx`), so the
          heading confirms where the tap landed rather than renaming the place. */}
      <h1 className="s14-title">My shifts</h1>
      <Tabs tabs={TABS} active={tab} onSelect={setTab} label="My runs and time away" />
      <div
        className="s14-panel"
        role="tabpanel"
        id={`s14-panel-${tab}`}
        aria-labelledby={`s14-tab-${tab}`}
      >
        {tab === 'runs' ? <RunsPanel /> : <AwayPanel />}
      </div>
    </div>
  );
}
