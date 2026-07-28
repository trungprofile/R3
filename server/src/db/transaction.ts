// The write-transaction wrapper. Every write path in the application goes through
// here — `architecture.md §4.1` makes three obligations load-bearing:
//
//   1. All write transactions run SERIALIZABLE. A stray READ COMMITTED writer on the
//      same data undermines the guarantee for everyone else. Read-only queries may
//      use the default isolation level.
//   2. Retry on SQLSTATE 40001, bounded at ~3 attempts. A serialization failure is
//      not an error condition; it means "run that again", and every read must be
//      re-taken inside the new attempt.
//   3. No external side effects inside the transaction — no push, no email, no
//      outbound calls, since a retry would repeat them. This is what forces the
//      notification outbox design in §4.4.
//
// Nothing outside `services/` may open a write transaction. §4.1's tier-3 guarantee
// is "exactly one service function per domain operation, and no other code path
// writes those tables" — without that, "the service layer enforces I12" is a
// sentence, not a guarantee.

import type { Transaction } from 'kysely';
import { db } from './index.js';
import type { DB } from './types.js';

export type Tx = Transaction<DB>;

/** Postgres serialization_failure. Not an error — an instruction to run it again. */
const SERIALIZATION_FAILURE = '40001';

const MAX_ATTEMPTS = 3;

function isSerializationFailure(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === SERIALIZATION_FAILURE
  );
}

/**
 * Run `fn` in a SERIALIZABLE transaction, retrying on serialization failure.
 *
 * The canonical R3 case this exists for is I20: a driver double-taps Claim on two
 * overlapping runs. Both transactions read "no overlapping owned shift" — true when
 * each reads it — both update a different legitimately-OPEN `shift` row, and both
 * commit. The tier-2 predicate passes, tier 1 cannot express a relationship spanning
 * two rows in two transactions, and the tier-3 gate was true when read. Only SSI
 * catches it.
 *
 * `fn` MUST be free of external side effects and must re-take every read it depends
 * on, because it may run more than once.
 */
export async function writeTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await db
        .transaction()
        .setIsolationLevel('serializable')
        .execute(fn);
    } catch (err) {
      if (!isSerializationFailure(err)) throw err;
      lastError = err;
      // Logged deliberately: architecture.md §5.4 makes a rising retry rate a
      // signal worth watching, not noise to suppress.
      console.warn(
        JSON.stringify({
          event: 'serialization_failure_retry',
          attempt,
          maxAttempts: MAX_ATTEMPTS,
        }),
      );
    }
  }

  throw lastError;
}
