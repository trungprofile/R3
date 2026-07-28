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

export {};
