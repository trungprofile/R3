# R3

System of record for Amazing Grace Food Pantry's weekly food-rescue cycle (rescue → receive → report), replacing a paper-and-phone process. PERN stack (Postgres, Express, React, Node), self-hosted, single Docker box, ~15 pickups/week, under 10 concurrent users. Build order is Phase 1 (rescue loop + scheduling) → Phase 2 (receive) → Phase 3 (report + metrics).

## Check the relevant doc before acting

**Don't read all foundation docs up front, but don't skip them either.** They're long and mostly non-overlapping by design — each owns a slice and defers the rest. Before touching anything a doc below owns, load it first; guessing at a rule this repo already wrote down is a bug, not a shortcut. Use the routing table to find the right doc(s) for the task at hand. Every doc ends in a "Cross-doc dependencies" table — follow that when a task touches more than one area.

**Authority order, when docs seem to conflict:**
`domain-modeling.md` is **locked** and wins any mismatch → `product-requirement.md` wins on product *why/what* → `architecture.md` wins on *how it runs* → `data-model.md` wins on physical schema → `ui-ux-spec.md` wins on layout/interaction. If you find an actual inconsistency, flag it rather than silently picking a side.

**Citation convention:** rules are cited as `I#` (invariant number, defined in `domain-modeling.md §4`) and `§#` (section in the doc named). When implementing something an invariant governs, cite the `I#` in code comments/PR description rather than restating the rule.

### Routing table — foundation docs (`docs/foundation/`)

| Doc | Load it when you're... | Owns |
| :---- | :---- | :---- |
| [`product-requirement.md`](docs/foundation/product-requirement.md) | scoping a feature, unsure *why* something works a given way, checking phase/capability numbers | Problem, roles/tiers/duties, capabilities (numbered, permanent), phasing, success metrics, notification matrix |
| [`domain-modeling.md`](docs/foundation/domain-modeling.md) | touching any entity, state machine, or invariant (I1–I30); writing service-layer logic | Entities, cardinalities, state machines (Shift, ShiftStop), invariants I1–I30, named algorithms (username gen, `eligible()`, recurrence materialization) |
| [`architecture.md`](docs/foundation/architecture.md) | deciding *where* a rule is enforced, touching auth/sessions, jobs/notifications dispatch, deployment, or the Kysely/migration layer | Invariant enforcement tiers (DB/predicate/service), auth & sessions (PIN/password, shared-device rules), authorization model, async jobs, process topology, schema/migration tooling, deploy & ops |
| [`data-model.md`](docs/foundation/data-model.md) | writing a migration, a query, or anything touching table shape, constraints, or indexes | Physical Postgres schema: types, constraints, indexes, conditional-UPDATE predicates, concurrency approach |
| [`ui-ux-spec.md`](docs/foundation/ui-ux-spec.md) | building any screen or component | Design tokens, component contracts, per-screen layouts (S1.x/S2.x/S3.x), microcopy rules, responsive matrix |

### As features get built

Add per-feature/per-duty docs under `docs/features/` (e.g. `docs/features/receive.md`) once a feature has enough implementation-specific detail (worked examples, edge cases hit during build) that it doesn't belong in the high-level foundation docs. Link new docs from this routing table so they stay discoverable — don't let pointers go stale.

`archived/` is prior scratch work — ignore unless explicitly asked to look there.

## Conventions worth knowing before writing code

- TypeScript throughout; Kysely (typed query builder) over an ORM — see `architecture.md §4.6` for why.
- The database is schema source of truth: DDL → migration SQL → database → generated types. Never author a competing schema file.
- All write transactions run `SERIALIZABLE` (see `architecture.md §4.1`) — this is load-bearing, not incidental.
- Client-side checks are communication only; every rule is enforced server-side (usually named in `domain-modeling.md` as an `I#`).

## Commands

No build yet — this section fills in once the app scaffold exists (install/dev/test/migrate commands).
