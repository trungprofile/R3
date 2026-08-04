// The unscheduled donations, on the receiver's landing screen (`D76`).
//
// WHY THIS IS HERE AND NOT ON S2.3. `D67` put a summary CARD on the picker and left
// the rows on S2.3, on the reading that rows belong where they are worked. That was
// backwards for one of the two lists. When a driver flags a store mid-run (I17) the
// food is already in the building and the receiver has to weigh it — it is a pickup
// in every sense except that no route planned it. S2.1b is the receiver's list of
// pickups. A suggestion that appeared there only as "1 waiting for weights", behind
// a tap, was the single kind of arrival the picker did not list.
//
// TWO LISTS, NEVER ONE. Suggested is somebody else's unfinished work; recorded is
// finished work. Run together they read as one undifferentiated pile and neither is
// legible, which is what QA found. They are separate sections with separate
// headings, and the suggested one is FIRST because it is the only one with work in
// it.
//
// The walk-in button lives here for the same reason S2.3 no longer holds it: starting
// a donation from nothing is a different act from weighing one that arrived, and a
// screen offering both was asking the receiver to pick a mode before it knew what
// they had in their hands.
//
// WHAT THIS COMPONENT DECIDES: nothing. Membership of both lists is the server's
// (`D77`'s window bound, the pantry-day bound on recorded), and every flag it draws
// is re-checked on the request that changes it.

import { Button, List, ListItem, ListRow } from '../../../components/index.ts';
import { DONATION_WINDOW_CLOSED_MESSAGE } from '../../../api/shared.ts';
import { COPY } from './run-picker.ts';
import type { DonationPanelView } from './run-picker.ts';

export interface DonationPanelProps {
  view: DonationPanelView;
  busy: boolean;
  onWeigh: (id: string) => void;
  onAddWalkIn: () => void;
  onToggleReport: (id: string) => void;
}

export function DonationPanel({
  view,
  busy,
  onWeigh,
  onAddWalkIn,
  onToggleReport,
}: DonationPanelProps) {
  return (
    <section className="s21b__donations" aria-label={COPY.donationLabel}>
      <header className="s21b-don__head">
        <h2 className="s21b-don__title">{view.title}</h2>
        <p className="s21b-don__summary">{view.summary}</p>
        {/* `secondary`: §1 allows one high-emphasis action per screen and it belongs
            to picking a run, which is the question the screen asks. This is the way
            in for the one arrival no run accounts for. */}
        <Button variant="secondary" disabled={busy} onClick={onAddWalkIn}>
          {view.addLabel}
        </Button>
      </header>

      {/* Absent, not empty, when nothing is waiting. An empty "Waiting for weights"
          heading is a claim that this is a place work usually is — and on most days
          it is not. The recorded list below states its own emptiness because a
          receiver checking whether they logged something needs an answer either
          way. */}
      {view.suggested.length > 0 ? (
        <div className="s21b-don__group">
          <h3 className="s21b-don__heading">{view.suggestedHeading}</h3>
          <p className="s21b-don__hint">{COPY.suggestedHint}</p>
          <List label={COPY.suggestedHeading}>
            {view.suggested.map((row) => (
              <ListItem key={row.id}>
                <ListRow
                  title={row.donor}
                  subtitle={row.detail}
                  {...(row.attribution
                    ? { meta: <span className="s21b-don__note">{row.attribution}</span> }
                    : {})}
                  side={<span className="s21b-side__go">{COPY.weighGo}</span>}
                  ariaLabel={row.ariaLabel}
                  onClick={() => onWeigh(row.id)}
                />
              </ListItem>
            ))}
          </List>
        </div>
      ) : null}

      <div className="s21b-don__group">
        <h3 className="s21b-don__heading">{COPY.recordedHeading}</h3>
        {view.recorded.length === 0 ? (
          <p className="s21b-don__hint">{COPY.recordedNone}</p>
        ) : (
          <List label={COPY.recordedHeading}>
            {view.recorded.map((row) => (
              <ListItem key={row.id}>
                <div className="s21b-don__row">
                  <ListRow
                    title={row.donor}
                    subtitle={row.detail}
                    side={
                      <span
                        className={
                          row.reported
                            ? 's21b-don__chip s21b-don__chip--reported'
                            : 's21b-don__chip s21b-don__chip--ours'
                        }
                      >
                        {row.chip}
                      </span>
                    }
                    ariaLabel={`${row.donor}, ${row.detail}`}
                  />
                  {/* The report flag is a plain field edit, last write wins (PRD cap
                      15) — not the void-and-reinsert a weight takes. The WEIGHT is
                      deliberately not editable from this list: correcting a number
                      is the ✎ on S2.2's sheet, or the Reporter's job on S3.1 once
                      the window shuts (build-plan D9). Two places to change one
                      number is how the two get out of step. */}
                  {row.toggleLabel ? (
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => onToggleReport(row.id)}
                    >
                      {row.toggleLabel}
                    </Button>
                  ) : (
                    <p className="s21b-don__closed">{DONATION_WINDOW_CLOSED_MESSAGE}</p>
                  )}
                </div>
              </ListItem>
            ))}
          </List>
        )}
      </div>
    </section>
  );
}
