# Phase 1 — build plan & standing decisions

How Phase 1 gets built and by whom. Read this **with** the foundation doc that owns your area
(`CLAUDE.md` routing table), not instead of it. The foundation docs still win on any rule; this
doc only records decisions they left open and the order the work happens in.

## 1. Standing decisions

Four questions the foundation docs do not answer, or answer inconsistently. Resolved once, here.
Do not re-litigate them mid-task; if one looks wrong, say so and stop.

### D1 — A Phase-1 run never reaches `COMPLETED`

I11 makes the receiver's receive-done the only completion action, and the receiver ships in
Phase 2. So in Phase 1 a started shift stays `IN_PROGRESS` permanently.

- **Do not** add a staff "close run" action, an auto-complete, or any other transition into
  `COMPLETED`. A second completion path contradicts I11 and would have to be removed in Phase 2.
- `S1.2`'s **Done** board state is unreachable in Phase 1. Build it, style it, leave it unexercised.
- Tests assert the shift *stays* `IN_PROGRESS` after every stop is resolved. That is the correct
  behavior, not a gap to fix.
- `Shift.pickup_completed_at` (I27) still works and is still optional — it is a handoff signal,
  not a completion (`domain-modeling.md §3.1`).

Consequence to expect: `eligible()` will exclude a driver from shifts overlapping an old
`IN_PROGRESS` run's window, since I20 counts `{CLAIMED, IN_PROGRESS}`. Correct per the invariant.

### D2 — Cap 17 (category management) ships in Phase 1

`product-requirement.md §4` omitted cap 17 from every phase row while `ui-ux-spec.md S1.8` — a
Phase-1 screen — includes a Categories tab. Resolved in favor of the UI spec: build it in Phase 1.
It is CRUD on an admin shell that already exists, and nothing consumes categories until Phase 2.
The PRD Phase-1 row has been updated to say so.

### D3 — Migrate Phase-1 tables only

`data-model.md §7` (`weight_entry`, `unscheduled_donation`) is **deferred to Phase 2**. No Phase-1
code reads it.

- The `WEIGHED` ShiftStop projection and the I12 completion gate are Phase-2 concerns and are not
  built here (see D1).
- **The I21 soft-delete "has referencing history" predicate gains new referencing tables in
  Phase 2.** Write it as exactly one function per entity (`donorHasHistory()`, etc.) so extending
  it is a one-line change rather than a hunt. This is the whole cost of D3 — pay it deliberately.

### D4 — Agents run unattended under `bypassPermissions`, isolated by worktree

No permission prompts. Blast radius is contained by giving each agent its own git worktree, so a
destructive command hits that checkout and not the main tree. Agents commit locally; pushing is
permitted but not part of any wave.

## 2. Build order

Phase 1 is one serial spine plus two rails. The spine's order is the domain's own layering — each
layer is the vocabulary of the next — so parallelizing inside it buys rework, not speed.

```
Substrate ──▶ Identity ──▶ Nouns ──▶ Schedule ──▶ Coverage ──▶ Execution
   rails:  Surface (tokens, shell, components) ─────────────────────────▶
           Signal  (notification outbox, push dispatch) ────────────────▶
```

| Wave | Lanes | Contents |
| :---- | :---- | :---- |
| **0** | 1 (no parallelism) | deps, migrations, codegen, `transaction.ts`, test DB, fixture factory, gates |
| **1** | 3 | identity/auth ‖ client shell + global patterns ‖ notification outbox |
| **2** | 4 | master data CRUD (incl. D2) ‖ route builder ‖ `eligible()` + availability ‖ PWA onboarding |
| **3** | 2–3 | schedule + recurrence ‖ execution — **Coverage stays single-owner** |
| **4** | high | one agent per `S1.x` screen, one folder each |

**Coverage is the risk.** Effort is even across the spine; difficulty is not. Substrate and Nouns
are transcription from locked docs. Coverage holds nearly every Phase-1 invariant — I19, I20 and
its staff-assign exemption, I23–I25, claim atomicity. Do not fan it out.

`eligible()` (`domain-modeling.md §5.2`) has five call sites: claim, availability declaration,
materialization, staff-assign-as-warning, and notification fan-out. Build it standalone with
table-driven overlap tests before anything consumes it.

Pickup execution only needs *a shift in `CLAIMED`* — seed one from the fixture factory and it runs
parallel to the claim work.

## 3. Single-owner files

These serialize regardless of how many agents run. One owner each, named before the wave starts.

- `server/migrations/` and the generated `server/src/db/types.ts`
- `shared/src/` — the type vocabulary everyone imports
- the route registry and middleware wiring
- `client/src/tokens/`
- **`package.json` (all workspaces)** — dependencies are Wave-0-owned. Worktrees share one
  `node_modules` by symlink, so a concurrent install corrupts every agent's tree. An agent that
  believes it needs a new dependency stops and reports instead of installing it.

## 4. Rules for every agent

