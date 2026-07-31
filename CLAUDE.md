# R3

System of record for Amazing Grace Food Pantry's weekly food-rescue cycle (rescue → receive → report), replacing a paper-and-phone process. PERN stack, self-hosted, single Docker box, ~15 pickups/week, under 10 concurrent users.

**All three phases are built** — Phase 1 (rescue loop + scheduling), Phase 2 (receive), Phase 3 (report + metrics). Every capability in `product-requirement.md §3` has code; every screen in `ui-ux-spec.md §8` has an entry in `client/src/main.tsx`, except `S2.4`, which is a device-level banner the shell mounts rather than a route; and `./scripts/gate.sh` is green. Not yet deployed, and no production data exists.

One thing is **deliberately unbuilt because it is not ours to invent**, and a task that seems to need it should stop rather than guess: NTFB's own category names, and which of ours reports under each (the `ntfb_category` table ships empty — `phase-3-build-plan.md` D12). A real receipt named ten of them and `phase-3-state.md` records the list, but it is one receipt's worth, our `Frz Non Meat` matches none of it, and seeding ten of eleven is the same failure one row smaller. The pantry enters them on S3.1.

The Meal Connect format itself is **no longer a guess**: a submitted receipt and its three entry screens settled it (`D13`, `D15`, migration 0013). The far end is a web form with no import, so the export is a hand-entry worksheet ordered by receipt, and a line item is `(category, storage)` rather than a category alone.

## Find the rule before writing the code

Load the doc that owns the area you're touching — these docs are long and non-overlapping by design, so read the relevant one, not all of them. Guessing at a rule the repo already wrote down is a bug. Each doc ends in a "Cross-doc dependencies" table; follow it when a task spans areas.

| Doc (`docs/foundation/`) | Load it when you're... | Owns |
| :---- | :---- | :---- |
| [`product-requirement.md`](docs/foundation/product-requirement.md) | scoping a feature, checking phase/capability numbers, unsure *why* | Problem, roles/tiers/duties, capabilities, phasing, success metrics, notification matrix |
| [`domain-modeling.md`](docs/foundation/domain-modeling.md) | touching any entity, state machine, or invariant; writing service logic | Entities, state machines (Shift, ShiftStop), I1–I30, named algorithms (username gen, `eligible()`, recurrence materialization) |
| [`architecture.md`](docs/foundation/architecture.md) | deciding *where* a rule is enforced; auth, jobs, deploy, Kysely/migrations | Enforcement tiers, auth & sessions, authorization, async jobs, process topology, schema tooling, ops |
| [`data-model.md`](docs/foundation/data-model.md) | writing a migration or query; anything touching table shape | Physical schema: types, constraints, indexes, conditional-UPDATE predicates, concurrency |
| [`ui-ux-spec.md`](docs/foundation/ui-ux-spec.md) | building any screen or component | Design tokens, component contracts, screens (S1.x/S2.x/S3.x), microcopy, responsive matrix |

**Authority when docs conflict:** `domain-modeling.md` is **locked** and wins any mismatch → `product-requirement.md` (why/what) → `architecture.md` (how it runs) → `data-model.md` (physical schema) → `ui-ux-spec.md` (layout/interaction). Flag real inconsistencies; don't silently pick a side.

**Citations:** `I#` = invariant (`domain-modeling.md §4`), `§#` = section of the named doc. Cite the `I#` in code comments rather than restating the rule.

Add `docs/features/<name>.md` once a feature accumulates worked examples or edge cases that don't belong in a foundation doc, and link it here. `archived/` is prior scratch work — ignore unless asked.

