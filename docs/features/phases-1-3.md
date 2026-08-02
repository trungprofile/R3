# Phases 1–3 — the build record

**All three phases are built.** This doc is the single record of how, what was decided, and what
was left for a human. It replaces the six per-phase docs (`phase-{1,2,3}-{build-plan,state}.md`)
and the 24 lane reports, which are preserved verbatim under `archived/` — see §7.

**Code cites this doc.** Roughly thirty comments across migrations, services, tests and client
code reference a decision (`D#`) or an assumption (`A#`) by number. Those numbers are defined
here and keep their original meaning. A citation like `phase-1-build-plan.md D3` or
`phase-3-state.md A189` resolves to §2 and §5 below.

The foundation docs in `docs/foundation/` are unchanged and still own every rule. This doc records
only what they left open. **`domain-modeling.md` remains locked** and still wins any conflict.

---

## 1. What each phase built

| Phase | Scope | Capabilities | Screens |
| :---- | :---- | :---- | :---- |
| **1 — Rescue** | The rescue loop and scheduling: accounts, master data, routes, recurrence, coverage, claim/assign, pickup execution, notifications, PWA | 1–11, 13 (minus truck-inbound), 17 | S1.1–S1.9 |
| **2 — Receive** | Weight entry at the pantry, unscheduled donations both halves, the truck-inbound row Phase 1 held back | 12, 14, 13's remainder | S2.1b, S2.2, S2.2b, S2.3, S2.4 |
| **3 — Report** | Pure aggregation over what 1 and 2 produced: the report/metrics union, the AGFP→NTFB mapping, the Meal Connect worksheet, admin metrics | 15, 16 | S3.1, S3.2 |

Every screen in `ui-ux-spec.md §8` has an entry in `client/src/main.tsx`, except **S2.4**, which is
a device-level banner the shell mounts rather than a route. `CURRENT_PHASE = 3`. `./scripts/gate.sh`
is green — 646 server tests across 41 files, 784 client tests across 20 files, 1,430 total, as of
2026-08-01. **Not deployed; no production data exists.**

`docs/features/test-plan.md` is the pre-pilot test plan built on this record.

### The definition Phase 3 computes, and the three ways to get it wrong

`domain-modeling.md §6`, **locked**, quoted rather than paraphrased:

```
report  = weight_entry[voided = false]  ∪  unscheduled_donation[CONFIRMED ∧ reportable]
metrics = weight_entry[voided = false]  ∪  unscheduled_donation[CONFIRMED]
```

Three ways to compute that wrong, **each of which yields a number that looks right**:

1. **Filtering the union on `Shift`.** The locked doc forbids it in as many words — walk-ins have
   none. A join starting from `shift` drops every unscheduled donation and the total still adds up,
   to the wrong figure.
2. **Bucketing on `created_at`.** `report_day` is `shift.occurrence_date` for a weight and
   `received_date` for a donation (`data-model.md §8`). Receiving legitimately lags past midnight.
3. **Summing in JavaScript.** `numeric(8,2)` is exact; a float is not. Every total is a SQL `sum()`
   or integer-cent addition.

`server/test/report-union.test.ts` has one test per mistake, each written to fail loudly rather than
to a plausible wrong number. *Cited by `report.ts:21`, `report.ts:238`, `report.test.ts:245`.*

### How it was built

Phase 1 ran as unattended worktree-isolated lane agents in four waves. Phases 2 and 3 did not —
`.claude/settings.json` disabled bypass mode, so the invariant-dense layer was built serially and
only the screens fanned out. The gate was identical in all three: `scripts/gate.sh` plus `doc-qa`
over the merged diff, both mandatory, **the gate deciding pass/fail rather than the lead**.

---

## 2. Standing decisions (D1–D21)

Numbering is one series across all three phases. Decisions are *settled*; they are not
re-litigated. Where one supersedes another, both are kept.

`D1`–`D15` were taken while building. `D16`–`D21` came out of the first hands-on QA pass
over the running app (2026-08-02) and are recorded the same way, because three of them
overturn or bend something earlier and none of that should have to be reconstructed later.

### Phase 1

**D1 — a Phase-1 run never reaches `COMPLETED`.**
I11 makes the receiver's receive-done the only completion action and the receiver shipped in
Phase 2, so a started shift stayed `IN_PROGRESS` permanently. No staff "close run" action, no
auto-complete. **Lifted by D7.**

**D2 — cap 17 (category management) ships in Phase 1.**
`product-requirement.md §4` omitted cap 17 from every phase row while `ui-ux-spec.md S1.8` — a
Phase-1 screen — included a Categories tab. Resolved in favour of the UI spec. The PRD row was
updated to say so.

**D3 — migrate Phase-1 tables only.**
`data-model.md §7` (`weight_entry`, `unscheduled_donation`) deferred to Phase 2. **Its stated cost:**
I21's soft-delete "has referencing history" predicate gains new referencing tables in Phase 2, so it
was written as exactly one function per entity (`donorHasHistory()`, `categoryHasHistory()`,
`userHasHistory()`, `routeHasHistory()`). Phase 2 paid that cost as a one-line change per function,
and `masters-category.test.ts` now asserts the referencing-table set so a third cannot arrive
unnoticed. *Cited by `migrations/0001`, `0011`, `services/pickup-route.ts`, `services/user.ts`,
`test/truck-inbound.test.ts`.*

