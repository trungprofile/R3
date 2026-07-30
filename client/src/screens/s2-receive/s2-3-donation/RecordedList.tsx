// What has already been recorded — the confirmed rows the worklist carries back
// so a correction is reachable without hunting for it (A166's 7-day window).
//
// It has one action, and it is the one boundary this screen exists to make
// visible: the report flag. Flipping it is a plain field edit, last write wins
// (PRD cap 15) — NOT the void-and-reinsert path a weight takes, because the flag
// carries no weight and has no prior value worth keeping as a row.
//
// A weight is deliberately NOT editable here. S2.3 records; correcting a number
// after the fact is the ✎ overwrite on S2.2's sheet or, once the receiver's edit
// window has closed, a reporting job on S3.1 (build-plan D9). Two places to
// change one number is how the two get out of step.

import { Button, List, ListItem, ListRow } from '../../../components/index.ts';
import { DONATION_WINDOW_CLOSED_MESSAGE } from '../../../api/shared.ts';
import type { DonationSummary } from '../../../api/shared.ts';
import { COPY, canEdit, describeRow } from './donation.ts';

export interface RecordedListProps {
  rows: readonly DonationSummary[];
  onToggleReport: (row: DonationSummary) => void;
  busy: boolean;
}

export function RecordedList({ rows, onToggleReport, busy }: RecordedListProps) {
  return (
    <section className="s23-recorded" aria-label={COPY.recordedLabel}>
      <h2 className="s23-heading">{COPY.recordedHeading}</h2>
      {rows.length === 0 ? (
        <p className="s23-hint">
          {COPY.nothingYet} {COPY.nothingYetHint}
        </p>
      ) : (
        <List label={COPY.recordedLabel}>
          {rows.map((row) => (
            <ListItem key={row.id}>
              <div className="s23-recorded__row">
                <ListRow
                  title={row.donorDisplay}
                  subtitle={describeRow(row)}
                  side={
                    <span
                      className={
                        row.reportable ? 's23-chip s23-chip--reported' : 's23-chip s23-chip--ours'
                      }
                    >
                      {row.reportable ? COPY.reportedChip : COPY.notReportedChip}
                    </span>
                  }
                  ariaLabel={`${row.donorDisplay} — ${describeRow(row)}`}
                />
                {canEdit(row) ? (
                  <Button variant="secondary" disabled={busy} onClick={() => onToggleReport(row)}>
                    {row.reportable ? COPY.stopReporting : COPY.startReporting}
                  </Button>
                ) : (
                  // The window has closed. Say who can still fix it rather than
                  // showing a control the server would refuse.
                  <p className="s23-closed">{DONATION_WINDOW_CLOSED_MESSAGE}</p>
                )}
              </div>
            </ListItem>
          ))}
        </List>
      )}
    </section>
  );
}
