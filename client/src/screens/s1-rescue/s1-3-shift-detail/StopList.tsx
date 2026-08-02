// The stops, in order — S1.3's "route stops in order".
//
// Read-only on this screen for everyone. Checking a stop off, skipping it and
// reordering are the driver's, on S1.5; the one write S1.3 puts on a stop is
// staff's Reassign (I30), and only on a run that has started.
//
// A `REASSIGNED` stop stays on the list, struck through, rather than vanishing —
// the same choice S1.5 made, so staff and driver are reading the same list.

import { Button, List, ListItem, ListRow } from '../../../components/index.ts';
import { COPY } from './detail.ts';
import type { StopLine, StopListView } from './detail.ts';

export interface StopListProps {
  view: StopListView;
  onReassign: (line: StopLine) => void;
}

export function StopList({ view, onReassign }: StopListProps) {
  return (
    <List label={COPY.stopsLabel}>
      {view.lines.map((line) => (
        <ListItem key={line.key}>
          <Stop line={line} onReassign={onReassign} />
        </ListItem>
      ))}
    </List>
  );
}

function Stop({ line, onReassign }: { line: StopLine; onReassign: (line: StopLine) => void }) {
  const classes = ['s13-stop'];
  if (line.moved) classes.push('s13-stop--moved');

  return (
    <div className={classes.join(' ')}>
      <ListRow
        title={
          <>
            <span className="s13-stop__number" aria-hidden="true">
              {line.number}
            </span>
            <span className="s13-stop__name">{line.donorName}</span>
          </>
        }
        // Donor address is operational data staff and drivers need to work a run,
        // never PII — `pii.ts` gates people, not places (`CLAUDE.md`).
        {...(line.donorAddress ? { subtitle: line.donorAddress } : {})}
        {...(line.statusLabel ? { side: <span className="s13-stop__status">{line.statusLabel}</span> } : {})}
      />

      {line.donorNote ? (
        <p className="s13-stop__aside">
          <span className="s13-label">{COPY.storeNoteLabel}</span> {line.donorNote}
        </p>
      ) : null}

      {line.note ? (
        <p className="s13-stop__aside">
          <span className="s13-label">{COPY.stopNoteLabel}</span> {line.note}
        </p>
      ) : null}

      {/* A moved stop said "Moved to another driver" once already, in the row's own
          status slot; it did not need saying twice under it (D21). */}
      {line.canReassign ? (
        <div className="s13-actions">
          <Button
            variant="secondary"
            onClick={() => onReassign(line)}
            aria-label={COPY.reassignAria(line.donorName)}
          >
            {COPY.reassign}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
