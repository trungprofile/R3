# Phase 3 — build plan & standing decisions

Phase 3 is **Report & Metrics**: caps 15 and 16 (`product-requirement.md §4`). Pure
aggregation over what Phases 1 and 2 produced — no new domain state, no new invariants,
and the locked doc already contains the definition the whole phase computes.

Read this **with** the foundation doc that owns your area (`CLAUDE.md` routing table).
Decision numbering continues the D1–D10 series of the Phase 1 and 2 build plans.

## 1. The definition everything computes

`domain-modeling.md §6`, locked, quoted rather than paraphrased:

```
report  = weight_entry[voided = false]  ∪  unscheduled_donation[CONFIRMED ∧ reportable]
metrics = weight_entry[voided = false]  ∪  unscheduled_donation[CONFIRMED]
```

Three ways to get that wrong, each of which yields a number that looks right:

1. **Filtering the union on `Shift`.** The locked doc forbids it in as many words —
   walk-ins have none. A join starting from `shift` drops every unscheduled donation
   and the total still adds up, to the wrong figure.
2. **Bucketing on `created_at`.** `report_day` is `shift.occurrence_date` for a weight
   and `received_date` for a donation (`data-model.md §8`). Receiving legitimately lags
   past midnight.
3. **Summing in JavaScript.** `numeric(8,2)` is exact; a float is not. Every total is a
   SQL `sum()` or integer-cent addition.

`server/test/report-union.test.ts` has one test per mistake, and each is written to fail
loudly rather than to a plausible wrong number.

## 2. Standing decisions

### D11 — the AGFP→NTFB mapping lives on S3.1

`ui-ux-spec.md`'s own open assumption 3 says the mapping is "maintained in the Report
screen (or Admin). **Confirm where you want it to live.**" Resolved in favour of the
Report screen: S3.1 lists it first, it is where the mapping's effect is visible, and a
Reporter who finds an unmapped category mid-report should not have to change screens
and tiers to fix it. The routes are therefore `REPORT`-duty, not `ADMIN`-tier.

**This is the doc's own open question and the human may still override it.** Moving it
to S1.8 later is a route-access change and a screen move, not a data change.

### D12 — NTFB categories ship EMPTY, and unmapped weight blocks the export

The 11 AGFP category names are the pantry's and were seeded at launch (migration 0010).
The NTFB (Meal Connect) category names are **North Texas Food Bank's**, and they appear
in no foundation doc. Migration 0012 creates the table and seeds nothing.

Inventing them would put fabricated values in the one column that decides what the
pantry reports to its food bank, and every gate in this repo would pass while it did,
because nothing here knows the right answer.

The consequence is deliberate and load-bearing: an AGFP category that carries weight in
a week but maps to nothing is **surfaced and blocks export**, never silently dropped.
Dropping it would understate the report by exactly the amount nobody noticed — the
"lost-sheet misreporting" failure Success Metric 4 exists to kill.

**Needs the human:** the NTFB category list, and which AGFP category maps to each.

*Update 2026-07-30.* A real receipt names ten of them — Meat, Bread, Produce, Prepared
Meals, Dairy, Assorted Dry Food, Non-Food, Pet Food, Health & Beauty, Trash — and the
alignment with our eleven is close enough that AGFP's list was plainly derived from
NTFB's. **The table still ships empty and the mapping is still unentered**, for two
reasons that are the original argument, not a hedge: those ten are the categories used
on *one* receipt, not the dropdown's vocabulary, and `Frz Non Meat` matches none of
them. Seeding ten and leaving the eleventh to be guessed at is the fabricated-value
failure this decision exists to prevent, one row smaller. The pantry enters them on
S3.1 from their own form; `phase-3-state.md` carries the observed list so nobody has to
re-derive it from a PDF.

### D13 — the export is a worksheet for a web form, not a file anyone uploads

*Superseded 2026-07-30 by a real submitted receipt (NTFB agency 026357P, pickup
2026-03-20) and the three Meal Connect data-entry screens. The original decision — CSV
at the report's grain, columns provisional — is kept below for the reasoning it records
about not inventing a format.*

**What Meal Connect turned out to be.** Three web screens a person types into. A receipt
is `(Pickup Date, Donor)`, where Donor comes from NTFB's own picker and reads
`H-E-B Food Stores (810)`. Under it are N line items of `Category · Storage ·
Description · Pounds`. A review list then shows each pending receipt with
`Number of Items`, `Total Pounds` and status `New`, and a separate **Submit Receipts**
step files them; the submitted receipt comes back as `Tentatively Successful` under a
12-digit number, headed with the agency and food bank codes.

**There is no import.** So "Meal Connect format" is not a file format at all, and the
export's job is to be the sheet a Reporter reads *while typing*. That fixes the shape:

- One row per **line item**, at grain `day × donor × ntfb_category × storage`.
- Sorted **`day → donor → category`** — receipt order. The original sorted category
  before donor, which scatters one receipt's lines down the file.
