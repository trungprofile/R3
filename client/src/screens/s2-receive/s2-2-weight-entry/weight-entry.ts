// S2.2 weight entry — every decision the sheet makes, as a function of plain
// records.
//
// It is written this way so it can be tested at all: there is no browser or
// component harness in this repo and adding one would be a dependency a lane may
// not add (`phase-2-build-plan.md §3`). The JSX beside this file arranges what is
// decided here.
//
// EVERYTHING BELOW IS COMMUNICATION ONLY. `services/receive.ts` enforces I12,
// I13 and the edit window inside a SERIALIZABLE transaction and refuses the same
// things again when this screen gets one wrong (`CLAUDE.md`). Hiding an action
// here is a courtesy to a volunteer at a tablet, never the rule itself.
//
// THE ONE RULE THAT IS NOT COSMETIC: a weight is a decimal string from the moment
// it is typed to the moment it is stored, and is never routed through a JS
// number (`phase-2-state.md` A165). `numeric(8,2)` is exact; a float is not, and
// a value that is not binary-representable would come back subtly wrong in the
// column that feeds the NTFB report. Every function here that touches a weight
// therefore does string work — no `Number()`, no `parseFloat`, no arithmetic.

import { toApiError } from '../../../api/index.ts';
import { RECEIVE_RESOLVED_STATES } from '../../../api/shared.ts';
import type {
  CategoryTile,
  ReceiveStopDetail,
  ReceiveStopState,
  ReceiveStopSummary,
  WeightEntrySummary,
} from '../../../api/shared.ts';

// ---------------------------------------------------------------------------
// What a weight may look like
// ---------------------------------------------------------------------------

/** `numeric(8,2)`: six whole digits and two decimals (`data-model.md §7.1`). The
 *  server's own guard is the same pattern; this one exists so the keypad refuses
 *  the seventh digit instead of letting the receiver type a number that will be
 *  rejected after they tap Add. */
export const MAX_WHOLE_DIGITS = 6;
export const MAX_DECIMALS = 2;

/** Digits the keypad will hold at all, decimal point not counted. The per-part
 *  limits above are the real rule; this is the coarse cap `NumericKeypad` takes. */
export const KEYPAD_MAX_DIGITS = MAX_WHOLE_DIGITS + MAX_DECIMALS;

const WEIGHT_PATTERN = /^\d{1,6}(\.\d{1,2})?$/;
const PARTIAL_PATTERN = /^\d*(\.\d*)?$/;

/**
 * The keypad's proposed value, accepted or refused.
 *
 * `NumericKeypad` owns nothing; it hands the screen the value it *would* have,
 * and this decides. Refusing returns the current value unchanged, so an
 * over-long entry simply stops growing rather than flashing an error at someone
 * who is holding a crate.
 *
 * Decimal is allowed — scales read in tenths (S2.2 edge: "Decimal allowed").
 * A leading zero is dropped (`07` → `7`) but `0.` is kept, because that is what
 * the keypad produces when the receiver taps `.` first.
 */
export function acceptKeypadValue(current: string, proposed: string): string {
  if (proposed === '') return '';
  if (!PARTIAL_PATTERN.test(proposed)) return current;

  const cleaned = proposed.replace(/^0+(?=\d)/, '');
  const [whole = '', fraction] = cleaned.split('.');
  if (whole.length > MAX_WHOLE_DIGITS) return current;
  if (fraction !== undefined && fraction.length > MAX_DECIMALS) return current;
  return cleaned;
}

/**
 * The string that goes on the wire — what was typed, tidied, never reparsed.
 *
 * `12.` is what the keypad holds mid-typing and is not a number the server will
 * take, so the trailing point comes off. Nothing else is touched: the digits sent
 * are the digits typed (A165).
 */
export function normalizeWeight(raw: string): string {
  const trimmed = raw.trim();
  const withoutTrailingPoint = trimmed.endsWith('.') ? trimmed.slice(0, -1) : trimmed;
  return withoutTrailingPoint.replace(/^0+(?=\d)/, '');
}

/** Whether "Add weight" does anything. Empty is not a weight and neither is a
 *  lone decimal point; `0` is left alone, because refusing it would be a rule
 *  this screen invented (the server takes it). */
export function canAddWeight(raw: string): boolean {
  return WEIGHT_PATTERN.test(normalizeWeight(raw));
}

