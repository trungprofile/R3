# Wave 4b — s1-3-shift-detail

**Status:** complete

**Built:**
- `ShiftDetailScreen` — S1.3, exported from an `index.ts` barrel under screen id `shift`; **one screen, two views, decided by the viewer and not by the device**, so a coordinator on a phone still gets the staff half and an owner on a desktop still gets theirs. Wired into `SCREENS` by the lead, not here.
- Head + facts — pantry-local day heading, the window in the pantry's zone (A120), status chip with the Mine overlay, the "repeats weekly" tag, driver name, and truck (or I8's "the driver picks one when they start").
- Stop list, read-only for everyone, from whichever of the two sources is real: the **route template** before start (I5 puts no `shift_stop` rows on a shift until then) and the **frozen snapshot** from `IN_PROGRESS` on, each labelled so nobody mistakes a plan for the driver's list.
- Coordinator→driver note (`Shift.staff_note`, cap 11 channel 1) — a `TextInput` + Save for staff, read-only for the driver, absent entirely for a driver when there is no note. Written through **`PATCH /shifts/:id` with `staffNote`**, *not* `PATCH /shifts/:id/note`: that second route is the **driver's** whole-run note (`Shift.note`, channel 3, declared `anyDuty: ['DRIVE']`). Two fields, two writers, two tiers — the lane brief named the wrong one, and the endpoint it needs already exists, so this was a correction and not a blocker.
- Conflict-flag banner (I20's staff-assign exemption) — S1.3's sentence verbatim, persistent, `role="status"`, and **read by exactly one line of code that renders one `<p>`**. Nothing on the screen is gated on it.
- **Release run** (red, owner only, before-start only) — a consequence-naming confirm for a one-off run, and for a repeating one S1.3's "Release just this one, or this and future?" with the bulk range as a segmented list of the series' *actual* upcoming days plus an open-ended "Every future run". Navigates back to the board on success and shows the server's own summary sentence.
- **Reassign** (staff only, on an `IN_PROGRESS` run's unresolved stops, I30) — a driver picker of everyone out today, pick-then-confirm, with a not-yet-started run listed but unselectable and told why.
- `detail.ts` of pure functions (capabilities, stop source, movable set, range options, candidates, copy) and an `api.ts` of the six requests this screen makes — the two files with rules in them, and the two the tests cover.
- `shift-detail.css`, token-only (no hex, no scale literal), one readable column that stops growing, 44px targets, 8px gaps.

**Four defects found and fixed in the interrupted draft the lead preserved as `62f8e2f`** (it was untested and ungated; reviewing it was part of the job):
1. **The stop list fell back to the route template when a started run had zero stops** (`run && run.stops.length > 0`). A route that gained a store after the run started would have shown the driver stops they never had — I5 freezes the snapshot and that edit cannot reach it. Now keyed to whether a run was readable at all, with its own empty-state copy, since "ask staff to add a store" is false once a run has started.
2. **The release confirm could say "Release run" while releasing every future run.** The button's label was keyed to a count derived from a *second* request; when that request failed the count read as 1 and the singular label sat in front of an open-ended range release. Now keyed to the scope, which is known locally and always right (`releaseConfirmLabel`).
3. **"Today" was the device's day in two places** — the day heading, which would read "Tomorrow" for the pantry's today to anyone whose phone had rolled over, and the reassign picker, which *bounds a fetch by day* and would have asked for the wrong day's runs outright. Now `todayInZone()` (A120's frame), device zone only as the pre-session fallback.
4. **The cancelled notice sat below the stop list**, under a full page of detail about a terminally cancelled run (I10). Moved above the facts.

**Files:** (all inside `client/src/screens/s1-rescue/s1-3-shift-detail/`)
- `index.ts`, `ShiftDetailScreen.tsx`, `StopList.tsx`, `StaffNoteCard.tsx`, `ReleaseDialog.tsx`, `ReassignDialog.tsx`
- `detail.ts`, `api.ts`, `shift-detail.css`
- `detail.test.ts`, `shift-detail-api.test.ts`
- `reports/4b-s1-3-shift-detail.md` (this file)

Nothing outside that folder was touched. No `main.tsx`, no `app/`, no `components/`, no `tokens/`, no `api/index.ts`, no `client/public/`, no `shared/`, nothing under `server/`.

**Invariants:** this is a client lane, so it **enforces nothing**. Every rule below is enforced server-side inside a `SERIALIZABLE` transaction and is repeated here for communication only (`architecture.md §4.5`) — tier 3 *and mirrored*, never the enforcement.
- **I20 + its staff-assign exemption** — `assignedOverConflict` drives the owner's persistent banner and nothing else. Pinned by a test asserting a flagged run still offers Release *and* the start step, because S1.3 is explicit that the flag never blocks pickup execution.
- **I30** — Reassign is offered only to staff, only on `IN_PROGRESS`, and only on a `PENDING` or not-yet-weighed `COLLECTED` stop; `MOVABLE_DISPOSITIONS` is pinned by a test to equal the server's list. A `REASSIGNED` stop stays visible, struck through, out of every action.
- **I5** — the two stop sources, and the reason there are two. Also why a not-yet-started run cannot receive a reassigned stop, which the picker says in words.
- **I1 / I2** — tier is hierarchical (`atLeastTier`, so Admin passes a Staff floor unnamed) and duty is set membership (`hasDuty`). Both tested, including a coordinator who does not drive.
- **I8** — no truck until the driver picks one at start; the facts card says so rather than showing a blank.
- **I23** — the recurring release returns runs to the board and leaves the series generating; the copy says the weekly run keeps coming.
- **I10** — `CANCELLED` is terminal, so the screen states it and offers nothing.
- **I11 / build-plan D1** — no completion action, and `api.ts` has no call that closes, completes, finishes or terminates anything. Pinned by three tests over the module's exported names.
- **I12 / build-plan D3** — no `WEIGHED` label, because there is no such disposition to render.
- **§4.3 default-deny** — `app/routes.ts` (lead-owned, unedited) declares `shift` with no `requires`, matching `GET /shifts/:id` at `VOLUNTEER`; every *action* on the screen is authorized again per request.
- **`pii.ts` gates people, not places** — donor addresses render untrimmed; owner and driver names are public-within-org and get no shaping.

**Tests:** 68 passing / 0 failing in this lane — `npx vitest run --root client src/screens/s1-rescue/s1-3-shift-detail` (54 in `detail.test.ts`, 14 in `shift-detail-api.test.ts`).
Full lane gate green: `npx tsc --noEmit -p client/tsconfig.json` → exit 0, and `npx vitest run --root client` → **280 passing / 0 failing, 10 files** (up from 276 before this lane's fixes: 5 added, 1 removed with the count helper it covered). `./scripts/test-db.sh` deliberately not run — this lane writes no server code and has no server tests.
Nothing renders in these tests: there is no browser or component harness in the repo and adding one would be a dependency (build-plan §3/D5), which is why every decision was written as a function of plain records. See **Deliberately not done** for what that leaves uncovered.

**Deliberately not done:**
- **Component/DOM tests** — no harness, and a lane may not add one. Untested by construction: the JSX arrangement, focus behaviour of the two dialogs, and the CSS.
- **Staff bulk-terminate** — S1.3 draws this distinction itself: it is staff-only, terminal (`CANCELLED`), lives on `POST /patterns/:id/terminate`, and belongs to S1.6. `api.ts` has no call for it and a test pins that.
- **Any run-closing action** — D1. Not an omission; a second completion path would contradict I11 and Phase 2 would have to remove it.
- **Stop check-off, skip and reorder** — the driver's, on S1.5. The only write S1.3 puts on a stop is I30's reassign.
- **Staff unassign** — clearing someone else's owner is `POST /shifts/:id/unassign`, a different operation with a different notification, and S1.6's.
- **A "why is Release gone?" line** for the owner of a started or passed run — S1.3 says in-progress/past *hide* it, and §3 prefers hiding to disabling.
- **A back button** — the shell's nav is the way out (bottom nav on the phone, side nav on the desktop) and §1.7 keeps off screen what the task does not need.
- **An offline queue** — `sw.ts` is push-only and never cache-first; §6's blocking banner is global and the shell owns it.
- **Roving tabindex on the two segmented controls in the release dialog** — they use the promoted component's `filter` behaviour, where every option is deliberately tab-reachable; `tabs` semantics would be wrong here since no panel is switched.

**Assumed:**
1. **S1.3 carries the only link to S1.5, as a *secondary* button ("Start this run" / "Open my run").** Nothing else in the shell navigates to `/pickup/:shiftId` — S1.2 opens a Mine row into S1.3 and S1.4's run list does the same — so without this S1.5 is unreachable and build-plan §5.4's "reachable through the shell" fails. No doc says S1.3 links to S1.5. It is rendered secondary, and primary only when Release is absent, so the screen always has exactly one high-emphasis button (§1.1) while S1.3's stated primary action stays Release.
2. **The conflict banner is owner-only; staff see nothing.** S1.3 says "the owner sees a persistent banner" and its sentence is second-person about "your declared availability". Staff set the flag themselves, so reading it back tells them nothing. A neutral staff-facing variant would have been invented copy.
3. **Release is not gated on the DRIVE duty client-side**, though the server declares `anyDuty: ['DRIVE']` on it. This breaks the house convention that the client mirrors the server's declaration. An owner whose Drive duty was removed after they claimed would otherwise be shown a run they cannot hand back at all, with only staff able to rescue it; the server's refusal is the honest answer there. The link on to S1.5 *is* duty-gated, because that route requires Drive and the link would be a dead end.
4. **"Any driver with an open or in-progress shift today" is read as `CLAIMED` or `IN_PROGRESS`.** An `OPEN` run has no driver at all, so it cannot name one. Claimed-but-not-started runs are listed but unselectable with the reason shown, because the server requires an `IN_PROGRESS` destination (I5) — hiding them would read as the driver being absent, and §3's prefer-hiding rule is outweighed by that.
5. **The "date-range option for bulk" is a list of the series' actual upcoming days, not a date field.** §1.5 rules out fragile pickers and S1.4's own picker deliberately avoided native date inputs. Open-ended "Every future run" is the default and the only option when the days cannot be read.
6. **Reassign is pick-then-confirm**, not one tap per driver row, following A126's precedent on S1.5: `REASSIGNED` is terminal and cannot be moved back, so a single mis-tap would be unrecoverable.
7. **Two reads, not one:** `GET /shifts/:id` always, then `GET /shifts/:id/run` only when the run is `IN_PROGRESS`. The first carries `plannedStops`, `occurrenceDate`, `ownerName` and `recurrencePatternId` that the run payload does not; the second carries the stop ids and dispositions that Reassign needs.
8. **A viewer who is neither owner nor staff gets a read-only view rather than a refusal.** The route declares no `requires` and `GET /shifts/:id` is `VOLUNTEER`; a 403 from `GET /shifts/:id/run` degrades to the planned route instead of erroring the whole screen.
9. **`todayInZone()` extends A120 from times to the day boundary.** A120 ruled that *times* render in the pantry's zone; it did not say the same about which calendar day is "today". I read the day boundary the same way, because `occurrenceDate` is stated in the pantry's frame. **This differs from the board's shipped behaviour**, which uses the device's date for its `?from=` bound (A121) — worth a human's eye, since two screens now compute "today" differently.
10. **The already-weighed Reassign branch is unexercisable in Phase 1 and is not built as a branch at all.** S1.3 says an already-weighed stop has no Reassign action; `WEIGHED` is a read-time projection over non-voided `WeightEntry` rows (I12) and `weight_entry` is Phase 2 (D3), so no `COLLECTED` stop can be weighed yet. The movable set is written as exactly the server's `['PENDING', 'COLLECTED']` with a comment naming where Phase 2 will subtract from it.
11. **Staff may still edit the note on a cancelled run.** `updateShift` accepts a staff note at any status, so the editor is not hidden; no doc says it should be.
12. **The day heading and the pantry-zone time formatter are a second copy in this folder**, not a shared import — the per-folder pattern `s1-5-pickup` set with its own `timeOfDay`. A promotion candidate for the lead if a third screen wants them.
13. **All user-visible copy on this screen is the lane's, unread by a human** — same standing as A129/A6/A45/A70/A92/A107. Pinned by tests against §7's forbidden words, against the word "shift", against any sentence implying the run is finished or complete (D1), and against any offering to terminate or delete a series. The two sentences S1.3 fixes verbatim (the conflict banner, the recurring release question) are pinned by equality.

**Unblocked:**
- S1.3 is complete and ready for the lead's `SCREENS` wiring — one import plus one registry line under screen id `shift`, which `S1.2` and `S1.4` already navigate to.
- With this merged, **every Phase-1 screen that S1.2 and S1.4 link to exists**, and S1.5 becomes reachable through the shell for the first time (see `Assumed: 1`) — one of build-plan §5.4's five items.
- Nothing in Wave 4b depends on this lane; the remaining three own disjoint folders.
