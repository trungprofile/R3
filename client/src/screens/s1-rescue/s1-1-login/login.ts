// S1.1 Login — the decisions and the copy, apart from the rendering.
//
// PURE ON PURPOSE. Nothing here touches `window`, React or the network, because
// there is no browser or component test harness in this repo and adding one would
// be a dependency a lane may not add (build-plan §3/D5). The parts of this screen
// that are rules rather than pixels — how many tries are left, what a lock says,
// when Enter is allowed to fire — are therefore functions of plain records, and
// `login.test.ts` covers them.
//
// Copy lives here beside the machine that chooses it (same shape as
// `pwa/onboarding.ts`), so one test can hold all of it to `ui-ux-spec.md §7`:
// plain, short, second person, and none of the forbidden vocabulary.

import { toApiError } from '../../../api/index.ts';
import { PIN_LENGTH } from '../../../api/shared.ts';
import type { CredentialKind, RosterEntry } from '../../../api/shared.ts';

// ---------------------------------------------------------------------------
// Copy (`ui-ux-spec.md` S1.1, §5, §6, §7)
// ---------------------------------------------------------------------------

export const COPY = {
  /** Step 1. §5: a list of names — recognition, no typing. */
  chooseTitle: "Who's signing in?",
  chooseHint: 'Tap your name.',
  /** Step 2, per credential kind. */
  pinLabel: 'Your 4-digit PIN',
  passwordLabel: 'Your password',
  /** S1.1 names the primary action outright. */
  submit: 'Enter',
  /** The way back to the name list, including from a remembered name (§5). */
  back: 'Not you? Choose a different name',
  /** §6: an empty state says what to do next, never just "nothing here". */
  emptyTitle: 'No names here yet.',
  emptyBody: 'An admin adds accounts. Once yours exists, your name is on this list.',
  loading: 'Loading names',
  keypadLabel: 'PIN keypad',
} as const;

/**
 * The soft lock (`architecture.md §4.2`, S1.1). The server sends this exact
 * sentence; this constant is only the fallback for a 429 that arrived without a
 * body. It says "try again in 15 minutes" and NOTHING about being unlocked by
 * staff, because the lock self-clears and nobody can shorten it — there is no
 * unlock action for staff to take, and copy implying otherwise would send a
 * volunteer looking for help that does not exist.
 */
export const LOCKED_TEXT = 'Too many tries. Try again in 15 minutes.';

/**
 * Failures the account gets before the lock (`architecture.md §4.2`'s per-account
 * counter, `server/src/services/auth.ts` `ACCOUNT_MAX_FAILURES`). Mirrored here
 * ONLY to render S1.1's inline count: the throttle is enforced server-side before
 * the credential comparison, and this number decides nothing. See the report's
 * `Assumed:` — the server sends `triesLeft` on the 401, but `api/errors.ts` keeps
 * only the message, so the count is recomputed rather than read.
 */
export const MAX_TRIES = 4;

/** Status of the 429 the soft lock answers with. */
const LOCKED_STATUS = 429;
/** Status of a wrong PIN or password. */
const REJECTED_STATUS = 401;

export function triesLeftAfter(failures: number): number {
  return Math.max(0, MAX_TRIES - failures);
}

/** §6's error pattern: what happened, then what to do. S1.1 fixes the count's
 *  wording ("3 tries left"); the sentence in front of it is ours. */
export function wrongCredentialText(triesLeft: number): string {
  if (triesLeft <= 0) return "That didn't match. Try again.";
  if (triesLeft === 1) return "That didn't match. 1 try left.";
  return `That didn't match. ${triesLeft} tries left.`;
}

// ---------------------------------------------------------------------------
// Attempts
// ---------------------------------------------------------------------------

export interface AttemptState {
  /** Consecutive rejected credentials for the name now selected. */
  failures: number;
  /** The account (or this address) is inside the soft lock's window. */
  locked: boolean;
  /** What to show under the field, or null for nothing. */
  message: string | null;
}

export const NO_ATTEMPTS: AttemptState = { failures: 0, locked: false, message: null };

/**
 * Fold one failed sign-in into the attempt state.
 *
 * Only a REJECTED CREDENTIAL consumes a try. An offline request never reached the
 * server, and a 500 never reached the credential comparison, so counting either
 * would drift this display away from the server's own counter — which is the one
 * that actually locks the account.
 *
 * A lock resets the local count to zero because the server's counter resets with
 * it: once the lock lapses the next wrong PIN is the first failure again, and
 * would otherwise be announced as "0 tries left".
 */
export function afterFailure(state: AttemptState, cause: unknown): AttemptState {
  const error = toApiError(cause);

  if (error.status === LOCKED_STATUS) {
    return { failures: 0, locked: true, message: error.detail ?? LOCKED_TEXT };
  }

  if (error.status === REJECTED_STATUS) {
    const failures = state.failures + 1;
    return { failures, locked: false, message: wrongCredentialText(triesLeftAfter(failures)) };
  }

  // Anything else speaks for itself: the server's own explanation when it had one
  // worth showing, otherwise the one plain message `api/errors.ts` keeps per kind.
  // Never a code (§6).
  return { ...state, locked: false, message: error.detail ?? error.message };
}

// ---------------------------------------------------------------------------
// The roster and the credential
// ---------------------------------------------------------------------------

/** How a person is named on screen: their own name, never their username (§1
 *  principle 4, §7 — identifiers are not what a volunteer reads). Mirrors
 *  `api/session.ts`'s `displayName` for the roster's narrower shape. */
export function rosterName(entry: RosterEntry): string {
  return `${entry.firstName} ${entry.lastName}`.trim();
}

/** By first name, then last: the list is scanned for a face's first name, and the
 *  order has to be the same on every visit for that to be muscle memory. */
export function orderRoster(entries: readonly RosterEntry[]): RosterEntry[] {
  return [...entries].sort(
    (a, b) =>
      a.firstName.localeCompare(b.firstName) ||
      a.lastName.localeCompare(b.lastName) ||
      a.username.localeCompare(b.username),
  );
}

export function findEntry(
  entries: readonly RosterEntry[] | null,
  username: string | null,
): RosterEntry | null {
  if (!entries || !username) return null;
  return entries.find((entry) => entry.username === username) ?? null;
}

/**
 * Whether Enter has anything to send. Communication only, exactly like every
 * other client-side check (`CLAUDE.md`): the server re-checks the shape and the
 * credential itself. A PIN is `PIN_LENGTH` digits (`architecture.md §4.2`); a
 * password only has to be non-empty here, because the server owns its minimum and
 * an account created before that minimum must still be able to sign in.
 */
export function credentialReady(kind: CredentialKind, credential: string): boolean {
  if (kind === 'PIN') return new RegExp(`^\\d{${PIN_LENGTH}}$`).test(credential);
  return credential.trim().length > 0;
}
