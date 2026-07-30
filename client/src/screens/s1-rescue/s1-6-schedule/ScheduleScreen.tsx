// S1.6 — Staff, shift & route scheduling. Desktop-canonical (responsive matrix),
// reached at `/schedule`, declared `requires: { tier: 'STAFF' }` in `app/routes.ts`.
//
// The tier comparison is HIERARCHICAL (I1), so Admin reaches this without being
// named, and it is a tier rather than a duty: coordinating runs is not driving them,
// and `product-requirement.md` cap 4 gives publishing and route definition to Staff.
// The shell hides the nav entry from anyone else and every endpoint below refuses it
// again; neither check is the rule on its own (`architecture.md §4.5`).
//
// THREE PANELS, one on screen at a time, because §4 describes one desktop nav entry
// covering "publish, routes, reschedule, assign" and §1.5 rules out putting them
// behind a dropdown. The segmented control in its **tabs** behavior is what §3
// specifies for switching panels, which obliges the whole WAI-ARIA tab pattern —
// `components/Segmented.tsx` implements it and `tabPanelProps` binds the panel back.
//
// Reschedule is the fourth thing in that nav list and is NOT here: cap 9 has to show
// the owner's conflicts before it moves anything, which is its own screen (S1.7). The
// run editor links there.

import { useCallback, useState } from 'react';
import { Segmented, tabPanelProps } from '../../../components/index.ts';
import type { SegmentedOption } from '../../../components/index.ts';
import type { ScreenProps } from '../../../app/index.ts';
import { PatternsPanel } from './PatternsPanel.tsx';
import { RoutesPanel } from './RoutesPanel.tsx';
import { RunsPanel } from './RunsPanel.tsx';
import { COPY } from './logic.ts';
import './schedule.css';

type TabId = 'runs' | 'repeating' | 'routes';

const TABS: readonly SegmentedOption<TabId>[] = [
  { value: 'runs', label: COPY.tabRuns },
  { value: 'repeating', label: COPY.tabRepeating },
  { value: 'routes', label: COPY.tabRoutes },
];

export function ScheduleScreen(_props: ScreenProps) {
  const [tab, setTab] = useState<TabId>('runs');
  /**
   * The Runs tab's "Edit the weekly pattern" hand-off (PRD cap 4).
   *
   * It carries a pattern id rather than the run that was tapped, because the two
   * edits are edits of different rows: I23 keeps a per-run change off the pattern,
   * and I24 makes the pattern-level edit the only thing that changes the pattern.
   */
  const [editPatternId, setEditPatternId] = useState<string | null>(null);

  const consumeEdit = useCallback(() => setEditPatternId(null), []);

  return (
    <div className="s16">
      {/* Matches the nav item that leads here ("Schedule", `app/nav.tsx`), so the
          heading confirms where the click landed rather than renaming the place. */}
      <h1 className="s16-title">{COPY.title}</h1>

      <Segmented
        mode="tabs"
        idPrefix="s16"
        label={COPY.tabsLabel}
        options={TABS}
        value={tab}
        onChange={setTab}
      />

      <div className="s16-tabpanel" {...tabPanelProps('s16', tab)}>
        {tab === 'runs' ? (
          <RunsPanel
            onEditPattern={(patternId) => {
              setEditPatternId(patternId);
              setTab('repeating');
            }}
          />
        ) : null}
        {tab === 'repeating' ? (
          <PatternsPanel editPatternId={editPatternId} onEditConsumed={consumeEdit} />
        ) : null}
        {tab === 'routes' ? <RoutesPanel /> : null}
      </div>
    </div>
  );
}
