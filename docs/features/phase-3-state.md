# Phase 3 — state

Running record of what is built, what was assumed, and what is still open. Read
`phase-3-build-plan.md` first for the standing decisions; this file is the ledger.

Assumption numbering continues the series (Phase 2 ended at A177).

## Status

| Step | State |
| :---- | :---- |
| Migration 0012 — `ntfb_category`, the mapping column, indexes | **done** |
| Migration 0013 — `category.ntfb_storage`, `donor.ntfb_donor_code`, the agency codes | **done** |
| `shared/src/report.ts`, `shared/src/metrics.ts` | **done** |
| `services/report.ts` — cap 15 (union, drill-in, mapping, Reporter edit, export) | **done** |
| `services/metrics.ts` — cap 16 (per-store intake, coverage failures) | **done** |
| `routes/report.ts`, `routes/metrics.ts`, registry wiring | **done** |
| Server tests — 35 new, then 4 more for the worksheet, `gate.sh` green | **done** |
| S3.1 report screen (60 tests), S3.2 metrics screen (56 tests) | **done** |
| `CURRENT_PHASE = 3`, both screens registered, `api.put` | **done** |

`CURRENT_PHASE` was held back until both screens existed and then bumped in the same
commit that registered them. `nav.tsx` offers a nav entry the moment a route's phase
has shipped, so a premature bump would have put Report and Metrics in the desktop nav
pointing at the shell's placeholder — the defect `doc-qa` caught in Phase 2 with the
tablet home path, avoided here by the same rule.

**The screen registry is now complete.** Every screen in `ui-ux-spec.md §8` has an
entry in `main.tsx`, and `AppShell`'s Placeholder is unreachable through the nav.

## Waiting on the human

**Item 2 below was answered on 2026-07-30** by a submitted Meal Connect receipt (agency
026357P, pickup 2026-03-20) plus screenshots of the three entry screens. The export was
reshaped around it (D13, D15, migration 0013). Item 1 is narrower than it was but is
still open, and still data rather than code.

### 1. The NTFB category list, the mapping, and the storage per row

`ntfb_category` ships empty (D12) and `category.ntfb_storage` ships null (D15). A
Reporter adds NTFB's categories on S3.1, points each of the 11 AGFP categories at one,
and types the Storage that goes beside it. Until the first half is done the report shows
every category as unmapped and refuses to export; the second half does not block, and is
named on the mapping row instead.

**What the receipt showed**, recorded here so nobody re-derives it from a PDF — but
*not* seeded, see D12:

| NTFB category (observed) | Storage on that line |
| :---- | :---- |
| Meat | Frozen |
| Bread | Dry |
| Produce | Refrigeration |
| Prepared Meals | Frozen |
| Dairy | Refrigeration |
| Assorted Dry Food | Dry |
| Non-Food | Dry |
| Pet Food | Dry |
| Health & Beauty | Dry |
| Trash | Dry |

Ten names off one receipt, not the dropdown's vocabulary. Our eleven line up closely
enough that AGFP's list was clearly derived from NTFB's — but `Frz Non Meat` matches
none of the ten, and that one gap is the whole reason the table is still the pantry's to
fill. Storage is per *mapping row*, not per NTFB category (D15), so two of ours sharing
one bucket under different storage is representable and comes out as two line items.

Still needed: the full category dropdown, where `Frz Non Meat` reports, the storage
wording their form uses, and the NTFB donor codes for the stores on our routes
(`donor.ntfb_donor_code`, nullable, blank in the worksheet until entered).

### 2. ~~The Meal Connect export format~~ — answered

The far end is a **web form with no import**: a receipt per `(pickup date, donor)`, line
items of `Category · Storage · Description · Pounds`, a review list showing
`Number of Items` / `Total Pounds`, then Submit. So the export is a worksheet for
hand-entry, and is now shaped and ordered to be read while typing (D13). Two smaller
questions it raised are open as A189 and A191 below.

## Bugs found and fixed during the build

