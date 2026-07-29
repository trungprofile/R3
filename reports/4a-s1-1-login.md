# Wave 4a — s1-1-login

**Status:** complete

**Built:**
- S1.1 Login as a two-step screen: tap your name from the roster, then a 4-digit PIN keypad (Volunteer) or a password field (Staff/Admin), per `ui-ux-spec.md §5`.
- The throttle's user-facing half: an inline "3 tries left" count that only a rejected credential consumes, and the soft lock's exact sentence ("Too many tries. Try again in 15 minutes.") taken from the server's own 429 body.
- All three list states for the roster (§3/§6): delayed skeleton rows, an instructive empty state, and a plain retryable error block with no code in it.
- §5's personal-device memory: after a sign-in the server classifies as *not* shared, this browser opens straight on that name; a shared-device sign-in erases it, and "Not you? Choose a different name" always leads back to the list.
- A redirect off `/login` to the board once someone is signed in, so the URL does not sit on a screen that is behind the user.
- 23 pure-logic tests over everything in the screen that is a rule rather than a pixel.

**Files:**
- `client/src/screens/s1-rescue/s1-1-login/index.ts` — barrel; exports `LoginScreen` for the lead's `SCREENS` wiring
- `client/src/screens/s1-rescue/s1-1-login/LoginScreen.tsx`
- `client/src/screens/s1-rescue/s1-1-login/login.ts` — copy + the attempt/credential/roster logic, React-free
- `client/src/screens/s1-rescue/s1-1-login/api.ts` — `GET /auth/roster`, `POST /auth/login`, both through `api/client.ts`
- `client/src/screens/s1-rescue/s1-1-login/remembered.ts` — the remembered name, guarded `localStorage`
- `client/src/screens/s1-rescue/s1-1-login/login.css`
- `client/src/screens/s1-rescue/s1-1-login/login.test.ts`
- `reports/4a-s1-1-login.md`

All inside this lane's declared ownership. Nothing under `app/`, `components/`, `api/`, `pwa/`, `tokens/`, `main.tsx`, `server/`, `shared/` or `package.json` was touched.

**Invariants:** None enforced here, and that is not an omission — all three enforcement tiers are server-side (`architecture.md §4.1`), and a client-side check is communication only (`CLAUDE.md`). This screen renders the outcome of two server-side rules and says so in comments where it does: **I21** (a deactivated account is absent from the roster and cannot sign in — enforced in `services/user.ts` and `services/auth.ts`) and `architecture.md §4.2`'s per-account/per-IP throttle, whose count and lock this screen only reports.

**Tests:** 23 passing / 0 failing — `npx vitest run --root client src/screens/s1-rescue/s1-1-login/login.test.ts`. Full gate green: `./scripts/gate.sh` (73 client tests across 3 files, server suite, both typechecks, migrations).

