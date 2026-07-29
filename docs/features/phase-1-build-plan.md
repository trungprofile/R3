# Phase 1 — build plan & standing decisions

How Phase 1 gets built and by whom. Read this **with** the foundation doc that owns your area
(`CLAUDE.md` routing table), not instead of it. The foundation docs still win on any rule; this
doc only records decisions they left open and the order the work happens in.

## 1. Standing decisions

Questions the foundation docs do not answer, or answer inconsistently. Resolved once, here.
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

### D5 — Dependencies are the lead's, added only between waves

§3 says `package.json` is Wave-0-owned and a lane that wants a dependency stops. The reason is
concurrency — worktrees share one `node_modules` by symlink, so a lane installing mid-wave corrupts
every sibling's tree. That reason binds *lanes*, not the serial lead. The lead may add a dependency
**between** waves, when no worktree exists, and records it here.

- Added before Wave 1: **`web-push`** (+ `@types/web-push`). Web Push is VAPID signing plus RFC 8291
  payload encryption; there is no built-in, and `architecture.md §5.1` already lists VAPID keys as
  deploy configuration. Nothing else in the tree can send a push.
- Considered and **rejected**: a routing library for the client shell. Both current release lines
  carry open high-severity advisories, and the app is nine screens behind one nav. The Surface lane
  hand-rolls the router, consistent with §4.4's "jobs you do not have cannot fail."
- A lane still reports rather than installs. `npm audit` must stay at zero before a wave spawns.

### D6 — The lead is exempt from background-job worktree isolation

When the lead runs as a background job, the harness refuses edits to the shared checkout until the
session isolates itself into a worktree. That guard is right for an ordinary background job and
**wrong for this lead**, because §5.6 defines the lead as the serial owner of `phase-1` in the main
checkout: a lead inside a worktree cannot merge lane branches into `phase-1`, cannot fast-forward a
branch that is checked out elsewhere, and would leave the main checkout's `phase-1` silently stale
behind `origin`. The next resumed lead reads `git worktree list` and `phase-1` as ground truth
(§5.6) and would be misled by both.

Resolved by the guard's own documented opt-out: `.claude/settings.json` sets
`worktree.bgIsolation: "none"`, alongside the `worktree.baseRef: "head"` that §5.6 already depends
on. Isolation is not lost — it moves to where this plan always put it, the **lanes**, each of which
still runs `isolation: worktree` (D4). The lead's blast radius is bounded instead by git: every step
it takes is a commit on `phase-1`, and `phase-1` is pushed after every green gate (§5.6 step 4).

Recorded 2026-07-28, during wave 2's re-spawn. Do not re-litigate per wave; if the guard fires
again, the setting was reverted, not the decision.

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

HALT means: stop spawning, write the reason to `phase-1-state.md`, end the loop, and wait.

**No notification is sent.** This is deliberate: a halt is silent, and the human discovers it on
their next check-in. The reason must therefore be written to `phase-1-state.md` *before* the loop
ends, in enough detail to act on without re-reading a transcript — the state file is the only
thing that will still exist. A halt whose reason is "gate failed" is a bug in this protocol; it
should name the failing check, the lane, and what would unblock it.

| Condition | Why it halts rather than retries |
| :---- | :---- |
| Gate red after 3 fix attempts on one wave | A fourth attempt is thrashing, not converging |
| Merge conflict between two lanes | Lanes are file-disjoint by design (§3), so a conflict means the partition was wrong — a design error, not a merge error |
| A foundation doc contradicts another | Authority order picks a winner but a human decides whether the doc or the code is wrong (`CLAUDE.md`) |
| A lane wants a new dependency | `package.json` is Wave-0-owned (§3) |
| An `Assumed:` entry would change a stored schema or an invariant's tier | Cheap to decide now, expensive to unwind later |

Never: invent a domain rule, edit a locked doc (`domain-modeling.md`), relax a constraint to make a
test pass, or mark a wave complete with a red gate.

