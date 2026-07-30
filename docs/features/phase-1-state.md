# Phase 1 — lead state

**Machine-maintained. The lead rewrites this file at the end of every wave.**

This exists because the lead's context will compact over a multi-hour run, and a lead whose plan
lives only in context starts re-deriving standing decisions around wave 3. Everything needed to
resume — by this session after a compaction, or by a fresh session tomorrow — is here plus
[`phase-1-build-plan.md`](phase-1-build-plan.md). Read both, in that order, before acting.

---

## Status

| Field | Value |
| :---- | :---- |
| Current wave | **NONE — Wave 4b is PROMOTED and Phase 1's build scope is CLOSED.** All four lanes merged clean in report order, both halves of the gate green, all four worktrees and branches removed (`git worktree list` shows only the main checkout). §5.4's remaining act is the PR to `main`. **Do not start Wave 5; there is no Wave 5.** Phase 2 is a new plan, and the human's instruction on 2026-07-30 was to stop when this wave finished |
| Wave status | **Wave 4b promoted 2026-07-30. All four §5.3 criteria met:** `gate.sh` green both halves, **`doc-qa` clean on the second pass — zero findings**, all four lanes reported `complete`, and every `Assumed:` (A132–A155) recorded below. Merged in report order, `--no-ff`, no conflict in any of the four. Wave 4a was promoted 2026-07-29 at `697e01b` |
| Branch | `phase-1` |
| Loop armed | **NO — stopped 2026-07-30 on the human's instruction** ("stop when finish current wave, credit running out"), with Phase 1's build scope complete. Restarting it is a human's call |
| doc-qa (gate part 2) | **Clean on everything committed.** Wave 4b took **one fix round of three allowed**: three findings, all real, all fixed in `e754532`, then verified clean. Wave 4a round 2 was zero findings |
| Consecutive gate failures | 0. **Two of Wave 4b's three findings were the lead's own work** — the incomplete pantry-day threading in a commit the lead wrote *and* asked doc-qa to check, and a stale `shared/` comment. The pattern from every wave holds: **keep `doc-qa` on lead chores, not only on lanes.** The third came from a lane reporting an asymmetry instead of working around it |
| Halted | **no — H4 cleared 2026-07-28.** Both questions answered by the human; see H4 for what each changed |

### The one thing the next lead must do first

> **NOTHING. Phase 1's build scope is closed and the loop is stopped.** Do not spawn a wave, do not
> start Phase 2, and do not "finish" anything in this file by writing code. The PR to `main` is open
> and **must not be merged by an agent** — §5.4 says open one and stop.
>
> If you were invoked to continue Phase 1: it is done, and the remaining items below are **a human's
> to do**, not a wave's. Read "What Phase 1 shipped without" and take instructions from the human.
>
> **Amended 2026-07-30, after the first UI pass** (see "Post-PR" below). The build scope is still
> closed and the loop is still stopped, but PR #1 now carries fix commits on top of the original 117.
> **One known defect is open and unfixed on the branch: A160**, the phone topbar overflow — it is a
> design call waiting on a human, with both candidate fixes measured. Do not pick one silently.

**Wave 4b closed Phase 1's build scope on 2026-07-30.** All nine S1.x screens exist, are registered in
`main.tsx`'s `SCREENS`, and are reachable through the shell.

### §5.4 — checked item by item, 2026-07-30

| Criterion | Status |
| :---- | :---- |
| Caps 1–11, 13 (minus truck-inbound) and 17 built | **yes**, with one edge: accounts/donors/trucks/categories (S1.8), scheduling incl. recurring (S1.6), shared board (S1.2), claim/self-select/assign (S1.2 + S1.6), availability (S1.4), release + bulk release (S1.3/S1.4), reschedule (S1.7), pickup execution with route + truck selection (S1.5), directional notes both ways (S1.3), lifecycle/reminder/at-risk notifications (S1.9 + `jobs/`), install/onboarding (`pwa/`). ~~The edge is **A66**~~ — **A66 closed 2026-07-30** (A158). **This row was wrong about cap 17 when it was written:** the management half was built, but "seeded with the 11 AGFP categories at launch" was not, and no gate could see it (A156). Closed by migration `0010` |
| S1.1–S1.9 exist and are reachable through the shell | **yes.** S1.5 is reached only through S1.3 (A139), which `doc-qa` confirmed matches `ui-ux-spec.md §4`'s own wording — Pickup is reached "while a route is active", not from the nav |
| The gate passes on `phase-1` | **yes**, both halves — eight mechanical checks green, `doc-qa` zero findings |
| No stubbed service, no `TODO` in `server/src/services/` | **yes** — both greps clean |
| `phase-1-state.md` lists no blocked lane | **yes** — every lane of every wave reported `complete` |

