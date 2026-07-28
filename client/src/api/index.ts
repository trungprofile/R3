// The typed fetch layer. Screens import from here, never from `fetch` directly —
// a raw call would miss the session cookie, the one error shape (§6) and the
// offline banner all at once.
//
// Per-endpoint response types arrive with the screens they belong to; this
// package holds only what the shell itself needs.

export { api } from './client.ts';
export type { RequestOptions } from './client.ts';
export { ApiError, isApiError, toApiError, kindForStatus } from './errors.ts';
export type { ApiErrorKind } from './errors.ts';
export {
  isOnline,
  subscribeToConnection,
  reportNetworkFailure,
  reportNetworkSuccess,
} from './connection.ts';
export { lastActivityAt, subscribeToActivity, reportActivity } from './activity.ts';
export { fetchSession, signOut, displayName } from './session.ts';
export type { CurrentUser, SessionInfo } from './session.ts';
