# Wave 2 — masters

**Status:** complete

**Built:**
- `donor` CRUD (cap 2): list/get/create/edit, §3.3 ACTIVE ⇄ DEACTIVATED toggle, I21 removal.
- `truck` CRUD (cap 3): same shape, §3.3 ACTIVE ⇄ INACTIVE, I21 removal, I22 asserted (no exclusivity).
- `category` CRUD (cap 17, build-plan D2): add / rename / archive (§3.3 ACTIVE ⇄ ARCHIVED) / I21 removal.
- One "has referencing history" predicate per entity — `donorHasHistory()`, `truckHasHistory()`,
  `categoryHasHistory()` (build-plan D3) — each the sole place that question is asked.
- 15 HTTP routes, every one declaring a tier: reads `{ tier: 'VOLUNTEER' }`, writes `{ tier: 'ADMIN' }`.
- `shared/src/masters.ts`: `DonorSummary` / `TruckSummary` / `CategorySummary`, their create+update
  requests, and `RemovalOutcome` / `RemoveMasterResponse`.

**Files:**
- `shared/src/masters.ts`
- `server/src/services/donor.ts`, `server/src/services/truck.ts`, `server/src/services/category.ts`
- `server/src/routes/donors.ts`, `server/src/routes/trucks.ts`, `server/src/routes/categories.ts`
- `server/test/masters-donor.test.ts`, `server/test/masters-truck.test.ts`,
  `server/test/masters-category.test.ts`, `server/test/masters-api.test.ts`
- `reports/2-masters.md`

Nothing outside the declared ownership was touched. Specifically **not** edited:
`server/src/routes/index.ts` (this wave's shared seam — the lead adds three imports and three
spreads at merge: `donorRoutes`, `truckRoutes`, `categoryRoutes`), `shared/src/index.ts` (the `pwa`
lane's — the lead adds `export * from './masters.js'` at merge), `package.json`,
`server/migrations/`, `server/src/db/types.ts`.

**Invariants:**
- **I21** — tier 3 (service) for the branch and the outcome, tier 1 (DDL) for correctness. Every
  master's removal calls its one `*HasHistory()` predicate: history → set `deactivated_at`, no
  history → real `DELETE`, which the blanket `ON DELETE RESTRICT` (`data-model.md §0`) is the actual
  guard on. A `23503` from the residual race is mapped to a 409, not a 500. Field edits are allowed
  on a deactivated row, tested for all three entities. Active-only reads filter
  `WHERE deactivated_at IS NULL` (`ix_donor_active` / `ix_truck_active` / `ix_category_active`).
- **I22** — tier 3 by *absence*: no code path ties a truck to a time window. Asserted positively —
  two concurrent `IN_PROGRESS` shifts hold the same truck and both succeed.
- **I1** — tier 3 (gate): every route declaration goes through `tierAtLeast`, never equality, so
  Admin passes a Volunteer read requirement.
- **I8** (tier 1, `ck_shift_truck`) is leaned on by the truck fixtures, not enforced here.

PII: donor `address` and `contact` go out whole, to every signed-in tier. `pii.ts` is untouched and
the API test asserts a Volunteer sees both.

**Tests:** 180 passing / 0 failing — `./scripts/test-db.sh && DATABASE_URL=<printed by that script>
npx vitest run --root server`. 44 of those are this lane's (`npx vitest run --root server masters`).
Typecheck clean: `npx tsc --noEmit`.

**Deliberately not done:**
- **No route registration.** `server/src/routes/index.ts` is the wave's shared seam; the API test
  builds `buildRouter([...authRoutes, ...donorRoutes, ...truckRoutes, ...categoryRoutes])` directly,
  which exercises the real default-deny gate. Until the lead adds the lines, these routes are
  unreachable from the mounted app.
- **No seed of the 11 AGFP categories.** Cap 17 says "seeded with the 11 AGFP categories at launch";
  a seed is either a migration (lead-owned) or an ops step (`architecture.md §5`), and neither is
  this lane's file. The names are listed in `masters-category.test.ts` so the seed has a source.
- **No name-uniqueness check** on donor, truck, or category. No invariant asks for one and
  `data-model.md §4` declares no unique constraint on any of the three; inventing an app-level one
  would be a domain rule this lane made up.
- **No Phase-2 tables referenced.** `weight_entry` and `unscheduled_donation` (`data-model.md §7`)
  are deferred by D3; `categoryHasHistory()` names them in a comment as the two lines Phase 2 adds.
- **No client screens.** S1.8 is a Wave-4 lane; this is the API it will call.
- **`doc-qa` not run by this lane** — the Agent tool is not available inside a lane worktree, so it
  cannot spawn one. It is gate step 2 (§5.2) and the lead runs it over the merged diff.

**Assumed:**
- `ui-ux-spec.md S1.8` says of the Categories tab: "add, archive (no hard delete — archived
  categories are hidden from the S2.2 weight-entry keypad but preserved in history/reports)". I21
  (locked) says "Donor / Category / Truck / User: soft-delete (deactivate) if any referencing
  history, else hard-delete OK". I resolved in favour of the locked doc and exposed
  `DELETE /categories/:id`, which follows I21 exactly. Consequence to be aware of: in Phase 1 **no
  table references `category` at all**, so that endpoint always hard-deletes today. The archive
  action S1.8 describes is `PATCH /categories/:id { active: false }`, and the Wave-4 Categories tab
  should offer only that. If the intent was that a category may *never* be hard-deleted, the DELETE
  route and `removeCategory()` should be dropped — that is a one-file change, and it is the reading
  S1.8 supports.
