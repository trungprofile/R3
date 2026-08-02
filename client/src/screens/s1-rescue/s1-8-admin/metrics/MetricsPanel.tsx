// S3.2 Admin metrics — admin, desktop-canonical (responsive matrix: report +
// metrics are "n/a" on phone, "usable" on tablet, canonical on desktop). So there
// is no phone layout here on purpose, and nothing below is allowed to break at
// tablet width either.
//
// Two tabs, per S3.2: the intake table it opens with, and the coverage tab PRD cap
// 16 adds. They are the §3 segmented control in its TABS behavior — one panel
// mounted at a time, `tabPanelProps` keeping `aria-controls` pointed at the panel
// actually rendered, and the keyboard contract (one tab stop, arrows, Home/End)
// living in the component rather than being promised and not delivered.
//
// THE PERIOD IS SHARED and sits above the tabs, because it is a fact about the
// whole screen rather than about either panel: switching from intake to coverage
// must not silently change the window being read. It is held as a LENGTH plus a
// number of whole periods back, not as two dates, so that:
//
//   - stepping back always moves by the period's own length, which is exactly the
//     window `previousIntake` is measured against (`services/metrics.ts`), and
//   - the window recomputes when the pantry's own zone arrives on the sign-in
//     (A120) instead of freezing whatever the machine's clock said first.
//
// The screen is reached at `/metrics`, declared `requires: { tier: 'ADMIN' }` in
// `app/routes.ts` — a hierarchical comparison (I1), and the shell hides the nav
// entry from anyone below it. Both routes it calls declare ADMIN again; the client
// check is communication, never the rule (`architecture.md §4.5`).
//
// Everything on this screen is a READ. S3.2: "Primary action: none destructive;
// this is read + export." The one primary button per panel is its download, and
// there is nothing here to edit, cancel or confirm.

import { useMemo, useState } from 'react';
import type { ScreenProps } from '../../../app/index.ts';
import { todayInZone, useSession } from '../../../app/index.ts';
import { Button, Segmented, tabPanelProps } from '../../../components/index.ts';
import { CoverageTab } from './CoverageTab.tsx';
import { IntakeTab } from './IntakeTab.tsx';
import {
  canGoLater,
  COPY,
  DEFAULT_PERIOD_DAYS,
  PERIOD_PRESETS,
  periodFor,
  periodRangeLabel,
  TABS,
  type PeriodPresetId,
  type TabId,
} from './metrics.ts';
import './metrics.css';

const ID_PREFIX = 's32';

export function MetricsScreen(_props: ScreenProps) {
  const { timezone } = useSession();
  const [tab, setTab] = useState<TabId>('intake');
  const [presetId, setPresetId] = useState<PeriodPresetId>(String(DEFAULT_PERIOD_DAYS) as PeriodPresetId);
  /** Whole periods back from the one ending today. 0 is A179's default window. */
  const [stepsBack, setStepsBack] = useState(0);

  // Today at the PANTRY, not on this machine (A120). A run's date is a pantry-local
  // fact, so a desktop in another zone must not shift the window near midnight.
  const today = todayInZone(timezone);
  const days = Number(presetId);
  const period = useMemo(() => periodFor(today, days, stepsBack), [today, days, stepsBack]);

  return (
    <div className="s32">
      {/* Matches the nav item that leads here ("Metrics", `app/nav.tsx`), so the
          heading confirms where the click landed rather than renaming the place. */}
      <h1 className="s32-title">{COPY.title}</h1>

      <section className="s32-period" aria-label={COPY.period.heading}>
        <div className="s32-period__group">
          <p className="s32-period__label">{COPY.period.label}</p>
          <Segmented
            label={COPY.period.label}
            options={PERIOD_PRESETS}
            value={presetId}
            onChange={(value) => {
              setPresetId(value);
              // A new length re-anchors on today. Keeping the step count would put
              // the window somewhere neither button had been asked to go.
              setStepsBack(0);
            }}
          />
        </div>

        <div className="s32-period__nav">
          <Button
            onClick={() => setStepsBack((steps) => steps + 1)}
            aria-label={COPY.period.earlierAria}
          >
            {COPY.period.earlier}
          </Button>
          {/* Hidden rather than disabled (§3 prefers hiding): a period after today
              holds no data, so there is nothing behind the button to explain. */}
          {canGoLater(stepsBack) ? (
            <Button
              onClick={() => setStepsBack((steps) => Math.max(0, steps - 1))}
              aria-label={COPY.period.laterAria}
            >
              {COPY.period.later}
            </Button>
          ) : null}
        </div>

        {/* The window both tabs are reading, stated once. `aria-live` because the
            buttons change it without moving focus, and an admin who has just
            stepped back twice needs to hear where they landed. */}
        <p className="s32-period__range" aria-live="polite">
          {periodRangeLabel(period)}
        </p>
      </section>

      <Segmented
        mode="tabs"
        idPrefix={ID_PREFIX}
        label={COPY.tabsLabel}
        options={TABS}
        value={tab}
        onChange={setTab}
      />

      <div className="s32-panel" {...tabPanelProps(ID_PREFIX, tab)}>
        {/* Exactly one panel is mounted, which is the other half of the tabs
            contract — and it also means only one of the two reads is in flight. */}
        {tab === 'intake' ? <IntakeTab period={period} /> : null}
        {tab === 'coverage' ? <CoverageTab period={period} /> : null}
      </div>
    </div>
  );
}
