-- data-model.md §5 (Route, RouteStop, RecurrencePattern, Shift)

-- Up Migration

CREATE TABLE route (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  deactivated_at timestamptz,   -- ACTIVE ⇄ ARCHIVED: hidden from the route picker (S1.6)
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE route_stop (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL REFERENCES route(id) ON DELETE RESTRICT,
  donor_id uuid NOT NULL REFERENCES donor(id) ON DELETE RESTRICT,
  position integer NOT NULL,     -- contiguous; reorder renumbers (routes are ~8 stops, fractional ranks buy nothing)
  CONSTRAINT uq_route_stop_donor UNIQUE (route_id, donor_id),   -- I28, template side
  -- DEFERRABLE: a drag-and-drop reorder rewrites several rows in one txn, so
  -- transient position collisions mid-transaction are legal and the constraint
  -- is checked at commit.
  CONSTRAINT uq_route_stop_position UNIQUE (route_id, position) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE recurrence_pattern (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id   uuid NOT NULL REFERENCES route(id) ON DELETE RESTRICT,
  weekdays   smallint[] NOT NULL,   -- ISO dow 1..7
  -- LOCAL wall-clock, converted to instants only at materialization via
  -- app_config.timezone. Storing an instant here would drift across DST.
  start_time time NOT NULL,
  end_time   time NOT NULL,
  -- The ONLY stop condition (domain-modeling.md §5.3). There is deliberately no
  -- separate active/paused flag: a second switch would be redundant and could
  -- disagree with this one. Pausing means writing today into end_date.
  end_date   date,
  owner_default_id uuid REFERENCES app_user(id) ON DELETE RESTRICT,   -- "claim all future" target
  -- Physical addition beyond I26's named set. It exists solely to source the
  -- minted-shift author: the materialization job has no logged-in user, and
  -- data-model.md §5.3 forbids a system user.
  created_by uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_rp_weekdays CHECK (array_length(weekdays,1) >= 1
                                   AND weekdays <@ ARRAY[1,2,3,4,5,6,7]::smallint[]),
  CONSTRAINT ck_rp_window   CHECK (end_time > start_time)   -- intra-day only; a midnight-crossing run is two patterns
);

CREATE TABLE shift (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recurrence_pattern_id uuid REFERENCES recurrence_pattern(id) ON DELETE RESTRICT,  -- NULL = one-off
  route_id              uuid NOT NULL REFERENCES route(id)     ON DELETE RESTRICT,  -- I4, bound at schedule time
  occurrence_date       date        NOT NULL,
  starts_at             timestamptz NOT NULL,
  ends_at               timestamptz NOT NULL,
  status                shift_status NOT NULL DEFAULT 'OPEN',
  owner_id              uuid REFERENCES app_user(id) ON DELETE RESTRICT,   -- NULL while OPEN
  truck_id              uuid REFERENCES truck(id)    ON DELETE RESTRICT,   -- NULL before IN_PROGRESS (I8)
  pickup_completed_at   timestamptz,                 -- I27 handoff milestone; its gate is service-layer
  note                  text,                        -- driver-authored, whole run (cap 11, channel 3)
  staff_note            text,                        -- coordinator→driver, staff-authored (cap 11, channel 1)
  created_by uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,     -- = pattern.created_by for minted shifts
  updated_by uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,     -- I26, last writer only
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Idempotency: this is what makes the rolling materialization sweep safe to
  -- re-run (ON CONFLICT DO NOTHING). One-offs have a NULL pattern id, and PG's
  -- default NULLS DISTINCT lets many one-offs share a date. Do NOT change this
  -- to NULLS NOT DISTINCT.
  CONSTRAINT uq_shift_occurrence UNIQUE (recurrence_pattern_id, occurrence_date),
  CONSTRAINT ck_shift_window CHECK (ends_at > starts_at),
  CONSTRAINT ck_shift_truck  CHECK (truck_id IS NULL OR status IN ('IN_PROGRESS','COMPLETED')),   -- I8
  -- I7 / domain-modeling.md §2.2 (LOCKED). Cancel clears owner_id in the same
  -- UPDATE; the bumped driver's identity is not retained on the row.
  CONSTRAINT ck_shift_owner CHECK (
       (status = 'OPEN'                                 AND owner_id IS NULL)
    OR (status IN ('CLAIMED','IN_PROGRESS','COMPLETED') AND owner_id IS NOT NULL)
    OR (status = 'CANCELLED'                            AND owner_id IS NULL)
  )
);
