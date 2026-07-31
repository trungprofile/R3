-- What a real Meal Connect receipt turned out to require (PRD cap 15, D13).
--
-- 0012 built the AGFP→NTFB mapping against a format nobody here had seen. A real
-- submitted receipt (NTFB agency 026357P, 2026-03-20) plus the three data-entry screens
-- settle three things that were guesses, and each one is a column here.
--
-- 1. A LINE ITEM IS (CATEGORY, STORAGE), NOT CATEGORY ALONE.
--
--    Meal Connect's entry form asks for `Category`, `Storage`, `Description`, `Pounds`
--    per line, and the receipt prints `Storage Requirement` as its own column — Frozen,
--    Dry, Refrigeration on the sample. The mapping as built emits a category and no
--    storage, so it cannot fill the form.
--
--    `ntfb_storage` sits on `category` — the AGFP side, beside `ntfb_category_id` —
--    rather than on `ntfb_category`, because storage varies WITHIN an NTFB bucket.
--    'Frz Non Meat' and 'Dry' may both report as one NTFB category while being frozen
--    and dry respectively, and the receipt confirms Meal Connect allows exactly that:
--    it carries two separate `Prepared Meals` lines (239 lb and 73 lb). Putting storage
--    on `ntfb_category` would force one answer per bucket and quietly file frozen food
--    as dry. So it is part of the mapping, and the export's grain grows a dimension.
--
--    TEXT, NOT AN ENUM, and this is D12's reasoning applied unchanged: the three values
--    above are the ones that appear on ONE receipt, not NTFB's vocabulary. An enum
--    would freeze a guess into the schema, where §1's usual argument for enums assumes
--    the value set is actually known. The Reporter types what Meal Connect shows them.
--
-- 2. MEAL CONNECT KEYS DONORS BY CODE.
--
--    Its donor picker reads `H-E-B Food Stores (810)`, `Target (6228)` — a name and the
--    food bank's own number for that store. The export names the donor as AGFP knows
--    it, which leaves the Reporter eye-matching two lists. Nullable because it is
--    NTFB's number to issue and the pantry may not have collected it for every store.
--
-- 3. THE PANTRY'S OWN IDENTIFIERS ARE KNOWN NOW.
--
--    The receipt header carries `Amazing Grace Food Pantry (026357P)` and `North Texas
--    Food Bank (24)`. Defaulted here for the same reason `timezone` defaults to
--    'America/Chicago' in 0001 — this repo is one self-hosted pantry's system of
--    record, and its own identifiers are configuration, not fixtures.
--
-- What this migration deliberately does NOT add: a `description` column. Meal Connect's
-- Description field is optional and prints as `None` on the sample receipt, and R3 has
-- nothing to put in it — the export's rows are day totals per store per category
-- (A180), not single entries with their own text. An always-empty column would be
-- noise in a file a human reads while typing.
--
-- Forward-only; no down migration (architecture.md §5.2).

-- Up Migration

-- The storage requirement this AGFP category reports under. NULL means the Reporter
-- has not said yet; unlike an unmapped category it does NOT block the export, because
-- the weight still reaches the right NTFB category and only one of the form's four
-- fields is missing. S3.1 surfaces it on the mapping row instead.
ALTER TABLE category
  ADD COLUMN ntfb_storage text;

-- North Texas Food Bank's number for this store, as its donor picker shows it.
ALTER TABLE donor
  ADD COLUMN ntfb_donor_code text;

-- Two donors sharing one NTFB code is a data-entry mistake, not a domain possibility.
-- Partial on both predicates: NULL is the normal unknown state and repeats freely, and
-- a deactivated store must not hold its code hostage against a replacement row.
CREATE UNIQUE INDEX uq_donor_ntfb_code
  ON donor (ntfb_donor_code)
  WHERE ntfb_donor_code IS NOT NULL AND deactivated_at IS NULL;

-- The pantry's identity at the far end. Read-only in Phase 3: S3.1 prints them above
-- the export so a Reporter can confirm they are typing into the right Meal Connect
-- account before they start, which is the whole of their current job.
ALTER TABLE app_config
  ADD COLUMN ntfb_agency_code   text NOT NULL DEFAULT '026357P',
  ADD COLUMN ntfb_food_bank     text NOT NULL DEFAULT 'North Texas Food Bank',
  ADD COLUMN ntfb_food_bank_code text NOT NULL DEFAULT '24';