/**
 * A weight as the sheet shows it: trailing zeros off, so `293.00` reads `293`
 * the way it did on paper and `12.50` reads `12.5`.
 *
 * String surgery only. Anything that is not a plain decimal is shown exactly as
 * it arrived rather than guessed at — a number on this screen is never invented.
 */
export function formatWeight(value: string): string {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return trimmed;

  const [whole = '0', fraction] = trimmed.split('.');
  const lead = whole.replace(/^0+(?=\d)/, '');
  if (fraction === undefined) return lead;

  const kept = fraction.replace(/0+$/, '');
  return kept === '' ? lead : `${lead}.${kept}`;
}

/** §7: "Units always shown ('lb')." */
export function formatPounds(value: string): string {
  return `${formatWeight(value)} ${COPY.unit}`;
}

// ---------------------------------------------------------------------------
// The tiles
// ---------------------------------------------------------------------------

/**
 * Tile order, and the property that matters: **it never depends on the entries**.
 *
 * The sheet is a paper log with fixed columns. If tiles re-sorted by subtotal or
 * floated the busy ones to the front, the target under someone's finger would
 * move between one weight and the next — the single worst thing this screen
 * could do to the volunteers it is for. Sorting by name is stable, matches the
 * order `readStopSheet` already returns active categories in, and gives a
 * category archived mid-run (S1.8) a fixed place too instead of letting it jump
 * to the end.
 */
export function orderedTiles(tiles: readonly CategoryTile[]): CategoryTile[] {
  return [...tiles].sort((a, b) => a.categoryName.localeCompare(b.categoryName));
}

/**
 * How many entries a capped category row admits before it starts scrolling (`D45`).
 *
 * `.r3-tile__entries` is capped at two chip rows so one busy category cannot grow
 * its neighbours or lengthen the page. How many chips actually fit on those two
 * rows is not knowable here: a chip's width is the number of digits typed into it,
 * and the pane's width is whatever the device gives it. So the count is NOT a
 * measurement — it is the floor. Two is the fewest chips two rows can ever hold
 * (one per row, worst case a six-digit weight in a narrow pane), so at three or
 * more the receiver may be looking at fewer numbers than the category has, and
 * that is exactly when the row has to say so.
 *
 * Erring toward showing it: a scroll region with no visible affordance is a trap,
 * and a count that is occasionally redundant costs a word.
 */
export const ENTRIES_ALWAYS_VISIBLE = 2;

/**
 * "5 entries" beside a category's subtotal, or null when nothing can be hidden.
 *
 * This is the affordance for the capped, scrolling entry list (`D45`) — it tells
 * the receiver the row holds more than they can see. Singular is unreachable by
 * construction (the threshold is 2) but written out anyway, because a future
 * threshold change should not silently produce "1 entries".
 */
export function entryCountLabel(entries: readonly WeightEntrySummary[]): string | null {
  if (entries.length <= ENTRIES_ALWAYS_VISIBLE) return null;
  return `${entries.length} ${entries.length === 1 ? COPY.entryCountOne : COPY.entryCountMany}`;
}

/** Whether anything has been weighed at this stop yet. Drives both the primary
 *  action and whether Skip is offered. */
export function hasWeights(detail: ReceiveStopDetail): boolean {
  return detail.tiles.some((tile) => tile.entries.length > 0);
}

/** Find one entry across the tiles — the ✎ hands back an id, the editor needs
 *  the row. */
export function findEntry(
  detail: ReceiveStopDetail,
  entryId: string,
): { entry: WeightEntrySummary; tile: CategoryTile } | null {
  for (const tile of detail.tiles) {
    const entry = tile.entries.find((candidate) => candidate.id === entryId);
    if (entry) return { entry, tile };
  }
  return null;
}

/**
 * Whether the sheet takes numbers at all.
 *
 * `SKIPPED` says nothing came from this store and cannot be undone from here
 * (S2.2); `REASSIGNED` belongs to another run now and the server refuses every
 * write on it (I30). Showing a live keypad on either would promise an edit that
 * either means nothing or fails.
 */
export function sheetIsOpen(detail: ReceiveStopDetail): boolean {
  return detail.state !== 'SKIPPED' && detail.state !== 'REASSIGNED';
}

/** Skip is for a stop with nothing on it. The server refuses a skip once a
 *  non-voided weight exists ("Remove them before skipping it"), so offering it
 *  would be offering a refusal. */
export function canSkipStop(detail: ReceiveStopDetail): boolean {
  return sheetIsOpen(detail) && !hasWeights(detail);
}

