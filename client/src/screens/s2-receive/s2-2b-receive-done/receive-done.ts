// S2.2b receive done — every decision the screen makes, as a function of plain
// records.
//
// Written this way so it can be tested at all: there is no browser or component
// harness in this repo and adding one would be a dependency no lane may add
// (build-plan §3/D5). The JSX beside this file arranges what is decided here.
//
// EVERYTHING BELOW IS COMMUNICATION ONLY. `services/receive.ts` `receiveDone()`
// enforces I11 and I12 inside a SERIALIZABLE transaction and refuses the same
// thing again when this screen gets it wrong (`CLAUDE.md`). Hiding the button on
// an unready run is a courtesy to a volunteer at a tablet, never the rule.
//
// The one thing this file must not do is invent a total. Every number here
// arrives as a decimal string from `numeric(8,2)` and is printed as text — a
// weight that round-trips through a JS number can pick up a rounding error in
// the column that feeds the NTFB report (A165).

import { toApiError } from '../../../api/index.ts';
import { RECEIVE_RESOLVED_STATES } from '../../../api/shared.ts';
import type {
  ReceiveDoneLine,
  ReceiveDoneSummary,
  ReceiveStopState,
} from '../../../api/shared.ts';

// ---------------------------------------------------------------------------
// Weights
// ---------------------------------------------------------------------------

/**
 * A `numeric(8,2)` decimal string as a person reads it: `"2192.00"` → `"2192"`,
 * `"12.50"` → `"12.5"`, `"12.05"` → `"12.05"`.
 *
 * String surgery, never arithmetic. `Number("1222.35")` is already not 1222.35,
 * and this screen is the last thing a receiver reads before closing a run — the
 * figure on it has to be the figure in the report.
 */
export function formatWeight(value: string): string {
  const trimmed = value.trim();
  const [whole = '0', fraction] = trimmed.split('.');
  if (fraction === undefined) return whole;
  const kept = fraction.replace(/0+$/, '');
  return kept === '' ? whole : `${whole}.${kept}`;
}

/** The same figure with its unit. §7: "Units always shown ('lb')." */
export function weightWithUnit(value: string): string {
  return `${formatWeight(value)} lb`;
}

// ---------------------------------------------------------------------------
// The summary lines
// ---------------------------------------------------------------------------

/** Whether a stop counts as resolved for the completion gate (I12). */
export function isResolved(state: ReceiveStopState): boolean {
  return RECEIVE_RESOLVED_STATES.includes(state);
}

/**
 * What one line says to the right of the store's name.
 *
 * A SKIPPED stop carries `total: null` and prints **"skipped"**, never "0 lb".
 * Those are different facts: nothing came from that store, versus something came
 * and weighed nothing. `data-model.md §3.2` stores no phantom zero row for the
 * first, so the screen must not draw one either.
 */
export function lineStatus(line: ReceiveDoneLine): string {
  switch (line.state) {
    case 'WEIGHED':
      return line.total === null
        ? COPY.stateWeighed
        : `${COPY.stateWeighed}, ${weightWithUnit(line.total)}`;
    case 'SKIPPED':
      return COPY.stateSkipped;
    case 'REASSIGNED':
      return COPY.stateMoved;
    case 'COLLECTED':
      return COPY.stateCollected;
    case 'PENDING':
      return COPY.statePending;
  }
}

/** The stops still holding the run open — what the screen shows instead of the
 *  action when `readyForReceiveDone` is false. */
export function outstandingLines(summary: ReceiveDoneSummary): ReceiveDoneLine[] {
  return summary.lines.filter((line) => !isResolved(line.state));
}

/**
 * Whether to offer **Receive done** at all.
 *
 * Keyed off the server's `readyForReceiveDone` rather than recomputed from the
 * lines: `WEIGHED` is a read-time projection over non-voided weight rows (I12),
 * and re-deriving the gate here would be a second implementation of the one rule
 * this screen exists to respect. A run with no stops passes vacuously, exactly as
 * it does server-side.
 */
