# QA Round 2 — Pass 1: Driver persona, phone width (390px)

App: http://localhost:5173 · API :3000 · Device `4310043c-05cf-49a8-bc93-d3e9053826da`
Login: `karendiaz` / PIN `4321` (VOLUNTEER, DRIVE only) — only this account was used.
Viewport: true 390×844 via same-origin iframe (macOS Chrome clamps `resize_window` to ~500–614px; confirmed via `window.innerWidth`). Spot-checked 200% zoom (195px iframe) and 320px (WCAG reflow bar).

Screens covered: S1.1 Login, S1.2 Board, S1.3 Shift detail, S1.4 My shifts + availability, S1.5 Pickup, S1.9 Inbox.

---

## Defects

### 1. A160 — topbar overflows at 390px (confirmed, reproduces on every authenticated screen)
Screen: global app shell (topbar), all S1.x screens once signed in
Severity: major (pre-known, unfixed — confirming per task brief, not new)
Device/viewport tested: phone, true 390×844 (also 320px and 195px/200%-zoom)
Role simulated: Volunteer, DRIVE
Expected (`ui-ux-spec.md §3`): "Top bar — `--structural-dark`, AGFP heart logo left, current user + logout right, notification bell with unread count, push-state chip." Implicitly must fit the phone viewport it is "identical everywhere" on (§4).
Actual: The topbar's total content width is fixed at 403px regardless of viewport (390px, 320px, and 195px all measured `scrollWidth: 403`). The **`Log out` button** (`.r3-topbar__action`) is the element whose `getBoundingClientRect().right` exceeds the viewport:
- At 390px viewport: Log out button `left:358.7, right:402.7, width:44, height:50` — **12.7px overflow**, forcing the outer page into horizontal scroll (`scrollWidth 403` vs `clientWidth 375` inside the topbar's own padding).
- At 320px viewport: same fixed topbar, Log out `right:403` — **83px overflow**.
- At 195px (200% zoom): Log out `right:403` — **208px overflow**; the `--brand-orange` "Alerts OFF, tap to fix" chip (`r3-chip--alerts-off`, 180px wide) also now overflows independently (`right:279` vs `innerWidth:195`).
Only the `Log out` button's right edge crosses the viewport boundary at 390px; the alerts chip (180px, `r3-chip--alerts-off`) and bell (44px) do not overflow at 390px but do at narrower/zoomed widths. Log out is already at the 44px width floor, so it cannot shrink further without violating the tap-target minimum — the fix has to come from somewhere else in the row (the 180px alerts chip is the largest fixed-width sibling).
Repro: sign in on a true 390px viewport, land on `/board` (or any authenticated screen) — the topbar's right edge is clipped/cut and the page scrolls horizontally by ~13px.
Screenshot: `ss_6999fymdr` (board, 390px), `ss_4878lwsjc` (shift detail, 390px), `ss_26099bd2d` (195px/200% zoom).

**Secondary finding on the same element, not previously flagged**: the username span (`.r3-topbar__user`, "Karen Diaz") collapses to **0 width** at 390px (`flex-shrink:1`, `min-width:auto`, `overflow:hidden`) — the current user's name becomes entirely invisible at this viewport, not just truncated. Spec §3 requires "current user + logout right" to both be present. This is worth fixing together with A160 since both are the same flex row running out of space.

---

### 2. Availability calendar day cells are 38px wide with 4px gaps (below tap-target minimum)
Screen: S1.4 My shifts + availability — "When I'm away" tab, date picker
Severity: major
Device/viewport tested: phone, 390×844
Role simulated: Volunteer, DRIVE
Expected (`ui-ux-spec.md §1.2`): "Min interactive size 44×44px... 8px min gap between adjacent targets." This is a non-negotiable design principle, not per-component.
Actual: Calendar day-of-month buttons measure **38×44px** (width 6px short of the 44px floor) with only **4px** horizontal gap between adjacent day cells (pitch 42px, cell width 38px). Height (44px) meets the floor; width and gap do not. For the target audience (older, paper-first volunteers) a 38px-wide button in a 7-column grid with 4px gaps is a real mis-tap risk.
Repro: 1) Sign in as Karen. 2) My Shifts → When I'm away. 3) Measure any day button in the "When are you away?" calendar grid.
Screenshot: `ss_06309y445`.

---

### 3. Numeric PIN keypad keys are 62px wide, 2px short of the ≥64px spec
Screen: S1.1 Login, PIN entry
Severity: minor
Device/viewport tested: phone, 390×844
Role simulated: n/a (pre-auth)
Expected (`ui-ux-spec.md §3`): "Numeric keypad — large 0–9 + decimal + backspace, ≥64px keys."
Actual: Digit keys measure 62×64px (height correct, width 2px under spec). Not visually obvious and unlikely to cause real mis-taps, but it is a measurable spec miss.
Repro: Log out, choose "Karen Diaz," measure any digit key on the PIN pad.
Screenshot: `ss_147027nnr` (roster), keypad measured via DOM (`{"text":"1","w":62,"h":64}`).

---

## Verified working (no defect) — notable because these are exactly what this pass was asked to settle