// ---------------------------------------------------------------------------
// The stop strip, and where "Done" (`ui-ux-spec.md`'s "Mark stop weighed", D37) goes
// ---------------------------------------------------------------------------

export function orderedStops(stops: readonly ReceiveStopSummary[]): ReceiveStopSummary[] {
  return [...stops].sort((a, b) => a.position - b.position);
}

/** I12's three: the states that need nothing more from the receiver. */
export function isResolved(state: ReceiveStopState): boolean {
  return RECEIVE_RESOLVED_STATES.includes(state);
}

export function allStopsResolved(stops: readonly ReceiveStopSummary[]): boolean {
  return stops.length > 0 && stops.every((stop) => isResolved(stop.state));
}

export interface Progress {
  done: number;
  total: number;
}

export function progressOf(stops: readonly ReceiveStopSummary[]): Progress {
  return {
    done: stops.filter((stop) => isResolved(stop.state)).length,
    total: stops.length,
  };
}

export function progressLabel(stops: readonly ReceiveStopSummary[]): string {
  const { done, total } = progressOf(stops);
  return `${done} of ${total} done`;
}

/**
 * The stops still holding the run open — what **Submit run** names when it
 * refuses to leave (`D62`).
 *
 * The same reading as S2.2b's `outstandingLines`, over the strip this screen
 * already has rather than over the completion summary it does not fetch. Both are
 * `isResolved` negated, which is I12's list and nothing else, so the two screens
 * cannot disagree about which stop is missing.
 */
export function outstandingStops(
  stops: readonly ReceiveStopSummary[],
): ReceiveStopSummary[] {
  return orderedStops(stops).filter((stop) => !isResolved(stop.state));
}

/**
 * What **Submit run** does.
 *
 * `go` when every stop is resolved — Receive done (S2.2b) is the run's next step
 * and the one completion action (I11). `blocked` otherwise, which opens the modal
 * naming what is left and navigates nowhere.
 *
 * Communication only. `receiveDone()` re-checks the same gate inside its
 * transaction and refuses with `RECEIVE_INCOMPLETE_MESSAGE` regardless of what
 * this returns.
 */
export type SubmitDecision = 'go' | 'blocked';

export function submitDecision(stops: readonly ReceiveStopSummary[]): SubmitDecision {
  return allStopsResolved(stops) ? 'go' : 'blocked';
}

/**
 * The next stop still wanting a weight, starting after the current one and
 * wrapping to the top.
 *
 * Wrapping matters: a receiver who jumps to the last stop out of order still
 * gets walked back to the one they left, instead of being told there is nothing
 * left while a stop above them is still pending.
 */
export function nextUnresolvedStop(
  stops: readonly ReceiveStopSummary[],
  currentStopId: string,
): ReceiveStopSummary | null {
  const ordered = orderedStops(stops);
  const at = ordered.findIndex((stop) => stop.id === currentStopId);
  const start = at < 0 ? 0 : at + 1;

  for (let step = 0; step < ordered.length; step += 1) {
    const stop = ordered[(start + step) % ordered.length];
    if (!stop || stop.id === currentStopId) continue;
    if (!isResolved(stop.state)) return stop;
  }
  return null;
}

/**
 * Where "Done" (or "Next stop") lands.
 *
 * The button resolves nothing — any non-voided weight has already resolved the
 * stop server-side (I12) — so this is purely navigation:
 *   - another stop still wants a weight → go there
 *   - every stop on the run is resolved → Receive done is now the run's next
 *     step (S2.2b), so go there
 *   - nothing else is unresolved but this stop is not resolved either → stay,
 *     because sending someone away from an unweighed stop would lose it
 */
export type AdvanceTarget =
  | { kind: 'stop'; stop: ReceiveStopSummary }
  | { kind: 'receive-done' }
  | { kind: 'stay' };

export function advanceTargetFor(
  stops: readonly ReceiveStopSummary[],
  currentStopId: string,
): AdvanceTarget {
  const next = nextUnresolvedStop(stops, currentStopId);
  if (next) return { kind: 'stop', stop: next };
  if (allStopsResolved(stops)) return { kind: 'receive-done' };
  return { kind: 'stay' };
}

/**
 * Fold a fresh `ReceiveStopDetail`'s state back into the strip.
 *
 * Every mutation returns the whole sheet including this stop's projected state,
 * so the strip updates from the same response rather than from a second request
 * — one round trip, and no window where the tiles and the strip disagree.
 */
