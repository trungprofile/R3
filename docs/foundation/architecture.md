# R3 — Architecture

**Purpose.** Defines *how R3 runs*: where domain rules are enforced, how identity and access work, what happens outside a request, what the deployed system is made of, and how it is operated. Owns what the other foundation docs defer here — the "service layer" `Data Model` cites a dozen times, the credential/session model `Data Model §3` leaves out, and the job mechanics.

Deliberately **high-level**: shapes, rules, and the reasoning behind them. Per-endpoint contracts belong to the API doc; per-feature mechanics to the implementation doc written just before that feature is built. Reconciled against the PRD, `Domain Modeling` (locked, wins on any mismatch), `Data Model`, and the `UI/UX Spec`. Invariant citations (I#) verified against `Domain Modeling §4`.

---

## 1. Context

R3 is the system of record for Amazing Grace Food Pantry's weekly food-rescue cycle — rescue → receive → report — replacing a paper-and-phone process (`PRD §1`). The operating envelope is deliberately tiny: ~15 pickups per week, ~4 drivers on personal phones, one shared receiver tablet, one shared reporter desktop, peak concurrency ~5 and a ceiling under 10. Every choice below is sized to that envelope; where a conventional answer only pays off at larger scale, this doc declines it explicitly rather than silently.

---

## 2. Goals & non-goals

**Goals.**

1. **Domain invariants enforced server-side**, at the lowest layer that can express them (§4.1). The UI never carries a rule.
2. **The shared-device pattern works safely** — a tablet and desktop used by many people in turn, where sessions must be genuinely revocable (§4.2).
3. **One person can operate it on one self-hosted box** — deploy, migrate, restore (§5).
4. **The system fails visibly rather than quietly.**

**Non-goals**, stated so they are not re-litigated in review:

| Non-goal | Consequence |
| :---- | :---- |
| Horizontal scale | No stateless-session requirement; §4.2 is free to use server-side sessions |
| Multi-tenant | No tenant scoping anywhere |
| High availability | Single instance; a restart is acceptable downtime |
| Offline support | The service worker is for push only and must never fake offline behavior (`UI §6`) |
| Real-time beyond web push | No websockets, no live-updating board |
| Full audit history | Last-writer provenance only (I26); promote to a full trail only if NTFB disputes require it |

---

## 3. Constraints (given, not decided)

- **Stack:** PERN — PostgreSQL, Express, React, Node.
- **Hosting:** self-hosted on AGFP's Ubuntu server, containerized with Docker. No first-party cloud services for the application.
- **Delivery:** responsive web, packaged as a PWA.
- **Web push** is the one accepted external dependency.
- **Public internet exposure** — drivers use the app on personal phones during pickups.
- **Trusted-organization population.** The threat model is untargeted internet automation, not a motivated adversary targeting AGFP.

The last two together shape §4.2: a trusted population justifies a weak credential (4-digit PIN), but public exposure means that credential's security rests on **rate limiting**, not secrecy.

---

## 4. Design

### 4.1 Invariant ownership & concurrency

`Data Model` defers to "the service layer" for I5, I11, I12, I17, I20, I27, I29, I30 and several immutability rules, without that layer being defined anywhere. This section defines it.

#### The three enforcement tiers

| Tier | Mechanism | Expresses | Limit |
| :---- | :---- | :---- | :---- |
| **1** | DB constraint — `CHECK`, `UNIQUE`, `NOT NULL`, FK `RESTRICT` | single-row facts, uniqueness sets | cannot see other rows or prior state |
| **2** | Conditional `UPDATE` predicate | state transitions, where legality depends on the **prior** state | only predicates over the row being written |
| **3** | Service layer, inside a transaction | cross-row / cross-table predicates | it is only code — holds solely if every write path uses it |

**Placement rule: push every invariant to the lowest tier that can express it; move up only when the predicate genuinely cannot be expressed lower.** Tiers 1–2 are unbypassable and race-proof by construction, holding even against someone typing SQL directly. Tier 3 is as good as the discipline of every caller and no better — which is why it needs its corollary:

**Exactly one service function per domain operation, and no other code path writes those tables.** Without it, "the service layer enforces I12" is a sentence, not a guarantee.

| Tier | Invariants |
| :---- | :---- |
| **1** | I1, I2, I3 (uniqueness + format), I4, I7, I8, I16 (all three clauses, including I16(c) as `ck_ud_confirmed_category`), I19, I21, I22, I26, I28; plus `ck_shift_owner`, `ck_ud_source_exclusive`, `uq_shift_occurrence`, `uq_notif_shift_event`, `ck_config_trash_rates`, `ck_donor_trash_rates`, `uq_category_trash_key` |
| **2** | I9 (cancel-guard), I10 (terminal states), claim/start atomicity, weight-void idempotency |
| **3** | I3 (immutability — no update path), I5, I6, I11–I15, I17, I20, I23–I25, I27, I29, I30 |

Tier-2 predicates live in `Data Model §9` and are not restated here.

**The trash deduction is not an invariant and is deliberately absent.** It is a **read-only derivation** (`domain-modeling.md §5.4`) — it writes nothing, so no tier guards it. The risk it carries is not a race but a **disagreement**: the weekly report on screen and the printed receipt are two views of the same pounds, and a food bank submission that does not match the screen it was read off is the failure this system exists to end. That risk is handled structurally rather than by testing for it — **both views roll up from one function** (`computeRange(from, to)` in `services/report.ts`, `computeWeek` before `D41` widened its window), which is the only place rounding or deduction happens, so drift is unrepresentable rather than merely unlikely. Same instinct as §1's native enums, applied to a derivation. The remaining guards are the conservation equality in §5.4 and a regression test that the two views still agree.

**Filing a receipt is tier 1, and the key is the whole of it (`D35`).** `meal_connect_submission`'s composite primary key `(pickup_date, donor_id)` means two reporters ticking the same store cannot produce two rows — the service ticks with `ON CONFLICT DO NOTHING` and the first writer stands. This is a place where the constraint is not a backstop behind a service check but **the only check there is**, which is why it is stated here: nothing in `services/` re-derives "already filed", it simply lets the key answer. Both writes go through `writeTransaction` like every other write, and both routes declare `anyDuty: ['REPORT']` — a duty, not a tier, exactly like the rest of the report, because filing with the food bank is a job someone is given rather than a rank they hold.

**Neither submission route is window-gated.** `D9`'s receiver edit window governs *correcting intake*; this records what a person did at another organisation's web form, and a fortnight filed three weeks late is precisely the case the check-off exists for.

Metrics (S3.2) is the deliberate exception: it reads **gross** and shares none of this path.

**I18 is absent from the table by design.** "WeightEntry and UnscheduledDonation are peer records, neither referencing the other" is enforced by the *absence* of an FK — no tier can express it, because there is no write to guard. It holds as long as nobody adds the column, which is a review concern, not a runtime one.

#### Transaction boundaries

**The service layer owns transactions: one per use case.** Not route handlers, not repositories — a tier-3 invariant is sound only when its read and its write share a transaction. Route handlers do authentication, input parsing, and response shaping, and contain no domain rules.

#### Isolation: SERIALIZABLE for all write transactions

Tier-3 gates are read-then-write, which under READ COMMITTED admits **write skew**: two transactions read overlapping data, each writes a *different* row, and the combination violates an invariant neither write violates alone.

The canonical R3 case is I20. A driver double-taps Claim on two overlapping runs; both transactions read "no overlapping owned shift" — true when each reads it — both update a different `shift` row that is legitimately `OPEN`, and both commit. Tier 2 passed, tier 1 cannot express a relationship spanning two rows in two transactions, and the tier-3 gate was true when read.

**All write transactions therefore run at `SERIALIZABLE`.** Postgres's SSI tracks read/write dependencies among live transactions and aborts one when the result could not have arisen from any serial order.

The standard objection — throughput collapse under contention — does not apply at <10 users and ~15 pickups/week, where the realistic serialization-failure rate is near zero. What it buys is correctness that does not depend on a developer remembering to pair every cross-row gate with a transition predicate. **An invariant enforced by the database beats one enforced by convention**, which is decisive in a codebase written largely by AI agents.

Three obligations follow:

1. **Retry on `SQLSTATE 40001`**, from the start so every read is re-taken, bounded at ~3 attempts. A serialization failure is not an error condition; it means "run that again."
2. **No external side effects inside a write transaction** — no push, no email, no outbound calls, since a retry would repeat them. This independently forces the notification design in §4.4.
3. **Every write transaction must be `SERIALIZABLE`** — a stray READ COMMITTED writer on the same data undermines the guarantee. Read-only queries may use the default.

#### `eligible()`

A tier-3 service function (`Domain Modeling §5.2`), evaluated at claim, availability-declaration, and materialization. Deliberately **not** evaluated at staff-assign — the I20 exemption, where Staff is warned and may confirm through a conflict.

Its first conjunct is that the driver is **active** — a soft-deleted account (I21) is ineligible. That clause carries its weight at materialization, not at the gates: a deactivated account cannot sign in, so it never reaches claim or availability-declaration, but I25 would otherwise keep minting instances born `CLAIMED` to a pattern's long-deactivated `ownerDefault`. The notification fan-out filters deactivated accounts in its own query as well, so that path is covered whether or not it routes through `eligible()`.

---

### 4.2 Auth & sessions

#### Credentials

Volunteers use a **4-digit PIN**, Staff/Admin a **password**. The split is a UI constraint, not a security judgment: `UI §1` principle 5 requires numeric entry on a large on-screen keypad, and a password on a keypad is unusable for the target users. Staff/Admin work on a desktop with a real keyboard and hold higher-value accounts.

- **The PIN is set by the admin at account creation** to the last four digits of the volunteer's phone; four random digits where no phone is on file.
- **PINs are not unique and uniqueness is never checked.** Login is name-first (`UI §5`), so the account is identified before the PIN is compared. Enforcing uniqueness would leak information at account creation and shrink the keyspace as accounts grow.
- **No forced PIN change.** Accepted trade: the default is derivable from data Staff can see, but forcing a change costs a step for a population `UI §5` describes as older and low tech-tolerance. Throttling carries the load instead.
- Credentials are stored as hashes with a slow KDF. A 4-digit space cannot be made strong by hashing; the hash limits damage from database disclosure, throttling limits online guessing.

#### Session mechanism: server-side, in Postgres

An opaque random session identifier in an `httpOnly`, `Secure`, `SameSite` cookie; the session record lives in a `session` table. Every request resolves identity by lookup.

**Not JWT.** Stateless tokens buy validation without shared state across a fleet, and horizontal scale is an explicit non-goal (§2). Meanwhile nearly every session requirement in `UI §5` is a **revocation** requirement:

| Requirement | Server-side session | JWT |
| :---- | :---- | :---- |
| Logout on the shared tablet | delete the row | deletes the client copy only; token stays valid until expiry |
| Inactivity timeout | compare `last_seen_at` | needs per-request reissue — session tracking in disguise |
| Admin deactivates a user (I21) | next request fails | works until expiry |
| Tier/duty change | next request sees the new value | token holds a stale authorization snapshot |

The cost — a lookup plus a `last_seen_at` write per request — is sub-millisecond against a database on the same box. **Storage is Postgres**, not in-process memory (which loses every session on deploy, dumping a receiver mid-weighing) and not Redis (a second container earning nothing here).

**This doc owns the `session` table**, alongside the credential and PII columns `Data Model §3` defers here:

| Field | Purpose |
| :---- | :---- |
| id | opaque random token, the cookie value |
| user_id | FK to `app_user`, `ON DELETE RESTRICT` |
| device_id | FK to `device`, `ON DELETE RESTRICT`; **nullable — null means unregistered, i.e. personal**. Determines lifetime policy |
| created_at | absolute-cap anchor |
| last_seen_at | idle-timeout anchor, slid on each authenticated request |
| expires_at | resolved expiry, whichever of idle/absolute binds first |

#### Device classification

Session rules differ by device (`UI §5`: shared devices time out fast and never persist; personal phones stay signed in for weeks), but an HTTP request carries no trustworthy statement of what device sent it — user-agent strings are forgeable and cannot distinguish the pantry's tablet from a volunteer's. Devices are therefore **marked** during a one-time setup, and the design question is which set to enumerate, since the unenumerated set becomes the default.

**Decision: enumerate the shared devices** — an admin registers the receiver tablet and reporter desktop; anything unregistered is personal. The set is small and fixed at two.

**The registry is a `device` table, and membership in it *is* the shared-device marker.** `session.device_id` references it: non-null means a registered shared device (30 min idle / 12 h cap), null means unregistered and therefore personal. The marker cannot instead hang off `push_subscription`, because `PRD §2` gives a device-level push subscription to the **tablet only** ("additionally holds") and no event in the notification matrix targets the reporter desktop — so a desktop would never have a subscription row, would read as personal, and would silently hold a 7-day Staff/Admin session on a machine in a shared room. That is precisely the failure this section exists to prevent.

This direction's failure mode is the unsafe one: a lost marker (browser data cleared, tablet reset) silently makes the pantry tablet "personal," holding weeks-long sessions on a device in a shared room. **It is neutralized by binding the tablet's device-level push subscription to its `device` row** (`Data Model §11`, `push_subscription.device_id`). Losing the registration therefore also stops truck-inbound alerts — a receiver notices within a day, and one re-run of the setup restores both. The desktop has no such coupling and no alerts to lose; its registration is verified by the session lifetime it produces, not by a signal.

> **General rule:** when security-relevant state can degrade invisibly, bind it to something operationally visible so its loss announces itself.

#### Session lifetimes

Stored in `app_config` alongside `receiver_edit_window_days`, tunable without redeploy.

| Context | Idle timeout | Absolute cap |
| :---- | :---- | :---- |
| Shared device (tablet, desktop) | 30 min | 12 h |
| Personal device, Volunteer | 30 days, rolling | none |
| Personal device, Staff / Admin | 7 days, rolling | none |

30 minutes on shared devices accommodates a receiver walking away to unload a truck; ten would log them out mid-run, an hour leaves an authenticated session on a counter, and re-login is four taps. The 12-hour cap applies regardless of activity, guaranteeing the tablet is logged out by morning. Personal-device sessions rely on the phone's own lock screen, and admin deactivation kills them instantly. Staff/Admin get a shorter window because the account is worth more — PII visibility, account management, master data.

**Expiry is server-authoritative.** The client's "Still here?" prompt (`UI §5`) is rendered from the server's expiry value, never the mechanism.

#### Brute-force defense

A 4-digit PIN is 10,000 keys, on a public endpoint, against a **deliberately published username roster** (`PRD §2`). The threat is untargeted automation that scans address space and tries credentials against whatever answers; the asset at risk is the phone numbers and addresses of a few dozen mostly-older volunteers — precisely what the tier system exists to gate.

**Enforcement is server-side, before the credential comparison.** The UI's "3 tries left" copy is communication, never enforcement — an attacker sends requests directly and never loads the app.

Two counters, stopping different attacks:

- **Per account** — repeated guessing against one volunteer.
- **Per client IP** — **credential spraying.** Because the roster is public, one likely PIN can be tried against all ~40 accounts; each records a single failure, so per-account counting is structurally blind to it.

**Progressive delay plus a short auto-expiring soft lock, not hard lockout.** Public names make hard lockout a trivial denial of service. A bounded self-clearing lock (~15 min, never "until an admin intervenes") makes automated guessing hopeless while guaranteeing a confused volunteer is never blocked on a human — there is no unlock action for staff to take, and `UI S1.1`'s copy says so plainly rather than implying rescue is available.

**Dependency on §4.5:** behind Cloudflare the origin sees Cloudflare's address, not the client's. The real client IP must be read from `CF-Connecting-IP` / `X-Forwarded-For` and trusted **only** for requests genuinely originating from Cloudflare, since headers are forgeable by anyone reaching the origin directly. Throttling on the socket address would treat the whole internet as a handful of addresses.

Username enumeration is deliberately *not* defended — R3 publishes the roster by design, so the concern is void rather than ignored.

---

### 4.3 Authorization model

Four rules get called "authorization" and they are not the same kind of rule. The sorting test:

> **Can the rule be answered from the session alone, without reading the database?** Yes → route layer. No → service layer. Not about blocking at all, only about what appears in the response → response shaping.

| Rule | DB read? | Enforced at | Example |
| :---- | :---- | :---- | :---- |
| **Tier gate** | no | route layer | Staff+ may publish shifts |
| **Duty gate** | no | route layer | only `receive` may submit weights |
| **Ownership / resource rule** | yes | service layer, in-transaction | a driver may release only their own shift |
| **PII visibility** | output, not permission | response shaping | Volunteers see names, not others' phone/address |

#### Permission versus truth

Tier and duty gates sit at the route layer rather than inside services, which only appears to contradict §4.1's one-service-function rule:

- **Permission applies to requests.** The materialization job creates shifts with no user acting. If "Staff only" lived inside create-shift, that job would need a fabricated Staff account — which `Data Model §5.3` forbids (*"No system user"*).
- **Truth applies always.** I12 must hold no matter who or what attempts the write. Invariants therefore stay in the service layer, where jobs pass through them too.

Background jobs consequently skip authorization while never skipping an invariant. That is the distinction working, not a hole.

#### Default-deny

**Every route declares its tier/duty requirement; a route declaring nothing is rejected, not open.** Login and static assets declare themselves public explicitly.

Without this, an endpoint added later with a forgotten rule silently works for everyone including anonymous traffic, and nothing complains. With it, forgetting produces a rejection on first test. The cost is one declaration per endpoint, and that cost is the point.

#### Services receive the actor, but not for access control

Permission is settled by the time a service runs. It still needs the acting user for **provenance** (`created_by`/`updated_by`, I26) and for the two tier/duty-dependent *domain* rules R3 has:

- **I20's staff-assign exemption** — the same assign operation skips `eligible()` when Staff performs it.
- **The receiver edit window** (`PRD` cap 15) — past `app_config.receiver_edit_window_days`, editing an intake row becomes Reporter-only.

#### PII shaping

Phone and address are visible when `viewer.tier >= STAFF` **or** `viewer.id == subject.id` (`PRD §2`). Name is never gated — public-within-org by design, shown on the login screen and shift board.

**Fields are removed on the way out, not by per-viewer queries.** Per-viewer queries would keep PII out of process memory but multiply query variants and leak the moment one is missed. A single shaping step holds one rule in one place — **and is safe only because it is the sole path by which a user record reaches a response.** Accepted cost: PII is in memory, so logging whole rows would leak it (see §5.4).

#### Implementation note

Tier comparisons are **hierarchical** (`>=`) — requiring Staff admits Admin. Duty comparisons are **set membership** — holding `report` implies nothing about `drive`. Easy to write as equality by accident.

---

### 4.4 Asynchronous work

| Work | Job? | Cadence |
| :---- | :---- | :---- |
| Recurrence materialization (`Domain §5.3`) | yes | daily |
| Shift reminder, 1 h before start | yes | 1 min sweep |
| At-risk alert, 1 day before an unclaimed shift | yes | 1 min sweep |
| Purge unconfirmed `SUGGESTED` donations (I17) — catch-up only; the common case purges inline at receive-done | yes | daily |
| Push dispatch | yes | on commit + sweep |
| Expired-session cleanup | yes | daily |
| **Receiver edit-window closing** | **no** | — |

The receiver edit window is a **derived condition** — `now < shift.starts_at + app_config.receiver_edit_window_days`, evaluated at request time. Nothing happens at the instant it expires except the I17 purge, and even that is a fallback: receive-done deletes that shift's unconfirmed `SUGGESTED` rows inline, in the same transaction. The daily sweep exists only for shifts that were never received against, where no inline moment ever arrives.

> **Rule:** if a deadline only changes what is *allowed*, derive it on read; schedule a job only when something must be *written*. Jobs you do not have cannot fail.

#### Catch-up sweeps, not one-shot timers

Every job asks "what is due and unhandled?", never "fire at time T." A one-shot timer for a 10:00 reminder is lost forever if the process is restarting at 09:00; a sweep catches it on the next tick, slightly late. **Missed ticks self-heal**, which is what demotes the trigger mechanism to a low-stakes choice.

Catch-up requires knowing what was already sent. Per §4.1 that belongs at tier 1: the partial unique index `uq_notif_shift_event` on `(event, shift_id, recipient_id)` makes a duplicate send **impossible** rather than unlikely.

**Its predicate must enumerate the covered events, and covers only the time-triggered ones** — currently `SHIFT_REMINDER` and `SHIFT_AT_RISK`, kept in lockstep with `TIME_TRIGGERED_EVENTS` in `services/notification.ts`. Event-triggered notifications do **not** "fire once by construction", which is what the index originally assumed: release → re-claim → release fans `SHIFT_OPENED` out twice about the same run, to the same drivers, and both sends are real. An index without the `event IN (...)` clause swallows the second one against the enqueue's `ON CONFLICT DO NOTHING` — silently, since a swallowed send looks exactly like a deduped one. Migration `0009` narrowed it for that defect; widening it again reintroduces the bug.

#### Trigger mechanism: in-process interval

Jobs run on intervals inside the Express process. The weakness — jobs die with the app — is exactly what catch-up semantics neutralize, and the workload is a few small queries per minute against a database on the same box.

| Alternative | Why not |
| :---- | :---- |
| OS cron → CLI or HTTP | with Docker means `exec`ing into a container or exposing a protected endpoint with its own secret and a default-deny carve-out |
| Separate worker container | a second container to deploy, monitor, keep in config sync |
| `pg_cron` | materialization needs `eligible()` — would mean reimplementing domain rules in SQL |
| Job queue (`pg-boss`, BullMQ) | retries and history, for problems catch-up sweeps already solve |

*Counterargument on record:* a separate worker is the conventional answer and would matter if a job grew slow enough to block request handling. Revisit if a job's runtime becomes measurable.

#### Notification dispatch: the `notification` table is the outbox

§4.1 settles the hard half — the row is written **inside** the business transaction, the push dispatched **outside** it, since a `SERIALIZABLE` retry would re-send. A process death between commit and delivery leaves the row for the next sweep.

The PRD makes this simpler than a typical outbox: push is best-effort and the in-app inbox is the source of truth, so a permanently failed push is **not** a data-integrity problem. Retry with backoff, give up after a cap, log. No dead-letter queue, no alerting.

- **Delivery is at-least-once.** A crash between "push sent" and "mark delivered" re-sends; a duplicate banner beats a lost reminder.
- **`410 Gone`** means the subscription is dead (uninstalled, permission revoked) → **revoke** the `push_subscription` row (`revoked_at`); dispatch skips revoked rows. The normal end of a subscription's life, not an error. Revoke rather than delete because every FK is `ON DELETE RESTRICT` (`Data Model §0`), so a row referenced by any session or notification cannot be removed — and a hard delete would take with it the record of which device a past alert went to.
- **Dispatch fires immediately after commit** so a release fans out at once, *plus* the periodic sweep as the safety net that makes correctness independent of that call.

Dispatch state (`delivered_at`, `attempts`, `last_attempt_at`) lives on `notification` (`Data Model §11`). Event taxonomy, fan-out sets, and message content remain the notifications doc's.

---

### 4.5 Process topology

| Component | Role |
| :---- | :---- |
| **Node / Express container** | HTTP API, the React build, and the in-process job scheduler |
| **PostgreSQL container** | all persistent state, including sessions, the notification outbox, and store photos |
| **`cloudflared`** | outbound tunnel to Cloudflare; the only ingress path |

That is the entire runtime. No reverse proxy, no cache, no queue broker, no worker. **No object store and no upload volume either** (`D20`): a store photo is `bytea` in `donor_photo`, not a file on disk. Two reasons, in order — a multipart parser is a dependency (`D5`), and a mounted volume is a *second thing to back up* beside the database, which §5.3 would then have to cover separately. In the table it is already inside `pg_dump`.

The cost is bounded by construction. The client resizes on a `<canvas>` to ~800px JPEG before sending, the body arrives as a base64 data URL in ordinary JSON, and `donor_photo` carries a `CHECK` capping bytes at ~400 KB and the mime at `image/jpeg` or `image/png`. `services/donor.ts` checks the same two things first so the refusal is readable, but the constraint is the guard that cannot be bypassed. `express.json` is set to `600kb` for the base64 inflation this implies; every other body in the app is an account form, a login or a weight.

#### Ingress: Cloudflare Tunnel

`rescue.amazinggracepantry.org` is already proxied by Cloudflare, by the organization's choice. `cloudflared` on the box holds an **outbound** connection to Cloudflare, which routes requests for that hostname back down it.

| Option | Requires | Costs |
| :---- | :---- | :---- |
| Port-forward + certificate on the box | router access to forward 443, an ISP permitting inbound, a static IP or DDNS updater | three dependencies outside our control; the box exposed to internet scanning; certificate lifecycle |
| **Cloudflare Tunnel (chosen)** | the tunnel created in the Cloudflare account | hard runtime dependency on Cloudflare; unreachable if the daemon stops |

Tunnel is robust to all three unknowns at once, and nothing on the box listens on the public internet, so most of the traffic §4.2 defends against never arrives. The apparent tension with §3's no-cloud constraint is largely theoretical: Cloudflare is **already** in the request path, so plaintext transit through a third party is a cost paid under either option unless Cloudflare is removed entirely.

Creating the tunnel is a deploy-time task requiring the account holder; the architectural commitment is the shape and the dependency.

#### Static serving: Express, no nginx

Express serves the React build with a catch-all fallback to `index.html` for client-side routing.

This is downstream of ingress, not independent of it. Port-forwarding would have required a web server for TLS anyway, making it the natural static server; under Tunnel there is no TLS to terminate locally, so nginx would exist solely to serve a few hundred kilobytes Cloudflare already caches at its edge. *Counterargument on record:* separating them would let the API restart without interrupting static serving.

#### Client and service worker

The PWA registers a service worker **for push only**. Offline support is a non-goal and `UI §6` requires a blocking "You're offline" banner, so the service worker must **not** adopt a cache-first strategy that lets the shell load and appear functional without a network — that would fake a capability the product deliberately lacks.

Client-side checks (disabled buttons, hidden actions, "3 tries left", "Still here?") are **communication, not enforcement**. Every rule they express is enforced again server-side.

---

### 4.6 Data access & schema authority

**TypeScript throughout.** Agents write most of the code, and a type error caught at compile time is a defect that never ships — worth the build step.

**Kysely (a typed query builder, not an ORM) + plain-SQL migrations via `node-pg-migrate`.**

**The database is the source of truth for schema, because the database is where invariants are enforced** (§4.1, tier 1). Anything declaring the schema a *second* time can drift from it, and that drift lands precisely on the enforcement layer.

R3's schema is constraint-heavy and those constraints are not decoration: ~8 multi-clause `CHECK`s, 12 partial indexes, two `DEFERRABLE INITIALLY DEFERRED` uniques, native enums, FK `RESTRICT` throughout. Schema-definition languages cover what their designers anticipated; deferrable constraints and complex checks sit outside most of them. The moment one constraint lives only in hand-written migration SQL, a schema file that still generates migrations describes a database that no longer exists. So the flow runs one direction only:

```
Data Model DDL  →  migration SQL  →  database  →  generated types
```

Types are produced from the live database (`kysely-codegen`) and committed.

| Declined | Reason |
| :---- | :---- |
| **Prisma** | Its DSL historically cannot express `CHECK`s, partial indexes, or deferrable constraints — all load-bearing here. Much of the schema would live in raw migration SQL while `schema.prisma` still claimed authority |
| **Drizzle** | Genuine second-best: expresses checks and partial indexes natively, and its relational API is terser for nested reads (board, receive worklist). Declined because its schema file becomes a second source of truth, and the DDL is *already written* — re-declaring it so a tool can re-derive our own SQL is more work and adds a translation step to the §5.3 rehearsal chain |
| **TypeORM / Sequelize** | Heavier, weaker typing, same expressiveness problem |
| **Raw `pg`** | Hand-mapping rows with no type safety, in an agent-written codebase |

**Costs accepted:** joins are written explicitly (a non-issue at ~15 tables with tiny result sets, and it makes every query visible); type generation needs a live database in the schema-change workflow; agents have seen more Drizzle than Kysely, so generated code may need more correction.

**Fit with §4.1:** conditional `UPDATE` with rowcount inspection, explicit `SERIALIZABLE` transactions, and `ON CONFLICT DO NOTHING` are all plain SQL. A query builder expresses them directly; ORMs wrap them awkwardly or hide the rowcount tier 2 depends on.

---

## 5. Deployment & operations

### 5.1 Containers and configuration

Docker Compose defines the two containers plus `cloudflared`; Postgres data lives on a named volume. Configuration is environment variables from an env file on the box, never committed — database credentials, session cookie secret, VAPID keys, tunnel token.

### 5.2 Schema migrations

**Forward-only, applied at deploy, versioned in the repository.** Down-migrations are not written: on a single instance with a tested restore path, rolling forward with a corrective migration beats maintaining reversibility that is never exercised.

Migrations are **plain SQL** via `node-pg-migrate`, substantially a transcription of `Data Model §1–§12`. Per §4.6 they are authored, not generated. `Data Model §1` already accepts that native enums make adding a value an `ALTER TYPE` operation; that cost is affirmed here.

### 5.3 Backups and the migration rehearsal

**Backups.** A nightly `pg_dump` written to the box, retaining ~two weeks of nightly plus several weekly snapshots.

**Off-box copies are deferred until go-live.** All three phases are built before the pantry uses the system, so there is no production data to protect yet. The accepted risk, stated plainly: a single disk failure destroys the database *and* every backup of it, since they share a disk. **Revisit the day real data exists** — the NTFB reporting history is compliance data.

**No staging environment.** Staging is usually justified as somewhere to test features before users see them, which local development already covers at this scale. What local development cannot do is rehearse a migration against production-shaped data:

> **Before any migration runs against production:** restore the most recent dump into a throwaway Postgres container **on the box**, run the migration against it, smoke-test, destroy the container.

The smoke test is a fixed checklist, not a suite: did the migration complete and how long did it take; do the constraint predicates still hold when run as queries over real rows; do derived reads (SUM-on-read totals, the `WEIGHED`-EXISTS projection, status counts) return the same numbers as before; does the application boot against the migrated database.

This catches what only real data reveals — a backfill violating `NOT NULL` on one row from months ago, FK `RESTRICT` blocking a cleanup because of a provenance stamp, lock duration, application code no longer matching the schema. It does **not** cover environment differences (ingress, container networking), which would need a persistent second stack.

**The rehearsal is also the restore test.** A backup never restored is a rumor; making restore a required step of a routine already performed means a broken backup blocks the next deploy, loudly, while nothing is on fire. It runs on the pantry box rather than a laptop because dumps contain volunteer phone numbers and addresses, which stay inside the §3 trust boundary.

Applies from go-live onward; before then there is no production data to preserve and schema changes are drop-and-recreate.

### 5.4 Logging

Structured logs to stdout, captured by the container runtime. Load-bearing conventions, not style:

- **Never log whole user rows.** §4.3 accepts PII in process memory in exchange for a single shaping function; logging a full record defeats that. Log identifiers, never phone or address.
- **Never log credentials or session identifiers** — PINs, passwords, cookie values, tunnel tokens.
- **Do log** every authentication failure with account and client IP (§4.2's counters need them), every serialization-failure retry (a rising rate is a signal), and every push dispatch that exhausts its attempts.

### 5.5 Errors

Unhandled errors return a generic message with a correlation identifier; details go to logs, never to the client. `UI §6` requires plain, recoverable, code-free error text — the correlation identifier is for the operator reading logs, not the volunteer reading the screen.

---

## 6. Cross-doc dependencies

| Doc | Owns | This doc depends on it for / hands it |
| :---- | :---- | :---- |
| **Product Requirement** | roles, tiers, duties, capabilities, phasing, channel strategy | The trusted-population threat model, the public-names decision, and "the inbox is the source of truth" — what makes push failure tolerable (§4.4) |
| **Domain Modeling** | entities, state machines, I1–I30, named algorithms | Every invariant §4.1 places into a tier. On any mismatch, `Domain Modeling` wins |
| **Data Model** | physical schema, constraints, indexes, conditional-UPDATE predicates (§9) | **Hands it:** the `session` table, `app_user` credential + PII columns, session-lifetime keys in `app_config`, and the `notification` outbox columns (already applied) |
| **UI/UX Spec** | screens, tokens, interaction contracts | Login flow, timeout prompt, "3 tries left" copy, offline banner. **Constrains it:** client-side checks are communication only |
| **API** (deferred) | per-endpoint contracts | **Hands it:** the default-deny declaration requirement, the actor-passing convention, the PII shaping boundary |
| **Notifications** (deferred) | event taxonomy, fan-out sets, message content, cadence | **Hands it:** the outbox mechanism, at-least-once delivery, `410` handling, send-idempotency via `uq_notif_shift_event` |
| **Workflow** (deferred) | worked per-operation examples | **Hands it:** transaction boundaries, retry semantics, the tier-placement rule |
| **Reporting** (deferred) | report and metric definitions | Read-only queries may run at the default isolation level (§4.1) |
