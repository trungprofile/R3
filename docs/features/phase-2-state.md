# Phase 2 — state

Running record of what is built, what was assumed, and what is still open. Read
`phase-2-build-plan.md` first for the standing decisions; this file is the ledger.

Assumption numbering continues `phase-1-state.md`'s series (which ended at A161), so an
`A#` means the same thing in both files.

## Status

| Step | State |
| :---- | :---- |
| Migration 0011 — §7 intake tables, enum, indexes | **done** |
| `shared/src/receive.ts`, `shared/src/donation.ts` | **done** |
| `services/receive.ts` — cap 14 | **done** |
| `services/donation.ts` — cap 12 | **done** |
| Truck-inbound wired into `completePickup` — cap 13's held-back row | **done** |
| I21 predicates + I30's unweighed clause (D3's deferred cost) | **done** |
| `routes/receive.ts`, `routes/donations.ts`, registry wiring | **done** |
| `jobs/suggestion-sweep.ts` — I17's other half | **done** |
| Server tests — 74 new, `gate.sh` green at 603 total | **done** |
| Client shell — routes, `CURRENT_PHASE = 2`, tablet home path | *lands with the screens — see below* |
| S2.1b / S2.2 / S2.2b / S2.3 / S2.4 screens, S1.5 flag button | *in progress* |

**The client shell change is deliberately not in the server commit.** `homePathFor` sends a
receive-duty user at tablet width to `/receive`, and `nav.tsx` gives that viewport no
navigation at all — so shipping the redirect before S2.1b exists would replace a working
board with a placeholder whose only affordance is Logout, and logging back in would return
to the same placeholder. `doc-qa` caught it as a code-violates-doc finding against
`ui-ux-spec.md` §4. The router change and the screens it depends on land together.

## Open assumptions

Every entry is a place the docs did not answer and the build chose one reading. Each is the
human's to confirm or override.

### A162 — S2.1b's run filter contradicts itself; the wider reading won

S2.1b says both "lists today's `IN_PROGRESS` shifts **with at least one unresolved stop**"
and "completed runs (all stops WEIGHED/SKIPPED **+ receive-done already done**) drop off the
list". Those describe different sets.

Implemented as `status = 'IN_PROGRESS'` and nothing else. The stricter reading would drop a
run the moment its last stop was weighed — and S2.2b is reached "from S2.1b once a run shows
*all stops done*", so a fully-weighed run must stay listed or **receive-done becomes
unreachable and the run can never close**. `readyForReceiveDone` is what the screen keys the
S2.2b affordance off.

Also **not** filtered to `occurrence_date = today`, for the reason S2.1b itself gives for
showing the shift's own date: receiving legitimately lags past midnight, and a Tuesday run
received at 12:30am Wednesday must stay reachable. At ~15 pickups a week an unclosed run from
last week is one short list row, and hiding it would strand it permanently.

### A163 — the driver's category pick is the losing side of a doc conflict

See D8. Recorded here too because it is the one assumption that **changes a screen the human
has already reviewed**: S1.5's ad-hoc flag gains a category picker it was specced not to have.

### A164 — `reviseWeight` does not move an entry between categories

S2.2's ✎ "overwrite" edits a number in place on its own tile, so the revision keeps the
original row's `category_id`. Moving a weight to a different category is expressible as
void + add, and the UI offers no control for it.

### A165 — weight crosses the wire as a decimal string, never a number

`numeric(8,2)` is exact; a JS `number` is not. Routing a scale reading through a float and
back risks a rounding error in the column that feeds the NTFB report. Subtotals are summed
by scaling to integer cents rather than by floating-point addition.

No doc states this. The alternative — numbers on the wire — would pass every test anyone is
likely to write and be wrong only for values that are not binary-representable.

### A166 — the receiver worklist's recency window is 7 days

`GET /donations` returns every `SUGGESTED` row plus `CONFIRMED` rows created in the last 7
days, so a correction is reachable without hunting. **7 is invented** — no doc gives a
number. It coincides with the default `receiver_edit_window_days`, which is defensible
(nothing older is editable by a receiver anyway) but is not the same knob and does not track
it.

### A167 — a receiver at the shared tablet lands on the run picker

