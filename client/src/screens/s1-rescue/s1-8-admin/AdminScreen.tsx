// S1.8 Admin — the back office in one place. Admin, desktop-canonical
// (responsive matrix: "Admin — n/a on phone, canonical on desktop").
//
// Layout is S1.8's own line: "four sub-screens — Accounts, Donors, Trucks,
// Categories — selected by the §3 segmented control in its tabs behavior. One is
// shown at a time; §1.5 rules out putting them behind a dropdown, and four is
// small enough to show them all."
//
// It is FIVE now, and the sentence still holds. D18 folded S3.2 Metrics in as the
// first tab; D17 added Category matching beside Categories and D40 merged the two
// back into one, because "beside" turned out to mean an admin configured a category
// on one tab and said where it reports on another. §1 principle 5 rules out hiding
// any of these behind a dropdown just as firmly at five as at four, so the row stays
// visible and wraps rather than collapsing. `logic.ts` PANELS is the list and the
// reasoning, and `RETIRED_PANELS` is what keeps `?tab=mapping` resolving.
//
// So this file is `components/Segmented.tsx` in `mode="tabs"` and nothing else.
// The keyboard behaviour a tablist obliges — one stop in the tab order, arrows
// between tabs, Home/End — lives in that component, and `tabPanelProps` is what
// keeps its `aria-controls` pointing at the panel actually rendered below. Exactly
// one panel is mounted, which is the other half of the same contract.
//
// THE TAB IS IN THE URL (`?tab=`), so "the coverage numbers are under Metrics" is
// a link someone can send rather than a set of directions. It moves with
// `setQuery`, which replaces rather than pushes: a tab is not a place anyone
// should have to press Back through, and six tabs would otherwise bury the screen
// someone actually came from under six history entries.
//
// The screen is reached at `/admin`, declared `requires: { tier: 'ADMIN' }` in
// `app/routes.ts` — a hierarchical comparison (I1), and the shell hides the nav
// entry from anyone below it. Every route this screen calls declares ADMIN again
// for the writes and STAFF or VOLUNTEER for the reads; the client check is
// communication, never the rule (`architecture.md §4.5`).

import { useState } from 'react';
import type { ScreenProps } from '../../../app/index.ts';
import { useRouter } from '../../../app/index.ts';
import { Segmented, tabPanelProps } from '../../../components/index.ts';
import { AccountsPanel } from './AccountsPanel.tsx';
import { MasterPanel } from './MasterPanel.tsx';
import { MappingEditor } from './mapping/MappingEditor.tsx';
import { MetricsPanel } from './metrics/index.ts';
import { CATEGORY_CONFIG, DONOR_CONFIG, TRUCK_CONFIG } from './masters.ts';
import { COPY, PANELS, PANEL_QUERY_KEY, panelFromQuery, type PanelId } from './logic.ts';
import './admin.css';

const ID_PREFIX = 's18';

export function AdminScreen(_props: ScreenProps) {
  const { query, setQuery } = useRouter();
  const panel = panelFromQuery(query[PANEL_QUERY_KEY]);

  /** Bumped when the food bank's list changes, to remount the categories list
   *  above it (D40). A counter rather than a callback into `MasterPanel`, because
   *  a panel that exposed a reload handle would be a second way to refresh it. */
  const [categoriesEpoch, setCategoriesEpoch] = useState(0);

  // `setQuery`, never `go`: same path, no history entry (`app/router.tsx`).
  const openPanel = (next: PanelId) => setQuery({ [PANEL_QUERY_KEY]: next });

  // Metrics is a wide table and a row of bars; the forms are a single column.
  // Widening the shell for all six would leave an account form floating in a lot
  // of white space, so the constraint follows the panel.
  const wide = panel === 'metrics';

  return (
    <div className={wide ? 's18 s18--wide' : 's18'}>
      {/* Matches the nav item that leads here ("Admin", `app/nav.tsx`), so the
          heading confirms where the click landed rather than renaming the place. */}
      <h1 className="s18-title">{COPY.title}</h1>

      <Segmented
        mode="tabs"
        idPrefix={ID_PREFIX}
        label={COPY.tabsLabel}
        options={PANELS}
        value={panel}
        onChange={openPanel}
      />

      <div className="s18-panel" {...tabPanelProps(ID_PREFIX, panel)}>
        {/* S3.2, reached as a tab since D18. Still the spec's own screen: nothing
            about what it computes changed, only where it is opened from. */}
        {panel === 'metrics' ? <MetricsPanel /> : null}
        {panel === 'accounts' ? <AccountsPanel /> : null}
        {panel === 'donors' ? <MasterPanel config={DONOR_CONFIG} /> : null}
        {panel === 'trucks' ? <MasterPanel config={TRUCK_CONFIG} /> : null}
        {/* ONE TAB, TWO SECTIONS (D40).
            TOP: the pantry's own categories (build-plan D2, which resolved the
            PRD/UI conflict in the UI spec's favour), each row's editor now
            carrying where it reports and under which storage — so an admin says
            both while configuring the category rather than finishing and going to
            a second tab to find it again.
            BOTTOM: the food bank's own list, seeded by D26, read-mostly, with the
            count of ours reporting under each.
            The two are stacked rather than side by side because the bottom one is
            a reference an admin consults, not a step in the top one. */}
        {panel === 'categories' ? (
          <>
            <MasterPanel key={categoriesEpoch} config={CATEGORY_CONFIG} />
            <div className="s18-section-break" />
            {/* Archiving a food bank category changes what the form above may
                pick, so the list above is remounted rather than left holding
                choices that no longer exist. */}
            <MappingEditor onChanged={() => setCategoriesEpoch((n) => n + 1)} />
          </>
        ) : null}
      </div>
    </div>
  );
}
