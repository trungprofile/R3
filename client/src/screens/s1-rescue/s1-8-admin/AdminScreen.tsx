// S1.8 Admin — the back office in one place. Admin, desktop-canonical
// (responsive matrix: "Admin — n/a on phone, canonical on desktop").
//
// Layout is S1.8's own line: "four sub-screens — Accounts, Donors, Trucks,
// Categories — selected by the §3 segmented control in its tabs behavior. One is
// shown at a time; §1.5 rules out putting them behind a dropdown, and four is
// small enough to show them all."
//
// It is SIX now, and the sentence still holds. D18 folded S3.2 Metrics in as the
// first tab and D12's category matching sits beside Categories; §1 principle 5
// rules out hiding any of them behind a dropdown just as firmly at six as at four,
// so the row stays visible and wraps rather than collapsing. `logic.ts` PANELS is
// the list and the reasoning.
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
        {/* Categories ship in Phase 1 (build-plan D2, which resolved the PRD/UI
            conflict in the UI spec's favour). Nothing consumes them until Phase
            2's weight entry, so an inert list here is correct, not missing. */}
        {panel === 'categories' ? <MasterPanel config={CATEGORY_CONFIG} /> : null}
        {/* D12 — which of our categories reports under which NTFB one. The table
            ships empty on purpose: the names are NTFB's, not ours to invent, and
            this is where the pantry enters them. */}
        {panel === 'mapping' ? <MappingEditor /> : null}
      </div>
    </div>
  );
}
