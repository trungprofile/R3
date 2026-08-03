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
import { COPY, reportLineTitle, rolledUpNames, weightWithUnit, type DateRange } from './report.ts';

export interface ReportTableProps {
  report: WeeklyReport;
  /** The window on the wire (D41). Two dates, not a week anchor. */
  range: DateRange;
  /** At most one AGFP category is open at a time — a second panel would push the
   *  row being checked off screen. */
  openCategoryId: string | null;
  onToggle: (categoryId: string) => void;
  onChanged: () => void;
}

export function ReportTable({
  report,
  range,
  openCategoryId,
  onToggle,
  onChanged,
}: ReportTableProps) {
  return (
    <section className="s31-table" aria-label={COPY.tableLabel}>
      {/* D21 cut the hint that stood here. Every AGFP row below is a real button
          carrying `aria-expanded`, so both a mouse and a screen reader already
          know it opens; a sentence saying "pick one to see the entries" was the
          control describing itself. */}

      {/* Keyed on category AND storage: one food bank category reached under two
          storage requirements is two lines here, because it is two line items on
          the receipt (migration 0013). The id alone stopped being unique when
          storage joined the roll-up. */}
      {report.lines.map((line) => (
        <Card
          key={`${line.ntfbCategoryId}:${line.storage ?? ''}`}
          ariaLabel={
            line.agfpCategories.length === 0
              ? reportLineTitle(line)
              : `${reportLineTitle(line)}, ${rolledUpNames(line)}`
          }
        >
          <div className="s31-line">
            <h3 className="s31-line__name">{reportLineTitle(line)}</h3>
            <span className="r3-numeric s31-line__total">{weightWithUnit(line.total)}</span>
          </div>

          {/* The Trash line (D27). Nothing was ever weighed into it — the AGFP
              `Trash` category is archived precisely so nobody can — so it carries
              no categories of ours and has no drill-in to open. Marked here and on
              the printed receipt in the same words, so the screen and the paper
              tell one story. */}
          {line.computed === true ? (
            <p className="s31-line__computed">{COPY.computedLine}</p>
          ) : null}

          {line.agfpCategories.length === 0 ? null : (
            <>
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
                          range={range}
                          categoryId={agfp.categoryId}
                          categoryName={agfp.categoryName}
                          // What this category REPORTS, which since D27 may be net of
                          // a trash deduction. The panel needs it to show why the
                          // entries under it add up to more.
                          categoryTotal={agfp.total}
                          onChanged={onChanged}
                          onClose={() => onToggle(agfp.categoryId)}
                        />
                      ) : null}
                    </ListItem>
                  );
                })}
              </List>
            </>
          )}
        </Card>
      ))}
    </section>
  );
}
