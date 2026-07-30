// Reassign one stop to another driver — staff-only (PRD cap 10, I30, S1.3).
//
// "Picking it opens a driver picker (any driver with an open or in-progress shift
// today); confirming marks that stop REASSIGNED on this shift ... and adds it as a
// new pending stop at the end of the destination driver's active shift."
//
// Pick-then-confirm, not one tap per driver: `REASSIGNED` is terminal (§3.2) and the
// stop cannot be moved back, so a single mis-tap would be unrecoverable — the same
// reason S1.5 makes starting a run two steps.
//
// The list is every driver out today, including one whose run has not started, with
// the reason it cannot receive the stop. The server refuses a destination that is
// not `IN_PROGRESS` (I5: a run has no stop list before it starts), and repeating
// that here is communication, not the rule.

import { useCallback, useState } from 'react';
import { useAsyncData, useSession } from '../../../app/index.ts';
import {
  Button,
  EmptyState,
  ErrorBlock,
  List,
  ListItem,
  ListRow,
  Modal,
  SkeletonRows,
} from '../../../components/index.ts';
import type { ShiftSummary } from '../../../api/shared.ts';
import { fetchShiftsOn } from './api.ts';
import { COPY, reassignCandidates, todayCalendarDate } from './detail.ts';
import type { ReassignCandidate, StopLine } from './detail.ts';

export interface ReassignDialogProps {
  line: StopLine;
  currentShiftId: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (candidate: ReassignCandidate) => void;
}

export function ReassignDialog({
  line,
  currentShiftId,
  busy,
  onCancel,
  onConfirm,
}: ReassignDialogProps) {
  const { timezone } = useSession();
  const [picked, setPicked] = useState<ReassignCandidate | null>(null);

  // Today's runs. The device's date only bounds what is fetched; every candidate is
  // checked again by the server, which is where the rule lives.
  const today = todayCalendarDate();
  const load = useCallback((signal: AbortSignal) => fetchShiftsOn(today, signal), [today]);
  const state = useAsyncData<ShiftSummary[]>(load);

  const candidates = reassignCandidates(
    state.data ?? [],
    currentShiftId,
    timezone ?? undefined,
  );

  return (
    <Modal
      question={COPY.reassignQuestion(line.donorName)}
      onCancel={onCancel}
      actions={
        <Button
          variant="danger"
          loading={busy}
          // Visible but disabled: §3 prefers hiding to disabling, except where the
          // control has to stay on screen for the dialog to make sense.
          disabled={picked === null}
          onClick={() => {
            if (picked) onConfirm(picked);
          }}
        >
          {COPY.reassignConfirm}
        </Button>
      }
    >
      <div className="s13-reassign">
        <p>{COPY.reassignIntro}</p>

        <Body
          candidates={candidates}
          showLoading={state.showLoading}
          error={state.error}
          onRetry={state.reload}
          picked={picked}
          onPick={setPicked}
        />

        {picked ? (
          <p className="s13-reassign__consequence">{COPY.reassignConsequence}</p>
        ) : (
          <p className="s13-label">{COPY.reassignPick}</p>
        )}
      </div>
    </Modal>
  );
}

interface BodyProps {
  candidates: ReassignCandidate[];
  showLoading: boolean;
  error: unknown;
  onRetry: () => void;
  picked: ReassignCandidate | null;
  onPick: (candidate: ReassignCandidate) => void;
}

/** §3: "every list defines all three" — loading, empty, error. */
function Body({ candidates, showLoading, error, onRetry, picked, onPick }: BodyProps) {
  if (showLoading && candidates.length === 0) {
    return <SkeletonRows rows={3} label={COPY.driversLabel} />;
  }
  if (error) return <ErrorBlock error={error} onRetry={onRetry} />;
  if (candidates.length === 0) {
    return <EmptyState title={COPY.reassignEmpty}>{COPY.reassignEmptyBody}</EmptyState>;
  }

  return (
    <List label={COPY.driversLabel}>
      {candidates.map((candidate) => (
        <ListItem key={candidate.shiftId}>
          <div
            className={
              picked?.shiftId === candidate.shiftId ? 's13-pick s13-pick--on' : 's13-pick'
            }
          >
            <ListRow
              title={candidate.driverName}
              subtitle={`${candidate.routeName} · ${candidate.when}`}
              {...(candidate.reason ? { meta: candidate.reason } : {})}
              {...(candidate.selectable ? { onClick: () => onPick(candidate) } : {})}
            />
          </div>
        </ListItem>
      ))}
    </List>
  );
}