- **Unmapped-but-reportable weight counted as *unreported*.** Found by exercising the
  API, not by a gate: 516 lb of produce with no NTFB category read as `unreported
  516.25`. A scheduled weight is reportable by construction (I15); having no mapping is
  a gap in a lookup table, not a decision that the food goes unreported. `reportedTotal`
  is now Σ of everything reportable, mapped or not, and the gap between it and Σ`lines`
  is what `readyToExport: false` already announces.
- **The Reporter's report toggle was window-gated.** Caught by `doc-qa`. S3.1's toggle
  reused the receiver's `setReportable`, which enforces the receiver's edit window — so
  once that lapsed the flag was uneditable by *anyone*, the reverse of cap 15. It
  shipped because the weight path had a post-window test and the toggle did not.
- **Two high-emphasis buttons on S3.1.** Caught by `doc-qa`. The drill-in's Save and
  the panel's Export rendered together, against §1.1's "exactly one". Export now steps
  down while a drill-in is open — a Reporter mid-correction should not be pointed at
  the export.

## Open assumptions

### A178 — the report week runs Monday to Sunday

No doc names the boundary. PRD §1 makes the cycle weekly and S3.1 says "pick a week";
neither says which day it starts. Monday-start is the ISO week and the ordinary reading
of "a week", and the pantry's own runs are named by weekday ("Tuesday Morning"), which
suggests nothing either way. One function (`weekBounds`) if it should be Sunday-start.

### A179 — metrics default to the last 28 days

S3.2 gives no default period. 28 days is four whole weeks, which lines up with a weekly
report cycle and makes the previous-period comparison a like-for-like four weeks rather
than a ragged month. Both endpoints accept explicit `from`/`to`.

### A180 — the export groups; it does not emit one row per entry

