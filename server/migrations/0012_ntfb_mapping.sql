-- The AGFP→NTFB category mapping (PRD cap 15, `ui-ux-spec.md` S3.1).
--
-- Phase 3's report is "AGFP categories with auto-summed weights, mapped to NTFB
-- categories via an in-app AGFP→NTFB mapping (editable mapping table)". This is that
-- table's storage half.
--
-- WHY THIS SHIPS EMPTY, AND WHY THAT IS THE CORRECT DESIGN.
--
-- The 11 AGFP category names are the pantry's own and were seeded at launch in 0010.
-- The NTFB (Meal Connect) category names are **North Texas Food Bank's**, and they are
-- written down in no foundation doc — not in `product-requirement.md`, which names the
-- capability, nor in `ui-ux-spec.md` S3.1, which names the screen. Inventing them here
-- would put fabricated values in the one column that decides what the pantry reports to
-- its food bank, and every gate in this repo would pass while it did so, because
-- nothing in the repo knows what the right answer is.
--
-- So: the mechanism ships complete and the data stays the pantry's to enter. A
-- Reporter adds NTFB categories on S3.1 and maps each AGFP category to one. Until they
-- do, the report REFUSES to export rather than dropping unmapped weight — see
-- `services/report.ts`, which treats an unmapped category carrying weight as a blocking
-- condition and names it on screen (phase-3-build-plan.md D12).
--
-- Forward-only; no down migration (architecture.md §5.2).

-- Up Migration

-- NTFB's own category vocabulary. Master data like `category`, and soft-deleted the
-- same way: once a mapping references one, it is archived rather than removed.
--
-- By ANALOGY to I21, not under it. I21 enumerates Donor / Category / Truck / User and
-- does not mention this table — it did not exist when the invariant was written. The
-- shape and the reasoning are the same; the citation is an analogy and is recorded as
-- one in `data-model.md §4.1`.
CREATE TABLE ntfb_category (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  -- Meal Connect may key on a code rather than a display name. Optional because
  -- nothing in the docs says whether it does, and a null here is honest about that
  -- where a guessed code would not be.
  code           text,
  deactivated_at timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- One NTFB category per AGFP category; many AGFP categories may share one (the
-- mapping exists precisely because the two vocabularies are not the same shape —
-- "Frozen Meat" and "Frz Non Meat" may well collapse into one NTFB bucket).
--
-- A column on `category` rather than a join table: the cardinality is many-to-one, so
-- a join table would permit a state — one AGFP category mapped to two NTFB ones — that
-- the report has no way to interpret. Making it unrepresentable is cheaper than
-- checking for it (`data-model.md §1`'s reasoning for native enums, same instinct).
--
-- NULL means "not mapped yet", which is the launch state of every row.
ALTER TABLE category
  ADD COLUMN ntfb_category_id uuid REFERENCES ntfb_category(id) ON DELETE RESTRICT;

-- FK index: Postgres does not auto-index foreign keys, and the report joins through
-- this on every run.
CREATE INDEX ix_category_ntfb ON category (ntfb_category_id);

-- Active-only picker, matching the other I21 masters in 0007.
CREATE INDEX ix_ntfb_active ON ntfb_category (id) WHERE deactivated_at IS NULL;

-- A name is a vocabulary, so duplicates are a data-entry mistake rather than a
-- domain possibility. Partial on the soft-delete predicate so an archived name does
-- not block reusing it — unlike `username` (I3), an NTFB category name carries no
-- identity that outlives the row.
CREATE UNIQUE INDEX uq_ntfb_name ON ntfb_category (lower(name)) WHERE deactivated_at IS NULL;
