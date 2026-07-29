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
| Current wave | **2 — attempt 2, re-spawned after H3** |
| Wave status | wave 1 **passed** and pushed (`add4e13`); H2 resolved 2026-07-28; wave 2 **attempt 1 aborted** by H3 (environment lockout) with nothing committed and no lane report; worktrees archived and removed, baseline re-gated green at `0d91d12`; **attempt 2 in flight, all four branched from `0a6fa3e`**, awaiting reports |
| Branch | `phase-1` |
| Loop armed | **yes** — re-armed 2026-07-28 after H3 cleared |
| Consecutive gate failures | 0 (no wave-2 gate has run; wave 1 passed on the first round) |
| Halted | no — H3 cleared |

## Halt

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
  `phase-1`. Delete them once wave 2 passes its gate.

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

## Wave 2 — lanes in flight (attempt 2)

Named before spawning (§5.6 step 1). Four lanes per build-plan §2. Ownership is unchanged from
attempt 1 — the partition was never the problem; see H3.

| Lane | Owns (exclusive) | worktreePath | worktreeBranch | Spawned | Reported | Merged |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| **masters** | `server/src/services/{donor,truck,category}.ts`, `server/src/routes/{donors,trucks,categories}.ts`, `shared/src/masters.ts`, own tests | `.claude/worktrees/agent-aeb37364caf59ac1f` | `worktree-agent-aeb37364caf59ac1f` | **yes** | — | — |
| **routebuilder** | `server/src/services/pickup-route.ts`, `server/src/routes/pickup-routes.ts`, `shared/src/routes.ts`, own tests | `.claude/worktrees/agent-a6ede00f689f72ad6` | `worktree-agent-a6ede00f689f72ad6` | **yes** | — | — |
| **eligible** | `server/src/services/{eligibility,availability}.ts`, `server/src/routes/availability.ts`, `shared/src/availability.ts`, own tests | `.claude/worktrees/agent-a82503cec27dc11c9` | `worktree-agent-a82503cec27dc11c9` | **yes** | — | — |
| **pwa** | all of `client/src/**` except `sw.ts` (i.e. `app/**`, `pwa/**`, `components/**`, `api/**`, `tokens/**`), `server/src/services/push-subscription.ts`, `server/src/routes/push.ts`, `shared/src/index.ts`, own tests | `.claude/worktrees/agent-adb1d6c0b0ea86d28` | `worktree-agent-adb1d6c0b0ea86d28` | **yes** | — | — |

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

### The lead owes a migration before Wave 3 spawns

Surfaced by attempt 1's **eligible** lane and independent of H3, so it survives the re-run: I20's
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
| 2 — masters / routes / eligible / PWA | attempt 1: 4 spawned, **0 merged** | none — no lane committed or reported | — | **Attempt 1 aborted by H3**, a macOS TCC lockout, not a gate or spec failure. Work preserved as `wave2-aborted/*` tags, worktrees and branches removed, baseline re-gated green at `0d91d12`. Attempt 2 re-spawned from `0d91d12` |
| 3 — schedule+recurrence / execution | not started | — | — | Coverage stays single-owner |
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

## Blocked

*(none)*

## Decisions taken mid-run

Standing decisions D1–D4 live in [`phase-1-build-plan.md §1`](phase-1-build-plan.md). Anything the
lead decides during the loop that outlives one wave gets appended there, not here — this file is
state, that file is doctrine.

*(none yet)*
