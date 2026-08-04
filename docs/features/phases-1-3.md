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

## 2. Standing decisions (D1–D78)

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

### QA round 2 and 3 (2026-08-02)

Round 2 was an automated sweep; round 3 was hands-on on a volunteer holding **two** duties, plus
the pantry finally handing over NTFB's real category list and the arithmetic behind their paper
log. `D22`–`D25` come from the first QA pass, `D26`–`D29` from the pantry, and `D30`–`D41` from the
second QA pass over that build.

**D22 — navigation is a Home hub plus a nav grouped by capability, on every surface.**
`ui-ux-spec.md §4` said the tablet has no nav, on the premise that each shared device hosts one
duty workflow. The premise was false: `luispark` holds `DRIVE` and `RECEIVE`, and a desktop window
narrowed to iPad width lands in the same band. The 768–1023px band therefore had **no navigation
at all**, and `Receive` had no nav entry on *any* surface — a receiver could not find how to start
weighing. Now: `/` is a **Home** hub showing one card per capability; the desktop nav is grouped
`PICKING UP` / `RECEIVING` / `OFFICE`; phone and tablet share one bar capped at four items (§3),
with office work reached through Home. **Still no duty picker** — nothing is chosen, everything is
shown. Board stops being the front door and stops being a top-level tab, but stays available to the
Staff tier as well as to drivers. Resolves the spec's own open assumption 2.

**D23 — "Complete this run" completes the driving, not the shift.**
The driver's finish action is renamed, moves into a confirm modal, locks the run note, leaves a
read-only summary and navigates Home. `pickup_completed_at` still completes nothing: `I11` (locked)
keeps receive-done as the only completion and `I12` holds `COMPLETED` behind every stop being
weighed, which a driver cannot do. The wording overclaims slightly and was chosen anyway, by the
human, with that stated. The summary's cost — no "Flag a stop not on my route" afterwards — is said
out loud on the screen rather than left to be discovered.

**D24 — a suggested donation may have no category until it is confirmed.** *Supersedes `D8`.*
Amends the **locked** `domain-modeling.md §2.3` and `I16` under explicit human authorization,
2026-08-02. A driver flagging an ad-hoc pickup from the roadside cannot know the category and it is
not their job; the receiver picks it when they weigh it. `category_id` is nullable while
`SUGGESTED` and required on `CONFIRMED` (`ck_ud_confirmed_category`, migration 0015). This
**repairs** rather than creates a doc conflict: `D8` only ever existed because the locked doc said
`required`, and it had to overrule `ui-ux-spec.md §S1.5`'s "just a donor picker … no weight entry".
That sentence is true again. The anonymous "no name for it" option went with it — the choices are a
store from the list or **Other** with a required typed name.

**D25 — the Meal Connect agency line is gone from the screen and the printed sheet.**
The person entering the submission already knows the agency code. Consequence worth knowing before
someone reads the API shape and assumes otherwise: **`WeeklyReport.mealConnect` now has no reader
anywhere in the client.** The server still composes it from `app_config`; the field was left on the
contract deliberately, because the codes are real configuration and a future sheet may want them
back, but nothing renders it today.

**D26 — the NTFB list, all 11 mappings and every storage value ship seeded.** **Retires `D12`.**
The pantry supplied their real list. `Frz Non Meat`, the single row that matched none of the ten
names on the sample receipt and therefore kept the whole table unseedable, maps to **Prepared
Meal** alongside Deli. See §3.1 for the table. Seeding is idempotent and never overwrites an
admin's later edit. The AGFP `Trash` category ships **archived**, because `D27` computes it.

**D27 — Trash is computed from the other categories, never entered.**
Per receipt, a share of bakery, produce and deli weight is deducted and reported as Trash. Rates are
per store, admin-editable, falling back to pantry defaults of 10 / 5 / 15 percent; Sam's Club and
Costco run produce at 10. The algorithm, its load-bearing rounding order and the conservation
property live in `domain-modeling.md §5.4`. **The deduction never changes the reported total** — it
moves weight between categories, and Trash is itself reported. Metrics (S3.2) stay **gross**: the
deduction is a food-bank convention, not a claim about how much food the pantry moved.

**D28 — every pound on the receipt is a whole number, and the receipt total is the sum of the
rounded rows.** **Answers `A189`**, which said explicitly that whoever confirmed this had to decide
where the remainder goes before it could be implemented. The rows win: everything on the sheet adds
up exactly as printed, at the cost of a receipt sitting a pound or two from the true intake.

**The visible consequence, which must not be mistaken for a bug: S3.1 and S3.2 now report the same
week differently.** S3.1 rounds all three of its totals, because it is the screen a reporter checks
the receipt against and those two have to agree. S3.2 does not round, because it answers a
different question — how much food the pantry actually moved. For the QA world's closed week that
is **446 on S3.1 against 445.75 on S3.2**, and the quarter-pound is the entire difference.
Rounding only *one* of S3.1's three totals is not available: `unreported = intake − reported` goes
negative the moment rounding pushes reported above intake. The gap is therefore named on S3.1
itself rather than left for a reporter to find, which is exactly the case `D21` keeps copy for —
two similar numbers sitting together, differing for a reason nobody can deduce from the numbers.

**D29 — the export is a printed receipt, not a file.** *Supersedes `D13`'s column list; `D13`'s
finding that Meal Connect has no import still stands.*
Screenshots of the portal settled the shape: it is a receipt form, not a table. The export is now a
printable page of cards, one per `(pickup date, donor)`, mirroring that form — the two checkboxes
included. **The CSV download is removed**; one export path cannot disagree with itself. Two things
the old worksheet could not do: it carries **every note** from coordinator, driver and receiver, so
the reporter can judge what belongs on the submission; and it emits receipts for pickups that
produced **nothing** (`Scheduled Pickup Not Attempted`, `No Pounds`), which previously produced no
row at all and were invisible to the food bank.

