-- NTFB's category list, and where each of ours reports (D26 — RETIRES D12).
--
-- WHY THIS IS NO LONGER FABRICATION.
--
-- 0012 created `ntfb_category` and deliberately left it empty, and it was right to:
-- the names are North Texas Food Bank's, they appear in no foundation doc, and
-- inventing them would have put made-up values in the one column that decides what the
-- pantry reports to its food bank. A real Meal Connect receipt later named ten of them,
-- but seeding from a receipt was still refused on one specific ground — `Frz Non Meat`
-- matched none of the ten, and seeding ten of eleven is the same failure one row
-- smaller.
--
-- The pantry has now answered, in their own words: **Deli and Frz Non Meat both report
-- as Prepared Meal, frozen.** That closes the single named gap, so all eleven AGFP
-- categories have a home and the table can ship filled. These names and storage values
-- are GROUND TRUTH FROM THE PANTRY, not a reading of a receipt — where the two differ
-- (`Refrigerated`, `Dry Food`, `Prepared Meal`) the pantry's spelling wins, because
-- theirs is what gets typed into the portal.
--
-- D12 is retired, not overruled. Its reasoning — do not invent the far end's vocabulary
-- — held for exactly as long as the vocabulary was unknown.
--
-- MANY-TO-ONE IS THE EXPECTED CASE, NOT AN ANOMALY. 0012's own comment anticipated it
-- ("'Frozen Meat' and 'Frz Non Meat' may well collapse into one NTFB bucket") and 0013
-- confirmed Meal Connect prints two separate `Prepared Meals` lines on one receipt.
-- Deli and Frz Non Meat share BOTH the bucket AND the storage here, so the export emits
-- two `Prepared Meal / Frozen` lines for the same store on the same day. That is what
-- the sample receipt does, and it is why the export's `(ours)` column exists.
--
-- IDEMPOTENT, IN 0010'S EXACT STYLE. `pgmigrations` already runs this once per
-- database; the guards are for the case that predates it and for the case that follows
-- it — an operator who typed the NTFB list in by hand before this shipped, or an admin
-- who re-points a mapping afterwards. The insert is guarded on the TABLE being empty
-- (a launch seed, not a reconciler); each mapping is guarded on `ntfb_category_id IS
-- NULL`, so a later admin edit is never overwritten by a re-run.
--
-- Forward-only; no down migration (architecture.md §5.2).

-- Up Migration

-- The ten NTFB categories. `code` stays NULL: Meal Connect's entry form keys on the
-- name (0013), and the pantry gave names, not codes.
INSERT INTO ntfb_category (name)
SELECT name FROM (VALUES
  ('Meat'),
  ('Bread'),
  ('Produce'),
  ('Prepared Meal'),
  ('Dairy'),
  ('Dry Food'),
  ('Non-Food'),
  ('Pet Food'),
  ('Health & Beauty'),
  ('Trash')
) AS seed(name)
WHERE NOT EXISTS (SELECT 1 FROM ntfb_category);

-- All eleven mappings, plus the storage half of each line item (0013). Both columns
-- move together because they are one answer: a line is `(category, storage)`, and a
-- bucket set without its storage would still leave the reporter guessing one of the
-- form's four fields.
--
-- Matched by name, which is safe HERE and only here: this runs against categories 0010
-- seeded moments earlier under exactly these names. Nothing else in the codebase may
-- match a category by its literal name — an admin can rename one (I21 allows field
-- edits at any time), which is precisely why 0017 stores the trash key as a column.
UPDATE category AS c
SET ntfb_category_id = n.id,
    ntfb_storage     = m.storage
FROM (VALUES
  ('Frozen Meat',     'Meat',            'Frozen'),
  ('Bakery',          'Bread',           'Dry'),
  ('Produce',         'Produce',         'Refrigerated'),
  ('Deli',            'Prepared Meal',   'Frozen'),
  ('Dairy',           'Dairy',           'Refrigerated'),
  ('Dry',             'Dry Food',        'Dry'),
  ('Frz Non Meat',    'Prepared Meal',   'Frozen'),
  ('Non Food',        'Non-Food',        'Dry'),
  ('Pet',             'Pet Food',        'Dry'),
  ('Health & Beauty', 'Health & Beauty', 'Dry'),
  ('Trash',           'Trash',           'Dry')
) AS m(agfp, ntfb, storage)
JOIN ntfb_category AS n ON n.name = m.ntfb
WHERE c.name = m.agfp
  AND c.ntfb_category_id IS NULL;

-- The AGFP `Trash` category is ARCHIVED, on purpose (D27).
--
-- Trash is COMPUTED from here on — a per-receipt deduction off Bakery, Produce and
-- Deli, summed into one synthetic line (0017). If a receiver could also weigh food
-- INTO a Trash category, that weight would be counted once as itself and once again
-- inside the deduction, so the receipt would over-report trash and under-report
-- nothing. Archiving is the only thing that keeps the S2.2 keypad from offering the
-- tile at all.
--
-- It keeps its mapping — the computed line still reports as NTFB `Trash / Dry`, so the
-- row has to stay resolvable. §3.3's toggle is reversible from Admin if the pantry ever
-- decides otherwise, which is exactly why this is a soft-delete and not a DELETE.
--
-- Unlike the two statements above, this one is a ONE-TIME state change and not a
-- reconciler: its guard exists to avoid restamping `deactivated_at` on an already
-- archived row, not to defend a later reactivation. `pgmigrations` runs it exactly once
-- per database, which is the whole of what keeps an admin's re-activation safe — the
-- forward-only contract (architecture.md §5.2) is load-bearing here, so do not
-- hand-replay this file against a live database.
UPDATE category
SET deactivated_at = now()
WHERE name = 'Trash'
  AND deactivated_at IS NULL;