### 5.6 Git protocol

**The lead stays on `phase-1` for the whole run and never checks out another branch.** Lane
isolation comes from worktrees, not from branch switching — switching under running agents would
change the files they are editing.

Worktrees share the repository's `.git`, so everything below is local. Nothing needs the remote
until the final PR.

Per wave, in order:

```
1. spawn   lane agents run with `isolation: worktree`. With worktree.baseRef = "head"
           each gets its own checkout under .claude/worktrees/, on its own branch,
           branched from phase-1's current HEAD — so every lane starts from the
           previous wave's merged result, not from origin/main.

           The harness names both, not you: the path is .claude/worktrees/agent-<id>
           and the branch worktree-agent-<id>, where <id> is the agent id. Do not
           construct these from the lane name — they are returned in the spawn result
           as worktreePath and worktreeBranch. Record them against the lane name in
           phase-1-state.md immediately (see "write state at every step" below); after
           a compaction that mapping exists nowhere else, and `git worktree list` is
           then the only ground truth left.

2. merge   git merge --no-ff <worktreeBranch>       (once per lane, in report order)
           A conflict is a HALT, not a merge to resolve: lanes are file-disjoint by
           §3, so a conflict means the partition was wrong — a design error upstream
           of the merge.

3. gate    ./scripts/gate.sh   AND   doc-qa over the cumulative diff
           red -> fixer agent, re-gate, max 3 rounds, then HALT (§5.5)

4. push    git push origin phase-1
           ONLY after a green gate. Not for review — as the offsite copy. A multi-hour
           unattended run that exists only on one disk is one failure from zero
           (architecture.md §5.3 makes the same argument about backups).

5. clean   git worktree remove <worktreePath> --force
           git branch -D <worktreeBranch>
           Both flags are load-bearing, not shortcuts: a lane worktree still holds
           its build (untracked test databases, generated files), and the branch is
           already merged into phase-1 by step 2 but `-d` still refuses branches git
           cannot prove are merged. Verify against `git worktree list` afterwards.
           Required, not tidiness: Claude Code auto-removes a subagent worktree only
           when the agent made NO changes, and the periodic sweep deliberately skips
           any worktree still holding work. Every lane worktree therefore survives
           until the lead removes it, and four waves would leave a dozen behind.

6. record  update phase-1-state.md, decide wave N+1, continue
```

**Write state at every step, not only at step 6.** The lead's context compacts over a long run,
and a resumed lead — after a compaction or after the session is restarted entirely — knows only
what this file says. If state is written once per wave, a compaction landing between step 1 and
step 2 leaves a lead that believes no lanes are running while three are, and it spawns three more.

So: record lane names and their branches *before* spawning (step 1), mark each lane merged as it
merges (step 2), and record the gate verdict as it lands (step 3). The cost is a few extra lines
per wave. The failure it prevents is duplicate work landing on `phase-1` with no conflict to
announce it, because two identical lanes conflict cleanly only some of the time.

A resumed lead's first action is therefore always: read this file's §5.6, read `phase-1-state.md`,
and run `git worktree list` — the worktrees on disk are ground truth about what is actually in
flight, and they outlive any context.

At the end of Phase 1 (§5.4): push, open **one** PR from `phase-1` to `main`, stop. Do not merge it.

## 6. Cross-doc dependencies

| Doc | Owns | This doc depends on it for |
| :---- | :---- | :---- |
| `product-requirement.md` | phasing, capability numbers | D2's resolution; the Phase-1 cap list |
| `domain-modeling.md` (locked) | I1–I30, state machines, algorithms | D1's reading of I11/I12/I20/I27 |
| `architecture.md` | enforcement tiers, transactions, default-deny | §4's agent rules |
| `data-model.md` | physical schema | D3's table split |
| `ui-ux-spec.md` | screens S1.1–S1.9 | D2; wave 4's one-agent-per-screen split |