### `D30`–`D41` — the second hands-on QA pass (2026-08-02)

A pass over the `D22`–`D29` build, across four accounts. The through-line: the app was still
offering too many doors and explaining itself too much, and the receiver's screens were sized for
a desk rather than a dock.

**D30 — one nav entry per capability, on every surface.** *Refines `D22`.*
`D22` grouped the nav by capability but left two or three entries inside some groups, and the
four-item bar could only show the first of each — which reads as truncation, not design. The fix
went the other way: the desktop list collapses to one entry per capability, and the group headings
go with it, because a heading over one item is noise. **`My shifts` became a tab on the board**
(`?tab=mine`) — a driver's own runs and their days off are the same capability as the board they
claim from. **`Log a donation` left the nav entirely**; the `Unscheduled donation` button on S2.1b
is on screen in every state including the empty one, so nothing was stranded. Order is now the
order a week runs — pick up, receive, report — which is also the Home card order, so the two
surfaces cannot teach a volunteer different words for the same place.

**D31 — Home is capped at six cards.** Pick up food, Receive a load, Report, Schedule, Admin,
Inbox: every capability one account can hold. `My shifts` stopped being a card under `D30`. The cap
holds by construction across the whole tier×duty space, and a test walks all of it.

**D32 — the heart becomes a house, and the AGFP mark moves to the side nav.**
The mark is dark type on a white ground and §3 pins the top bar to `--structural-dark`, so in the
bar it needs a white plate that reads as a sticker. It sits at the top of the side nav instead, on
the ground it was drawn for, and tapping it goes Home. **Consequence, accepted rather than hidden:
the mark does not appear on a phone or tablet**, which have no side nav. An unreadable mark is
worth less than none, and a light-on-dark variant of the pantry's own branding is theirs to supply.

**D33 — the assignment notification names who assigned it.** "You're on a run" became
"*Sam Okafor* put you on a run". `services/coverage.ts` was enqueuing `route` and `when` but no
`who`, so the name was not merely unused — it never arrived. Omitted on self-assignment: a
coordinator who assigns themselves a run should not be told their own name put them on it.

**D34 — S3.1 leads with the report; the header shrinks to two figures.**
The reporter's job is the Meal Connect submission, not the week's totals. One primary button at the
top, figures below it, compact. Three figures became two — **Everything received** and **Reported to
North Texas Food Bank** — since the third is their difference. *This overrode part of `D21`*, which
had explicitly kept the per-figure captions as the only place the intake-vs-reported distinction was
stated in words; the labels now carry that distinction in full, and a test forbids either from
shortening to "Total". `D28`'s rounding note moved into the report view, beside the figures a
reporter actually types.

**D35 — the report tracks what has been filed.** *Adds an entity to the locked
`domain-modeling.md`, under explicit human authorization, 2026-08-02.*
Meal Connect takes one submission at a time and has no import (`D13`), so a reporter working
through a fortnight of receipts needs to know which are already in — and a *second* reporter needs
the same answer. New table `meal_connect_submission`, keyed `(pickup_date, donor_id)`: the same
grain as the receipt (`D29`), so the key **is** the claim and two people cannot both be right. The
tick confirms before writing and is idempotent — the first filer stands, because refusing a second
reporter who agrees would be telling them off. Un-ticking is a delete and asks nothing: it takes a
claim back rather than making one. **It records a filing and changes no total**; dropping every row
would leave every figure identical. **A walk-in with only a free-text label cannot be filed** — it
has no donor to key on, and Meal Connect's own donor picker could not be pointed at it either.

**D36 — the desktop breakpoint rises 1024 → 1200.** Landscape iPads sit at 1024–1194, so every one
of them was getting the desktop side nav — a squeezed sidebar on a receiving dock. At 1200 they
land in the tablet band and get the bottom bar and the full width. The number is repeated in a few
media queries because CSS cannot read a custom property there; they move together.

