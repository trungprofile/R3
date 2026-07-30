# Phase 3 — S3.2 metrics

**Status:** complete

**Built:**
- `MetricsScreen` — S3.2's two tabs (Intake · Missed runs) via the §3 segmented control in `tabs` mode, with the period control shared above both so switching tabs never changes the window.
- Period selection as a **length + steps back** (1 / 4 / 12 weeks, default 4 = A179's 28 days), so "Earlier" moves by the period's own length and lands exactly on the window `previousIntake` is measured against. Recomputes when the pantry's zone arrives (A120) instead of freezing the machine's clock.
- Intake tab — per-store table (total rescued · to the food bank · not reported · change) with a totals row, each column carrying its own one-line explainer; trend against `previousIntake` with `null` rendered as "no earlier figure", never a 100% drop; hand-rolled CSS bars split reported/unreported, no charting dependency.
- Coverage tab — UNCLAIMED and NO_SHOW as two cards (never their sum), each with `scheduledCount` as the denominator; `byRoute` and `byDriver` tallies; the missed-runs table filterable by driver, route and period. Read-only throughout.
- Client-side CSV download per tab (S3.2's "read + export"), built from data already on screen — no dependency, no new server surface.

**Files** (all inside `client/src/screens/s3-report/s3-2-metrics/`):
- `api.ts` · `metrics.ts` · `metrics.test.ts` · `download.ts`
- `MetricsScreen.tsx` · `IntakeTab.tsx` · `IntakeTable.tsx` · `Bars.tsx` · `CoverageTab.tsx`
- `metrics.css` · `index.ts` (exports `MetricsScreen`)

Nothing outside the folder was touched.

**Tests:** 56 passing — `npx vitest run --root client src/screens/s3-report` (whole client suite: 717 passing, `npx vitest run --root client`). `npx tsc --noEmit -p client/tsconfig.json` is clean.

The tests target the four ways a wrong answer here would look right: a missing prior period rendering as a −100% trend; a displayed weight round-tripping through a float (A165); UNCLAIMED and NO_SHOW being summed; the period stepping back by something other than its own length. Plus the §7 forbidden-word sweep over the whole copy surface — every fixed string in `COPY` **and** every sentence composed from data (trend labels, driver/route lines, rate labels, date ranges, tab and preset labels).

**Deliberately not done:**
- **No phone layout.** The responsive matrix marks metrics `n/a` on phone, `usable` on tablet, canonical on desktop. Rows wrap and both tables scroll inside their own `overflow-x` box so nothing breaks at tablet width, but no phone-specific layout was written.
- **No component/DOM tests.** There is no jsdom or component renderer in this repo and adding one would be a dependency (`phase-3-build-plan.md §3`). Everything that is a rule lives in `metrics.ts` and is tested there; the `.tsx` files only arrange it.
- **No total trend cell.** Adding percentages across stores yields a figure that is arithmetically valid and means nothing, so the totals row's trend cell is empty.
- **No registry wiring, no `CURRENT_PHASE` bump.** Lead-owned, per the brief.

**Assumed:**

1. **Period presets are 1 / 4 / 12 weeks, labelled as lengths.** S3.2 asks for "period" selection and names no presets; A179 fixes only the default (28 days). I chose whole numbers of weeks so the previous-period comparison stays like-for-like, and labelled them "4 weeks" rather than "Last 4 weeks" — the Earlier/Later buttons move the window, and a "Last 4 weeks" label would go quietly false the moment someone stepped back. If the human wants named presets ("This month", "This quarter") that is a different control and a different comparison.

2. **Navigation is Earlier/Later by whole periods; there is no date picker.** No doc specifies how an admin reaches an older window. Stepping by the period's own length makes consecutive views adjacent and non-overlapping, and makes one step back land exactly on the window the trend column was measured against. An arbitrary custom range is possible (both endpoints take `from`/`to`) but would need a date input, which §1.5 discourages.

3. **The metrics export is a client-built CSV, and its columns are mine.** S3.2 says "this is read + export" and names no format. There is no metrics export route — the server's only export is S3.1's Meal Connect file (D13), a different file for a different reader — so this writes the table on screen: `Store, Intake (lb), Reported to food bank (lb), Not reported (lb), Change` and `Date, Time, Route, What happened, Driver`. Weights go out as the strings they arrived as. If the export was meant to be a server route, this is the wrong place for it.

4. **The trend cell carries no colour.** A store giving less this period is information, not an error; §2 reserves `--danger` for destructive things and `--success` for confirmed/reported. Red-and-green arrows would tell an admin how to feel about a figure they are being shown in order to think about it. Only "no earlier figure" is styled at all, and only muted.

5. **The rate is stated as "3 of 21 scheduled runs", not as a percentage.** `scheduledCount` is documented as "the denominator that turns a count into a rate, without this module deciding how to display it". At ~15 pickups a week a percentage implies precision the count does not have, and the two raw numbers are what an admin repeats out loud.

6. **Both filter pickers keep deactivated drivers and archived routes.** I21 preserves the record and its history, and a no-show from three weeks ago is exactly the history someone comes here to look up — excluding them would make a run visible in the table below unfilterable. They are not visually marked as retired; if that matters, it is one chip per option.

7. **The bar chart is `aria-hidden`.** It carries no figure the table above does not, and a screen reader that has just read five columns per store does not need them again as unlabelled percentages. The heading and a note ("The same figures as the table, drawn to scale.") stay audible so it is never a silent gap.

8. **The driver tally lists every driver with a no-show, unranked and uncoloured**, ordered by count with the name breaking a tie. §7 wants plain and non-judgemental, so the line is "3 no-shows" and nothing else — no threshold above which someone is flagged, because no doc sets one and inventing one would be the system passing a verdict on a volunteer.

9. **`formatWeight` / `weightWithUnit` are duplicated from S2.2b rather than imported.** No screen folder imports another's logic anywhere in this repo (I checked — there are no cross-screen imports), and moving them to a shared module is outside my folder. They are four lines of string surgery and both copies state the rule they exist for.

10. **The empty coverage state names cancellation** ("A run staff cancelled is not counted here"), because A182's consequence — a run cancelled the morning it was due looks identical to a no-show from the pantry's side and appears in neither count — is otherwise invisible exactly when an admin would notice a run missing.

11. **The period control sits above the tablist, not inside either panel.** It is a fact about the whole screen; putting it inside a panel would duplicate it or make it look like it belonged to one tab. It carries `aria-live="polite"` on the range label so stepping back announces where it landed.