**D4 — agents ran unattended under `bypassPermissions`, isolated by worktree.**
Phase 1 only. Blast radius contained by giving each agent its own git worktree.

**D5 — dependencies are the lead's, added only between waves.**
Worktrees share one `node_modules` by symlink, so a lane installing mid-wave corrupts every
sibling's tree. **`web-push`** (+ `@types/web-push`) was the only dependency added in three phases.
A routing library was **considered and rejected** — both release lines carried open high-severity
advisories, and the app is nine screens behind one nav, so the router is hand-rolled.
*Cited by `middleware/cookies.ts`, `services/auth.ts`, and every screen's logic file.*

**D6 — the lead is exempt from background-job worktree isolation.**
`.claude/settings.json` sets `worktree.bgIsolation: "none"`. A lead inside a worktree cannot merge
lane branches or fast-forward a branch checked out elsewhere. Isolation lives in the **lanes**.

### Phase 2

**D7 — `COMPLETED` becomes reachable, and exactly once.**
`services/receive.ts` `receiveDone()` is **the only** function that writes `status = 'COMPLETED'`,
reached only by `POST /receive/runs/:id/done`. D1 predicted a second completion path would need
removing; there never was one, so this is an addition. The driver still has no completion step, and
I27's handoff (`pickup_completed_at`) still completes nothing.

**D8 — the driver's ad-hoc flag carries a category.**
**A real conflict between foundation docs**, resolved by authority order rather than preference:
`ui-ux-spec.md:193` says S1.5's control is "just a donor picker … no weight entry", while the
**locked** `domain-modeling.md §2.3` makes `Category` required on `UnscheduledDonation` with no
`SUGGESTED` exemption, and `data-model.md §7.2` has `category_id NOT NULL`. A `SUGGESTED` row cannot
be stored without a category, so the locked doc wins and the driver picks one. The receiver may
correct it at confirm time, which makes the driver's pick a prefill rather than a commitment.
**`ui-ux-spec.md` was deliberately not edited** — a conflict between a locked doc and a lower one is
the human's to resolve. *Recorded in `shared/src/donation.ts` on `FlagAdHocRequest`.*

**D9 — the edit window gates edits, never the completion.**
`app_config.receiver_edit_window_days` from shift start applies to `addWeight`, `reviseWeight`,
`voidWeight`, `skipStop`, `confirmDonation`, `setReportable`. **Not** to `receiveDone` — gating the
completion would make a lapsed run *permanently unclosable*, since D7 leaves no other transition
into `COMPLETED`.

**D10 — receiver-authored donations are walk-ins; only driver-adds carry a shift.**
`POST /shifts/:id/donations` (DRIVE duty) always sets `shift_id` and `received_date =
shift.occurrence_date`. `POST /donations` (RECEIVE duty) never sets it, and `received_date` is the
pantry-local receive day. Structural rather than a per-call-site judgement: the shift records *where
the food came from*, and a walk-in handed over while someone is weighing a run did not come from
that run.

### Phase 3

**D11 — the AGFP→NTFB mapping lives on S3.1.** *(Superseded by `D17`. Kept, per the rule above.)*
`ui-ux-spec.md`'s own open assumption 3 asked where. Resolved to the Report screen: it is where the
mapping's effect is visible, and a Reporter who finds an unmapped category mid-report should not
have to change screens *and tiers* to fix it. Routes are `REPORT`-duty, not `ADMIN`-tier.
**Still the human's to override** — moving it to S1.8 is a route-access change and a screen move,
not a data change. *Cited by `routes/report.ts`; recorded in `ui-ux-spec.md §8` open assumption 3.*

The human overrode it on 2026-08-02. The reasoning above was sound and the override does not
say it was wrong; it says the pantry reads the mapping as configuration, and configuration lives
in Admin. See `D17`.

**D12 — NTFB categories ship EMPTY, and unmapped weight blocks the export.**
The 11 AGFP category names are the pantry's and were seeded at launch (migration `0010`). The NTFB
(Meal Connect) names are **North Texas Food Bank's** and appear in no foundation doc. Migration
`0012` creates the table and seeds nothing. Inventing them would put fabricated values in the one
column deciding what the pantry reports to its food bank, and **every gate here would pass while it
did**. The consequence is load-bearing: an AGFP category carrying weight that maps to nothing is
**surfaced and blocks export**, never silently dropped — dropping it would understate the report by
exactly the amount nobody noticed, which is the failure Success Metric 4 exists to kill.
*Cited by `migrations/0012`, `data-model.md:172`.* **See §3.1 — this still needs the pantry.**

**D13 — the export is a worksheet for a web form, not a file anyone uploads.**
*Settled 2026-07-30 by a real submitted receipt (NTFB agency 026357P, pickup 2026-03-20) and
screenshots of the three Meal Connect entry screens. Supersedes the original "CSV at the report's
grain, columns provisional".*

Meal Connect is three web screens a person types into. A receipt is `(Pickup Date, Donor)`, Donor
from NTFB's own picker reading `H-E-B Food Stores (810)`. Under it are N line items of
`Category · Storage · Description · Pounds`. A review list shows each pending receipt with
`Number of Items`, `Total Pounds`, status `New`; a separate **Submit Receipts** step files them.

**There is no import.** So "Meal Connect format" is not a file format — the export's job is to be the
sheet a Reporter reads *while typing*:

