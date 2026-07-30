# Wave 4b — s1-7-reschedule

**Status:** complete

**Built:**
- `S1.7 Staff — reschedule` as `RescheduleScreen`, matching `AppShell`'s `ScreenProps` contract and
  exported from an `index.ts` barrel. Not wired into `main.tsx` — that seam is the lead's, so the
  route currently renders the shell's placeholder.
- The run as it stands now: a `Card` with route name, the pantry-local day and window, the owner's
  name (or `OPEN`) and a `StatusChip`, read from `GET /shifts/:id`.
- The move form: a single-select month calendar of big day targets, plus **From** / **Until** grids of
  half-hour time buttons — no native date field, no dropdown, no spinner (§1.5). Prefilled with the
  run's own window so a coordinator changes one of three values rather than re-entering all three.
- One primary action, **Confirm new time** (S1.7 verbatim), above a read-back sentence that states
  whose run it stays: *"Tuesday, August 11 · 9:00 AM – 11:00 AM. Karen Diaz keeps this run."*
- **The conflict path, which is the whole substance of the screen.** The unconfirmed
  `POST /shifts/:id/reschedule` is the pre-confirm check: `services/schedule.ts` gathers
  `ownerConflicts()` and throws 409 `RESCHEDULE_CONFLICT` *before* its `UPDATE`, so the transaction
  rolls back and nothing has moved when the warning appears. The warning is rendered in the
  **server's own sentence** — `rescheduleConflictMessage()` in `shared/src/schedule.ts` — inside a
  `ConfirmModal` whose red confirm reads **Move it and release the run**.
- Cap 9's last clause, said out loud rather than merely obeyed: the release consequence adds
  *"Nobody is picked to take over — it goes back on the board as open for a driver to claim."*
  The screen makes **two** API calls in total and neither can return a driver.
- Runs that cannot be moved at all: `IN_PROGRESS`, `CANCELLED` and (unreachable, D1) `COMPLETED`
  each get their own plain explanation in place of the form, rather than a form that will be refused.
- Loading / error states through `useAsyncData` + `SkeletonRows` / `ErrorBlock`, a screen-local
  stylesheet built from tokens only, and 41 pure-logic tests.

**Files:** (all inside this lane's declared ownership,
`client/src/screens/s1-rescue/s1-7-reschedule/**`, plus this report)
- `client/src/screens/s1-rescue/s1-7-reschedule/index.ts`
- `client/src/screens/s1-rescue/s1-7-reschedule/RescheduleScreen.tsx`
- `client/src/screens/s1-rescue/s1-7-reschedule/DayPicker.tsx`
- `client/src/screens/s1-rescue/s1-7-reschedule/TimeGrid.tsx`
- `client/src/screens/s1-rescue/s1-7-reschedule/logic.ts`
- `client/src/screens/s1-rescue/s1-7-reschedule/api.ts`
- `client/src/screens/s1-rescue/s1-7-reschedule/reschedule.css`
- `client/src/screens/s1-rescue/s1-7-reschedule/reschedule.test.ts`
- `reports/4b-s1-7-reschedule.md`

Nothing outside that folder was written. No server file, no migration, no `shared/src` change, no
dependency — `package.json` is untouched in all workspaces.

**Invariants:** This is a client lane, so **every one of these is enforced at tier 3 in
`server/src/services/schedule.ts` and merely *communicated* here** (`architecture.md §4.5`). Nothing
below is a guard; each is a courtesy that stops staff being walked into a refusal.

- **I5 / I8 / I10** — only `OPEN` and `CLAIMED` can be moved. `moveRefusal()` says so before the
  request; the service's own `status` check and its conditional `WHERE status IN ('OPEN','CLAIMED')`
  predicate are the rule (`data-model.md §9`).
- **I20** — the owner's overlap conflicts, both clauses. Computed only by `ownerConflicts()` inside
  the write transaction; this screen neither evaluates nor caches them.
- **I11 / build-plan D1** — a Phase-1 run never reaches `COMPLETED`. `moveRefusal('COMPLETED')`
  exists so the branch is total and is expected to stay unexercised; the screen adds no completion
  path.
- **I1** — the route declares `tier: 'STAFF'` in `app/routes.ts` (lead-owned) and the server declares
  the same on the mutation. Hierarchical, so Admin is admitted by that one declaration.
- **`ck_shift_conflict_flag`** — the release clears `owner_id` and `assigned_over_conflict` in one
  statement, server-side. This screen never sends either field, which is why it cannot break it.

