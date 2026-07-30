// S1.8 Admin — accounts, donors, trucks, categories. Admin, desktop-canonical
// (responsive matrix: "Admin — n/a on phone, canonical on desktop").
//
// Layout is S1.8's own line: "four sub-screens — Accounts, Donors, Trucks,
// Categories — selected by the §3 segmented control in its tabs behavior. One is
// shown at a time; §1.5 rules out putting them behind a dropdown, and four is
// small enough to show them all."
//
// So this file is `components/Segmented.tsx` in `mode="tabs"` and nothing else.
// The keyboard behaviour a tablist obliges — one stop in the tab order, arrows
// between tabs, Home/End — lives in that component, and `tabPanelProps` is what
// keeps its `aria-controls` pointing at the panel actually rendered below. Exactly
// one panel is mounted, which is the other half of the same contract.
//
// The screen is reached at `/admin`, declared `requires: { tier: 'ADMIN' }` in
// `app/routes.ts` — a hierarchical comparison (I1), and the shell hides the nav
// entry from anyone below it. Every route this screen calls declares ADMIN again
// for the writes and STAFF or VOLUNTEER for the reads; the client check is
// communication, never the rule (`architecture.md §4.5`).

import { useState } from 'react';
import type { ScreenProps } from '../../../app/index.ts';
import { Segmented, tabPanelProps } from '../../../components/index.ts';
import { AccountsPanel } from './AccountsPanel.tsx';
import { MasterPanel } from './MasterPanel.tsx';
import { CATEGORY_CONFIG, DONOR_CONFIG, TRUCK_CONFIG } from './masters.ts';
import { COPY, PANELS, type PanelId } from './logic.ts';
import './admin.css';

const ID_PREFIX = 's18';

export function AdminScreen(_props: ScreenProps) {
  const [panel, setPanel] = useState<PanelId>('accounts');

  return (
    <div className="s18">
      {/* Matches the nav item that leads here ("Admin", `app/nav.tsx`), so the
          heading confirms where the click landed rather than renaming the place. */}
      <h1 className="s18-title">{COPY.title}</h1>

      <Segmented
        mode="tabs"
        idPrefix={ID_PREFIX}
        label={COPY.tabsLabel}
        options={PANELS}
        value={panel}
        onChange={setPanel}
      />

      <div className="s18-panel" {...tabPanelProps(ID_PREFIX, panel)}>
        {panel === 'accounts' ? <AccountsPanel /> : null}
        {panel === 'donors' ? <MasterPanel config={DONOR_CONFIG} /> : null}
        {panel === 'trucks' ? <MasterPanel config={TRUCK_CONFIG} /> : null}
        {/* Categories ship in Phase 1 (build-plan D2, which resolved the PRD/UI
            conflict in the UI spec's favour). Nothing consumes them until Phase
            2's weight entry, so an inert list here is correct, not missing. */}
        {panel === 'categories' ? <MasterPanel config={CATEGORY_CONFIG} /> : null}
      </div>
    </div>
  );
}
