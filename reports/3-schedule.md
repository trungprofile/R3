# Wave 3 — schedule

**Status:** complete

**Built:**
- `createShift` — publish a one-off run: `OPEN`, no owner, no truck (I4, I8, cap 4), route archived/empty guarded, `real_conflict` surfaced as a soft warning.
- `updateShift` — §5.3 `edit-one` (staff note, PRD cap 11 channel 1); touches no pattern (I23).
- `rescheduleShift` — cap 9 / S1.7: owner kept by default, I20's two overlap clauses surfaced as a 409 `RESCHEDULE_CONFLICT`, `confirmRelease` moves the run and releases the owner, `SHIFT_OPENED` fanned out to Coordinator + eligible drivers.
- `cancelShift` / `bulkTerminate` — `OPEN|CLAIMED → CANCELLED` by conditional predicate (I9, I10); both clear `owner_id` **and** `assigned_over_conflict` in one statement.
- `listShifts` / `getShift` — the S1.2 board query, cancelled runs off it unless asked for; planned stops read from the route (I5).
- `createPattern` / `updatePattern` / `getPattern` / `listPatterns` — I24's explicit pattern-level edit is the only write to `recurrence_pattern` after creation.
- `materializeIn` / `materializePattern` / `materializeDuePatterns` — §5.3 eager-to-horizon, `eligible()` gated per instance (I25), `ON CONFLICT DO NOTHING` on `uq_shift_occurrence`.
- `materializationJob` — the daily catch-up sweep, exported not registered (lead owns `jobs/registry.ts`).
- `routes/shifts.ts` — 11 routes, every one declaring a tier.
- **Corrections to the inherited code** (see *Deliberately not done* for the fifth, which I left alone):
  1. **`startDate` removed from pattern create.** It could only be honoured at create time — there is no `start_date` column (`data-model.md §5.2`) and the rolling sweep asks the database "which occurrences in range have no row?", so the next nightly pass back-filled every date the create had skipped. A pattern created for September put August runs on the board the following morning. See `Assumed:`.
  2. **`updatePattern` did not surface duplicates.** `data-model.md §5.3` surfaces `real_conflict` at pattern create **and edit**; only create had it. Added `duplicates` to `UpdatePatternResult`/`UpdatePatternResponse` and factored the check into one `findDuplicates`.
  3. **`applyToFutureInstances` miscounted `moved`.** It incremented per loop iteration, not per row actually updated, so an instance claimed between the read and the conditional UPDATE was reported as moved when it had not been. Now reads `numUpdatedRows` and reclassifies the row into `ownedInstances`.
  4. **Dead export `nextDay` removed** from `schedule.ts`, along with its now-unused `addDays` import. Its comment claimed the recurrence service and its tests used it; nothing did.

**Files:**
- `server/src/services/schedule.ts` (inherited, corrected)
- `server/src/services/recurrence.ts` (inherited, corrected)
- `server/src/jobs/materialization.ts` (inherited, unchanged)
- `shared/src/schedule.ts` (inherited, corrected)
- `server/src/routes/shifts.ts` (new)
- `server/test/schedule-service.test.ts` (new)
- `server/test/schedule-api.test.ts` (new)
- `server/test/recurrence-materialization.test.ts` (new)

Nothing outside this list is touched. `routes/index.ts`, `shared/src/index.ts` and `jobs/registry.ts` are untouched as instructed, so the route module and the job are exported and await the lead's registration.