export function applyStopState(
  stops: readonly ReceiveStopSummary[],
  stopId: string,
  state: ReceiveStopState,
): ReceiveStopSummary[] {
  return stops.map((stop) => (stop.id === stopId ? { ...stop, state } : stop));
}

/**
 * What a stop's state says to a receiver.
 *
 * `PENDING` and `COLLECTED` read the same here on purpose: the difference is
 * whether the driver checked the stop off, which is the driver's business. To
 * the person at the tablet both mean "this one still needs weighing".
 */
export function stopStateLabel(state: ReceiveStopState): string {
  switch (state) {
    case 'PENDING':
    case 'COLLECTED':
      return COPY.stateToWeigh;
    case 'WEIGHED':
      return COPY.stateWeighed;
    case 'SKIPPED':
      return COPY.stateSkipped;
    case 'REASSIGNED':
      return COPY.stateMoved;
  }
}

/** The strip's mark, echoing S2.2's "Sam's✓ · Kroger● · Aldi●". Decorative — the
 *  label above is what a screen reader gets. */
export function stopStateMark(state: ReceiveStopState): string {
  switch (state) {
    case 'WEIGHED':
      return '✓';
    case 'SKIPPED':
    case 'REASSIGNED':
      return '–';
    default:
      return '●';
  }
}

// ---------------------------------------------------------------------------
// Leaving with something typed
// ---------------------------------------------------------------------------

/** Digits on the keypad that have not been added to the sheet. */
export function hasUnsavedEntry(raw: string): boolean {
  return raw.trim() !== '';
}

/**
 * S2.2's edge case: "switching stop mid-entry with unsaved weights warns."
 *
 * Applied to every way off this stop, not just the picker — "Done" and the
 * all-done banner leave just as completely, and a number typed but not
 * added is lost identically whichever one was tapped.
 */
export type LeaveDecision = 'go' | 'warn';

