# Wave 1 — identity

**Status:** complete

**Built:**
- `services/session.ts` — server-side sessions in Postgres: opaque 256-bit id, expiry resolved from `app_config` (30 min idle / 12 h cap on a registered device; 30 d Volunteer, 7 d Staff+ on a personal one), `last_seen_at` slid by a lookup on every request, revocation on logout / expiry / deactivation.
- `services/session.ts` — `purgeExpiredSessions()`, real and unit-tested; the device registry (`registerDevice` / `listDevices` / `findDevice`), since membership in `device` *is* the shared-device marker and only session policy consumes it.
- `services/auth.ts` — `node:crypto` scrypt hashing (`scrypt$N$r$p$salt$key`), constant-time verify, volunteer-PIN / staff-password shape rules, default PIN from the last four phone digits, and `login()` as one service function owning one transaction.
- `services/auth.ts` — brute-force defense: per-account and per-IP counters, progressive delay, 15-minute self-clearing soft lock, evaluated before the credential comparison; every failure logged with account and client IP, never the credential.
- `services/user.ts` — `generate_username` per `domain-modeling.md §5.1` (normalize → base → full-string collision suffix), account create / edit / credential reset / removal, and `userHasHistory()` as the single I21 predicate.
- `pii.ts` — `shapeUser()`, the sole exit path for an `app_user` record; phone and address are *removed*, not nulled.
- `middleware/authorize.ts` — the default-deny gate: it matches the declaration table, not the handler table, so an undeclared route is rejected before any handler runs.
- `middleware/auth.ts`, `middleware/cookies.ts`, `middleware/error.ts` — identity resolution, real-client-IP extraction, signed `httpOnly`/`Secure`/`SameSite=Lax` cookies, and the generic-error-plus-correlation-id handler.
- `routes/` — the registry (`access` is a required field, so an undeclared route does not typecheck) plus login / logout / roster / me, the S1.8 account routes, and shared-device registration.
- `index.ts` — Express boot: `trust proxy` first, JSON body cap, `/api` behind the gate, static SPA with the catch-all fallback.
- `shared/src/index.ts` — `tierAtLeast` / `hasDuty` / `hasAnyDuty`, credential-kind derivation, and the identity request/response shapes.

**Files:**
`server/src/pii.ts`, `server/src/index.ts`,
`server/src/middleware/{auth,authorize,cookies,error}.ts`,
`server/src/routes/{registry,index,auth,users,devices}.ts`,
`server/src/services/{auth,session,user}.ts`,
`shared/src/index.ts`,
`server/test/identity-{auth,session,user,authorization,pii}.test.ts`,
`reports/1-identity.md`.
No file outside the lane's declared ownership was touched; `server/migrations/`, `server/src/db/types.ts` and every `package.json` are unmodified.

**Invariants:**
- **I1** — tier 1 (`tier` enum) and tier 3 here: every comparison goes through `tierAtLeast` (rank `>=`), in the route gate and in the session-lifetime choice. Never equality.
- **I2** — tier 1 (`user_duty` PK) and tier 3 here: duty checks are set membership (`hasAnyDuty`); duplicate duties collapse before insert.
- **I3** — tier 1 (`uq_user_username`, `ck_user_username`) with the tier-3 half here: generation per §5.1, "taken" includes deactivated users, and *no update path exists* for `username` — immutability is enforced by the absence of the field, not by a check.
- **I21** — tier 3 (`userHasHistory()`), backed by tier 1 FK `RESTRICT`. The predicate deliberately covers every referencing table except `user_duty` and `session` (`domain-modeling.md §2.3` sends auth/session mechanics to `architecture.md §4.2`), because a predicate narrower than the FK set would turn a soft-delete decision into a foreign-key error. One function, so Phase 2's `weight_entry` / `unscheduled_donation` is a one-line change (D3).
- **Default-deny** (`architecture.md §4.3`) — enforced twice: `access` is a required field on `RouteDefinition`, and the gate rejects any method+path with no matching declaration. Proved by a test that registers a handler on the router without declaring it and asserts 403 with the handler never reached.

**Tests:** 113 passing / 0 failing (82 new in this lane, 31 pre-existing) —
`./scripts/test-db.sh && DATABASE_URL=<the url it prints> npx vitest run --root server`; `./scripts/gate.sh` exits 0.

**Deliberately not done:**
- `purgeExpiredSessions()` is not registered with the scheduler. `server/src/jobs/` is the signal lane's and does not exist in this worktree — the recorded Wave-2 one-liner (`phase-1-state.md`, "Carried to Wave 2"). The function is real and tested, not a stub.
- `server/src/index.ts` leaves a one-line marker where `startScheduler()` goes; the lead wires it at merge.
- No reactivate-account action: S1.8 lists create / edit / set-credential / delete, and reactivation appears in no doc.
- No device de-registration route: `architecture.md §4.2` describes registration as one-time setup and treats marker loss as the failure mode, not as an action.
- Donors, trucks, categories, and every operational route are Wave 2+; nothing about them is here.
- The `doc-qa` agent was **not** run: this lane's toolset has no Agent tool, so it cannot spawn one. The checks were performed by hand against `architecture.md §4.1/§4.2/§4.3/§4.5/§5.4/§5.5`, `domain-modeling.md §5.1` and I1–I3/I21, `product-requirement.md §2`, and `ui-ux-spec.md §5`/S1.1/S1.8. **The lead must still run `doc-qa` over the merged diff (§5.2); this lane's self-review does not substitute for it.**

