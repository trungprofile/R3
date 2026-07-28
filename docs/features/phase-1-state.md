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
| Current wave | **1 — 3 lanes in flight** |
| Wave status | spawned; awaiting reports. Lead pre-work merged as `9ee7a14`, gate green before spawn |
| Branch | `phase-1` |
| Loop armed | **yes** — armed 2026-07-28 |
| Consecutive gate failures | 0 (reset on pass; wave 0 took 3 gate rounds) |
| Halted | no |

## Halt

*(none — H1 cleared. A1 and A4 were decided by the human on 2026-07-28; see Open assumptions.)*

## Wave 1 — lanes in flight

Named before spawning (§5.6 step 1). `worktreePath` / `worktreeBranch` are filled in from the
spawn result the moment each agent starts; after a compaction this table plus `git worktree list`
is the only record that these lanes exist.

| Lane | Owns (exclusive) | worktreePath | worktreeBranch | Spawned | Reported | Merged |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| **identity** | `server/src/middleware/**`, `server/src/routes/**`, `server/src/services/{auth,session,user}.ts`, `server/src/pii.ts`, `server/src/index.ts`, `shared/src/**`, its own `server/test/*.test.ts` | `.claude/worktrees/agent-ac20d698894c3410d` | `worktree-agent-ac20d698894c3410d` | **yes** | — | — |
| **surface** | `client/index.html`, `client/vite.config.ts`, `client/src/{main.tsx,app/**,tokens/**,components/**,api/**}` | `.claude/worktrees/agent-aeae25452ec5869da` | `worktree-agent-aeae25452ec5869da` | **yes** | — | — |
| **signal** | `server/src/services/notification.ts`, `server/src/jobs/**`, `client/src/sw.ts`, its own `server/test/*.test.ts` | `.claude/worktrees/agent-a98720bc4ea57d5d9` | `worktree-agent-a98720bc4ea57d5d9` | **yes** | — | — |

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
| 1 — identity / surface / signal | not started | — | — | |
| 2 — masters / routes / eligible / PWA | not started | — | — | |
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

## Blocked

*(none)*

## Decisions taken mid-run

Standing decisions D1–D4 live in [`phase-1-build-plan.md §1`](phase-1-build-plan.md). Anything the
lead decides during the loop that outlives one wave gets appended there, not here — this file is
state, that file is doctrine.

*(none yet)*
