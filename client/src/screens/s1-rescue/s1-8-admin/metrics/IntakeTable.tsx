// The per-store table. S3.2's layout line was "per-store table (total rescued,
// reported, unreported, trend) + totals"; D58 cuts it to THREE columns.
//
// A real `<table>`, because this is tabular data with a header row that names each
// column for every cell under it — the one place in R3 where a list of big rows
// (§3) would lose meaning rather than gain it.
//
// WHY THE OTHER TWO COLUMNS WENT (D58). "Not reported" was `intake − reported`,
// which an admin reads straight off the two columns beside it — the same argument
// D34 made when S3.1 dropped its third total. "Change" compared against a period
// nobody asked for and cost a second query to compute; a percentage against an
// arbitrary previous window is a number to interpret, not a number to act on.
//
// WHAT DID NOT CHANGE is the thing PRD §3 calls the key data boundary: total
// rescued and the part that goes to the food bank are still two columns with two
// headings and two explainers, and the totals row still keeps them apart.

import type { IntakeMetrics } from '../../../../api/shared.ts';
import { COPY, storeKey, storesByIntake, weightWithUnit } from './metrics.ts';

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
          </tr>
        </thead>

        <tbody>
          {rows.map((store) => (
            <tr key={storeKey(store)}>
              <th scope="row">{store.donorName}</th>
              {/* Every figure below is the string the server sent, formatted —
                  never a sum worked out here (A165). */}
              <td className="s32-num">{weightWithUnit(store.intake)}</td>
              <td className="s32-num">{weightWithUnit(store.reported)}</td>
            </tr>
          ))}
        </tbody>

        <tfoot>
          <tr className="s32-total">
            <th scope="row">{COPY.intake.totalsRow}</th>
            <td className="s32-num">{weightWithUnit(metrics.totalIntake)}</td>
            <td className="s32-num">{weightWithUnit(metrics.totalReported)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
