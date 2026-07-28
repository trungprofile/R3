-- data-model.md §0 (conventions), §1 (enums), §2 (app_config)
-- Forward-only; no down migration (architecture.md §5.2).

-- Up Migration

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid(); §0

-- §1. Native enums, not lookup tables: an enum makes an invalid state
-- unrepresentable rather than merely unreferenced. Cost accepted: adding a
-- value later is an ALTER TYPE.
-- `donation_status` is deliberately absent — it belongs to §7 intake, deferred
-- to Phase 2 (phase-1-build-plan.md D3).
CREATE TYPE tier                  AS ENUM ('VOLUNTEER', 'STAFF', 'ADMIN');   -- I1, hierarchical V ⊂ S ⊂ A
CREATE TYPE duty                  AS ENUM ('DRIVE', 'RECEIVE', 'REPORT');    -- I2
CREATE TYPE shift_status          AS ENUM ('OPEN','CLAIMED','IN_PROGRESS','COMPLETED','CANCELLED'); -- I7; MISSED derived
CREATE TYPE shiftstop_disposition AS ENUM ('PENDING','COLLECTED','SKIPPED','REASSIGNED');           -- WEIGHED derived (I12)

-- §2. Singleton config. `horizon_days` and `timezone` are system config, not
-- domain fields (domain-modeling.md §5.3) — changeable without redeploy.
-- Session lifetimes are handed here by architecture.md §4.2.
CREATE TABLE app_config (
  id                        boolean PRIMARY KEY DEFAULT true CHECK (id),   -- only one row
  timezone                  text    NOT NULL DEFAULT 'America/Chicago',    -- IANA zone, DST-aware. NEVER a fixed offset.
  horizon_days              integer NOT NULL DEFAULT 365 CHECK (horizon_days > 0),
  receiver_edit_window_days integer NOT NULL DEFAULT 7   CHECK (receiver_edit_window_days > 0),

  -- architecture.md §4.2 session lifetimes. Values are fixed by that doc; the
  -- key names are this migration's (phase-1-state.md A3).
  session_idle_shared_minutes           integer NOT NULL DEFAULT 30 CHECK (session_idle_shared_minutes > 0),
  session_absolute_shared_hours         integer NOT NULL DEFAULT 12 CHECK (session_absolute_shared_hours > 0),
  session_idle_personal_volunteer_days  integer NOT NULL DEFAULT 30 CHECK (session_idle_personal_volunteer_days > 0),
  session_idle_personal_staff_days      integer NOT NULL DEFAULT 7  CHECK (session_idle_personal_staff_days > 0),

  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO app_config (id) VALUES (true);
