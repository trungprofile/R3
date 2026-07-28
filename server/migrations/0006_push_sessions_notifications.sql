-- data-model.md §11 (notification, push_subscription) + the session and device
-- tables that architecture.md §4.2 hands to the data model.
--
-- Order: device, then push_subscription, then session, then notification.

-- Up Migration

-- The enumerated shared devices (architecture.md §4.2). An admin registers the
-- receiver tablet and the reporter desktop; MEMBERSHIP IN THIS TABLE IS THE
-- SHARED-DEVICE MARKER, and anything unregistered is personal. That direction is
-- chosen deliberately: the set is small and fixed at two, so the unenumerated
-- default is the common case.
--
-- Session policy cannot hang off push_subscription instead, even though §4.2
-- binds the tablet's marker there: product-requirement.md §2 gives a
-- device-level push subscription to the tablet ONLY ("additionally holds"), and
-- no event in the notification matrix targets the reporter desktop. A desktop
-- would therefore never have a subscription row, would read as personal, and
-- would silently get a 7-day session on a machine in a shared room —
-- exactly the failure §4.2 exists to prevent.
CREATE TABLE device (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label      text NOT NULL,      -- "receiver tablet", "reporter desktop"
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE push_subscription (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Exactly one of user_id / device_id, per ck_push_owner below.
  --   user_id  set -> a person's own subscription (driver's phone)
  --   device_id set -> the device-level endpoint (receiver tablet, truck-inbound
  --                    only). A notification endpoint, not a login.
  --
  -- Keeping the tablet's device-level subscription bound to its `device` row
  -- preserves §4.2's security property: losing the marker also stops
  -- truck-inbound alerts, so a receiver notices within a day and one re-run of
  -- setup restores both. Security-relevant state that can degrade invisibly is
  -- bound to something operationally visible.
  user_id   uuid REFERENCES app_user(id) ON DELETE RESTRICT,
  device_id uuid REFERENCES device(id)   ON DELETE RESTRICT,
  endpoint  text NOT NULL,
  p256dh    text NOT NULL,
  auth      text NOT NULL,
  label     text,
  -- A 410 Gone from the push gateway means the subscription is dead
  -- (uninstalled, permission revoked) — the normal end of its life, not an
  -- error. It is REVOKED, not deleted: every FK here is ON DELETE RESTRICT
  -- (data-model.md §0), so a row referenced by any session or notification
  -- cannot be removed, and a hard delete would take the inbox history of which
  -- device an alert went to with it. Dispatch skips revoked rows. Same
  -- soft-delete shape as the I21 masters.
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_push_endpoint UNIQUE (endpoint),
  CONSTRAINT ck_push_owner CHECK (
    (user_id IS NOT NULL AND device_id IS NULL) OR
    (user_id IS NULL     AND device_id IS NOT NULL)
  )
);

-- architecture.md §4.2. Server-side sessions in Postgres, not JWT: nearly every
-- session requirement in the UI spec is a REVOCATION requirement (logout on the
-- shared tablet, idle timeout, admin deactivation, tier change), and a stateless
-- token satisfies none of them without reissue-per-request.
CREATE TABLE session (
  id      text PRIMARY KEY,      -- opaque random token; the cookie value
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  -- Which device this session runs on, and therefore its lifetime policy.
  -- Devices are MARKED, not detected: a user-agent string is forgeable and
  -- cannot distinguish the pantry tablet from a volunteer's phone.
  --   NOT NULL -> registered shared device: 30 min idle, 12 h absolute cap
  --   NULL     -> unregistered, i.e. personal: 30 d rolling (Volunteer),
  --               7 d rolling (Staff/Admin), no absolute cap
  device_id    uuid REFERENCES device(id) ON DELETE RESTRICT,
  created_at   timestamptz NOT NULL DEFAULT now(),   -- absolute-cap anchor
  last_seen_at timestamptz NOT NULL DEFAULT now(),   -- idle-timeout anchor, slid each authenticated request
  expires_at   timestamptz NOT NULL                  -- resolved expiry, whichever of idle/absolute binds first
);

-- The notification table IS the outbox (architecture.md §4.4): the row is
-- written INSIDE the business transaction, the push dispatched OUTSIDE it,
-- because write transactions run SERIALIZABLE with retry and a retried
-- transaction would re-send.
CREATE TABLE notification (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id    uuid REFERENCES app_user(id) ON DELETE RESTRICT,          -- NULL = device-scoped (truck-inbound only, Phase 2)
  subscription_id uuid REFERENCES push_subscription(id) ON DELETE RESTRICT, -- set when recipient_id IS NULL
  event           text NOT NULL,                    -- taxonomy owned by the notifications doc
  -- A real FK, not a payload key: it is both the inbox deep-link anchor (S1.9
  -- "tap to act") and the dedupe key for uq_notif_shift_event below.
  shift_id        uuid REFERENCES shift(id) ON DELETE RESTRICT,
  payload         jsonb NOT NULL DEFAULT '{}',
  read_at         timestamptz,                      -- NULL = unread; the in-app inbox is the source of truth
  delivered_at    timestamptz,                      -- NULL = push not yet delivered. Inbox delivery never depends on this.
  attempts        integer NOT NULL DEFAULT 0,       -- give up after a cap; push is best-effort
  last_attempt_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_notif_recipient CHECK (
    (recipient_id IS NOT NULL AND subscription_id IS NULL) OR
    (recipient_id IS NULL     AND subscription_id IS NOT NULL)
  )
);

-- Send-idempotency for catch-up sweeps. Time-based jobs ask "what is due and
-- unsent", so a delayed or repeated run must not re-send. Enforced as a
-- constraint rather than by job discipline — this is what demotes a missed tick
-- from a lost notification to a slightly late one. Only shift-scoped,
-- time-triggered events need it; event-triggered ones fire once by construction.
CREATE UNIQUE INDEX uq_notif_shift_event ON notification (event, shift_id, recipient_id)
  WHERE shift_id IS NOT NULL AND recipient_id IS NOT NULL;