- One row per **line item**, grain `day × donor × ntfb_category × storage`.
- Sorted **`day → donor → category`** — receipt order. (Sorting category before donor scatters one
  receipt's lines down the file.)
- `Receipt Items` and `Receipt Total (lb)` **repeated on every row** of a receipt — the two numbers
  the review screen shows back before Submit. Repeated rather than emitted as subtotal rows, which
  would make the file non-rectangular.
- Columns: `Pickup Date, Donor, Donor Code, Category, Storage, AGFP Category, Pounds, Receipt Items,
  Receipt Total (lb)`.
- **`NTFB Code` is not exported.** The form picks a category by name from a dropdown; the
  `MEAT48675888`-style ids on the receipt are Meal Connect's own per-line identifiers, issued on
  submission. `ntfb_category.code` stays a nullable column and a field on S3.1.

**D14 — the Reporter's edit is deliberately NOT window-gated.**
D9 closes the receiver's edit window; S3.1's edit does not honour it, and that is the point — PRD
cap 15 says that after the window closes the Reporter's drill-in is "the *only* remaining way to
correct that entry". Mechanically identical to the receiver's correction (void-old + insert-new,
I13), presented as a plain overwrite, no approval step. The `reportable` toggle stays a plain field
edit and calls the *same* service S2.3 calls, so I16b is checked in one place.

**D15 — a Meal Connect line item is `(category, storage)`, and storage is part of the mapping.**
The form asks for Storage beside Category on every line. `category.ntfb_storage` (migration `0013`)
is the missing half. It sits on the **AGFP** side, not on `ntfb_category`, because storage varies
within one NTFB bucket — `Frz Non Meat` and `Dry` may both report as one NTFB category while being
frozen and dry, and the sample receipt proves Meal Connect accepts that (two separate `Prepared
Meals` lines, 239 lb and 73 lb). On `ntfb_category` it would force one answer per bucket and file
frozen food as dry. Consequences, both intended: the report rolls up on the **pair**, so one NTFB
category under two storage values is two lines and two line items; and `storage` is **free text** by
D12's argument unchanged. A missing storage is surfaced on the mapping row but does **not** block
the export — a weaker failure than an unmapped category, so a weaker response. *Recorded in
`ui-ux-spec.md:357`.*

### QA round 1 (2026-08-02)

The first hands-on pass over the running app, on an admin account. Two items in that feedback
turned out to be **already built** and are recorded here so nobody re-derives them: the volunteer
PIN already defaults to the last four digits of the phone (`services/auth.ts` `defaultPin`,
specified by `architecture.md §4.2`), and an admin can already set or reset a staff or admin
password (`services/user.ts` `setCredential`, `ui-ux-spec.md` S1.8). There is deliberately no
self-service reset and no unlock path; a forgotten admin password is a database-level fix.

**D16 — "export to PDF" is a print view, not a PDF library.**
QA asked for PDF. Every PDF library is a dependency, which `D5` forbids, and `D13` had already
settled that the artefact is *a worksheet somebody reads while typing into a web form that has no
import* — not a document anyone files. So S3.1 gained a print-styled view and the browser's own
Save-as-PDF, which produces a real PDF at zero dependency cost. **The CSV stays**; this is an
addition, not a replacement. The print view draws its rows from the *same* server function as the
CSV, through `?format=json`, so `D13`'s grain and `A184`'s refusal cannot drift between the two
outputs — a short report is invisible at the far end, which is the failure Success Metric 4 exists
to kill.

**D17 — the AGFP→NTFB mapping moves to Admin, under `tier: 'ADMIN'`. Supersedes `D11`.**
`D11` resolved `ui-ux-spec.md` open assumption 3 to S3.1 and explicitly left the choice open to a
human. The human chose Admin: the pantry reads "which of our categories reports as which of
theirs" as a setup decision, and every other setup decision is already in S1.8. The Reporter's
mid-report escape hatch that `D11` was protecting is weaker than it looked, because the same
person is usually the admin at this pantry's scale. **The report routes themselves stay
`REPORT`-duty** — an Admin without the duty is still not a Reporter, and `product-requirement.md
§2` is explicit that `report` is not tier-restricted. Only the mapping routes changed tier.

**D18 — S3.2 Metrics becomes S1.8's first tab.**
Both were `tier: 'ADMIN'` top-level routes sitting adjacent in the nav, which made "Admin" and
"Metrics" look like two places rather than one back office. Metrics is now Admin's default tab.
`/metrics` still resolves, as a redirect, so an existing bookmark does not break. The screen keeps
its **S3.2** spec ID: it is the same screen, reached differently. Nothing it computes changed —
`domain-modeling.md §6` is locked, and Intake and NTFB-reported stay two distinct labelled numbers.

**D19 — a route carries a default staff note, and it is a default, not a fifth note channel.**
QA asked for a per-route note that new runs start with. The obvious build is a new note field,
and it is wrong: PRD cap 11 and the **locked** `domain-modeling.md` enumerate exactly four note
channels and state that none of them share storage. So `route.default_staff_note` **seeds
`shift.staff_note`** — channel 2, coordinator to driver — at the moment a run is created, and
nothing reads it afterwards. The precedent is `recurrence_pattern.owner_default_id`, which
defaults an owner the same way. Two consequences, both intended and both tested: a recurring
pattern reads the route's note **at materialization**, so a run minted next March carries whatever
the route says next March; and editing a route **never** rewrites a run that already exists, which
is `I25`'s independence applied to a field `I25` did not originally name.

