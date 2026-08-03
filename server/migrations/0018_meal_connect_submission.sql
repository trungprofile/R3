-- "I have already filed this one" — the Meal Connect check-off (D35).
--
-- WHAT THIS IS FOR. D29 settled that the export is a printed receipt, one card per
-- `(pickup date, donor)`, mirroring the portal's own form, and D13's finding that the
-- portal has NO IMPORT still stands. So a reporter files a fifteen-store week by typing
-- fifteen separate submissions, one at a time, into three web screens each. Halfway
-- through that, the only question that matters is which ones are already in. A local
-- flag on the screen answers it for one person until they reload; a second reporter
-- picking up the same week sees nothing at all, and the failure mode is a receipt
-- submitted twice or not at all. Neither is visible at the far end. So this is
-- PERSISTED STATE, not a UI flag.
--
-- THIS ADDS AN ENTITY TO A LOCKED DOC, AND SAYS SO IN PLACE.
--
--   `domain-modeling.md` is locked (`CLAUDE.md` authority order) and its §2 enumerates
--   the entities. `MealConnectSubmission` is a new one. It is added under EXPLICIT
--   HUMAN AUTHORIZATION DATED 2026-08-02, recorded here the same way migration 0015
--   records `D24`'s amendment of §2.3 and I16, and the way I27's 2026-07-28 amendment
--   records itself — so the precedent for how a locked doc gets changed stays
--   consistent and the authorization is discoverable from the schema rather than only
--   from a chat log.
--
-- IT CHANGES NO ARITHMETIC. The report's union is untouched: `domain-modeling.md §6`
-- is still `weight_entry[NOT voided] ∪ unscheduled_donation[CONFIRMED ∧ reportable]`,
-- and a ticked receipt weighs exactly what an unticked one does. This table records
-- what a PERSON did with a receipt after R3 had finished computing it. Nothing in
-- `weeklyReport()` or `exportReceipts()` reads it as an input to a total.
--
-- THE COMPOSITE PRIMARY KEY IS THE TIER-1 GUARD (`architecture.md §4.1`). Two reporters
-- working the same week and ticking the same store cannot produce two rows: the second
-- INSERT is refused by the database, not by a service that read first and hoped. The
-- service turns that into "already submitted", which is the truthful answer either way.
-- This is the same shape as every other uniqueness rule in the schema — expressed as a
-- constraint, so it holds under the concurrency the app cannot see.
--
-- THE KEY IS THE RECEIPT'S OWN KEY. `(pickup date, donor)` is what D29 groups a receipt
-- on and what Meal Connect's own form asks for first, so the row is keyed on exactly
-- the pair the reporter is looking at. There is no surrogate id, because there is no
-- second thing to point at one.
--
-- WHY `donor_id` IS NOT NULL. It is a real FK to a real store, `ON DELETE RESTRICT`
-- like every other FK here (`data-model.md §0`).
--
--   `donorHasHistory()` (I21, `services/donor.ts`) is deliberately NOT extended for it,
--   and this is the one referencing table where that is safe rather than an oversight:
--   a submission can only exist for a receipt, and a receipt only exists where the
--   store already has a `weight_entry`, an `unscheduled_donation`, a `shift_stop` or a
--   `route_stop` — all four of which that predicate already probes. So a ticked store
--   is soft-deleted for reasons that predate the tick, and this table can never be the
--   deciding probe. The `ON DELETE RESTRICT` still backs it up if that reasoning is
--   ever made wrong by a new way to mint a receipt (build-plan D3's stated cost).
--
-- The consequence of NOT NULL, said out loud rather than
-- discovered: a receipt whose donor is a FREE-TEXT WALK-IN LABEL has no `donor` row and
-- therefore cannot be ticked. That is the same store Meal Connect itself cannot be
-- pointed at — `donor.ntfb_donor_code` is null for it by construction — so the check-off
-- is missing exactly where the submission is, and the screen says so rather than
-- offering a control that would fail.
--
-- UN-TICKING IS A DELETE, which is what makes this reversible: a mis-tick is undone by
-- removing the row, not by writing a second row saying the first was wrong. There is no
-- soft-delete here because there is no history to preserve — the fact being recorded is
-- present-tense ("this is filed"), and I21's archive-rather-than-destroy rule governs
-- MASTER RECORDS, which this is not.
--
-- Forward-only; no down migration (architecture.md §5.2).

-- Up Migration

CREATE TABLE meal_connect_submission (
  -- `report_day`, the same date the receipt prints and the same one
  -- `data-model.md §8` defines: `shift.occurrence_date` for a weight,
  -- `received_date` for a donation. Never `created_at`.
  pickup_date  date NOT NULL,
  donor_id     uuid NOT NULL REFERENCES donor (id) ON DELETE RESTRICT,

  submitted_at timestamptz NOT NULL DEFAULT now(),
  -- I26's provenance pattern, half of it: who ticked it. There is no `updated_by`
  -- because there is no update — the only two operations are insert and delete.
  submitted_by uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT,

  -- Tier 1. Two reporters ticking the same store on the same day cannot make two rows.
  PRIMARY KEY (pickup_date, donor_id)
);

-- The report reads a RANGE (D41), so the lookup is "every submission between these two
-- dates" rather than a point read. The primary key's own index leads on `pickup_date`
-- and already serves that; this index exists for the other direction — "has this store
-- ever been filed", which is what I21's history check on a donor asks.
CREATE INDEX ix_mcs_donor ON meal_connect_submission (donor_id);
