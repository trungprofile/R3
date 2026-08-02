// The per-store bars. S3.2: "Simple bar/line, no heavy dashboard."
//
// Hand-rolled CSS widths, no charting dependency — Phase 3 added none, and a
// package for a dozen horizontal bars would be exactly the heavy dashboard the
// spec rules out in the same sentence.
//
// Each bar is SPLIT the way the table's columns are: the part that goes to the
// food bank, and the part that does not. That draws PRD §3's key data boundary
// instead of restating it — a store whose tall bar is mostly grey is giving a lot
// that never reaches the report, which is a pattern nobody reads out of a column
// of numbers at a glance.
//
// The whole chart is `aria-hidden`. It carries no figure the table above does not,
// and a screen reader that has just read five columns per store does not need them
// again as unlabelled percentages. The heading and the note stay audible so the
// chart is never a silent gap.

import type { StoreIntake } from '../../../api/shared.ts';
import { barsFor, COPY } from './metrics.ts';

export interface BarsProps {
  stores: readonly StoreIntake[];
}

export function Bars({ stores }: BarsProps) {
  const bars = barsFor(stores);
  if (bars.length === 0) return null;

  return (
    <section>
      <h3 className="s32-subheading">{COPY.intake.chartHeading}</h3>
      <p className="s32-note">{COPY.intake.chartNote}</p>

      <ul className="s32-legend">
        <li className="s32-legend__item">
          <span className="s32-legend__swatch s32-legend__swatch--reported" aria-hidden="true" />
          {COPY.intake.chartLegendReported}
        </li>
        <li className="s32-legend__item">
          <span className="s32-legend__swatch s32-legend__swatch--unreported" aria-hidden="true" />
          {COPY.intake.chartLegendUnreported}
        </li>
      </ul>

      <div className="s32-bars" aria-hidden="true">
        {bars.map((bar) => (
          <div className="s32-bar" key={bar.key}>
            <span className="s32-bar__name">{bar.donorName}</span>
            <div className="s32-bar__track">
              {/* Two widths and no third: the outer one is this store against the
                  largest in the period, the inner one is the reported share of
                  this store's own bar. */}
              <div className="s32-bar__fill" style={{ width: `${bar.widthPercent}%` }}>
                <div
                  className="s32-bar__reported"
                  style={{ width: `${bar.reportedPercent}%` }}
                />
                <div
                  className="s32-bar__unreported"
                  style={{ width: `${100 - bar.reportedPercent}%` }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