**Tests:** 41 passing / 0 failing in this lane; 253 passing / 0 failing for the whole client suite.

- `npx tsc --noEmit -p client/tsconfig.json` — clean
- `npx vitest run --root client` — 9 files, 253 tests, all passing
- `npx vitest run --root client src/screens/s1-rescue/s1-7-reschedule` — 41 of those are this lane's

No `./scripts/test-db.sh`: this lane has no server tests, per its brief.

The two clusters worth naming, because they are what a wrong answer would break *silently*:

1. **The zone.** This is the only screen that *enters* a run time, so the tests pin `America/Chicago`
   against `America/New_York` and `UTC` explicitly — the answers must not depend on where the suite
   runs. Covered: an instant read as the pantry's wall clock; midnight answering `00:00` and never
   `24:00` (which `server/src/time.ts` would reject); "today" resolved in the pantry's zone when the
   device is a day ahead; a window crossing pantry midnight; and `occurrenceDate` used verbatim so
   the day cannot drift.
2. **The conflict path.** Which 409 is cap 9's question and which is an ordinary refusal — branching
   on `ApiError.code`, never on the sentence — plus the assertion that the sentence shown is the
   server's, and that `confirmRelease` is absent from the first request.

**Deliberately not done:**
- **No replacement-driver suggestion, of any kind.** Not a picker, not a list, not a "3 drivers are
  free then" hint. Cap 9 and S1.7 both say the system never auto-selects a replacement, and the
  screen states the opposite of a suggestion out loud instead. This is the clause the brief flagged
  as most likely to be helpfully violated; it is not violated.
- **No conflict *detail* — the windows and route names in the 409's `conflicts[]` array are not
  shown.** `api/client.ts` (lead-owned) carries only `message`, `error`, `correlationId` and
  `triesLeft` off an error body, so `conflicts[]` never reaches the screen. S1.7 specifies one
  sentence and that sentence arrives intact, so this is a loss of nice-to-have detail, not of the
  required warning. Listing them would need a lead-owned change to the error shape — see `Assumed:`.
- **`GET /shifts/:id/eligibility` is not called at all.** It cannot answer S1.7's question — see
  `Assumed:`, first entry.
- **`plannedStops` is fetched and not rendered.** `GET /shifts/:id` is the only single-run read and
  it returns them; S1.7's layout is date/time only, and the stop list is S1.3's.
- **No notification copy.** A released owner's run does fan out `SHIFT_OPENED` to coordinator +
  eligible drivers, but the PRD matrix has no "your run was moved" row at all, so neither a kept nor
  a released driver is told their run changed. A test asserts no sentence on this screen contains
  "notif", "alert" or "we told" — the same pin S1.5 got in Wave 4a.
- **No `Segmented` control.** The screen has no panel switcher and no filter, so there was nothing
  for it to do here (A130/A131 noted, not needed).

**Assumed:**

1. **`GET /shifts/:id/eligibility` cannot serve as S1.7's pre-confirm check, so the unconfirmed
   `POST /shifts/:id/reschedule` is used as it instead.** My brief named the eligibility endpoint as
   "the conflict check against the current owner", but `previewAssignment()` in
   `server/src/services/coverage.ts` evaluates a driver against the shift's **currently stored**
   window and accepts no proposed date/time. Against a reschedule it would therefore answer about the
   window the owner *already works* — almost always "eligible" — which is not merely useless but
   actively misleading. The unconfirmed POST is the check the server was actually built for
   (`routes/shifts.ts`: "it is a two-step flow"), and it is non-mutating on conflict because the
   `throw` precedes the `UPDATE` inside `writeTransaction`. **I did not treat this as blocked**,
   because the surface to satisfy cap 9 exists; only the endpoint named in my brief was wrong.
2. **The consequence of (1): the warning appears when staff press "Confirm new time", not while they
   are still picking a time.** A speculative probe is impossible — an unconfirmed POST that finds no
   conflict *performs the move* — so probing as the form changes would move the run without anyone
   confirming anything. PRD cap 9 and S1.7 are both structured as surface-then-confirm and nothing
   has changed when the warning appears, so I read this as satisfying "before confirm". **A true
   dry-run (`?preview=true`, or a proposed window on the eligibility read) would let the warning
   render inline as the time is picked, which is a better screen.** That is an endpoint this lane may
   not add; it is the lead's call.
