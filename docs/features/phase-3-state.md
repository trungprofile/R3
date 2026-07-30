# Phase 3 — state

Running record of what is built, what was assumed, and what is still open. Read
`phase-3-build-plan.md` first for the standing decisions; this file is the ledger.

Assumption numbering continues the series (Phase 2 ended at A177).

## Status

| Step | State |
| :---- | :---- |
| Migration 0012 — `ntfb_category`, the mapping column, indexes | **done** |
| `shared/src/report.ts`, `shared/src/metrics.ts` | **done** |
| `services/report.ts` — cap 15 (union, drill-in, mapping, Reporter edit, export) | **done** |
| `services/metrics.ts` — cap 16 (per-store intake, coverage failures) | **done** |
| `routes/report.ts`, `routes/metrics.ts`, registry wiring | **done** |
| Server tests — 33 new, `gate.sh` green | **done** |
| S3.1 report screen, S3.2 metrics screen | *in progress* |
| `CURRENT_PHASE = 3` | *lands with the screens* |

`CURRENT_PHASE` is held back on purpose. `nav.tsx` offers a nav entry the moment a
route's phase has shipped, so bumping it before the screens exist puts Report and
Metrics in the desktop nav pointing at placeholders — the same defect `doc-qa` caught
in Phase 2 with the tablet home path, and the same fix.

## Waiting on the human

Two facts live outside this repo and cannot be inferred from it. **Everything else in
Phase 3 is built and tested;** these two are data, not code.

### 1. The NTFB category list, and the mapping

`ntfb_category` ships empty (D12). A Reporter adds NTFB's categories on S3.1 and points
each of the 11 AGFP categories at one. Until then the report shows every category as
unmapped and refuses to export — deliberately, because a short file that looks complete
is worse than no file.

Needed: NTFB's own category names (and codes, if Meal Connect keys on codes rather than
names), plus which AGFP category reports under each. Two AGFP categories may share one
NTFB bucket; the schema allows that and the report rolls them up.

### 2. The Meal Connect export format

Emitted today: CSV, columns `Date, NTFB Category, NTFB Code, AGFP Category, Donor,
Weight (lb)`, one row per `day × category × donor`. That is the report's own grain
written flat — correct data in a guessed shape (D13).

Needed: a real Meal Connect submission, or NTFB's spec for it. Changing the shape is a
change to one function and its test.

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
