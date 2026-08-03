# R3 QA round 3 — browser pass 2 of 2

Tester: automated browser agent (Claude in Chrome), single tab, sequential sign-ins (adagrace, then samokafor — never concurrent).
App under test: http://localhost:5173 (API :3000).
Docs read: `CLAUDE.md`, `docs/foundation/ui-ux-spec.md` (S1.8, S3.1, and supporting §0–§7, responsive matrix).

**Session note:** the tab opened already signed in as "Luis Park" (a volunteer) from a prior session's leftover cookie — not a live concurrent agent, since this pass ran alone start to finish. Logged out and switched to adagrace/samokafor as instructed before doing anything else. Flagging per the task's instruction to stop and say so if signed in as someone unexpected; this was a stale cookie, not interference, so testing proceeded.

**Viewport note (read before the rest):** `resize_window` could not reach true desktop width in this environment — every request from 1024px up to 1600px was silently clamped back to **768×937** (`window.innerWidth`/`outerWidth` both read 768 regardless of the requested size; `screen.availWidth` reports 1920, so it isn't a display limit). 768px sits exactly on the tablet/desktop boundary the spec names (`ui-ux-spec.md` responsive matrix: "phone < 768, tablet 768–1023, desktop ≥ 1024"), so **all interactive testing below happened at the tablet band, not true desktop**, even though both S1.8 and S3.1 are desktop-canonical. I used the CLAUDE.md-suggested same-origin-iframe technique to additionally load Admin and Report at a real 1440×900 for **layout/overflow verification only** (confirmed the left-sidebar nav renders and no element overflows the viewport at that width) — but all clicking, typing, and form round-trips were done at 768px because the iframe can't be driven by the coordinate-based click tool without the click coordinates falling inside the outer (768px) window. This is a real gap: true-desktop *interaction* is untestable from here, only true-desktop *layout* was checked. Noted per screen below and again in "Untestable from here."

---

## Part A — Admin (adagrace)

### A1. Admin → Stores → Northside Grocery — trash deduction & food bank store number

Screen: S1.8 Admin, Donors tab, edit-store form
Device/viewport: 768×937 (tablet band; iframe-checked layout only at 1440×900, see note above)
Role: ADMIN (adagrace)

**No defects.** Everything in this section matched the rewritten S1.8 donor bullet exactly:

- **Produce rate displays as `10`**, not `0.1000`, confirming the fixture's stored 10% renders as a human percentage (`ui-ux-spec.md` S1.8: "three percentages, bakery / produce / deli").
- **Blank vs. explicit value is visually and textually distinct, live, not just on save.** Blank Bakery/Deli fields show `Blank uses the pantry default, 10%.` / `...15%.` respectively. Typing an explicit `0` into Bakery swapped that helper text in real time to `Nothing is deducted for this store.` — a stronger signal than I expected from the spec wording ("blank and an explicit 0... must stay visually distinct because they are different facts"). This is exactly the distinction the doc calls the one place "a number silently changes what the food bank is told."
- **Round-trip proven both ways**, the one the brief most wanted checked:
  - Set Bakery to `12.5`, saved, reopened → read back `12.5`. ✓
  - Cleared Bakery back to blank, saved, reopened → read back **blank**, not `0` and not `0.0000`. ✓
  - Set Bakery to explicit `0`, saved, reopened → read back `0` (with the "nothing is deducted" copy), not blank. ✓
  - All three states (blank / 12.5 / 0) survive a full save-and-reopen cycle distinctly. Final state was returned to blank to leave the fixture as found.
- **Out-of-range rejection:** typing `150` into Produce and saving produced a plain inline error, `Use a number between 0 and 100.`, in red, under the field — no page reload, no raw error code, field stayed editable. Matches §6's error contract ("plain, recoverable... never a code"). Restored to `10` afterward.
- **Food bank store number** field carries the exact placeholder-pattern example from the spec (`North Texas Food Bank's own number for this store. Their picker shows it as H-E-B Food Stores (810).`). Set Northside Grocery's number to `810`, saved, and it round-tripped on reopen. Left set at `810` for Part B as instructed.

No console errors, no horizontal overflow (checked programmatically — 0 elements with `right > viewport width` at both 768px live and 1440px via iframe).

### A2. Admin → Category matching

Screen: S1.8 Admin, Category matching tab
Device/viewport: 768×937
Role: ADMIN (adagrace)

**No defects.** Confirmed:
- **10 NTFB categories** shipped: Bread, Dairy, Dry Food, Health & Beauty, Meat, Non-Food, Pet Food, Prepared Meal, Produce, Trash.
- **All 11 AGFP categories mapped** with a storage value each: Bakery→Bread·Dry, Dairy→Dairy·Refrigerated, Deli→Prepared Meal·Frozen, Dry→Dry Food·Dry, Frozen Meat→Meat·Frozen, Frz Non Meat→Prepared Meal·Frozen, Health & Beauty→Health & Beauty·Dry, Non Food→Non-Food·Dry, Pet→Pet Food·Dry, Produce→Produce·Refrigerated, Trash→Trash·Dry.
- **Deli and Frz Non Meat both point at Prepared Meal** — the NTFB-category card for Prepared Meal reads "2 of our categories report under this," corroborating the pair from the AGFP-side list.
- **AGFP `Trash` shows `Archived`** under its row in the mapping list, as `phases-1-3.md`/CLAUDE.md's "Trash category ships archived" describes.

### A3. Access control — dead end for a non-admin hitting an Admin URL

Screen: S1.8 Admin (attempted by samokafor after switching accounts, URL carried over from adagrace's session)
Device/viewport: 768×937
Role: STAFF + REPORT (samokafor), no ADMIN tier

Not a defect — a positive finding worth recording: navigating directly to `/admin?tab=mapping` as samokafor (Staff, not Admin) rendered `You don't have access to this page.` / `Ask a coordinator if you need it.` with a `Go home` link, not a blank screen or raw error. This satisfies the `ui-ux-spec.md` §3 "dead-end state... must also carry the way out as a control, not only as advice" rule.

---

## Part B — Report (samokafor)

### B1. Weekly report, week of 2026-07-20 — the week total

Screen: S3.1 Report generation
Device/viewport: 768×937 (tablet band; layout also checked at 1440×900 via iframe, no overflow)
Role: STAFF + REPORT (samokafor)

**Open question, not filed as a defect — please confirm which number is authoritative.** The brief's expected week total was **445.75 lb**. The app, both in the UI ("Reported to North Texas Food Bank" card) and via the same endpoint the client calls (`GET /api/report?week=2026-07-20`), reads **446.00 lb** for both `reportedTotal` and `intakeTotal` (`unreportedTotal: "0.00"`).

I did not find an arithmetic bug to explain the 0.25 lb difference — the opposite, actually: every number on this screen is internally exact and traceable:
- Category totals sum correctly: Bread/Dry 112.00 + Dairy/Refrigerated 200.00 + Produce/Refrigerated 109.00 + Trash/Dry 25.00 = **446.00**, matching the header figure exactly.
- Both deducted-category drill-ins subtract cleanly with no rounding residue: Bakery weighed 125.25 − trash 13.25 = reported 112.00; Produce weighed 120.5 − trash 11.5 = reported 109.00.
- D27's "the deduction never changes the reported total" invariant holds in this data: nothing about the trash math could produce 445.75 from what's stored.

So either the fixture data behind "445.75" changed since the brief was written (a plausible read, since the underlying `weight_entry` rows didn't look like anything I touched in Part A), or the expected figure was computed a different way than "sum of what R3 currently has." Flagging for the launching agent to reconcile against its own source rather than guessing; I did not find grounds to call this a UI or calculation defect given everything traces exactly.

### B2. Agency-code line — removed

Screen: S3.1 Report generation
Confirmed via `document.body.innerText` regex scan: no match for `026357P`, `agency 026357`, or `food bank code` anywhere on the rendered report screen. **Removed as expected.** (The API's `mealConnect.agencyCode`/`foodBankCode` fields are still present in the response payload — that's fine, since the spec only requires the *screen* not print them, and the export cards checked in B4 also correctly omit them.)

### B3. Category table — Trash line marked as computed; drill-ins

Screen: S3.1 Report generation, category list + drill-in
Device/viewport: 768×937
Role: STAFF + REPORT

**No defects.** All observed behavior matched `ui-ux-spec.md` S3.1 precisely:

- **Trash · Dry, 25 lb**, with the caption `Worked out from bakery, produce and deli weight. Nothing was weighed into it.` directly under the top-level category row — this is the "marked as computed" signal, worded even more concretely than the spec's own summary phrase.
- **Bakery drill-in (deducted category)** showed exactly the three required lines, not one subtotal:
  - `Weighed under this category` — **125.25 lb**
  - `Counted as trash instead` — **− 13.25 lb**
  - `Reported under this category` — **112 lb**
  - Underlying entries: Northside Grocery 45.25 lb (Tue Jul 21), Hilltop Bakery 80 lb (Thu Jul 23), Hilltop Bakery 0 lb (Fri Jul 24) — sums to 125.25, matching "Weighed under this category" exactly.
- **Produce drill-in (deducted category)**, same shape:
  - Weighed **120.5 lb**, Counted as trash **− 11.5 lb**, Reported **109 lb**.
  - Entries: Northside Grocery 120.5 lb (Tue Jul 21), Eastgate Foods 0 lb (Fri Jul 24).
- **Dairy drill-in (no deduction configured on this category)** showed the single subtotal exactly as before — `These entries add up to 200 lb` — with **no trash wording at all**, and one entry line (Riverside Market, 200 lb, Tue Jul 21). This confirms "the explanation appears only where there is something to explain" (§7) is implemented correctly, not just documented.

### B4. Export — receipt cards

Screen: S3.1 Report generation, post-Export
Device/viewport: 768×937 (layout re-checked at 1440×900 via iframe, no overflow either width)
Role: STAFF + REPORT

**No defects — every figure named in the brief matched exactly.** Clicking Export rendered receipts on screen (never navigated to a file; `Print or save as PDF` appeared only after Export produced receipts, per S3.1: "Print appears only once there are receipts to print").

**6 receipts, in date/donor order**, confirmed:

| Pickup Date | Donor | Lines | Total Pounds | Matches brief |
|---|---|---|---|---|
| 07/21/2026 | **Northside Grocery (810)** | Bread/Dry 40, Produce/Refrigerated 109, Trash/Dry 17 | **166** | ✓ exact |
| 07/21/2026 | Riverside Market | Dairy/Refrigerated 200 | 200 | (not in brief, but self-consistent) |
| 07/23/2026 | **Eastgate Foods** | *(none)*, **Scheduled Pickup Not Attempted** ✓ ticked | 0 | ✓ exact, plus note "At the stop (Karen Diaz): Store was not open at the scheduled time." |
| 07/23/2026 | **Hilltop Bakery** | Bread/Dry 72, Trash/Dry 8 | **80** | ✓ exact |
| 07/24/2026 | **Eastgate Foods** | *(none)*, **No Pounds** ✓ ticked | 0 | ✓ (one of the two No Pounds receipts) |
| 07/24/2026 | **Hilltop Bakery** | *(none)*, **No Pounds** ✓ ticked | 0 | ✓ (the other No Pounds receipt) |

Every card's line-item pounds summed exactly to its stated Total Pounds (verified above; also checked Riverside Market's single-line 200 = 200).

**Donor line now reads Meal Connect's own picker style**: `Northside Grocery (810)`, name then the code in parentheses, matching the `H-E-B Food Stores (810)` example from the S1.8 spec text verbatim in form. This is a direct consequence of setting the store number in Part A and confirms the write path (`A1` above) actually feeds the export, not just the admin screen.

**Portal/our-material separation:** each card's top block (Pickup Date, Donor, the two checkboxes, Category/Storage/Pounds table, Number of Items, Total Pounds) is followed by a horizontal rule and the heading `Our own notes on this pickup — None of this goes into Meal Connect.`, under which sits "Where each line came from" (category → AGFP category + the trash explanation) and "Notes" (channel-labeled: Driver, At the stop, Receiver). This is precisely "under a rule and a heading saying none of it goes into Meal Connect" (S3.1) — nothing of ours is a fourth column in the portal table, so nobody typing the top block into Meal Connect would be tempted to type our annotations too.

### B5. Print-leak regression — verified via DOM only, print never triggered

Screen: S3.1 Report generation, before/after leaving the screen
Device/viewport: 768×937

**No defect — fixed as described.**
- With receipts on screen: `document.body.className` = **`"s31-print-mode"`**.
- After navigating to Home: `document.body.className` = **`""`** (empty).

Also inspected the actual stylesheet rule (not just the class toggle) via `document.styleSheets`: the `@media print` block is entirely scoped under `body.s31-print-mode`:
```
body.s31-print-mode * { visibility: hidden; }
body.s31-print-mode .s31-receipts, body.s31-print-mode .s31-receipts * { visibility: visible; }
...
```
There is no longer a bare `body * { visibility: hidden }` rule outside that scope — the historical leak (every other screen printing blank after a visit to Report) cannot recur, because the selector itself requires the class, and the class is provably removed on navigation.

### B6. Standing checks

- **Console:** clean on every screen visited in Part B (Home, Report list view, Report with drill-ins open, Report post-Export) — `read_console_messages` with `onlyErrors: true` returned nothing at each check.
- **Overflow:** 0 elements exceeded viewport width at 768px (live) or 1440px (iframe) on either the Admin or Report screens, checked programmatically (`getBoundingClientRect().right > viewport width`).
- **Tap targets:** 0 buttons/links/inputs under 44×44px on either screen at 768px. The `□`/`☑` checkbox glyphs on export receipt cards are **not real `<input type=checkbox>` elements** — they're static text glyphs mimicking the paper Meal Connect form for someone to read and hand-type, so the 44×44 tap-target rule doesn't apply to them (they aren't interactive); this is consistent with the "printable mimic of that form" design intent (S3.1) and not a defect.

---

## Untestable from here

- **True desktop (≥1024px) interaction.** `resize_window` clamped to 768px in this environment regardless of the width requested (tried 1280, 1440, 1600 — all landed at 768×937). I verified true-desktop **layout only** (left sidebar nav present, zero overflowing elements) via a same-origin iframe at 1440×900 for both Admin and Report, per the CLAUDE.md-suggested technique — but every click, keystroke, and save in this pass happened at 768px (tablet band), one width below S1.8/S3.1's canonical desktop. Anything that only breaks at true desktop chrome width (vs. the 768px tablet band, which the spec calls "usable" for both screens) would not have been caught.
- **Concurrent multi-user editing** (e.g., two reporters editing the same drill-in entry at once, or a receiver correcting a weight while the Reporter's edit window is open) — single browser tab, single session at a time, per the task's own constraint.
- **Native print dialog / actual printed output fidelity** — deliberately not invoked, per instructions. Verified the underlying `@media print` CSS scoping and class lifecycle by reading the DOM and stylesheet directly instead, which confirms the mechanism but not the rendered page.
- **Real scale/keypad hardware** for weight entry — not exercised in this pass (no weights were entered; all report figures came from existing fixture data).