**Invariants:**
- **I25** — tier 3 (service). `eligible()` per instance before the insert, both directions tested: born `CLAIMED` when `ownerDefault` is set and eligible; born `OPEN` when the default is absent, deactivated, lacks the Drive duty, is blocked by an `AvailabilityBlock`, or already owns an overlapping run.
- **I23 / I24** — tier 3. Enforced structurally: `services/schedule.ts` never names `recurrence_pattern`, and `updatePattern` is the sole writer. Tested by snapshotting the whole pattern row across edit-one, cancel and bulk-terminate.
- **I9 / I10** — tier 2 (conditional-UPDATE predicate, `data-model.md §9`). `WHERE status IN ('OPEN','CLAIMED')` is the optimistic check; `rowcount = 0` becomes a 409 sentence rather than a constraint violation.
- **I20** — tier 3, at two of its call sites here: materialization's born-CLAIMED gate, and the reschedule conflict list. Staff-assign's exemption is the coverage lane's.
- **I4, I5, I8** — tier 1 (`ck_shift_truck`, FK) plus the service refusing to publish against an archived or empty route.
- **`ck_shift_conflict_flag`** — tier 1. Both owner-clearing statements (cancel, bulk-terminate) and the cap-9 release set `assigned_over_conflict = false` in the same UPDATE.
- **I26** — tier 1 (NOT NULL). A minted shift's `created_by` is the pattern author; there is no system user.
- **I21** — an archived route is refused for new scheduling; a deactivated `ownerDefault` stops minting born-CLAIMED runs (`§5.2`'s first conjunct).
- **§4.3 default-deny** — every route declares a tier. The board is `VOLUNTEER`, every mutation is `STAFF`; both an undeclared path and a declared path under the wrong method are tested to 403 `UNDECLARED_ROUTE`.

**Tests:** 66 passing / 0 failing in this lane; 356 passing / 0 failing across the suite —
`./scripts/test-db.sh && npx vitest run --root server`. Full mechanical gate green: `./scripts/gate.sh` exits 0.

**Deliberately not done:**
- **Claim, staff-assign, release-one, release-range** — cap 6 and the driver half of cap 8, owned by the sibling `coverage` lane. Nothing here sets an owner except cap 9's confirmed release.
- **Registration of the route module and the job** — `routes/index.ts` and `jobs/registry.ts` are lead-owned seams this wave. Tests build the router with `buildRouter(shiftRoutes)` and call `materializationJob.run()` directly.
- **Any path to `COMPLETED`** — build-plan D1. No close-run action, no auto-complete.
- **The `SweepResult.failed` branch is not exercised.** I could not induce a genuine per-pattern failure without a mock or a schema change: `ck_rp_weekdays`, `ck_rp_window` and the FK RESTRICTs make every reachable pattern row materializable. The test asserts the sweep visits every pattern and that a transaction-per-pattern boundary exists; the recovery path is defensive code covered only by reading.
- **Inherited behaviour I reviewed and deliberately left alone:** `updateShift` will set a staff note on a `CANCELLED` run. No doc forbids editing a note on a terminal shift, I21 says field edits are always allowed, and adding a status gate would be inventing a rule.

**Assumed:**
- **A pattern has no start date; a series begins when it is created.** `domain-modeling.md §5.3` (locked) gives the rule three parts — weekly on {days}, time-of-day, route — plus `ownerDefault` and `endDate`, states `endDate` as the *only* stop condition, and writes the loop as `for each occurrence date D in [now, horizon]`. `data-model.md §5.2` has no `start_date` column. But `ui-ux-spec.md S1.6` says the recurring builder reads "Every Tuesday, **starting __**, no end". I resolved by the authority order — locked doc first, UI spec last — and read S1.6's "starting __" as the sentence naming when the series begins, which for an eagerly-materialized pattern created now is today. **This removed a field the previous agent had already put on the wire.** If the human intends an arbitrary future start date, it needs a `start_date` column and a migration, and this is a lead-owned change I could not make.
- **`GET /shifts` and `GET /shifts/:id` are declared `{ tier: 'VOLUNTEER' }` — any signed-in user, no duty required.** Cap 5 says "all drivers see every shift", which would suggest `anyDuty: ['DRIVE']`, but that would lock out a Staff coordinator who does not hold the Drive duty, and tier never confers a duty. A receive-only volunteer can therefore read the board. I judged that harmless because names are public-within-org (`product-requirement.md §2`) and the shape carries no phone or address. The docs do not answer who may read the board other than drivers.
- **Materialization does not send `SHIFT_ASSIGNED` for a born-CLAIMED instance.** The matrix's row is "Shift assigned / defaulted to you → the owning driver, trigger: event". I read the event as the moment `ownerDefault` is set (claim-all / staff-assign, the coverage lane), not the nightly mint of a run a year out — otherwise every pattern pushes its owner once a day forever. Inherited behaviour, left as-is, but the docs do not settle it and the opposite reading is defensible.
- **Reschedule checks I20's two overlap clauses, not the full `eligible()`.** Cap 9 names only "conflict with that driver's declared availability"; the code also reports an overlapping owned run (I20's other half, strictly more conservative). It does **not** re-check the Drive duty or the active flag, on the reading that moving a run is not re-assigning it. So rescheduling a run whose owner was since deactivated keeps them on it.
- **`createShift` surfaces `real_conflict` for a one-off too.** `data-model.md §5.3` says it is "surfaced **only** at pattern create/edit (staff present)". I read the "only" as excluding the rolling job rather than excluding one-off publishing, since a one-off publish is exactly the staff-present case the rule is justified by. Inherited behaviour, kept.
- **An occurrence whose window has already begun is not minted.** §5.3's lower bound is `[now, horizon]`; the sweep skips a today-occurrence whose start instant has passed, so it never mints a run that reads as `MISSED` the moment it exists. Idempotency is unaffected. Inherited behaviour, kept, and not stated by any doc.
- **Route paths are `/shifts` and `/patterns`**, and reschedule and bulk-terminate are `POST /shifts/:id/reschedule` and `POST /patterns/:id/terminate`. No doc specifies URL shapes; `/routes` was already taken by the route-template module.
- **`doc-qa` was not run by this lane.** The `Agent` tool is not available inside a lane agent, so I could not spawn it. Build-plan §5.2 makes `doc-qa` over the cumulative diff the lead's half of the gate, so this is where it was going to run anyway — but `CLAUDE.md`'s pre-commit instruction is unmet for this commit and the lead should treat the whole diff as unreviewed by it.

**Unblocked:**
- **`coverage`** now has everything it needs to claim against: `OPEN` shifts from `createShift`, born-`OPEN`/born-`CLAIMED` instances from materialization, and `recurrence_pattern.owner_default_id` sitting unset for `claim-all` to fill. `bulkTerminate` is the staff counterpart its `release-range` must not be confused with.
- **Wave 4's `S1.2`** can be built against `GET /shifts` with the Mine/Open/window/pattern filters and the `recurrencePatternId` tag; **`S1.6`** against `POST /shifts`, `POST /patterns`, `PATCH /patterns/:id` and the terminate endpoint; **`S1.7`** against `POST /shifts/:id/reschedule` and its `RESCHEDULE_CONFLICT` envelope, whose copy is already built in `shared/` so the client cannot word it differently.
- **The lead** must add `shiftRoutes` to `routes/index.ts` and `materializationJob` to `jobs/registry.ts`; neither is wired, so nothing in this lane is reachable over HTTP or on a timer until then.
