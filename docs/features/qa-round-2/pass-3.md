# QA Round 2 — Pass 3: Staff scheduling, desktop

**Role:** samokafor — STAFF tier, `REPORT` duty only (no DRIVE)
**Viewport:** requested 1440×900; `window.innerWidth` reported 1400 (Chrome clamp on this macOS box — noted, not filed, since it is still comfortably desktop-width and not the phone-clamp failure mode described in the harness notes)
**Screens:** S1.6 (Runs / Recurring runs / Route templates), S1.7 (reschedule), S1.2 (board, staff view)

---

## Defects

### 1. Board's `?edit=<shiftId>` deep link does not open the run's editor
**Screen:** S1.2 Shared shift board (staff) → S1.6 Schedule
**Severity:** major
**Device/viewport:** desktop, 1400×813 (requested 1440×900)
**Role simulated:** Staff, REPORT only
**Expected (spec citation):** Pass brief: "The board's staff rows have an Edit link that deep-links into this screen via `?edit=<shiftId>`. Follow it and confirm it opens the right run's editor." The whole point of a deep link is that the destination state is reproduced without a further click.
**Actual:** Clicking **Edit** on a board row navigates to `/schedule?edit=<id>` (confirmed via URL and via `location.search`), and the URL is correct for the shift that was clicked. But the row's inline editor never opens — the row renders collapsed, showing only its summary (`Open`/`Edit`), with no expanded form, no textarea, no buttons. Confirmed twice: once by following the link from the board, once by a **fresh full page load** directly to `/schedule?edit=<id>` (ruling out a client-side-routing-only bug). A DOM query for `<input>/<textarea>/<form>` on the page returns zero elements in this state. Manually clicking the same row's **Edit** link *does* open the editor correctly in place, so the row-level editor itself works — only the `?edit=` query-param wiring is inert.
**Repro steps:**
1. Sign in as `samokafor`, go to Board.
2. Find any staff row with an **Edit** link (e.g. an Open row) and click it.
3. Observe the URL changes to `/schedule?edit=<shiftId>` but the target row stays collapsed.
4. Reload the same URL directly — still collapsed.
5. Click the same row's own **Edit** link manually — editor opens correctly, inline, in place.
**Screenshot:** none saved (state is the absence of visible change from the collapsed board-editor screenshots taken at each step).

### 2. "Cancel this run?" modal's calm button reuses the word "Cancel," which the spec explicitly rules out for a cancel-flavored destructive action
**Screen:** S1.6 run editor (This run scope) → Cancel this run
**Severity:** major
**Device/viewport:** desktop, 1400×813
**Role simulated:** Staff, REPORT only
**Expected (spec citation):** `ui-ux-spec.md §3` Modal/confirm: "The calm default reads 'Cancel' unless the destructive action is itself a cancel, in which case it takes a distinct word ('Keep it') — two buttons reading 'Cancel' is not a choice." Cancelling a run is exactly the case the doc names.
**Actual:** The modal reads "Cancel this run?" with consequence text "It comes off the board and no one can claim it. This cannot be undone." (correct, names the consequence). But its two buttons are **"Cancel"** (calm/secondary, white) and **"Cancel the run"** (destructive, red) — both built on the word "Cancel," the precise pairing the spec calls out as confusing and forbids. The calm button should read something distinct, e.g. "Keep it," per the doc's own worked example.
**Repro steps:**
1. Open any run's editor (This run scope), e.g. via Schedule → Runs → Edit on any row.
2. Click **Cancel this run**.
3. Observe the two buttons: "Cancel" and "Cancel the run."
**Screenshot:** captured inline (modal centered, white "Cancel" left, red "Cancel the run" right).

---

## Confirmed correct (no defect — recorded because they were explicit checks for this pass)

- **R3 (editor opens in place):** Confirmed on all three panels — Runs, Recurring runs, Route templates. Clicking a row's own Edit/name expands the editor as a child of that row's `<li>`; the list above it does not reflow or jump, and the row that was clicked is the row that opens.
- **D19 (route default note), all four steps — PASS, including the load-bearing step 3:**
  1. Tuesday Morning route carries default note "Ring the bell at the loading dock; the door is usually locked."; Thursday Afternoon's default note is empty.
  2. Publishing a new run from Tuesday Morning prefilled "Note for the driver" with that exact text, and the field was an editable `<textarea>`.
  3. **Changed Tuesday Morning's default note, saved the route, then reopened a run already published from it before the change — the run's note was unchanged**, still reading the original text. `I25`/`D19` independence holds.
  4. Publishing from Thursday Afternoon produced a genuinely empty note field (`value: "", length: 0` via DOM), never the string `"null"`.