**Deliberately not done:**
- **No rendering test.** There is no jsdom and no component renderer in the repo, and adding one is a dependency a lane may not add (build-plan §3/D5) — the same constraint `app/shell.test.ts` and `pwa/pwa.test.ts` record. So the step transitions, the keypad wiring, the remembered-name restore effect and the post-sign-in redirect are **covered by no test**; only the pure functions under them are. Stated here rather than implied by a green suite.
- **No countdown during the lock.** The server sends `retryAfterSeconds` on the 429, but `api/errors.ts` (another lane's file) keeps only `message` and `correlationId`, and S1.1 fixes the copy as a sentence naming 15 minutes rather than a ticking number.
- **No "remember me" control.** §5 makes persistence a property of the device, not a user choice.
- **No search or filter on the name list.** §5 is explicit: recognition, no typing.
- **Not wired into `main.tsx`.** The registry seam is the lead's at merge.
- **`doc-qa` was not run from this lane** — this session has no Agent tool with which to spawn it. Build-plan §5.2 assigns doc-qa over the merged diff to the lead, so it is not skipped, only deferred to where the plan already puts it. I re-checked the diff against S1.1, §2, §3, §5, §6, §7 and `architecture.md §4.2` by hand instead.

**Assumed:**

1. **The "tries left" count is recomputed on the client, not read from the server.** `shared/src` defines `LoginRejected.triesLeft` and the server sends it on every 401, but `client/src/api/errors.ts` builds `ApiError` from `message` and `correlationId` only and drops every other body field — and `client/src/api/**` is another lane's file, so the count could not be plumbed through without editing it. `login.ts` therefore holds `MAX_TRIES = 4`, mirroring `ACCOUNT_MAX_FAILURES` in `server/src/services/auth.ts`, and counts consecutive 401s for the selected name. Only a 401 increments it; an offline or 5xx attempt never reached the credential comparison and must not. A 429 resets it to zero, because the server's counter resets with the lock. Divergence is possible and benign in one direction (failures recorded from another browser make the client's count read high), and the lock message is always the server's own sentence, so the moment it actually locks the screen tells the truth. **If the lead would rather this be exact, the fix is one field in `api/errors.ts`, not in this folder.**
2. **Copy the spec did not dictate, verbatim.** Step 1: `"Who's signing in?"` and `"Tap your name."`. Step 2: `"Your 4-digit PIN"`, `"Your password"`, and the way back, `"Not you? Choose a different name"`. Empty roster: `"No names here yet."` / `"An admin adds accounts. Once yours exists, your name is on this list."`. Wrong credential: `"That didn't match. 3 tries left."`, `"That didn't match. 1 try left."` (singular at one), `"That didn't match. Try again."` (count exhausted without a lock) — S1.1 dictates the count's wording, the sentence in front of it is ours. Non-visual: keypad label `"PIN keypad"`, skeleton label `"Loading names"`, screen-reader status `"N of 4 digits entered"`. `"Enter"`, and the lock sentence, are the spec's and the server's respectively.
3. **What "the device may remember the user" means mechanically (§5).** The username is written to `localStorage` under `r3.login.name` after a successful sign-in **only when the server's `sharedDevice` is false**, and a `sharedDevice: true` sign-in erases whatever is there. §5 says shared devices never persist but gives the client no way to know which it is; `architecture.md §4.2` makes device classification a server-held registration, so the sign-in response is treated as the only authority. Consequence: the tablet never pre-shows the last receiver's name, and a mis-registered device cleans itself up on the next sign-in.
4. **Where a sign-in lands.** Signing in while the URL is `/login` navigates to `HOME_PATH` with `replace`. Neither S1.1 nor §5 says where login goes; `app/routes.ts` already names the board as where a signed-in user lands.
5. **The Enter button is disabled until the credential is well-formed** (exactly 4 digits, or a non-blank password). §3 says "prefer hiding over disabling"; hiding a screen's one primary action while someone is mid-PIN is the fragile control §1.5 rules out, so this departs from the preference deliberately.
6. **No auto-submit on the fourth digit.** S1.1 names Enter as the primary action, and auto-submitting would make it vestigial. Step 2 is a real `<form>`, so the Return key submits the desktop password field.
7. **The password field checks only that something was typed**, not `MIN_PASSWORD_LENGTH`. The server owns that minimum, and an account created before it must still be able to sign in; the server's 400 explanation is shown inline if it refuses.
8. **The roster is re-sorted client-side** by first name, then last, then username. `listRosterUsers` already orders that way; sorting again makes the list order stable regardless of what the endpoint returns, which is what makes it muscle memory.
9. **Login has no row in the responsive matrix**, so it is built as one centred column that is identical on phone, tablet and desktop — the four taps must not differ by surface.

**Unblocked:** The `login` entry in `main.tsx`'s `SCREENS` registry can be wired (`import { LoginScreen } from './screens/s1-rescue/s1-1-login/index.ts'`), which makes the app reachable for a signed-out user and therefore makes every other S1.x screen manually exercisable end-to-end.
