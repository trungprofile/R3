# Wave 1 — signal

**Status:** complete

**Built:**
- `enqueueNotification(tx, draft)` / `enqueueNotifications(tx, drafts)` — the outbox write seam. Takes an existing transaction handle and never opens one, so the notification row commits or rolls back with the caller's business write (`architecture.md §4.4`).
- `ON CONFLICT DO NOTHING` on the insert, returning `null` when the tier-1 partial unique index `uq_notif_shift_event` absorbed a repeat — the duplicate-send guard for catch-up sweeps is the constraint, not job discipline.
- Dispatch state on `notification`: `pendingDispatch()` (read-only, "what is due and unhandled?", backoff ladder evaluated by the database clock), `recordDispatchResult()` and `revokeSubscription()` (both through `writeTransaction`, SERIALIZABLE).
- `runPushDispatch()` — the outbox drain, running outside any transaction, with a `PushTransport` seam so tests fake the wire and never the database. Retry with backoff (0/1/5/15/60 min), give up after 5 attempts, log the exhaustion (§5.4 names that log explicitly). No dead-letter queue, no alerting.
- `410 Gone` → `push_subscription.revoked_at` (state A4), never a delete; dispatch skips revoked rows.
- `dispatchNow()` — the "on commit" half of §4.4's cadence, fire-and-forget, for a business service to call after its transaction commits.
- `startScheduler()` — in-process intervals, one pass at boot, per-job overlap guard, and a job that throws never takes the process (and therefore the API) down.
- `jobs/registry.ts` — the single list. Adding the recurrence / reminder / at-risk / session-cleanup sweeps is a new file plus one line there; `scheduler.ts` does not change.
- `client/src/sw.ts` — push receiver and `notificationclick` deep-link handler. No `fetch` listener, deliberately. Stale "deletes the `push_subscription` row" header comment corrected to revoke, per A4.

**Files:**
- `server/src/services/notification.ts`
- `server/src/jobs/scheduler.ts`, `server/src/jobs/push-dispatch.ts`, `server/src/jobs/registry.ts`, `server/src/jobs/index.ts`
- `client/src/sw.ts`
- `server/test/notification.test.ts`

