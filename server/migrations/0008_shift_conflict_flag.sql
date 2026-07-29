-- Shift conflict flag — I20's staff-assign exemption.
--
-- I20 lets Staff assign a driver onto a shift that overlaps that driver's declared
-- availability or another owned shift: `eligible()` is advisory there, not a gate
-- (`domain-modeling.md` I20 note, §5.2 "Staff-assign — not gated"). The override is
-- deliberate, but it is not silent — the same rule requires the shift be "flagged so
-- the driver sees the conflict and can raise it with Staff", which `ui-ux-spec.md`
-- S1.3 renders as a persistent banner on the owner's shift detail.
--
-- Nothing stored that flag. Every doc mandates it and no column carried it, so the
-- rule was unenforceable — found by wave 2's `eligible` lane and owed by the lead,
-- because `server/migrations/` is lead-owned (build-plan §3) and no Wave-3 lane may
-- add a migration.
--
-- Boolean, not a timestamp: the banner asks "is this run flagged?", never "when was
-- it flagged?". A timestamptz would invent a question no screen asks.
--
-- SEMANTICS ARE WAVE 3's. This migration makes the flag storable and constrains it;
-- deciding when it is set belongs with the staff-assign service that sets it.

ALTER TABLE shift
  ADD COLUMN assigned_over_conflict boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN shift.assigned_over_conflict IS
  'I20 staff-assign exemption: Staff confirmed through an eligibility conflict when '
  'setting this owner. Drives S1.3''s persistent banner for the owner. Never set by '
  'self-select or materialization, both of which are gated by eligible() and so can '
  'never produce a conflicting assignment.';

-- The flag belongs to the *owner*, so it cannot outlive one.
--
-- READ THIS BEFORE WRITING A RELEASE / CANCEL / STAFF-UNASSIGN UPDATE. The constraint
-- does NOT clear the flag for you — it makes forgetting to clear it *fail*. Any
-- statement that sets `owner_id = NULL` must also set `assigned_over_conflict = false`
-- in the same statement, or the transaction raises. That is the intent: the loud
-- failure is preferable to a released shift silently keeping a banner and showing it
-- to the next driver, about a conflict that was never theirs.
--
-- Enforced here rather than in the service because it is exactly the kind of "clear
-- the other column too" step an UPDATE forgets (`architecture.md` §4.1 tier 1: if the
-- database can hold the rule, it holds it). `data-model.md §9`'s cancel predicate shows
-- the required form.
ALTER TABLE shift
  ADD CONSTRAINT ck_shift_conflict_flag
  CHECK (assigned_over_conflict = false OR owner_id IS NOT NULL);
