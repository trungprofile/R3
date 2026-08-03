-- The driver stops guessing a category (D24).
--
-- WHAT CHANGES. `unscheduled_donation.category_id` becomes NULLABLE while the row is
-- `SUGGESTED`, and stays required once it is `CONFIRMED`. The requirement moves from
-- the column to a CHECK on the transition, which is where it actually belonged: a
-- `SUGGESTED` row is a driver's prefill saying "something extra is coming", and the
-- person who can name the category is the receiver holding the food at the scale.
--
-- THIS AMENDS A LOCKED DOC, AND SAYS SO IN PLACE.
--
--   `domain-modeling.md` is locked (`CLAUDE.md` authority order). Its §2.3 lists
--   `Category | required` on `UnscheduledDonation` with no SUGGESTED exemption — and
--   pointedly grants one to `weight` in the very next row. I16 restates it. Both are
--   amended to "required on CONFIRMED" under EXPLICIT HUMAN AUTHORIZATION DATED
--   2026-08-02, recorded the same way I27's 2026-07-28 amendment records itself, so
--   the precedent for how a locked doc gets changed stays consistent.
--
-- IT SUPERSEDES D8. D8 exists only because the locked doc required a category at
-- creation: `ui-ux-spec.md` S1.5 said the driver's control is "just a donor picker (or
-- free-text label) and an optional note", the locked doc outranked it, and D8 recorded
-- the escalation rather than settling it quietly. With the amendment, the UI spec's
-- original sentence is true again and D8 has nothing left to decide. This is the rare
-- case where the lower-authority doc was right all along.
--
-- REPORTING IS UNAFFECTED, which is what makes this cheap. The report and metrics
-- unions read `status = 'CONFIRMED'` rows only (`data-model.md §8`), and the CHECK
-- guarantees every one of those still carries a category. `ix_ud_confirmed` is a
-- partial index on exactly that predicate, so it keeps working unchanged and no query
-- gains a null branch. Only `SUGGESTED` rows — which no report has ever read — can
-- hold a NULL here.
--
-- The FK, the ON DELETE RESTRICT and `ix_ud_category` are all untouched: a category
-- that IS named still cannot be hard-deleted out from under a prefill (I21).
--
-- Forward-only; no down migration (architecture.md §5.2).

-- Up Migration

ALTER TABLE unscheduled_donation
  ALTER COLUMN category_id DROP NOT NULL;

-- I16(c) — CONFIRMED ⇒ category present. Written in the same shape as its two
-- siblings `ck_ud_confirmed_weight` (I16a) and `ck_ud_i16b_source` (I16b), and
-- unconditional for the same reason the weight check is: metrics union every
-- CONFIRMED row regardless of `reportable`, so a category-less one would corrupt the
-- per-category total rather than merely the NTFB report.
ALTER TABLE unscheduled_donation
  ADD CONSTRAINT ck_ud_confirmed_category
  CHECK (status <> 'CONFIRMED' OR category_id IS NOT NULL);
