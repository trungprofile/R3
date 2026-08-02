// The per-store table. S3.2's layout line: "per-store table (total rescued,
// reported, unreported, trend) + totals".
//
// A real `<table>`, because this is tabular data with a header row that names each
// column for every cell under it — the one place in R3 where a list of big rows
// (§3) would lose meaning rather than gain it. It is also the only screen whose
// canonical device is a desktop with room for five columns.
//
// THREE COLUMNS, NOT ONE AND A HINT. Total rescued, to the food bank, and not
// reported each get their own heading and their own one-line explainer, because
// PRD §3's key data boundary is only kept by naming both sides of it every time.
// `unreported` arrives stated rather than derived here for the same reason.
//
// The trend cell carries no colour. A store that gave less this month is
// information, not an error, and §2 keeps --danger for destructive things; a red
// number here would tell an admin how to feel about a figure they are being shown
// to think about. A store with no earlier figure is muted and says so in words —
// null is not zero (`shared/src/metrics.ts`).

import type { IntakeMetrics } from '../../../../api/shared.ts';
import { COPY, storeKey, storesByIntake, trendFor, weightWithUnit } from './metrics.ts';

export interface IntakeTableProps {
  metrics: IntakeMetrics;
}

export function IntakeTable({ metrics }: IntakeTableProps) {
  const rows = storesByIntake(metrics.stores);

  return (
    <div className="s32-table-wrap">
      <table className="s32-table">
        <thead>
          <tr>
            <th scope="col">{COPY.intake.colStore}</th>
            <th scope="col" className="s32-num">
              {COPY.intake.colIntake}
              <span className="s32-th__hint">{COPY.intake.intakeMeans}</span>
            </th>
            <th scope="col" className="s32-num">
              {COPY.intake.colReported}
              <span className="s32-th__hint">{COPY.intake.reportedMeans}</span>
            </th>
            <th scope="col" className="s32-num">
              {COPY.intake.colUnreported}
              <span className="s32-th__hint">{COPY.intake.unreportedMeans}</span>
            </th>
            <th scope="col">
              {COPY.intake.colTrend}
              <span className="s32-th__hint">{COPY.intake.trendMeans}</span>
            </th>
          </tr>
        </thead>

        <tbody>
          {rows.map((store) => {
            const trend = trendFor(store.intake, store.previousIntake);
            return (
              <tr key={storeKey(store)}>
                <th scope="row">{store.donorName}</th>
                {/* Every figure below is the string the server sent, formatted —
                    never a sum worked out here (A165). */}
                <td className="s32-num">{weightWithUnit(store.intake)}</td>
                <td className="s32-num">{weightWithUnit(store.reported)}</td>
                <td className="s32-num">{weightWithUnit(store.unreported)}</td>
                <td className={trend.direction === 'NO_HISTORY' ? 's32-trend--none' : undefined}>
                  {trend.label}
                </td>
              </tr>
            );
          })}
        </tbody>

        <tfoot>
          <tr className="s32-total">
            <th scope="row">{COPY.intake.totalsRow}</th>
            <td className="s32-num">{weightWithUnit(metrics.totalIntake)}</td>
            <td className="s32-num">{weightWithUnit(metrics.totalReported)}</td>
            <td className="s32-num">{weightWithUnit(metrics.totalUnreported)}</td>
            {/* No total trend: adding up percentages of different stores would
                produce a figure that is arithmetically valid and means nothing. */}
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