1. Read the foundation doc that owns your area, per the `CLAUDE.md` routing table. Not all of them.
2. Cite the `I#` in code comments; do not restate the rule.
3. Every write transaction goes through `db/transaction.ts` (`SERIALIZABLE` + 40001 retry), and
   nothing outside `services/` opens one (`architecture.md §4.1`).
4. Every route declares a tier/duty requirement. A route declaring none is rejected, not open.
5. Tests run against the **migrated** database. Never a fixture schema, never a mock.
6. Do not edit `db/types.ts` by hand — it is generated. A type error there means the migration is
   wrong (`architecture.md §4.6`).
7. `doc-qa` must report no findings before work is considered done.
8. Do not add dependencies (§3).

## 5. The wave loop

The lead owns the `phase-1` branch and runs one wave at a time until §5.4 says Phase 1 is done.
Lanes work in their own worktrees; the lead merges each into `phase-1` and gates the result.

```
read phase-1-state.md
  └─▶ spawn lane agents (background, isolation: worktree, one per lane)
        └─▶ each lane: build, test, write reports/<wave>-<lane>.md, commit, stop
              └─▶ lead merges each worktree branch into phase-1
                    └─▶ lead runs the gate (§5.2)
                          ├─ pass ─▶ commit phase-1, decide wave N+1, update state, loop
                          └─ fail ─▶ spawn a fixer with the findings, re-gate (max 3, then HALT)
```

### 5.1 Wave-report contract

Every lane agent writes `reports/<wave>-<lane>.md` before it stops. Prose reports make the lead's
next-wave decision guesswork, so the shape is fixed:

```markdown
# Wave <n> — <lane>
**Status:** complete | partial | blocked
**Built:** <what now exists, one line each>
**Files:** <paths written; must fall inside this lane's declared ownership>
**Invariants:** <I# enforced here, and at which tier>
**Tests:** <count> passing / <count> failing — <command that proves it>
**Deliberately not done:** <in-scope things skipped, and why>
**Assumed:** <anything the docs did not answer that this lane guessed at>
**Unblocked:** <what wave N+1 can now start>
```

**`Assumed:` is the load-bearing field.** A spec gap an agent guessed at looks identical to a
correct answer everywhere else in the report. Every entry gets escalated to the human, never
silently accepted.

### 5.2 The gate

Two parts, both mandatory. The gate decides pass/fail; **the lead never does.**

1. `scripts/gate.sh` — mechanical, exit code is the verdict: migrations apply to an empty
   database, typecheck clean, test suite green against that migrated database, no stubbed service
   functions.
2. `doc-qa` over the merged diff — must report zero findings. It is an agent, so the lead runs it
   and treats any finding as a gate failure.

### 5.3 Promotion criteria

Wave N+1 starts only when **all** hold:

- `scripts/gate.sh` exits 0 on `phase-1` after every lane is merged
- `doc-qa` reports zero findings on the wave's cumulative diff
- Every lane wrote a report and none is `blocked`
- Every `Assumed:` entry is recorded in `phase-1-state.md` under **Open assumptions**

Anything else is a HALT, not a slow yes.

### 5.4 Phase 1 is done when

- Caps 1–11, 13 (minus truck-inbound) and 17 are built, per `product-requirement.md §4`
- Screens S1.1–S1.9 exist and are reachable through the shell
- The gate passes on `phase-1`
- No service function is stubbed, and no `TODO` remains in `server/src/services/`
- `phase-1-state.md` lists no blocked lane

Then: push `phase-1`, open **one** PR to `main`, stop. Do not merge it.

### 5.5 Escalation — when to HALT rather than continue

HALT means: stop spawning, write the reason to `phase-1-state.md`, notify the human, wait.

| Condition | Why it halts rather than retries |
| :---- | :---- |
| Gate red after 3 fix attempts on one wave | A fourth attempt is thrashing, not converging |
| Merge conflict between two lanes | Lanes are file-disjoint by design (§3), so a conflict means the partition was wrong — a design error, not a merge error |
| A foundation doc contradicts another | Authority order picks a winner but a human decides whether the doc or the code is wrong (`CLAUDE.md`) |
| A lane wants a new dependency | `package.json` is Wave-0-owned (§3) |
| An `Assumed:` entry would change a stored schema or an invariant's tier | Cheap to decide now, expensive to unwind later |

Never: invent a domain rule, edit a locked doc (`domain-modeling.md`), relax a constraint to make a
test pass, or mark a wave complete with a red gate.

## 6. Cross-doc dependencies

| Doc | Owns | This doc depends on it for |
| :---- | :---- | :---- |
| `product-requirement.md` | phasing, capability numbers | D2's resolution; the Phase-1 cap list |
| `domain-modeling.md` (locked) | I1–I30, state machines, algorithms | D1's reading of I11/I12/I20/I27 |
| `architecture.md` | enforcement tiers, transactions, default-deny | §4's agent rules |
| `data-model.md` | physical schema | D3's table split |
| `ui-ux-spec.md` | screens S1.1–S1.9 | D2; wave 4's one-agent-per-screen split |