`ui-ux-spec.md §4` says "Tablet (receive): NO NAV. Login goes straight to weight entry, Phase
2", and S2.1 says the receiver login "opens to S2.1b (run picker)". `homePathFor` keys on the
duty **and** the viewport: a receiver on the shared desktop still has a nav and still lands
on the board. Landing them on the board at the tablet would be a dead end, since that surface
has no navigation at all.

### A168 — `SUGGESTED` rows on a shift are swept on the shift's clock, not their own

I17 says unconfirmed prefills go "by the daily sweep once the edit window has expired". The
window is defined from **shift start** (§3.1), so the sweep uses `shift.starts_at`. A
driver-add always has a shift, so no prefill is ever orphaned by this — but it does mean a
prefill flagged late on a long-running shift gets a shorter effective life than one flagged
at the start.

### A169 — voided rows count as referencing history for I21

`donorHasHistory` / `categoryHasHistory` / `userHasHistory` do **not** filter on
`voided = false`. A voided row is retained for audit and is still a real FK reference, so
hard-deleting the donor or category it names would take the audit trail with it — and the
`ON DELETE RESTRICT` would refuse the delete anyway, turning a soft-delete decision into a
foreign-key error. Not stated by any doc.

### A170 — the truck alert deep-links to `/receive`, not to the shift

Every other event in the matrix deep-links to its shift, which is S1.9's "tap to act".
`TRUCK_INBOUND` does not, and for the reason that makes it exceptional at all: it is
addressed to a **device**, so whoever taps it is whoever is standing at the dock.
`/shifts/:id` is the driver's and staff's view of a run and would ask a receiver to be
someone they are not. No doc states a destination for this event.

### A171 — a push now also reaches the open page, not just the OS

S2.4 wants a full-width in-page banner on the tablet that "banners above without
stealing the keypad". The OS notification `sw.ts` already showed is the right surface
for a phone in a pocket and the wrong one for a tablet lying face-up with R3 open, so
the worker now **also** posts the message to every open window (`onForegroundAlert`).

Two consequences worth stating: the page may show a banner for an alert the OS is
*also* showing, and the message goes to every open window rather than one, so a
handler must be idempotent and must not navigate on its own. Nothing focuses or
navigates on arrival — a push is not a tap.

### A172 — the S2.1b screen's own assumptions

Ten more, recorded in `reports/phase2-s2-1b.md` rather than repeated here. The four
that change what a person sees: dates are absolute and never relative (no "Today", even
from the pantry's clock); a fourth status dot for `REASSIGNED`, since the spec names
three and `ReceiveStopState` has five; oldest-occurrence-first list order, so an
unclosed run from last week does not sink; and a stop re-read on every tap, costing one
round trip so two receivers do not land on the same store.

## Bugs found and fixed during the build

- **`a <= b = true`.** Two raw predicates used Kysely's three-argument `where`, which appends
  `= $1` to a fragment that is already a comparison and yields a SQL syntax error. Caught by
  the I17 sweep test rather than by the typechecker. The codebase's existing convention
  (`schedule.ts:161`) is the single-argument form; both call sites now use it.

## Phase-1 assertions that flipped

Three Phase-1 tests asserted the **absence** of Phase 2 and were inverted rather than
deleted — the structural fact is still worth pinning, it just points the other way:

| Test | Was | Now |
| :---- | :---- | :---- |
| `substrate.test.ts` | §7 tables absent (D3) | §7 tables present; plus a new assertion that `shiftstop_disposition` still has no `WEIGHED` member (I12) |
| `masters-category.test.ts` | no table has a `category` FK | exactly `weight_entry` and `unscheduled_donation` do — so a third arriving without `categoryHasHistory` learning about it fails here |
| `notification.test.ts` | five registered jobs | six, with `suggestion-sweep` |

None of these is a constraint relaxed to make a test pass (`phase-1-build-plan.md §5.5`).
Each is a phase-scoped fact expiring on schedule, and `registry.ts`'s own table had already
scheduled the sixth job for this phase.

## Still open from Phase 1

- **A160 — the phone topbar overflows at 390px.** Untouched by Phase 2 and still awaiting a
  human choice between `flex-wrap: wrap` and an ellipsizing alerts chip. Phase 2's screens
  are `n/a` on phone (responsive matrix), so nothing here makes it worse.
- **The copy review** of Phase 1's nine screens. Phase 2 adds five more surfaces to it.