- **R1 sign-in roster**: bounded scroll region (`.r3-login__names`, `scrollHeight 449` vs `clientHeight 336`) holding all 8 accounts (Ada Grace, Karen Diaz, Luis Park, Nina Torres, Priya Shah, Rosa Lin, Sam Okafor, Tom Bell). Search box does **not** autofocus on load (`document.activeElement` is `BODY`). Filtering "Karen" → finds Karen Diaz; filtering "karendiaz" (the username) → "No names match." — confirms the filter matches displayed name only, per spec. Row height 56px (meets Big List Row ≥56px).
- **R2 board week range**: opens to Mon–Sun of the current week (Jul 27 – Aug 2) with `‹`/`›` (aria-labelled "Previous week"/"Next week") and a "This week" button that is **hidden while already on the current week** and appears once you've navigated away — reasonable, not a defect. Stepping back to the closed week (Jul 20–26) correctly shows **Done** (COMPLETED) runs, not filtered out. Stepping forward two weeks (Aug 3–9) shows Open runs with a live Claim button. "This week" returns correctly. All · Open · Mine segmented control persists across week navigation, 44px-tall buttons with proper gaps.
- **Claim conflict handling**: the only OPEN run in the dataset (Tue Aug 4, 9–11am) overlaps Karen's own existing "Mine" shift that day (10am–12pm on the same date). Clicking Claim correctly refused with "You already have a run at that time. Cancel it first." rather than silently succeeding or double-booking. (Because this is the only unclaimed run in the fixture set and it always conflicts with Karen's schedule, a **clean claim-success flow could not be exercised for this account** — noted below under Untestable.)
- **Release-after-start is blocked structurally, not via a failing attempt**: opening S1.3 for an `IN_PROGRESS` shift Karen owns shows no "Cancel this run" control at all (correctly hidden per spec "Before-start only; in-progress/past hide it"), so there's no way to even attempt an illegal release from the UI.
- **S1.3 BackLink**: present at the top of shift detail ("‹ Board", orange link) on every case checked — confirms QA round 1's fix landed.
- **I5 stop-list snapshot**: opened the Wed Jul 29 run (the world.txt "reassigned stop" fixture) — Eastgate Foods renders struck-through with status "Moved to another driver," staying in Karen's own stop list rather than disappearing, confirming the list is the shift-start snapshot, not a live route.
- **R8 one-stop-at-a-time**: on the fresh in-progress run (0 of 2 done), stop 1 (Hilltop Bakery) renders fully expanded (address, Open in Maps, note field, Picked up/Skip/Move down) while stop 2 (Eastgate Foods) is a collapsed one-line "To do" row, one tap from opening. "Open in Maps" derived a `google.com/maps/search/` link (target `_blank`) from the donor's address when no explicit `map_url` exists (Hilltop Bakery). The explicit-`map_url` branch (Northside Grocery has one) was **not exercised live** — doing so would require starting Karen's Fri Jul 31 run, which looked like a deliberately-left no-show/edge fixture (past-due, "Mine," truck unset) likely used by another pass (S3.2 Coverage's NO_SHOW test) — verified instead via source (`s1-5-pickup/logic.ts:271-279`, `mapLinkFor`) and its existing unit test (`pickup.test.ts:798`, explicit `mapUrl` wins over derived search). See Untestable section.
- **A120 Chicago time**: Today's shift (`startsAt: 2026-08-02T19:00:00.000Z`) renders as "2:00 PM," correctly converted to America/Chicago (CDT, UTC-5). Not a differentiating test since this test environment's own machine timezone is also America/Chicago — see Untestable.
- **D8 ad-hoc flag requires a category**: "Flag a stop not on my route" → selecting a store but leaving "What kind of food?" unselected leaves **"Flag this pickup" disabled**; it only enables once a category radio is chosen. Matches the locked-doc resolution in `phases-1-3.md` D8.
- **S1.4 availability conflict block**: selecting Aug 4–6 ("You'll be away all day, Tue, Aug 4 to Thu, Aug 6") and saving, where Aug 4 overlaps Karen's owned shift, correctly blocked with the exact spec copy: "You own a run in this window. Cancel it first." No state was saved.
- **S1.4 tabs semantics**: "My runs" / "When I'm away" implement real ARIA tabs (`role="tab"`, roving `tabindex` 0/-1, `aria-selected`, `aria-controls` pointing at a single panel) — not a fake button pair.
- **S1.9 Inbox**: the at-risk sweep fixture is present and readable ("A run is still open for tomorrow, Sun, Aug 2 2:00 PM – Sun, Aug 2 4:00 PM, Thursday Afternoon"). Tapping the row's actual `button.r3-row` (inside the outer `.r3-inbox-row` wrapper div) correctly deep-links to `/shifts/16143675-...`, the shift the event is about — confirms tap-to-act works. (My first attempt clicked the non-interactive outer wrapper and wrongly looked like a dead row; retested against the real inner control and it works. Recorded here so the false start doesn't get mistaken for a defect by a reader skimming code.)
- **Skip-stop confirm modal**: "Skip this stop? Hilltop Bakery. It stays skipped for the rest of the run. You cannot undo it here." with Cancel (white, `#333` text) and "Skip stop" (`#c2381f` / `--danger`, white text) — exact token match, Cancel-first-and-calm, destructive-red-second, consequence named. Cancelled cleanly, no state change.
- **Move up/down reordering**: swapping Hilltop Bakery / Eastgate Foods and back preserved stop check-state (both still "To do") and did not corrupt the list.
- **Mine chip color**: `rgb(43, 122, 68)` = `#2b7a44` = `--success` exactly, white text, matches §2 token table and §3 "Mine is an ownership overlay... renders in success color."
- **S1.1 wrong-PIN counter**: entering 9999 showed "That didn't match. 3 tries left." inline, exact spec wording; did not test to the soft-lock to avoid locking the only account this pass is permitted to use.
- **Body content reflow at 320px and 195px (200% zoom)**: below the topbar, all screens tested wrapped text and stacked controls cleanly with **no overflow** outside the topbar itself — the overflow is isolated to the topbar row (defect 1), not systemic.
- Console was clean (no errors/warnings) across every screen visited in this pass (Login, Board at three different weeks, Shift detail ×3, Pickup ×2, My Shifts both tabs, Inbox).

