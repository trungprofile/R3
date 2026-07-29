// Expired-session cleanup (`architecture.md §4.2`, §4.4).
//
// Carried from Wave 1 rather than deferred by choice: `purgeExpiredSessions()` was
// written by the identity lane and `jobs/` by the signal lane, in two worktrees that
// could not import each other. Registering it is this one file plus a line in
// `registry.ts`, which is what the registry's "adding a job costs one line" claim is
// supposed to buy.
//
// A catch-up sweep like every other job (§4.4): it asks the database which sessions
// are past expiry, so a missed tick or a restart merely delays the purge instead of
// losing it. Running it late, twice, or after an outage is harmless — deleting an
// already-deleted session is a no-op, and a session past expiry is already refused by
// the auth middleware whether or not its row is still there.
//
// Daily, because the row's presence is not what enforces the timeout: expiry is
// checked on every authenticated request, so this reclaims storage rather than
// enforcing a rule. Sweeping more often would spend transactions on tidiness.

import { purgeExpiredSessions } from '../services/session.js';
import type { Job } from './scheduler.js';

const DAILY_MS = 24 * 60 * 60 * 1000;

export const sessionCleanupJob: Job = {
  name: 'session-cleanup',
  intervalMs: DAILY_MS,
  run: async () => {
    const purged = await purgeExpiredSessions();
    if (purged > 0) {
      // Structured to stdout (§5.4). A count, never a session id — the identifier is
      // the bearer token's shadow and does not belong in a log line.
      console.log(JSON.stringify({ event: 'sessions_purged', count: purged }));
    }
  },
};