**D20 — a donor carries a map link and a photo; the bytes live in Postgres.**
Drivers arriving somewhere new before dawn are looking for a door, and an address does not always
name one. `donor.map_url` is an explicit override; `NULL` means "derive one from the address",
which the client does. The photo is its own table, not a `donor` column, because every `SELECT`
against `donor` in this codebase reads whole rows and a `bytea` column would drag images into the
board, the route builder, the admin list and the report.
Bytes in the database rather than on disk, and no upload library: multipart parsing is a
dependency (`D5`) and a mounted volume is a **second thing to back up** beside the database — and
there are no database backups on the pantry box yet, so that would be two problems instead of
one. The client resizes on a `<canvas>` to ~800px JPEG and posts a data URL in ordinary JSON; the
ceiling is a CHECK constraint, so the guard that cannot be bypassed is the database's.
Its FK is `ON DELETE RESTRICT` like every other one in the schema (`data-model.md §0`), and
`removeDonor` clears the photo inside the same transaction so the hard-delete escape hatch for a
mistaken create still works. A photo is not history.

**D21 — no em dashes in UI copy, and a hint that restates its control is deleted.**
QA's words were that the app "reads like AI slop". The two tells were an em dash used where a
full stop belongs, and a sentence under every control explaining what the control obviously does.
Both are now rules, and `ui-ux-spec.md §7` carries them.
What is **kept** is as much of the decision as what is cut: consequences of irreversible actions,
why something is blocked, and what a number means where two similar numbers sit together. The two
component contracts that force such copy — `EmptyState`'s required body ("say what to do next")
and `ConfirmModal`'s required `consequence` — were **not** loosened. Their text was trimmed.
An em dash used as an empty-value glyph is not prose and stays.

---

## 3. What still needs a human

### 3.1 The NTFB category list, the mapping, and storage per row — **blocks export**

`ntfb_category` ships empty (D12) and `category.ntfb_storage` ships null (D15). A Reporter adds
NTFB's categories on S3.1, points each of the 11 AGFP categories at one, and types the Storage
beside it. Until the first half is done the report shows every category as unmapped and **refuses to
export**. The second half does not block; it is named on the mapping row instead.

**What the one receipt showed** — recorded so nobody re-derives it from a PDF, and deliberately
**not seeded**:

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

Ten names off *one* receipt, not the dropdown's vocabulary. Our eleven line up closely enough that
AGFP's list was clearly derived from NTFB's — but **`Frz Non Meat` matches none of the ten**, and
that one gap is why the table is still the pantry's to fill. Seeding ten of eleven is the
fabricated-value failure D12 exists to prevent, one row smaller.

**Still needed:** the full category dropdown, where `Frz Non Meat` reports, the storage wording their
form uses, and the NTFB donor codes for the stores on our routes (`donor.ntfb_donor_code`, nullable,
blank in the worksheet until entered).

### 3.2 A160 — the phone topbar overflows at 390px. **The one known unfixed defect.**

`.r3-topbar` is a single non-wrapping flex row whose content measures a fixed **417px at every
width**. At 390px "Log out" is clipped 27px off-screen, the user's name collapses to 0px, and the
page scrolls horizontally; worse at 320px and at 200% zoom. Everything *below* the topbar reflows
perfectly — zero non-topbar overflow on Board, My Shifts and Inbox at 390/320/195px — so this is one
contained shell defect, not a layout that fails generally.

Trigger is the "Alerts OFF — tap to fix" chip (194px): hide it and `scrollWidth` is exactly 390.
That chip shows whenever push is unconfigured or permission is denied, **both supported states**.
`.r3-topbar__action` sets `min-width: var(--target-min)`, so Log out was already at its 44px floor
and nothing else in the row can yield.

**Two fixes were measured live**, both clearing the overflow at 390/320 and both no-ops at desktop:

- `flex-wrap: wrap` — costs 44px of phone vertical space (bar 56→100px), truncates nothing.
- chip shrinks and ellipsizes — bar stays 56px, visually truncates both the chip text and "Log out".

Each degrades something a human should weigh for a paper-first reader. **Not picked silently.**

### 3.3 Fourteen screens of user-visible copy have never been read by a human

`A6/A45/A70/A92/A107/A129/A137/A155` — Phase 1's nine screens (S1.6 alone is ~90 sentences), plus
Phase 2's five surfaces. **The mechanical half is enforced**: every screen plus `pwa/` holds a §7
forbidden-vocabulary test, so no banned word can reach a user. What is left is the part a machine
cannot do — whether the unspecified sentences are the right words for a paper-first reader.

The load-bearing ones, where a wrong word teaches someone something false: S1.7's
release-no-replacement sentence and its three cannot-be-moved explanations; S2.2b's toast naming how
many unconfirmed prefills the close discarded.

### 3.4 Smaller open questions

- **The bottom nav is `position: static`**, so it scrolls with content rather than staying pinned.
  No doc requires it to be fixed, so this is an open question, not a defect — but on a 15-run week
  the driver scrolls to the bottom to change screens.
- **A189 — does the Meal Connect form accept a decimal in Pounds?** Every value on the sample
  receipt is an integer, but so was every value typed into it, so the receipt is no evidence.
  The worksheet emits `numeric(8,2)` unchanged. **If it does reject decimals, rounding is not a
  one-line change**: rounding each row makes Σ rows disagree with the receipt total *and* with the
  week's own figure, leaving the Reporter holding two numbers that do not match while Meal Connect
  shows a third. Whoever confirms this must decide where the remainder goes before it is
  implemented. *Cited by `services/report.ts:788`, `shared/src/report.ts:251`.*