- **R4 (recurring scope control):** Opening a run instance's editor (e.g. the Aug 4 "Thursday Afternoon" occurrence, reached via the board's Edit link) shows the scope control inline, defaulting to **This run**, legend "Edit just this date, or the weekly pattern?" with the verbatim helper copy. Switching to **Every Tuesday** genuinely swaps the field set: "This run" shows Note for the driver / Save / Set a driver / Take the driver off / Move to another day or time / Cancel this run; the pattern scope shows only a single "Edit the weekly pattern" button + Done. The two scopes are not decorative — they render different controls, and `I23`/`I24` separation looks intact.
- **A111 (starting date is computed, not typed):** On both the "Add a recurring run" and "Edit the weekly pattern" forms, "starting" appears only as read-only summary text ("This recurring run will make Every Wednesday, starting Aug 5, no end.") — no input field exists for it.
- **R5 (TimeField), mostly PASS:**
  - 15-minute steps confirmed (5:00 AM, 5:15 AM, 5:30 AM, ... 10:00 PM), same granularity on S1.6 and S1.7.
  - End-time list correctly excludes times at/before the selected start (start 5:15 AM → end list begins at 5:30 AM).
  - Escape closes the popover and returns focus to the trigger button.
  - Outside click closes the popover.
  - Home moves to the first option; Enter commits the highlighted option and closes the popover, updating the button label.
  - ArrowDown/ArrowUp move the highlighted option one step at a time (verified via `aria-activedescendant`).
  - **End key:** initially appeared to land 4 items short of the true last option (9:00 PM instead of 10:00 PM) in one trial, but this did **not reproduce** across two clean, keyboard-only retests (both on S1.6 and S1.7) — see Open Questions. Not filed as a defect.
- **Route reorder (keyboard):** the drag-handle is a focusable `<button>`; pressing ArrowDown/ArrowUp on it reorders the store list and moves focus with the row. Confirmed on the Tuesday Morning route template.
- **Vocabulary:** screen consistently says "Recurring runs" and "Route templates"; stops are labeled "Suggested order for the driver." No occurrence of "repeating" anywhere in visible text (checked programmatically across Runs/Recurring runs/Route templates panels). No forbidden microcopy words (PWA, push subscription, session, payload, endpoint, atomic, instance) found anywhere on the screen.
- **Sam has no DRIVE duty:** confirmed the board and Schedule screens never offer a Claim action to Sam — Open rows show only the status chip + an Edit link. "Set a driver" is present in the run editor, confirming coordination (cap 4) is a staff capability independent of driving.
- **One primary action per screen:** each panel (Runs/Recurring runs/Route templates) has exactly one orange primary button ("Publish a run," "Add a recurring run," "New route"); Save/Cancel/Delete pairs use secondary/danger styling correctly.
- **No horizontal overflow, console clean:** `document.documentElement.scrollWidth` never exceeded `window.innerWidth` on Schedule, Board, or the reschedule screen; no app-originated console errors across the session (only Grammarly extension noise and Vite HMR debug lines).

---

## Untestable from here

- **S1.6 assign-driver conflict warning** ("Karen marked herself away then — assign anyway?"): not observed. Triggering it needs a driver with a declared-availability conflict against the exact run being assigned; no such conflict existed in the visible dataset for the runs I could safely edit, and creating one would require signing in as a driver to declare availability — outside this pass's single login (`samokafor`) and outside the single-tab, single-session harness.
- **S1.7 reschedule conflict warning** (same copy, "Moving this releases her run back to the board"): moved Karen Diaz's Aug 4 run to Aug 5 in the picker without a conflict surfacing (no unavailability declared for that slot in this dataset). The conflict-path copy and release-to-Open behavior described in `ui-ux-spec.md` S1.7 were not exercised. Reverted without confirming (clicked "Back to the run"), so no state was changed.
- **True 200%-zoom / WCAG-320px reflow check** on S1.6/S1.7: not attempted this pass — out of scope per the pass brief (canonical desktop only), noting for completeness since the harness's iframe technique wasn't invoked here.
- **Concurrent multi-staff editing** (e.g. two coordinators editing the same run's scope simultaneously): implied by the shared-schedule nature of this screen but untestable with a single browser tab per the harness limitations.

## Open questions

- **TimeField End key, once-off anomaly:** in a single early trial (S1.6 "Starts" field, sequence: open → ArrowDown → End → then I additionally scrolled the popover with the mouse wheel before reading DOM state), `aria-activedescendant` pointed at 9:00 PM while the list's true last option was 10:00 PM. Two subsequent clean keyboard-only retries (no mouse-wheel scroll interleaved) on both S1.6 and S1.7 landed correctly on the true last option every time. This looks most likely to be an artifact of mixing a manual mouse-wheel scroll into a keyboard-driven session in my own test tooling (not something a keyboard-only user would ever do) rather than a genuine widget bug, but flagging it as unresolved rather than either dismissing it outright or filing a defect I could not reliably reproduce.
