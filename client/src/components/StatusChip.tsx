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

import type { ShiftStatus } from '@r3/shared';

export interface StatusChipProps {
  status: ShiftStatus;
  /** The viewer owns this shift. Only changes the CLAIMED chip. */
  mine?: boolean;
  /** Derived, staff view: unclaimed and close to its start (I7). */
  atRisk?: boolean;
}

interface ChipLook {
  label: string;
  modifier: string;
}

function look(status: ShiftStatus, mine: boolean, atRisk: boolean): ChipLook {
  // Ownership overlay first, and only over CLAIMED.
  if (status === 'CLAIMED' && mine) return { label: 'Mine', modifier: 'mine' };
  if (atRisk && status === 'OPEN') return { label: 'At risk', modifier: 'at-risk' };

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

export function StatusChip({ status, mine = false, atRisk = false }: StatusChipProps) {
  const { label, modifier } = look(status, mine, atRisk);
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
      Alerts OFF — tap to fix
    </button>
  );
}
