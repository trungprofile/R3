-- data-model.md §7 (Receive / intake), plus the two §12 indexes 0007 deferred.
--
-- This is the table half of `phase-1-build-plan.md` D3 ("migrate Phase-1 tables
-- only"), now due: Phase 2 is what D3 deferred these to. Nothing here is new
-- design — §7 is written out column-for-column and this migration transcribes it.
--
-- Forward-only; no down migration (architecture.md §5.2).

-- Up Migration

-- Deliberately absent from 0001, which said so in place: `donation_status`
-- belongs to §7 intake. SUGGESTED only ever originates from a driver-add (I17);
-- a receiver-authored donation is born CONFIRMED.
CREATE TYPE donation_status AS ENUM ('SUGGESTED', 'CONFIRMED');

-- §7.1 — planned intake. Grain is (Shift, Donor, Category) with MANY rows
-- allowed per grain (I13), which is what makes "add another weight to Produce"
-- an insert rather than a read-modify-write.
--
-- No shift_stop FK, on purpose: receiving is dock-side and decoupled from the
-- driver's per-stop check-off, and the donor need not appear in the snapshot at
-- all (off-route donor is allowed; the UI warns, the domain does not object).
--
-- Immutability (I13) is a service-layer guarantee, not a constraint: value
-- columns never change because no update path writes them. The only mutation is
-- voiding, false→true, once.
CREATE TABLE weight_entry (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id    uuid NOT NULL REFERENCES shift(id)    ON DELETE RESTRICT,
  donor_id    uuid NOT NULL REFERENCES donor(id)    ON DELETE RESTRICT,
  category_id uuid NOT NULL REFERENCES category(id) ON DELETE RESTRICT,
  weight      numeric(8,2) NOT NULL CHECK (weight >= 0),   -- lb, single unit
  voided      boolean NOT NULL DEFAULT false,              -- soft void (I13); excluded from every sum
  note        text,                                        -- per-row remark (domain-modeling.md §2.3, channel 5)
  created_by  uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,   -- I26
  updated_by  uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,   -- I26; void is the only update, so = the voider
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- §7.2 — unplanned intake, polymorphic donor. Source is FK XOR label XOR
-- neither(anon), and the discriminator is derived from which column is set,
-- never stored.
CREATE TABLE unscheduled_donation (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id      uuid REFERENCES shift(id)    ON DELETE RESTRICT,  -- 0..1: driver-add on a run; NULL for a walk-in
  donor_id      uuid REFERENCES donor(id)    ON DELETE RESTRICT,
  donor_label   text,                                             -- free text; never auto-creates a master Donor
  category_id   uuid NOT NULL REFERENCES category(id) ON DELETE RESTRICT,
  weight        numeric(8,2) CHECK (weight IS NULL OR weight >= 0),  -- NULL while SUGGESTED; required on CONFIRMED
  status        donation_status NOT NULL DEFAULT 'SUGGESTED',
  reportable    boolean NOT NULL DEFAULT true,                    -- I15; receiver-editable in window, then Reporter-only
  received_date date NOT NULL,                                    -- §8 grouping anchor; service-set, never a client value
  note          text,
  created_by    uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,  -- I26
  updated_by    uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,  -- I26
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_ud_source_exclusive CHECK (donor_id IS NULL OR donor_label IS NULL),
  -- I16(a): CONFIRMED ⇒ weight present. Unconditional — metrics union every
  -- CONFIRMED row regardless of `reportable`, so a weightless one corrupts the total.
  CONSTRAINT ck_ud_confirmed_weight CHECK (status <> 'CONFIRMED' OR weight IS NOT NULL),
  -- I16(b): CONFIRMED ∧ reportable ⇒ source present. NTFB needs an attributable
  -- store; an unreported walk-in does not.
  CONSTRAINT ck_ud_i16b_source CHECK (
    NOT (status = 'CONFIRMED' AND reportable)
    OR  (donor_id IS NOT NULL OR donor_label IS NOT NULL)
  )
);

-- The two §12 indexes 0007 named and deferred to this migration.
--
-- ix_weight_active carries both halves of receiving: the WEIGHED-EXISTS
-- projection (I12 — does a non-voided row exist for this shift+donor?) and the
-- per-(shift,donor) SUM-on-read. Partial on `voided = false` because every
-- reader excludes voided rows, so the index should not carry them either.
CREATE INDEX ix_weight_active ON weight_entry (shift_id, donor_id) WHERE voided = false;

-- CONFIRMED serves metrics; the report adds `reportable` on top of it (§8).
CREATE INDEX ix_ud_confirmed ON unscheduled_donation (received_date, category_id) WHERE status = 'CONFIRMED';

-- FK indexes. Postgres does not auto-index foreign keys, and I21's soft-delete
-- predicate now RESTRICT-checks against both tables — this is exactly the cost
-- D3 said to pay deliberately.
--
-- weight_entry's (shift_id, donor_id) pair is covered by ix_weight_active above,
-- per §12's "donor-bearing FKs are covered by the partial indexes". `updated_by`
-- is indexed alongside `created_by` even though §12 lists only the latter:
-- userHasHistory probes both stamps, and 0007 already made the same call for
-- shift (ix_shift_updated_by).
CREATE INDEX ix_weight_category   ON weight_entry (category_id);
CREATE INDEX ix_weight_created_by ON weight_entry (created_by);
CREATE INDEX ix_weight_updated_by ON weight_entry (updated_by);
CREATE INDEX ix_ud_shift          ON unscheduled_donation (shift_id);
CREATE INDEX ix_ud_donor          ON unscheduled_donation (donor_id);
CREATE INDEX ix_ud_category       ON unscheduled_donation (category_id);
CREATE INDEX ix_ud_created_by     ON unscheduled_donation (created_by);
CREATE INDEX ix_ud_updated_by     ON unscheduled_donation (updated_by);

-- The I17 sweep asks "which SUGGESTED rows are past their shift's edit window?"
-- and the daily job is the only reader, but without this it is a seq scan over
-- the whole intake table for a query that should touch a handful of rows.
CREATE INDEX ix_ud_suggested ON unscheduled_donation (shift_id) WHERE status = 'SUGGESTED';
