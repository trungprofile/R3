# Wave 2 — routebuilder

**Status:** complete

**Built:**
- `services/pickup-route.ts` — the route template and its CRUD: `listRoutes`, `getRoute`, `createRoute`, `updateRoute`, `removeRoute`, `restoreRoute`, plus the `routeHasHistory()` predicate.
- **Order is the payload.** Callers submit donor ids *in visit order*; positions are assigned by the service, contiguous and ascending. A client cannot submit a sparse, colliding, negative or non-integer position, so `data-model.md §5.1`'s "contiguous; reorder renumbers" holds by construction rather than by validation.
- **Replace, don't patch.** A present `stops` list replaces the whole ordered set in one transaction — add, remove and the S1.6 drag-and-drop reorder are one save, which is what `uq_route_stop_position ... DEFERRABLE INITIALLY DEFERRED` exists for. Surviving stops are `UPDATE`d, not delete-and-reinsert, so a stop's identity is stable across a drag.
- Route lifecycle per `domain-modeling.md §3.3`: `DELETE` hard-deletes a route nothing has scheduled against and archives one that has (`deactivated_at`), reporting which happened; `POST /routes/:id/restore` is the other half of ACTIVE ⇄ ARCHIVED. Archived routes are hidden from the default list (the S1.6 picker) and returned only under `?includeArchived=true`.
- `routes/pickup-routes.ts` — six declarations, every one `{ tier: 'STAFF' }`, parse/declare/shape only.
- `shared/src/routes.ts` — `RouteSummary`, `RouteDetail`, `RouteStopSummary`, `CreateRouteRequest`, `UpdateRouteRequest`, `RemoveRouteResponse`. Imported by relative path, never as `@r3/shared` (A34).

**Files:**
- `server/src/services/pickup-route.ts`
- `server/src/routes/pickup-routes.ts`
- `shared/src/routes.ts`
- `server/test/routebuilder-service.test.ts`, `server/test/routebuilder-api.test.ts`
- `reports/2-routebuilder.md`

Nothing else. `routes/index.ts`, `shared/src/index.ts`, `test/fixtures.ts`, `server/migrations/`, `package.json` and the `masters` lane's donor files are untouched.

**Invariants:**
- **I28 (template side) — tier 1.** `uq_route_stop_donor` is the enforcement; the service pre-check exists only so a duplicated store reads as a sentence instead of a 23505. A test bypasses the service entirely and asserts the constraint still fires.
- **`domain-modeling.md §2.2` cardinality `Route : RouteStop = 1 : 1..N` — tier 3.** Cross-row, so no CHECK can express it; `createRoute` and `updateRoute` both refuse an empty list.
- **I6 — tier 3, by construction.** Nothing in this lane reads or writes `shift_stop`; the template edit path physically cannot reach a started shift's snapshot. Tested: a route reordered, a stop removed and another added, with the shift's `shift_stop` rows asserted byte-identical afterwards.
- **I21's "hidden from new use, preserved where referenced" — tier 3.** A deactivated donor cannot be *added* as a stop; a stop that already names one survives, reorders, and is flagged `donorActive: false` on the way out.
- **`domain-modeling.md §3.3` Route row (archive vs. hard-delete) — tier 3, with tier 1 as backstop.** `routeHasHistory()` is one function per entity (build-plan D3): `shift.route_id` ∨ `recurrence_pattern.route_id`. Every FK into `route` is `ON DELETE RESTRICT`, so a predicate narrower than the FK set fails loudly at the database rather than silently.
- **I4 is respected, not enforced here** — a shift binding a route is what makes the route un-deletable; this lane only reads that fact.
- **`architecture.md §4.1`** — every write goes through `db/transaction.ts` (SERIALIZABLE + 40001 retry); the routes layer opens nothing and holds no domain rule.
- **`architecture.md §4.3`** — six declarations, six `{ tier: 'STAFF' }`. Hierarchical, so Admin is admitted by the same declaration and never by a second one; tested against Volunteer (403), anonymous (401), Staff and Admin (200).
- **`CLAUDE.md` PII rule** — donor `name`/`address` pass through unshaped. `pii.ts` gates people, not places.

**Tests:** 171 passing / 0 failing across the whole suite (35 new in the two `routebuilder-*` files) — `./scripts/test-db.sh`, then `DATABASE_URL=<its output> npx vitest run --root server`. `npx tsc --noEmit` is clean.

The API suite builds its router with `buildRouter(pickupRouteRoutes)` rather than through `routes/index.ts` — this wave's shared seam, which no lane edits. That still exercises the real default-deny gate, including an `UNDECLARED_ROUTE` case on this router.