**Assumed:**
- **PII is visible to `viewer.tier >= STAFF` or to the subject themselves, per `architecture.md §4.3`, and the two docs disagree.** `product-requirement.md §2`'s role table says Staff "Cannot ... see others' PII" and lists "PII visibility" in the Admin-only delta, while the same section says "Only phone/address are gated to Staff-tier-and-above" and `architecture.md §4.3` states `viewer.tier >= STAFF` OR `viewer.id == subject.id` while citing `PRD §2`. I implemented `architecture.md §4.3` because it is the doc that owns the authorization model, but the PRD outranks it and reads the other way in its own table. **This is a doc-vs-doc contradiction on a security rule; a human should decide.** One-line change in `pii.ts` either way.
- Throttle counters live in **process memory**, not a table. `server/migrations/` is Wave-0-owned so this lane cannot add one, and R3 runs as one process (§4.5). Consequence: a restart clears a 15-minute soft lock. An attacker cannot trigger a restart, and sessions are in Postgres precisely because losing *those* on deploy is unacceptable — losing a lock is not. If it should survive a restart, it needs a table and therefore a migration.
- Threshold numbers. The docs fix "~15 min" and S1.1's "3 tries left", so the account lock trips at **4** failures (first failure reports 3 left). The **per-IP ceiling of 20 failures per rolling 15-minute window**, and the progressive delay (250 ms doubling to a 2 s cap), are mine — §4.2 requires the second counter and a progressive delay but names no numbers.
- **Minimum staff/admin password length is 8 characters.** No doc states a minimum. Volunteer PINs are exactly 4 digits, which is the doc's.
- **The device marker is a signed, `httpOnly`, ten-year `r3_device` cookie**, set on the browser by `POST /api/devices`. §4.2 says devices are "marked during a one-time setup" and that clearing browser data loses the marker, but names no mechanism. An unknown or unverifiable marker is treated as **personal** rather than rejected, so a lost registration cannot also lock a receiver out of the tablet.
- **`SESSION_COOKIE_SECRET` is used to HMAC-sign the session cookie value** (`<id>.<sig>`). The variable already exists in `.env.example` but no doc states its purpose; the identifier is already unguessable, so the signature only rejects forged cookies without a database hit.
- **Admin accounts cannot be created directly.** `product-requirement.md` cap 1 reads "creates/deletes **non-admin** accounts, assigns access tiers", so `POST /api/users` with `tier: ADMIN` is refused (403) and `DELETE` of an Admin-tier account is refused, while *promoting* an existing account to Admin is allowed (S1.8's tier picker offers Admin). If Admin creation should be allowed outright, this is one check in `createUser`.
- **A tier change that crosses the PIN/password boundary must carry a new credential** in the same request, else 400. The docs do not say what becomes of a promoted volunteer's 4-digit PIN, and silently keeping it would leave a Staff account on a PIN, contradicting §4.2's reason for the split.
- **`GET /api/users` requires STAFF, not ADMIN** (`product-requirement.md §2` gives Staff "operational status across all volunteers"); every account *write* requires ADMIN. What Staff sees in that list is decided by `shapeUser`, not by the declaration — which is the §4.3 split between a permission and a shaping rule, and which also means the first bullet above changes this route's output without changing its gate.
- **Login identifies the account by `username`**, not by id: the flow is name-first (`ui-ux-spec.md §5`) and the roster returns the username the client then posts back.
- **`SameSite=Lax`.** §4.2 says "SameSite" without a value; Lax stops a cross-site POST riding the cookie while an ordinary link into the app still opens signed in.
- **Server code imports `shared/src/index.ts` by relative path, not as `@r3/shared`.** `server/package.json` declares no dependency on the shared workspace, and inside a lane worktree `node_modules` is a symlink to the main checkout, so `@r3/shared` resolves to the **main tree's** `shared/` — a bare specifier here would have compiled and tested against another checkout's file. If the lead prefers the package specifier, it needs a `dependencies` entry in `server/package.json` (Wave-0-owned) and it will still mis-resolve inside worktrees.

**Environment variables** (none added to `.env.example`, which is not this lane's):
- **`TRUST_PROXY`** — new; the value for Express's `trust proxy`, default `loopback`. §4.2's per-IP throttle only reads `CF-Connecting-IP` / `X-Forwarded-For` when Express validated the hop, so on the box this must name the `cloudflared` container's network (e.g. `uniquelocal`) or the whole spray counter degrades to one address.
- `CLIENT_DIST` — optional override of the SPA build path; defaults to `client/dist`.
- `SESSION_COOKIE_SECRET` — already present; now load-bearing (see Assumed). Missing in production throws at boot; in dev/test a per-process value is generated.

**Unblocked:**
- Every later route can now declare a tier/duty and be reachable: `defineRoute` + `buildRouter` + the gate are in place, and adding a route is one entry in `server/src/routes/index.ts`.
- `req.actor` (`{ id, username, tier, duties, sessionId, expiresAt, sharedDevice }`) is available to every handler, which is what Wave 2's master-data CRUD, Wave 3's staff-assign exemption, and the receiver edit window all need for provenance (`created_by` / `updated_by`, I26).
- `shapeUser()` exists, so any wave returning a user record has its exit path.
- The Surface lane's client can call `GET /api/auth/roster`, `POST /api/auth/login`, `POST /api/auth/logout` and `GET /api/me`; `expiresAt` is server-authoritative and is what the "Still here?" prompt should render.
- Wave 2 can register `purgeExpiredSessions()` in `server/src/jobs/` in one line.
