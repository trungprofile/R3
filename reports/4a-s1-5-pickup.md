# Wave 4a — s1-5-pickup

**Status:** complete

**Built:**
- `PickupScreen` — the S1.5 full-screen takeover, exported from an `index.ts` barrel under screen id `pickup`; picks between three faces via `phaseFor()` and is wired by the lead, not here.
- Start step — active-truck picker (`GET /api/trucks`) plus one primary **Start run**; `POST /shifts/:id/start` is what picks the truck (I8) and takes the stop snapshot (I5), server-side.
- Active run view — ordered stop cards, tap **Picked up**, **Skip** behind a consequence-naming confirm, per-stop driver→receiver note, and reordering by two large Move up / Move down buttons.
- "Heading back" (I27) — appears once no stop is `PENDING`, opens the review screen (stop-by-stop summary, each stop's note, the whole-run note as a last edit) and confirms with a single **Confirm — heading back**.
- A `logic.ts` of pure functions (the gate, the focus stop, reordering, phase, copy) and an `api.ts` of the eight requests this screen makes — the only two files with rules in them, and the two the tests cover.
- `pickup.css`, token-only (no hex, no px), phone-canonical single column, 44px targets, 8px gaps.

**Files:** (all inside `client/src/screens/s1-rescue/s1-5-pickup/`)
- `index.ts`, `PickupScreen.tsx`, `StartStep.tsx`, `RunView.tsx`, `StopCard.tsx`, `ReviewStep.tsx`
- `logic.ts`, `api.ts`, `pickup.css`
- `pickup.test.ts`, `pickup-api.test.ts`
- `reports/4a-s1-5-pickup.md` (this file)

**Invariants:** every one of these is enforced server-side; this screen repeats them for communication only (`architecture.md §4.5`), so all of it is tier 3 *and mirrored*, never the enforcement itself.
- **I27** — the "Heading back" gate, `{COLLECTED, SKIPPED, REASSIGNED}`. `canHeadBack()` treats a reassigned stop as resolved *for this run*; the button appears with a stop moved off. Enforced in `completePickup` (tier 3, cross-row read inside the write transaction).
- **I30** — a `REASSIGNED` stop is struck-through, out of the count, out of the reorder body (`reorderPayload`, A84), and offers no action. No reassign action is built here; it is staff-only and lives on S1.3.
- **I5** — no stop list before `IN_PROGRESS`: the start step exists precisely because the snapshot does not. Donor name/address/note render live off the snapshot's FK, never a copy.
- **I8** — truck is chosen at start and in the same request as the transition.
- **I11 / build-plan D1** — no completion action and no `status` on any request body; a run that has resolved every stop and set the milestone still renders as the driver's active run. Pinned by tests in both files.
- **I21 / §3.3** — inactive trucks are filtered from driver selection (`selectableTrucks`).
- **I2** — the DRIVE duty requirement is declared in `app/routes.ts` (lead-owned, unedited) and again on every server route.
- **I12** — no `WEIGHED` label, because there is no `WEIGHED` disposition: it is a read-time projection and `weight_entry` is Phase 2 (D3).

**Tests:** 65 passing / 0 failing — `npx vitest run --root client src/screens/s1-rescue/s1-5-pickup`.
Whole gate green: `./scripts/gate.sh` → GATE PASSED (server 500 passing against the migrated database, client 115 passing, typecheck clean both programs).
Nothing renders in these tests: there is no browser or component harness in the repo and adding one would be a dependency (build-plan §3/D5), which is why every decision on this screen was written as a function of plain records. See **Deliberately not done** for what that leaves uncovered.

**Deliberately not done:**
- **Flag ad-hoc pickup** — S1.5 marks it Phase 2 with the rest of cap 12; the button is simply absent.
- **Reassign a stop** — staff-only (I30), S1.3's, and explicitly not the driver's from here.
- **Any run-closing action** — D1. Not an omission: a "finish run" here would be a second completion path contradicting I11 and would have to be removed in Phase 2.
- **The `assignedOverConflict` banner** — S1.3 owns it ("board/shift-detail view"); it is informational and does not block pickup execution.
- **Swipe-to-skip** — S1.5 offers "swipe **or** a Skip action"; the button is built and the swipe is not. A swipe gesture on a resolved-once-only action is the fragile control §1.5 warns about.
- **Component/DOM tests** — no harness, and a lane may not add one.
- **Roving tabindex / arrow keys in the truck radio group** — each option is a real `<button>` and is tab-reachable; arrow-key traversal is not wired.
- **An offline queue** — `sw.ts` is push-only and never cache-first (`architecture.md §4.5`); §6's blocking banner is global and the shell owns it. Nothing here caches, queues or replays.

**Assumed:**
1. **Reordering is two large "Move up" / "Move down" buttons, not a drag handle.** S1.5 says "Reordering allowed (drag handle, large)". HTML drag-and-drop does not fire on touch, a hand-rolled touch drag is exactly the "fragile control" §1.5 rules out, and a drag library is a dependency a lane may not add (build-plan §3). Buttons keep one-handed use, the 44px floor, and screen-reader operation. Same reorder request either way.
2. **Starting is pick-then-confirm (tap a truck, then "Start run"), not one tap per truck row.** S1.5 says "one big step — pick a truck (list)". A started run cannot be un-started and its truck cannot be changed afterwards, so a single mis-tap in a moving truck would be unrecoverable. Still one screen and one primary action.
3. **The truck picker is a local `role="radio"` group built inside this folder rather than `ListRow`.** `ListRow` has no selected state and no way to set a role; the rows match its ≥56px contract and styling. This is the one component built in-folder — promote it if a second lane wants it.
4. **A `REASSIGNED` stop stays visible, struck-through, with "Staff moved this stop to another driver. It is off your run."** S1.5 says only that such a stop is resolved for this run; S1.3's text says struck-through for staff. Removing it outright would make a stop vanish mid-run from a list someone is reading while driving.
5. **`Shift.staff_note` is shown read-only on both the start step and the run header.** S1.5 does not mention it (S1.3 does, "driver sees it read-only"), but during a full-screen takeover S1.3 is not reachable, and a coordinator→driver note is worth exactly nothing if the driver cannot see it while driving.
6. **Check-off is one tap with no confirm; skip has a confirm.** Both are irreversible (no edge back to `PENDING`), so the asymmetry is the spec's — "Tap to mark picked up" versus "a 'Skip' action with reason-free confirm" — and is followed rather than reconciled.
7. **After confirming, the button stays and is relabelled "Review your run", and the review screen's primary becomes "Save note" (`PATCH /note`) rather than a second `pickup-complete`.** `completePickup` is idempotent (A89) so either would work; a control that appears to re-do the milestone would misrepresent what the second tap does.
8. **The progress count excludes `REASSIGNED` from both numerator and denominator** ("1 of 2 done" with one stop moved off). No doc states the denominator.
9. **A run with no stops (A93) shows "This run has no stops." and still offers "Heading back"** — the gate is vacuously met, matching the server.
10. **The run's date/time is not displayed** (route name, truck, progress only). §1.7 strips what the task does not need, and a driver executing a run does not need its scheduled window; it also avoids inventing a timezone the client does not have.
11. **`pickup_completed_at` renders as a local clock time** ("· 4:32 PM") from the browser's own locale. No endpoint exposes `app_config.timezone` to the client.
12. **Reordering is optimistic; a failure re-reads the run.** §6's optimistic pattern is written for claim only. A rejected order must never be left on screen.
13. **Notes save on an explicit "Save note" button, never on blur, and empty text saves `null` rather than `""`.**
14. **A failure shows the server's own sentence when it sent one** (`ApiError.detail`, e.g. "Finish or skip every stop before you head back."), otherwise the client's plain per-kind message. Never a code, never the correlation id (§6).
15. **All user-visible copy on this screen is the lane's** — same standing as A6, A45, A70, A92, A107. The sentences that carry a rule, verbatim:
    - **"Heading back"** / **"Optional. It records that you finished your stops."** — optional, and about the driver's stops, not about the run.
    - **"Marked as heading back."** (toast) / **"You're marked as heading back"** / **"Nothing else is needed from you. You can still add notes."** — nothing claims the run is over (D1) and nothing claims the pantry was told, because truck-inbound is Phase 2 and the server enqueues nothing.
    - **"Confirm — heading back"** (the spec's own label) and **"A last look at your run. Anything you write here goes to the pantry with it."**
    - **"Skip this stop?"** / **"It stays skipped for the rest of the run — you cannot undo it here."** / **"Skip stop"**.
    - **"Note for the pantry"** as the driver-facing name of `ShiftStop.note` — the doc calls it the driver→receiver note; "receiver" is an internal role name, "the pantry" is the plain-language equivalent (§7).
    - **"Pick your truck"** / **"Which truck are you taking? Tap it, then start your run."** / **"Start run"**.
    - **"Nobody has claimed this run yet." / "Claim it on the board first, then start it here."**, **"This run belongs to another driver." / "Check the board for a run of your own."**, **"This run was cancelled."**, and the D1-unreachable **"This run is finished."**
    - **"Staff moved this stop to another driver. It is off your run."**
    A test pins the whole set against §7's forbidden words, against any sentence saying the run is over, and against any sentence promising a notification.

**Unblocked:**
- The lead can wire `pickup → PickupScreen` into `main.tsx`'s `SCREENS` registry; nothing else is needed and no other file was touched.
- S1.2 (board) and S1.4 (my shifts) can link a started or claimed run to `/pickup/:shiftId` — the screen handles `CLAIMED` (start step) and `IN_PROGRESS` (run) itself, and explains every other state rather than erroring.
- Phase 2's S2.2 inherits exactly what this screen produces: stops in `COLLECTED`/`SKIPPED`, both note channels written, and a run still `IN_PROGRESS` for receive-done to close.
