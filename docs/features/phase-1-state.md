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

## Blocked

*(none)*

## Decisions taken mid-run

Standing decisions D1–D4 live in [`phase-1-build-plan.md §1`](phase-1-build-plan.md). Anything the
lead decides during the loop that outlives one wave gets appended there, not here — this file is
state, that file is doctrine.

*(none yet)*