- **A191 — R3 exports nothing for a stop that produced no food.** Meal Connect's form carries
  `Scheduled Pickup Not Attempted` and `No Pounds`, which suggests NTFB expects a receipt for a
  fruitless pickup rather than silence. R3 knows both states (`SKIPPED`; a `COLLECTED` stop with no
  weights) and emits neither, because the report is `weight_entry ∪ unscheduled_donation` and such a
  stop is in neither half. **Deliberately not built** — emitting them would widen
  `domain-modeling.md §6`'s union, and that doc is **locked**, so it is a doc change first and a code
  change second. It also turns on a fact nobody here has: whether NTFB wants those receipts from
  *us*, or whether the checkboxes exist for food banks whose own drivers do the pickups.
- **A183 / D11** — confirm the mapping belongs on S3.1 rather than S1.8.
- **A72** — a browser presenting a valid `r3_device` marker registers device-scoped, never
  user-scoped. A privacy-shaped default worth ratifying: the alternative leaks one person's alerts
  onto a shared machine.
- **A35 — `TRUST_PROXY` needs its deploy value.** On the box it must name the `cloudflared` network,
  or `architecture.md §4.2`'s per-IP counter collapses to a single address.

---

## 4. Stored shapes — cheap to change now, a data migration after launch

**This is the section to read before going to production.** Each of these is a value or shape
already written into the schema. Changing any of them once real rows exist is a data migration
rather than a refactor, and that is cheap **only** while the system is pre-launch and empty.

| # | Assumption |
| :---- | :---- |
| **A5** | **The notification event taxonomy is the build's invention.** `notification.event` is `text` whose "taxonomy [is] owned by the notifications doc" — a doc that does not exist. The PRD matrix fixes the six events, their recipients and triggers; the identifiers `SHIFT_ASSIGNED`, `SHIFT_REMINDER`, `UNAVAILABILITY_DECLARED`, `SHIFT_OPENED`, `SHIFT_AT_RISK`, `TRUCK_INBOUND` are ours. Every row carries one. |
| **A7** | **Push payload shape is `{ route?, when?, who? }`, with `when` pre-formatted by the enqueuing service.** Nothing specifies `notification.payload`. Wall-clock rendering needs `app_config.timezone`, which the enqueuing service has and dispatch does not, so formatting moved to the writer. |
| **A36** | **`route_stop.position` is 0-based.** `data-model.md §5.1` says "contiguous" and never fixes the base. Matches `test/fixtures.ts`'s `makeRoute()`. If any later query assumes 1-based the two disagree *silently*. |
| **A58** | **A `DATES` availability declaration is stored as ONE contiguous block** — local midnight on `fromDate` to local midnight the day after `toDate` — not one row per day. `WINDOW` is one row per date. No doc says which. |
| **A3** | **Session-lifetime keys on `app_config` are named** `session_idle_shared_minutes`, `session_absolute_shared_hours`, `session_idle_personal_volunteer_days`, `session_idle_personal_staff_days`. `architecture.md §4.2` fixes the four *values* (30 min / 12 h / 30 d / 7 d) and says they live in `app_config`, but names no keys. *Cited by `migrations/0001`, `services/session.ts:58`.* |
| **A165** | **Weight crosses the wire as a decimal string, never a number.** `numeric(8,2)` is exact; a JS `number` is not, and routing a scale reading through a float risks a rounding error in the column that feeds the NTFB report. Subtotals sum by scaling to integer cents. **The alternative would pass every test anyone is likely to write** and be wrong only for values that are not binary-representable. *Cited by `weight-entry.ts:16`.* |

---

## 5. Open assumptions that change behaviour

The full ledgers held ~190 entries (`A1`–`A191`); most are non-blocking naming or shape choices
preserved in `archived/`. These are the ones that change what a person sees or can do, or that code
cites by number.

### Report & metrics (Phase 3)

- **A178 — the report week runs Monday to Sunday.** No doc names the boundary. Monday-start is the
  ISO week; the pantry's runs are named by weekday ("Tuesday Morning"), which suggests nothing
  either way. One function (`weekBounds`) if it should be Sunday-start. *Cited by `services/report.ts:86`.*
  **Scope widened in QA round 1:** S1.2's board now defaults to this same week, so that staff
  cross-checking the board against the report see the same seven days. The client half is
  `app/week.ts`, extracted from the report screen for the purpose; it and `weekBounds` must change
  together. Getting this wrong is now visible in two places instead of one, which is the point.
- **A179 — metrics default to the last 28 days.** Four whole weeks, so the previous-period
  comparison is like-for-like rather than a ragged month. Both endpoints accept explicit `from`/`to`.
- **A180 — the export groups; it does not emit one row per entry.** Two receivers adding 60 lb and
  40 lb of produce from one store on one day export as a single 100 lb row, per `data-model.md §8`'s
  grain. The drill-in still resolves that row to both entries with their receivers (Success Metric
  4). Corroborated by D13: Meal Connect's own line items are totals per category on a receipt.
- **A181 — remapping a category re-reports history.** Every week's report is computed on read, so
  pointing a category at a different NTFB bucket changes what an already-exported week *would* say.
  Correct — the mapping states what a category **is** — but a mid-year remap silently changes the
  past. If exported weeks ever need freezing, that is a stored snapshot and a schema change.
  *Cited by `services/report.ts:640`.*