export function leaveDecision(raw: string): LeaveDecision {
  return hasUnsavedEntry(raw) ? 'warn' : 'go';
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** What a failed action says. The server writes its refusals in §7's plain
 *  register ("That stop already has weights. Remove them before skipping it."),
 *  so when it sent one, that is the sentence. Never a code (§6). */
export function messageFor(error: unknown): string {
  const apiError = toApiError(error);
  return apiError.detail ?? apiError.message;
}

/** Whether the failure means this sheet is out of date — someone else weighed
 *  this stop, corrected the same number first, or staff moved the stop off the
 *  run. Two receivers on one run is the expected case (S2.1b), so a conflict is
 *  a cue to re-read rather than an error to sit on. */
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
 * Words that would leak how a correction is stored. To the receiver, editing a
 * weight replaces a number and that is the whole story (§6, PRD out-of-scope);
 * the void-and-reinsert underneath (I13) is the server's business and must never
 * become vocabulary on a screen a volunteer reads.
 */
export const FORBIDDEN_EDIT_WORDS = [
  'void',
  'history',
  'audit',
  'revision',
  'original entry',
  'previous version',
] as const;

/**
 * Every sentence on this screen, in one place.
 *
 * The register is the Retail Rescue Log's: categories, numbers, totals. Nothing
 * here names a state machine, and nothing claims a run is finished — closing the
 * run is Receive done's single action (I11), one screen along.
 */
export const COPY = {
  // --- the sheet ----------------------------------------------------------
  unit: 'lb',
  stopsLabel: 'Stops',
  weighingLabel: 'Weighing',
  loadingSheet: 'Loading the sheet',
  noCategories: 'No categories are set up yet.',
  noCategoriesNext: 'Ask an admin to add them, then come back and weigh this stop.',
  /** `D44`: the two panes are labelled, because they are the two halves of the
   *  sheet and a screen reader meets them without the layout. */
  categoriesLabel: 'Categories',
  workLabel: 'Weighing this stop',
  /** `D45`: the count that says a category row holds more numbers than it shows. */
  entryCountOne: 'entry',
  entryCountMany: 'entries',

  // --- keypad panel -------------------------------------------------------
  selectedLabel: 'Selected',
  pickCategory: 'Tap a category to start',
  entryLabel: 'Weight to add',
  keypadLabel: 'Weight keypad',
  addWeight: 'Add weight',
  stopTotalLabel: "This stop's total",
  weightAdded: 'Added.',

  // --- overwriting one number (a plain edit, and nothing more) -------------
  editingLabel: 'Changing',
  priorValueLabel: 'Now',
  saveWeight: 'Save weight',
  cancelEdit: 'Cancel',
  weightSaved: 'Saved.',
  removeWeight: 'Remove',
  removeQuestion: 'Remove this weight?',
  removeConsequence: 'It comes off the sheet and off the total. You cannot take that back.',
  removeConfirm: 'Remove weight',
  weightRemoved: 'Removed.',

  // --- resolving the stop -------------------------------------------------
  //
  // `D37` shortened both labels: "Mark stop weighed" and "Skip stop" sat side by
  // side under the keypad, and at 18px on a tablet the pair read as a sentence to
  // parse rather than as two buttons to hit. The words they lost were the ones the
  // screen already says — the stop's name is in the header and its total is
  // directly above — so what is left is the verb. Neither button's BEHAVIOUR moved:
  // `Done` still only navigates (I12 derives `WEIGHED` from a non-voided weight),
  // and `Skip` still opens the same confirm.
  //
  // The aria labels put the noun back for a screen reader, which meets a button
  // without the header and the total around it.
  markWeighed: 'Done',
  markWeighedAria: 'Done with this stop',
  markWeighedHint: 'Add a weight first, or skip this stop.',
  nextStop: 'Next stop',
  skipStop: 'Skip',
  skipStopAria: 'Skip this stop',
  skipQuestion: 'Skip this stop?',
  skipConsequence:
    'It stays skipped. You cannot change it back here, and nothing from this store goes in the report.',
  skipConfirm: 'Skip stop',
  stopSkipped: 'Stop skipped.',

  // --- leaving with something typed ---------------------------------------
  leaveQuestion: 'Leave without adding that weight?',
  leaveConsequence: 'The number on the keypad has not been added. Leaving clears it.',
  leaveConfirm: 'Leave without adding',

  // --- notes the receiver reads and never writes ---------------------------
  //
  // `D68`: all three are labelled text now, not a disclosure. The toggle it
  // replaced cost a 44px target and a tap to read one line, and QA found the run
  // note was simply never opened. `noRunNote` stays defined and unrendered — an
  // absent note is absent, not announced.
  // ONE LINE EACH. A label stacked over its body spent two lines of the entry
  // column to say something the receiver already knew, on the screen with the
  // least room to spare. The label names WHO wrote it, because that is the part
  // they cannot see: two of the three come from the driver and one from an admin,
  // and which is which changes how much the note is worth acting on.
  //
  // The possessive is always `'s`, including after an s. It is a label, not prose,
  // and one rule that is occasionally unfashionable beats two rules that disagree
  // about "Chris". A run with no owner names the role instead of a person.
  stopNoteLabel: (driver: string | null) => (driver === null ? 'Driver note:' : `${driver}'s note:`),
  runNoteLabel: (driver: string | null) =>
    driver === null ? 'Driver note on the run:' : `${driver}'s note on the run:`,
  donorNoteLabel: 'Store note:',
  noRunNote: 'The driver left no note about this run.',

  // --- states -------------------------------------------------------------
  stateToWeigh: 'To weigh',
  stateWeighed: 'Weighed',
  stateSkipped: 'Skipped',
  stateMoved: 'Moved to another run',
  skippedTitle: 'This stop is skipped.',
  skippedNext: 'Nothing came from this store. Pick another stop to keep weighing.',
  movedTitle: 'This stop moved to another run.',
  movedNext: 'Another driver has it now. Pick another stop to keep weighing.',

  // --- submitting the run (`D62`) -------------------------------------------
  //
  // Replaces the all-done banner, which only appeared once every stop was
  // resolved — a control that arrives late is a control nobody expects, and until
  // it arrived the screen offered no way on to S2.2b at all. Submit is in the
  // progress row always, and asking early costs a modal rather than a dead end.
  //
  // It closes nothing. Receive done (S2.2b) is still the one completion action
  // (I11); this is the way to it.
  submitRun: 'Submit run',
  backToRuns: 'Runs',
  /** The modal, worded as S2.2b's BLOCKED stage words it — the sentence itself is
   *  `RECEIVE_INCOMPLETE_MESSAGE` in `shared/src/receive.ts` and is not restated
   *  here, because a second copy of it would drift. */
  notReady: 'This run is not finished yet',
  outstandingLabel: 'Still to do',
  keepWeighing: 'Keep weighing',
  noStopTitle: 'No stop picked yet.',
  noStopNext: 'Pick the run and the store you are weighing.',
  pickRun: 'Pick a run',
} as const;
