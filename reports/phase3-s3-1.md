# Phase 3 — S3.1 report

**Status:** complete

**Built:**

- Week picker — previous / next / this-week, with the Monday–Sunday range spelled out at both ends (A178 shows its working).
- Two-panel screen via the §3 segmented control in **tabs** mode: **Report** and **Category matching** (D11 — a Reporter who hits the block fixes it without leaving the screen or changing tier).
- The report table — one card per NTFB category, with the AGFP categories rolled into it listed underneath with their own weights (`ReportLine.agfpCategories`).
- Three totals from one function, never one number: `reportedTotal` (marked as the figure the file carries), `unreportedTotal`, `intakeTotal`, each with a sentence saying what it is and is not (PRD §3).
- Drill-in per AGFP category — store, day, receiver, weight (Success Metric 4), grouped by `report_day`, with an exact integer-cent subtotal to check against the line above.
- Weight edit (✎) — big keypad, prior value shown, plain overwrite, no undo and no history UI. PUT `/report/weights/:id`.
- Report switch on donation entries — a `Segmented` two-state switch, PATCH, last write wins. Absent on `WEIGHT` entries (I15).
- The unmapped block — leads the panel, uses `EXPORT_BLOCKED_MESSAGE` verbatim, names the categories, and its primary action jumps to the matching tab. **Export is absent, not disabled, while blocked** (§3 "prefer hiding over disabling").
- Open-run block — surfaced, never blocking (A184), with each run named by route, day and plain-word status.
- Matching editor — point each AGFP category at an NTFB one (or clear it), and add / rename / re-code / archive / reactivate NTFB categories. I21's outcome is reported, never predicted. A181's "this changes every week" is stated where the remap happens.
- Export — real CSV download via `fetch` → blob → synthetic anchor click, filename from `content-disposition`. Copy says the columns are our best guess (D13).
- States: incomplete (what is missing, both kinds), ready, exported.

**Files** (all inside `client/src/screens/s3-report/s3-1-report/`):

- `report.ts` — pure logic + all copy (week arithmetic, weight strings, integer-cent addition, totals, export decision, drill-in grouping, mapping editor state, `FORBIDDEN_IN_COPY`)
- `report.test.ts` — 60 tests, vitest, no DOM, no database
- `api.ts` — the ten calls, plus the `put` bridge and the CSV download
- `ReportScreen.tsx`, `ReportTable.tsx`, `DrillIn.tsx`, `MappingEditor.tsx`
- `report.css`
- `index.ts` — `export { ReportScreen }` (+ `export * from './report.ts'`, matching S2.2b's barrel)

Nothing outside the folder was touched.

**Tests:** 60 passing (721 across the client suite).

- `npx tsc --noEmit -p client/tsconfig.json` — clean
- `npx vitest run --root client` — 19 files, 721 tests passing
- `npx vitest run --root client src/screens/s3-report` — 1 file, 60 tests passing

**Deliberately not done:**

- **No phone layout.** The responsive matrix marks report `n/a` on phone and `usable` on tablet. There is no phone breakpoint; every row wraps and the totals grid collapses to one column, which is also what carries the desktop layout through 200% zoom.
- **The union, the block and the totals are not recomputed client-side.** `canExport` returns `report.readyToExport` and nothing else; the drill-in subtotal is the only number this screen adds up, and it is integer-cent exact and returns null rather than a wrong figure.
- **No duplicate-name rule on NTFB categories.** Nothing in the docs says names must be unique, so the editor requires non-empty and stops there rather than refusing a name the server accepts.
- **No `<table>` element.** Entries render as a labelled list rather than a grid, so 200% zoom reflows instead of producing a horizontally scrolling table. Store/day/receiver/weight are all still visible per entry.
- **No screen registry or `CURRENT_PHASE` change** — the lead owns `app/routes.ts`, `main.tsx` and the bump.

**Needs the lead (one line of shared code, not made here):**

- `api` in `client/src/api/client.ts` still has no `put`, while two report routes are PUTs. `api.ts` bridges the verb locally with `client.ts`'s own exported primitives — same cookie mode, same `ApiError`, same offline/activity reporting — exactly as S2.2's lane did for the same reason. A one-line `api.put` collapses both bridges and their three call sites.

**Assumed:**

1. **The drill-in hangs off the AGFP line, not the NTFB total.** `GET /report/entries` narrows by `categoryId` (AGFP), and an NTFB total made of two AGFP categories resolves to two lists, not one. So every AGFP sub-line is clickable and the NTFB total is inspected by opening its parts. S3.1 says "click a number to expand the underlying entries" without saying which number; this is the only grain the route offers.
2. **Navigating into a future week is allowed.** No doc bounds the week picker. Next-week is offered without a ceiling; a week that has not happened gets a plain note ("still ahead") so an empty week does not read as a bad week.
3. **"Exported" is a local fact, not a stored one.** Nothing in the schema records that a week was downloaded, so the exported state lasts as long as the Reporter stays on that week and is cleared when they navigate. If the pantry needs "has this week been sent?" to survive a reload, that is a stored fact and a schema change.
4. **The mapping editor is a tab on S3.1, not a section below the report.** Both satisfy D11's "without leaving the screen". Tabs were chosen because S1.8 already establishes the idiom and because a long matching list under a long report would push the export off screen. The blocked block's primary action switches tabs.
5. **The weight edit uses `NumericKeypad`.** §1.5's "numeric input uses a big on-screen keypad, never a tiny system keyboard" is stated without a device qualifier, and the canonical device here is a desktop with a real keyboard. Followed the rule as written; if the intent was tablet/phone-only, this is the one place a plain numeric `TextInput` would be more comfortable.
6. **The report switch is a two-option `Segmented`.** §3 lists no switch component and §1.5 rules out fragile controls; `Segmented` is the repo's stand-in and is what S1.8 uses for the same shape of choice. It reads "In the report / Not reported" rather than on/off.
7. **The NTFB category picker is a visible list of big rows, not a dropdown** (§1.5). This assumes NTFB's category list stays short — it is a food bank's submission-form vocabulary, so tens rather than hundreds. If it turns out to be long, the picker needs a filter.
8. **Archived NTFB categories are excluded from the picker.** Pointing a live AGFP category at an archived bucket would build the next unmapped block by hand. They stay visible in the category list so one archived by mistake can be put back (`UpdateNtfbCategoryRequest.active`, §3.3's reverse arrow).
9. **Archived AGFP categories still appear in the matching list**, marked. They can carry historical weight and therefore can still block an export of an older week.
10. **The export is fetched, not linked.** A plain `<a href>` would answer the server's refusal by navigating away from the report into an error body; fetching means a refusal arrives as an `ApiError` and is said out loud like every other failure (§6). Costs one blob in memory, which for a week of CSV is nothing.
11. **A revised weight re-renders from the PUT's response**, and a flipped switch re-reads the drill-in. Both also trigger a re-read of the week, because either can move `reportedTotal`.
12. **The week's totals card is shown even on an empty week.** Three zeros with their labels state the fact plainly; the instructive empty state sits below it in place of the table.
