-- The Trash column on the paper Retail Rescue Log, as data (D27).
--
-- WHAT THE PAPER SHEET DOES. A fraction of what comes off the truck is not fit to
-- distribute, and the pantry does not weigh it — they deduct a standing percentage from
-- three categories and report the sum as NTFB's `Trash`. One real sheet reconciles
-- exactly, which is why this is implementable rather than approximate:
--
--     gross    827 Bakery   3691 Produce    53 Deli
--     rate     10%           10%           15%
--     deduct   −83          −369           −8      = 460  → the boxed Trash figure
--     net      744          3322           45
--
-- The deduction MOVES weight, it does not remove it: `net + trash = gross`, and Trash
-- is itself a reported NTFB category, so the reported total is unchanged. That property
-- is what makes this safe to add to a report that already reconciles.
--
-- This migration is the STORAGE half only. The arithmetic — the rounding order, which
-- is load-bearing — belongs to `services/report.ts` and is documented as a named
-- algorithm in `domain-modeling.md`.
--
-- WHY THE RATES ARE PER STORE. Bakery and deli waste rates are a property of how a
-- given retailer packs and holds food, and the pantry already runs two exceptions
-- (Sam's Club and Costco produce at 10%). NULL on a donor means "use the pantry
-- default", so adding a store requires no decision and changing the default reaches
-- every store that never made one.
--
-- NO PER-DONOR OVERRIDE IS SEEDED HERE. Sam's Club and Costco are the two known
-- exceptions, but NEITHER STORE EXISTS in the seed data — writing rows for them would
-- be inventing donors to hang a rate on. The override is entered in Admin when the
-- stores are added, which is also the first moment anyone can confirm the rate is still
-- current.
--
-- Forward-only; no down migration (architecture.md §5.2).

-- Up Migration

-- The pantry-wide defaults, on the singleton beside the `ntfb_*` identifiers 0013 put
-- there. Defaulted rather than left null for the same reason `timezone` is: this repo
-- is one pantry's system of record and its standing rates are configuration.
--
-- `numeric(5,4)` — a rate, not a percentage, so 0.1000 is 10%. Four decimal places
-- because a rate quoted as 12.5% has to survive storage, and the range CHECK is what
-- keeps the extra integer digit `numeric(5,4)` technically allows from ever holding a
-- 9.9999 that would deduct nine times the gross.
ALTER TABLE app_config
  ADD COLUMN trash_rate_bakery  numeric(5,4) NOT NULL DEFAULT 0.1000,
  ADD COLUMN trash_rate_produce numeric(5,4) NOT NULL DEFAULT 0.0500,
  ADD COLUMN trash_rate_deli    numeric(5,4) NOT NULL DEFAULT 0.1500,
  ADD CONSTRAINT ck_config_trash_rates CHECK (
    trash_rate_bakery  BETWEEN 0 AND 1
    AND trash_rate_produce BETWEEN 0 AND 1
    AND trash_rate_deli    BETWEEN 0 AND 1
  );

-- The per-store override. NULL is the normal state and means "use the pantry default"
-- — deliberately not a copy of the default at insert time, because a copied value would
-- silently stop tracking a change to the default and nobody would be able to tell an
-- inherited rate from a deliberate one.
ALTER TABLE donor
  ADD COLUMN trash_rate_bakery  numeric(5,4),
  ADD COLUMN trash_rate_produce numeric(5,4),
  ADD COLUMN trash_rate_deli    numeric(5,4),
  ADD CONSTRAINT ck_donor_trash_rates CHECK (
    (trash_rate_bakery  IS NULL OR trash_rate_bakery  BETWEEN 0 AND 1)
    AND (trash_rate_produce IS NULL OR trash_rate_produce BETWEEN 0 AND 1)
    AND (trash_rate_deli    IS NULL OR trash_rate_deli    BETWEEN 0 AND 1)
  );

-- WHICH CATEGORIES ARE DEDUCTED IS DATA, NOT A NAME MATCH.
--
-- The obvious implementation is `WHERE category.name = 'Bakery'`. It is wrong, and
-- quietly so: I21 allows field edits on master data at any time, so an admin renaming
-- `Bakery` to `Bakery & Bread` would make the match stop firing — no error, no warning,
-- the deduction just silently becomes zero and the pantry over-reports to NTFB until
-- somebody re-derives the paper sheet by hand. A column survives the rename because it
-- travels with the row.
--
-- Three keys and not a boolean, because each names a DIFFERENT rate: the pantry runs
-- deli at 15% and the other two lower, and `Frz Non Meat` is deducted at NONE despite
-- sharing Deli's NTFB bucket. Only the three rates that exist are representable.
ALTER TABLE category
  ADD COLUMN trash_rate_key text
  CHECK (trash_rate_key IS NULL OR trash_rate_key IN ('BAKERY', 'PRODUCE', 'DELI'));

UPDATE category SET trash_rate_key = 'BAKERY'  WHERE name = 'Bakery';
UPDATE category SET trash_rate_key = 'PRODUCE' WHERE name = 'Produce';
UPDATE category SET trash_rate_key = 'DELI'    WHERE name = 'Deli';

-- LOAD-BEARING. Two ACTIVE categories carrying the same key would each take the full
-- deduction off their own gross and both feed the same synthetic Trash line, so the
-- pantry would report trash it never had and under-report two real categories. Nothing
-- in the computation can detect that state; making it unrepresentable is the fix
-- (`data-model.md §1`'s reasoning for native enums, same instinct).
--
-- Partial on `deactivated_at IS NULL` so an archived category does not hold its key
-- hostage: replacing `Bakery` means archiving the old row and pointing the key at the
-- new one, and the archived row keeps its key so historical rows still read correctly.
-- Same shape as `uq_donor_ntfb_code` (0013) and `uq_ntfb_name` (0012).
CREATE UNIQUE INDEX uq_category_trash_key
  ON category (trash_rate_key)
  WHERE trash_rate_key IS NOT NULL AND deactivated_at IS NULL;
