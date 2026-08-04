// Status chip — `ui-ux-spec.md §3`.
//
// One chip per row, reflecting `Shift.status`. The colour vocabulary is fixed:
// Open (orange), Claimed (muted), In progress (orange filled), Done (muted),
// At-risk (warning), Cancelled (muted strike).
//
// `mine` is an OWNERSHIP OVERLAY, not a status: it renders in success colour and
// replaces the Claimed chip when the viewer is the owner. Every other status
// keeps its own chip regardless of who owns the shift (§3, stated explicitly).
//
// MISSED / at-risk is derived at read time and never stored (I7), so it arrives
// as a flag beside the status rather than as a status value.
//
// "Returning" (D48) is the same kind of thing and for the same reason: there is no
// `RETURNING` status and there must not be one. Heading back is a MILESTONE INSIDE
// `IN_PROGRESS` — `Shift.pickup_completed_at`, I27 — and `services/execution.ts`
// deliberately leaves `status` alone when it sets it. So the milestone arrives here
// as the timestamp it is, and the chip reads it. Nothing about the state machine
// moved; this is the word on a chip.

import type { ShiftStatus } from '../api/shared.ts';

export interface StatusChipProps {
  status: ShiftStatus;
  /** The viewer owns this shift. Only changes the CLAIMED chip. */
  mine?: boolean;
  /** Derived, staff view: unclaimed and close to its start (I7). */
  atRisk?: boolean;
  /** I27's handoff milestone, straight off `ShiftSummary`. Set does NOT mean
   *  completed — the run is still `IN_PROGRESS` and only the receiver's
   *  receive-done closes it (I11). It only changes the IN_PROGRESS chip. */
  pickupCompletedAt?: string | null;
}

export interface ChipLook {
  label: string;
  modifier: string;
}

/**
 * The chip's word and colour, as a pure function so it can be tested — there is no
 * jsdom and no component renderer in this repo (build-plan §3/D5), so a rule that
 * only exists inside a component body is a rule no test can reach.
 *
 * Order matters: the ownership overlay wins over CLAIMED, at-risk over OPEN, and
 * the handoff milestone over IN_PROGRESS. None of the three overlaps another.
 */
export function statusChipLook({
  status,
  mine = false,
  atRisk = false,
  pickupCompletedAt = null,
}: StatusChipProps): ChipLook {
  // Ownership overlay first, and only over CLAIMED.
  if (status === 'CLAIMED' && mine) return { label: 'Mine', modifier: 'mine' };
  if (atRisk && status === 'OPEN') return { label: 'At risk', modifier: 'at-risk' };
  // D48. Same modifier as In progress on purpose: the run IS still in progress, so
  // a second colour would claim a state change that I27 explicitly does not make.
  if (status === 'IN_PROGRESS' && pickupCompletedAt !== null) {
    return { label: 'Returning', modifier: 'in-progress' };
  }

  switch (status) {
    case 'OPEN':
      return { label: 'Open', modifier: 'open' };
    case 'CLAIMED':
      return { label: 'Claimed', modifier: 'muted' };
    case 'IN_PROGRESS':
      return { label: 'In progress', modifier: 'in-progress' };
    case 'COMPLETED':
      // Unreachable in Phase 1 — the receiver's receive-done is the only
      // completion action and ships in Phase 2 (I11, build-plan D1). Built and
      // styled, left unexercised.
      return { label: 'Done', modifier: 'muted' };
    case 'CANCELLED':
      return { label: 'Cancelled', modifier: 'cancelled' };
  }
}

export function StatusChip(props: StatusChipProps) {
  const { label, modifier } = statusChipLook(props);
  return <span className={`r3-chip r3-chip--${modifier}`}>{label}</span>;
}

/** Alerts on/off, §5. Always visible in the inbox header; the top bar carries it
 *  too (§3). Presentational — tapping re-walks the permission flow, which the
 *  caller owns. The app is fully usable with alerts off and the copy must never
 *  imply otherwise. */
export function PushStateChip({ enabled, onFix }: { enabled: boolean; onFix?: () => void }) {
  if (enabled) return <span className="r3-chip r3-chip--alerts-on">Alerts ON</span>;
  return (
    <button type="button" className="r3-chip r3-chip--alerts-off" onClick={onFix}>
      Alerts OFF, tap to fix
    </button>
  );
}
