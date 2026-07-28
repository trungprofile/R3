# Wave 1 — surface

**Status:** complete

**Built:**
- Design tokens as the single source of colour/type/spacing/target size (`ui-ux-spec.md §2`), values in CSS custom properties, TypeScript exporting `var(--…)` references so nothing can drift.
- Every §3 component contract: Button, Big list row (+ List/Card), Numeric keypad, Text input, Status chip (+ ownership overlay and the §5 alerts chip), Top bar, Bottom nav, Modal/destructive confirm, Toast, Inbox row, and the empty/loading/error blocks.
- The app shell (§4): one top bar everywhere with an always-visible Logout, navigation derived from the signed-in user's tier and duties — phone bottom nav, desktop left nav, tablet no nav — and no duty switcher anywhere.
- A hand-rolled History-API router (build-plan D5): route table, `:param` matching, `Link`, `navigate`/`go`, browser-history paths matching Express's catch-all fallback to `index.html`.
- The §6 global patterns as reusable primitives: 300 ms-delayed skeleton rows, instructive empty states, plain code-free errors with retry, destructive confirm with the calm cancel default, the blocking "You're offline" banner, and the 30-second "Still here?" prompt.
- `client/src/api/**`: one credential-carrying fetch wrapper, one error shape, connection/activity tracking that raises the banner and times the idle prompt.
- Vite config + `index.html` + `main.tsx`, with the screen registry as the one wiring point later waves add to.

**Files:**
`client/index.html`, `client/vite.config.ts`, `client/src/main.tsx`,
`client/src/tokens/{tokens.css,index.ts,css.d.ts}`,
`client/src/components/{Button,ListRow,StatusChip,TextInput,NumericKeypad,Modal,Toast,TopBar,Nav,InboxRow,blocks,icons}.tsx`, `client/src/components/{components.css,index.ts}`,
`client/src/app/{App,AppShell,SessionProvider,ToastProvider,OfflineBanner,IdlePrompt,router,nav}.tsx`, `client/src/app/{routes,access,useViewport,useAsyncData,index,shell.test}.ts`, `client/src/app/app.css`,
`client/src/api/{client,errors,connection,activity,session,index}.ts`

All inside this lane's declared ownership. `client/src/sw.ts`, `shared/src/**`, `client/src/screens/**`, `client/tsconfig*.json`, `package.json` and everything under `server/` are untouched.

**Invariants:**
- **I1** (tier hierarchy) — `app/access.ts` ranks by the order of `TIERS` and compares `>=`; equality is never used.
- **I2** (duty set membership) — same file, `includes`, never a hierarchy.
- **I7** (MISSED/at-risk derived at read time) — `StatusChip` takes at-risk as a flag beside the status, never as a stored status value.
- **I11 / build-plan D1** — the `Done` chip is built and styled but unreachable in Phase 1; nothing in the shell offers a path into `COMPLETED`.

**Tier: none of this enforces anything.** Every check here is tier 3 communication (`architecture.md §4.5`): hidden nav sections and the "You don't have access to this page." panel mirror what the server's route-layer gate (`§4.3`) refuses again. Code comments say so at each site.

**Tests:** 19 passing / 0 failing — `npx vitest run --root client` (`client/src/app/shell.test.ts`).
Covered: route matching and path building, static-before-parameterised resolution, tier/duty comparison, and nav derivation per device and per user shape. **Not covered: anything rendered.** There is no browser or component test harness in this repo, and adding one (jsdom, a renderer) would be a dependency, which a lane may not add (build-plan §3/D5). What proves the rest is `npx tsc --noEmit -p client/tsconfig.json` (clean) and `./scripts/gate.sh` (**GATE PASSED**, including its client typecheck step, which arms itself now that `client/src` holds shell sources). `npx vite build` also succeeds and emits `sw.js` at a fixed name.
Note for the lead: `gate.sh` runs `vitest --root server`, so these 19 client tests are **not** part of the mechanical gate. They must be run with the command above.

**Deliberately not done:**
- No screens. S1.1–S1.9 are Wave 4; the shell renders a plain "This screen isn't ready yet." for a route with no screen registered, and `main.tsx` holds the one-line-per-screen registry they add to.
- No service-worker registration, no alerts onboarding, no push-state wiring. `sw.ts` belongs to the `signal` lane and the §5 onboarding is Wave 2; the shell exposes `PushStateChip` and `alertsEnabled`/`onFixAlerts` props for whoever owns that state.
- No per-endpoint response types beyond the two the shell itself needs — they arrive with the screens.
- §6's optimistic claim and its "That run was just taken by Karen." revert are S1.2 behaviour; the toast primitive it needs exists, the claim does not.
- `doc-qa` was **not run by this lane** — this agent has no tool to spawn another agent. Per build-plan §5.2 the lead runs it over the merged diff, and that step is still owed on this work.