| Feature doc | Load it when you're... |
| :---- | :---- |
| [`phase-1-build-plan.md`](docs/features/phase-1-build-plan.md) | building anything in Phase 1 — standing decisions (no `COMPLETED` in Phase 1, deferred `§7` tables), build order, single-owner files, and the rules every agent follows |
| [`phase-2-build-plan.md`](docs/features/phase-2-build-plan.md) | building anything in Phase 2 — D7 lifts D1 (`COMPLETED` is now reachable, in exactly one place), D8 records a live conflict between `ui-ux-spec.md` and the locked doc, D9/D10 scope the edit window and the walk-in split |
| [`phase-3-build-plan.md`](docs/features/phase-3-build-plan.md) | building anything in Phase 3 — the report/metrics union and the three ways to compute it wrong, D11 (mapping lives on S3.1), D12 (NTFB categories ship empty and unmapped weight blocks export), D13 (the export shape is provisional), D14 (the Reporter's edit deliberately ignores the receiver window) |

Each phase also has a **state doc** beside its build plan — `phase-{1,2,3}-state.md`. The build plan holds decisions that are settled; the state doc holds the ledger of what was **assumed** (`A1`–`A187`), what is still open, and which bugs the build found. Read the state doc before changing behaviour in an area: an `A#` entry is a place the docs did not answer and the build picked a reading, so it is the likeliest thing to be wrong. Lane reports in `reports/` carry the same field per screen.

## Where code goes

```
client/src/
  screens/{s1-rescue,s2-receive,s3-report}/  one folder per UI §8 screen ID
  components/  tokens/  api/                 UI §3 contracts, §2 tokens, typed fetch
  sw.ts                                      service worker — push only, never cache-first (§4.5)
server/
  migrations/                                hand-authored SQL, forward-only — schema authority
  src/
    db/index.ts                              Kysely instance + pool
    db/types.ts                              GENERATED by kysely-codegen — never hand-edit
    db/transaction.ts                        SERIALIZABLE + 40001 retry — every write goes through it
    middleware/                              auth, default-deny gate, error handler (§4.3)
    pii.ts                                   shapeUser() — sole exit path for app_user
    routes/                                  parse, declare tier/duty, shape. No domain rules
    services/                                one function per domain operation; owns txns; I1–I30
    jobs/                                    catch-up sweeps (§4.4)
    index.ts                                 boots Express + scheduler in one process (§4.5)
  test/                                      runs against a migrated DB, never a fixture schema
shared/src/                                  types + enum values, zero runtime dependencies
scripts/                                     test-db, migration rehearsal, backup (§5.3)
```

Rules that aren't obvious from the path:

- **Schema flows one way** (§4.6): DDL → migration → database → generated types. Editing `types.ts` to fix an error desyncs code from where invariants are enforced.
- **Nothing outside `services/` opens a write transaction** — routes *and* jobs call in through services, which is the only thing making "the service layer enforces I12" a guarantee rather than a sentence (§4.1).
- **A route declaring no tier/duty requirement is rejected, not open** (§4.3 default-deny).
- **`pii.ts` gates people, not places.** PII is phone/address on `app_user`; donor `address`/`contact` are operational data drivers need and must not be trimmed.
- **Jobs ask "what is due and unhandled?"**, never "fire at time T" — so a missed tick self-heals instead of being lost to a restart.

## Conventions

- TypeScript throughout; Kysely (typed query builder), never an ORM or a competing schema file.
- All write transactions run `SERIALIZABLE` — load-bearing, not incidental (§4.1).
- Client-side checks are communication only; every rule is enforced again server-side.
- Tests run against a **migrated** database, never a fixture schema — tier-1/2 invariants exist only as real DDL.
- Tier comparisons are hierarchical (`>=`); duty comparisons are set membership. Easy to write as equality by accident.

## Commits

- **Run the `doc-qa` agent before committing**, unless the change is trivial (typos, formatting, comments). It checks the diff against the foundation docs and reports each mismatch as either a code bug or a stale doc. Resolve every finding before committing — fix the code, or sync the doc *and* any doc its "Cross-doc dependencies" table implicates. It is report-only and never edits, so the fix is yours to make. See [`.claude/agents/doc-qa.md`](.claude/agents/doc-qa.md).
- Do **not** add `Co-Authored-By` trailers or tool attribution to commit messages.

## Commands

```
npm install                       # three workspaces: shared, server, client
./scripts/dev.sh                  # Express + scheduler :3000, Vite :5173
./scripts/dev.sh --reset --seed   # drop, migrate, seed a usable world, then run
npm run gate                      # THE gate: migrations, both typechecks, both suites, no stubs
npm test                          # server suite only (needs a migrated test DB)
npx vitest run --root client      # client suite (pure logic, no DB, no DOM)
./scripts/test-db.sh              # disposable test DB, migrated to head; prints its URL
```

- **`gate.sh` decides pass/fail, not you.** Its exit code is the verdict, and it is the mechanical half of the commit gate — `doc-qa` is the other half and both must pass.
- **`dev.sh` exports its own `DATABASE_URL`** (`r3_dev`), overriding `.env`. Anything run *outside* it — `dev-seed.ts`, a migration, a `psql` one-liner — uses `.env` instead and will silently hit a different database. Go through the script, or set the URL explicitly.
- **`db/types.ts` is regenerated, never edited**: `npm run --workspace @r3/server codegen` against a migrated database. The gate fails if it drifts.
- `rehearse-migration.sh` and `backup.sh` are the ops paths from `architecture.md §5.3`.