3. **A run whose stored window crosses pantry midnight is clamped to `23:59` on the form.** The server
   builds both instants from one `date` (`resolveWindow`), so such a window cannot be *expressed* by
   this form. No doc says what to do. Clamping is visible and forces a real choice; the alternative —
   prefilling an end before the start — would be a silent 400.
4. **The day picker offers today forward in the pantry's zone, plus the run's own current day even if
   it has passed.** The server accepts a past date with no lower bound. This is a client-only
   courtesy (a run in a day that has gone cannot be filled either way), and the exception keeps a
   slipped run's calendar consistent with the summary card above it. Nothing is relaxed.
5. **Pressing Confirm with nothing changed shows "Pick a different day or time first." rather than
   sending.** Moving a run onto its own window is legal server-side, merely pointless. No doc rules
   on it.
6. **A successful move navigates to S1.3 (`/shifts/:shiftId`) for both outcomes**, kept and released.
   S1.7 names no destination. S1.3 is the run's own page and the screen S1.2 and S1.6 both link into;
   a released run shows there as `OPEN`. The alternative — the board for a release, the run for a
   keep — is two destinations for one action.
7. **`DayPicker.tsx` is a new component built inside this folder**, per the brief's instruction when
   `components/index.ts` does not export what a screen needs. It is single-select where S1.4's
   `DayRangePicker` is a range, but the month grid, the six-week layout, the past-day treatment and
   the arrow navigation are the same shape. **Two lanes now want a calendar — that is the promotion
   signal.** `TimeGrid.tsx` is likewise a near-twin of S1.4's private `TimeChoice`, and this lane's
   `logic.ts` re-implements `parseIsoDate` / `isoOf` / `addDaysIso` / `compareIso` / `monthGrid` /
   `formatTimeLabel` because a screen folder is private to its lane (§3). Three copies of the
   calendar helpers now exist across S1.2, S1.4 and S1.7.
8. **The 409's `conflicts[]` array is dropped by `api/client.ts` and this lane did not extend it.**
   Reading it would need a lead-owned change (a `details` passthrough on `ApiError`). Recorded because
   it bounds how much detail *any* screen can show off a refusal, not just this one.
9. **All user-visible copy on this screen is this lane's, unread by a human** — same standing as
   A6/A45/A70/A92/A107/A129. Two pieces are load-bearing and neither is verbatim from a doc: the
   `releaseNoReplacement` sentence (cap 9 states the rule and gives no copy), and the three
   cannot-be-moved explanations. The conflict warning itself is **not** in this set — it is the
   server's.
10. **S1.7's example copy says "Karen marked herself away then… releases her run"; the shipped
    sentence says "themselves" and "their".** That wording is Wave 3's, fixed in
    `shared/src/schedule.ts` with the reason recorded there ("the schema stores no gender"), and it
    already passed a gate. I did not reword it and did not add a second copy of the sentence to
    diverge from. Flagged only so the difference from the spec's illustration is on the record.
11. **`doc-qa` could not be run from this lane.** The `Agent` tool is not available in this context,
    so I ran its checks by hand instead: two API calls enumerated (no roster access), no
    `getHours`/`getMonth`/`toISOString` anywhere in the lane (no device-zone math), no literal hex and
    no literal px beyond the `1px` hairline borders that §2 itself specifies and every existing
    stylesheet uses, one `variant="primary"` per render branch, `ConfirmModal` for the destructive
    confirm, and the §7 forbidden-word list asserted in a test. **Build-plan §5.2 makes `doc-qa` over
    the merged diff the lead's step regardless**, so this is a note, not a gap I am asking anyone to
    close.

**Unblocked:**
- The lead can wire `reschedule` into `main.tsx`'s `SCREENS` registry:
  `import { RescheduleScreen } from './screens/s1-rescue/s1-7-reschedule/index.ts'` under screen id
  `reschedule` (route `/schedule/:shiftId/reschedule`, `requires: { tier: 'STAFF' }`).
- **S1.6 and S1.3 can link here** — `go('reschedule', { shiftId })` is all either needs; this screen
  loads the run itself and takes no props beyond the URL param.
- Wave 4b's fourth screen is the last of Phase 1's build scope, so after this merges the remaining
  work is §5.4's checklist rather than more screens.
- Two promotion decisions are now the lead's, both with a second requester on record: the **calendar**
  (S1.4 + S1.7) and the **time-option grid** (S1.4 + S1.7). Neither is a blocker for the merge.
