# R3 Doc Inconsistencies — Tracking

For each item: Claude presents the conflicting statements (already done below) plus the realistic options and their tradeoffs. The user decides which way to resolve it. Only after the user picks does Claude edit the doc(s) to match — then check the item off. Do not pick a resolution unilaterally.

Suggested order: A1 → A2 → A9 → B11 → A4 → A5 → rest.

---

## A. Hard contradictions

- [x] **A1. Does declaring unavailability release an owned shift?**
  RESOLVED: no auto-release. Declaring an availability block that overlaps an owned `CLAIMED` or `IN_PROGRESS` shift is a hard block — save is rejected, driver must cancel/release that shift first (or wait, for `IN_PROGRESS`, since I9 prevents cancelling it). Domain §5.2/I20 updated to describe this as a gate, not a release sweep; PRD:55 and UI:172,174 now state the block explicitly instead of leaving it implicit.

- [ ] **A2. Does I20 apply to staff-assignment, not just claim/materialization?**
  Domain I20 (269-275) says an owned shift never overlaps availability, enforced at claim/block-declaration/materialization — staff-assign isn't listed. PRD:55 says availability "never auto-blocks an assignment." Decide whether staff-assign is gated or exempt, and say so explicitly in I20.

- [ ] **A3. Availability scope: route-scoped or whole-person?**
  UI:172 offers "a specific weekly route" or "all routes." Domain I19 + Data Model:490 say whole-person, time-only, no `route_id`. Also Data Model:624 misfiles this divergence as "PRD capability 7" — it's actually the UI doc's wording, not the PRD's.

- [ ] **A4. Who picks the route — staff at publish, or driver at start?**
  PRD:63,12 and UI:179 describe the driver picking the route at start. Domain I4 + Data Model:224 bind `route_id NOT NULL` at schedule time (staff-side). Align: driver likely picks *which shift*, not *which route*.

- [ ] **A5. Staff-set "truck default" at publish is unstorable.**
  UI:188 has staff set an optional truck default when publishing. Data Model:254 CHECK constraint forbids `truck_id` being set before `IN_PROGRESS`. Either drop the truck-default UI control or add a separate `truck_default_id` column.

- [ ] **A6. Weight correction: overwrite or void-and-insert?**
  PRD:110 and UI:126,275 describe a simple last-write-wins overwrite. Domain I13 + Data Model:350 make weight rows immutable — correction is void-old + insert-new. Reconcile (UI can *present* as overwrite while storing void+insert, but say so explicitly).

- [ ] **A7. Categories: fixed enum or admin-managed master data?**
  UI:339,207,273 say categories are a fixed, non-editable list of 11. Domain:31 + Domain:189 + Data Model:116 model `Category` as full admin-managed master data with ACTIVE⇄ARCHIVED lifecycle. Also: PRD has no category-management capability at all (Administration is only accounts/donors/trucks) — decide if one is needed.

- [ ] **A8. Truck-inbound notification has no valid recipient shape.**
  PRD:82 sends it to the device (receiver tablet push subscription), not a user. Domain:153 says "to the Receiver(s)." Data Model:502 makes `notification.recipient_id` NOT NULL referencing `app_user`. Decide: fan out to users holding `receive`, or make `recipient_id` nullable with a device-scoped inbox path.

- [ ] **A9. "Cancel" means two different things — and bulk-cancel by a driver may unintentionally delete future recurring runs.**
  PRD:56 titles the capability "Cancellation" but describes driver *release* (owned shift → back to board as Open), then in the same row calls recurring-range removal "bulk-cancelled." UI:165-166 shows a driver-facing "Cancel run" button that returns the shift to Open. Domain's `bulk-cancel` (§5.3, line 420) sets state to `CANCELLED` (terminal), not `OPEN`. Confirm: should a driver's bulk action on a recurring series be release-to-OPEN (coverage gap, refillable) or CANCELLED (runs gone)? Decide and make PRD/UI/Domain use the same verb for each case.

---

## B. Specified in one doc, missing a home in the others

- [ ] **B10. Pickup-complete milestone (`pickup_completed_at`) has no UI and contradicts "no completion step."**
  Domain:148-154 adds a driver tap + review screen that triggers the truck-inbound notification. PRD:63 says "No completion-confirmation step"; UI:180 says "the route just ends when stops are done." No screen exists for this tap. Domain:471 admits this reverses an earlier decision that was never propagated. Either add the UI screen + update PRD language, or drop the milestone and find another truck-inbound trigger.

- [ ] **B11. Receive-done / completion gate has no UI, and the tablet has no shift context. (Biggest gap — likely needs a redesign of S2.2.)**
  Domain I11/I12 require an explicit receiver "receive-done" action gated on every ShiftStop being WEIGHED/SKIPPED. PRD:90 says entries are "confirmed on submit (no separate sign-off step)" — seemingly forbidding a separate action. UI's only action is "Submit sheet," which is per-store, not per-shift, and the tablet flow (store picker, UI:233) has no run/shift picker, no stop list, no skip control, and no gate feedback — yet `weight_entry.shift_id` is NOT NULL. Needs a real design decision on how store-based weighing maps to shift-based completion.

