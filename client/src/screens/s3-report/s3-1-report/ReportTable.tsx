// The report itself: one card per North Texas Food Bank category, with the AGFP
// categories rolled into it shown underneath.
//
// The roll-up is visible rather than collapsed because two AGFP categories may
// share one NTFB bucket, and a Reporter checking a number needs to see which ones
// made it up before they open anything (`shared/src/report.ts`, `ReportLine`).
//
// WHY THE DRILL-IN HANGS OFF THE AGFP LINE AND NOT THE NTFB TOTAL. The entries
// route narrows by AGFP category, which is also the only grain at which "which
// entries made this number" is a well-posed question — an NTFB total made of two
// AGFP categories resolves to two lists, not one. So the NTFB total is inspected
// by opening its parts, one click each, and every figure on screen is reachable.

import { Card, List, ListItem } from '../../../components/index.ts';
import type { WeeklyReport } from '../../../api/shared.ts';
import { DrillIn } from './DrillIn.tsx';
import { COPY, reportLineTitle, rolledUpNames, weightWithUnit } from './report.ts';

export interface ReportTableProps {
  report: WeeklyReport;
  /** The week on the wire; null asks the server for the current one. */
  week: string | null;
  /** At most one AGFP category is open at a time — a second panel would push the
   *  row being checked off screen. */
  openCategoryId: string | null;
  onToggle: (categoryId: string) => void;
  onChanged: () => void;
}

export function ReportTable({
  report,
  week,
  openCategoryId,
  onToggle,
  onChanged,
}: ReportTableProps) {
  return (
    <section className="s31-table" aria-label={COPY.tableLabel}>
      <p className="s31-table__hint">{COPY.tableHint}</p>

      {/* Keyed on category AND storage: one food bank category reached under two
          storage requirements is two lines here, because it is two line items on
          the receipt (migration 0013). The id alone stopped being unique when
          storage joined the roll-up. */}
      {report.lines.map((line) => (
        <Card
          key={`${line.ntfbCategoryId}:${line.storage ?? ''}`}
          ariaLabel={`${reportLineTitle(line)} — ${rolledUpNames(line)}`}
        >
          <div className="s31-line">
            <h3 className="s31-line__name">{reportLineTitle(line)}</h3>
            <span className="r3-numeric s31-line__total">{weightWithUnit(line.total)}</span>
          </div>

          <h4 className="s31-line__sub">{COPY.rolledUpLabel}</h4>
          <List label={COPY.rolledUpLabel}>
            {line.agfpCategories.map((agfp) => {
              const open = openCategoryId === agfp.categoryId;
              return (
                <ListItem key={agfp.categoryId}>
                  <button
                    type="button"
                    className="s31-agfp"
                    onClick={() => onToggle(agfp.categoryId)}
                    aria-expanded={open}
                  >
                    <span className="s31-agfp__name">{agfp.categoryName}</span>
                    <span className="r3-numeric s31-agfp__weight">
                      {weightWithUnit(agfp.total)}
                    </span>
                  </button>

                  {open ? (
                    <DrillIn
                      week={week}
                      categoryId={agfp.categoryId}
                      categoryName={agfp.categoryName}
                      onChanged={onChanged}
                      onClose={() => onToggle(agfp.categoryId)}
                    />
                  ) : null}
                </ListItem>
              );
            })}
          </List>
        </Card>
      ))}
    </section>
  );
}