- **A184 — an open run does not block the export; an unmapped category does.** Two things make a
  week incomplete and they differ: unmapped weight means the file would be **wrong**; a run still
  `OPEN`/`CLAIMED`/`IN_PROGRESS` means the file would merely be **early**, and only the Reporter
  knows whether the week is really over.
- **A190 — an AGFP category with no storage still exports.** Unmapped means weight goes unreported;
  missing storage means one of four fields on a line the Reporter is typing anyway is blank, and they
  can see the food in front of them. **Read the other way** — that a receipt cannot be submitted
  without Storage — this should block too. Nobody here has tried to submit one.
- **A185 — S3.1's drill-in hangs off the AGFP line, not the NTFB total**, so an NTFB total made of
  two AGFP categories resolves to two lists. Also: **"Exported" is a local fact and dies on
  navigation** — nothing in the schema records that a week was downloaded.
- **A186 — the metrics CSV is built on the client**, unlike S3.1's export, which is a server route
  precisely so it can refuse to emit a short one. Different file, different reader — but if a
  metrics export was meant to be server-side, it is in the wrong place.
- **A182 — a `CANCELLED` run is not a coverage failure.** I7 excludes it by construction and the
  code follows the invariant exactly. The *consequence* is a judgement someone might disagree with:
  a run cancelled the morning it was due looks identical to a no-show from the pantry's point of
  view. Counting it would punish staff for tidying the board.

### Receive (Phase 2)

- **A162 — S2.1b lists `status = 'IN_PROGRESS'` and nothing else.** S2.1b contradicted itself; the
  wider reading won because the stricter one would drop a run the moment its last stop was weighed,
  making **receive-done unreachable and the run permanently unclosable**. Also not filtered to
  today — receiving legitimately lags past midnight.
- **A164 — `reviseWeight` does not move an entry between categories.** Expressible as void + add;
  the UI offers no control for it.
- **A166 — the receiver worklist's recency window is 7 days.** **Invented** — no doc gives a number.
  It coincides with the default `receiver_edit_window_days`, which is defensible but is not the same
  knob and does not track it.
- **A167 — a receiver at the shared tablet lands on the run picker**, but a receiver on the shared
  desktop still has a nav and lands on the board. Landing them on the board at the tablet would be a
  dead end — that surface has no navigation at all.
- **A169 — voided rows count as referencing history for I21.** A voided row is retained for audit and
  is still a real FK reference; `ON DELETE RESTRICT` would refuse the delete anyway, turning a
  soft-delete decision into a foreign-key error.
- **A170 — the truck alert deep-links to `/receive`, not to the shift**, because it is addressed to a
  **device**: whoever taps it is whoever is standing at the dock.
- **A171 — a push now also reaches the open page**, not just the OS. Two consequences: the page may
  show a banner for an alert the OS is *also* showing, and the message goes to every open window, so
  a handler must be idempotent and must not navigate on its own.
- **A174 — S2.2 has a second correction path the spec does not mention: Remove**, a void with no
  replacement behind its own destructive confirm. A weight logged against the wrong stop has no
  correct replacement value to type, so overwrite alone cannot express the correction.
- **A177 — the truck alert's copy is written twice** (`renderPush` server-side, `truckInboundBody`
  client-side) and nothing pins the two together. They agree today; no test asserts they keep
  agreeing.

### Rescue & shell (Phase 1)

- **A2 — `app_user` carries `first_name` / `last_name`.** Doc-supported, not a guess:
  `ui-ux-spec.md S1.8` is an explicit two-field admin form and `domain-modeling.md §5.1` has
  `generate_username(first, last)`. *Cited by `migrations/0002`.*
- **A13/A15 — screen URLs and auth endpoint shapes.** `/login`, `/board`, `/shifts/:shiftId`,
  `/my-shifts`, `/pickup/:shiftId`, `/schedule`, `/schedule/:shiftId/reschedule`, `/admin`,
  `/inbox`; `GET /api/auth/me` → `{ user, expiresAt }`, `POST /api/auth/logout`. The spec names
  screens, not paths. *Cited by `client/src/api/session.ts:9`.*
- **A14 — the built service worker is emitted at `/sw.js`**, fixed and unhashed, by the Vite config.
  *Cited by `client/src/pwa/serviceWorker.ts:11`.*
- **A16 — breakpoints are phone `<768px`, tablet `768–1023px`, desktop `>=1024px`, width-only.**
  Width-only deliberately: an orientation rule would flip the pantry tablet's entire nav when stood
  upright.
- **A30 — Admin accounts cannot be created directly** (cap 1 says "non-admin accounts"); Admin is
  reached by promotion, and deleting an Admin-tier account is refused. *Cited by
  `test/push-subscription.test.ts:130`.*
- **A34/A78 — code imports `shared/src/<area>.ts` by relative path, never `@r3/shared`.** Inside a
  worktree `node_modules/@r3/shared` resolves to the **main checkout's** file, so a lane silently
  typechecks against a different tree than the one it is writing. Proven on the client with
  `tsc --traceResolution`. **Now structural** — `gate.sh` step 4b fails on any such import. *Cited by
  `client/src/api/shared.ts:8`.*
- **A38 — a deactivated donor may stay on a route it is already on, but may not be added to one.**
  A new stop is "new use"; an existing stop is a reference to preserve. So a route whose store closed
  keeps rendering it, flagged, rather than silently shortening a planned run.
