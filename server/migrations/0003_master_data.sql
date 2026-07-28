-- data-model.md §4 (Donor, Category, Truck)
--
-- Hard-delete is attempted as a real DELETE; FK-RESTRICT from every child
-- (including provenance stamps) blocks it iff history exists. That restrict IS
-- the I21 history guard — there is no stored "has history" flag, and app-level
-- reference counting exists only for friendly error text.

-- Up Migration

CREATE TABLE donor (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name    text NOT NULL,
  -- address/contact are operational data drivers need on the road. They are NOT
  -- PII in this system's sense (which is phone/address on app_user) and must not
  -- be trimmed on the way out.
  address text,
  contact text,                 -- free-text: phone/email/person, no fixed shape
  note    text,                 -- permanent per-store note, admin-authored (cap 11, channel 4)
  deactivated_at timestamptz,   -- ACTIVE ⇄ DEACTIVATED
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE category (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  deactivated_at timestamptz,   -- ACTIVE ⇄ ARCHIVED: hidden from new entry, preserved in history
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- No exclusivity invariant (I22): double-booking one truck across concurrent
-- shifts is allowed, so nothing ties a truck to a time window.
CREATE TABLE truck (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  truck_name     text NOT NULL,
  plate          text,          -- optional
  deactivated_at timestamptz,   -- ACTIVE ⇄ INACTIVE: hidden from driver selection
  created_at     timestamptz NOT NULL DEFAULT now()
);
