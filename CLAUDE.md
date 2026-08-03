# R3

System of record for Amazing Grace Food Pantry's weekly food-rescue cycle (rescue → receive → report), replacing a paper-and-phone process. PERN stack, self-hosted, single Docker box, ~15 pickups/week, under 10 concurrent users.

**All three phases are built** — Phase 1 (rescue loop + scheduling), Phase 2 (receive), Phase 3 (report + metrics). Every capability in `product-requirement.md §3` has code, `./scripts/gate.sh` is green, and every screen in `ui-ux-spec.md §8` is reachable — though **three are no longer their own route**, and looking for them in `client/src/main.tsx` will not find them:

- `S2.4` is a device-level banner the shell mounts.
- `S3.2` (metrics) is Admin's default **tab** since `D18`. `/metrics` still resolves, as a redirect.
- The NTFB category mapping is not part of S3.1 (`D17`) and no longer its own Admin tab either: `D40` folded it into Admin's **Categories** tab, where a category's target is edited beside the category. `/admin?tab=mapping` still resolves, as a redirect.
- `S1.4` (My shifts) is a **tab on the board** since `D30`, not a nav entry. `/my-shifts` still resolves.

There is also **one screen `ui-ux-spec.md §8` did not originally have**: **Home** (`/`), added by `D22`. It is where sign-in lands, and it shows one card per capability the signed-in user holds. It is not a duty picker and §4's ban on one still stands.

Not yet deployed, and no production data exists. Four QA passes have been through it — `qa-round-1-changes.md`, an automated sweep, a hands-on pass on a volunteer holding two duties (`D22`–`D25`), and a second hands-on pass over that build (`D30`–`D41`).

**Navigation is one entry per capability, on every viewport (`D30`).** Home first, then Pick up food / Receive a load / Report / Schedule / Admin as the user's tier and duties allow, then Inbox — in the order a week runs. No group headings. Home is capped at six cards (`D31`). The phone and tablet bar is capped at four by `ui-ux-spec.md §3`, so office work is reached through Home there; that is the design, not a truncation.

**Nothing is deliberately unbuilt any more.** That paragraph used to name NTFB's category list as not ours to invent, with `ntfb_category` shipping empty under `D12`. **The pantry supplied it on 2026-08-02** — including where `Frz Non Meat` reports, the single unknown row that had kept the whole table unseedable. All ten NTFB categories, all eleven mappings and every storage value now ship seeded (`D26`, migration 0016), and `D12` is retired. `phases-1-3.md §3.1` records the table. Still outstanding, and still not ours to invent: **the NTFB donor codes** for the stores on our routes (`donor.ntfb_donor_code`, nullable, blank on the receipt until entered).

The Meal Connect format is settled by a submitted receipt plus screenshots of all three entry screens (`D13`, `D15`, `D29`, migration 0013). The far end is a web form with **no import**, so the export is **a printed receipt, not a file** — one card per `(pickup date, donor)` mirroring the portal's own form, with the CSV removed (`D29`). A line item is `(category, storage)` rather than a category alone.

**Trash is computed, never weighed** (`D27`): a per-store share of bakery, produce and deli weight is deducted per receipt and reported as its own NTFB category. The algorithm and its load-bearing rounding order are `domain-modeling.md §5.4`. The AGFP `Trash` category ships archived so nobody can weigh into it. The deduction **never changes the reported total** — it moves weight between categories — and there is a test asserting exactly that.

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
| [`phases-1-3.md`](docs/features/phases-1-3.md) | changing behaviour anywhere — the build record for all three phases: standing decisions `D1`–`D15`, what still needs a human, the stored shapes that are cheap to change only while the database is empty, and the assumptions that change what a person sees |
| [`test-plan.md`](docs/features/test-plan.md) | testing the app before the pilot — what a green gate does **not** prove, the ten test tracks and how to run them in parallel, exit criteria, and the risks to disclose rather than let a demo discover |
| [`qa-round-1-changes.md`](docs/features/qa-round-1-changes.md) | undoing or questioning anything from the first QA pass — one row per piece of feedback, what was done, and what reverting it costs |
| [`qa-round-2-results.md`](docs/features/qa-round-2-results.md) | asking what has already been tested and what a green gate does not prove — the automated sweep's coverage matrix, its defects, and the list of things only a person on a real device can check |

**`D#` and `A#` citations in code resolve to that doc.** Roughly thirty comments across migrations, services, tests and client code cite a decision or an assumption by number — `phase-1-build-plan.md D3`, `phase-3-state.md A189`, and so on. The numbering is one series across the three phases and keeps its original meaning; only the file it lives in changed.

An **`A#` is a place the docs did not answer and the build picked a reading**, so it is the likeliest thing to be wrong — read the relevant entry before changing behaviour in that area. A `D#` is settled and is not re-litigated; if one looks wrong, say so and stop.

The six per-phase docs (`phase-{1,2,3}-{build-plan,state}.md`) and the 24 lane reports they cite are preserved verbatim under `archived/phase-docs/` and `archived/reports/`. They hold the full `A1`–`A191` ledger, the wave-by-wave merge record, the halt transcripts, and each screen's complete `Assumed:` list. `archived/` is gitignored — prior scratch work, ignore unless asked.

## Where code goes

```
client/src/
  screens/{s1-rescue,s2-receive,s3-report}/  one folder per UI §8 screen ID
    s1-0-home/                               the Home hub — a screen §8 did not have (D22)
    s1-8-admin/{metrics,mapping}/            metrics is Admin's default tab (D18); mapping is a
                                             section of its Categories tab (D17, then D40)
  app/nav.tsx                                WHICH nav entries exist — one per capability (D30)
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