- [ ] **B12. Driver-initiated unscheduled donation (SUGGESTED prefill) is invisible in the UI.**
  Domain:76 has drivers flagging an ad-hoc pickup mid-run, creating a `SUGGESTED` row as receiver prefill. PRD cap 12 only describes the receiver-side record. UI S2.3 is receiver-only with no driver-side control in S1.5 and no prefill surfaced. Also currently split across phases (driver half is Phase 1, notification/receiver half is Phase 2).

- [ ] **B13. Three promised note channels, but only one storage column exists.**
  PRD cap 11 promises coordinator→driver, driver→receiver, and admin per-store notes. Domain:97 only defines one run-level `Shift.note` (driver's). `shift_stop` has no note column at all. Add columns/fields for the missing two, or scale back the PRD promise.

- [ ] **B14. `donor` and `category` tables have no attribute columns anywhere.**
  Data Model:108 punts donor's name/address/contact/notes to "01/PRD," but neither actually lists columns, and `category` (Data Model:116) doesn't even have a `name` column. Add the missing attributes to the data model.

- [ ] **B15. Reporter's post-window edit authority is unspecified in PRD/UI.**
  Domain:144 + Data Model:378 give the Reporter exclusive intake-edit rights after `receiver_edit_window_days` expires. PRD's `report` duty (PRD:30) is only "generate and file the report" — no edit power or window mentioned anywhere else. Decide if this is real and document it in PRD + UI.

- [ ] **B16. "Stop set reassigned mid-cycle" has no defined mechanism.**
  PRD:63 and UI:180 both mention stops being "reassigned" mid-cycle, but `ShiftStop` belongs to exactly one Shift and no transfer operation exists in Domain or Data Model. Either define the mechanism or remove the word from PRD/UI.

- [ ] **B17. MISSED/UNCLAIMED/NO_SHOW derived states have no consumer.**
  Domain:111 defines them and assigns ownership to "the reporting doc," but no PRD capability or UI screen (S3.2 metrics) actually surfaces them. Decide if/where they show up, or drop them until needed.

- [ ] **B18. Several referenced docs don't exist yet, and some are load-bearing for Phase 1.**
  `03-architecture`/access (auth, sessions, PIN), `04-api`, `05-workflow`, the reporting doc, and the notifications doc are all deferred-to but unwritten. Auth/sessions and notification delivery are required for Phase 1. Also fix the naming mismatch: docs refer to themselves as `01`/`02`/`06-uiux` but the actual filenames are `R3 - Domain Modeling.md`, etc.

---

## C. Undefined terms doing real work

- [ ] **C19. "Coordinator" is never formally defined.**
  Used as a notification recipient (PRD:79-81) but there's no coordinator flag in the schema — only `tier`. Is it "all Staff," or one designated user (PRD:146 names "Clark")? Pin this down; notification fan-out can't be built without it.

- [ ] **C20. "PII" is never defined, despite gating the tier model.**
  PRD:22-24 restricts "others' PII" per tier, but UI:102 shows everyone's names on the shared login screen and PRD:53 puts driver names on the shared board — so names aren't PII. Enumerate what actually counts (phone? address?).

- [ ] **C21. `eligible()` definition differs between PRD and Domain.**
  PRD:84's prose omits the state filter that Domain:365 includes (`S.state ∈ {CLAIMED, IN_PROGRESS}`). Align the PRD's plain-language version with the algorithm.

- [ ] **C22. `claim-all` partial-success has no UI feedback.**
  PRD:54 says claiming a recurring shift covers "all current and future instances." Domain:413 says ineligible instances are "skipped, not claimed" (partial success). UI:158's claim prompt doesn't handle a partial result ("you got 10 of 12"). Add that state to the UI.

---

## D. Small / stale

- [ ] **D23. Conflicting `--text` hex values.**
  UI:44 says `--action-fill` label color is `#1f2933`; UI:42/60 define `--text` as `#333333`. Pick the correct hex (affects the stated 5.0:1 contrast ratio claim).

- [ ] **D24. Unresolved inline questions + unfolded divergences in Data Model doc.**
  Data Model:214 has an open inline question about where the recurrence-pattern author is recorded. Data Model:620-624 lists three divergences never folded back into Domain/PRD (and item 3 there is misfiled — see A3). Also: UI:233 shows the receive sheet dated "Today (read-only)" while the report day is `shift.occurrence_date` — these can diverge when receiving happens past midnight (the exact case Data Model:422 warns about).

---

**When all boxes are checked:** re-read the four docs once more for drift introduced by the fixes themselves, then delete this file.