**Deliberately not done:**
- **No line in `routes/index.ts`.** Per the wave's instruction, the lead adds `import { pickupRouteRoutes } from './pickup-routes.js';` and `...pickupRouteRoutes,` at merge. Until then these endpoints are unreachable from the running app by design.
- **No re-export from `shared/src/index.ts`** — the `pwa` lane owns that file this wave. The lead adds `export * from './routes.js';` at merge.
- **No scheduling, recurrence, or materialization.** Wave 3. This lane builds the template and stops at its edge.
- **No `client/` work.** S1.6 is a Wave-4 screen; this lane ships the API it will call.
- **No route-level duty requirement.** Route building is a tier capability (cap 4, Staff), not a duty one; `drive` is about running a shift, not defining one.
- **No donor picker endpoint.** Listing donors to choose from is the `masters` lane's `GET /donors`.
- **`doc-qa` not run by this lane** — no Agent tool is available in a lane worktree. `phase-1-build-plan.md §5.2` assigns doc-qa over the merged diff to the lead. I re-read the diff against `domain-modeling.md §2.2/§2.3/§3.3/§4`, `data-model.md §5.1`, `architecture.md §4.1/§4.3`, PRD cap 4 / §2 and `ui-ux-spec.md S1.6/§6/§7` by hand instead; that is not a substitute for the gate.

**Assumed:**
- **`route_stop.position` is 0-based.** `data-model.md §5.1` says "contiguous" and never fixes the base. Chosen to match `test/fixtures.ts`'s `makeRoute()`, which is Wave-0-owned, already merged, and inserts `position: 0..n-1`. **This is a stored value**: if Wave 3's snapshot or any later query assumes 1-based, the two disagree silently rather than loudly.
- **Reading routes requires Staff.** PRD cap 4 gives Staff "defines/edits routes" and says nothing about who may *read* the template. No Volunteer surface needs it — S1.2 renders the route *name* off the shift, S1.5 renders stops off the shift's snapshot — so under default-deny I required `STAFF` on the reads too. If a driver screen later needs the template, that is a new, narrower declaration, not a relaxation of these.
- **A deactivated donor may stay on a route it is already on, but may not be added to one.** `domain-modeling.md §2.3` says a soft-deleted master is "hidden from new use; preserved everywhere referenced" and the docs never say which side of that line a route template falls on. I read a *new stop* as new use and an *existing stop* as a reference to preserve — so a route whose store closed keeps rendering it, flagged, until staff swaps it out, rather than silently shortening a planned run.
- **`routeHasHistory()` counts `shift` and `recurrence_pattern`, and deliberately excludes `route_stop`.** The stops are the route's own body, not a record of it having been used; excluding them is what makes "hard-delete a route created by mistake" possible at all. `removeRoute` deletes the stop rows itself in the hard-delete branch.
- **Removal is exposed as `DELETE` returning `{ outcome: 'DELETED' | 'ARCHIVED' }`, plus `POST /:id/restore`.** There is deliberately no separate "archive" endpoint — one action, the domain decides which branch, mirroring `removeUser`'s precedent. If S1.6 wants an explicit *Archive* button on a route that has no history yet, it cannot get one without a new endpoint.
- **`PATCH /routes/:id` with `stops` present replaces the entire ordered list.** No add-one/remove-one/move-one endpoints exist. Nothing in the docs specifies the wire shape; this one makes "contiguous" unfalsifiable and matches how a drag-and-drop surface saves.
- **Route names are not unique and not checked.** No doc asks for it, and no other master data in this schema does. Two routes may share a name.
- **Malformed uuids answer 404, not 500.** Postgres raises 22P02 on an unparseable uuid, which would surface as an unhandled 500; an id that cannot exist is treated as one that does not. Existing identity routes do not do this, so the two now differ in behavior on a garbage id.
- **The I6 test inserts `shift_stop` rows directly.** No fixture-factory builder exists for a snapshot and this lane may not add one to the shared factory, so the test arranges the precondition by hand. No production code in this lane reads or writes `shift` or `shift_stop`.
- **Error copy is this lane's.** Written to `ui-ux-spec.md §6/§7` (plain, second person, "store" not "donor", no forbidden term, what-happened + what-to-do) but not reviewed by a human: "Give this route a name.", "Add at least one store to this route.", "A store can only appear once on a route.", "That store is no longer available.", "That store is deactivated. Turn it back on to add it here.", "No such route."

**Unblocked:**
- **Wave 3 scheduling** can bind shifts to routes: `GET /api/routes` is the S1.6 picker (active only), and `route_id` is the FK. Boundary for the materialization lane, which this lane does not implement: the snapshot at start reads `route_stop` for the shift's route **ordered by `position` ascending** and copies donor + order into `shift_stop` (I5), assigning `shift_stop.position` itself. It must not carry `route_stop.id` across — the snapshot is a copy, never a pointer.
- **Wave 3 recurrence** can create patterns against a route id. Note that a route referenced by a pattern is thereafter archive-only, never hard-deletable — `routeHasHistory()` already accounts for it.
- **Wave 4's S1.6 screen** has its whole API: list/read/create/rename/reorder/remove/restore, with `RouteDetail` carrying donor name and address per stop so the builder list needs no second fetch.
- **The lead**, at merge: one import + one spread in `server/src/routes/index.ts`, and one `export * from './routes.js';` in `shared/src/index.ts`.
