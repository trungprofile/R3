# QA Round 2 — Pass 5: the report and the metrics

**Screens:** S3.1 Report generation, S3.2 Admin metrics (Admin's default tab, `D18`)
**Roles:** `samokafor` (STAFF + REPORT) for S3.1; `adagrace` (ADMIN, all duties) for S3.2 and Category matching — in that order
**Viewport:** desktop, requested 1440×900; `window.innerWidth` confirmed **1440** (height 900 less browser chrome). Canonical for both screens per `ui-ux-spec.md` responsive matrix.
**Date in world:** 2026-08-02

---

## 1. The four-number reconciliation — PASS

Closed week **2026-07-20 .. 2026-07-26**:

| Source | Figure |
| :---- | :---- |
| Independent SQL (my own union, not `services/report.ts`) | **445.75** |
| S3.1 "Reported to North Texas Food Bank" | **445.75** |
| S3.2 period total, 1 week, July 20 – 26 ("All stores → To the food bank") | **445.75** |
| Exported worksheet, `Receipt Total (lb)` summed once per receipt | **445.75** |

A fifth source agrees: the S3.2 **`metrics-intake-2026-07-20-to-2026-07-26.csv`** download reads `All stores,445.75,445.75,0`.

The `Pounds` column also sums to 445.75 independently of `Receipt Total (lb)`, so the repeated-total column is not just echoing the row total.

Per-store cross-check (S3.2 vs my SQL): Riverside Market 200.00, Northside Grocery 165.75 (45.25 + 120.50), Hilltop Bakery 80.00. Exact.

Per-category cross-check (S3.1 lines): Bakery 125.25 (45.25 + 80.00), Dairy 200, Produce 120.50 → 445.75.

### The three named failure modes (`phases-1-3.md §1`) are all empirically excluded

- **Joining from `shift`.** The current week's screen shows intake **381.29** against a weights-only 302.54 — the four walk-ins (60.00 + 15.75 + 3.00 + 0.00), which have no shift, are all present. A shift-rooted join would have shown 302.54.
- **Bucketing on `created_at`.** Every seeded weight row in this database has `created_at = 2026-08-02`, spread across three different `occurrence_date` weeks. A `created_at` bucket would put **zero** in the closed week and everything in the current one. The closed week shows 445.75 → `report_day` bucketing confirmed. The seed is a perfect discriminator for this mistake, by luck or design.
- **Float summation.** Every figure renders at exact 2-dp precision (445.75, 306.04, 60.29, 165.75). `addAll()` uses integer cents and the SQL side uses `sum()` on `numeric(8,2)`.

## 2. The voided weight — PASS, no leak anywhere

The 999.00 lb entry voided on 2026-07-21 (Northside Grocery / Produce) appears in **none** of:

- S3.1's week total (445.75, not 1444.75)
- S3.1's Produce line (120.5 lb)
- the Produce drill-in (a single 120.5 entry, no 999)
- the CSV / worksheet (Northside's receipt total is 165.75, not 1164.75)
- S3.2's Northside Grocery row (165.75)

The drill-in resolves sensibly with the void present (`I13`). Confirmed in SQL that the row is still on disk (`voided = t`) and simply excluded from every sum.

## 3. Reported vs intake — PASS

Current week 2026-07-27, all three numbers on screen at once with their own labels:

- **Reported to North Texas Food Bank — 362.54 lb**
- **Received but not reported — 18.75 lb** ("Donations switched off for reporting. They still count in our own totals.")
- **Everything received — 381.29 lb**

Matches SQL exactly. They come out of one function (`totalsView`) so none can render alone. S3.2 keeps the same split in its own words ("Total rescued / To the food bank / Not reported") and in the chart legend and the CSV columns. `I15` holds in the drill-in: a `DONATION` carries the report switch, a `WEIGHT` does not.

One microcopy problem in this area — see defect **#5**.

## 4. The export refusal — PASS in both directions, with a finding about the chosen category

**CSV and print refuse identically.** Byte-for-byte:

```
GET /api/report/export?week=2026-07-20            → 409 CONFLICT
GET /api/report/export?week=2026-07-20&format=json → 409 CONFLICT
{"error":"CONFLICT","message":"Some food this week is not matched to a North Texas Food Bank category yet. An admin matches it under Admin, Category matching, and then the report is ready."}
```

Same endpoint, one `format` parameter apart (`D16`, `A186`). `runPrint()` **awaits** `fetchExportRows` before `window.print()`, so a refusal toasts and no dialogue opens. Above that, when the week is blocked the UI renders **neither button** — `canExport(report)` is false, and a DOM sweep of `.s31 button` returns only `["Previous week","Next week","This week","Bakery…","Dairy…"]`. There is no path by which CSV refuses and print does not.

**The unmap that was asked for does not block anything, and that is correct.** `Frz Non Meat` was unmapped as instructed. The export stayed available (`readyToExport: true`, `unmapped: []`, HTTP 200) because **no weight entry or donation anywhere in this database uses `Frz Non Meat`** — verified in SQL. `D12`'s rule is that an unmapped category *carrying weight* blocks, and the app says so itself in the toast: *"Frz Non Meat is not matched to anything. It will hold up the export while it carries weight."* So pass-4's nominated category cannot reproduce the refusal. This is the app behaving correctly and the pass-4 plan being wrong about the data, not a defect.

**To actually exercise the refusal**, `Produce` (120.50 lb in the closed week) was additionally unmapped, the refusal tested on both paths, and then restored. Both mappings were put back **exactly** as pass-4 left them — verified against a pre-change SQL snapshot:

```
Frz Non Meat  → PLACEHOLDER Other    · Frozen
Produce       → PLACEHOLDER Produce  · Refrigeration
```

All 11 rows are byte-identical to the snapshot taken before this pass. The blocked banner named **Produce** only, not `Frz Non Meat` — the message is precise about which category is actually holding things up.

**Successful export shape (`D13`) — PASS.** Downloaded `agfp-ntfb-2026-07-20-to-2026-07-26.csv` (512 bytes), CRLF, fully quoted:

```
"Pickup Date","Donor","Donor Code","Category","Storage","AGFP Category","Pounds","Receipt Items","Receipt Total (lb)"
"2026-07-21","Northside Grocery","","PLACEHOLDER Bakery","Dry","Bakery","45.25","2","165.75"
"2026-07-21","Northside Grocery","","PLACEHOLDER Produce","Refrigeration","Produce","120.50","2","165.75"
"2026-07-21","Riverside Market","","PLACEHOLDER Dairy","Refrigeration","Dairy","200.00","1","200.00"
"2026-07-23","Hilltop Bakery","","PLACEHOLDER Bakery","Dry","Bakery","80.00","1","80.00"
```

- Columns exactly `D13`'s nine, in order.
- Grain: one row per line item, `day × donor × ntfb_category × storage`.
- Sort: **day → donor → category** — receipt order. `2026-07-21` before `2026-07-23`; within 07-21, Northside before Riverside; within Northside, `PLACEHOLDER Bakery` before `PLACEHOLDER Produce`. Confirmed correct.
- `Receipt Items` and `Receipt Total (lb)` repeated on every row of a receipt; three receipts, item counts 2 / 1 / 1.
- `NTFB Code` correctly absent.
- Weights carry full 2-dp (`120.50`, `200.00`) — the file a person types from is not trimmed.
- Agency line on screen beside the button: **"Enter these under agency 026357P, North Texas Food Bank (24)."** Correct.
- Post-export state: *"You downloaded this week's file. Exporting again is fine. It is rebuilt from what is in R3 right now."*
- **Riverside Market**, deactivated in pass 4, still resolves in the export, in the report and in metrics. Past history survives deactivation, as `I21`'s toast promised.

## 5. The print path — content verified, rendering NOT verified

**The Print button was never clicked.** Verified structurally instead:

- `PrintSheet.tsx` draws `sheet.rows` from `fetchExportRows()` → `GET /report/export?format=json` — the *same* array the CSV is built from, in the same server-decided order. It re-derives nothing.
- `exportCells(row)` (`report.ts:466`) returns the nine values in exactly the CSV's column order; the `<th>` list comes from `sheet.columns`, i.e. the response, not a second copy of the column list.
- The header carries `mealConnectAccountNote(account)` — the identical string as the on-screen line, "Enter these under agency 026357P, North Texas Food Bank (24)."
- `report.css` **line 372** `@media print` confirmed present and read out of the live CSSOM: `body * { visibility: hidden }`, then `.s31-print, .s31-print * { visibility: visible }` and `.s31-print { display: block; position: absolute; … }`. Everything else on the page is hidden.

**The rendered print preview is untested and needs a human.** Page breaks, `break-inside: avoid` on rows, the repeating `thead`, the 1.5cm margin, and whether the nine columns actually fit portrait A4/Letter at `font-size: 0.8rem` — none of that can be seen without opening the native dialogue, which is forbidden here. See defect **#6** for one thing the CSS does that the code comments say it does not.

## 6. The drill-in (Success Metric 4) — mostly PASS, one real defect

Every entry names its **store**, **day** and **receiver**: e.g. "Thu, Jul 23 / Hilltop Bakery / Logged by: Luis Park · Thursday Afternoon / 80 lb". A walk-in with no route reads its source instead. `WEIGHT` and `DONATION` render as flat peers in one day-grouped list, never nested (`I18`) — confirmed on the current week where a Bakery donation sits between two Bakery weights.

**The Reporter correction round-trips exactly.** Hilltop Bakery 80.00 → 85.00: week total moved 445.75 → **450.75**, category line 125.25 → 130.25, drill-in footer 125.25 → 130.25. Exactly +5.00. Reverted 85.00 → 80.00: week total back to **445.75**. Both numbers noted, world restored.

The receiver's edit window is shut for this week (`receiverWindowOpen: false` on every entry) and the Reporter's edit went through anyway — `D9`/`D14` confirmed live. SQL shows the void trail is `I13`-correct: `80.00 (voided) → 85.00 (voided) → 80.00 (active)`, append-only, nothing updated in place. The keypad is the big numeric keypad, never a system keyboard.

But see defect **#1** — the panel is wrong immediately after the save.

## 7. S3.2 metrics — PASS

**Intake tab**, 1 week, July 20 – 26: Riverside 200 / Northside 165.75 / Hilltop 80 → All stores 445.75 intake, 445.75 reported, 0 unreported. Reconciles with SQL per store. 4-week (Jul 6 – Aug 2) reads 847.04 / 828.29 / 18.75 — also exact (20.00 + 445.75 + 381.29 and 20.00 + 445.75 + 362.54). "Change" column: Hilltop "up 700%" against a 10 lb prior week; "no earlier figure" where there is none, rather than a fake 0%.

**Missed runs tab** reconciles with the `shift` table exactly:

- Closed week: **0 unclaimed, 0 no-show, 0 of 2 scheduled runs.** SQL: both shifts `COMPLETED`. Matches `world.txt`'s "every run COMPLETED".
- Current week: **0 unclaimed, 1 no-show, 1 of 5 scheduled runs** — Karen Diaz, July 31, 9:00 AM, Tuesday Morning. SQL: that shift is `CLAIMED` with a window that ended and no start. The `OPEN` Aug 2 shift is correctly **not** counted unclaimed, because its 2:00 PM window has not passed yet. Derived read-only, `I7` honoured; "Nothing here can be edited." is stated on the tab.
- "By driver — No-shows only. An unclaimed run had no driver to name." Correct and well put.

Metrics is Admin's default tab; `/metrics` still resolves as a redirect.

---

# Defects

## 1. After a Reporter correction, the drill-in shows the **whole week's** entries under one category, with the week's total as the category's subtotal

**Screen:** S3.1 Report generation → drill-in
**Severity:** **major**
**Device/viewport:** desktop, 1440×900
**Role simulated:** Staff + `report` (samokafor)
**Expected (spec citation):** `ui-ux-spec.md` S3.1 — "Every line is **inspectable down to store-category-day** (Success Metric 4: 100% traceable) — click a number to expand the underlying entries". `DrillIn.tsx`'s own comment: "A revision comes back as **the category's entries** as they now stand". `ReportTable.tsx`: "the entries route narrows by AGFP category, which is also the only grain at which 'which entries made this number' is a well-posed question".
**Actual:** `reviseReportedWeight()` returns the week's entries **unfiltered**:

```ts
// server/src/services/report.ts:490
return reportEntries(anchor);          // no { categoryId: existing.categoryId }
```

The client does `setRevised(list)` and renders that array in place. After saving one Bakery correction, the **Bakery** panel listed four entries — Northside/Produce 120.5, Northside/Bakery 45.25, Riverside/Dairy 200, Hilltop/Bakery 85 — under a header still reading "Bakery 130.25 lb", with a footer reading **"These entries add up to 450.75 lb"**, which is the whole week. Two contradictory numbers for the same thing, three feet apart, on the screen whose only job is making a number traceable — and the offered ✎ controls let a Reporter now edit a Produce or Dairy entry from inside the Bakery panel.

Confirmed at the API: `GET /report/entries?week=2026-07-20` returns 4 rows; the same call with `&categoryId=<Bakery>` returns 2. The revise response returns the 4.

Self-heals on any reload or on closing and reopening the panel, and **no wrong number reaches the export, the totals card, the print sheet or NTFB** — which is why this is major rather than blocker. But it fires at exactly the moment a Reporter is checking their own correction.
**Repro steps:**
1. Sign in with the `report` duty, open `/report`, go to Mon, Jul 20 – Sun, Jul 26, 2026.
2. Click the **Bakery** row to open its drill-in. Two entries, footer 125.25 lb. Correct.
3. Click **✎ Change weight** on Hilltop Bakery, type 85, **Save weight**.
4. The panel now lists four entries from three categories, footer 450.75 lb, under a "Bakery 130.25 lb" header.
5. Reload the page and reopen the same panel — back to two entries.
**Screenshot:** `screenshot-1785697513610-0.jpg`

---

## 2. The drill-in subtotal silently adds not-reported donations to a reported line, so it contradicts the row it hangs off

**Screen:** S3.1 Report generation → drill-in footer
**Severity:** **major**
**Device/viewport:** desktop, 1440×900
**Role simulated:** Staff + `report`
**Expected (spec citation):** `report.ts:535` states the intent itself — "What the entries on screen add up to, **for checking against the row above them**." `ui-ux-spec.md §"Keep what the reader cannot see for themselves"`: "**what a number means** where two similar numbers sit together". `product-requirement.md §3`: intake and NTFB-reported stay "distinct and clearly labeled everywhere".
**Actual:** the AGFP row is the **reported** figure; the drill-in lists the **intake** entries (it must, so the report switch can be flipped) and totals all of them under one unqualified label. On the current week, the **Bakery** row reads **57.29 lb** and the footer directly under it reads **"These entries add up to 60.29 lb"** — the 3.00 lb Lakeview Deli donation whose switch is set to "Not reported" is in the footer and not in the row. Nothing on screen says why the two differ or by how much. The one number a Reporter must type into Meal Connect is 57.29, and 60.29 is the larger, more recently-read figure sitting beside it.
**Repro steps:**
1. `/report`, current week (Mon, Jul 27 – Sun, Aug 2, 2026).
2. Click the **Bakery** row (57.29 lb).
3. Read the footer: 60.29 lb. Note the Lakeview Deli row carrying an active "Not reported" switch.
**Screenshot:** `screenshot-1785697662354-1.jpg`

---

## 3. The blocked state names the unmapped category but throws away the pounds it is carrying, leaving the visible rows short of the stated total with no explanation

**Screen:** S3.1 Report generation → blocked state
**Severity:** minor
**Device/viewport:** desktop, 1440×900
**Role simulated:** Admin (would be identical for Staff + `report`; the copy is unconditional)
**Expected (spec citation):** `phases-1-3.md` D12 — an AGFP category carrying weight that maps to nothing is "**surfaced** and blocks export, never silently dropped — dropping it would understate the report by exactly the amount nobody noticed". `report.ts:373`'s own doc comment: "The unmapped categories named out loud, **with what they are carrying**."
**Actual:** the server *does* send it — `unmapped: [{ categoryName: "Produce", total: "120.50" }]` — and `unmappedSummary()` uses only `categoryName`, discarding `total`. On screen: "Reported to North Texas Food Bank **445.75 lb**" with visible category rows of 125.25 + 200 = **325.25**, and no row, figure or sentence accounting for the missing 120.50. The banner says which category, never how much. A Reporter cannot tell from this screen whether the block is hiding 1 lb or 400.
**Repro steps:**
1. Admin → Category matching → **Produce** → "Leave it unmatched".
2. `/report`, go to Mon, Jul 20 – Sun, Jul 26, 2026.
3. Compare "445.75 lb" against the two category cards below it.
**Screenshot:** `screenshot-1785698022235-3.jpg`

---

## 4. "1 category **have** no food bank category yet" — the verb does not agree in the singular case

**Screen:** S3.1 Report generation → blocked state
**Severity:** minor
**Device/viewport:** desktop, 1440×900
**Role simulated:** Admin
**Expected (spec citation):** `ui-ux-spec.md §7` microcopy — plain, correct sentences; this is the pantry-facing explanation of why the food bank report cannot go out.
**Actual:** `unmappedSummary()` (`report.ts:379`) pluralises the noun (`oneCategory` / `manyCategories`) but not the verb: `unmappedTail` is the fixed string `'have no food bank category yet:'`. With one category the screen reads **"1 category have no food bank category yet: Produce."**
**Repro steps:** as defect 3, step 3. Any state with exactly one weight-carrying unmapped category reproduces it.
**Screenshot:** `screenshot-1785698022235-3.jpg`

---

## 5. "Never the same figure as the reported one" is false on a clean week, and a clean week is the normal case

**Screen:** S3.1 Report generation → "The week in numbers"
**Severity:** minor
**Device/viewport:** desktop, 1440×900
**Role simulated:** Staff + `report`
**Expected (spec citation):** `ui-ux-spec.md` — explain "what a number means where two similar numbers sit together". `report.ts:695` explains the note is kept precisely because `domain-modeling.md §6` "requires intake and NTFB-reported to stay distinguishable".
**Actual:** `intakeNote` is a static string. On the closed week the card reads "Reported to North Texas Food Bank **445.75 lb**" and "Everything received **445.75 lb**", with "Reported and not-reported added together. **Never the same figure as the reported one.**" printed under two identical figures. Same on any empty week (0 lb / 0 lb). The sentence is trying to say the two are *different quantities*; as written it makes a claim about the *values*, and the screen disproves it. On a week where every donation is reportable — which is what a well-run week looks like — the app tells a paper-first volunteer something they can see is untrue.
**Repro steps:**
1. `/report`, Mon, Jul 20 – Sun, Jul 26, 2026.
2. Read the three totals and the note beneath the third.
**Screenshot:** `screenshot-1785698022235-3.jpg` (same card, blocked variant) and the closed-week screenshots above.

---

## 6. The print stylesheet's `body * { visibility: hidden }` is global and outlives the Report screen, so Ctrl-P anywhere in the app prints a blank page

**Screen:** S3.1 Report generation (`report.css` line 372), affecting the whole shell
**Severity:** minor
**Device/viewport:** desktop, 1440×900
**Role simulated:** Admin
**Expected (spec citation):** `ReportScreen.tsx:307-310` states the intended behaviour outright — the print section is "Rendered only once a Print has actually fetched rows, so **an accidental Ctrl-P before then prints the screen** rather than a heading with nothing under it."
**Actual:** it prints neither. `report.css` is imported by `ReportScreen` and, once loaded, stays in the document for the rest of the SPA session; its `@media print` block hides `body *` unconditionally and re-shows only `.s31-print`, which exists **only** after a successful Print click. Read live out of the CSSOM while sitting on **`/admin`** with no `.s31-print` in the DOM at all: the rule was present and active. So after one visit to Report, Ctrl-P on Board, Schedule, Admin or Report-before-printing yields a page with everything hidden and nothing shown.

`report.css`'s comment explains the choice ("this file must not know the shell's class names, and the shell is not this lane's to edit"), which is sound; the leak is the consequence nobody costed. There is no other documented print path in R3, which is why this is minor and not major.
**Repro steps:**
1. Visit `/report` (loads `report.css`).
2. Navigate to `/admin`.
3. Inspect `document.styleSheets` for the `print` media block — `body * { visibility: hidden; }` is live; `document.querySelector('.s31-print')` is `null`.
4. (Not performed — needs a human.) Press Ctrl-P and observe the preview.
**Screenshot:** none; CSSOM dump in the session log.

---

## 7. Export and Print are offered on a week with nothing in it

**Screen:** S3.1 Report generation → empty week
**Severity:** polish
**Device/viewport:** desktop, 1440×900
**Role simulated:** Staff + `report`
**Expected (spec citation):** `ui-ux-spec.md §3` prefers hiding over disabling; `ReportScreen.tsx:20` — "a button that fails is not an interaction". `ui-ux-spec.md` S3.1 names three states (incomplete, ready, exported) and does not name this one.
**Actual:** on Mon, Jun 29 – Sun, Jul 5, 2026 the screen shows a good empty state — "Nothing was received this week. / Try another week, or check that this week's runs have been weighed." — and then, below it, both **Export for Meal Connect** and **Print or save as PDF**, fully enabled. The export returns 200 with a header row and no data rows. Not harmful and arguably in spec (the week is not *blocked*), so filed as polish rather than a defect against a stated rule.
**Repro steps:** `/report` → **Previous week** back to any week with no intake.

---

## 8. The keypad's "Decimal point" key wraps to two lines and grows taller than every other key

**Screen:** S3.1 → drill-in → Change this weight
**Severity:** polish
**Device/viewport:** desktop, 1440×900
**Role simulated:** Staff + `report`
**Expected (spec citation):** `ui-ux-spec.md §1.5` — numbers are typed on a big keypad; §2 tokens imply a uniform key grid.
**Actual:** inside the drill-in the keypad column is ~370px, and the "Decimal point" label wraps onto two lines, making the bottom-left key visibly taller than `0` and the backspace key beside it and breaking the grid's rhythm. All keys remain well over 44×44 so nothing is unreachable; it just looks wrong on the one screen where the keypad is rendered narrow.
**Screenshot:** visible in `screenshot-1785697513610-0.jpg` and the keypad screenshots in the session log.

---

# Open questions (undocumented, not defects)

1. **Pass 4's nominated unmap category cannot reproduce the refusal.** `Frz Non Meat` carries no weight in any weight entry or donation in this database, so unmapping it correctly leaves the export enabled. Whether the pilot dataset should contain a `Frz Non Meat` row so the refusal has a natural rehearsal is a plan question, not a code one.
2. **"Logged by" changes to the Reporter after a correction.** Hilltop Bakery's entry read "Logged by: Luis Park" before the edit and "Logged by: Sam Okafor" after. This is `I26`-correct (last-writer `created_by`/`updated_by`) and `I13`-correct (the old row is voided and a new one inserted), but the words say "logged by", and the person who actually received the food at the pantry is no longer named anywhere the Reporter can see. Whether the screen should distinguish "received by" from "last changed by" is not settled by any doc.
3. **"Leave it unmatched" silently discards the typed Storage.** Unmatching `Produce` nulled `ntfb_storage` as well as the category, so restoring the mapping meant retyping "Refrigeration". An admin who unmatches by mistake loses wording they copied off the food bank's form. No doc says whether storage should survive an unmatch.
4. **An "Unattributed" store row on S3.2.** The 0.00 lb `Trash` donation with neither `donor_id` nor `donor_label` renders as a store called "Unattributed" with 0 lb in all three columns, in the table and in the chart legend. Harmless; whether an all-zero row should be suppressed is undocumented.
5. **Two renderings of the same weight.** The screen trims trailing zeros (`120.5 lb`, `200 lb`) per the documented `formatWeight`; the worksheet a Reporter types from carries full precision (`120.50`, `200.00`). Deliberate and probably right, but the two artefacts of the same number do not look alike side by side. The S3.2 metrics CSV follows the *screen's* convention (`200`) while the report CSV follows the file's (`200.00`) — the two exports disagree with each other.
6. **Nothing states the export is a snapshot.** "Exporting again is fine. It is rebuilt from what is in R3 right now" says it well on S3.1, and the mapping tab warns that "A week someone already exported would come out differently if they exported it again" — but R3 never records *that* a week was exported, so a Reporter returning next Monday cannot tell whether last week already went to Meal Connect. `ui-ux-spec.md` names "exported" as a state; it appears to be per-visit only.

---

# Untestable from here

- **The rendered print preview / Save-as-PDF.** `window.print()` was never called, per the standing rule. Column fit at nine columns, page breaks, the repeating table header and the 1.5cm margin all **need a human**. The *content* is verified structurally (same server call, same order, same nine cells, agency line present) but not one pixel of it has been seen on paper.
- **Defect 6's visible symptom.** That Ctrl-P produces a blank page follows necessarily from the CSSOM, but confirming it means opening the native dialogue. Needs a human.
- **Concurrent Reporters.** Two people correcting the same weight at once — the conditional `UPDATE … WHERE voided = false` and its "Someone already changed that number. Take another look." conflict message — cannot be raced from one tab. Untested.
- **The `report` duty gate from the other side.** `world.txt` names `priyashah` (RECEIVE only) as the account that should be refused on `/report`, and `ninatorres` as a no-duty read-only account. Testing either needs a third sign-in, which this pass's brief limits to two, in a fixed order. Untested.
- **A Reporter without ADMIN reading the blocked banner.** The block was produced as `adagrace`, after the one-way switch to Admin. `COPY.matchingIsInAdmin` is rendered unconditionally in `ReportScreen.tsx` with no tier branch, so the sentence is identical for Sam — but that was read out of the source, not seen on Sam's screen.
- **Offline behaviour, the shared-device "Still here?" timeout, and toast auto-dismiss timing** on these two screens — discrete screenshots cannot catch them.
- **Tablet width for S3.1** (the matrix calls it "usable"). Everything here was desktop, which is canonical for both screens.
- **The `?format=json` response headers** (content type, disposition) — the harness blocked reads of response headers; the filename was confirmed from `routes/report.ts:221` and the file that actually landed on disk instead.

---

# World state at the end of this pass

- Closed week 2026-07-20 total: **445.75 lb**, identical to the start. The Hilltop Bakery correction (80.00 → 85.00 → 80.00) left a three-row void trail — `80.00 voided`, `85.00 voided`, `80.00 active` — which is `I13` working as designed, not damage. The active row's `created_by`/`updated_by` is now `samokafor` rather than `luispark` (see open question 2).
- All 11 category mappings restored byte-identical to the pre-pass snapshot.
- No run in any week was cancelled, edited or rescheduled.
- Two files were written to `~/Downloads`: `agfp-ntfb-2026-07-20-to-2026-07-26.csv` (512 B) and `metrics-intake-2026-07-20-to-2026-07-26.csv`. Both are locally generated exports; neither was opened by anything but `cat`.
- Console stayed clean throughout. No forbidden microcopy words (`PWA`, `push subscription`, `session`, `payload`, `endpoint`, `atomic`, `instance`) appear on S3.1 or S3.2. Every interactive control measured on S3.1 is ≥44px tall.