**Assumed:**
1. *The shell needs a current user and a logout call, and the auth routes did not exist in this worktree.* Assumed `GET /api/auth/me` returning `{ user, expiresAt }` and `POST /api/auth/logout`. Both path constants sit at the top of `client/src/api/session.ts` so realigning to the `identity` lane's actual routes is one edit.
2. *The current-user response shape.* Assumed `{ id, username, firstName, lastName, tier, duties[], phone?, address? }` with an ISO `expiresAt`, declared in `client/src/api/session.ts` because `shared/src` is the `identity` lane's this wave. If that lane publishes an API shape, this type should be deleted in favour of it.
3. *`ui-ux-spec.md` names three devices but states no pixel breakpoints.* Assumed phone `<768px`, tablet `768–1023px`, desktop `>=1024px`, width-only (an orientation rule would flip the pantry tablet's whole nav when stood upright). In `client/src/tokens/index.ts`.
4. *§2 defines no text colour for use on `--structural-dark`, but §3 puts the user name and Logout on it, and `--text` (#333) on #363839 is unreadable.* Added `--text-on-dark: #ffffff` (10.4:1) and `--text-on-dark-muted: #d8d5d1` (7.4:1).
5. *§2 states in prose that white text passes on `--success` and `--danger` but names no token, and §3's "Disabled = greyed" names no colour.* Added `--text-on-fill: #ffffff`, `--disabled-fill: #e6e3df`, `--disabled-text: #6b6b6b`, plus `--font-stack` and `--shadow-modal`. No §2 value was altered.
6. *§4 gives the phone "Board · My Shifts · Inbox" for a driver and does not say what a non-driver sees on a phone.* Assumed My Shifts appears only for a user holding the `DRIVE` duty (§4's governing rule is that nav is derived from what the user can do); Board and Inbox appear for everyone.
7. *§4's desktop list covers only the back office (report → Report; Staff → Schedule, Board; Admin → Admin, Metrics), while the responsive matrix marks the board, my shifts and the inbox "usable" on desktop.* Assumed the desktop nav also offers Board (Staff tier **or** `DRIVE` duty), My Shifts (`DRIVE`) and Inbox (everyone), so a volunteer at the shared desktop is not stranded with an empty nav.
8. *Report and Metrics are §4 nav sections whose screens (S3.1, S3.2) are Phase 3.* Assumed a nav item leading to a screen that does not exist is worse than an absent one: both are declared in the route table with `phase: 3` and filtered out by `CURRENT_PHASE = 1`. Bumping that constant restores them.
9. *The spec names screens, not URLs.* Assumed `/login`, `/board`, `/shifts/:shiftId`, `/my-shifts`, `/pickup/:shiftId`, `/schedule`, `/schedule/:shiftId/reschedule`, `/admin`, `/inbox`, with `/` redirecting a signed-in user to `/board`.
10. *When to show "Still here?" without breaking the inactivity timeout.* Polling the server for the current expiry would itself be an authenticated request and would slide `last_seen_at` forever, so the timeout would never fire. Assumed instead that the client mirrors the slide locally: it learns the idle window from the first session read and moves its own estimate forward on each successful request. Expiry stays server-authoritative (`architecture.md §4.2`) — a wrong estimate only mistimes the warning, and the real sign-out still arrives as a 401.
11. *§6 forbids a code in error text, and `architecture.md §5.5` returns a generic message plus a correlation identifier.* Assumed the client renders its own plain per-kind message and never the correlation identifier; the server's message is carried as `detail` for a screen that wants it (e.g. "You own a run in this window", S1.4).
12. *§4's "Tablet: no nav" taken literally.* On a tablet there is no navigation at all in Phase 1, so a tablet reaches a screen only by its URL. That is consistent with the tablet being the Phase-2 receive device (login → weight entry).
13. *The built service worker's URL.* The Vite config emits `src/sw.ts` as `/sw.js` with a fixed, unhashed name, because a registration call has to know the URL and a hashed name would change every deploy. The `signal` lane's registration must use that path.

**Unblocked:**
- Wave 4 can build any S1.x screen: register a component in `main.tsx`'s `SCREENS`, read params via props, get user/tier/duty from `useCurrentUser()`, and use `useAsyncData` + `SkeletonRows`/`EmptyState`/`ErrorBlock` for the three list states §3 requires.
- Wave 2's alerts onboarding has its mount points: `PushStateChip`, and the top bar's `alertsEnabled` / `onFixAlerts` props.
- The `identity` lane's login screen has a slot (`SCREENS.login`) and a hook (`useSession().onSignedIn`) waiting for it.
- Any lane needing a server call now has one wrapper: `api.get/post/patch/delete` with the session cookie, the single error shape, and the offline banner already wired.