- **A43 — a malformed uuid answers 404 on newer routes and 500 on Wave-1 identity routes.** Still
  inconsistent. Strictly neither is right: a syntactically invalid id is a client error (**400**).
- **A85 — a reassignment's destination must already be `IN_PROGRESS`.** §3.2 says "or about to run",
  but I5 forbids `ShiftStop` rows before `IN_PROGRESS` — a stop appended to a not-yet-started run
  would be destroyed by that run's own snapshot at start. Resolved toward the invariant.
- **A95 — I20's staff-assign exemption is scoped to the two temporal reasons.**
  `AVAILABILITY_BLOCK` and `OWNED_SHIFT_OVERLAP` are confirmable; `NO_DRIVE_DUTY`, `DEACTIVATED` and
  `UNKNOWN_USER` are hard refusals for Staff too.
- **A99 — the actor is excluded from the `SHIFT_OPENED` fan-out.** Consequence worth knowing: at this
  org's headcount (one coordinator) a staff unassign therefore sends **no coordinator row at all**.
- **A100 — claiming has no time bound; release does.** Release is bounded by `starts_at > now()`
  because cap 8 says "before it starts". The asymmetry is deliberate.
- **A106 — the at-risk sweep alerts once per run**, not once per recipient becoming eligible. A
  driver who becomes eligible *after* the first alert is never alerted.
- **A112 — `GET /shifts` is `{ tier: 'VOLUNTEER' }`**, any signed-in user, no duty. Cap 5's "all
  drivers see every shift" suggests a DRIVE duty, but that would lock out a Staff coordinator who
  does not hold it, and tier never confers a duty (I1/I2).
- **A123 — inbox endpoints answer 404, never 403**, for another user's row, an unknown id and a
  malformed uuid alike, so the inbox cannot be probed.
- **A125 — notification arrival time is formatted server-side** in `app_config.timezone` — the
  *opposite* choice to A120's client-side rendering, and deliberately so.
- **A134/A154 — three copies of calendar/time-picking code exist across S1.2, S1.4 and S1.7.** Two
  lanes independently wanting a calendar is the promotion signal that produced
  `components/Segmented.tsx`. **Deliberately not acted on** — the segmented promotion was worth its
  cost because two copies had *diverged in behaviour*; nothing yet says these have. Promote when a
  third consumer appears or a divergence is found, not on count alone.
- **A146 — S1.8's username preview reimplements `§5.1` in client code**, because the screen must show
  the auto username read-only at create time and no preview endpoint exists. Preview only; the
  server's returned username is what the screen reports.
- **A187 — `formatWeight` is duplicated** between S3.2 and S2.2b rather than shared. There are **no
  cross-screen imports anywhere in this repo**; promoting the helper would mean editing
  `components/`, which every screen depends on.

### Rulings the human already made

| # | Ruling |
| :---- | :---- |
| **A24 / H2** | **Staff *see* phone/address; only Admin *edits* them.** The code was already right; `product-requirement.md §2` contradicted itself and was corrected. |
| **A46 / H4** | **I21 governs category deletion** — hard-delete when nothing references it, else soft-delete so no history row dangles. No code change; `ui-ux-spec.md S1.8` and cap 17 corrected. |
| **A54 / H4** | **A deactivated account is ineligible; `domain-modeling.md §5.2` was amended** to carry `driver is active` as its first conjunct — the locked doc edited under explicit authorization. The deciding argument was **I25**: without it, a pattern whose `ownerDefault` was deactivated months ago keeps minting instances born `CLAIMED` to a dead account, so the run never shows as open and the person named on it cannot act. |
| **A79** | **No Receiver notification in Phase 1** — the lead's brief was wrong to ask for it; the lane's scope call was ratified. |
| **A80** | **I27's gate reads `{COLLECTED, SKIPPED, REASSIGNED}`** — locked doc amended under authorization. The literal reading would make I30 freeze the very run it exists to rescue. |
| **A111** | **A pattern has no start date; a series begins when it is created.** S1.6's "starting __" is a **computed read-only display**, not an input. An editable control there would reopen the contradiction, and the nightly sweep would back-fill anything a "start later" create tried to skip. |
| **A117** | **S1.5 reorders stops with Move up / Move down buttons, not a drag handle.** HTML drag-and-drop does not fire on touch, so a handle would work on the staff desktop and silently fail on the phone the screen exists for. `ui-ux-spec.md` amended. |
| **A118** | **Staff may open a Claimed-by-other or In-progress row into S1.3; a driver may not.** The literal reading left the staff half of S1.3 unreachable. |
| **A151** | **S1.6's route builder keeps drag, drops the per-row Move buttons.** Three commands per row read as verbose beside a handle that covers the common case. The keyboard equivalent survives on the handle, which became a focusable button reordering on ArrowUp/ArrowDown. **Touch on a tablet loses reorder** — accepted, and `ui-ux-spec.md` now records the hole explicitly. *Cited by `ui-ux-spec.md:203`.* |
| **D5 (UI pass)** | **A driver's own `IN_PROGRESS` run opens S1.3 from the board.** Left as built, a driver who navigated away mid-run found a dead row on the screen they look at first. |

---

## 6. Bugs the build found, and the lessons worth keeping

**Defects a green gate did not catch** — each is a class of failure, not just an incident:

