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

// ---------------------------------------------------------------------------
// Which of the three screens this is (`D37`)
// ---------------------------------------------------------------------------

/**
 * What the receiver is looking at.
 *
 *   `BLOCKED`  a stop is still unresolved. The action is absent, not disabled, and
 *              the screen says what is outstanding.
 *   `CONFIRM`  every stop resolved and the run still open: the summary, the one
 *              button that closes it, and the way BACK into the weights.
 *   `CLOSED`   the run is finished. A read-only summary — offering **Receive done**
 *              here was offering a refusal, since I11 makes `COMPLETED` terminal.
 *
 * `stillOpen` is `fetchOpenRun()`'s answer, and `null` means the screen could not
 * find out (the read failed, or has not landed). It deliberately falls back to the
 * old behaviour rather than to `CLOSED`: guessing "finished" would hide the button
 * on a run that genuinely needs closing, and I11 leaves no other way to close one.
 * Guessing the other way costs a refusal the server words for us.
 *
 * `readyForReceiveDone` is still the server's own reading of the completion gate and
 * is still not recomputed here (see `canFinish`).
 */
export type DoneStage = 'BLOCKED' | 'CONFIRM' | 'CLOSED';

export function doneStage(summary: ReceiveDoneSummary, stillOpen: boolean | null): DoneStage {
  if (stillOpen === false) return 'CLOSED';
  return canFinish(summary) ? 'CONFIRM' : 'BLOCKED';
}

/**
 * Whether to offer the way back into the weights.
 *
 * Until the receiver submits, the confirm is not a one-way door: they may go back
 * and change a number (`D37`). After it, they may not — `services/receive.ts`
 * refuses every receiver write on a run that is not `IN_PROGRESS`, so an Edit on a
 * closed run would lead somewhere that says no. That guard is the rule; this is the
 * same question asked politely, one screen earlier.
 *
 * **Both halves, since `D47`.** `requireReceivable` and `requireWindowOpen` are two
 * separate gates on every receiver write, and the screen could previously see only
 * the first — so **Change a weight** appeared on a run that was still open but whose
 * day-based window had lapsed, and led to a sheet that refused the write. The
 * payload now carries the server's own evaluation of the second (`editWindowOpen`),
 * so the button is offered when, and only when, both would pass.
 *
 * Still communication only. Neither gate moved; the service asks both again.
 *
 * `stillOpen` keeps its three-valued reading: `null` is "could not find out" and
 * falls back to offering, because guessing "closed" would hide the way back on a run
 * that has one. `editWindowOpen` has no such case — it always arrives with the
 * summary the screen cannot render without.
 */
export function canEditWeights(stillOpen: boolean | null, editWindowOpen: boolean): boolean {
  return stillOpen !== false && editWindowOpen;
}

// ---------------------------------------------------------------------------
// Who signed off (`D46`)
// ---------------------------------------------------------------------------

/** The completion attribution, when there is one. */
export interface SignOff {
  name: string;
  at: string;
}

/**
 * Who finished this run and when, or null.
 *
 * The server populates `completedBy`/`completedAt` only on a `COMPLETED` shift,
 * reading the last writer under I10's terminality — see the assumption beside the
 * query in `services/receive.ts`. This side does not re-derive any of that; it only
 * refuses to render half an attribution. A name with no time, or a time with no
 * name, is a sentence the screen should not attempt.
 */
export function signOff(summary: ReceiveDoneSummary): SignOff | null {
  if (summary.completedBy === null || summary.completedAt === null) return null;
  return { name: summary.completedBy, at: summary.completedAt };
}

/**
 * "2 Aug 2026, 3:14 PM" — the moment the run was closed, in the PANTRY's zone.
 *
 * The zone is the session's (A120) and never the device's: a receiver who closes a
 * Tuesday run at 12:30am is reading a screen about the pantry's day, not their
 * tablet's. `undefined` falls back to the device, which is right only for the moment
 * before the session has loaded.
 */
export function signOffTime(iso: string, timeZone?: string | null): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return at.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  });
}

/**
 * Which stop "Edit weights" opens: the first one on the run, in route order.
 *
 * The first rather than the last, because the receiver going back to change a
 * number is looking for a store, and the run's own order is the one they have in
 * their head from weighing it. The stop strip on S2.2 is how they get to any other.
 *
 * `null` for a run with no stops — there is no sheet to open, and I12 lets such a
 * run close vacuously anyway.
 */
export function firstStopId(run: {
  stops: readonly { id: string; position: number }[];
}): string | null {
  const ordered = [...run.stops].sort((a, b) => a.position - b.position);
  return ordered[0]?.id ?? null;
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
  /** `D43`: the way out is a `BackLink` at the TOP of the screen, so it is a noun
   *  naming the destination rather than a sentence at the bottom of three
   *  different branches. The three hand-rolled "Back to the runs" buttons are
   *  gone with it. */
  backToRuns: 'Runs',
  /** `D37`: the confirm is not a one-way door until it is submitted. Named for
   *  what it opens — the weights — rather than "Back", which would read as the
   *  browser's button and say nothing about what is on the other side. */
  editWeights: 'Change a weight',
  editHint: 'Nothing is final until you tap Receive done.',
  closedToast: 'Run finished.',
  oneExtraDropped: 'One flagged extra pickup was dropped. Nobody weighed it.',
  manyExtrasDropped: 'flagged extra pickups were dropped. Nobody weighed them.',

  // --- not ready yet ------------------------------------------------------
  notReady: 'This run is not finished yet',
  outstandingLabel: 'Still to do',

  // --- already closed (`D37`) ----------------------------------------------
  //
  // No action, and none implied. A correction from here on is the Reporter's
  // (PRD cap 15, D14) — naming that is honest and is not a promise this screen
  // can keep, so the copy says where the numbers went rather than what to do.
  closed: 'This run is finished',
  closedHint: 'These are the weights the report will use.',
  closedNext: 'Ask whoever files the report if one of them needs correcting.',
  /** `D46`: the CLOSED stage said the run was finished and never said BY WHOM.
   *  On a shared tablet that is the one question a second receiver asks. */
  signedOffLabel: 'Finished by',

  // --- nothing to show ----------------------------------------------------
  noStops: 'This run has no stops.',
  noStopsHint: 'There is nothing to weigh, so you can finish it whenever you like.',
} as const;
