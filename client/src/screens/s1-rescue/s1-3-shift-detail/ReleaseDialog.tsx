// Release — the owner's one action here (PRD cap 8, S1.3).
//
// Two shapes, because S1.3 gives two:
//
//   a one-off run   — a destructive confirm naming the consequence, which is §3's
//                     own worked example: "Release this run? It goes back to the
//                     board for others."
//   a repeating run — "Release just this one, or this and future?", with a
//                     date-range option for the bulk case.
//
// What this is NOT, and the distinction S1.3 draws itself: staff's bulk-terminate.
// That ends part of a series permanently (`CANCELLED`, terminal) and is not a
// driver capability. Everything here returns runs to the board as Open, and the
// series keeps generating past whatever was released (I23).
//
// The range is chosen from the days that actually exist rather than typed into a
// date field: §1.5 rules out fragile pickers and §1.4 asks for recognition. If that
// list cannot be read the dialog still works — the open-ended "every future run" is
// the default and needs no dates at all.

import { useEffect, useState } from 'react';
import { Button, ConfirmModal, Modal, Segmented } from '../../../components/index.ts';
import type { ReleaseRequest, ShiftSummary } from '../../../api/shared.ts';
import { fetchSeriesRuns } from './api.ts';
import {
  COPY,
  RANGE_OPEN_ENDED,
  RELEASE_CHOICES,
  releaseConfirmLabel,
  releaseRangeOptions,
} from './detail.ts';
import type { ReleaseChoice } from './detail.ts';

export interface ReleaseDialogProps {
  shift: ShiftSummary;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (request: ReleaseRequest) => void;
}

const SCOPE_LABELS: Record<ReleaseChoice, string> = {
  ONE: COPY.releaseScopeOne,
  FUTURE: COPY.releaseScopeFuture,
};

const SCOPE_OPTIONS = RELEASE_CHOICES.map((value) => ({ value, label: SCOPE_LABELS[value] }));

export function ReleaseDialog({ shift, busy, onCancel, onConfirm }: ReleaseDialogProps) {
  const [choice, setChoice] = useState<ReleaseChoice>('ONE');
  const [through, setThrough] = useState<string>(RANGE_OPEN_ENDED);
  const [seriesRuns, setSeriesRuns] = useState<readonly ShiftSummary[]>([]);

  const patternId = shift.recurrencePatternId;

  useEffect(() => {
    if (patternId === null) return;
    const controller = new AbortController();
    fetchSeriesRuns(patternId, shift.occurrenceDate, controller.signal)
      .then((runs) => {
        if (!controller.signal.aborted) setSeriesRuns(runs);
      })
      .catch(() => {
        // Quietly: the open-ended choice is the default and needs no dates. An
        // error block inside a confirm would be noise in front of a decision.
      });
    return () => controller.abort();
  }, [patternId, shift.occurrenceDate]);

  // A one-off run has no scope question to ask (§5.3's `release-range` is defined
  // over a pattern, and the server refuses a range on a run that does not repeat).
  if (patternId === null) {
    return (
      <ConfirmModal
        question={COPY.releaseQuestion}
        consequence={COPY.releaseConsequence}
        confirmLabel={COPY.releaseConfirmOne}
        busy={busy}
        onCancel={onCancel}
        onConfirm={() => onConfirm({ scope: 'ONE' })}
      />
    );
  }

  const rangeOptions = releaseRangeOptions(shift, seriesRuns);

  const request: ReleaseRequest =
    choice === 'ONE'
      ? { scope: 'ONE' }
      : {
          scope: 'RANGE',
          // No `toDate` at all is the open-ended half of "this and future"; the
          // server defaults `fromDate` to this run's own day.
          ...(through === RANGE_OPEN_ENDED ? {} : { toDate: through }),
        };

  return (
    <Modal
      question={COPY.releaseScopeQuestion}
      onCancel={onCancel}
      actions={
        <Button variant="danger" loading={busy} onClick={() => onConfirm(request)}>
          {releaseConfirmLabel(choice)}
        </Button>
      }
    >
      <div className="s13-release">
        <Segmented
          label={COPY.releaseScopeLabel}
          options={SCOPE_OPTIONS}
          value={choice}
          onChange={setChoice}
        />

        {choice === 'FUTURE' && rangeOptions.length > 1 ? (
          <div className="s13-release__range">
            <p className="s13-label">{COPY.releaseRangeLabel}</p>
            <Segmented
              label={COPY.releaseRangeLabel}
              options={rangeOptions}
              value={through}
              onChange={setThrough}
            />
          </div>
        ) : null}

        <p className="s13-release__consequence">
          {choice === 'ONE' ? COPY.releaseConsequence : COPY.releaseFutureConsequence}
        </p>
      </div>
    </Modal>
  );
}
