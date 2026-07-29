-- `uq_notif_shift_event` — restrict the send-idempotency index to the events it was
-- always described as covering.
--
-- THE DEFECT. 0006 created this index on `(event, shift_id, recipient_id)` with a
-- partial predicate on the two columns being non-null and NO filter on `event`, while
-- the comment directly above it justified the index for "shift-scoped, time-triggered
-- events" on the grounds that "event-triggered ones fire once by construction". The
-- index therefore covered every shift-scoped event, including the event-triggered ones
-- the comment excluded. `services/notification.ts` already names the intended set as
-- `TIME_TRIGGERED_EVENTS` and its JSDoc asserts this index "protects" exactly those —
-- so the code's stated model and the DDL disagreed, and the DDL was wrong.
--
-- WHAT IT COST. `SHIFT_OPENED` is event-triggered and does NOT fire once by
-- construction: release → re-claim → release is an ordinary sequence, and each release
-- fans out to the same eligible drivers about the same run. The second fan-out collided
-- with the first row and `notification.ts`'s unqualified `ON CONFLICT DO NOTHING`
-- swallowed it. Nobody was told the run was back on the board — silently, with no error
-- and nothing in the suite to notice. The same applies to a second `SHIFT_ASSIGNED` for
-- a run reassigned twice, and to `UNAVAILABILITY_DECLARED`.
--
-- Found by Wave 3's coverage lane, which pinned the behaviour with a test rather than
-- working around it, because `server/migrations/` is lead-owned (build-plan §3).
--
-- WHY AN ENUMERATED PREDICATE rather than dropping the index. Dedupe is load-bearing
-- for exactly the sweeps that re-ask "what is due and unsent" (§4.4): it is what demotes
-- a missed tick from a lost notification to a late one. Dropping it would trade a silent
-- swallow for a silent duplicate. The list is kept in lockstep with
-- `TIME_TRIGGERED_EVENTS`; adding a time-triggered event means editing both, and the
-- constant's comment says so.

DROP INDEX uq_notif_shift_event;

CREATE UNIQUE INDEX uq_notif_shift_event ON notification (event, shift_id, recipient_id)
  WHERE shift_id IS NOT NULL
    AND recipient_id IS NOT NULL
    AND event IN ('SHIFT_REMINDER', 'SHIFT_AT_RISK');
