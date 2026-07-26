# Domain Modeling — Appendix: resolved decisions (why the model looks like this)

Archived from `R3 - Domain Modeling .md`. Short log of the calls made during design, for a human reviewer — not part of the canonical spec.

- **Donor, not Store** — one master entity; "store" was an overloaded synonym. Admin-editable; soft-deleted once it has history.
- **Shift = schedule + execution merged** — one entity; execution fields sit null until start.
- **ShiftStop ≠ RouteStop** — execution snapshot vs. template; forced by report traceability + mid-run reorder/skip. Named to parallel RouteStop.
- **WeightEntry grain `(Shift, Donor, Category)`, no ShiftStop FK** — receiving is dock-side and decoupled from per-stop check-off.
- **WeightEntry and UnscheduledDonation are peers** — same grain, unioned for reporting, never nested; an unscheduled donation is its own weight record.
- **Availability is whole-person, time-only** — drivers block times, not routes; keeps eligibility a pure temporal test.
- **Intake split = planned (`WeightEntry`) vs unplanned (`UnscheduledDonation`)** by entity type; `reportable` is a separate flag on `UnscheduledDonation`, not the discriminator. scheduled ⇒ reportable (one-way).
- **Driver-add never writes a ShiftStop** — keeps the staff plan pristine so planned/unplanned is structural.
- **`origin` (driver vs receiver) dropped**; `status` (SUGGESTED/CONFIRMED) kept as the prefill lifecycle.
- **No auto-complete** — completion is the receiver's receive-done only; edit window is time-based.
- **Pickup-complete milestone added as a flag** (`pickup_completed_at`), not a state — explicit driver tap, gated on all stops resolved, fires the "driver heading back" notification. Reverses the earlier "no handoff state" call: that assumed no driver signal existed, and this adds one. Stays a flag (not a 6th state) because the milestone is optional.
- **Completion gate is hard** — every planned ShiftStop must be WEIGHED, SKIPPED, or REASSIGNED before COMPLETED.
- **Recurrence = eager-to-horizon, horizon locked at ~1 year** — rows are nearly free at this scale; virtual/hybrid is over-engineering and doesn't even escape the horizon (reminders force one).
- **WeightEntry void = soft flag, not hard-delete or reversing entry** — ledger rows feed an externally-reported (NTFB) number, so retractions stay as audit evidence; void-flag keeps SUM(non-voided)-on-read simple and avoids the lost-update risk a running total would create. Hard-delete reserved for zero-ledger-value rows (unconfirmed SUGGESTED, zero-history master data).
- **WEIGHED is a derived projection, not a stored disposition** — stored set is {PENDING, COLLECTED, SKIPPED, REASSIGNED}; WEIGHED computed from a non-voided WeightEntry. Prevents a stored 'WEIGHED' from passing the completion gate on a voided-then-abandoned weight.
- **Born-CLAIMED gated by eligible() at materialization** — closes the I20 hole where a block declared before its instance is materialized would otherwise escape the eligibility check. Same gate as claim-all, applied at both creation paths.
- **Availability declaration is always a gate, never a side-effecting release** — a block overlapping an owned CLAIMED or IN_PROGRESS shift is rejected outright; the driver must cancel/release that shift first (CLAIMED case) or wait for it to finish (IN_PROGRESS, since I9 blocks cancelling it). No availability save ever auto-changes a shift's state.
- **MISSED = passed ∧ state ∈ {OPEN, CLAIMED}** — includes never-claimed (UNCLAIMED), not just claimed-no-show (NO_SHOW); excludes CANCELLED (a deliberate non-pickup, not a miss).
- **Abort stays IN_PROGRESS** — no abort-to-terminal transition; an abandoned run is closed only by explicit per-stop resolution, keeping it distinguishable from a normal empty run.
- **Donor uniqueness (I28) + on-route guard (I29)** — a Donor is at most one stop per route/shift, and an on-shift UnscheduledDonation cannot reuse a scheduled donor; keeps WEIGHED-by-donor well-defined and planned/unplanned disjoint.
