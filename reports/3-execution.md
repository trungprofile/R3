# Wave 3 — execution

**Status:** complete

**Built:**
- `startRun` — `CLAIMED → IN_PROGRESS` as `data-model.md §9`'s conditional UPDATE, truck picked in the same statement (I8), route snapshotted into `ShiftStop` rows in the same transaction (I5).
- `resolveStop` / `setStopNote` — the driver's check-off and skip (`domain-modeling.md §3.2`'s two driver edges, both out of `PENDING`) plus the driver→receiver note (cap 11, channel 2).
- `reorderStops` — S1.5's drag reorder; writes `position` only, so check state survives (deferred `uq_shift_stop_position`).
- `setRunNote` — `Shift.note`, the driver's whole-run remark (cap 11, channel 3), stamped last-writer (I26).
- `completePickup` — the I27 handoff: cross-row gate, `pickup_completed_at` set, shift state deliberately untouched.
- `reassignStop` — I30 mid-run reassignment as close-old + insert-new, staff-only.
- `getRun` — the run as one payload for S1.5 (owner) and S1.3 (staff).
- `sendDueShiftReminders` + `shiftReminderJob` — the 1-hour reminder catch-up sweep (§4.4), enqueued through the existing outbox.
- `executionRoutes` — 8 routes, each declaring a tier/duty requirement.

**Files:**
- `shared/src/execution.ts`
- `server/src/services/execution.ts`
- `server/src/routes/execution.ts`
- `server/src/jobs/reminder.ts`
- `server/test/execution-start.test.ts`
- `server/test/execution-stops.test.ts`
- `server/test/execution-handoff.test.ts`
- `server/test/execution-reminder.test.ts`
- `server/test/execution-api.test.ts`

No file outside this lane's declared ownership was touched. `routes/index.ts`, `jobs/registry.ts`, `shared/src/index.ts`, `db/types.ts`, `package.json` and `server/migrations/` are untouched; no dependency added, no migration written.

**Invariants:**
- **I5** (tier 3) — the snapshot is taken at start, from the route template, once. Positions renumbered from 0; `donor_id` stays a live FK and no donor field is copied onto `shift_stop`. Asserted by a test that lists the row's columns.
- **I6** (tier 3) — editing the route after start never reaches the run; asserted by adding and deleting a `route_stop` under a started shift.
- **I8** (tier 1, `ck_shift_truck`) — truck and transition move in one UPDATE; the constraint is exercised directly by a fixture insert that must fail.
- **I21** (tier 3, at this call site) — a deactivated truck is refused at start ("hidden from new use"); a deactivated owner is skipped by the reminder sweep.
- **I26** (tier 1 columns, tier 3 write) — `updated_by` stamped on every write that touches the `shift` row.
- **I27** (tier 3) — gate is `{COLLECTED, SKIPPED, REASSIGNED}`; `status` is not in the UPDATE's SET list; idempotent on a second confirm.
- **I28** (tier 1, `uq_shift_stop_donor`; tier 3 pre-check) — the reassign destination is checked for the donor first so the refusal has a sentence, with the constraint behind it.
- **I30** (tier 3) — source → `REASSIGNED` (conditional on `PENDING`/`COLLECTED`), destination gets a new row appended `PENDING`; a test reads `shift_stop.shift_id` back to prove no in-place re-point.
- **I11 / build-plan D1** (by absence) — no transition into `COMPLETED` exists in this lane; a test greps the service source for a `COMPLETED` write, and two tests assert the run is still `IN_PROGRESS` after every stop is resolved and after the milestone is set.
- Tier-2 predicates used verbatim: start (`status='CLAIMED' AND owner_id=:me`), stop resolution (`disposition='PENDING'`), milestone (`pickup_completed_at IS NULL`), reassignment (`disposition IN ('PENDING','COLLECTED')`). `rowcount = 0` is the lost race in each.
- `architecture.md §4.1` — every write goes through `db/transaction.ts`; `jobs/reminder.ts` opens none and calls the service. §4.3 — all 8 routes declare access; duty gates are set membership, the reassign gate is hierarchical tier.

**Tests:** 58 passing / 0 failing — `./scripts/test-db.sh && npx vitest run --root server execution-`. Whole suite after this lane: 348 passing / 0 failing (`./scripts/gate.sh`, which passed all eight checks including migrations-to-empty, both typechecks, codegen drift and the `@r3/shared` alias check).

