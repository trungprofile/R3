-- data-model.md §6 (ShiftStop snapshot), §10 (AvailabilityBlock)

-- Up Migration

-- Snapshot, not a pointer (I5/I6). Rows exist only from IN_PROGRESS onward,
-- created by copying the route's ordered RouteStops at start. The snapshot
-- freezes WHICH donors in WHAT order; donor_id stays a live FK so name and
-- address render current. Editing a Route never touches a started shift.
CREATE TABLE shift_stop (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES shift(id) ON DELETE RESTRICT,
  donor_id uuid NOT NULL REFERENCES donor(id) ON DELETE RESTRICT,
  position integer NOT NULL,     -- frozen at start, reorderable in-run
  -- The enum has no WEIGHED member on purpose: WEIGHED is a read-time
  -- projection over non-voided weight_entry rows (I12). A stored WEIGHED could
  -- pass the completion gate on a voided-then-abandoned weight.
  disposition shiftstop_disposition NOT NULL DEFAULT 'PENDING',
  note        text,              -- driver→receiver, this stop only (cap 11, channel 2)
  CONSTRAINT uq_shift_stop_donor    UNIQUE (shift_id, donor_id),   -- I28, shift side
  CONSTRAINT uq_shift_stop_position UNIQUE (shift_id, position) DEFERRABLE INITIALLY DEFERRED
);

-- Whole-person and time-only (I19). domain-modeling.md deliberately dropped the
-- PRD's route-scoped availability so eligibility stays a pure temporal overlap.
-- Adding route scope later is a change to the locked doc first, then here.
CREATE TABLE availability_block (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  starts_at timestamptz NOT NULL,
  ends_at   timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_ab_window CHECK (ends_at > starts_at)
);
