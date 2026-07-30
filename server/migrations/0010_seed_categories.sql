-- Seed the 11 AGFP categories — the half of cap 17 that was never built.
--
-- THE GAP. `product-requirement.md` cap 17 says categories are "Seeded with the 11
-- AGFP categories at launch; not a fixed enum", and `ui-ux-spec.md` says it twice
-- more (S1.8, and S2.2 which names all eleven). Nothing did it. The names appeared
-- in exactly one place in the repo — `server/test/masters-category.test.ts`, where
-- the test creates them itself to prove the table holds them as ordinary rows. That
-- test passes against an empty database, which is why four green gates never caught
-- it, and why `phase-1-state.md` recorded cap 17 as built.
--
-- WHAT IT COST. A fresh box comes up with an empty category list: the S1.8 Categories
-- tab shows its "No categories yet" empty state, and S2.2's weight-entry keypad —
-- which renders from live active-category rows, not a hardcoded list — would come up
-- with no tiles at all in Phase 2. Found by the first UI pass ever run against a
-- rendered screen.
--
-- WHY A MIGRATION. No foundation doc says where launch seed data lives. A migration
-- is the only path that reaches every database the same way: it runs on the box at
-- deploy, on a rehearsal, and on the dev DB (`scripts/dev.sh` migrates every boot),
-- so the seed cannot be something one environment has and another silently lacks.
-- `scripts/dev-seed.ts` was the alternative and is the wrong home — it is dev-only,
-- and it TRUNCATEs `category`, so a seed living there would never exist in production.
--
-- Guarded on the table being empty rather than on each name, because this is a launch
-- seed, not a reconciler. `pgmigrations` already makes it run once per database; the
-- guard is for the case that predates it — an operator who added categories by hand
-- before this shipped should keep exactly what they typed, not have eleven rows land
-- underneath. Names are `ui-ux-spec.md §S2.2` verbatim, "Frz Non Meat" included.
-- They are ordinary rows from here on: renameable, archivable, deletable under I21.

-- Up Migration

INSERT INTO category (name)
SELECT name FROM (VALUES
  ('Frozen Meat'),
  ('Bakery'),
  ('Produce'),
  ('Deli'),
  ('Dairy'),
  ('Dry'),
  ('Frz Non Meat'),
  ('Non Food'),
  ('Pet'),
  ('Health & Beauty'),
  ('Trash')
) AS seed(name)
WHERE NOT EXISTS (SELECT 1 FROM category);