- `domain-modeling.md §3.3` gives each master a two-way toggle (ACTIVE ⇄ DEACTIVATED / INACTIVE /
  ARCHIVED) but no doc says which endpoint performs it or that a restore exists. I made `active` a
  field on `PATCH`, so archive is `{ active: false }` and restore is `{ active: true }`, on the
  reading that "⇄" means the return trip is reachable. There is no separate deactivate endpoint:
  `DELETE` is the removal verb and I21 decides what removal means.
- Read tier for all three lists is `{ tier: 'VOLUNTEER' }` (any signed-in user). `product-requirement.md
  §2` states only what Volunteers *cannot* do — "create/delete donors" — and drivers need the donor
  address and contact and the truck picker, so I read the write-side prohibition as not implying a
  read-side one. Categories have no Phase-1 reader at all; I did not gate them on the RECEIVE duty
  because that would be a rule invented for a caller that does not exist until Phase 2.
- Write tier is `{ tier: 'ADMIN' }` for all three, from §2's Admin-only delta ("donor & truck master
  data") plus cap 17's "Admin maintains the list". §2 does not name categories in the Staff
  "cannot" column; I treated cap 17's wording as decisive.
- List reads return the **active** set by default and the full set on `?includeInactive=true`. No
  doc specifies a default. I chose active-default because `data-model.md §0` describes active reads
  as the filtered ones and every picker is a read; the S1.8 admin list is the exception that asks.
- Blank/whitespace-only optional text (`address`, `contact`, `note`, `plate`) is stored as `NULL`,
  and a name that is only whitespace is a 400. The columns are nullable with no CHECK; no doc
  distinguishes `''` from `NULL`, and treating them as the same thing keeps "nothing on file" a
  single state.
- `PATCH` with no recognised field is a 400 ("Nothing to change.") rather than a no-op 200.
- Setting `active: false` on an already-deactivated master does not restamp `deactivated_at`; the
  original instant is kept. Same for `DELETE` landing on the soft branch.

**Unblocked:**
- The scheduling lane can bind routes to real donors and shifts to real trucks through the service
  layer instead of fixtures.
- Wave 4's S1.8 Donors / Trucks / Categories tabs have their complete API, including the archived
  set (`?includeInactive=true`) and the removal outcome the screen must report.
- Phase 2's weight entry has `GET /categories` for the S2.2 keypad tile set, and the one-line
  extension points for `weight_entry` / `unscheduled_donation` in `donorHasHistory()` and
  `categoryHasHistory()`.
- **The lead must, at merge:** add `export * from './masters.js'` to `shared/src/index.ts`, and add
  `donorRoutes` / `truckRoutes` / `categoryRoutes` to `server/src/routes/index.ts`. Until then the
  routes exist but are not mounted.