- **Cap 17's seed half was never built, and the state doc said it was** (A156). The eleven category
  names existed in exactly one place: a test that *creates them itself* and then asserts the table
  holds eleven — an assertion that passes against an empty database. **Four green gates never saw
  it.** A fresh box came up with an empty Categories tab and would have come up with an empty
  Phase-2 weight keypad. Fixed by migration `0010`, guarded on the table being empty, because a
  migration is the only path that reaches production, a rehearsal *and* dev identically.
- **`IdlePrompt` fired instantly for every volunteer** (found by the first `dev.sh` run).
  `expiresAt - now - 30s` went straight to `setTimeout`, which stores its delay in a 32-bit signed
  integer and **silently fires immediately** above ~24.8 days. A Volunteer on a personal phone gets a
  **30-day** window, so "Still here?" appeared milliseconds after every sign-in. Staff (7 days) and
  shared devices stay under the ceiling, **which is why four waves of green gates never saw it** — it
  broke for exactly the driver-on-a-phone persona the rescue loop is canonical for, and nobody else.
- **Two tests failed only between 09:00 and 13:00 pantry-local**, and Wave 3 was promoted on one of
  them — the gate ran at 07:47, outside the window, so the wave's green was luck of the clock. The
  service was correct; the tests assumed an edit cannot change the instance *set*. **Standing lesson:
  a green gate is evidence only if the suite is time-independent.** Any test whose fixture straddles
  wall-clock `now` can do this again.
- **Unmapped-but-reportable weight counted as *unreported*** (found by exercising the API, not by a
  gate). A scheduled weight is reportable by construction (I15); having no mapping is a gap in a
  lookup table, not a decision that the food goes unreported.
- **The Reporter's report toggle was window-gated** (caught by `doc-qa`). S3.1's toggle reused the
  receiver's `setReportable`, so once the window lapsed the flag was uneditable by *anyone* — the
  reverse of cap 15. It shipped because the weight path had a post-window test and the toggle did not.
- **`a <= b = true`.** Two raw predicates used Kysely's three-argument `where`, which appends `= $1`
  to a fragment that is already a comparison. Caught by a sweep test, not by the typechecker.
- **The board rendered the *device's* day, not the pantry's** (A138/A140) — a defect in an
  already-promoted screen, found because a later lane computed the pantry day and said so.

**Process lessons that earned their keep:**

- **Resume a stopped agent; do not restart it.** Every resumed lane found real defects in the code it
  inherited — four in Wave 3's schedule lane, four in S1.3, six in S1.6, one in S1.7. A restart
  throws that away and pays for the reading twice. A resumed lane must be told the inherited code is
  untested and that reviewing it is part of the job.
- **Keep `doc-qa` on the lead's own work, not only on lanes.** Two of Wave 4b's three findings were
  the lead's, in a commit it had itself asked `doc-qa` to check.
- **A rule restated in four places is four things to keep in sync, and it does not stay in sync.**
  Amending `§5.2` left two docs restating the pre-amendment predicate, one of which
  `eligibleDriverIds()` cites as its spec. Both now **cite** rather than paraphrase.
- **Two lanes wanting the same component is the promotion signal; one is not.** And promoting means
  writing the missing `§3` contract, not just moving a file.
- **A lane report's `Assumed:` field is the load-bearing one.** Two Phase-2 lanes died before writing
  theirs; the gap was closed by a targeted `doc-qa` pass, but A173–A176 are assumptions *recovered by
  inspection* rather than declared by their author — a weaker guarantee.

---

## 7. Where the detail went

The six per-phase docs and all 24 lane reports are preserved verbatim, untracked, under `archived/`:

```
archived/phase-docs/     phase-{1,2,3}-build-plan.md, phase-{1,2,3}-state.md
archived/reports/        24 lane reports (wave-0 … phase3-s3-2)
```

`archived/` is gitignored, so those files live on this machine only and are **not** in a fresh
clone — they are also recoverable from git history before this commit. Everything a reader needs is
in this doc; the originals hold the full `A1`–`A191` ledger, the wave-by-wave merge record, the halt
transcripts (H1–H4), and each screen's complete `Assumed:` list.

Also in `archived/`, from before the build: `LEARNING-LOG.md`, `INCONSISTENCIES.md`, and
`Domain Modeling - Appendix (resolved decisions).md`.

### Reading a citation left in the code

Source comments were **not** rewritten — they cite the doc that was current when they were written.
`D#` and `A#` keep their meaning and are defined above. Section references resolve like this:

| Citation in code | Means | Now |
| :---- | :---- | :---- |
| `phase-N-build-plan.md D1`–`D15` | a standing decision | §2 |
| `phase-N-state.md A1`–`A191` | an assumption the build made | §4, §5 — or `archived/` for the long tail |
| `phase-1-build-plan.md §2` | Phase-1 build order; "Coverage is the risk, do not fan it out" | §1, and `archived/` |
| `phase-{1,2,3}-build-plan.md §3` | single-owner files; **no dependency may be added** | D5 |
| `phase-1-build-plan.md §5.1` | the lane report contract (`Assumed:` is the load-bearing field) | §6, and `archived/` |
| `phase-1-build-plan.md §5.2` | the two-part gate: `gate.sh` **and** `doc-qa`, both mandatory | §1, and `scripts/gate.sh`'s own header |
| `phase-1-build-plan.md §5.5` | when to HALT rather than continue | `archived/` |
| `phase-3-build-plan.md §1.3` | summing in JavaScript is one of the three union mistakes | §1 |