export function canFinish(summary: ReceiveDoneSummary): boolean {
  return summary.readyForReceiveDone;
}

/** "Karen's Tue AM run", or just the route when nobody owns it. */
export function runTitle(summary: {
  routeName: string;
  ownerName: string | null;
}): string {
  return summary.ownerName ? `${summary.ownerName}'s ${summary.routeName}` : summary.routeName;
}

/**
 * What the toast says after the run closes.
 *
 * When the driver flagged extra pickups nobody ever weighed, receive-done deletes
 * them in the same transaction (I17) and the receiver is told — a prefill that
 * vanishes silently looks like data loss, and the receiver is the only person who
 * could still have acted on it.
 */
export function doneNotice(purgedSuggestions: number): string {
  if (purgedSuggestions <= 0) return COPY.closedToast;
  if (purgedSuggestions === 1) return `${COPY.closedToast} ${COPY.oneExtraDropped}`;
  return `${COPY.closedToast} ${purgedSuggestions} ${COPY.manyExtrasDropped}`;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** What a failed close says. The server writes its own refusals to §7's rules
 *  (`RECEIVE_INCOMPLETE_MESSAGE`), so when it sent one that is the sentence —
 *  otherwise the plain per-kind message. Never a code (§6). */
export function messageFor(error: unknown): string {
  const apiError = toApiError(error);
  return apiError.detail ?? apiError.message;
}

/** Whether the failure means this screen is out of date. Someone else weighed the
 *  last stop, skipped it, or closed the run from another tablet — all of which
 *  are normal on a shared device, and all of which a re-read fixes. */
export function shouldReloadAfter(error: unknown): boolean {
  const kind = toApiError(error).kind;
  return kind === 'conflict' || kind === 'not-found';
}

// ---------------------------------------------------------------------------
// Copy (§7: plain, short, second person; no jargon)
// ---------------------------------------------------------------------------

/** Forbidden in any UI string (`ui-ux-spec.md §7`). Pinned by a test rather than
 *  by good intentions. */
export const FORBIDDEN_IN_COPY = [
  'pwa',
  'push subscription',
  'session',
  'payload',
  'endpoint',
  'atomic',
  'instance',
] as const;

/**
 * Every sentence on this screen, in one place.
 *
 * Two constraints beyond §7:
 *
 *   - The confirm must name the consequence, not ask "are you sure" (§6). The
 *     sentence itself is `RECEIVE_DONE_CONFIRM` in `shared/src/receive.ts` — it
 *     is not restated here, because a second copy of it would drift.
 *   - Nothing may promise an undo. Receive-done is the one completion action and
 *     it has no reversal (I11); a correction afterwards is the void-and-reweigh
 *     path, which is a different sentence and a different screen.
 */
export const COPY = {
  loading: 'Loading this run',

  // --- the summary --------------------------------------------------------
  ready: 'All stops are done',
  readyHint: 'Check the weights below, then finish the run.',
  linesLabel: 'Stops on this run',
  runTotalLabel: 'Run total',

  // --- stop states --------------------------------------------------------
  stateWeighed: 'weighed',
  stateSkipped: 'skipped',
  stateMoved: 'moved to another driver',
  stateCollected: 'picked up, not weighed yet',
  statePending: 'not picked up yet',

  // --- the one action -----------------------------------------------------
  receiveDone: 'Receive done',
  confirmQuestion: 'Finish this run?',
  backToRuns: 'Back to the runs',
  closedToast: 'Run finished.',
  oneExtraDropped: 'One flagged extra pickup was dropped. Nobody weighed it.',
  manyExtrasDropped: 'flagged extra pickups were dropped. Nobody weighed them.',

  // --- not ready yet ------------------------------------------------------
  notReady: 'This run is not finished yet',
  outstandingLabel: 'Still to do',

  // --- nothing to show ----------------------------------------------------
  noStops: 'This run has no stops.',
  noStopsHint: 'There is nothing to weigh, so you can finish it whenever you like.',
} as const;
