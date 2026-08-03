// The run after the driver completed it — read only, and nothing tappable (D23).
//
// This is what "Complete this run" leaves behind, and what a driver sees if they
// re-open the run from My Shifts afterwards. Stops, dispositions, each stop's
// note, and the whole-run note now locked.
//
// NOTHING HERE CHANGES THE RUN, on purpose. That includes the one a driver is most
// likely to want: "Flag a stop not on my route" is gone with the rest, so the
// summary says so in `COPY.summaryNoFlag` and names the way out. A vanished
// button that nobody explains is a driver hunting for it in a car park.
//
// The single exception is the way OFF this screen. `fullScreen: true` means no nav
// and no top bar, so without it a driver re-opening a finished run is left with the
// browser's Back button. "Read only" is a statement about the data, not a reason to
// trap someone.
//
// The shift underneath is still `IN_PROGRESS` and this screen must never suggest
// otherwise: `I11` (locked) makes the receiver's receive-done the only completion
// and `I12` holds `COMPLETED` behind every stop being WEIGHED. What is finished
// is the driving.

import { HOME_PATH, useRouter, useSession } from '../../../app/index.ts';
import type { RunDetail } from '../../../api/shared.ts';
import { Button } from '../../../components/index.ts';
import { StopStatusChip } from './StopStatusChip.tsx';
import { COPY, headingBackState, reviewLines } from './logic.ts';

export interface RunSummaryProps {
  run: RunDetail;
}

export function RunSummary({ run }: RunSummaryProps) {
  // The PANTRY's clock, not the device's (A120).
  const { timezone } = useSession();
  const { navigate } = useRouter();
  const { confirmedAt } = headingBackState(run, timezone ?? undefined);

  return (
    <>
      <header className="r3-pickup__head">
        <h1>{run.routeName}</h1>
        <p className="r3-pickup__meta">
          {run.truckName ? `${COPY.truckLabel}: ${run.truckName}` : null}
        </p>
      </header>

      {/* The time is the whole message (D21): the driver can see they are done,
          and only the clock reading tells them anything more. */}
      <p className="r3-pickup__completed">
        <strong>{COPY.completedTitle}</strong>
        {confirmedAt ? ` · ${confirmedAt}` : null}
      </p>

      <ul className="r3-review" aria-label={COPY.stopsLabel}>
        {reviewLines(run.stops).map((line) => (
          <li key={line.id} className="r3-review__line">
            <span className="r3-review__name">{line.name}</span>
            <StopStatusChip disposition={line.disposition} />
            {line.note ? <span className="r3-review__note">{line.note}</span> : null}
          </li>
        ))}
      </ul>

      <section className="r3-pickup__locked-note" aria-label={COPY.completedNoteLabel}>
        <p className="r3-pickup__label">{COPY.completedNoteLabel}</p>
        <p>{run.note ?? COPY.completedNoNote}</p>
      </section>

      <p className="r3-pickup__hint">{COPY.summaryNoFlag}</p>

      {/* The one control on the page, and it changes nothing about the run.
          S1.5 is `fullScreen: true`, so there is no nav and no top bar here: a
          driver who re-opens a finished run from My Shifts would otherwise have
          the browser's Back button and nothing else. A read-only screen still
          needs a door. */}
      <div className="r3-pickup__primary">
        <Button variant="secondary" block onClick={() => navigate(HOME_PATH)}>
          {COPY.summaryLeave}
        </Button>
      </div>
    </>
  );
}