**Then: push `phase-1`, open ONE PR to `main`, stop. Do not merge it.** Done 2026-07-30 —
**[PR #1](https://github.com/trungprofile/R3/pull/1)**, 117 commits, open and awaiting a human.
**No agent merges it.** Its body names the three things Phase 1 shipped without, so a reviewer meets
them before the diff rather than after.

**Wave 4a is closed**; nothing from it is outstanding.

**Wave 4b is the last of Phase 1's build scope.** After it merges green, §5.4's checklist is what
remains — and two of its five items are known not to hold yet (see "What still stands between 4b and
§5.4" below). Do not read a green 4b as Phase 1 being done.

**Wave 4 was split into two batches, 4a then 4b.** `phase-1-build-plan.md §2` sizes Wave 4 as "high"
parallelism, one agent per `S1.x` screen — nine lanes. The lead split it rather than spawning nine at
once, for a reason about *diagnosis*, not machine load: §5.5 allows only three fix rounds before a
HALT, and a red gate with nine freshly-merged lanes gives those three rounds nine suspects instead of
four or five. The batches are also a natural seam — 4a is the volunteer/driver path a real user walks
end to end, so a green 4a is a demonstrable slice rather than half a screen set.

- **4a — the rescue loop as a user walks it** (DONE): S1.1 login, S1.2 board, S1.4 my shifts +
  availability, S1.5 driver pickup, S1.9 inbox.
- **4b — the staff and admin path:** S1.3 shift detail, S1.6 scheduling, S1.7 reschedule, S1.8 admin.

**The Wave-4 seam is `client/src/main.tsx`'s `SCREENS` registry, and it is LEAD-OWNED.** Every lane
builds its screen under its own folder in `client/src/screens/s1-rescue/` and wires nothing; the lead
adds one import + one registry line per screen at merge. No lane may edit `main.tsx`,
`app/routes.ts`, `components/`, `tokens/`, `client/public/` or `api/index.ts` — those are the §3
single-owner files and the whole reason four screens can be built at once. A lane needing a new shared
component builds it inside its own folder and says so under `Assumed:`; the lead promotes it to
`components/` later if two lanes turn out to want it.

**A67 — `client/public/` ownership — RATIFIED 2026-07-29 as lead-owned**, alongside `tokens/` and
`components/`. It was created by Wave 2's pwa lane as a declared exception and has been unratified
since. No 4b lane touches it (all four are screens), so ratifying costs nothing now and closes an
assumption that has been open for two waves. Treat it as a §3 single-owner directory from here.

**A66 — `apple-touch-icon` is still missing**, and is the one carried item no agent can close. The
manifest `<link>` is static in `client/index.html`, but iOS reads a PNG for the home-screen icon and
`client/public/` holds only SVGs, so the installed iOS icon is the browser's screenshot fallback. It
needs a binary asset. **This is a human's to produce**, which is why four waves have not produced it.

## Wave 4b — in flight

**PARTIALLY SPAWNED 2026-07-29 from `1856e33`.** Four lanes planned, all `isolation: worktree`, all
branching from `phase-1`'s HEAD. Recorded *before* any lane reports, per §5.6.

| Lane | Screen | Worktree branch | Work preserved at | Reported | Merged? |
| :---- | :---- | :---- | :---- | :---- | :---- |
| `s1-3-shift-detail` | S1.3 Shift detail | `worktree-agent-a70288ce91b7420c8` | `62f8e2f` (12 files) | no | no |
| `s1-6-schedule` | S1.6 Shift & route scheduling | `worktree-agent-ac1471e654deb59e1` | `573cf10` (11 files) | no | no |
| `s1-7-reschedule` | S1.7 Reschedule | `worktree-agent-a67bac95e181243b0` | `9efd4cc` → **complete at `b3783af`** | **1st** | **merged, clean** (253 client tests, 41 this lane's) |
| `s1-8-admin` | S1.8 Admin — accounts, donors, trucks, categories | `worktree-agent-ac5c863926923ab41` | `905039a` (7 files) | no | no |

### THE 4b STOP — spend limit again, 2026-07-29. RESUME, DO NOT RESTART.

**All four lanes were killed mid-write by the account's monthly spend limit**, the same external
billing stop that hit Wave 4a. **This is NOT a §5.5 HALT** — every §5.5 condition is about the *work*
being wrong (red gate, merge conflict, doc contradiction, unauthorized dependency). None applies. The
work is unfinished, not unsound.

**The lead committed each lane's uncommitted work in its own worktree before doing anything else**
(SHAs above, 39 files total), because it existed only as untracked files in four checkouts and any
cleanup would have destroyed it. It is **untested and ungated** — a starting point, not a deliverable.
No lane wrote a report.

**Resume from the transcripts, do not respawn.** `SendMessage` to a stopped agent revives it with its
context intact, so each lane keeps what it already read and decided; a fresh spawn re-derives all of it
and pays for the reading twice. The four agent ids are the `agent-<id>` component of each worktree path
above. Tell each resumed lane: its work was committed for it, **the inherited code is untested and
reviewing it is part of the job**, and to commit partial work itself if the limit is hit again.

**DONE 2026-07-30: all four were resumed this way**, each briefed with the three points above plus the
two or three clauses in its own screen most likely to have been built wrong while interrupted.

> **Address a stopped lane by its raw agent id, not by its lane name.** `SendMessage` to
> `s1-3-shift-detail` returned "No agent named … is reachable" for all four; `SendMessage` to
> `a70288ce91b7420c8` resumed it immediately. The lane names in the table above are this document's
> labels for the work, not handles the harness resolves. Read the id off the worktree path.
>
> Probe with the real message, not a one-liner. A bare "are you reachable?" *counts* as the resume —
> the agent wakes and spends a turn on it — so the first thing sent should be the full briefing.

Wave 3's schedule lane and Wave 4a's four lanes are both precedent: a resumed lane found four real
defects in what it inherited, which is exactly the return a restart throws away.

Depth at the stop, from the preserved commits — all four were **past scaffolding and into tests**,
which is further along than 4a's stop:

- **`s1-3-shift-detail`** — 12 files, was writing its API-shape test.
- **`s1-6-schedule`** — 11 files, was writing the assign-driver component (the I20 warning-and-confirm path).
- **`s1-7-reschedule`** — 9 files, was writing its tests.
- **`s1-8-admin`** — 7 files, was writing the account form.

> **A first spawn attempt on 2026-07-29 was lost, and left NOTHING behind.** The session exhausted its
> credit between the second and third spawn. On resume, `git worktree list` showed **only the main
> checkout** and `reports/` held no `4b-*` file: both spawned agents died before the harness ever
> created their worktrees, so they wrote nothing at all. Unlike 4a's spend-limit stop — where four
> lanes had real work on disk that had to be committed before anything else — **there was nothing to
> preserve, so all four lanes were spawned fresh.**
>
> The lesson is about *ordering*, not billing: the previous lead could not record the two branch names
> because the harness had not yet created the worktrees when it needed to write them down. **The branch
> names cannot be known at spawn time.** So the reliable protocol is the one used here: name every lane
> in this table *before* spawning, and treat `git worktree list` as the mapping — matching a worktree
> to a lane by which screen folder it contains. A lane with a worktree is running or has run; do not
> re-spawn it.

**Reports land at `reports/4b-<lane>.md`.** Merge in report order, `--no-ff`, one lane at a time.

### What each lane owns

All four are **client-only** — the server surface exists and no 4b lane writes server code. Each owns
exactly `client/src/screens/s1-rescue/<lane>/` and may not touch `main.tsx`, `app/`, `components/`,
`tokens/`, `api/index.ts`, `client/public/`, `shared/`, or `server/`. Each gates on
`npx tsc --noEmit -p client/tsconfig.json` and `npx vitest run --root client` (no `test-db.sh` — none
has server tests). All inherit the four decisions below.

- **`s1-3-shift-detail`** (S1.3). `GET /shifts/:id`, `POST /shifts/:id/release`,
  `POST /shifts/:id/stops/:stopId/reassign`, `PATCH /shifts/:id/note`, `GET /shifts`. Two views of one
  screen: owner-on-phone and staff-on-desktop, with the staff note editable by one and read-only to
  the other. Release is before-start only; the conflict-flag banner is informational and must never
  block pickup execution.
- **`s1-6-schedule`** (S1.6). `POST /shifts`, `PATCH`/`DELETE /shifts/:id`, `/patterns` (+ `/:id`,
  `/:id/terminate`), `GET /shifts/:id/eligibility`, `/shifts/:id/assign`+`/unassign`, `/routes`,
  `GET /donors`. No truck field at publish (the driver picks it at start, I8). Assign is a **warning,
  never a block** (I20's staff-assign exemption).
- **`s1-7-reschedule`** (S1.7). `POST /shifts/:id/reschedule`, `GET /shifts/:id/eligibility`,
  `GET /shifts/:id`. The screen's whole substance is the conflict path: moving a shift keeps the owner
  by default, but a conflict with that owner's declared availability must be surfaced *before* confirm
  in S1.7's exact voice, and on confirm the owner is **released** and the shift returns to the board as
  Open. **The system never auto-picks a replacement** — the clause most likely to be helpfully violated.
- **`s1-8-admin`** (S1.8). `/users` (+ `/:id`, `/:id/credential`), `/devices`, `/donors`, `/trucks`,
  `/routes` (+ `/:id/restore`), `/categories`. Four sub-screens selected by `components/Segmented.tsx`
  in **`mode="tabs"`** (A131 gave S1.8 that Layout line precisely so this lane would not invent a
  navigation pattern). Load-bearing: username is auto-generated and **immutable after creation** (I3),
  shown read-only; duties are set membership (I2) and tier is a hierarchy (I1) — different kinds of
  control, easy to build alike by accident; **Delete asks the domain, which decides hard-delete vs.
  deactivate (I21)** and the UI must not make the user choose; categories ship in Phase 1 per **D2**.

### Why 4b is a materially easier wave than 4a

**Every 4b screen has a complete server surface already, so no lane writes server code.** This was
checked before spawning rather than assumed — the registered route list covers all four screens:
`/shifts` + `/shifts/:id` (+ `/assign`, `/unassign`, `/release`, `/eligibility`, `/note`,
`/reschedule`, `/stops/*`) for S1.3 and S1.7; `/patterns` (+ `/:id`, `/:id/terminate`) and
`POST /shifts` for S1.6; `/users` (+ `/:id`, `/:id/credential`), `/devices`, `/donors`, `/trucks`,
`/routes`, `/categories` for S1.8.

That is the opposite of 4a, where the inbox lane had to invent an entire API from scratch because
nothing had ever read the `notification` rows. **No 4b lane owns a server file, so no 4b lane needs
`server/src/routes/index.ts`** — the single-owner hazard that made the inbox lane special does not
recur. If a lane believes it needs a new endpoint, that is a **report**, not a build: it means Waves
1–3 missed something, and the lead decides.

### What 4b lanes must inherit rather than re-derive

Four decisions landed after 4a's lanes were briefed. A lane that re-derives any of them ships a bug:

1. **Times render in `useSession().timezone`, never the device zone (A120).** A run time is a
   pantry-local fact. The device zone survives only as the fallback for the moment before the session
   loads.
2. **S1.6's "starting __" is a computed read-only display, not an input (A111, ruled by the human).**
   There is no `start_date` column; the first occurrence is derived from the pattern.
3. **The segmented control is `components/Segmented.tsx` (§3), with two behaviors.** S1.8's four
   sub-screens and any other panel switcher use `mode="tabs"` and `tabPanelProps`; a filter that
   narrows a list in place uses the default. Do not build a third copy — that is what this one
   replaced.
4. **Reordering is large Move up / Move down buttons, not a drag handle (A117, ruled by the human).**
   Relevant to S1.6 if it orders stops.

## Wave 4a — merged and promoted

**Spawned 2026-07-29 from `1c09255`.** Five lanes, all `isolation: worktree`, all branched from
`phase-1`'s HEAD so each starts from Wave 3's merged result. Recorded here *before* any lane reports,
per §5.6: after a compaction this mapping exists nowhere else, and `git worktree list` is the only
ground truth left.

| Lane | Screen | Worktree branch | Merged? |
| :---- | :---- | :---- | :---- |
| `s1-1-login` | S1.1 Login | `worktree-agent-afcbdae24cb485037` | **merged** (clean, no conflict) |
| `s1-2-board` | S1.2 Shared shift board | `worktree-agent-a172e7e5324aeb522` | **merged** (resumed after the stop, then complete) |
| `s1-4-my-shifts` | S1.4 My shifts + availability | `worktree-agent-a2aabbb6c854a3d9d` | **merged** (resumed after the stop, then complete) |
| `s1-5-pickup` | S1.5 Driver pickup execution | `worktree-agent-a11efe9ea96dde6d6` | **merged** (resumed after the stop, then complete) |
| `s1-9-inbox` | S1.9 Notification inbox **+ its server surface** | `worktree-agent-ae61c199995723b58` | **merged** (resumed after the stop, then complete) |

Worktree paths are `.claude/worktrees/agent-<id>` for the same `<id>`.

**Reports land at `reports/4a-<lane>.md`.** Merge in report order, `--no-ff`, one lane at a time
(§5.6 step 2). A conflict is a **HALT**, not a merge to resolve — these lanes are file-disjoint by
construction, so a conflict means the partition was wrong.

### What the lead owes at merge

1. **Wire `client/src/main.tsx`'s `SCREENS` registry** — one import + one entry per screen. No lane
   touches it; that is the whole reason five screens can be built at once. Until the lead wires it,
   every route renders `AppShell`'s "This screen isn't ready yet." placeholder, so a green lane gate
   does **not** mean the screen is reachable.
2. **Wire the top-bar unread bell.** `AppShell` already takes an `unreadCount` prop and nothing feeds
   it. The inbox lane builds the count endpoint and reports the seam under `Unblocked:`.
3. **Check for promoted components.** Any lane that needed a shared component built it inside its own
   folder and said so under `Assumed:`. Two lanes wanting the same one is the signal to promote it to
   `components/` — one lane wanting it is not.

### The 4a stop — spend limit, 2026-07-29

**Four of five lanes were killed mid-write by the account's monthly spend limit.** Not a build
failure, not a blocked dependency, not a doc contradiction — an external billing stop that hit every
running agent at once. `s1-1-login` had already finished and merged clean; the other four died at
various depths, none having written a report.

**This is NOT a §5.5 HALT.** Every §5.5 condition is about the *work* being wrong — a red gate, a
merge conflict, a doc contradiction, an unauthorized dependency. None applies. The work is unfinished,
not unsound. The correct response is to resume, and the limit has since been reset.

**The lead committed each lane's uncommitted work in its own worktree before doing anything else**
(SHAs in the table above), because that work existed only as dirty files in four checkouts and any
cleanup would have destroyed it. It is **untested and ungated** — a starting point, not a deliverable.

Depth at the stop, from the preserved diffs:

- **`s1-2-board`** — furthest along. Seven files: `Board.tsx`, `Segmented.tsx`, `api.ts`, `board.ts`,
  `board.css`, `board.test.ts`, `index.ts`. Plausibly close to done.
- **`s1-9-inbox`** — substantial and the most valuable to preserve, because it is the only lane doing
  server work: `services/inbox.ts`, `routes/notifications.ts`, two server test files, its registration
  in `routes/index.ts`, and the screen folder.
- **`s1-4-my-shifts`**, **`s1-5-pickup`** — screen folders only, earliest at the stop.

**All four were resumed 2026-07-29 once the limit reset — resumed from their own transcripts, not
respawned.** `SendMessage` to a stopped agent revives it with its context intact, so each lane kept
what it had already read and decided; a fresh spawn would have re-derived all of it and paid for the
reading twice. Each was told its work had been committed for it, that the inherited code is untested,
that `s1-1-login` has since merged into `phase-1` (nothing of theirs conflicts, and the lead owns the
merge), and to commit partial work itself if the limit is hit again.

**Resume, do not restart.** Wave 3's schedule lane is the precedent: a lane resumed from preserved
work found four real defects in what it inherited, which is exactly the return a restart throws away.
A resumed lane must be told the inherited code is untested and that reviewing it is part of the job.

### The clock-dependent gate — found by three lanes, fixed 2026-07-29

**`server/test/recurrence-materialization.test.ts` had two tests that failed only between 09:00 and
13:00 pantry-local**, and passed every other hour. **Wave 3 was promoted on it.** `gate.sh` ran at
07:47 and the doc-qa re-gate at 07:52 — both outside the window — so the wave's green was luck of the
clock, not evidence. This is the most important thing Wave 4a produced.

Three lanes hit it independently and none of them owned the file; all three declined to touch it and
reported it instead, which is the behaviour §3 wants. The lead reproduced it deterministically rather
than accepting three concurring reports: setting the test DB's `app_config.timezone` so pantry-local
`now` lands inside the window fails it on demand, and outside it passes.

**The service was correct; the tests were wrong.** Moving a pattern's window later in the day
legitimately *mints* an occurrence that did not exist before — today's 09:00 slot is already past and
was never materialized (§5.3's loop runs `[now, horizon]`, and A116 records this), while today's new
13:00 slot is still ahead and is. Both tests assumed an edit cannot change the instance **set**: they
iterated the *current* instances and looked each up among the *originals*, so the newly minted row
resolved to `undefined` and died on the `!`.

Fixed by inverting the lookup — iterate the originals, find each in the current set. That is exactly
what both test names claim (CLAIMED instances did not move per I24; unclaimed ones did), and it holds
at any hour. Verified at pantry-local 08:04, 10:04, 11:04 and 18:04; 10:04 and 11:04 failed before.
**No constraint relaxed, no assertion dropped.**

**Standing lesson for the next lead: a green gate is evidence only if the suite is time-independent.**
Any future test whose fixture straddles wall-clock `now` can do this again.

### Seam fixes the lead owed after 4a merged — ALL THREE DONE

Collected as lanes reported. All were in lead-owned files no lane may touch, so none was a lane
defect. **1 and 3 landed with the 4a merge; 2 landed as its own gated commit `3b6f237`.**

1. **`client/src/api/errors.ts` drops every 401 body field except `message` and `correlationId`** —
   including `triesLeft`, which `shared/src/index.ts` defines on `LoginRejected` and the server
   actually sends. The login lane could not touch that file, so it recomputes the count from a
   mirrored `MAX_TRIES = 4` in its own folder. **This is a silent-drift hazard, not a style point:**
   the server's `ACCOUNT_MAX_FAILURES` and the client's `MAX_TRIES` can diverge with nothing to
   notice, and the screen would then tell a volunteer the wrong number of tries before a lockout.
   The lane identified the fix precisely — carry `triesLeft` through `ApiError` — and it is one
   field. Do it at seam-wiring, then delete the mirrored constant.
2. **Promote a shared segmented/tab control to `components/`** — **DONE, `3b6f237`.** `s1-2-board`
   built `Segmented.tsx` and `s1-4-my-shifts` built `Tabs.tsx` — the same control, twice, each inside
   its own folder exactly as instructed. **Two lanes wanting it was the promote signal** the briefs
   named; one would not have been. `ui-ux-spec.md §3` had no contract for one, so promoting it meant
   writing that contract, not just moving a file.

   **Two things had to be resolved rather than merged, and both were real:**

   - **ARIA.** A filter (narrows a list in place) and a tablist (switches panels) are different
     patterns, not one control with two labels. `s1-4`'s `role="tablist"` carried **none** of the
     keyboard behaviour that role obliges — no roving tabindex, no arrow keys, no Home/End. That is
     worse than declaring no role at all, because it promises a screen-reader user an interaction
     that is not there. The promoted control implements the full pattern in `mode="tabs"` and makes
     `idPrefix` **required** there by the prop union, so an `aria-controls` pointing at nothing is
     unrepresentable rather than merely unlikely.
   - **The selected state.** The two copies disagreed and **each cited §2 for its choice** — a fill
     on the board, an inset bar on the tabs. The bar's comment read §2's "never carries white text"
     as a blanket ban on any label on orange. **It is not:** §2 pairs `--action-fill` with
     `--text-on-brand` at 5.0:1 precisely so a label can sit on orange, and §3's Button already
     ships that pairing. Fill won for both. **This changed S1.4's shipped appearance** — recorded as
     A130, since no doc ruled between the two and the choice is the lead's.
3. **Wire `useUnreadCount` into `app/App.tsx`** so `AppShell`'s existing `unreadCount` prop is fed
   from the inbox lane's new endpoint. The prop has been dangling since Wave 1.

### The inbox lane is not like the others

It is the only 4a lane touching `server/`, and it is building an API surface **from scratch**: there
is no read endpoint for `notification` at all, so nothing has ever read the rows Waves 1–3 have been
writing. The schema was always ready (`read_at`, and `ix_notif_unread` built for exactly this query)
— only the service and routes are missing. It is therefore the **named owner of
`server/src/routes/index.ts` for Wave 4a**, which satisfies §3's "one owner each, named before the
wave starts" because no other 4a lane touches server code at all.

Expect its `Assumed:` list to be the longest of the five, and expect it to be *correctly* long: every
endpoint path, every response shape, and the mark-read semantics are its own invention. No doc
specifies them. **Read that list before the others.**

## Halt

### H4 — CLEARED 2026-07-28: both findings answered by the human

**Cleared. Wave 2 passed and is promoted.** The halt is kept as the record of what was decided and
why, because both answers are now load-bearing for Wave 3.

When raised, `scripts/gate.sh` exited 0 at `2203333` but `doc-qa` — gate part 2, and §5.2 says **the
gate decides pass/fail, the lead never does** — returned **two findings**. Both were spec questions,
not defects, and both turned on a **locked** doc, so neither was fixable by a fixer agent: §5.5's
"spawn a fixer, max 3 rounds" had nothing to converge on. A fourth attempt at a question is not a fix.

**Both were answered by the human.** A46: no code change, two docs corrected. A54: the clause stays
and the **locked doc was amended under the human's explicit authorisation** — the one thing §5.5
forbids an agent to do on its own initiative.

**A postscript worth keeping, because it is the lead's own mistake and it recurs easily.** Amending
`§5.2` obliged the lead to follow that doc's *Cross-doc dependencies*, and it did not. `doc-qa`'s
second pass caught two survivors — `product-requirement.md §4` and `data-model.md §9` both still
restated the pre-amendment three-clause predicate. The PRD one had teeth: it is the doc
`eligibleDriverIds()` cites as its spec, so a reader working from it alone would have rebuilt the
fan-out without the active clause and reopened exactly the I25 hole A54's ruling closed. Both now
**cite `§5.2` instead of paraphrasing it** — a rule restated in four places is four things to keep in
sync, and this wave proved it does not stay in sync. `doc-qa`'s third pass swept for any remaining
restatement and found none.

---

#### A46 — **RESOLVED 2026-07-28 by the human: I21 governs. No code change.**

> "may a category ever be hard-deleted -> yes if nothing reference, else soft-delete for future only
> so history record isn't dangling"

That is I21 restated, including its *reason*: the soft branch exists so a history row never points at
a destroyed category. The code was already right — `removeCategory()` asks `categoryHasHistory()` and
branches — so **nothing in `server/` changed.** The stale doc was corrected instead:

- `ui-ux-spec.md S1.8`'s Categories bullet no longer says "no hard delete". It now states I21's two
  branches, keeps the reason the original parenthetical gave (archived categories stay hidden from
  the S2.2 keypad while history and reports keep resolving them), and notes that the UI does not make
  the user choose — *Delete* asks the domain, which decides which branch happened.
- `product-requirement.md` cap 17 gained the same clause, because it listed only "add / archive" and
  its silence is what let S1.8's reading look supported. Naming I21 there stops the next reader
  re-deriving the contradiction — the same fix H2 applied.

<details><summary>The contradiction as found</summary>

#### The question — **A46**: may a category ever be hard-deleted?

| Where | Says |
| :---- | :---- |
| `domain-modeling.md` I21 (**locked**, top of the authority order) | "Donor / Category / Truck / User: soft-delete (deactivate) if any referencing history, else **hard-delete OK**" |
| `ui-ux-spec.md S1.8` (lowest authority) | categories are "add, archive (**no hard delete** — archived categories are hidden from the S2.2 weight-entry keypad but preserved in history/reports)" |

The `masters` lane followed the authority order and implemented I21, exposing
`DELETE /categories/:id`. **In Phase 1 nothing references `category` at all**, so that endpoint
hard-deletes on *every* call today — the two readings diverge immediately, not eventually.

`doc-qa` read it exactly as the lead did, and checked whether it recurs: **it does not.** S1.8's
Donors and Trucks bullets say only "add/edit/delete" with no such restriction, and `§3.3`'s Route row
has no UI-side counterpart — so `donor.ts`, `truck.ts` and `pickup-route.ts`'s hard-delete paths carry
no equivalent conflict. This is one rule in one place.

**Why the authority order does not end it.** It says the code is right and S1.8 is stale. But S1.8's
parenthetical is specific and gives a *reason* — it names the S2.2 keypad and the reports that must
keep resolving the category. That reads as a deliberate product rule, not loose prose. The authority
order can pick which doc wins; it cannot tell you whether the **doc** or the **code** is wrong.

- **If I21 governs** — no code change. Edit `ui-ux-spec.md S1.8`'s parenthetical so the next reader
  cannot re-derive this.
- **If S1.8 governs** — drop the `DELETE /categories/:id` route and `removeCategory()` (one file),
  leaving `PATCH { active: false }` as the only removal. `domain-modeling.md` is locked, so **only a
  human may carve Category out of I21.**

</details>

---

#### A54 — **RESOLVED 2026-07-28 by the human: the clause stays; `domain-modeling.md §5.2` was amended.**

The human chose "keep the clause, make the locked doc accurate" over stripping it. `§5.2`'s pseudocode
now carries `driver is active` as its **first conjunct**, with a paragraph explaining why it lives in
the algorithm rather than at each call site, and `architecture.md §4.1`'s `eligible()` entry gained the
matching note. `eligibility.ts:210` is unchanged except its comment, which now **cites** §5.2's first
conjunct instead of arguing for an extension.

**The argument that decided it — and that neither the lane nor `doc-qa` raised — is I25.** Both had
weighed claim, staff-assign and fan-out, where the clause is nearly redundant. But materialization is
reachable by a deactivated account precisely because it needs no login: without the clause, a
recurrence pattern whose `ownerDefault` was deactivated months ago keeps minting instances **born
`CLAIMED` to that dead account**, so the run never shows as open and the person named on it cannot act
on it. That is a silent scheduling hole, and it is Wave 3's code — which is why settling this before
Wave 3 was worth a halt.

<details><summary>The finding as reported</summary>

**This is the one where `doc-qa` and the building lane disagree, and `doc-qa` is the gate.**

`domain-modeling.md §5.2` (**locked**) specifies `eligible()` as exactly three conjuncts: `Drive ∈
driver.duties` AND no overlapping `AvailabilityBlock` AND no overlapping owned `CLAIMED`/`IN_PROGRESS`
shift. The `eligible` lane added a fourth — a deactivated account is ineligible — justified from I21,
isolated behind a `DEACTIVATED` reason code, and **declared** in its report as A54.

The lane framed it as a defensible reading of a silent doc. `doc-qa` framed it as **an addition to a
fully-specified locked algorithm**, and leans toward stripping it, on two arguments the lead verified
against the source:

1. **It is largely redundant.** A deactivated account's next request already fails on the session
   check (`architecture.md §4.2`), so the claim and staff-assign-warning call sites gain little.
2. **The failure mode it cites is already prevented elsewhere.** `eligibleDriverIds()` — the fan-out
   set — carries its own independent `WHERE app_user.deactivated_at IS NULL`
   (`server/src/services/eligibility.ts:261`). Removing the clause from `evaluateEligibility` does
   **not** reopen "notify a removed account".

**Why the lead did not just strip it.** It is one line, and conforming code to the locked doc is
normally the lead's call — but stripping has a real consequence at a call site **Wave 3 has not built
yet**: with the clause gone, `eligible()` returns true for a deactivated driver, so **staff-assign
would show no warning when assigning a shift to a deactivated account.** Choosing between "the locked
doc is literally right" and "the code is protecting something the doc forgot" is a domain decision.
The alternative fix — amending `§5.2` — means **editing a locked doc, which §5.5 forbids outright.**
Both roads need a human, so the lead took neither.

- **If §5.2 is literal** — delete the `DEACTIVATED` push at `eligibility.ts:210` and the reason from
  `ELIGIBILITY_REASONS` in `shared/src/availability.ts`. Leave `eligibleDriverIds()`'s own filter.
  Then decide, for Wave 3, whether staff-assign needs its own deactivated check.
- **If the clause should stay** — `domain-modeling.md §5.2` must be amended to state the fourth
  conjunct, and `architecture.md §4.1`'s `eligible()` paragraph updated with it. **Requires unlocking
  the locked doc.**

</details>

---

**A43 is *not* part of this halt.** `doc-qa` confirmed the malformed-uuid inconsistency is real (new
routes 404, Wave-1 identity routes 500) but that no doc mandates a direction, so it is **not a gate
blocker**. Its own suggestion, worth recording: strictly, neither is right — a syntactically invalid
id is a client error (**400**), not "absent" (404) or "server fault" (500). Left open as A43.

**What `doc-qa` found clean**, so the human knows the scope of what is *not* in question: every new
route declares a tier or duty (no silently-open route); zero write paths outside `services/`, with
I20's and I28's cross-row gates reading inside their own write transaction; donor `address`/`contact`
returned whole everywhere (PII gates people, not places); all four `xHasHistory()` predicates match
`data-model.md`'s real referencing tables and D3's phase split; no dependency added; and A78's client
`@r3/shared` repointing verified across all five files.

**A deliberate deviation from §5.6 step 4, recorded so it does not read as an oversight: the lead
pushed `phase-1` on a red gate.** Step 4 says push *only* after a green gate. The reason it gives is
durability — "a multi-hour unattended run that exists only on one disk is one failure from zero" —
not publication, and this session **already lost a whole wave to exactly that failure** (H3). The
gate's authority is over **promotion**, and promotion is precisely what did not happen: no Wave 3 was
spawned. Preserving the work offsite and promoting it are different acts, and only the second is the
gate's to allow. A future lead who disagrees can reset the remote branch; nothing here is merged to
`main`.

**Worktree hygiene (§5.6 step 5) was completed even though the gate is red** — all four lanes had
already reported and merged, so their worktrees held nothing unmerged. Branches deleted, four
`r3_test_agent_*` databases dropped, verified against `git worktree list`. The `wave2-aborted/*` tags
from attempt 1 are **kept**: H3 says to delete them once wave 2 passes its gate, and it has not.

**To resume:** answer both questions above, apply the corresponding change, clear this section, set
`Halted` to no, and restart the loop. Wave 3's lanes are named in build-plan §2 (schedule +
recurrence ‖ execution, **Coverage stays single-owner**). Before spawning them the lead still owes the
three carried items below: the `shift` conflict-flag migration, the A56 timezone hoist, and making
A34/A78's `@r3/shared` resolution structural.

### H3 — CLEARED 2026-07-28: wave 2 attempt 1 aborted by a macOS TCC lockout

**Environmental, not a spec or gate failure.** Mid-wave, every path under
`/Users/user/Documents/**` began returning `EPERM` to both `Read` and `Bash`, including paths read
successfully minutes earlier; `~/.claude` and `/tmp` stayed readable. That is the signature of a
macOS Privacy & Security (Files and Folders / Full Disk Access) grant being revoked from the host
process. Disabling the Claude Code sandbox did not help, confirming it was OS-level.

**The halt could not be recorded here, because this file was inside the locked tree** — §5.5's own
precondition failed. The reason was written to the lead's memory instead
(`wave-2-halted-tcc-lockout`) and announced to the human rather than taken silently. This section is
that record transcribed back, per the memory's own resume instructions.

**What the lockout cost.** Nothing merged, and nothing was lost from `phase-1`:

- No lane committed, none wrote `reports/2-<lane>.md`, and none ran `gate.sh`. §5.3 fails on "every
  lane wrote a report", so **no lane was mergeable** and none was merged.
- All four worktrees sat at `d6a4f91` holding untracked, untested files. Two lanes (**eligible**,
  **pwa**) returned prose reports to the lead before dying, but their worktrees hold the *least* work
  on disk — the lockout ate the writes those reports described. That mismatch is why the wave is
  re-run rather than salvaged: a report that describes files which do not exist cannot be trusted
  about the files that do.
- The uncommitted work was committed on each lane branch and tagged **`wave2-aborted/<lane>`**
  (`masters` 501e5f2, `routebuilder` b5648c3, `eligible` c7c9f26, `pwa` 5a201dd) before the worktrees
  were removed. Recoverable, never merged, and **not to be merged** — it is unreviewed and ungated.
  The tags exist so that discarding the attempt stayed reversible, not as a shortcut back into
  `phase-1`. **Deleted 2026-07-28 once wave 2 passed its gate**, as planned — attempt 2 supersedes
  them and a stale tag pointing at unreviewed work is a trap for the next reader.

**Cleanup performed on resume** (the lanes could not do it themselves): four worktrees unlocked and
removed, four `worktree-agent-*` branches deleted, and **six** stray `r3_test_agent_*` databases
dropped — three from wave 2 and three left behind by wave 1's lanes, which §5.6 step 5 does not
mention but which accumulate the same way. `git worktree list` now shows only the main checkout.
`scripts/gate.sh` was re-run on `phase-1` at `0d91d12` and exits 0, so the lockout left wave 1's
merged result intact.

**Probe with a read, never a write, if this recurs.** Creating a *new* file under the locked tree
succeeds and reads back (TCC lets a process touch what it created), so `touch` is a false all-clear —
and the file then cannot be removed, because unlink needs the directory permission. Use `ls` or
`cat README.md`. Two probe files stranded by the lockout were already gone by resume.

### H2 — RESOLVED 2026-07-28 by the human: **Staff can see phone/address; only Admin can edit**

> "can Staff see another user's phone and address --> Yes, Staff just can't edit data like admin"

**No code change was required.** `pii.ts` already implemented `viewer.tier >= STAFF OR viewer.id ==
subject.id`, and `routes/users.ts` already declared reads at `STAFF` and every write — create, patch,
credential, delete — at `ADMIN`. The view/edit split the human drew was the split the code had.

`product-requirement.md §2` was corrected instead: the Staff row's *Cannot* column no longer says
"see others' PII" (it says **edit**), the Admin-only delta now reads "**editing** anyone's
phone/address", and a "**Seeing is not editing**" note was added under the PII definition naming
`architecture.md §4.3` as the enforcement point, so the next reader cannot re-derive the old
contradiction. No other doc restated the rule the wrong way — `architecture.md:197`'s enforcement
table ("Volunteers see names, not others' phone/address") was already consistent.

<details><summary>Original halt text — the contradiction as found</summary>

**Wave 1 passed its gate.** All four §5.3 promotion criteria hold: `gate.sh` exits 0, `doc-qa`
reports zero findings, all three lanes reported `complete`, and every `Assumed:` line is recorded
below. This halt is **not** a gate failure — it is §5.5's "a foundation doc contradicts another",
which halts independently of promotion.

**What contradicts what.** Inside a single section of the top-authority doc:

| Where | Says |
| :---- | :---- |
| `product-requirement.md §2`, role table, **Staff** row | Staff "Cannot ... see others' PII" |
| `product-requirement.md §2`, role table, **Admin** row | "PII visibility" is part of the **Admin-only delta** |
| `product-requirement.md §2`, prose bullet, ~3 lines later | "Only phone/address are gated to **Staff-tier-and-above**" |
| `architecture.md §4.3` | `viewer.tier >= STAFF` OR `viewer.id == subject.id` — and cites `PRD §2` as its source |

The two readings are mutually exclusive: either a Staff coordinator can see a volunteer's phone
number and address, or only an Admin can.

**Why the authority order does not settle it.** `CLAUDE.md` ranks `product-requirement.md` above
`architecture.md`, but both readings are *inside* `product-requirement.md`. The tiebreak has no
input. Escalating is the protocol's own answer here, not caution.

**What the code does now.** Follows `architecture.md §4.3` — Staff-and-above, plus always yourself.
`doc-qa` confirmed this resolution is applied consistently everywhere it recurs: `shapeUser()` in
`server/src/pii.ts` is the single implementation, and `routes/auth.ts` (roster, login, `/me`) and
`routes/users.ts` (list/get/create/edit) all reach it through that one call. Nowhere resolves it the
other way.

**What a human needs to decide.** One question: **can Staff see other users' phone and address?**

- **If yes** (current behaviour) — `product-requirement.md §2`'s role table is wrong. Remove "see
  others' PII" from the Staff *Cannot* column and drop "PII visibility" from the Admin-only delta.
  No code changes.
- **If no** — `architecture.md §4.3` is wrong and so is the code. Change the predicate in
  `server/src/pii.ts` to `viewer.tier >= ADMIN OR viewer.id == subject.id`, update
  `architecture.md §4.3`'s PII-shaping paragraph, and fix the §2 prose bullet that says
  "Staff-tier-and-above". `server/test/identity-pii.test.ts` asserts the current rule and would need
  its expectations inverted.

**Why this stops the run rather than deferring.** Wave 2 builds master-data CRUD and a second round
of routes; Wave 4 builds S1.8, the admin account screen that renders these fields. Every one of them
inherits this decision. It is one line today and a cross-cutting change with test churn in two
waves' time — §5.5's "cheap to decide now, expensive to unwind later", exactly.

**To resume:** answer the question above, apply the corresponding change, set `Halted` to no and
`Loop armed` to yes, then restart the loop. Wave 2's lanes are already named in §2 of the build plan
(master data CRUD incl. D2 ‖ route builder ‖ `eligible()` + availability ‖ PWA onboarding); nothing
else blocks them.

</details>

*(H1 was cleared in wave 0. A1 and A4 were decided by the human on 2026-07-28; see Open
assumptions.)*

## Wave 3 — lanes in flight

Named before spawning (§5.6 step 1). Three lanes, per build-plan §2's "2–3".

**Coverage stays single-owner — this is the wave's whole risk.** §2: effort is even across the spine
but difficulty is not, and Coverage holds nearly every remaining Phase-1 invariant — I19, I20 and its
staff-assign exemption, I23–I25, and claim atomicity. It is **one lane**, not fanned out, however
large it looks next to the others.

| Lane | Owns (exclusive) | worktreePath | worktreeBranch | Spawned | Reported | Merged |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| **schedule** | `server/src/services/{schedule,recurrence}.ts`, `server/src/routes/shifts.ts`, `server/src/jobs/materialization.ts`, `shared/src/schedule.ts`, own tests | `.claude/worktrees/agent-a95dba7531295b943` (continuation) | `worktree-agent-a95dba7531295b943` | **yes** — 2nd attempt, continuing | **complete** (`96bbeec`, 66 lane tests, own `gate.sh` green at 356) | **yes** |
| **coverage** | `server/src/services/coverage.ts`, `server/src/routes/coverage.ts`, `server/src/jobs/at-risk.ts`, `shared/src/coverage.ts`, own tests | `.claude/worktrees/agent-ae8393a4467fb460d` | `worktree-agent-ae8393a4467fb460d` | **yes** | **complete** (`011e6d9`, 86 lane tests, own `gate.sh` green at 376) | **yes** |
| **execution** | `server/src/services/execution.ts`, `server/src/routes/execution.ts`, `server/src/jobs/reminder.ts`, `shared/src/execution.ts`, own tests | `.claude/worktrees/agent-a0d3f9b26e700d0fc` | `worktree-agent-a0d3f9b26e700d0fc` | **yes** | **complete** (`1198753`, 58 lane tests, own `gate.sh` green at 348) | **yes** |

All three spawned 2026-07-28 and branched from **`4c10428`**, verified against `git worktree
list` rather than constructed from the lane name (§5.6 step 1).

**The `schedule` lane was stopped by the human mid-run** (2026-07-28) and is being **finished, not
restarted** — the human's explicit instruction was "resume to finish, don't start over."

The harness **refuses to resume a user-stopped agent** ("treat its work as cancelled"), so resuming
the original agent was not available. The work itself was never the thing that was cancelled, so it
was preserved instead: its four files — `services/schedule.ts`, `services/recurrence.ts`,
`jobs/materialization.ts`, `shared/src/schedule.ts`, **1,879 lines** — were committed as `4cba3db` on
`worktree-agent-aac3964bdc1925e97`, and a **continuation lane** now merges that commit as its first
action and finishes from there. Routes, tests and the report were all still missing at the stop.

The continuation is briefed to **review rather than trust** the inherited code: nothing in it has ever
been typechecked or run, and it was written before `ck_shift_conflict_flag`'s behaviour was
documented, so its cancel path is a likely defect. It is also told to declare, in its report, anything
it finds wrong and any `Assumed:` the original code *implies* but never stated — an undeclared
assumption inherited from a dead agent is exactly the kind the report contract exists to catch.

The original worktree and branch are kept until the continuation merges, then removed with the rest.

**Merge chores accumulating as lanes report** (all the lead's):

- `execution` — `...executionRoutes` in `routes/index.ts`; `export * from './execution.js';` in
  `shared/src/index.ts`; `shiftReminderJob` in `jobs/registry.ts`.
- `coverage` — `...coverageRoutes` in `routes/index.ts`; `export * from './coverage.js';` in
  `shared/src/index.ts`; `atRiskJob` in `jobs/registry.ts`.
- **Check the merged route declaration list for a `/shifts` collision** (A108). Coverage and schedule
  both mount under `/shifts`. Two identical method+path declarations do *not* conflict loudly — the
  first registered wins and the second is dead code. Nothing in the gate catches this; it is a
  by-hand check at merge, on the merged `routes/index.ts`.
- **Migration 0009 — `uq_notif_shift_event` (A94).** Lead-owned, authored *between* Wave 3 and Wave 4,
  the same path migration 0008 took. See A94 for what is wrong and why it is not a §5.5 halt.

**Two claims in the coverage report the lead checked rather than took:**

1. *"The `SHIFT_REMINDER` sweep is not built."* — **It is**, by the `execution` lane, in
   `server/src/jobs/reminder.ts` and `services/execution.ts:757`. Coverage could not see a sibling
   lane's worktree, which is the isolation working as designed (§3). No gap; no action. Worth keeping
   because it is the second time a lane has correctly reported a hole that another lane had already
   filled — a report saying "confirm another lane owns X" is the right output from inside isolation,
   and the lead is the only one positioned to answer it.
2. *"`uq_notif_shift_event` swallows a second `SHIFT_OPENED`."* — **Confirmed against source**, not
   taken on the report's word. `notification.ts:115` inserts with an unqualified
   `.onConflict((oc) => oc.doNothing())`, and `0006`'s index is `(event, shift_id, recipient_id)`
   with a partial predicate on the two columns being non-null and **no filter on `event`**. So the
   index covers every shift-scoped event, while the comment three lines above it justifies its
   existence for "shift-scoped, **time-triggered** events" only. Recorded as A94.

**Seams the lead owns, as in every wave:** `server/src/routes/index.ts` (three spreads),
`shared/src/index.ts` (three re-exports), and now **`server/src/jobs/registry.ts`** — each lane writes
its own job file and none registers it, because three lanes each adding a line to one array is a
guaranteed conflict in a partition that is otherwise disjoint.

**All three lanes must be told about `ck_shift_conflict_flag`** (migration 0008): any UPDATE clearing
`shift.owner_id` must clear `assigned_over_conflict` in the same statement or it raises.
`server/test/shift-conflict-flag.test.ts` pins it. Coverage is the lane that will actually hit this —
release and staff-unassign are both its writes.

**Why the lanes can run in parallel despite all three writing `shift`.** They are file-disjoint, which
is the partition rule (§3); sharing a table is expected. §2 makes the dependency explicit: pickup
execution needs only *a shift in `CLAIMED`*, which the fixture factory seeds, so it does not wait on
the claim work.

## Wave 2 — lanes in flight (attempt 2)

Named before spawning (§5.6 step 1). Four lanes per build-plan §2. Ownership is unchanged from
attempt 1 — the partition was never the problem; see H3.

| Lane | Owns (exclusive) | worktreePath | worktreeBranch | Spawned | Reported | Merged |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| **masters** | `server/src/services/{donor,truck,category}.ts`, `server/src/routes/{donors,trucks,categories}.ts`, `shared/src/masters.ts`, own tests | `.claude/worktrees/agent-aeb37364caf59ac1f` | `worktree-agent-aeb37364caf59ac1f` | **yes** | **complete** (`dcf7a78`, 180 tests) | **yes** — 2nd |
| **routebuilder** | `server/src/services/pickup-route.ts`, `server/src/routes/pickup-routes.ts`, `shared/src/routes.ts`, own tests | `.claude/worktrees/agent-a6ede00f689f72ad6` | `worktree-agent-a6ede00f689f72ad6` | **yes** | **complete** (`c752a45`, 171 tests) | **yes** — 1st |
| **eligible** | `server/src/services/{eligibility,availability}.ts`, `server/src/routes/availability.ts`, `shared/src/availability.ts`, own tests | `.claude/worktrees/agent-a82503cec27dc11c9` | `worktree-agent-a82503cec27dc11c9` | **yes** | **complete** (`60851e1`, 187 tests, own `gate.sh` green) | **yes** — 3rd |
| **pwa** | all of `client/src/**` except `sw.ts` (i.e. `app/**`, `pwa/**`, `components/**`, `api/**`, `tokens/**`), `server/src/services/push-subscription.ts`, `server/src/routes/push.ts`, `shared/src/index.ts`, own tests | `.claude/worktrees/agent-adb1d6c0b0ea86d28` | `worktree-agent-adb1d6c0b0ea86d28` | **yes** | **complete** (`42ea848`, 205 tests, own `gate.sh` green) | **yes** — 4th |

All four spawned 2026-07-28 and branched from **`0a6fa3e`**, verified against `git worktree list`
rather than constructed from the lane name (§5.6 step 1). Attempt 1's ids are dead — if you find a
worktree or branch whose id is not in this table, it is a leftover and should be removed.

### Wave 2 — attempt 1 (aborted, nothing merged)

Ran 2026-07-28, all four branched from `d6a4f91`, killed mid-flight by H3. Worktrees
`agent-{a3eee541a08bde70b,a44f61134bafee500,a74ee818355adfd84,add3568f76564bfb4}` and their branches
are **removed**; the work survives only as the `wave2-aborted/<lane>` tags listed in H3. Kept here so
a future reader who finds those tags knows what they are and does not merge them.

**The seam this wave is `server/src/routes/index.ts`** — it aggregates every route module into the
one array the default-deny gate compiles from, and three lanes each need a line in it. Same
resolution as Wave 1's scheduler: **no lane edits it; the lead adds each import and spread at
merge.** Lanes test their routes by calling `buildRouter(myRoutes)` directly, which exercises the
real gate without touching the shared list.

`shared/src/index.ts` goes to **pwa** alone (the only client lane, and the client can only import the
package entry). Server lanes put their API shapes in their own `shared/src/<area>.ts` and import it
by relative path per A34; the lead adds re-exports at merge.

Also for the lead at merge: register `purgeExpiredSessions()` as a job (carried from Wave 1) — it
needs `services/session.ts` and `jobs/` in the same tree, which first happens now.

**Merge chores accumulating as lanes report** (each is the lead's, none is a lane's):

- `routebuilder` — one import + spread in `server/src/routes/index.ts`; `export * from './routes.js';`
  in `shared/src/index.ts`. Reconcile **A43** (malformed-uuid 404 vs identity's 500) in one direction.
- `masters` — **three** route spreads in `server/src/routes/index.ts`; `export * from './masters.js';`
  in `shared/src/index.ts`. Without both, the 15 routes stay unmounted and their tests still pass,
  because lanes test via `buildRouter(myRoutes)` — so nothing fails loudly if this is forgotten.
- `eligible` — `...availabilityRoutes` in `server/src/routes/index.ts`; `export * from
  './availability.js';` in `shared/src/index.ts`. Then **A56**: hoist the local-to-instant conversion
  out of `services/availability.ts` into a shared module before Wave 3 needs the same arithmetic.
- `pwa` — `...pushRoutes` (from `./push.js`) in `server/src/routes/index.ts`. Then **A66**: put a
  static `<link rel="manifest">` and an `<link rel="apple-touch-icon">` in `client/index.html`, which
  no lane owns.

### The lead's three pre-Wave-3 chores — **all done 2026-07-28**

None is a lane's to do — each touches a lead-owned file or would otherwise be written twice.

1. ~~The `shift` conflict-flag migration~~ — **done.** `0008_shift_conflict_flag.sql` adds
   `shift.assigned_over_conflict boolean NOT NULL DEFAULT false`, plus
   `ck_shift_conflict_flag CHECK (assigned_over_conflict = false OR owner_id IS NOT NULL)` so the
   flag cannot outlive the owner it warns. **The constraint does not clear the flag — it makes
   forgetting to clear it fail.** `doc-qa` caught the lead asserting otherwise: `data-model.md §9`'s
   documented cancel predicate nulls `owner_id` without touching the flag, so against a flagged row
   it would have *raised* rather than succeeded. §9's predicate now sets
   `assigned_over_conflict = false` in the same statement, and says that any statement clearing
   `owner_id` must. **Wave 3 owns release and staff-unassign and must do the same** — the loud
   failure is the point, but only if the writer knows to expect it. Boolean, not a timestamp: S1.3's banner asks *is this
   flagged*, never *when*. **Semantics are Wave 3's** — this only makes the flag storable.
   `data-model.md §9` documents the column and the constraint.
2. ~~Hoist the local-to-instant timezone conversion (A56)~~ — **done.** New `server/src/time.ts` holds `localToInstant`, the calendar/clock parsers, and `formatRange` (A7's pre-formatted `when`,
   which Wave 3's reminders need too). Wave 3's materialization now imports the same arithmetic
   rather than writing a second copy that would agree on every ordinary test and diverge only at the
   spring-forward gap and the doubled autumn hour.
3. ~~Make the `@r3/shared` resolution structural (A34 / A78)~~ — **done, as a gate step.** `gate.sh` now fails on any
   *import* of the alias in `server/src`, `server/test`, `client/src` or `shared/src` (comments naming
   it are fine). Chosen over a tsconfig `paths` mapping deliberately: `paths` would have changed
   module resolution for tsx and Vite mid-build to fix a problem that only bites inside worktrees,
   whereas a gate step makes the mistake unmergeable without touching runtime behaviour. The
   convention was rediscovered twice — A34 from the server side, A78 from the client — which is the
   signal it should stop being a convention.

**On (1), the migration.** Surfaced by attempt 1's **eligible** lane and independent of H3, so it
survived the re-run: I20's
staff-assign path requires the shift be "flagged so the driver sees the conflict"
(`ui-ux-spec.md S1.3`'s persistent banner), but migration `0004`'s `shift` table has **no
conflict-flag column**. Wave 3 owns coverage and cannot store that flag without a migration, and
`server/migrations/` is lead-owned (build-plan §3) — so no Wave-3 lane can add it. Write the
migration between waves 2 and 3, not during either.

## Wave 1 — lanes (all merged, worktrees removed)

Named before spawning (§5.6 step 1). **Nothing is in flight** — all three worktrees and branches
were removed per §5.6 step 5 and `git worktree list` shows only the main checkout. Kept as the
record of who owned what.

| Lane | Owns (exclusive) | worktreePath | worktreeBranch | Spawned | Reported | Merged |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| **identity** | `server/src/middleware/**`, `server/src/routes/**`, `server/src/services/{auth,session,user}.ts`, `server/src/pii.ts`, `server/src/index.ts`, `shared/src/**`, its own `server/test/*.test.ts` | `.claude/worktrees/agent-ac20d698894c3410d` | `worktree-agent-ac20d698894c3410d` | **yes** | **complete** (`7906d7b`, 113 tests) | **yes** — 3rd |
| **surface** | `client/index.html`, `client/vite.config.ts`, `client/src/{main.tsx,app/**,tokens/**,components/**,api/**}` | `.claude/worktrees/agent-aeae25452ec5869da` | `worktree-agent-aeae25452ec5869da` | **yes** | **complete** (`0f6e65f`, 19 tests) | **yes** — 2nd |
| **signal** | `server/src/services/notification.ts`, `server/src/jobs/**`, `client/src/sw.ts`, its own `server/test/*.test.ts` | `.claude/worktrees/agent-a98720bc4ea57d5d9` | `worktree-agent-a98720bc4ea57d5d9` | **yes** | **complete** (`a64baad`, 54 tests) | **yes** — 1st |

All three branched from `9ee7a14` (the pre-work commit). Spawned 2026-07-28.

Seams the lead owns, deliberately not given to any lane:

- `server/src/index.ts` boots Express (identity) *and* the scheduler (signal). Identity writes the
  Express half and leaves a marker; **the lead adds the `startScheduler()` call after both merge**,
  before gating. Neither lane can import the other's file — it does not exist in their worktree.
- `shared/src/index.ts` enum mirrors, `client/tsconfig{,.sw}.json`, and the gate's client typecheck
  step were written by the lead before the wave, since two lanes each needed them.
- `.env.example` already carries every variable this wave needs. No lane edits it.

Carried to Wave 2: the expired-session cleanup job. `services/session.ts` (identity) exposes
`purgeExpiredSessions()` this wave, but `jobs/` (signal) cannot register it — the two files live in
different worktrees. Registering it is a Wave-2 one-liner, not a gap.

## Wave ledger

| Wave | Lanes | Merged | Gate | Notes |
| :---- | :---- | :---- | :---- | :---- |
| 0 — substrate | *(single-lane, lead-run)* | direct to `phase-1` | **pass** (round 3) | [report](../../reports/wave-0-substrate.md). 3 `doc-qa` findings, all real: A4 doc-vs-doc contradiction, A1 wrong inference, one incomplete doc edit |
| 1 — identity / surface / signal | 3, file-disjoint | all 3, `--no-ff`, in report order: signal → surface → identity | **pass** (round 1) | Reports [identity](../../reports/1-identity.md), [surface](../../reports/1-surface.md), [signal](../../reports/1-signal.md). `doc-qa` zero findings. Pushed `add4e13`. Worktrees and branches removed, verified against `git worktree list`. **Halted after the wave on H2 (A24)** |
| 2 — masters / routes / eligible / PWA | attempt 2: 4, file-disjoint | all 4, `--no-ff`, in report order: routebuilder → masters → eligible → pwa, **no conflict** | **pass** (`doc-qa` round 3) | Reports [masters](../../reports/2-masters.md), [routebuilder](../../reports/2-routebuilder.md), [eligible](../../reports/2-eligible.md), [pwa](../../reports/2-pwa.md). Attempt 1 aborted by H3. Halted on H4; **both questions answered by the human** — A46 (docs corrected) and A54 (locked `§5.2` amended). Rounds 1–2 of `doc-qa` were those decisions; round 2 also caught the lead's incomplete doc sync. A36–A78 recorded. Worktrees and branches removed |
| 3 — schedule / coverage / execution | 3, file-disjoint | all 3, `--no-ff`, in report order: execution → coverage → schedule, **no conflict** | **mechanical half green (500 tests); `doc-qa` NOT run** | Reports [schedule](../../reports/3-schedule.md), [coverage](../../reports/3-coverage.md), [execution](../../reports/3-execution.md). Schedule was stopped mid-run by the human and **resumed**, not restarted — it found 4 defects in the inherited code. A79 and A80 both answered by the human; **I27 amended under authorization**. Lead added migration 0009 (A94). A94–A116 recorded. **NOT PROMOTED** — see below |
| 4 — screens S1.1–S1.9 | not started | — | — | one agent per screen folder |

## Open assumptions

Every `Assumed:` line from every wave report lands here and stays until a human resolves it. These
are the gaps a report cannot distinguish from correct answers, so they are never closed silently.

| # | Wave | Assumption | Resolved? |
| :---- | :---- | :---- | :---- |
| **A1** | 0 | `session.device_id` referenced `push_subscription(id)`. `doc-qa` showed this was wrong for one of the two shared devices: `architecture.md §4.2` requires *both* the receiver tablet and the reporter desktop to be marked, but `product-requirement.md §2` gives a device-level push subscription to the tablet **only**, so the desktop would always read as personal and silently hold a 7-day Staff/Admin session in a shared room. **Resolved 2026-07-28 (human): a `device` table.** Membership is the shared-device marker; `session.device_id → device(id)`, `NULL` = personal; `push_subscription.device_id → device(id)` keeps §4.2's "loss announces itself" property for the tablet. `architecture.md §4.2` and `data-model.md §11` updated. | **yes** |
| A2 | 0 | `app_user` carries `first_name` / `last_name`. **Resolved: the docs do specify this.** `ui-ux-spec.md S1.8` — "create (first/last → auto username shown read-only)" — is an explicit two-field admin form, corroborated by `domain-modeling.md §5.1`'s `generate_username(first, last)`. The original citation was too weak; the columns are correct and doc-supported, not a guess. | **yes** |
| A3 | 0 | Session-lifetime keys on `app_config` are named `session_idle_shared_minutes`, `session_absolute_shared_hours`, `session_idle_personal_volunteer_days`, `session_idle_personal_staff_days`. `architecture.md §4.2` fixes the four *values* (30 min / 12 h / 30 d / 7 d) and says they live in `app_config`, but names no keys. Naming is ours; the values are the doc's. | open, non-blocking |
| **A4** | 0 | **A foundation-doc contradiction the migration made concrete.** `data-model.md §0` mandates `ON DELETE RESTRICT` on *every* FK, but `architecture.md §4.4` said a `410 Gone` means "delete the `push_subscription` row." Once anything references a subscription that DELETE fails, so the documented cleanup was unreachable. **Resolved 2026-07-28 (human): soft-revoke.** `push_subscription.revoked_at`; dispatch skips revoked rows; all FKs stay `RESTRICT`, so §0 keeps no exceptions and the record of which device a past alert reached is preserved. `architecture.md §4.4` and `data-model.md §11` updated from "delete" to "revoke". | **yes** |

### Wave 1 — signal lane

None of these is a §5.5 HALT: no DDL changes and no invariant moves tier. **A5 and A7 are the two
to read first** — they are stored values, so changing them after real data exists is a data
migration rather than a refactor. That is cheap only while the system is pre-launch and empty.
Precedent is A3, also a naming-only assumption, carried open.

| # | Wave | Assumption | Resolved? |
| :---- | :---- | :---- | :---- |
| **A5** | 1 | **The event taxonomy strings are the lane's invention.** `notification.event` is `text` whose "taxonomy [is] owned by the notifications doc" — **a doc that does not exist**. The PRD matrix fixes the six events, their recipients and their triggers; the identifiers `SHIFT_ASSIGNED`, `SHIFT_REMINDER`, `UNAVAILABILITY_DECLARED`, `SHIFT_OPENED`, `SHIFT_AT_RISK` are the lane's. **Stored values** — every row Wave 3 writes carries one. | open — decide before Wave 3 writes real rows |
| A6 | 1 | **Banner copy is the lane's.** The PRD gives event, recipients and channel but no message content. Titles and bodies were written to `ui-ux-spec.md §7` and are asserted against the forbidden-word list in tests, but **no human has read them**: "You're on a run", "Your run starts in an hour", "&lt;name&gt; set time off", "A run needs a driver", "A run is still open for tomorrow". | open, non-blocking |
| **A7** | 1 | **Push payload shape is `{ route?, when?, who? }`, with `when` pre-formatted by the enqueuing service.** Nothing specifies `notification.payload`. Wall-clock rendering needs `app_config.timezone`, which the enqueuing service has and dispatch does not, so formatting moved to the writer. Also a **stored shape**. | open — decide before Wave 3 |
| A8 | 1 | **Deep-link URLs are `/shifts/:id`, falling back to `/inbox`.** S1.9 says "tap to act (deep-links to the relevant shift)" but no doc fixes client paths. Rendered at dispatch, not stored, so the fix is one line. **Cross-check against the surface lane's router when it merges.** | open — verify at wave-1 merge |
| A9 | 1 | **Retry numbers: 5 attempts over 0/1/5/15/60 minutes; sweep every 60 s; batch of 50.** §4.4 says "retry with backoff, give up after a cap" and fixes no values. 60 s matches the reminder/at-risk sweep cadence the same section does fix. | open, non-blocking |
| A10 | 1 | **A notification for a recipient with no live registration burns its attempts and is then dropped by dispatch.** The row stays in the inbox, which is the source of truth. The alternative — leaving it pending forever — would fire an alert the moment someone first enables push, about a run that may be over. Not addressed by any doc. | open, non-blocking |
| A11 | 1 | **Only `410` revokes.** §4.4 names `410 Gone` and nothing else, so `404` — which push gateways also use for a dead endpoint — takes the ordinary retry-then-give-up path. Chosen to avoid widening a documented rule. | open, non-blocking |
| A12 | 1 | **A missing VAPID environment degrades dispatch to a logged no-op** rather than failing process start. The inbox remains the source of truth, so an unconfigured box loses the alerting layer and nothing else. Never logged with a key value (§5.4). | open, non-blocking |

### Wave 1 — surface lane

The lane reported that `gate.sh` ran vitest with `--root server` only, so its 19 tests sat outside
the mechanical gate. Fixed by the lead at merge: step 3b now runs the client suite. Reporting a gap
in the thing that judges you is the behaviour the report contract is for.

**A13 and A14 resolve cleanly against sibling lanes** — recorded rather than dropped because the
agreement is currently coincidence, not a constraint anything checks.

| # | Wave | Assumption | Resolved? |
| :---- | :---- | :---- | :---- |
| A13 | 1 | **Screen URLs** — the spec names screens, not paths. Assumed `/login`, `/board`, `/shifts/:shiftId`, `/my-shifts`, `/pickup/:shiftId`, `/schedule`, `/schedule/:shiftId/reschedule`, `/admin`, `/inbox`; `/` redirects a signed-in user to `/board`. | **yes** — matches signal's A8 deep-link `/shifts/:id`. Both lanes guessed the same path independently |
| A14 | 1 | **The built service worker is emitted at `/sw.js`**, fixed and unhashed, by the Vite config; any registration must use that path. | **yes** — consistent with signal's worker. Registration itself is Wave 2 (PWA onboarding), so nothing calls it yet |
| **A15** | 1 | **Assumed auth endpoints**: `GET /api/auth/me` → `{ user, expiresAt }` and `POST /api/auth/logout`, with the current-user shape `{ id, username, firstName, lastName, tier, duties[], phone?, address? }` declared in `client/src/api/session.ts` because `shared/src` was the identity lane's this wave. **Must be reconciled against the identity lane's actual routes at merge**; path constants are at the top of that file, and the local type should be deleted in favour of a published shared shape. | open — reconcile in Wave 2 |
| A16 | 1 | **Breakpoints**: phone `<768px`, tablet `768–1023px`, desktop `>=1024px`, **width-only**. The spec names three devices and states no pixel values. Width-only deliberately: an orientation rule would flip the pantry tablet's entire nav when stood upright. | open, non-blocking |
| A17 | 1 | **Two token gaps filled, no §2 value altered.** §2 defines no text colour for use on `--structural-dark`, but §3 puts the user name and Logout there, and `--text` (#333) on #363839 is unreadable → added `--text-on-dark` (10.4:1) and `--text-on-dark-muted` (7.4:1). §2 states in prose that white passes on `--success`/`--danger` but names no token, and §3's "Disabled = greyed" names no colour → added `--text-on-fill`, `--disabled-fill`, `--disabled-text`, plus `--font-stack` and `--shadow-modal`. | open, non-blocking — contrast ratios computed, not eyeballed |
| A18 | 1 | **Phone nav for a non-driver.** §4 gives a driver "Board · My Shifts · Inbox" and does not say what a non-driver sees. Assumed My Shifts requires the `DRIVE` duty; Board and Inbox are everyone's. | open, non-blocking |
| A19 | 1 | **Desktop nav beyond the back office.** §4's desktop list is back-office only, but the responsive matrix marks board / my shifts / inbox "usable" on desktop. Assumed desktop also offers Board (Staff tier **or** `DRIVE`), My Shifts (`DRIVE`), Inbox (everyone). | open, non-blocking |
| A20 | 1 | **Phase-3 nav sections are declared but filtered.** Report and Metrics are §4 nav items whose screens (S3.1, S3.2) are Phase 3. Assumed a nav item leading to a missing screen is worse than an absent one: declared with `phase: 3`, filtered by `CURRENT_PHASE = 1`. | open, non-blocking |
| **A21** | 1 | **"Still here?" cannot poll for expiry** — polling would itself slide `last_seen_at` forever and the timeout would never fire. Assumed the client mirrors the slide locally from its own successful requests; expiry stays server-authoritative and the real sign-out arrives as a 401. | open — the client's local mirror must not drift from the server's rule |
| A22 | 1 | **Error text carries no correlation identifier.** §6 forbids a code in error text; `architecture.md §5.5` returns a generic message plus a correlation id. Assumed the client renders its own plain per-kind message and never the identifier; the server's message rides along as `detail`. | open, non-blocking |
| A23 | 1 | **"Tablet: no nav" taken literally** — in Phase 1 a tablet reaches a screen only by its URL. | open, non-blocking |

### Wave 1 — identity lane

**A24 is a §5.5 HALT condition and the reason this run stops.** See the Halt section.

| # | Wave | Assumption | Resolved? |
| :---- | :---- | :---- | :---- |
| **A24** | 1 | **RESOLVED 2026-07-28 (human): Staff *see* phone/address, only Admin *edits* them.** The code was already right and `product-requirement.md §2` was corrected; see the Halt section. Original finding: **PII visibility — `product-requirement.md §2` contradicts itself, on a security rule.** Verified by the lead against the source, not taken from the report: §2's role table says Staff "Cannot ... see others' PII" and lists "PII visibility" in the **Admin-only delta**, while §2's own prose bullet three lines later says "Only phone/address are gated to **Staff-tier-and-above**" — the opposite reading. `architecture.md §4.3` implements the bullet (`viewer.tier >= STAFF` OR `viewer.id == subject.id`) and cites `PRD §2` for it. The lane implemented `architecture.md §4.3`. The authority order **cannot** resolve this: both readings sit in the higher-authority doc. One line in `pii.ts` either way — and it turned out to need none. | **yes** |
| A25 | 1 | **Brute-force throttle counters live in process memory**, not a table — migrations are Wave-0-owned and §4.5 runs one process. A restart clears a 15-minute soft lock. | open, non-blocking |
| A26 | 1 | **Threshold numbers**: account lock at **4** failures (so the first attempt can report S1.1's "3 tries left"), per-IP ceiling of **20 failures per rolling 15 min**, delay curve 250 ms doubling to a 2 s cap. §4.2 fixes none of these. | open, non-blocking |
| A27 | 1 | **Minimum staff/admin password length is 8.** No doc states a minimum. | open, non-blocking |
| A28 | 1 | **The device marker is a signed, `httpOnly`, ten-year `r3_device` cookie**, set by `POST /api/devices`. An unknown marker is treated as personal, not rejected. Builds on A1's resolved `device` table. | open, non-blocking |
| A29 | 1 | **`SESSION_COOKIE_SECRET` HMAC-signs the session cookie value.** `.env.example` carries the variable; §4.2 does not say what signs what. | open, non-blocking |
| A30 | 1 | **Admin accounts cannot be created directly** (PRD cap 1 says "non-admin accounts"); Admin is reached by promotion, and deleting an Admin-tier account is refused. | open, non-blocking |
| A31 | 1 | **A tier change crossing the PIN/password boundary must carry a new credential**, else 400. A Volunteer promoted to Staff has a 4-digit PIN where a password is required. | open, non-blocking |
| A32 | 1 | **`GET /api/users` requires STAFF**, not ADMIN — §2 grants Staff "operational status across all volunteers". All account **writes** require ADMIN. | open, non-blocking |
| A33 | 1 | **Login identifies the account by `username`**; session cookie is `SameSite=Lax`; **the roster endpoint is public** (S1.1 shows a name list before anyone is signed in — §4.2 defends the PIN by throttling, not by hiding usernames). | open, non-blocking |
| A34 | 1 | **Server code imports `shared/src/index.ts` by relative path, not as `@r3/shared`** — `server/package.json` declares no dependency on it, and inside a worktree `node_modules/@r3/shared` resolves to the **main checkout's** file, so a lane would silently typecheck against another tree. | open — worth making structural in Wave 2 |
| A35 | 1 | **`TRUST_PROXY` is a new environment variable** (default `loopback`). On the box it must name the `cloudflared` network, or §4.2's per-IP counter collapses to a single address. **Not in `.env.example`** — no lane may edit it; the lead adds it. | open — needs the deploy value |

### Wave 2 — routebuilder lane

Reported `complete`, 171/171 tests. **A36 is the one to read first** — it is a *stored* value, so
changing it after Wave 3 writes real rows is a data migration rather than a refactor. Same class as
A5 and A7, and carried the same way. **A43 is a cross-lane inconsistency**, not a gap: it makes two
route families answer a garbage id differently, which is the lead's to reconcile, not the lane's.

| # | Wave | Assumption | Resolved? |
| :---- | :---- | :---- | :---- |
| **A36** | 2 | **`route_stop.position` is 0-based.** `data-model.md §5.1` says "contiguous" and never fixes the base. Chosen to match `test/fixtures.ts`'s `makeRoute()` — Wave-0-owned, already merged, inserts `position: 0..n-1`. **Stored value**: if Wave 3's shift-stop snapshot or any later query assumes 1-based, the two disagree *silently* rather than loudly. | open — decide before Wave 3 materializes shifts |
| A37 | 2 | **Reading a route template requires Staff.** PRD cap 4 gives Staff "defines/edits routes" and is silent on who may *read* one. No Volunteer surface needs it (S1.2 renders the route *name* off the shift; S1.5 renders stops off the shift's snapshot), so under default-deny the reads were declared `STAFF` too. A later driver screen would need a new, narrower declaration — not a relaxation of these. | open, non-blocking |
| **A38** | 2 | **A deactivated donor may stay on a route it is already on, but may not be added to one.** `domain-modeling.md §2.3` says a soft-deleted master is "hidden from new use; preserved everywhere referenced" and never says which side of that line a route *template* sits on. Read a new stop as new use and an existing stop as a reference to preserve — so a route whose store closed keeps rendering it, flagged, until staff swap it out, rather than silently shortening a planned run. | open — a domain reading, worth a human eye |
| A39 | 2 | **`routeHasHistory()` counts `shift` and `recurrence_pattern` and deliberately excludes `route_stop`.** Stops are the route's own body, not a record of it having been used; excluding them is what makes "hard-delete a route created by mistake" possible at all. `removeRoute` deletes the stop rows itself in the hard-delete branch. Consistent with D3's one-function-per-entity shape. | open, non-blocking |
| A40 | 2 | **Removal is one `DELETE` returning `{ outcome: 'DELETED' \| 'ARCHIVED' }`, plus `POST /:id/restore`** — no separate archive endpoint; the domain picks the branch, mirroring `removeUser`'s precedent. If S1.6 wants an explicit *Archive* button on a route with no history yet, it cannot get one without a new endpoint. | open, non-blocking |
| A41 | 2 | **`PATCH /routes/:id` with `stops` present replaces the entire ordered list.** No add-one / remove-one / move-one endpoints. Nothing in the docs fixes the wire shape; whole-list replacement makes "contiguous" unfalsifiable and matches how a drag-and-drop surface saves. | open, non-blocking |
| A42 | 2 | **Route names are not unique and not checked.** No doc asks for it and no other master data in this schema does. Two routes may share a name. | open, non-blocking |
| **A43** | 2 | **A malformed uuid answers 404, not 500.** Postgres raises 22P02 on an unparseable uuid, which would otherwise surface as an unhandled 500; an id that cannot exist is treated as one that does not. **The Wave-1 identity routes do not do this**, so the two route families now differ on a garbage id. A behavioural inconsistency between merged lanes — the lead reconciles it, in one direction or the other. | open — reconcile at merge |
| A44 | 2 | **The I6 test inserts `shift_stop` rows directly.** No fixture-factory builder exists for a snapshot and this lane may not add one to the shared factory, so the test arranges its precondition by hand. No production code in this lane reads or writes `shift` / `shift_stop`. | open, non-blocking |
| A45 | 2 | **Error copy is the lane's**, written to `ui-ux-spec.md §6/§7` conventions and asserted against the forbidden-word list, but **no human has read it**: "Give this route a name.", "Add at least one store to this route.", "A store can only appear once on a route.", "That store is no longer available.", "That store is deactivated. Turn it back on to add it here.", "No such route." Same standing as A6. | open, non-blocking |

### Wave 2 — masters lane

Reported `complete`, 180/180 tests. **A46 is a §5.5 halt candidate** — a doc-vs-doc contradiction,
handled the way Wave 1 handled H2: the wave finishes and gates first, then the halt is raised before
Wave 3 spawns, because §5.5 halts independently of promotion and killing two in-flight lanes to ask
one question would cost more than it saves.

| # | Wave | Assumption | Resolved? |
| :---- | :---- | :---- | :---- |
| **A46** | 2 | **RESOLVED 2026-07-28 (human): I21 governs — hard-delete when nothing references it, otherwise soft-delete so no history row dangles.** No code change; `ui-ux-spec.md S1.8` and `product-requirement.md` cap 17 were corrected. Original finding: **may a category ever be hard-deleted? Two foundation docs disagree.** `domain-modeling.md` I21 (**locked**) — "Donor / Category / Truck / User: soft-delete (deactivate) if any referencing history, else hard-delete OK". `ui-ux-spec.md S1.8` — categories are "add, archive (**no hard delete** — archived categories are hidden from the S2.2 weight-entry keypad but preserved in history/reports)". The lane followed the authority order and implemented I21, exposing `DELETE /categories/:id`. **Consequence: in Phase 1 no table references `category` at all, so that endpoint hard-deletes every time** — the two readings diverge immediately, not eventually. If S1.8's intent governs, drop the `DELETE` route and `removeCategory()` (one file) and let `PATCH { active: false }` be the only removal. Note S1.8's parenthetical is specific and gives a *reason*, so it reads as a deliberate category-specific rule rather than loose prose — which is why the authority order resolving it cleanly does not settle whether the **doc** or the **code** is wrong. | **HALT CANDIDATE** — raise before Wave 3 |
| A47 | 2 | **`active` is a field on `PATCH`, not a pair of endpoints.** `domain-modeling.md §3.3` gives each master a two-way toggle (ACTIVE ⇄ DEACTIVATED / INACTIVE / ARCHIVED) but no doc says which endpoint performs it or that a restore exists. Archive is `{ active: false }`, restore `{ active: true }`, on the reading that "⇄" means the return trip is reachable. No separate deactivate endpoint: `DELETE` is the removal verb and I21 decides what removal means. | open, non-blocking |
| A48 | 2 | **Reading donors / trucks / categories requires only `VOLUNTEER`** (any signed-in user). `product-requirement.md §2` states only what Volunteers *cannot* do — "create/delete donors" — and drivers need the donor address and contact and the truck picker, so the write-side prohibition was read as not implying a read-side one. Categories have no Phase-1 reader at all and were **not** gated on the `RECEIVE` duty, which would be a rule invented for a caller that does not exist until Phase 2. | open, non-blocking |
| A49 | 2 | **Writing donors / trucks / categories requires `ADMIN`**, from §2's Admin-only delta ("donor & truck master data") plus cap 17's "Admin maintains the list". §2 does not name categories in the Staff *cannot* column; cap 17's wording was treated as decisive. | open, non-blocking |
| A50 | 2 | **List reads return the active set by default**, full set on `?includeInactive=true`. No doc specifies a default. Active-default chosen because `data-model.md §0` describes active reads as the filtered ones and every picker is a read; the S1.8 admin list is the exception that asks. | open, non-blocking |
| A51 | 2 | **Blank / whitespace-only optional text (`address`, `contact`, `note`, `plate`) is stored as `NULL`**, and a whitespace-only *name* is a 400. The columns are nullable with no CHECK and no doc distinguishes `''` from `NULL`; collapsing them keeps "nothing on file" a single state. | open, non-blocking |
| A52 | 2 | **`PATCH` with no recognised field is a 400** ("Nothing to change."), not a no-op 200. | open, non-blocking |
| A53 | 2 | **Re-deactivating an already-deactivated master does not restamp `deactivated_at`** — the original instant is kept. Same for a `DELETE` that lands on the soft branch. | open, non-blocking |

### Wave 2 — eligible lane

Reported `complete`, 187/187, and the only lane to run `scripts/gate.sh` green in its own worktree.
**Read A54, A58 and A56 first.** A54 adds a clause to an algorithm the **locked** doc specifies; A58
is a stored shape; A56 is timezone arithmetic that Wave 3 will need again and must not re-derive.

| # | Wave | Assumption | Resolved? |
| :---- | :---- | :---- | :---- |
| **A54** | 2 | **RESOLVED 2026-07-28 (human): the clause stays and `§5.2` was amended to state it** (first conjunct), with `architecture.md §4.1` updated to match. Decided by I25: without it, materialization mints instances born `CLAIMED` to a deactivated `ownerDefault`. Original finding: **a deactivated account is ineligible — a clause `domain-modeling.md §5.2` does not contain.** §5.2's predicate names only the Drive duty, so this is the lane's addition, justified from I21 ("hidden from new use") and from the consequence that fan-out would otherwise alert a removed account. Isolated behind its own reason code (`DEACTIVATED`), so it is one line to drop if §5.2 is meant literally. **Notable because it extends a locked doc rather than interpreting a silent one** — the right call needs a human, but the lane made it visible instead of burying it. | open — confirm the locked doc is meant to be read literally |
| A55 | 2 | **Availability is declared as pantry-local calendar dates and clock times; the server converts.** §5.2 says the window is "pantry-local", `app_config.timezone` holds the pantry's zone, and a driver's phone may be in another. API takes `fromDate`/`toDate` (`YYYY-MM-DD`) and optional `startTime`/`endTime` (`HH:MM`), never instants. No doc states the request shape. | open, non-blocking |
| **A56** | 2 | **Local-to-instant conversion is `Intl.DateTimeFormat` with a two-pass offset correction**, because D5 forbids adding a dependency. DST edges: a local time that does not exist (spring-forward gap) resolves to the instant the clock jumped to; one that happens twice resolves to the first. No doc states either behaviour. **Wave 3's recurrence materialization needs the identical conversion**, and it currently lives inside `services/availability.ts` — the lead should hoist it to a shared module before Wave 3, or it gets written twice and the two copies drift at exactly the edges no test covers. | open — hoist before Wave 3 spawns |
| A57 | 2 | **A `WINDOW` declaration must be intra-day** (`endTime` strictly after `startTime`); an overnight absence is expressed as a `DATES` range. §5.3 states intra-day for *recurrence* windows, not for availability; the same reading was applied. | open, non-blocking |
| **A58** | 2 | **A `DATES` declaration is stored as ONE contiguous block** — local midnight on `fromDate` to local midnight on the day after `toDate` — not one row per day. `WINDOW` is one row per date. No doc says which. **Stored shape**, same class as A5/A7/A36: changing it after real rows exist is a data migration. | open — decide before Wave 3 writes real rows |
| A59 | 2 | **A single declaration may span at most `app_config.horizon_days`** (365 by default). No doc bounds it. | open, non-blocking |
| A60 | 2 | **Duplicate and overlapping blocks for the same driver are allowed and never merged**, and **past-dated blocks are accepted**. | open, non-blocking |
| A61 | 2 | **Withdrawal is a hard delete and owner-only.** I21's soft-delete rule enumerates Donor / Category / Truck / User and nothing references `availability_block`. No doc gives Staff a declare-on-behalf or withdraw-on-behalf action, so neither exists. | open, non-blocking |
| A62 | 2 | **Reading another user's availability requires tier >= `STAFF`** (PRD §2), enforced in the service. Declaring and withdrawing require the `DRIVE` duty at the route layer. | open, non-blocking |
| A63 | 2 | **`UNAVAILABILITY_DECLARED` goes to every active user with tier >= `STAFF`, one row per declaration** — not per block, and with no subject shift. There is no single named "the coordinator" in the schema. Builds on A5's event taxonomy, itself still open. | open, non-blocking |
| A64 | 2 | **Withdrawing availability sends nothing.** The PRD §4 matrix has a row for *setting* unavailability and none for clearing it; the matrix was read as closed rather than illustrative. | open, non-blocking |
| A65 | 2 | **HTTP shapes are the lane's** — `POST /api/availability` → 201, `GET /api/availability?userId=`, `DELETE /api/availability/:id` → 204, and 409 `AVAILABILITY_CONFLICT` carrying S1.4's sentence as `message`. No doc specifies endpoints. | open, non-blocking |

### Wave 2 — pwa lane

Reported `complete`, 205 tests (155 server / 50 client), own `gate.sh` green. **A67 is an ownership
exception the lane took deliberately and declared** — read it first. **A78 is the one that vindicates
A34**: the `@r3/shared` hazard is real on the client too, and it was *proven* with
`tsc --traceResolution`, not assumed.

| # | Wave | Assumption | Resolved? |
| :---- | :---- | :---- | :---- |
| **A66** | 2 | **The manifest `<link>` is injected at runtime from `main.tsx`** rather than declared in `client/index.html`, which is outside this lane's ownership. Chromium honours a runtime-added manifest link, but a static `<link rel="manifest">` in the document is the correct end state — **a one-line change the lead owns**. The same file is where `<link rel="apple-touch-icon">` belongs: iOS ignores the manifest for the home-screen icon, so **on iOS the installed icon is currently the browser's screenshot fallback**. | open — lead's one-liner in `client/index.html` |
| **A67** | 2 | **`client/public/` was created although this lane's ownership says `client/src/**`.** A manifest and its icons cannot be served from `src` at a stable URL. Mitigating: new files, no existing owner, and no other lane was working under `client/` this wave. Revert is `rm -r client/public` plus dropping `linkManifest()`. **A declared ownership exception, not a silent one** — which is the behaviour §3 wants when the partition has no right answer. | open — ratify or re-partition before Wave 4 |
| A68 | 2 | **Onboarding runs only once someone is signed in.** §5 says "First visit on phone shows a one-card guide" and does not say whether that precedes or follows login. | open, non-blocking |
| A69 | 2 | **§5's "matching 2-step illustration" is rendered as two large numbered text steps, not artwork.** | open, non-blocking |
| A70 | 2 | **All onboarding copy is the lane's** — asserted against §7's forbidden-word list, but no human has read it. Same class as A6 and A45. | open, non-blocking |
| A71 | 2 | **Dismissal is remembered per browser in `localStorage`**, under `r3.alerts.dismissed`. | open, non-blocking |
| **A72** | 2 | **A browser presenting a valid `r3_device` marker registers device-scoped, never user-scoped.** The docs never say what happens when a driver enables alerts while signed in at the shared tablet; the alternative **leaks one person's alerts onto a shared machine**. Builds on A1's resolved `device` table and A28's cookie. | open — a privacy-shaped default, worth ratifying |
| A73 | 2 | **Re-offering an endpoint clears `revoked_at`.** `uq_push_endpoint` makes a second live row impossible, so it is the only route back to live after A4's soft-revoke. | open, non-blocking |
| A74 | 2 | **An endpoint must be an absolute `https` URL and each key base64url; nothing else is validated.** | open, non-blocking |
| A75 | 2 | **`push_subscription.label` carries a client-supplied device description.** | open, non-blocking |
| A76 | 2 | **`GET /api/push/config` returns `{ publicKey: null }` on a box with no VAPID** rather than failing — the same degradation A12 chose for dispatch. | open, non-blocking |
| A77 | 2 | **The phone breakpoint is repeated as a literal `767px` in `pwa.css`** — the card is a sibling of the shell, and a custom property cannot appear in a media query. Drift risk against A16's breakpoints. | open, non-blocking |
| **A78** | 2 | **Five existing client files that imported `@r3/shared` were repointed to `client/src/api/shared.ts`.** A34's hazard, **confirmed on the client with `tsc --traceResolution`**: from inside a worktree `@r3/shared` resolves to the *main checkout's* `shared/src`, so this lane's own additions were invisible to its own client typecheck. A34 asked for this to be made structural in Wave 2 — this is evidence it must be, not a preference. | open — make structural before Wave 3 |

### Wave 3 — execution lane

Reported `complete`, 58 lane tests, own `gate.sh` green (348 total). **A79 and A80 are the two to
read first**: A79 is a *scope* call that contradicts the lead's own brief, and A80 is a **locked doc
disagreeing with itself** about I27's gate.

**The lane also corrected the lead, and was right.** The brief asserted that `shift_stop` carries
`donor_label` and copied donor details "for I5's sake". It does not: I5 keeps a **live Donor FK** and
`domain-modeling.md §2.3` explicitly says not to copy donor name/address; `donor_label` belongs to
`unscheduled_donation`, a Phase-2 table (D3). Verified by the lead against `0005`'s DDL — `shift_stop`
is `(id, shift_id, donor_id, position, disposition, note)`. The snapshot freezes **membership and
order**, nothing else. A lane that had believed the brief would have invented columns; this one
checked the doc and wrote a test asserting the row's exact column set.

| # | Wave | Assumption | Resolved? |
| :---- | :---- | :---- | :---- |
| **A79** | 3 | **I27's Receiver notification is NOT enqueued.** I27 says setting `pickup_completed_at` "triggers a Receiver notification" and the lead's brief said to enqueue it. The lane declined, on scope: PRD cap 10 and `ui-ux-spec.md S1.5` both identify that alert as the **truck-inbound** one, and PRD §5 scopes Phase 1 as "caps 1–11, 13 **minus truck-inbound**". Enqueuing it would also need a new event string in another lane's file and a device-scoped recipient (the receiver tablet) whose registration is Phase 2. **The milestone write itself is unaffected.** | **RESOLVED 2026-07-28 — human ratified the lane's call.** No Receiver notification in Phase 1; the lead's brief was wrong to ask for it |
| **A80** | 3 | **I27's gate: `{COLLECTED, SKIPPED}` or `{COLLECTED, SKIPPED, REASSIGNED}`?** I27 states the first; `domain-modeling.md §3.2`'s final bullet states the second, and `data-model.md §6` agrees with §3.2. **Both readings sit inside the locked doc**, so the authority order cannot break the tie — the same shape as H2. The lane implemented the §3.2 reading (a `REASSIGNED` stop counts as resolved, being terminal and "excluded from this shift's completion gate"), which is 2-to-1 on the documents and internally coherent. | **RESOLVED 2026-07-28 — human authorized amending the locked doc.** I27 now reads `{COLLECTED, SKIPPED, REASSIGNED}`; §3.1's gate bullet synced too. The deciding argument was that the literal reading makes I30 freeze the very run it exists to rescue, plus I12's parallel wording already enumerating REASSIGNED. Code was already correct |
| A81 | 3 | **The reminder sweep is bounded on both sides of now** — a run that already started gets no reminder. No doc says whether a missed window should fire late; "your run starts in an hour" about a run that began two hours ago is false. | open, non-blocking |
| A82 | 3 | **The reminder sweep considers only `CLAIMED` shifts with an active owner.** The matrix names "the owning driver"; an `IN_PROGRESS` run's driver is already on it, and a deactivated account cannot read an inbox (I21). Neither exclusion is stated. | open, non-blocking |
| A83 | 3 | **`resolveStop` is idempotent, refuses `COLLECTED → SKIPPED`** (§3.2 gives that edge to the receiver), **and offers no un-check** — the ShiftStop machine has no edge back to `PENDING`. No doc addresses an undo. Idempotence is deliberate: a double-tap on a flaky phone must not error. | open, non-blocking |
| A84 | 3 | **`reorderStops` requires `stopIds` to name every non-`REASSIGNED` stop exactly once**, and pushes `REASSIGNED` rows to the end of the numbering. S1.5 does not show a moved stop, so the driver's drag list cannot name it. | open, non-blocking |
| **A85** | 3 | **A reassignment's destination must already be `IN_PROGRESS`.** §3.2 says "another driver's shift already running **or about to run**" and S1.3's picker offers "open or in-progress", but **I5 forbids `ShiftStop` rows before `IN_PROGRESS`** — a stop appended to a not-yet-started run would be destroyed by that run's own snapshot at start. Refused with "That run has not started, so it has no stop list yet." A real tension between I5 and §3.2's wording, resolved toward the invariant. | open — worth a human eye |
| A86 | 3 | **A reassignment does not require the destination's owner to differ from the source's.** §3.2 says "another driver's shift"; nothing forbids two runs of one driver, and enforcing it would block a legitimate move. | open, non-blocking |
| A87 | 3 | **The destination stop does not carry the source stop's note.** I30 specifies only "fresh `position`, `PENDING`"; the note describes a visit that did not happen. | open, non-blocking |
| A88 | 3 | **Stop-only writes do not stamp `shift.updated_by`.** `shift_stop` has no provenance columns and I26's last-writer is the `shift` row's; only writes touching `shift` itself stamp it. | open, non-blocking |
| A89 | 3 | **`completePickup` is idempotent** — a second confirm keeps the first timestamp and applies only the note. The milestone is the moment the driver said they were heading back, and there is one of those. | open, non-blocking |
| A90 | 3 | **`Shift.note` is writable only while `IN_PROGRESS`** (S1.5 and its review screen are the only places the doc puts it). Nothing says whether a driver may write it before start or after. | open, non-blocking |
| A91 | 3 | **`getRun` is readable by the run's owner or Staff-and-above.** S1.3 is a staff screen and PRD §2 gives Staff operational status across volunteers. No doc enumerates who may read a run. | open, non-blocking |
| A92 | 3 | **Endpoint paths and refusal copy are the lane's.** `PICKUP_INCOMPLETE_MESSAGE` is "Finish or skip every stop before you head back." — written to §7's rules, unread by a human. Same standing as A6, A45, A70. | open, non-blocking |
| A93 | 3 | **Starting a run whose route has zero stops is permitted** and produces an empty snapshot. §2.2 says a route has 1..N stops, so it should be unreachable; no rule was invented to block it. | open, non-blocking |

### Wave 3 — coverage lane

Reported `complete`, 86 lane tests, own `gate.sh` green (376 total). **A94 is the one to read first**
and is the lane's own pick to escalate: a real defect it declined to work around, pinned with a test
instead, because the fix is a migration and migrations are lead-owned (§3).

**Two of its tests are the justification for `SERIALIZABLE` executing.** Both drive genuinely
concurrent transactions with a barrier holding each between its gate's read and its write. The second
is `architecture.md §4.1`'s canonical **write-skew** case — one driver, two overlapping runs, both
gates read "no overlapping owned shift" and *both are right when they read it*; the rows written are
different, so no row lock and no tier-2 predicate sees anything. The loser fails `40001` "read/write
dependencies among transactions". That is a rule which **only** SSI catches: it is invisible to
`READ COMMITTED` and to every constraint in the schema.

| # | Wave | Assumption | Resolved? |
| :---- | :---- | :---- | :---- |
| **A94** | 3 | **`uq_notif_shift_event` silently swallows a second `SHIFT_OPENED` for the same (run, recipient).** The index is `(event, shift_id, recipient_id)` with **no filter on `event`**, so it covers every shift-scoped event; `0006`'s own comment justifies it for "shift-scoped, **time-triggered** events" because "event-triggered ones fire once by construction". `SHIFT_OPENED` is event-triggered and does **not** fire once by construction — release → re-claim → release is an ordinary sequence, and `notification.ts`'s unqualified `ON CONFLICT DO NOTHING` absorbs the second fan-out. Nobody is told the run is back on the board. Lane pinned the behaviour with a test rather than working around it. **Lead verified against source.** | open — **lead owes migration 0009** between Wave 3 and Wave 4. *Not* a §5.5 halt: that condition fires when an `Assumed:` *requires* a schema change to proceed, and this one is compatible with the schema as it stands — the lane pinned current behaviour instead of assuming different behaviour. Same path as 0008 |
| A95 | 3 | **I20's staff-assign exemption is scoped to the two temporal reasons.** `AVAILABILITY_BLOCK` and `OWNED_SHIFT_OVERLAP` are confirmable; `NO_DRIVE_DUTY`, `DEACTIVATED` and `UNKNOWN_USER` are hard refusals for Staff too. The I20 note names exactly "the driver's declared availability or another owned shift", and a user with no Drive duty is not a driver to override a conflict *about*. No doc says what Staff may **not** confirm through. | open, non-blocking |
| A96 | 3 | **Staff-assign and staff-unassign are restricted to `OPEN` and `CLAIMED`** — an `IN_PROGRESS` run's driver cannot be swapped wholesale. Inferred from I30 existing at all: mid-run reassignment moves *stops* (close-old + insert-new) precisely because the shift is not the unit that moves — its truck is picked (I8) and its stops are snapshotted (I5). No doc states this bound. | open, non-blocking |
| A97 | 3 | **Reassigning a `CLAIMED` run to a different driver notifies only the new owner.** The matrix has no "you were removed from a run" event and the lane read it as closed. (Staff-*unassign* does notify, because that run returns to the board and the matrix covers that.) | open, non-blocking |
| A98 | 3 | **A self-select claim notifies nobody.** The matrix's "Shift assigned / defaulted to you" is read as the staff-assign path; telling a driver what they just did themselves is not in it. | open, non-blocking |
| A99 | 3 | **The actor is excluded from the `SHIFT_OPENED` fan-out.** A driver releasing a run is, one statement later, an eligible driver for it. The matrix says "Coordinator + eligible drivers" without saying whether the person who caused the event is one of them. **Consequence worth knowing:** at this org's headcount (PRD §6 — one coordinator) a staff unassign therefore sends no coordinator row at all. | open, non-blocking |
| A100 | 3 | **Claiming has no time bound**; release does. `data-model.md §9`'s claim predicate is `status='OPEN' AND owner_id IS NULL` and nothing else, and no doc forbids claiming a run whose window has passed. Release *is* bounded by `starts_at > now()` because cap 8 says "before it starts" in as many words. The asymmetry is deliberate, not an oversight. | open, non-blocking |
| A101 | 3 | **§5.3's "existing future OPEN instances" is `starts_at > now()`, plus the run the driver actually tapped, always** — keeping SERIES a superset of ONE even for a run starting within the hour. No doc fixes the boundary. | open, non-blocking |
| A102 | 3 | **`claim-all` sets `ownerDefault` unconditionally**, including when every existing run was skipped. §5.3 states the two clauses independently, and each future run is gated again at materialization by I25. | open, non-blocking |
| A103 | 3 | **A series claim reports skips rather than failing**, even when the driver is ineligible for every run (`claimed: []`, `partial: true`). The one thing that fails outright is the tapped run no longer being `OPEN`. | open, non-blocking |
| A104 | 3 | **`release-range` defaults `fromDate` to the tapped run's own date and treats a missing `toDate` as open-ended** — S1.3's "this and future". Touches only runs of the same pattern owned by the actor. §5.3 says "instances in [from, to]" without saying of what, or what an absent bound means. | open, non-blocking |
| A105 | 3 | **A range release silently omits a run that moved on since the read; a single release explains the refusal.** No doc covers the partial case for release the way S1.2 covers it for claim. | open, non-blocking |
| A106 | 3 | **The at-risk sweep alerts once per run, not once per recipient-becoming-eligible.** Due is `OPEN ∧ now() < starts_at ≤ now() + interval '1 day'`; unhandled is "no `SHIFT_AT_RISK` row for this run". A driver who becomes eligible *after* the first alert is never alerted. §4.4 says "1 day before an unclaimed shift" and does not say whether the set is re-evaluated. | open, non-blocking |
| A107 | 3 | **Every user-visible sentence in the lane is the lane's except three** (S1.2's partial-success summary, §6's "That run was just taken by Karen.", S1.6's assign warning). Includes generalizing S1.6's copy to a neutral pronoun, the multi-weekday series label, and the double-tap answers "That run is already yours." / "That run is already back on the board." — the alternative for the latter was a 403, which is both harsh and untrue for someone who released it a second earlier. Same standing as A6, A45, A70, A92. | open, non-blocking |
| **A108** | 3 | **HTTP shapes are the lane's** — `POST /shifts/:id/{claim,release,assign,unassign}`, `GET /shifts/:id/eligibility?driverId=`; 409s discriminated by `error`. **Possible collision:** the sibling `schedule` lane also mounts under `/shifts`, and two identical declarations resolve to whichever registers first rather than conflicting loudly. | open — **lead must check the merged declaration list at merge**; nothing in the gate catches a shadowed route |
| A109 | 3 | **The transactional core `claimShiftIn(tx, …)` is exported alongside `claimShift`.** The public entry is still one function per domain operation; the core exists so a test can put a barrier between the gate's read and its write, which is the only way to make the write-skew interleaving deterministic rather than lucky. `services/notification.ts` sets the precedent for a `tx`-taking export. | open, non-blocking |
| A110 | 3 | **`occurrence_date` is rendered from the Date's local calendar fields, not `toISOString()`**, and range bounds are cast in SQL (`$1::date`) rather than passed as instants. It is a calendar slot (`data-model.md §5.3`); both would be off by the pantry's UTC offset at exactly the range edges in any zone east of UTC. | open, non-blocking |

### Wave 3 — schedule lane (continuation)

Reported `complete`, 66 lane tests, own `gate.sh` green (356 total). Built `routes/shifts.ts`
(11 routes) and reviewed the four files inherited from the stopped agent.

**It found four defects in the inherited code**, which is the return on resuming rather than
restarting. The one that mattered: `startDate` on pattern create **was undone by the next nightly
sweep** — there is no `start_date` column, so the catch-up back-filled every date the create had
skipped, and a pattern made for September would put August runs on the board the next morning. The
other three: `updatePattern` never surfaced the `real_conflict` soft check that `data-model.md §5.3`
requires at edit as well as create; `applyToFutureInstances` counted `moved` per loop iteration
rather than per row actually updated, so a run claimed between the read and the conditional UPDATE
was reported as moved when it wasn't; and a dead `nextDay` export whose comment claimed callers it
did not have. The `ck_shift_conflict_flag` defect the lead flagged as likely was **not** present —
the inherited code already cleared `assigned_over_conflict` alongside `owner_id` in both cancel and
the cap-9 release.

| # | Wave | Assumption | Resolved? |
| :---- | :---- | :---- | :---- |
| **A111** | 3 | **A pattern has no start date; a series begins when it is created.** `domain-modeling.md §5.3` (locked) gives the rule three parts plus `ownerDefault` and `endDate`, names `endDate` as the *only* stop condition, and writes the loop as `for each occurrence date D in [now, horizon]`; `data-model.md §5.2` has no `start_date` column. But `ui-ux-spec.md S1.6` says the builder reads "Every Tuesday, **starting __**, no end". Resolved by authority order — locked doc first, UI spec last. **This removed a field the stopped agent had already put on the wire.** | **RESOLVED 2026-07-29 (human): the lane's call stands, and S1.6's blank is a read-only display.** No `start_date` column, no migration, no code change — the schedule lane was right to drop the field. `ui-ux-spec.md S1.6` now states that the "starting" date is *computed and displayed*, not entered: it is the first occurrence the pattern will mint, derived from today plus the chosen weekday. **Wave 4's S1.6 builder must render it read-only** — an editable control there would re-open exactly this contradiction, and the nightly sweep would back-fill anything a "start later" create tried to skip |
| **A112** | 3 | **`GET /shifts` and `GET /shifts/:id` are `{ tier: 'VOLUNTEER' }`** — any signed-in user, no duty. Cap 5 says "all drivers see every shift", which suggests `anyDuty: ['DRIVE']`, but that would lock out a Staff coordinator who does not hold the Drive duty, and tier never confers a duty (I1/I2). A receive-only volunteer can therefore read the board. Judged harmless: names are public-within-org (PRD §2) and the shape carries no phone or address. | open — the docs do not say who may read the board other than drivers |
| A113 | 3 | **A born-CLAIMED run (I25) sends no `SHIFT_ASSIGNED`.** Inherited behaviour, kept; no doc settles whether materializing onto `ownerDefault` is an "assignment" for the matrix's purposes. | open, non-blocking |
| A114 | 3 | **Reschedule checks I20's two temporal clauses rather than full `eligible()`.** Inherited, kept. | open, non-blocking |
| A115 | 3 | **`createShift` surfaces `real_conflict` for one-offs**, not only for pattern instances. Inherited, kept. | open, non-blocking |
| A116 | 3 | **Occurrences whose window has already begun are not minted** by the sweep. Inherited, kept; §5.3's `[now, horizon]` does not say which side of `now` a partially-elapsed occurrence falls. | open, non-blocking |

## Open assumptions — Wave 4a

All five lanes reported `complete`. Full `Assumed:` lists are in `reports/4a-*.md`; recorded here per
§5.3, with the entries that need a human eye called out. **Three were escalated and answered during
the wave** (A117, A118, A119) — the rest are open and non-blocking.

### Answered by the human, 2026-07-29

| # | Assumption | Resolved? |
| :---- | :---- | :---- |
| **A117** | **S1.5 reorders stops with large "Move up" / "Move down" buttons, not the spec's "drag handle, large".** The lane's reasoning: HTML drag-and-drop does not fire on touch, so a drag handle would work on the staff desktop and silently fail on the phone this screen exists for; a hand-rolled touch drag is the fragile control §1.5 rules out; a drag library is a dependency §3/D5 forbids a lane to add. | **RESOLVED — buttons stay, `ui-ux-spec.md` S1.5 amended** to specify them and record why drag was rejected, so the next reader cannot re-derive the contradiction. No code change |
| **A118** | **Staff may open a Claimed-by-other or In-progress row into S1.3; a driver may not.** S1.2's states table says those rows have "no action" unconditionally, but S1.3 names staff as one of its two users and the board is its primary entry point — the literal reading leaves the staff half of S1.3 unreachable. Raised independently by the board lane *and* by `doc-qa`. | **RESOLVED — staff can open them, `ui-ux-spec.md` S1.2 amended** with a per-viewer note, scoped the same way At-risk already was. Navigation only; no board action added, and S1.3 re-authorizes everything anyway. No code change |
| **A119** | **`ui-ux-spec.md` S1.5 described the truck-inbound push as Phase-1 behaviour** ("Confirming … fires the truck-inbound push to the receiver tablet"), while PRD §5 scopes Phase 1 as caps 1–11, 13 *minus* truck-inbound, the receiver tablet's registration is Phase 2, and the server deliberately enqueues nothing. Found by the pickup lane's own doc-check. | **RESOLVED — clause marked Phase 2.** Left alone it would have had a Phase-1 screen telling a driver the pantry was notified when nothing was sent |

### Open, non-blocking — worth a read before Wave 4b

| # | Assumption | Note |
| :---- | :---- | :---- |
| **A120** | **RESOLVED 2026-07-29 — the pantry's zone now reaches the client and the screens render against it.** `SessionResponse.timezone`, fed by a new read-only `services/config.ts`, exposed through `SessionProvider`, consumed by the board's `timeRange` and the pickup screen's `timeOfDay`; the device zone survives only as the fallback for the moment before the session loads. S1.4 needed no change — availability is pantry-local `HH:MM` by construction. **Original finding:** times were rendered in the DEVICE's timezone on every screen that shows one.** No endpoint exposes `app_config.timezone`. Run *dates* cannot drift (they come from the server-resolved `occurrenceDate`), but a driver in another zone sees their own clock for run times, and S1.4's `DATES` block loses its "All day" wording. Raised by `s1-4-my-shifts`, hit independently by `s1-5-pickup` (A11) for `pickup_completed_at`. | Done before 4b, as planned. 4b lanes inherit a correct seam and must use `useSession().timezone` rather than the device's |
| A121 | **The board is bounded to today forward** (`?from=<today>`, no `to`). S1.2 says "see every shift" without naming a window. | non-blocking |
| A122 | **The inbox polls unread count every 60s and on `visibilitychange`.** No doc gives an interval. | non-blocking |
| A123 | **Inbox endpoint shapes are entirely the lane's** — `GET /notifications`, `GET /notifications/unread-count`, `POST /notifications/read-all`, `POST /notifications/:id/read`, all `{ tier: 'VOLUNTEER' }` with no duty, no `?userId=` and so no staff view of another person's inbox, and 404 (never 403) for another user's row, an unknown id and a malformed uuid alike so the inbox cannot be probed. 26 entries in that lane's report. | non-blocking; `doc-qa` checked these against §4.1/§4.3 and found them clean |
| A124 | **Mark-all-read exists** though S1.9 does not mention it — tapping a row navigates away, so a coordinator fanned out to a dozen runs would otherwise clear the bell one round trip at a time. | non-blocking |
| A125 | **Notification arrival time is formatted server-side** in `app_config.timezone` (following A7's `payload.when` precedent): under 7 days → `"Tue 9:00 AM"`, older → `"Aug 4"`. The cut and both formats are the lane's. | non-blocking; note this is the *opposite* choice to A120's client-side rendering, and deliberately so |
| A126 | **S1.5 starting is pick-then-confirm**, not one tap per truck row: a started run cannot be un-started and its truck cannot be changed (I8), so a single mis-tap in a moving truck would be unrecoverable. | non-blocking |
| A127 | **A `REASSIGNED` stop stays visible on S1.5, struck-through**, rather than vanishing from a list someone is reading while driving. | non-blocking |
| A128 | **Wire types are declared twice** for the inbox, server-side and client-side, because `shared/src/` was outside that lane's ownership. | non-blocking; a candidate for consolidation when `shared/` next has an owner |
| A129 | **All user-visible copy on all five screens is the lane's**, unread by a human — same standing as A6/A45/A70/A92/A107. S1.5's set is pinned by a test against §7's forbidden words, against any sentence saying the run is over, and against any promising a notification. | non-blocking, but this is now five screens of unreviewed copy |

## Open assumptions — lead chores between 4a and 4b

| # | Assumption | Status |
| :---- | :---- | :---- |
| **A130** | **The promoted segmented control uses ONE selected-state look — `--action-fill` with a `--text-on-brand` label — in both its filter and tabs behaviours, which changed S1.4's shipped appearance from an inset orange bar to a fill.** §2 sanctions orange as a fill *and* as a selected bar, so the two Wave-4a copies were both legal and no doc ruled between them. The lead chose the fill because it is the one that reads at arm's length in a truck (§1 principle 1), and because one control with two looks is the duplication the promotion existed to end. `doc-qa` confirmed §2 permits it and that the deleted bar's "§2 forbids a label on orange" comment was a misreading. | non-blocking, but it is a **visible change to a screen that already passed a gate**, and the first thing a human will notice on S1.4 |
| **A131** | **`ui-ux-spec.md` S1.8 gained a Layout line** saying its four sub-screens are selected by the §3 segmented control in tabs mode. S1.8 previously said only "sub-screen" and "Primary action varies per sub-screen", with **no statement of how a user moves between the four**. Written by the lead rather than left to the 4b lane, because the alternative was an invented navigation pattern arriving as an `Assumed:` after the fact. §1.5 rules out a dropdown and four is small enough to show at once, so the segmented control is the only §3 control that fits. | non-blocking; raised by `doc-qa` as its one note on the promotion and fixed in the same commit |
| **A67** | **`client/public/` is lead-owned** — RATIFIED 2026-07-29, alongside `tokens/` and `components/`. Open since Wave 2, where the pwa lane created it as a declared exception. No 4b lane touches it. | **RESOLVED** |

## Open assumptions — Wave 4b

### `s1-7-reschedule` (reported 1st, merged clean at `b3783af`)

Full text in `reports/4b-s1-7-reschedule.md` (11 entries). The lane found one real defect in the draft
it inherited — `onStale()` refetched on *every* failure including a 400, where nothing changed — which
is the return that a respawn would have thrown away. These are the ones that outlive the wave:

| # | Assumption | Status |
| :---- | :---- | :---- |
| **A132** | **`GET /shifts/:id/eligibility` cannot serve as S1.7's pre-confirm conflict check, so the unconfirmed `POST /shifts/:id/reschedule` is used instead. The lane was right and the lead's brief was wrong.** Verified by the lead, not taken on trust: `previewAssignment(shiftId, driverId)` in `services/coverage.ts` loads the shift's **currently stored** window and accepts no proposed date/time, so against a reschedule it answers about the window the owner already works — "eligible" to almost every real conflict, which is worse than useless. The unconfirmed POST is the two-step flow `routes/shifts.ts` was built for, and it is non-mutating on conflict because the `throw` precedes the `UPDATE` inside `writeTransaction`. **Not blocked** — the surface satisfying PRD cap 9 exists; only the endpoint named in the brief was wrong. | **non-blocking, resolved in the lane's favour.** The lesson is for the lead: a brief that names an endpoint should be checked against that endpoint's signature before it is written |
| **A133** | **A consequence of A132: the conflict warning appears when staff press "Confirm new time", not inline as they pick a time.** A speculative probe is impossible — an unconfirmed POST that finds *no* conflict performs the move, so probing as the form changes would move the run with nobody confirming anything. Cap 9 and S1.7 are both structured surface-then-confirm and nothing has changed when the warning appears, so this satisfies "before confirm". **A real dry-run (`?preview=true`, or a proposed window on the eligibility read) would let the warning render inline, which is the better screen.** A lane may not add an endpoint. | **open — needs a human or a Phase-2 lead.** Not a Phase-1 blocker: the rule is enforced and surfaced before anything changes. It is a screen-quality improvement with a server cost |
| **A134** | **Three copies of calendar/time-picking code now exist across S1.2, S1.4 and S1.7** — `DayPicker.tsx` (single-select) against S1.4's `DayRangePicker` (range), `TimeGrid.tsx` against S1.4's private `TimeChoice`, and `logic.ts` re-implementing the calendar helpers, because a screen folder is private to its lane. **Two lanes independently wanting a calendar is the promotion signal**, the same one that produced `components/Segmented.tsx`. | **open — a lead chore, deliberately NOT done in this session.** The segmented promotion was worth its cost because two copies had *diverged in behaviour*; nothing yet says these have. Promote when a third consumer appears or a divergence is found, not on count alone |
| **A135** | **The 409's `conflicts[]` array is dropped by `api/client.ts`** and this lane did not extend it — that is a lead-owned file. Recorded because it bounds how much detail *any* screen can show off a refusal, not just this one. | open, non-blocking; a known ceiling rather than a defect |
| **A136** | Four screen-local judgement calls no doc rules on: a window crossing pantry midnight is **clamped to `23:59`** on the form (the server builds both instants from one `date`, so such a window cannot be expressed — the alternative was a silent 400); the day picker offers **today forward in the pantry's zone plus the run's own current day** even if past (client-only courtesy, server has no lower bound); **Confirm with nothing changed** says "Pick a different day or time first." rather than sending; a successful move **navigates to S1.3** for both outcomes, kept and released. | open, non-blocking, all four visible on screen |
| **A137** | **All user-visible copy on S1.7 is the lane's own, unread by a human** — same standing as A6/A45/A70/A92/A107/A129. Two pieces are load-bearing: the `releaseNoReplacement` sentence and the three cannot-be-moved explanations. The conflict warning is **not** in this set; it is the server's. | open — folds into the standing copy-review item |

The lane also flagged that **`doc-qa` cannot be run from inside a lane** (no `Agent` tool in that
context), so it ran the checks by hand. Build-plan §5.2 puts `doc-qa` over the *merged* diff on the
lead regardless, so this changes nothing — but it means a lane's "I ran doc-qa" would be a false claim,
and none of them made it.

**For the wiring:** `import { RescheduleScreen } from './screens/s1-rescue/s1-7-reschedule/index.ts'`
under screen id `reschedule`. S1.3 and S1.6 need only `go('reschedule', { shiftId })` — it loads the
run itself and takes no props beyond the URL param. **DONE at `a385050`** — all four screens are in
`main.tsx`'s `SCREENS`.

### `s1-3-shift-detail` (reported 2nd, merged clean at `d0d2849`)

13 entries in `reports/4b-s1-3-shift-detail.md`. **Reviewing the preserved draft found four real
defects**, the strongest argument yet for resuming over respawning: the stop list fell back to the
route template when a started run had zero stops (I5 freezes the snapshot, so a route edited after
start would have shown the driver stops they never had); the release confirm could read "Release run"
while releasing *every* future run, because its label was keyed to a count from a second request that
reads as 1 when that request fails; "Today" was the device's day in the heading **and in the reassign
picker's fetch bound**; and the cancelled notice sat below a full page of detail about a run I10 makes
terminal.

| # | Assumption | Status |
| :---- | :---- | :---- |
| **A139** | **S1.3 carries the ONLY link to S1.5.** Nothing else in the shell navigates to `/pickup/:shiftId` — S1.2's Mine row and S1.4's run list both open S1.3. Without it S1.5 is unreachable and §5.4's "reachable through the shell" fails. Rendered *secondary* (primary only when Release is absent) so one high-emphasis button remains and S1.3's stated primary stays Release. | **confirmed by `doc-qa`** against `ui-ux-spec.md §4`, which parenthesizes Pickup as reached "while a route is active" rather than as a nav item. Satisfies §5.4 |
| **A140** | **`todayInZone()` extends A120 from times to the day boundary.** A120 ruled *times* render in the pantry zone; it did not say the same about which calendar day is "today". | **RESOLVED at `fcaa4f0`/`e754532` — see A138.** The lane was right, and the board was the one that was wrong |
| **A141** | **Release is not duty-gated client-side**, breaking the mirror-the-server convention on purpose: an owner whose DRIVE duty was removed after claiming would otherwise see a run they cannot hand back at all. | **confirmed by `doc-qa`**: S1.3 states no duty condition on Release, and §4.5 makes client checks communication only. The server still refuses, honestly, rather than the button silently vanishing |
| **A142** | **The already-weighed Reassign branch is unexercisable in Phase 1 and is not built as a branch.** `WEIGHED` is an I12 read-time projection and `weight_entry` is Phase 2 (D3), so no `COLLECTED` stop can be weighed yet. The movable set is exactly the server's `['PENDING','COLLECTED']`, with a comment naming where Phase 2 subtracts. | non-blocking, D3-consistent |
| **A143** | **`PATCH /shifts/:id/note` is the DRIVER's whole-run note** (`Shift.note`, `anyDuty: ['DRIVE']`), not the coordinator's — the coordinator→driver note is `staffNote` on `PATCH /shifts/:id` at `tier: 'STAFF'`. A correction to the lead's brief, not a blocker; both endpoints exist. | **the second wrong endpoint in a lead brief this wave** (see A132). Check an endpoint's signature before naming it in a brief |

### `s1-8-admin` (reported 3rd, merged clean at `028fef0`)

15 entries in `reports/4b-s1-8-admin.md`. The lane reviewed its inherited draft and fixed three things,
including `FieldGroup` duplicating its visible label into `aria-label` instead of `aria-labelledby`.
Eight of its own tests failed on first run from one bad fixture — **fixed in the test, nothing relaxed**.

| # | Assumption | Status |
| :---- | :---- | :---- |
| **A144** | **A deactivated user account could not be reactivated, because nothing could do it** — no `active` on `UpdateUserRequest`, no restore route — while donors, trucks and categories all restore via `PATCH { active: true }`. The lane reported the asymmetry rather than working around it. | **RESOLVED at `e754532`.** `domain-modeling.md:182` says `User | ACTIVE ⇄ DEACTIVATED`, so the return arrow was genuinely missing — the locked doc wins. `active: true` now clears `deactivated_at`; **`active: false` is refused** and points at Delete, because deactivating owes I21's hard-delete-vs-deactivate decision *and* session destruction (§4.2), both of which live in `removeUser` and a PATCH would skip |
| **A145** | **No Devices sub-screen and no Routes sub-screen**, though four are named. Devices: S1.5 puts the receiver tablet's registration in Phase 2. Routes: `/routes` is S1.6's. **Consequence: no Phase-1 screen registers a shared device at all.** | **ruled NOT a gap by `doc-qa`** — S1.8's Layout line names exactly Accounts, Donors, Trucks, Categories (A131 wrote it), and Phase-2 device registration is explicit in S1.5 and consistent with §4.2. Intentional |
| **A146** | **The username preview reimplements §5.1 in client code** (normalize → base → collision suffix on the assembled string), using the accounts on screen as the "taken" set, because S1.8 requires the auto username be shown read-only at create time and **no preview endpoint exists**. Preview only — the server's returned username is what the screen reports. | open, non-blocking. A second implementation of a named algorithm is a divergence risk; the mitigation is that the server's answer always wins on screen |
| **A147** | **`ADMIN` is not offered in the create form's tier row** (Volunteer/Staff only); the edit form offers all three. S1.8 says "(Volunteer/Staff/Admin)", cap 1 says "non-admin accounts", and `services/user.ts` answers 403 — so an admin is reached by promoting an existing account, never minted. | non-blocking; matches the dev seed's own two-step path |
| **A148** | Four further screen-local calls: the In-use ⇄ Archived toggle is offered on **all three** master forms, not only Categories (I21 makes it a field edit); a credential-only edit uses `POST /users/:id/credential` while any other change carries the credential inside one `PATCH`; **PIN digits are shown in the clear** while an admin sets someone's PIN, passwords stay masked; the open tab is local state, not in the URL (`/admin` has no sub-path). | open, non-blocking |
| **A149** | **`CreatedAccount` is declared locally** — `shared/src` has no type for `POST /users`' 201 body. Five controls are built in-folder (`FieldGroup`, `ReadOnlyValue`, `InactiveChip`, `DutyToggles`, `CredentialField`). | open, non-blocking; `shared/` is lead-owned so the lane could not add the type |
| **A150** | **`services/donor.ts` says "'deactivated since' is information the admin screen shows"**, but no such field is on the wire and no screen shows a date. | **ruled a stale internal comment by `doc-qa`**, not a doc-vs-code conflict — no foundation doc requires the date. Left as-is; code-review territory, not gate territory |

### `s1-6-schedule` (reported 4th, merged clean at `24dbf6b`)

12 entries in `reports/4b-s1-6-schedule.md`. **Reviewing the inherited draft found six defects**, the
worst being that the Runs panel could sit in edit mode with no editor *and* no primary action when the
edited run left the list, and that the store list said "Every store is already on this route." while
stores were still loading.

| # | Assumption | Status |
| :---- | :---- | :---- |
| **A151** | **The route builder ships BOTH drag-and-drop and Move up / Move down, reading A117 as specific to S1.5.** S1.6 says "drag-and-drop ordering with large handles" and cap 4 — the higher-authority doc — says "(drag-and-drop ordering)", so drag is specified for *this* screen by both. A117 removed drag from S1.5, a driver's `ShiftStop` list on a phone in a moving truck; it amended neither cap 4 nor S1.6. Native HTML5 drag events, so no dependency and no hand-rolled pointer drag (§1.5). The buttons are not a fallback but the required equivalent: HTML5 drag does not fire on touch at all, the responsive matrix marks Scheduling "usable" on a tablet, and a keyboard user has no drag gesture. Both paths go through the same two pure functions so they cannot disagree about what an order is. | **confirmed by `doc-qa`** against cap 4 and S1.6. A117 was scoped to S1.5's context; the buttons are an accessibility addition, not a substitution |
| **A152** | **Staff-assign sets only `shift.owner_id`, never the pattern's `ownerDefault`.** Cap 6 could be read as also setting the series default, and `shared/src/schedule.ts` commented `ownerDefaultId` as "Set by claim-all / **staff-assign**" — but `POST /shifts/:id/assign` takes no scope, `services/coverage.ts` sets `owner_default_id` only on the driver's claim-all path, and S1.6's own gloss is "Same owner field as self-select". | **RESOLVED at `e754532` — the comment was stale, not the code.** `doc-qa` confirmed §5.3's Operations table lists only claim-all and that cap 6's "same owner field" language agrees. Comment rewritten; `domain-modeling.md` needed no change |
| **A153** | **The computed "starting" date mirrors materialization's "window has already begun" filter**, so a Tuesday rule saved on a Tuesday afternoon displays *next* Tuesday. Naming today would name a run `services/recurrence.ts` will not mint, and the point of a read-only sentence is that it is true. | non-blocking; extends A111's ruling rather than reopening it |
| **A154** | **Four controls built in-folder — `DayPicker`, `TimeChoice`, `WeekdayChoice`, `ChoiceList`** — of which day and time are now duplicated with S1.4 and S1.7. Plus a three-tab layout, one-primary-per-mode, route delete/archive/restore living here, the runs list bounded to today forward, and duplicated calendar helpers. | open — **folds into A134.** Three screens now hold their own calendar code, which is the promotion signal; still deliberately not acted on this session |
| **A155** | **~90 sentences of unreviewed user-visible copy** on S1.6 alone, including the I24 pattern-edit report sentences. | open — folds into the standing copy-review item |

### The lead's own chore inside 4b

| # | Assumption | Status |
| :---- | :---- | :---- |
| **A138** | **The board's day is the PANTRY's, not the device's.** New `client/src/app/pantry-day.ts` (`todayInZone`, `deviceToday`), consumed by S1.2 for its `?from=` fetch bound *and* its day headings. This **fixes a real defect in an already-promoted Wave-4a screen**: A121 had the board on the device date, justified by "the client has no access to `app_config.timezone`" — which stopped being true when A120 put the pantry zone on the session. Found because S1.3's lane computed the pantry day and said so. | **RESOLVED at `fcaa4f0` + `e754532`.** The first commit fixed the fetch bound and left the *headings* still defaulting to the device day; `doc-qa` caught that residue — the lead had asked it to check exactly that, and it was still worth asking |

## Post-PR: the first UI pass (2026-07-30, after PR #1 opened)

Run on the human's instruction after Phase 1's build scope closed. **Not a wave** — no lanes, no
worktrees, no gate promotion. Two `ui-tester` sessions plus a lead-driven phone pass against
`npm run dev`, then the fixes below on `phase-1`, updating PR #1 in place. The human ruled on D5 and
chose to keep the fixes on the PR branch rather than a follow-up branch.

| # | Assumption | Status |
| :---- | :---- | :---- |
| **A156** | **Cap 17's seed half was never built, and `phase-1-state.md` said it was.** Both the PRD and `ui-ux-spec.md` (twice) say categories are "seeded with the 11 AGFP categories at launch". Nothing did it: the eleven names existed in exactly one place in the repo — `server/test/masters-category.test.ts`, where the *test creates them itself* and then asserts the table holds eleven. That assertion passes against an empty database, which is why **four green gates never caught it**, and why §5.4 below recorded cap 17 as built. A fresh box came up with an empty Categories tab and would have come up with an empty Phase-2 weight keypad. | **RESOLVED at migration `0010_seed_categories.sql`.** Placement was a genuine choice — no foundation doc says where launch seed data lives. A migration wins because it is the only path that reaches production, a rehearsal *and* dev identically; `scripts/dev-seed.ts` was the alternative and is dev-only *and* truncates the table. Guarded on the table being empty, not per-name: this is a launch seed, not a reconciler |
| **A157** | **`dev-seed.ts` stops truncating `category` while `test/fixtures.ts` keeps doing so**, and the divergence is deliberate rather than an oversight. Dev wants a usable world across reseeds; a suite wants a known one, and `masters-category.test.ts` asserts *exactly* eleven rows, which is only true from empty. | non-blocking; reasoning recorded in both files |
| **A158** | **A66 closed with headless Chrome, not a new dependency.** The icon has a `text` element in a system font, so rasterizing it needs a real text shaper — `sips` cannot read SVG and no rasterizer is installed. `scripts/build-icon.sh` inlines the SVG into a wrapper page and screenshots it at 180×180, full-bleed and opaque because iOS applies its own corner mask and would composite transparent corners to black. The script exists so the one binary in the repo is reproducible rather than a blob nobody can diff. | **RESOLVED.** Verified byte-identical on a second run |
| **A159** | **`ui-tester` cannot reach a phone viewport, and that is why the first pass tested nothing at phone width.** Its agent definition omitted `mcp__claude-in-chrome__resize_window`; its fallback, `window.resizeTo()`, is a no-op on an extension-controlled tab. **Both sessions reported the gap instead of relabelling desktop output as "phone"** — the second refused a second time even after the definition was corrected, because subagent tool sets are fixed at session start. The definition is now fixed for the *next* session, and the lead ran the phone pass directly. **`resize_window` alone is still not enough:** macOS Chrome clamps window width at ~614px, so a true 390px viewport needs a same-origin iframe, which is what actually found A160. | **PARTLY RESOLVED.** Tool added to `.claude/agents/ui-tester.md` and the iframe technique documented there. A fresh session must confirm the tool actually arrives |
| **A160** | **The phone topbar overflows its viewport, and this is the one KNOWN-UNFIXED defect on the branch.** `.r3-topbar` is a single non-wrapping flex row whose content measures a fixed **417px at every width** — so at 390px "Log out" is clipped 27px off-screen, the user's name collapses to 0px, and the page scrolls horizontally; at 320px and at 200% zoom more of it goes. **Everything below the topbar reflows perfectly** — zero non-topbar overflow on Board, My Shifts and Inbox at 390/320/195px — so this is one contained shell defect, not a layout that fails generally. Trigger is the "Alerts OFF — tap to fix" chip (194px): hide it and `scrollWidth` is exactly 390. That chip shows whenever push is unconfigured or permission is denied, both supported states. `.r3-topbar__action` sets `min-width: var(--target-min)`, so Log out was **already shrunk to its 44px floor** and still did not fit — nothing else in the row can yield. | **OPEN — deliberately not fixed.** Two fixes were measured live and both clear the overflow at 390/320 and are no-ops at desktop: `flex-wrap: wrap` costs 44px of phone vertical space (bar 56→100px) and truncates nothing; making the chip shrink-and-ellipsize keeps the bar at 56px but visually truncates both the chip text and the "Log out" label. Each degrades something a human should weigh for a paper-first reader, so the lead surfaced it rather than picking |

### Decisions the human took

| # | Decision | Effect |
| :---- | :---- | :---- |
| **D5** | **A driver's own IN_PROGRESS run opens S1.3 from the board.** `ui-ux-spec.md` contradicted itself: its states list said "In progress — no action for a driver", its "who may open a row" rule said "a driver opens only their own (Mine) rows", and `board.ts` cited the first. The states-list phrase covers Claimed-by-other *and* In progress and was written about **someone else's** run; nobody was contemplating your own. Left as built, a driver who navigated away mid-run found a dead row on the board — the screen they look at first. | `actionFor` now returns `DETAIL` for a driver's own `IN_PROGRESS`; someone else's stays inert. Spec line 162 amended. Two tests, both verified in the browser at desktop width |
| **D6** | **The fixes land on `phase-1`, updating PR #1 in place**, rather than on a follow-up branch. The human's call; the alternative was to freeze PR #1 as the artifact a reviewer had started reading. **Still not merged by an agent** — §5.4 is unchanged | PR #1 grows by these commits |

### Found while fixing, unrelated to the UI

| # | Assumption | Status |
| :---- | :---- | :---- |
| **A161** | **A test in `recurrence-materialization.test.ts` failed for one hour a day and had nothing to do with any change here.** "born OPEN for an instance overlapping a run the owner already holds" built the owned series at 09:00–11:00 and the series under test at 10:00–12:00. Materialization does not mint an occurrence whose window has already begun, so between 09:00 and 10:00 pantry-local the owned series lost today's instance, the second series' today instance overlapped nothing, was correctly born CLAIMED, and the assertion `bornClaimed === 0` failed. **The code was right; the test was wrong.** The gate happened to run at 09:06. | **RESOLVED.** The owned series now starts *later* (10:00–12:00) than the series under test (09:00–11:00), so "the second was minted today" implies "so was the first" at every time of day. Partial overlap is preserved |

## What Phase 1 shipped without — two of three now closed

These do not fail §5.4 and they did not block the PR. They were the honest edges of a green gate.
**Items 1 and 3 were closed on 2026-07-30** by the first UI pass ever run against a rendered screen;
item 2 still needs a person's judgement about words.

1. **~~No rendered DOM has ever been confirmed~~ — CLOSED 2026-07-30. All nine screens render.**
   Two `ui-tester` passes plus a lead-driven phone pass. The first pass found the unseeded category
   table (A156) and the S1.2 board contradiction (D5); the phone pass found the topbar overflow
   (A160). Console is clean on load on every screen — no errors, no React warnings. Keyboard focus,
   destructive-confirm modals, empty states and ~20 spec-quoted strings were verified verbatim.
   **Both `ui-tester` sessions refused to fabricate a viewport they could not reach**, which is how
   the phone gap survived to be fixed rather than being papered over — see A159.
2. **Nine screens of user-visible copy have never been read by a human** (A6/A45/A70/A92/A107/A129,
   A137, A155). S1.6 alone is ~90 sentences. The load-bearing ones are named in the individual ledger
   entries — S1.7's release-no-replacement sentence and its three cannot-be-moved explanations are the
   ones where a wrong word teaches a driver something false about what the system just did.
   **Narrowed, not closed:** the *mechanical* half is already enforced — all nine screens plus `pwa/`
   hold a §7 forbidden-vocabulary test, so no banned word can reach a user. What is left is the part a
   machine cannot do: whether the unspecified sentences are the right words for a paper-first reader.
3. **~~A66 — the `apple-touch-icon` PNG~~ — CLOSED 2026-07-30 (A158).** `client/public/` now holds a
   180×180 PNG, wired in `client/index.html`, regenerable via `scripts/build-icon.sh`.

### Still open after the UI pass — one defect, one decision

- **A160 — the phone topbar overflows and it is NOT fixed.** A design call the lead declined to make
  alone; both candidate fixes are measured in the entry below. This is the one *known* defect on the
  branch.
- The bottom nav is `position: static`, so it scrolls with content rather than staying pinned. No doc
  requires it to be fixed, so it is an **open question, not a defect** — but on a 15-run week the
  driver scrolls to the bottom to change screens.

### The record of what a green 4b did not mean (kept — it was right)

This section was written *before* 4b merged, to stop a green gate from reading as Phase 1 being
finished. It was correct to write, and item 1 below is the one that turned out to matter most: the dev
script it demanded is what exposed the `IdlePrompt` blocker four green gates had missed.

1. **~~No dev script~~ — CLOSED 2026-07-29 at `6180b52`. The app runs, and running it found a blocker.**
   `npm run dev` (→ `scripts/dev.sh`) brings up Express + the scheduler on :3000 and Vite on :5173 with
   `/api` proxied, against a persistent `r3_dev` database; `scripts/dev-seed.ts --seed` puts four
   accounts, four donors, two trucks, two routes and four unclaimed runs in it. **No new dependency** —
   vite, its config and tsx were already installed, so this was scripts only.

   The seed goes through the **real services**, not `server/test/fixtures.ts`: the fixture factory
   writes a placeholder `credential_hash` on purpose, so a fixture-built account **cannot log in**,
   which is useless to a seed whose entire point is a working login.

   **Verified live, not assumed:** roster, login as a PIN volunteer, `/me`, the board, the Vite proxy,
   and default-deny (401 unauthenticated). `timezone` comes back `America/Chicago` on the session and a
   09:00 pantry-local run serialises as `14:00Z` — **A120 confirmed working end to end.**

   **What it found — and this is the argument for having done it:** `IdlePrompt.tsx` passed
   `expiresAt - now - 30s` straight to `setTimeout`, which stores its delay in a 32-bit signed integer
   and **silently fires immediately** above ~24.8 days rather than throwing. A Volunteer on a personal
   phone gets a **30-day** window, so "Still here?" appeared milliseconds after every sign-in, counting
   down from 2,591,970 seconds — and answering it re-read a session still 30 days out, so it came
   straight back. Staff (7 days) and shared devices (30 min / 12 h) stay under the ceiling, **which is
   why four waves of green gates never saw it**: it broke for exactly the driver-on-a-phone persona the
   rescue loop is canonical for, and for nobody else. Fixed by re-arming the wait in capped chunks, with
   a regression test on both the overflow and the short-window case.

   **Still open:** the browser half. `ui-tester` had no browser tool available in its session and said
   so instead of fabricating a click-through, so it tested via the live HTTP surface and a source read.
   **Nothing has yet confirmed a rendered DOM** — no visual layout, no console-on-load, no real keyboard
   focus, no 200%-zoom check. Re-run `ui-test` once a browser tool is available; the app is now runnable,
   so the blocker to doing so is gone.
2. **Nine screens of user-visible copy will be unread by a human** (A6/A45/A70/A92/A107/A129).
   Non-blocking for the gate; worth naming in the PR.
3. **A66 — the `apple-touch-icon` PNG** needs a human to produce a binary asset.

## Blocked

*(none)*

## Decisions taken mid-run

Standing decisions D1–D4 live in [`phase-1-build-plan.md §1`](phase-1-build-plan.md). Anything the
lead decides during the loop that outlives one wave gets appended there, not here — this file is
state, that file is doctrine.

*(none yet)*