**Invariants:** No I1–I30 falls in this lane — `domain-modeling.md` hands delivery mechanics to the notifications doc, and its only notification mention (I27's receiver trigger) is Phase 2. What is enforced and relied on here is tier 1, as DDL already migrated in `0006`:
- `uq_notif_shift_event` (tier 1, partial unique) — the duplicate-send guard for time-triggered, shift-scoped events. `enqueueNotification` is written to be absorbed by it rather than to pre-check for it.
- `ck_notif_recipient` (tier 1) — exactly one of `recipient_id` / `subscription_id`. Both dispatch paths are built off it; the device-scoped path is exercised in tests even though its only event (truck-inbound) is Phase 2.
- `ON DELETE RESTRICT` on every FK (`data-model.md §0`) is why revocation, not deletion, is the `410` handler.
- Tier 3 / §4.1: every write in this lane goes through `db/transaction.ts`, including the ones the job causes — the job calls in through the service and opens nothing itself.

**Tests:** 54 passing / 0 failing (23 new in `server/test/notification.test.ts`, 31 pre-existing substrate) — `./scripts/test-db.sh && DATABASE_URL=<its output> npx vitest run --root server`. `./scripts/gate.sh` exits 0.

One real bug the tests caught rather than documented: the backoff predicate was unparenthesized raw SQL, so its `OR` escaped the surrounding `AND` chain and re-selected delivered and exhausted rows. Fixed; the "gives up after the cap" and "does not pick a delivered row up again" tests are the guards.

**Deliberately not done:**
- **The scheduler is not wired into the process.** `server/src/index.ts` is the identity lane's file and does not exist in this worktree; the lead adds the `startScheduler()` call after both lanes merge (state file, "Seams the lead owns").
- **No push-subscription registration route, and no inbox read/mark-read path.** `routes/` and `middleware/` are the identity lane's; the subscribe flow is Wave 2's PWA onboarding and S1.9 is a Wave-4 screen. This lane writes and drains the outbox; nothing yet fills it, which is expected.
- **No event fan-out logic.** Who receives a `SHIFT_OPENED` is `eligible()`'s answer (`domain-modeling.md §5.2`), built in Wave 2 and consumed by Wave 3's business services. This lane exposes the per-recipient seam those services call.
- **Truck-inbound is absent from the event taxonomy** — PRD Phase 1 is "cap 13 minus truck-inbound". The device-scoped *delivery path* it needs does exist and is tested, since `ck_notif_recipient` makes it one of only two possible row shapes.
- **`doc-qa` not run by this lane** — no Agent tool is available in a lane worktree. `phase-1-build-plan.md §5.2` assigns doc-qa over the merged diff to the lead.

**Assumed:**
- **The event taxonomy strings are this lane's invention.** `notification.event` is `text` whose "taxonomy [is] owned by the notifications doc" — a doc that does not exist. The PRD matrix fixes the six events, their recipients and their triggers; the identifiers `SHIFT_ASSIGNED`, `SHIFT_REMINDER`, `UNAVAILABILITY_DECLARED`, `SHIFT_OPENED`, `SHIFT_AT_RISK` are mine. These are **stored values** — every row Wave 3 writes carries one — so renaming them later is a data migration, not a refactor.
- **Banner copy is this lane's.** The PRD gives event, recipients and channel but no message content ("message content remains the notifications doc's"). Titles and bodies were written to `ui-ux-spec.md §7` (second person, "run" not "shift", no forbidden term) and are asserted against the forbidden-word list in tests, but a human has not read them: "You're on a run", "Your run starts in an hour", "<name> set time off", "A run needs a driver", "A run is still open for tomorrow".
- **The push payload shape is `{ route?, when?, who? }`, with `when` pre-formatted by the enqueuing service.** Nothing specifies what goes in `notification.payload`. Local wall-clock rendering needs `app_config.timezone`, which the enqueuing service has and dispatch does not, so formatting was pushed to the writer. This is also a **stored shape**.
- **Deep-link URLs are `/shifts/:id`, falling back to `/inbox`.** S1.9 says "tap to act (deep-links to the relevant shift)" but no doc fixes client paths, and `client/src/app/**` is the surface lane's. If that lane chose different paths, the fix is one line in `renderPush()` — the URL is rendered at dispatch, not stored.
- **Retry numbers: 5 attempts over 0/1/5/15/60 minutes; sweep every 60 s; batch of 50.** §4.4 says "retry with backoff, give up after a cap" and fixes no values. 60 s matches the reminder/at-risk sweep cadence the same section does fix.
- **A notification for a recipient with no live registration burns its attempts and is then dropped by dispatch.** The row stays in the inbox, which is the source of truth, so nothing is lost; the alternative (leave it pending forever) would push an alert at someone the moment they first enable push, about a run that may be over. Not addressed by any doc.
- **Only `410` revokes.** §4.4 names `410 Gone` and nothing else, so `404` — which push gateways also use for a dead endpoint — takes the ordinary retry-then-give-up path rather than being treated as gone. Chosen to avoid widening a documented rule.
- **A missing VAPID environment degrades dispatch to a logged no-op** rather than failing process start. `.env.example` carries the keys and this lane may not edit it; the inbox remains the source of truth, so an unconfigured box loses the alerting layer and nothing else. Never logged with a key value (§5.4: VAPID private keys are credentials).

**Unblocked:**
- Wave 2/3 business services can write notifications: call `enqueueNotification(tx, …)` inside the transaction that makes the change, then `dispatchNow()` after it commits. The sweep makes that second call optional.
- Wave 2 can register the expired-session cleanup job: one line in `server/src/jobs/registry.ts` pointing at `purgeExpiredSessions()`; `scheduler.ts` does not change.
- Wave 3 can add the recurrence, reminder and at-risk sweeps the same way. The reminder and at-risk sweeps are the two events `uq_notif_shift_event` protects, so they can be written as "find what is due and unsent" without a pre-check.
- Wave 2's PWA onboarding can store registrations in `push_subscription`; dispatch picks up any live row for a user with no further wiring.
- The lead can add `startScheduler()` to `server/src/index.ts` once the identity lane merges.