---

## Open questions (undocumented behaviour, not filed as defects)

1. **Notification title "A run is still open for tomorrow" is a static string** (`server/src/services/notification.ts:396`), not recomputed relative to when the recipient reads it. In this fixture the notification's own timestamp is "Sun 12:19 PM" (today), describing a shift that starts later *today*, yet the fixed word is "tomorrow." The underlying date/time in the body ("Sun, Aug 2 2:00 PM") is correct and unambiguous, so this isn't misleading about *which* shift, but the relative-day word can read as stale. `sweepAtRiskShifts()` deliberately excludes shifts whose start has passed (code comment: "'still open for tomorrow' would be untrue") but doesn't address the case where the shift is claimed/started before the recipient opens their inbox. Neither `ui-ux-spec.md` nor `phases-1-3.md` specifies whether inbox copy should be point-in-time (as built) or live-relative. Flagging as a question, not a defect.
2. **Search-empty copy on S1.1** ("No names match.") doesn't suggest a next step (spec's global empty-state rule wants "what to do next," but that rule is written for zero-data empty states, not a filtered-to-zero search result, and S1.1 doesn't define its own copy for this case). Likely fine as-is; flagging since it's the literal empty-state rule brushing up against an edge case the doc doesn't name.
3. The Fri Jul 31 "Mine" shift (Northside Grocery / Riverside Market, Karen owns it, past its date, truck never set, never started) looks like a deliberate no-show/undone fixture for a different pass. I left it untouched rather than starting it to check the explicit-`map_url` "Open in Maps" branch live. If that assumption is wrong and it was meant to be exercised by this pass, flag back and I'll re-run that one check.

---

## Untestable from here

- **A120 timezone correctness is not a differentiating test in this environment**: the test machine's own `Intl.DateTimeFormat().resolvedOptions().timeZone` is already `America/Chicago`, the same as the pantry's configured zone, so a device-zone-vs-pantry-zone divergence can't be demonstrated by observation alone. Cross-checked one shift's raw UTC `startsAt` (`19:00:00.000Z`) against its rendered "2:00 PM" and the arithmetic is correct for Chicago — consistent with A120, not proof against a different reading.
- **Explicit `Donor.map_url` branch of "Open in Maps," exercised live**: only reachable by starting an in-progress run whose current stop is Northside Grocery (the one donor with a `mapUrl` set). The only such shift owned by Karen looked like another pass's fixture (see Open Questions #3); starting it would be a real, unreversed state mutation. Verified via source + existing unit test instead (see above).
- **Store photo ("if set")**: every donor in this dataset has `hasPhoto: false` (checked via `GET /api/donors`), so the photo-present branch of the current-stop card cannot be observed live in this data set.
- **Clean (non-conflicting) claim-success flow, and its "Claimed 10 of 12" / full-success toast variants**: the only OPEN run in the whole fixture set conflicts with Karen's own schedule, so a successful Claim (and its toast) couldn't be exercised for this account without another pass's data changing underneath me.
- **Toast auto-dismiss timing**: per the standing limitation, screenshots are discrete; the claim-conflict toast text was captured via `innerText` immediately after the action, but its 4s-then-gone lifecycle wasn't watched continuously.
- **Shared-device "Still here?" 30s timeout prompt**: not exercised (would require sitting idle for 30s+ mid-session and this pass didn't budget for it); not a phone-specific concern per §5 but worth another pass's time.
- **True touch behavior**: taps were simulated via synthetic `.click()`/mouse-equivalent through the automation layer, not real touch events (no pinch, no momentum scroll, no on-screen-keyboard interplay) — noted per the standing tool limitation.
- Staff-only affordances referenced in S1.2/S1.3 spec text (Reassign, staff opening another driver's row, conflict-assign warnings) are explicitly out of scope for this pass's role (Volunteer, DRIVE only) and weren't touched.