Two receivers adding 60 lb and 40 lb of produce from one store on one day export as a
single 100 lb row, because `data-model.md §8` states the report's grain as `report_day ×
category × donor-or-label`. The drill-in still resolves that row to both entries with
their receivers (Success Metric 4), so nothing is lost — but the file the food bank sees
is a day's total per store per category, not a keystroke log.

*Still true after D13, and now corroborated:* Meal Connect's own line items are totals
per category on a receipt, not per weighing. The grain gained `storage` (D15); it did
not gain rows.

### A188 — the worksheet repeats each receipt's totals on every row

`Receipt Items` and `Receipt Total (lb)` are the two figures Meal Connect's review screen
shows back before Submit, so they belong in the file. They are repeated on each row of a
receipt rather than written as subtotal rows, which keeps the file rectangular — a CSV
with interleaved subtotals opens badly in every spreadsheet, and this file exists to be
read by a person mid-task.

The alternative worth knowing about: one row per receipt with the line items nested, or
two files. Both are harder to read side-by-side with a form than a flat sheet is.

### A189 — pounds are not rounded to whole numbers

Every `Pounds` value on the sample receipt is an integer, but so was every value typed
into it, so the receipt is no evidence the form refuses a decimal. The worksheet emits
`numeric(8,2)` unchanged.

If Meal Connect does reject decimals, rounding is **not** a one-line change: rounding
each row makes Σ rows disagree with the receipt total and with the week's own figure by
a pound or two, and the Reporter is then holding two numbers that do not match while
Meal Connect shows a third. Whoever confirms this should decide where the remainder goes
before it is implemented.

### A190 — an AGFP category with no storage still exports

`category.ntfb_storage` is nullable and a null does not block the export, unlike an
unmapped category (D12). The reasoning is that the two failures are different sizes: an
unmapped category means weight goes **unreported**, while a missing storage means one of
four fields on a line the Reporter is typing anyway is blank, and they can see the food
in front of them. It is named on the mapping row so it is not a silent gap.

Read the other way — that a receipt cannot be submitted without Storage, so a blank one
blocks just as surely — this should block too. Nobody here has tried to submit one.

### A191 — R3 exports nothing for a stop that produced no food

Meal Connect's entry form carries two checkboxes R3 has no equivalent output for:
**`Scheduled Pickup Not Attempted`** and **`No Pounds`**. Between them they say a
scheduled pickup happened, or didn't, and yielded nothing — which suggests NTFB expects
a receipt for it rather than silence.

R3 already knows both states: `shiftstop_disposition` has `SKIPPED`, and a `COLLECTED`
stop can carry no weight entries. The export emits neither, because the report is
`weight_entry ∪ unscheduled_donation` and a stop with no weight is in neither half.

**Deliberately not built.** Emitting these would widen `domain-modeling.md §6`'s union,
and that doc is **locked** — this is a doc change first and a code change second, and it
turns on a fact nobody here has: whether NTFB wants those receipts from us at all, or
whether the checkboxes exist for food banks whose own drivers do the pickups. Until that
is answered, a skipped stop is visible in S3.2's coverage metrics and absent from the
report, which is what the locked definition says.

### A181 — remapping a category re-reports history

Every week's report is computed on read, so pointing "Frozen Meat" at a different NTFB
category changes what an already-exported week *would* say if exported again. That is
correct — the mapping states what a category **is**, not what it was during one week —
but it means a mid-year remap silently changes the past. No doc addresses it. If the
pantry ever needs exported weeks frozen, that is a stored snapshot and a schema change.

### A182 — a `CANCELLED` run is not a coverage failure

`MISSED` is `window passed ∧ status ∈ {OPEN, CLAIMED}` (I7), which excludes `CANCELLED`
by construction, and the code follows the invariant exactly. Recorded because the
*consequence* is a judgement someone might disagree with: a run cancelled the morning it
was due looks identical to a no-show from the pantry's point of view, and it will not
appear in either count. Counting it would punish staff for tidying the board, and
cancelling is the documented way to remove a run that should not happen.

### A185 — S3.1's own assumptions

Twelve, in `reports/phase3-s3-1.md`. The four that change what a person sees or can do:

- **The drill-in hangs off the AGFP line, not the NTFB total.** `GET /report/entries`
  narrows by AGFP category, so an NTFB total made of two AGFP categories resolves to
  two lists rather than one. S3.1 says "click a number to expand the underlying
  entries" without saying which number; this is the only grain the route offers.
- **"Exported" is a local fact and dies on navigation.** Nothing in the schema records
  that a week was downloaded. If the pantry needs "has this week been sent?" to survive
  a reload, that is a stored fact and a schema change.
- **The weight edit uses the big keypad on a desktop screen.** §1.5's "never a tiny
  system keyboard" carries no device qualifier, so the rule was followed as written.
  On a desktop with a real keyboard it may be more ceremony than intended — the one
  place a plain numeric field would plausibly be kinder.
- **Navigating into a future week is allowed**, with a plain "still ahead" note so an
  empty week does not read as a bad one. No doc bounds the picker.

### A186 — S3.2's own assumptions

Eleven, in `reports/phase3-s3-2.md`. The three worth a decision:

- **The metrics CSV is built on the client, with columns the lane chose.** There is no
  server export route for metrics. This is a different file for a different reader than
  S3.1's Meal Connect export — which is a server route precisely so it can refuse to
  emit a short one — but if a metrics export was meant to be server-side, it is in the
  wrong place.
- **Period presets are 1 / 4 / 12 weeks, navigated as whole periods** with no date
  picker. S3.2 names no presets and no default.
- **The driver no-show tally has no flagging threshold.** It states counts and does not
  editorialise, because no doc sets a number at which a tally becomes a concern.

### A187 — `formatWeight` is duplicated rather than shared

S3.2 copies the weight formatter from S2.2b instead of importing it. There are **no
cross-screen imports anywhere in this repo** — that is the established pattern, and
promoting the helper would mean editing `components/`, which every screen depends on.
Recorded rather than fixed: the cost of the duplication is two functions that could
drift, and the cost of the fix is a change under every other screen.

### A183 — the report screen owns the mapping editor, per D11

This is `ui-ux-spec.md`'s own open assumption 3, which asks the human to confirm where
the mapping lives. Answered as "S3.1" and recorded here so the question does not
disappear into the code — it is still the human's to override.

### A184 — an open run does not block the export; an unmapped category does

S3.1 asks for an "incomplete week" state. Two things can make a week incomplete and they
are treated differently: an AGFP category carrying unmapped weight **blocks** export
(the file would be wrong), while a run still `OPEN`, `CLAIMED` or `IN_PROGRESS` in the
week is **surfaced but does not block** (the file would merely be early, and only the
Reporter knows whether the week is really over).
