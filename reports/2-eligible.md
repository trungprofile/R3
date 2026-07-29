# Wave 2 — eligible

**Status:** complete

**Built:**
- `services/eligibility.ts` — `eligible()` per `domain-modeling.md §5.2`, standalone, consumed by nothing yet. Four entry points over one predicate: `overlaps()` (the pure half-open arithmetic), `evaluateEligibility()` (all three clauses plus the reasons), `eligible()` (the boolean gate), and `eligibleDriverIds()` (the fan-out set as one query).
- `services/eligibility.ts` — `conflictingOwnedShifts()` and `conflictingAvailabilityBlocks()`, the two clauses as separately callable predicates, because §5.2's availability-declaration call site asks only the first of them.
- Every function takes a Kysely handle (`Reader`) rather than reaching for the global `db`, so a gate inside a `writeTransaction` reads in its own transaction — a tier-3 gate whose read sits outside the write is decoration (`architecture.md §4.1`).
- `services/availability.ts` — `declareAvailability()` (the I20 declaration gate, pantry-local expansion, insert, and the coordinator notification, in one SERIALIZABLE transaction), `withdrawAvailability()`, `listAvailability()`, plus `expandDeclaration()` / `localToInstant()` / `declarationConflicts()` as separately testable and previewable pieces.
- Pantry-local time resolution with **no dependency added**: `Intl.DateTimeFormat` plus a two-pass offset correction, so a whole-day range across the DST fall-back is 49 hours and a clock window holds its wall time on both sides of the change.
- `routes/availability.ts` — `GET /availability` (own, or a driver's for Staff+), `POST /availability` (DRIVE duty), `DELETE /availability/:id`. Each declares its access; refusal of a conflicting declaration is 409 carrying the runs in the way and `ui-ux-spec.md S1.4`'s two error strings verbatim.
- `shared/src/availability.ts` — request/response shapes, the two S1.4 strings as constants, and the eligibility reason vocabulary Wave 3's staff-assign warning needs on the wire.

**Files:**
`server/src/services/eligibility.ts`, `server/src/services/availability.ts`,
`server/src/routes/availability.ts`, `shared/src/availability.ts`,
`server/test/eligible-overlap.test.ts`, `server/test/eligible-driver.test.ts`,
`server/test/availability-declare.test.ts`, `server/test/availability-routes.test.ts`,
`reports/2-eligible.md`.
Nothing outside the lane's declared ownership was touched. `server/src/routes/index.ts`, `shared/src/index.ts`, `server/migrations/`, `server/src/db/types.ts` and every `package.json` are unmodified — verified by `git status`.

**Invariants:**
- **I20** — tier 3 (`architecture.md §4.1`), at two of its five call sites. `eligible()` is the predicate itself; `declareAvailability()` is the declaration gate, which **rejects** and never auto-releases, so "an owned shift never overlaps availability" holds by construction on both sides. The read is taken inside the write transaction and the transaction is SERIALIZABLE, which is what closes the write-skew case §4.1 names.
- **I19** — tier 1 as DDL (`ck_ab_window`, and the absence of any `route_id`), consumed here as a pure temporal overlap with no route scope anywhere in the query.
- **I2** — set membership, twice: the Drive-duty clause of `eligible()`, and the route-layer `anyDuty: ['DRIVE']` gate on POST/DELETE. A test asserts a Staff-tier user *without* the duty is refused, because tier substituting for duty is the easy bug.
- **I1** — hierarchical, twice: reading another user's availability requires `tierAtLeast(actor.tier, 'STAFF')`, and the coordinator recipient set is `TIERS.filter(tierAtLeast(_, 'STAFF'))` rather than a written-out list, so Admin cannot be dropped by an equality test.
- **I21** — relied on, not enforced here: a deactivated account is treated as ineligible and excluded from the fan-out set ("hidden from new use"). See `Assumed:`.
- **I9** — read, not enforced here: an `IN_PROGRESS` conflict is reported as `releasable: false` with S1.4's second string, because "release it first" is advice the driver cannot take.
- **Default-deny** (`architecture.md §4.3`) — every route declares `access`; a test registers an undeclared handler on `buildRouter(availabilityRoutes)` and asserts 403 with the handler never reached.
- **Build-plan D1** — an old `IN_PROGRESS` run stays in I20's counted set forever and keeps excluding its driver. There is a test named for it so that nobody later "fixes" it.

**Tests:** 187 passing / 0 failing (51 new in this lane, 136 pre-existing) —
`./scripts/test-db.sh && DATABASE_URL=<the url it prints> npx vitest run --root server`. `./scripts/gate.sh` exits 0 (migrations, typecheck server + client, suite, no stubs, `types.ts` matches the database).

The overlap matrix is a table of 19 named cases — touching-but-not-overlapping at each end, one millisecond either side of each boundary, identical windows, containment in both directions, shared start/end instants, and same-clock-time-wrong-day — and every row is asserted **four** ways: the pure predicate (in both argument orders), the AvailabilityBlock SQL, the owned-shift SQL, and the NOT EXISTS fan-out query. The fan-out clause is a deliberate second expression of the same rule; driving both from one table is what stops them drifting.

**Deliberately not done:**
- **The other three call sites.** Claim, staff-assign, and materialization are Wave 3 and Coverage stays single-owner (`§2`). `eligible()` is shaped so each can use it unchanged: `evaluateEligibility` returns reasons for the advisory staff-assign path, `shift.id` is optional so materialization can ask before the row exists, and `eligibleDriverIds` answers the fan-out as a set.
- `server/src/routes/index.ts` — this wave's shared seam; not edited. The lead adds `import { availabilityRoutes }` and `...availabilityRoutes`. Routes are proven through `buildRouter(availabilityRoutes)`, which is the same gate.
- `shared/src/index.ts` — the `pwa` lane's; not edited. Server code imports `shared/src/availability.ts` by relative path (open assumption A34). The lead adds the re-export at merge.
- **No migration, and no conflict-flag column.** I20's staff-assign path needs the shift flagged so the driver sees the banner (`S1.3`), and `0004`'s `shift` has no such column — known to the lead and owed before Wave 3. Staff-assign is not in this lane, so nothing here needs it and nothing here invents it.
- No eligibility-preview endpoint for the staff-assign warning: that route belongs to the wave that builds assignment. `evaluateEligibility` and `declarationConflicts` are exported and ready for it.
- No S1.4 screen (Wave 4), and no `client/` file touched.
- Blocks are not merged, split, or normalized, and none of the other four notification events are enqueued from here.
- **The `doc-qa` agent was not run: this lane's toolset has no Agent tool, so it cannot spawn one.** The checks were done by hand against `domain-modeling.md §5.2`/§5.3/I19/I20/I21/I9, `product-requirement.md` caps 7–9 and the §4 notification matrix, `architecture.md §4.1`/§4.3, `data-model.md §10`/§9, and `ui-ux-spec.md S1.4`/S1.6. **The lead must still run `doc-qa` over the merged diff (§5.2); this self-review does not substitute for it.**

**Assumed:**
- **A deactivated account is ineligible.** §5.2's predicate names only the Drive duty, so this clause is mine: I21 makes a soft-deleted user "hidden from new use", and putting one in the notification fan-out would alert an account that was removed. Reported as its own reason (`DEACTIVATED`), so it is one line to drop if the locked doc is meant to be read literally.
- **Availability is declared as pantry-local calendar dates and clock times, and the server does the conversion.** §5.2 says the window is "pantry-local", `app_config.timezone` is the pantry's zone, and a driver's phone may be in another one — so the API takes `fromDate`/`toDate` (`YYYY-MM-DD`) and optional `startTime`/`endTime` (`HH:MM`), never instants. No doc states the request shape.
- **Local-to-instant conversion is `Intl.DateTimeFormat` with a two-pass offset correction**, because no dependency may be added. A local time that does not exist (the spring-forward gap) resolves to the instant the clock jumped to; one that happens twice resolves to the first. No doc states either behavior. *Wave 3's materialization needs the same conversion (`architecture.md`: "converts local rule times → instants DST-aware"); it currently lives inside `services/availability.ts` and the lead may want it hoisted rather than written twice.*
- **A `WINDOW` declaration must be intra-day (`endTime` strictly after `startTime`); an overnight absence is expressed as a `DATES` range.** `domain-modeling.md §5.3` states intra-day for *recurrence* windows, not for availability; I applied the same reading.
- **A `DATES` declaration is stored as ONE contiguous block** — local midnight on `fromDate` to local midnight on the day after `toDate` — rather than one row per day. `WINDOW` is one row per date, because a repeated clock window genuinely is not contiguous. No doc says which.
- **A single declaration may span at most `app_config.horizon_days` days** (365 by default). No doc bounds it; the horizon is the point beyond which no shift row exists to conflict with, and an unbounded `WINDOW` expands to one row per day forever.
- **Duplicate and overlapping blocks for the same driver are allowed and never merged**, and **past-dated blocks are accepted**. Eligibility reads the union, so neither changes an answer.
- **Withdrawal is a hard delete and owner-only.** I21's soft-delete rule enumerates Donor / Category / Truck / User; nothing references `availability_block`, so there is no history to preserve. No doc gives Staff a declare-on-behalf or withdraw-on-behalf action, so neither exists — a driver is always the subject of their own declaration.
- **Reading another user's availability requires tier >= STAFF** (`product-requirement.md §2`: Staff sees "operational status across all volunteers (availability, assignments…)"), enforced in the service because it needs the row's owner. Declaring and withdrawing require the DRIVE duty at the route layer.
- **`UNAVAILABILITY_DECLARED` goes to every active user with tier >= STAFF, one row per declaration** (not per block, and never with a subject shift). The matrix says "Coordinator (Staff) only"; there is no "the coordinator" as a single named account anywhere in the schema.
- **Withdrawing availability sends nothing.** The §4 matrix has a row for setting unavailability and none for clearing it, and I read the matrix as closed.
- **HTTP shapes are mine** — `POST /api/availability` → 201 with the created blocks, `GET /api/availability?userId=` , `DELETE /api/availability/:id` → 204, and 409 `AVAILABILITY_CONFLICT` carrying `conflicts[]` plus S1.4's sentence as `message`. No doc specifies endpoints.
- **Server code imports `shared/src/availability.ts` by relative path, not as `@r3/shared`** — the Wave-1 A34 reason, unchanged: inside a worktree `node_modules/@r3/shared` resolves to the main checkout's file.

**Unblocked:**
- **Claim (Wave 3)** — `eligible(tx, driverId, { id, startsAt, endsAt })` inside the claim transaction, immediately before `data-model.md §9`'s conditional UPDATE. It reads in that transaction, so SERIALIZABLE covers the double-tap case.
- **Materialization (Wave 3)** — `eligible(tx, pattern.owner_default_id, { startsAt, endsAt })` with no `id`, evaluated per instance before the insert, which is exactly I25's born-CLAIMED gate.
- **Staff-assign (Wave 3)** — `evaluateEligibility()` returns `reasons`, `conflictingShiftIds` and `conflictingBlockIds`, which is everything S1.6's "Karen marked herself away then — assign anyway?" needs. It is advisory; nothing here blocks it. Still needs the lead's conflict-flag column before the driver can see the banner.
- **Claim-all / release-range (Wave 3)** — the per-instance skip and S1.2's "Claimed 10 of 12 — 2 skipped" summary come from calling `evaluateEligibility` per instance.
- **Notification fan-out (Wave 3)** — `eligibleDriverIds(db, shift)` is the `SHIFT_OPENED` and `SHIFT_AT_RISK` recipient set, computed at send time as the PRD requires.
- **Reschedule (Wave 3)** — `conflictingOwnedShifts(reader, ownerId, newWindow, { excludeShiftId })` is cap 9's "surface any conflict before Staff confirms".
- **S1.4 (Wave 4)** — the three routes and their shapes exist; `declarationConflicts()` is exported so the screen can preview the refusal before Save.
- **Two one-line merges the lead owns:** `...availabilityRoutes` in `server/src/routes/index.ts`, and a re-export of `shared/src/availability.ts` from `shared/src/index.ts`.