**D37 — the confirm step is reversible, and a finished run stops offering to finish.**
S2.2b used to show `Receive done` whether or not the run was already closed, so a volunteer could
tap it twice. Three states now: **blocked** (a stop outstanding), **confirm** (`Receive done`, with
`Change a weight` beside it), **closed** (a read-only summary and a way back — §3's dead-end rule).
Submitting goes to Home. `Mark stop weighed` → **`Done`**, `Skip stop` → **`Skip`**, both keeping an
accessible name that still states the object. **`I11` and `I12` were not touched**: what changed is
what the screen offers, not what the service allows. The confirm's copy was also **wrong** — it
promised "you can still fix a weight afterwards", which `requireReceivable()` denies once the shift
is `COMPLETED`; it now names the Reporter (`D14`), who is who the receiver must actually go and find.

**D38 — the run picker leads with today.** Three bands: **Still to weigh** (large cards, the
screen's centre), **Ready to finish** (rows), **Later this week** (collapsed, closed by default).
Band 1's cut is `occurrence_date <= today`, not `= today` — a run left unweighed from last Tuesday
is not "later this week", and burying it is how it stays unclosed. Band 2 is deliberately *not*
"Finished": those runs are all-stops-resolved but still `IN_PROGRESS`, and calling them finished
would claim `I11` had happened.

**D39 — Admin metrics default to this week, with an explicit From / To.** *Answers `A179`.*
The 1/4/12-week presets are gone; any of them is two dates away. `Earlier`/`Later` still step by the
chosen range's own length, so the previous-period comparison stays like-for-like. The default is the
Monday–Sunday week `D41` gives S3.1 — the first time the two screens have named the same period.
`A179` had picked 28 days precisely because no doc settled it.

**D40 — Categories and Category matching merge into one Admin tab.** *Retires the tab `D17`
created; the mapping and its rules are unchanged.*
Where a category reports to is now edited **where the category is configured** — the pantry's
categories above, NTFB's reference list below. Same instinct as `D30`: one thing, one place.
`?tab=mapping` still resolves, as a redirect, the courtesy `D18` gave `/metrics`.

**D41 — S3.1 takes a From / To range, defaulting to this week.** `computeWeek()` became
`computeRange(from, to)` — it was already the single source the totals and the receipts both read,
so this widened one function's window rather than touching two paths. A receipt is keyed
`(pickup date, donor)`, so a longer range simply yields more cards, and **the conservation property
holds over any window** because both `D28`'s rounding and `D27`'s deduction key on the receipt, not
on the range. A backwards range is refused, not silently swapped. `?week=` still resolves.

### Round 4 (`D42`–`D58`, 2026-08-03)

*A hands-on pass over the `D30`–`D41` build. Three of the items were reported as bugs and were not:
see §6. The theme is that two screens were shaped for the wrong body — the receiver's for a desk
rather than a dock, the reporter's for an analyst rather than a data-entry volunteer.*

**D42 — the shell's chrome is sticky.** `.r3-app` was `min-height: 100%` with the document
scrolling and nothing pinned, so on any screen taller than the viewport the nav bar sat at the
bottom of the **content**: reaching navigation meant scrolling to the true page bottom. That is why
several screens had grown their own bottom "Back to…" button — they were routing around the shell.
Sticky, deliberately, rather than a fixed-height shell with an inner scroller: a fixed shell would
break every screen-local `position: sticky` and scroll region at once. The chrome sits **below** the
existing overlay ladder so a picker opened near a bar is never clipped.

**D43 — one way out, at the top.** `BackLink` already existed and four screens used it; **eight
hand-rolled a bottom button instead**, each with its own words. They converge. The label is a noun
naming the destination — the chevron already says "back". Two things deliberately do **not**
converge: a form's *cancel* belongs beside its submit, and a screen that is itself a nav entry has
no parent to go back to. `D42` is what makes this safe; before it, the bottom button was the only
reachable exit.

**D44 — S2.2 becomes two panes and the page stops scrolling.** The category tiles sat in a
six-across grid **above** the keypad, so the sheet was always taller than the tablet it is for. The
pantry's own framing was the useful one: the paper log showed every category at once and this did
not. Categories become a single vertical column; everything else — stop strip, keypad, Add weight,
total, Done/Skip — shares the other column. **The keypad floor did not move**: §3 fixes it at 64px,
a previous round tried to shrink it and was correctly overruled, and the space came from the layout
instead. **Honest limit:** on the canonical 1024×768 tablet an empty sheet fits and the category
column starts scrolling once a couple of categories carry entries. The page and the nav still do
not move, which was the actual ask.

**D45 — a busy category stops resizing the screen.** `.r3-tile__entries` had no `max-height` and no
`overflow`, and the tiles were a **stretch** grid — so one category with many entries grew every
sibling tile in its row and lengthened the whole page. Capped at two rows with an internal scroll,
and a count on the row when there is more than fits, because a scroll region with no visible
affordance is a trap.

**D46 — the closed run names who signed off.** *No migration.* There is no `completed_by` on
`shift`, only `updated_by` (`I26`) — but `I10` makes `COMPLETED` terminal, so the last writer of a
completed shift **is** whoever confirmed receive-done. Populated only when the shift is `COMPLETED`;
null on an open run rather than naming the last person to touch a weight, which would be confidently
wrong. **The inference is load-bearing**: if `COMPLETED` ever stops being terminal this silently
starts lying, so it is commented at the code rather than left to be rediscovered.

**D47 — "Change a weight" is hidden once the edit window has lapsed.** The client could see only
half the rule: a closed run leaves `GET /receive/runs`, but `receiver_edit_window_days` was exposed
nowhere, so the button could appear on an open run whose day window had passed and lead to a sheet
where the server refused. The payload now carries `editWindowOpen` from **the same predicate the
service already gated on** — surfaced, not re-implemented. The refusal is unchanged and is still the
guard; what went away is the wasted tap.

**D48 — a returning run says so.** There is no `RETURNING` status and there must not be: heading
back is `pickup_completed_at`, a milestone **inside** `IN_PROGRESS` (`I27`), and the service's
UPDATE deliberately does not touch `status`. So this is presentation only, and it reuses the
in-progress colour — a second colour would claim a state change the domain refuses to make. The
server half turned out to be **already built**: `pickupCompletedAt` was already on `ShiftSummary`
and already selected.

**D49 — DRIVE gets two nav entries.** *Softens `D30` for one duty; every other capability still
gets exactly one.* `D30` folded My shifts into the board, which put **its** two tabs inside the
board's two tabs — and the nested rows are what QA reported as confusing. Two sibling pages with one
tab level between them: **Pick up food** (`/my-shifts`, the driver's own runs, today then this week,
their default landing) and **Shift board** (`/board`, the shared board, with *When I'm away* as its
second tab). The board's heading moved off "Pickup runs" for the same reason — two pages under one
title is the confusion `D49` set out to remove. `?tab=mine` still resolves.

**D50 — Home's cap rises six to seven.** `D31`'s six was every capability a single account could
hold; `D49` adds a destination, so the cap moves with it rather than silently dropping a card.

**D51 — nav and Home order by descending privilege.** *Supersedes `D30`'s week-order.*
`Home · Admin · Schedule · Report · Receive a load · Pick up food · Shift board · Inbox`. The
property that matters more than the order itself: **every shorter list is this list with rows
removed, never reshuffled**, so a volunteer who gains a duty sees a row appear in place rather than
the bar rearranging under them. The four-item bar cap (§3) does **not** move — office work is
reached through Home on phone and tablet, which is the design and not a truncation.

**D52 — a refused claim is visible.** Reported as "the Claim button doesn't work". It worked:
`eligible()` refuses an **overlapping** claim with a 409 whose message the server already
composes, the row stayed `OPEN` with a null owner, and nothing was half-written — but the only
feedback was a toast that scrolled past. The reason now sits under the row that caused it until the
viewer changes filter or week, claims successfully, or retries. A **repeating** run's first tap
opens the scope prompt and sends nothing, which is correct and also read as a dead button, so the
prompt now names the run it is asking about.

**D53 — the "Open" chip goes where a Claim button is.** The chip said "Open", the owner line said
"OPEN", and the button said "Claim": three statements of one fact in one row. Every other row keeps
its chip.

**D54 — S3.1 opens on the receipts; the totals view and the drill-in are retired.** The reporter is
a data-entry volunteer whose whole job is typing one store at a time into somebody else's web form.
A totals-first screen read to them as "analysis, not my job" — so they never opened the drill-in
behind it, which is where `PRD` cap 15 put **the only remaining way to correct a weight once the
receiver's window closes**, and they reported that as a missing feature. It was not missing; it was
unreachable from where they stood. The fix was not to build anything: the ✎ and the reportable
switch moved **into the receipt**, unchanged operations. `ReportTable` went with the drill-in,
because a per-category landing with nothing hanging off it is not a screen. **Intake and reported
totals now live only on S3.2.** The drill-in's three-line trash breakdown was not lost either — a
receipt carries its own Trash line, so the arithmetic already explains itself.

**D55 — the receipts are master/detail.** A list beside the open receipt, so the reporter keeps
their place in a fifteen-row list while typing one of them into another window. Stacks below 64rem.
It splits on its own width rather than §3's device bands, because "do two columns of content fit" is
a different question from "which navigation chrome does this device get".

**D56 — two sections, and the second one is where the missing feature actually was.**
*To file into Meal Connect* and *Not filed to the food bank*. The second holds two things that
answer the same question — receipts with no store to file under, and **confirmed donations somebody
switched off**. The second kind is the point: the report union is
`WeightEntry[!voided] ∪ UnscheduledDonation[CONFIRMED ∧ reportable]`, so an unflagged donation has
**no receipt at all**, which is precisely why the reporter could find no way to put one back. The
export now returns them **beside** the receipts, never among them — merging them would break the
conservation property and `I15`/`I16`. `I16(b)` decides whether a row can be flipped, answered on
the read so it can say why rather than offering a control that 400s; `setReportable` is unchanged
and stays the only enforcement. The progress bar counts fileable receipts only, so walk-ins that
never needed reporting stop counting against the reporter.

**D57 — the portal's checkboxes render on screen only when ticked, and on the print always.**
The divergence is deliberate: the printout mimics the portal's form, and a reporter comparing the
two needs to see the box they are deliberately leaving unticked. The screen has no form to mirror,
so an unticked box there is only noise.

**D58 — Admin metrics: two headline figures and a three-column table.** Out: the `Not reported`
column, the `Change` column and its trend vocabulary, the by-store bar chart, and the lede. The
pantry's reading was that the screen was doing analysis nobody asked for. **Unreported volume
survives as the difference between the two figures**, on `D34`'s precedent that a derivable third
number is not a third number, and the aggregate stays on the payload so `PRD` cap 16's named figure
has somewhere to live. The **previous-period** comparison was dropped outright — it cost a second
query over the whole union to render one word.

### Two defects `D54`–`D56` uncovered

Both were in the export, both pre-dated this round, and neither was what anyone was looking for.

- **A `(pickup date, donor)` whose only intake was a switched-off donation produced a fileable
  receipt ticked `No Pounds`** — telling North Texas Food Bank that a store came to nothing on a day
  it had never been on the route. The receipt object was built *before* the reportable check, so
  `hasIntake` was true for intake that was, by definition, not reportable. `D56` would also have
  shown the reporter the same donation in both sections. Fixed by making the receipt require
  **reportable** intake.
- **✎ was offered on every entry, including walk-in donations** — but the correction service looks a
  `weight_entry` up by id, so that path could only ever answer "No such entry." Now gated to weight
  lines; a donation corrects through the switch beside it. Communication-only, no service change.

**Retiring a surface is a good way to find out what it was hiding.** Neither defect was reachable
from the old screen in a way anyone would have noticed, and the test that proves the first one — a
generic comparison of every editable entry against every emitted receipt, rather than a hand-written
expectation — is the one that should have existed all along.

### Round 5 (`D59`–`D75`, 2026-08-03)

The third hands-on pass, over the `D42`–`D58` build. Three themes and a batch of copy. The themes
are worth naming because each one is a rule, not a fix, and each will be reached for again.

**D59 — a screen addresses one person.** *Amends `D22`'s handling of a volunteer holding two
duties.* The tester holds the STAFF tier and the DRIVE duty, so on a run they own, S1.3 showed them
a card naming them as the driver and offered them a note addressed to themselves. Every gate was
correct: the Driver/Truck card is ungated because everyone may see who is driving, and
`canEditStaffNote` is `viewer.isStaff` because staff write that note. **Correct per capability and
wrong per person** — which is the failure mode `D22` opened when it stopped treating duties as
separate accounts. The rule: where the viewer *is* the subject, the screen drops the cards that
describe them to themselves. A staff note written by someone else still shows, read-only, because
that is a message *to* them. Truck stays either way: it is operational, and its blank is `I8`.

**D60 — S2.2 goes `fullScreen`.** An old volunteer weighing on a docked tablet fat-fingers the
bottom nav and loses the sheet. `D42` made that bar sticky and so made it permanently in reach of a
stray thumb, which is the right call everywhere except the one screen where the whole job is
tapping numbers near the bottom edge. `BackLink` is the way out. The bar's height comes back to the
panes, which is what buys `D61` its fit.

**D61 — the entry column is fixed; the category column is the only scroll region.** `D44` put the
categories and the keypad side by side and stopped the *page* scrolling, but left the work pane a
flex column of four blocks with the keypad last — so at 1024×768 the controls were below the fold
and the receiver scrolled to reach the number pad. That is the same defect `D44` was written to fix,
one level down. The keypad moves right, the actions left, and `--key-min` does **not** move: if it
will not fit, the category column scrolls further. The 64px floor is the reason this app is usable
by the people who use it and is not a spacing value.

**D62 — the stop strip becomes the progress row and carries Submit.** It was a wrapping flex row, so
a four-stop run pushed the keypad down a line and a six-stop run pushed it down two — stop count
silently changed the layout. Now one row, horizontally scrolling, constant height. Submit is present
from the start rather than appearing when the last stop resolves; a control that appears late is a
control nobody is looking for. Pressing it early names what is outstanding and does not navigate.
`I11`/`I12` are untouched: this changes what the screen offers, never what the service allows. The
`All stops done. Receive done is available.` banner is retired with the space it took.

**D63 — the board browses; Schedule manages.** `D59` one screen over. The board's per-row Edit was
already staff-gated, so no driver ever saw it, but it was the one place the board spoke to you as
staff rather than as someone looking for a run — and it deep-linked to Schedule anyway.

**D64 — "Pick up food" becomes "Today's pickup."** `D49` split the driver's two pages and named this
one for the job; the label did not say the thing that distinguishes it from its sibling, which is
*today*. `D30`'s one-entry-per-capability rule is untouched.

**D65 — the driver's completion review includes the extras they added.** Ad-hoc pickups live in
their own client-side array because an `UnscheduledDonation` is not a `ShiftStop` (`I14`, `I29`),
and that separation is right. But `CompleteRunModal` never saw the array, so a driver who added two
stores confirmed a modal showing neither. Two lists in one modal, headed separately. The structural
separation stands; only the review got the second half of what the driver did.

**D66 — the run picker is bound to the receiver edit window.** `A162` deliberately left the picker
unbounded, and its reason still holds: **`receiveDone` is not window-gated**, and the picker is its
only route, so a hidden run is an `IN_PROGRESS` run nobody can ever close. A lapsed run therefore
does not disappear — it moves to a collapsed **"Too late to weigh"** band whose only action is
finishing it. What changed is that a dead run is no longer offered as something to weigh. A `today`
bound was rejected outright: receiving legitimately lags past midnight, which is the case `A162`
exists for.

**"All stops done, Receive done" was a copy bug, not a state bug.** Reported as "why can I still
press Receive done when it says it's done?" The card stated a completed fact where it should have
named an action. It reads **"Finish this run"** now; nothing behind it changed.

**D67 — unscheduled donations get a summary card.** A weighed walk-in was summarised nowhere in the
app except inside S2.3 itself, reached by one bare button. Now a card matching the run cards, with
today's count and pounds and any driver-flagged rows still waiting for weights.

**D68 — notes on S2.2 are shown, not toggled, one line each, and they name their author.** A
disclosure holding a note the driver wrote *for this receiver, about this run* is a note most
receivers will never open. Showing all three was the first half; the second was that a label stacked
over a body cost two lines apiece on the screen with the least room, to say something the note's
position already said. **"Karen Diaz's note:" says the part the receiver cannot see** — two of the
three come from the driver and one from an admin, and which is which is what decides how much the
note is worth acting on. `ReceiveStopDetail` gained `driverName` for it: a name, not PII, and one
the receiver has already read on the run they picked.

They also **moved into the entry column**, filling the space Add weight and Done left empty, capped
by the keypad's height and scrolling inside themselves past that. The block is the one thing on S2.2
allowed to claim leftover space, because it is the only thing whose length the pantry does not
control. Making that work needed the pad's **row to be definite**: an `auto` row is as tall as its
tallest item, so the notes first grew the column instead of filling it and put the page back into
scroll — the third time this round that a container which could not shrink or would not stop growing
was the whole bug.

**D69 — S3.1 stops explaining itself.** Four standing paragraphs out. The open-runs **count** stays
— that is a fact a reporter needs before filing; it was the three-sentence tail that was the
lecture. **`D28`'s whole-pounds note survives on the printed receipt**, on `D57`'s precedent: print
is where a reporter compares against the portal, and it is the one thing they cannot work out for
themselves, two similar numbers a screen apart differing for a reason neither screen shows.

**D70 — the receipt being filed looks like it.** `D55` gave the reporter a list beside the open
receipt and then made the open row look like the twenty above it.

**D71 — Schedule's Runs list is this calendar week.** The heading said "Runs coming up" over every
run that will ever exist. **The server was not the problem**: `listShifts` has had a `toDate` and the
route has parsed `?to=` all along, and both were already tested — the client simply never sent one.
No server file changed. The list is the whole Monday–Sunday week rather than `today → Sunday`, on
`A178`'s cut, because a week-bounded list that starts on Thursday makes its own heading false.

**A192 has a sibling: the month-grid helpers existed three times.** S1.4's away picker, S1.6 and
S1.7 each carried a byte-equivalent `monthGrid`/`nextMonth`/`previousMonth`/`formatMonthLabel`.
`D73` folded the first two into `s1-rescue/shared/calendar.ts`; **S1.7 still has its copy** and
collapsing it is a clean follow-up. The shared version takes an optional first-weekday so the
calendar can open on Monday (`A178`) while the date pickers keep their Sunday start — same code,
one parameter, rather than a fork.

**D72 — a label-only walk-in can be pointed at a real store.** `I16(b)` accepts a `donor_label` as a
source, so a walk-in typed as a store name is legitimately reportable and its pounds are in the
total. But the Meal Connect receipt keys on `(date, donor_id)`, so that receipt can never be ticked
— which `domain-modeling.md §2.1` says is deliberate, because NTFB's own donor picker cannot be
pointed at a store that is not theirs either. **What was not deliberate is that the row was stuck
there forever**: nothing re-pointed a label at a donor once the store *was* added to our list, so
those pounds sat outside NTFB permanently. Attaching a donor keeps the typed label as provenance and
re-checks two things it can newly break — `I29`'s on-route guard, and `D27`'s per-donor trash rates,
which move weight between categories and must leave the reported total alone. No schema change: both
columns already existed and were already nullable.

**The typed name could not be kept where the plan said to keep it.** The plan had `donor_id` set and
`donor_label` retained as provenance. `ck_ud_source_exclusive` — a **tier-1 CHECK**, `donor_id IS
NULL OR donor_label IS NULL` — forbids it, and `data-model.md §7` derives the source discriminator
from *which of the two is set*, so a row holding both is a fourth state nothing reads. The build hit
the constraint rather than assuming, which is the right order. **No migration was added.** The label
is cleared and the typed name is appended to the donation's own `note` ("Written down as sunrise
bagels."), which `intakeNotes` already carries onto the receipt — so the reporter filing the card
still sees the name the receiver wrote beside the store it was filed under, and the UI says that is
what happens rather than claiming the label survives. **Preserving the label literally would need a
schema change and an amendment to two docs, one of them locked**; that is a human's call and was
flagged, not taken.

**D73 — a calendar for staff.** Day, week, month or a custom range, week by default. A cell carries
the route name and the driver and nothing else; times and stop counts belong in the editor, and the
editor is the existing one, so the calendar **adds no write path** and inherits every OPEN/CLAIMED
guard unchanged. The month-grid helpers were already written for the away-date picker and were
extracted rather than copied.

**D74 — assigning a driver pre-selects the current one and confirms a swap.** The picker never read
`run.ownerId`, so re-opening it on a claimed run showed nobody selected and listed the current
driver unhighlighted among everyone else. Unassigning already confirmed; replacing — the same
magnitude of change — confirmed nothing. The `I20` conflict warning stays a separate question and
still stacks: "this driver is double-booked" and "did you mean to replace Karen" are not the same
thing and may both need asking.

### The defect round 5 built and its own QA caught

**`D62`'s progress row took the whole page sideways at three stops.** The strip and its list both
carried `min-width: 0` — the property that lets a flex child shrink below its content so an inner
region can scroll instead. The row *containing* them did not, and it is a **grid** item, whose
`min-width` defaults to `auto`. So the chain stopped one level short: the list could never receive
the row's slack, the row grew past the viewport, and the page scrolled horizontally — dragging the
keypad and the category tiles off-screen and clipping "Submit run" to "Submit". `D61`'s fixed entry
column was failing for a reason that lived a level above it.

Two entries wide it was invisible, which is why every test passed: the seed's runs have two stops,
and the third is what tips it. Fixed with `min-width: 0` on the row, then verified by cloning the
strip up to **thirteen** stops in a live browser — row height constant at 56px, zero page overflow
on either axis, the list scrolling 6043px inside a 710px window, Submit still at the right edge.
**The lesson is about the fixture, not the CSS**: a layout rule that only bites past N of something
needs a fixture with more than N of it, and "the seed has two" is not a test.

**Two more the same screenshot caught, both introduced by this round.** A single QA card — a
fortnight-old run, both stops weighed — was saying two false things at once, and each is a instance
of the same mistake: **a state that is set once and then never re-asked.**

- **"Driver is returning to the pantry" had no end.** `pickup_completed_at` is set when the driver
  taps *heading back* and is never cleared, so the card announced a driver on the way back a
  fortnight after they got there. The bound is the **stops**, not a clock: if every stop is
  resolved, the receiver has already weighed what the driver brought, so the sentence is false
  regardless of the date. The board's and S1.4's chip is deliberately **not** fixed the same way —
  `ShiftSummary` carries no weighing state, and widening a payload to chase a symptom that only
  shows on an already-stuck run is the wrong trade. Recorded, not hidden.
- **"Too late to weigh" was banding runs with nothing left to weigh.** `bandFor` asked the window
  before it asked readiness, so a fully-weighed run sat under a heading telling the receiver they
  had missed something — when nothing had been missed, and one tap would close it. Readiness now
  wins: a closed window costs a resolved run nothing, because receive-done is not window-gated.
  **This makes the band exact rather than merely correct** — what remains in it is only the runs the
  window actually took something from, which is to say precisely the stuck ones from §3.4.

Neither was caught by a test, and both are now pinned by one.

**D75 — a run closed today stays on the picker, read-only.** Receive-done made a run vanish the
instant it was confirmed, which is the one moment a receiver most wants another look at what they
just weighed. `listReceivableRuns` now admits `COMPLETED` runs whose `occurrence_date` is the
**pantry's** today, in their own collapsed band, offering nothing — `COMPLETED` is terminal (`I10`),
so there was never an action to offer. Bounded to today because that is the span of one receiver's
shift; anything older is the report's job, and widening it further would turn the working screen
into a history. `A162`'s membership rule is otherwise untouched: everything else on the list is
`IN_PROGRESS`.

## QA round 6 — the receiver's list, and a check-off nobody could see

**D76 — S2.1b owns the donation worklist; S2.3 weighs one donation.** `D67` put a summary *card* on
the picker and left the rows on S2.3, reasoning that rows belong where they are worked. That was
backwards for half of it. When a driver flags a store mid-run (`I17`) the food is already in the
building and the receiver has to weigh it — it is a pickup in every sense except that no route
planned it, and **S2.1b is the receiver's list of pickups**. A suggestion that announced itself only
as "1 waiting for weights", behind a tap, was the one kind of arrival the picker did not list.

So both lists moved to the panel, as **two sections** rather than one — suggested is somebody else's
unfinished business, recorded is finished business, and run together neither is legible. "Start a new
one" moved with them and became **Add walk-in donation**, because starting a donation from nothing is
a different act from weighing one that arrived, and a screen offering both asked the receiver to pick
a mode before it knew what they had in their hands.

What is left on S2.3 is **the sheet**. It is now literally S2.2's: the shell — `.r3-sheet`, its head
and its two panes — was extracted to `components/sheet.css` and both screens import it, so the two
cannot drift into different-looking screens for the same job. S2.3 takes two routes (`/donations/new`
and `/donations/:id/weigh`), goes `fullScreen` for `D60`'s reason, and reads its row **by id** so the
page survives a reload on a docked tablet. Discard came with it: throwing a suggestion away destroys
the only record that a driver saw this food, and that judgement belongs after opening the row rather
than while scanning past it.

**D77 — a donation is listed while the receiver's edit window is open, and both lists use the same
bound.** Suggested is bounded because `confirmDonation` refuses a lapsed row, so listing one offered
work the next tap would refuse — the same reasoning `D66` applied to runs. Unlike runs, **filtering
strands nothing here**: an unconfirmed suggestion is hard-deleted at receive-done or by the daily
sweep (`I17`), and a lapsed confirmed row is the Reporter's from S3.1.

Recorded was the pantry's calendar day first, and **that was a bug found by using it**. A driver's
flag carries its *run's* `received_date`, so weighing a suggestion off a run dated any other day
dropped it straight out of "Recorded today" — the row vanished at the exact moment the receiver
wanted to see it. Both lists are the window now, and the panel says **"weighed"** rather than
"recorded today". A side effect worth having: S2.1b no longer owns a single string that states a fact
about a calendar day, so `D67`'s three exemptions from the never-say-today rule are gone and the copy
test sweeps everything with no exemption at all.

**D78 — a filed receipt reads green.** `D56` deliberately made a filed row *recede* so it would not
compete with `D70`'s open row. Receding turned out to be indistinguishable from absent, and QA
reported the check-off as unclear. Green is added as a **fourth channel**, not a replacement — the
tick, the byline and the de-emphasised weight all stay, so §2's ban on hue-alone signals still holds.
The colour is `--success`, whose token comment already named this exact use. Filed and open can be
true of the same row at once and still read as two facts: one is an orange edge and tint, the other a
green fill inside the row.

### Two things reported this round that were not defects

- **"Skipped should count as a finished stop."** It already did, at both ends —
  `RECEIVE_RESOLVED_STATES` is `WEIGHED | SKIPPED | REASSIGNED` and both the server count and the
  client's `isResolved` read it. The screenshot showing "1 of 2 done" with one pending and one
  skipped was correct. Reported in round 4 as well, verified then, and pinned by a test since.
- **"Remove the Edit button from the board; a driver has no right to edit a shift."** A driver never
  saw it — `canEditRun` requires the STAFF tier. It came out anyway, under `D63`, for a different
  reason than the one reported.

---

## 3. What still needs a human

### 3.1 ~~The NTFB category list, the mapping, and storage per row~~ — **RESOLVED 2026-08-02**

*This was the one thing blocking the pilot. The pantry supplied it. Kept rather than deleted,
because how it was resolved is the point.*

`ntfb_category` shipped empty under `D12` and the mapping was the pantry's to enter. The blocker
was never the nine names we could read off a real receipt — it was the **one** we could not:
`Frz Non Meat` matched none of them, and seeding ten of eleven is the fabricated-value failure
`D12` exists to prevent, one row smaller. Holding the whole table hostage to a single unknown row
looked pedantic for four months and turned out to be right: the answer was not guessable.

**What the pantry gave us**, with the storage requirement per category and the mapping from our
eleven. Now seeded by `D26` / migration 0016:

| AGFP category | NTFB category | Storage |
| :---- | :---- | :---- |
| Frozen Meat | Meat | Frozen |
| Bakery | Bread | Dry |
| Produce | Produce | Refrigerated |
| Deli | Prepared Meal | Frozen |
| Dairy | Dairy | Refrigerated |
| Dry | Dry Food | Dry |
| **Frz Non Meat** | **Prepared Meal** | Frozen |
| Non Food | Non-Food | Dry |
| Pet | Pet Food | Dry |
| Health & Beauty | Health & Beauty | Dry |
| Trash | Trash | Dry |

`Frz Non Meat` reports as **Prepared Meal**, alongside Deli — "deli and non-meat map to prepared
meal". Both also share a storage value, so they roll into one report line on the screen while
staying two line items on the receipt.

Where this differs from the sample receipt, **the pantry's wording wins**: `Refrigerated` not
`Refrigeration`, `Dry Food` not `Assorted Dry Food`, `Prepared Meal` not `Prepared Meals`. This is
what a person types into Meal Connect, so it matches what they say.

**Still needed:** the **NTFB donor codes** for the stores on our routes. `donor.ntfb_donor_code` is
nullable and blank on the receipt until entered; Meal Connect's own picker shows them as
`H-E-B Food Stores (810)`. Until `D27` it had no write path anywhere in the app and could only be
set by hand-written SQL; the Admin store form now takes it.

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

- **A lapsed run with an unresolved stop cannot be closed by anyone. Needs a ruling.** Found while
  building `D66`, and it **predates that decision** — nothing this round widened or narrowed it.
  `receiveDone` requires every stop resolved (`I12`), but `addWeight` and `skipStop` are both gated
  on the receiver edit window. So once the window lapses on a run with a `PENDING` stop, there is no
  path to `COMPLETED` from any account: the receiver cannot resolve the stop, and nobody else has a
  control that would. The run sits `IN_PROGRESS` forever and keeps appearing in the "Too late to
  weigh" band. It is not silent — the card leads to S2.2b, which names the outstanding stop — but
  naming it is all anyone can do. **The question for a human is who should be able to resolve it**:
  a Staff-tier skip, an Admin override of the window, or an explicit "abandon this run" that is
  neither of the two. All three touch a locked gate, so none should be picked without the ruling.
  At ~15 pickups a week this is rare, and it has never happened, because no run has ever lapsed.
- ~~**The bottom nav is `position: static`**~~ **RESOLVED 2026-08-03 (`D42`).** The chrome is
  sticky, so navigation is never scrolled away — and `D60` then took the bar off S2.2 entirely,
  because on the one screen whose job is tapping near the bottom edge, a permanently-reachable bar
  is something a thumb finds by accident.
- ~~**A189 — does the Meal Connect form accept a decimal in Pounds?**~~ **ANSWERED 2026-08-02
  (`D28`).** The assumption was right that this needed a human: it said "whoever confirms this must
  decide where the remainder goes before it is implemented," and the pantry's own paper log settled
  both halves at once. Every pound on the receipt is now a **whole number, and the receipt total is
  the sum of the rounded rows** — the rows win, so everything on the sheet adds up exactly as
  printed. The cost, accepted knowingly: a receipt can sit a pound or two from the true intake, and
  S3.1's own total may differ from the sum of the receipts by the same rounding. The alternative
  (total wins, rows do not add up) is worse for the person typing it in, because they see the
  discrepancy and cannot tell whether they mis-keyed. The rounding order the pantry uses is now
  fixed in `domain-modeling.md §5.4` and is load-bearing.
- ~~**A191 — R3 exports nothing for a stop that produced no food.**~~ **BUILT 2026-08-02 (`D29`).**
  The assumption read the portal correctly: `Scheduled Pickup Not Attempted` and `No Pounds` exist
  because NTFB does want a receipt for a fruitless pickup rather than silence, and the pantry
  confirmed it. R3 now emits both — a `SKIPPED` stop or a run nobody worked ticks the first, a
  resolved stop that came to nothing ticks the second, and the driver's reason rides along in the
  receipt's Notes. **It did not widen the locked union**, which was the reason for holding off: the
  report's totals are still `weight_entry ∪ unscheduled_donation` and a not-attempted receipt
  carries **zero lines and zero pounds**. What changed is the shape of the export, not the
  arithmetic. This closes the last case where a pickup could vanish silently between the pantry and
  the food bank, which is the same failure as the lost paper sheet, one step further downstream.
- **A192 — the trash-rate defaults are mirrored as a client constant.** `app_config`'s
  `trash_rate_bakery / produce / deli` are not exposed on any endpoint, so the Admin store form
  hardcodes **10 / 5 / 15** to fill the hint beside a blank field ("Blank uses the pantry default,
  10%"). It is **communication only** — a blank field sends `null` and the server applies whatever
  `app_config` actually holds, so the stored value can never be wrong. What can be wrong is the
  sentence: if those defaults ever become editable, the hint starts lying and the constant must
  come off the wire instead. The alternative was a blank control that silently decides something,
  which is worse for the one field in the app where a number changes what the food bank is told.
  *Cited by `s1-8-admin/masters.ts`.*
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
- ~~**A179 — metrics default to the last 28 days.**~~ **ANSWERED 2026-08-02 (`D39`).** The
  assumption was the right kind of guess — four whole weeks kept the previous-period comparison
  like-for-like — but it was a guess, and it meant S3.1 and S3.2 named different periods. The
  default is now **this week**, the same Monday–Sunday week `D41` gives the report, and the
  presets are replaced by explicit From / To. `Earlier`/`Later` still step by the chosen range's
  own length, so the like-for-like property `A179` was protecting survives the change.
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

### 6.1 Round 4: three things reported as bugs that were not

*Kept because the pattern is worth more than the three cases. In all three the code was right and
the **communication** was wrong, and in all three the tempting fix — change the behaviour — would
have broken something. Reproducing before believing is what separated them.*

- **"The Claim button doesn't disappear."** It was `eligible()` refusing an **overlapping** claim
  with a 409; the row stayed `OPEN`, nothing was half-written, and the toast carrying the reason
  had scrolled past. Had this been "fixed" as a state-refresh bug, the real defect — an invisible
  refusal — would have survived, and the overlap guard might have been weakened chasing it. `D52`
  fixes the visibility and leaves the rule alone.
- **"Receive done still shows the Receive done button."** The screenshot was the **CONFIRM** stage,
  one step *before* the one `D37` changed. The CLOSED stage already had no button. What was actually
  missing was the thing the same sentence asked for and nobody had built: **who signed off** (`D46`).
- **"Skip should also count as a finished stop."** It already did, at both ends — `progressOf`
  counts `disposition !== 'PENDING'` and `canHeadBack` treats `COLLECTED | SKIPPED | REASSIGNED`
  alike, each already covered by a test. Nothing was changed.

**The lesson: a user reporting a bug is reliably right that something is wrong and unreliably right
about what.** Two of these three were a missing sentence, not a missing behaviour. The cost of
checking first was minutes; the cost of not checking would have been changes to a claim-eligibility
guard and a completion gate, both invariant-bearing.

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