- `Receipt Items` and `Receipt Total (lb)` repeated on every row of a receipt, because
  those are the two numbers the review screen shows back before Submit. Repeated rather
  than emitted as subtotal rows, which would make the file non-rectangular.
- Columns: `Pickup Date, Donor, Donor Code, Category, Storage, AGFP Category, Pounds,
  Receipt Items, Receipt Total (lb)`. Named as Meal Connect's own screens name them.

**`NTFB Code` is gone from the file.** The entry form picks a category by name from a
dropdown; the `MEAT48675888`-style ids on the receipt are Meal Connect's own per-line
identifiers, issued on submission and not something anyone types. `ntfb_category.code`
stays as a nullable column and a field on S3.1 — harmless, and still the right place if
a form somewhere does ask for one — but it is no longer exported.

**What is still not settled** (`phase-3-state.md`): whether the form accepts a decimal
in Pounds (the export does not round — A189), and whether the two checkboxes
`Scheduled Pickup Not Attempted` and `No Pounds` mean R3 owes NTFB a receipt for a stop
that produced nothing (A191). The second is a change to the locked doc's union, not a
change to this file.

### D15 — a Meal Connect line item is `(category, storage)`, and storage is part of the mapping

The form asks for Storage beside Category on every line, so the mapping as D12 built it
could not fill it in. `category.ntfb_storage` (migration 0013) is the missing half.

It sits on the **AGFP** side rather than on `ntfb_category` because storage varies
within one NTFB bucket — `Frz Non Meat` and `Dry` may both report as one NTFB category
while being frozen and dry — and the sample receipt proves Meal Connect accepts that,
carrying two separate `Prepared Meals` lines (239 lb and 73 lb). On `ntfb_category` it
would force one answer per bucket and file frozen food as dry.

Consequences, both of which are the point: the report rolls up on the pair, so one NTFB
category under two storage values is two lines on screen and two line items on the
receipt; and `storage` is **free text**, by D12's argument unchanged — `Frozen`, `Dry`
and `Refrigeration` are what one receipt showed, not a vocabulary anyone here has been
given. A missing storage is surfaced on the mapping row but does **not** block the
export: the weight still reaches the right category, and only one of four fields is
blank. That is a weaker failure than an unmapped category and gets a weaker response.

<details>
<summary>D13 as originally decided (superseded)</summary>

PRD cap 15 and Success Metric 3 both say "Meal Connect format". Neither says what that
is; it is NTFB's file format and it is not in this repo.

Emitted: CSV at the report's own grain (`data-model.md §8` — `report_day × category ×
donor-or-label`), columns `Date, NTFB Category, NTFB Code, AGFP Category, Donor,
Weight (lb)`. Every value is traceable and nothing is invented beyond the header row.

**Needs the human:** a real Meal Connect submission or its spec. Until then the file is
correct data in a guessed shape. `ntfb_category.code` exists and is nullable for the
same reason — Meal Connect may key on a code, and a guessed code is worse than a null.

</details>

### D14 — the Reporter's edit is deliberately NOT window-gated

`domain-modeling.md §3.1` closes the receiver's edit window `N` days after shift start.
D9 (Phase 2) applied that to every receiver write. S3.1's edit does **not** honour it,
and that is the point: PRD cap 15 says that after the window closes, the Reporter's
drill-in is "the *only* remaining way to correct that entry — the tablet no longer
allows it".

Mechanically identical to the receiver's correction — void-old + insert-new (I13),
presented as a plain overwrite. No approval step; the Reporter's edit is the correction.
The `reportable` toggle stays a plain field edit (last write wins) and calls the *same*
service the receiver's S2.3 calls, so I16b is checked in one place rather than two.

## 3. Single-owner files

Unchanged from the earlier plans; the lead owns all of them:

- `server/migrations/` and the generated `server/src/db/types.ts`
- `shared/src/`, the route registry, the job registry
- `client/src/app/routes.ts`, `client/src/main.tsx`, `client/src/tokens/`
- `package.json` — **no dependency was added in Phase 3**

`CURRENT_PHASE` is bumped to 3 **with** the screens, never ahead of them. Phase 2 learned
this the hard way: `nav.tsx` offers a nav entry as soon as a route's phase has shipped,
so bumping early puts Report and Metrics in the desktop nav pointing at placeholders.

## 4. Cross-doc dependencies

| Doc | Owns | This doc depends on it for |
| :---- | :---- | :---- |
| `product-requirement.md` | caps 15–16, Success Metrics 3 & 4 | the phase's scope; "Meal Connect format" (D13) |
| `domain-modeling.md` (locked) | §6's report/metrics union, I7, I13, I21 | everything §1 above computes; D14's void-insert |
| `data-model.md` | §8's `report_day` anchor, §12 indexes | migration 0012; the two-branch union |
| `architecture.md` | enforcement tiers, default-deny | the REPORT-duty vs ADMIN-tier split |
| `ui-ux-spec.md` | S3.1, S3.2, open assumption 3 | D11's resolution; the screens |
| `phase-2-build-plan.md` | D7–D10 | D14 is the deliberate exception to D9 |
