# Phase 2 — S2.2b + S2.3

**Status:** complete

**Built:**
- **S2.2b Receive done** — reads `GET /receive/runs/:shiftId/done`, prints every stop and its total (skipped stops print "skipped", never "0 lb"), the run total, and one primary **Receive done** behind a red destructive confirm carrying `RECEIVE_DONE_CONFIRM` verbatim; on success it toasts and returns to `/receive` (S2.1b).
- **S2.2b unready branch** — when `readyForReceiveDone` is false the action is absent (not disabled): the screen shows `RECEIVE_INCOMPLETE_MESSAGE` plus the outstanding stops with what each still needs.
- **S2.3 Unscheduled donation** — the driver's `SUGGESTED` prefills listed first (tap to load into the form, Discard behind a consequence-naming confirm), then the entry form: live category tiles, the big `NumericKeypad`, a Report toggle defaulting ON with `REPORTABLE_EXPLAINER` verbatim beneath it, a three-mode donor field (pick a store / type a name / no name), an optional note, and one **Submit**.
- **S2.3 recorded list** — the recently confirmed rows with a per-row report flip (`PATCH /donations/:id/reportable`); rows past the receiver edit window show `DONATION_WINDOW_CLOSED_MESSAGE` instead of a control the server would refuse.

**Files** (all inside the two assigned folders):
- `client/src/screens/s2-receive/s2-2b-receive-done/{api.ts, receive-done.ts, receive-done.test.ts, ReceiveDoneScreen.tsx, receive-done.css, index.ts}`
- `client/src/screens/s2-receive/s2-3-donation/{api.ts, donation.ts, donation.test.ts, DonationScreen.tsx, DonationForm.tsx, DonorPicker.tsx, PrefillList.tsx, RecordedList.tsx, donation.css, index.ts}`

Nothing outside those two directories was created or edited (`git status` shows exactly two untracked folders). No dependency added.

**Tests:** 72 passing (27 S2.2b + 45 S2.3), inside a whole-suite run of 505.
`npx tsc --noEmit -p client/tsconfig.json` — clean. `npx vitest run --root client` — 15 files, 505 tests, all passing.

Both screens carry the per-screen forbidden-word test (`FORBIDDEN_IN_COPY` over every value of `COPY`), matching the s1-\* pattern.

**Deliberately not done:**
- **No rendering tests.** There is still no browser or component harness and adding one is a dependency (build-plan §3/D5), so both screens' decisions live in a pure `.ts` beside the JSX and the JSX itself is untested. The layout claims below (tap sizes, landscape columns, 200% zoom) are asserted by CSS and review, not by a test.
- **No phone layout.** The responsive matrix marks both surfaces `n/a` on phone. The CSS has one max-width column (S2.2b) / a wrapping two-column entry area (S2.3), no phone breakpoint. Both read fine on desktop.
- **No weight editing on S2.3's recorded list.** Correcting a number is the ✎ overwrite on S2.2's sheet or, once the window closes, S3.1 (D9). Two places to change one number is how the two get out of step. Only the report flag is editable there, which PRD cap 15 makes a plain field edit.
- **No run-scoped variant wired.** `fetchShiftDonations` (`GET /shifts/:id/donations`) is implemented and the screen uses it when a `shiftId` route param is present, but `/donations/new` declares none — see the assumption below.

**Assumed:**

1. **`/donations/new` carries no shift, so S2.3 loads the pantry-wide worklist.** The brief lists `GET /shifts/:shiftId/donations` as an API I consume, but `app/routes.ts` (lead-owned) declares `donation` at `/donations/new` with no param, and the hand-rolled router has no query-string support. I implemented `fetchShiftDonations` and made the screen prefer it when `params['shiftId']` exists, so a future run-scoped route needs no change here — but as wired today that branch is unreachable and every open prefill is listed regardless of run. If the intent was a run-scoped entry from S2.2, the route needs a param and that file is the lead's.

2. **S2.2b tells the receiver when a driver's prefills were purged.** `receiveDone` returns `purgedSuggestions` and I17 deletes those rows inline. No doc says whether to surface it. I put it in the success toast ("Run finished. 2 flagged extra pickups were dropped — nobody weighed them.") on the grounds that a prefill vanishing silently reads as data loss to the only person who could still have acted on it. Suppress it if you'd rather the close be one flat sentence.

3. **Discard is offered on a prefill row.** `DELETE /donations/:id` exists and S2.3's spec text does not mention it. I gave it a home as a secondary action per `SUGGESTED` row, behind a confirm that names the consequence. The alternative was leaving the endpoint with no UI.

4. **The report toggle is a two-option segmented control, not a switch.** §3's component list has no switch and I may not add one to `components/`. `[ Yes, report it ] [ No, ours only ]` under the label "Report this to North Texas Food Bank" is the §3 control that does exist, gives two 44px targets, and shows both answers without opening anything (§1.5). It is still "default ON" and still one choice.

5. **"No name" stays offered while the toggle is ON, and is refused rather than hidden.** I16b is about what may be stored. Hiding the option when reporting would leave a receiver wondering where it went; instead `DONATION_SOURCE_REQUIRED_MESSAGE` appears live under the picker. Submit stays live and tapping it names what is missing — §3 prefers hiding over disabling, and for a form neither hiding nor greying explains anything.

6. **Category/weight errors appear only after Submit is tapped; the donor error is live.** The donor error is caused by flipping a toggle, so it belongs beside the toggle. Scolding an untouched form about a missing weight is not what §6 asks for. No doc covers error timing.

7. **A successful submit keeps the store, note and report choice and clears only category + weight.** I18 makes the grain one row per category, so a three-category donation is three passes through the form. Re-picking the store each time would be three times the work for no meaning. No doc states the reset behaviour.

8. **Confirming a prefill always sends both source columns, one of them explicitly `null`.** `confirmDonation` reads an absent field as "keep what the driver flagged"; omitting `donorId` while adding a label would keep the store *and* add a label, which `ck_ud_source_exclusive` refuses. Tested directly.

9. **An archived donor stays visible in the picker when a prefill points at it.** The server refuses a deactivated donor at confirm time; hiding it would make that refusal baffling, since the receiver would see an empty picker and no sign of what the driver chose.

10. **Run title is `"{owner}'s {route}"`.** The S2.2b mock reads "Karen's Tue AM run" and no doc gives a formatter. Falls back to the bare route name when the run has no owner. No possessive special-casing for names ending in *s*.

11. **`--text-on-fill` (white) used for the "Reported" chip on `--success`.** §2 states white text passes on `--success` in prose and `tokens.css` names the token for it; §2's table does not list a chip variant for a donation's report flag (its chip vocabulary is `Shift.status`), so I styled a local `s23-chip` rather than misuse `StatusChip`, which is typed to `ShiftStatus`.
