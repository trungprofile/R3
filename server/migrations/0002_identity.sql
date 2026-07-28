-- data-model.md §3 (identity & access), with the credential/PII columns that
-- §3 defers to architecture.md §4.2.

-- Up Migration

CREATE TABLE app_user (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username   text NOT NULL,          -- lowercase [a-z0-9], non-empty (I3)
  tier       tier NOT NULL,          -- I1

  -- Name is NOT PII: it is public-within-org by design, shown on the shared
  -- login screen and the shift board (product-requirement.md §2). Split into
  -- first/last because domain-modeling.md §5.1 generates usernames from
  -- generate_username(first, last). See phase-1-state.md A2.
  first_name text NOT NULL,
  last_name  text NOT NULL,

  -- PII (architecture.md §4.3): visible only when viewer.tier >= STAFF or
  -- viewer.id == subject.id. Gated on the way out by server/src/pii.ts, which
  -- is the sole path by which a user record reaches a response.
  phone   text,
  address text,

  -- Credential: PIN hash for Volunteer, password hash for Staff/Admin
  -- (architecture.md §4.2). A 4-digit space cannot be made strong by hashing;
  -- the hash limits damage from database disclosure, throttling limits online
  -- guessing. PINs are NOT unique and uniqueness is never checked.
  credential_hash text NOT NULL,

  deactivated_at timestamptz,        -- NULL = active (§0 soft-delete pattern, I21)
  created_at     timestamptz NOT NULL DEFAULT now(),

  -- Spans deactivated users: a handle stays reserved, no reuse, no renumber
  -- (I3). §5.1's generator checks the full assembled string against this and
  -- retries on conflict.
  CONSTRAINT uq_user_username UNIQUE (username),
  CONSTRAINT ck_user_username CHECK  (username ~ '^[a-z0-9]+$')
);

-- I2: 0..3 duties per user. A junction, not a column set — duties are orthogonal
-- to tier and a user holds any subset.
CREATE TABLE user_duty (
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  duty    duty NOT NULL,
  PRIMARY KEY (user_id, duty)
);
