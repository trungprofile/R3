// The one error shape every request failure takes.
//
// `ui-ux-spec.md §6`: an error is "plain, recoverable ... + retry. Never a code."
// So the message a screen renders is written here, per kind, in the microcopy
// rules of §7 — short, second person, no jargon. The server's correlation
// identifier (`architecture.md §5.5`) rides along for the operator reading logs
// and is NEVER rendered; that is the whole reason it is a separate field.

export type ApiErrorKind =
  /** The network is gone. Raises the blocking banner (§6). */
  | 'offline'
  /** No signed-in user, or the session ended. The shell returns to login. */
  | 'unauthenticated'
  /** Signed in, but not allowed. The server decided this; the client only says so. */
  | 'forbidden'
  | 'not-found'
  /** Someone else changed it first — e.g. a run claimed a moment earlier. */
  | 'conflict'
  /** The request itself was wrong. Screens usually show this inline on a field. */
  | 'invalid'
  | 'server';

const MESSAGES: Record<ApiErrorKind, string> = {
  offline: "You're offline. R3 needs a connection.",
  unauthenticated: 'You were signed out. Sign in again to continue.',
  forbidden: "You can't do that.",
  'not-found': "That isn't here anymore.",
  conflict: 'Someone changed this just now. Try again.',
  invalid: "That didn't work. Check what you entered and try again.",
  server: 'Something went wrong. Tap to try again.',
};

/** Kinds a plain retry can plausibly fix. Drives whether a retry button shows. */
const RETRYABLE: ReadonlySet<ApiErrorKind> = new Set<ApiErrorKind>([
  'offline',
  'conflict',
  'server',
]);

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly retryable: boolean;
  /** HTTP status, when there was a response. For logging and for screens that
   *  branch on it — not for display. */
  readonly status: number | undefined;
  /** From `architecture.md §5.5`. Operator-facing only; never put on screen. */
  readonly correlationId: string | undefined;
  /** A server-supplied explanation, when the endpoint had one worth showing
   *  (e.g. "You own a run in this window"). A screen may render this in place of
   *  `message`; the default stays the plain text above. */
  readonly detail: string | undefined;

  constructor(
    kind: ApiErrorKind,
    options: { status?: number; correlationId?: string; detail?: string } = {},
  ) {
    super(MESSAGES[kind]);
    this.name = 'ApiError';
    this.kind = kind;
    this.retryable = RETRYABLE.has(kind);
    this.status = options.status;
    this.correlationId = options.correlationId;
    this.detail = options.detail;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/** Anything a screen catches gets turned into a displayable error here, so no
 *  screen has to decide what an unknown throw looks like to a volunteer. */
export function toApiError(value: unknown): ApiError {
  return isApiError(value) ? value : new ApiError('server');
}

export function kindForStatus(status: number): ApiErrorKind {
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not-found';
  if (status === 409) return 'conflict';
  if (status === 400 || status === 422) return 'invalid';
  return 'server';
}
