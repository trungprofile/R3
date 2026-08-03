// S3.2 Admin metrics — admin, desktop-canonical (responsive matrix: report +
// metrics are "n/a" on phone, "usable" on tablet, canonical on desktop). So there
// is no phone layout here on purpose, and nothing below is allowed to break at
// tablet width either.
//
// STILL S3.2 IN THE SPEC; only the way in changed. D18 folded it into S1.8 as that
// screen's FIRST tab rather than a seventh left-nav entry — the two things an admin
// opens R3 for are "how are we doing" and "fix a record", and they now sit one
// click apart instead of in two places. So this file exports a PANEL, not a screen:
// no `<h1>` (the shell's Admin title owns that), no route of its own. `/metrics`
// survives as a redirect (`MetricsRedirect.tsx`) so an existing bookmark resolves.
//
// Two tabs, per S3.2: the intake table it opens with, and the coverage tab PRD cap
// 16 adds. They are the §3 segmented control in its TABS behavior — one panel
// mounted at a time, `tabPanelProps` keeping `aria-controls` pointed at the panel
// actually rendered, and the keyboard contract (one tab stop, arrows, Home/End)
// living in the component rather than being promised and not delivered.
//
// THE PERIOD IS SHARED and sits above the tabs, because it is a fact about the
// whole screen rather than about either panel: switching from intake to coverage
// must not silently change the window being read.
//
// SINCE D39 IT IS TWO DATES, DEFAULTING TO THIS WEEK. It used to be a segmented
// row of 1 / 4 / 12 weeks plus a step counter, defaulting to 28 days — which A179
// recorded as a guess no doc ever settled. D39 answers A179: the default is the
// same Monday-to-Sunday week S3.1 reports on and S1.2's board opens on, read from
// the one `app/week.ts` helper all three share, so an admin with the report in one
// tab and this in another cannot be shown two different weeks under one word.
//
// What did NOT change is the thing that made the old shape right: Earlier/Later
// still step by the window's OWN LENGTH, which is exactly the window
// `previousIntake` is measured against (`services/metrics.ts`). `periodFor` always
// took a length rather than a "last N", so it carried straight over.
//
// The window still starts null and resolves once the pantry's zone arrives on the
// sign-in (A120), rather than freezing whatever the machine's clock said first.
//
// The panel is reached at `/admin?tab=metrics`, on a route declared
// `requires: { tier: 'ADMIN' }` in `app/routes.ts` — a hierarchical comparison
// (I1), and the shell hides the nav entry from anyone below it. Both routes it
// calls declare ADMIN again; the client check is communication, never the rule
// (`architecture.md §4.5`).
//
// Everything on this screen is a READ. S3.2: "Primary action: none destructive;
// this is read + export." The one primary button per panel is its download, and
// there is nothing here to edit, cancel or confirm.

import { useState } from 'react';
import { todayInZone, useSession } from '../../../../app/index.ts';
import { Button, Segmented, tabPanelProps } from '../../../../components/index.ts';
import { CoverageTab } from './CoverageTab.tsx';
import { IntakeTab } from './IntakeTab.tsx';
import {
  canGoLater,
  COPY,
  defaultPeriod,
  isThisWeek,
  isValidPeriod,
  periodError,
  periodRangeLabel,
  stepPeriod,
  TABS,
  type Period,
  type TabId,
} from './metrics.ts';
import './metrics.css';

const ID_PREFIX = 's32';

export function MetricsPanel() {
  const { timezone } = useSession();
  const [tab, setTab] = useState<TabId>('intake');

  // Today at the PANTRY, not on this machine (A120). A run's date is a pantry-local
  // fact, so a desktop in another zone must not shift the window near midnight.
  const today = todayInZone(timezone);

  /** Null until an admin touches a field, so the window follows the pantry's own
   *  day as it arrives rather than freezing the first answer the clock gave. */
  const [chosen, setChosen] = useState<Period | null>(null);
  const period = chosen ?? defaultPeriod(today);
  const dateError = periodError(period);

  return (
    <div className="s32">
      {/* Matches the tab that leads here ("Metrics", `logic.ts` PANELS), so the
          heading confirms where the click landed rather than renaming the place.
          An `<h2>`, not an `<h1>`: S1.8's own title is the page heading now. */}
      <h2 className="s32-title">{COPY.title}</h2>

      {/* Two date fields (D39). §1.5 rules out a dropdown where a visible control
          fits, and a range is what two date fields are. "This week" is offered
          only when it would change something. */}
      <section className="s32-period" aria-label={COPY.period.heading}>
        <div className="s32-period__group">
          <DateField
            label={COPY.period.from}
            value={period.from}
            onChange={(from) => setChosen({ ...period, from })}
          />
          <DateField
            label={COPY.period.to}
            value={period.to}
            onChange={(to) => setChosen({ ...period, to })}
          />
          {isThisWeek(period, today) ? null : (
            <Button onClick={() => setChosen(null)}>{COPY.period.thisWeek}</Button>
          )}
        </div>

        <div className="s32-period__nav">
          {/* Both step by the window's OWN length, so consecutive views are
              adjacent and non-overlapping — which is the window `previousIntake`
              is measured against, one screen up. */}
          <Button
            onClick={() => setChosen(stepPeriod(period, -1))}
            aria-label={COPY.period.earlierAria}
            disabled={!isValidPeriod(period)}
          >
            {COPY.period.earlier}
          </Button>
          {/* Hidden rather than disabled (§3 prefers hiding): dates after today
              hold no data, so there is nothing behind the button to explain. */}
          {canGoLater(period, today) ? (
            <Button
              onClick={() => setChosen(stepPeriod(period, 1))}
              aria-label={COPY.period.laterAria}
              disabled={!isValidPeriod(period)}
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

        {dateError !== null ? (
          <p className="s32-period__error" role="alert">
            {dateError}
          </p>
        ) : null}
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
            contract — and it also means only one of the two reads is in flight.
            A half-typed range is not sent: a backwards window would come back
            empty and read as "nothing happened" rather than as a typo. */}
        {!isValidPeriod(period) ? null : (
          <>
            {tab === 'intake' ? <IntakeTab period={period} /> : null}
            {tab === 'coverage' ? <CoverageTab period={period} /> : null}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * A `YYYY-MM-DD` field.
 *
 * `components/TextInput` takes `text` or `password` only and `components/` is not
 * this screen's to widen, so the native date control is spelled out here rather
 * than by loosening a contract every screen depends on. It is one `<input>` and a
 * label, which is what `TextInput` is; nothing outside this folder imports it.
 */
function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="r3-field s32-period__field">
      <span className="r3-field__label">{label}</span>
      <input
        className="r3-field__control"
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