**Deliberately not done:**
- **The truck-inbound notification on `pickup_completed_at`.** I27's "Setting it triggers a Receiver notification" is, per PRD cap 10 and S1.5, the truck-inbound alert, and PRD §5 phases truck-inbound out of Phase 1 ("caps 1–11, 13 **minus truck-inbound**") into Phase 2 ("truck-inbound notification (reuses the Phase-1 notification mechanism)"); S1.9 repeats it ("truck inbound (tablet only, Phase 2)"). The event is correspondingly absent from `NOTIFICATION_EVENTS` in `services/notification.ts`, which this lane does not own. The milestone is written; nothing is enqueued. A test asserts the outbox is empty. **See the first `Assumed:` entry — the lane brief said to enqueue it.**
- Registering `shiftReminderJob` in `jobs/registry.ts` and `executionRoutes` in `routes/index.ts`, and re-exporting `shared/src/execution.ts` from `shared/src/index.ts` — three lead-owned seams this wave. Tests build the router with `buildRouter(executionRoutes)` and call `shiftReminderJob.run()` directly.
- `Shift.staff_note` authoring. It is the coordinator's channel, written from S1.3's staff view; the driver sees it read-only and this lane only reads it out.
- Phase 2 (D1/D3): receive-done, the `WEIGHED` projection, the I12 completion gate, `weight_entry`, and S1.5's "Flag ad-hoc pickup" (I14/I17).
- The at-risk sweep (the matrix's other time-triggered row) — not this lane's job file.
- **`doc-qa` was not run.** This lane's harness exposes no Agent tool, so the agent could not be spawned from inside the worktree. The mechanical gate is green; `doc-qa` over the cumulative diff remains the lead's half of §5.2.

**Assumed:**
- I27 says setting `pickup_completed_at` "triggers a Receiver notification", and the lane brief said to enqueue it through the existing service. Nothing is enqueued, because PRD cap 10 and `ui-ux-spec.md S1.5` both identify that notification as the **truck-inbound** alert, and PRD §5 puts truck-inbound in Phase 2 while Phase 1 is "caps 1–11, 13 minus truck-inbound". Enqueuing it would also require adding an event string to `services/notification.ts`, another lane's file, and a device-scoped recipient (`subscription_id`, receiver tablet) whose registration is a Phase-2 concern. The milestone write itself is unaffected.
- I27 states the gate as `{COLLECTED, SKIPPED}`; `domain-modeling.md §3.2`'s final bullet states the same gate as `{COLLECTED, SKIPPED, REASSIGNED}` and `data-model.md §6` agrees. Read as: a `REASSIGNED` stop counts as resolved for the milestone, since it is terminal and "excluded from this shift's completion gate". Implemented that way.
- The reminder sweep is bounded on **both** sides of now: a run that has already started gets no reminder. No doc says whether a sweep that missed the window should fire late; "your run starts in an hour" about a run that began two hours ago is false, and that run is already the reporting doc's NO_SHOW.
- The reminder sweep considers only `CLAIMED` shifts with an **active** owner. The matrix names "the owning driver"; an `IN_PROGRESS` run's driver is already on it, and a deactivated account cannot read an inbox (I21). Neither exclusion is stated by any doc.
- `resolveStop` succeeds without a write when the requested disposition already matches (double-tap on a flaky phone), refuses `COLLECTED → SKIPPED` (§3.2 gives that edge to the receiver), and offers no un-check: the ShiftStop machine has no edge back to `PENDING`. No doc addresses an undo.
- `reorderStops` requires `stopIds` to name every **non-`REASSIGNED`** stop of the run exactly once, and pushes `REASSIGNED` rows to the end of the numbering. S1.5 does not show a moved stop, so the driver's drag list cannot name it; no doc says what a reorder does with a reassigned row's `position`.
- A reassignment's **destination must be `IN_PROGRESS`**. `§3.2` says "another driver's shift already running **or about to run**" and S1.3's picker offers "any driver with an open or in-progress shift today", but I5 forbids `ShiftStop` rows before `IN_PROGRESS` — a stop appended to a not-yet-started run would be destroyed by that run's own snapshot at start. Refused with "That run has not started, so it has no stop list yet."
- A reassignment does **not** require the destination's owner to differ from the source's. `§3.2` says "another driver's shift"; nothing forbids two runs of one driver, and enforcing it would block a legitimate move.
- The new destination stop does **not** carry the source stop's `ShiftStop.note`. I30 specifies only "fresh `position`, `PENDING`"; the note describes a visit that did not happen.
- Stop-only writes (resolve, note, reorder, reassign) do **not** stamp `shift.updated_by`. `shift_stop` has no provenance columns and I26's last-writer is the `shift` row's; only writes that touch `shift` itself (start, run note, milestone) stamp it.
- `completePickup` is idempotent: a second confirm keeps the first timestamp and applies only the note. The milestone is the moment the driver said they were heading back, and there is one of those.
- `Shift.note` is writable only while the run is `IN_PROGRESS` (S1.5 and its review screen are the only places the doc puts it). Nothing says whether a driver may write it before start or after.
- `getRun` is readable by the run's owner or by Staff and above (S1.3 is a staff screen; PRD §2 gives Staff operational status across volunteers). No doc enumerates who may read a run.
- Endpoint paths and the refusal copy are this lane's: no foundation doc owns API shapes, and S1.5 hides the "Heading back" button rather than specifying a server refusal string. `PICKUP_INCOMPLETE_MESSAGE` is "Finish or skip every stop before you head back." — written to §7's rules (plain, second person, "run"/"stop"/"store", what-happened + what-to-do).
- Starting a run whose route has zero stops is permitted and produces an empty snapshot. `§2.2` says a route has 1..N stops, so it should be unreachable; no rule was invented to block it.

**Unblocked:**
- Wave 4's `S1.5` (driver pickup execution) and the stop-list half of `S1.3` — every read and write those screens need now exists behind declared routes.
- The lead's three one-line seams: `shiftReminderJob` into `jobs/registry.ts`, `executionRoutes` into `routes/index.ts`, `export * from './execution.js'` into `shared/src/index.ts`.
- Phase 2's receiver work has its precondition: runs that reach a resolved stop list and a `pickup_completed_at` handoff, with `WEIGHED`, the I12 gate and receive-done still unbuilt by design.
