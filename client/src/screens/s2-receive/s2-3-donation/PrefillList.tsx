// The driver's prefills — `SUGGESTED` rows waiting for weights (I17).
//
// FIRST ON THE SCREEN, above the blank form, because they are the reason someone
// is standing here: a driver flagged food mid-run (S1.5) and the receiver is the
// one who can weigh it. A blank form at the top would ask them to re-enter what
// is already recorded.
//
// The driver's donor and category are a PREFILL, not a commitment (D8) — tapping
// a row loads it into the form where either can be corrected, which is what makes
// the driver's pick useful rather than binding.
//
// Discard is offered because a flag is not intake: a prefill nobody weighed is
// deleted at receive-done anyway (I17), and letting the receiver say "no food
// came" now is the same decision made on time. It is a confirm, and the confirm
// names the consequence (§6).

import { Button, List, ListItem, ListRow } from '../../../components/index.ts';
import type { DonationSummary } from '../../../api/shared.ts';
import { COPY, describeRow } from './donation.ts';

export interface PrefillListProps {
  rows: readonly DonationSummary[];
  /** The one currently loaded into the form, if any. */
  activeId: string | null;
  onPick: (row: DonationSummary) => void;
  onDiscard: (row: DonationSummary) => void;
  busy: boolean;
}

export function PrefillList({ rows, activeId, onPick, onDiscard, busy }: PrefillListProps) {
  if (rows.length === 0) return null;

  return (
    <section className="s23-prefills" aria-label={COPY.pendingLabel}>
      <h2 className="s23-heading">{COPY.pendingHeading}</h2>
      <p className="s23-hint">{COPY.pendingHint}</p>
      <List label={COPY.pendingLabel}>
        {rows.map((row) => (
          <ListItem key={row.id}>
            <div className={row.id === activeId ? 's23-prefill is-active' : 's23-prefill'}>
              <ListRow
                title={row.donorDisplay}
                subtitle={describeRow(row)}
                {...(row.note ? { meta: row.note } : {})}
                onClick={() => onPick(row)}
                ariaLabel={`${row.donorDisplay} — ${describeRow(row)}`}
              />
              <Button variant="secondary" disabled={busy} onClick={() => onDiscard(row)}>
                {COPY.discard}
              </Button>
            </div>
          </ListItem>
        ))}
      </List>
    </section>
  );
}
