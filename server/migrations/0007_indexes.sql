-- data-model.md §12, restricted to Phase-1 tables.
--
-- Omitted here because their tables are deferred to Phase 2 (build-plan D3):
--   ix_weight_active  ON weight_entry
--   ix_ud_confirmed   ON unscheduled_donation
-- Add them in the same migration that creates §7.

-- Up Migration

-- Active-only pickers (I21 masters): partial on the soft-delete predicate, so
-- the index only carries rows the pickers actually show.
CREATE INDEX ix_donor_active    ON donor    (id) WHERE deactivated_at IS NULL;
CREATE INDEX ix_category_active ON category (id) WHERE deactivated_at IS NULL;
CREATE INDEX ix_truck_active    ON truck    (id) WHERE deactivated_at IS NULL;
CREATE INDEX ix_route_active    ON route    (id) WHERE deactivated_at IS NULL;
CREATE INDEX ix_user_active     ON app_user (id) WHERE deactivated_at IS NULL;

-- Shift board + date-scoped queries
CREATE INDEX ix_shift_open  ON shift (occurrence_date) WHERE status = 'OPEN';
CREATE INDEX ix_shift_date  ON shift (occurrence_date);
CREATE INDEX ix_shift_owner ON shift (owner_id) WHERE owner_id IS NOT NULL;   -- "my shifts" + I20 overlap probes

-- Eligibility overlap probe (I20/§5.2). Btree is fine at this scale; revisit
-- with GiST on tstzrange only if availability volume grows.
CREATE INDEX ix_ab_user_window ON availability_block (user_id, starts_at, ends_at);

-- Inbox
CREATE INDEX ix_notif_unread ON notification (recipient_id, created_at) WHERE read_at IS NULL AND recipient_id IS NOT NULL;
CREATE INDEX ix_notif_device ON notification (subscription_id, created_at) WHERE subscription_id IS NOT NULL;

-- Push dispatch drain: "undelivered, oldest first" (architecture.md §4.4)
CREATE INDEX ix_notif_pending ON notification (created_at) WHERE delivered_at IS NULL;

-- FK indexes. Postgres does NOT auto-index foreign keys, and these are needed
-- both for joins and for the RESTRICT delete checks that carry I21.
CREATE INDEX ix_route_stop_route  ON route_stop (route_id);
CREATE INDEX ix_shift_route       ON shift (route_id);
CREATE INDEX ix_shift_pattern     ON shift (recurrence_pattern_id);
CREATE INDEX ix_shift_truck       ON shift (truck_id);
CREATE INDEX ix_shift_created_by  ON shift (created_by);
CREATE INDEX ix_shift_updated_by  ON shift (updated_by);
CREATE INDEX ix_shift_stop_shift  ON shift_stop (shift_id);
CREATE INDEX ix_rp_route          ON recurrence_pattern (route_id);
CREATE INDEX ix_rp_owner_default  ON recurrence_pattern (owner_default_id);
CREATE INDEX ix_rp_created_by     ON recurrence_pattern (created_by);
CREATE INDEX ix_session_user      ON session (user_id);
CREATE INDEX ix_session_device    ON session (device_id);
CREATE INDEX ix_push_user         ON push_subscription (user_id);
CREATE INDEX ix_push_device       ON push_subscription (device_id);
CREATE INDEX ix_notif_shift       ON notification (shift_id);

-- Dispatch reads live subscriptions only; a revoked one is skipped, never
-- deleted (architecture.md §4.4).
CREATE INDEX ix_push_live         ON push_subscription (id) WHERE revoked_at IS NULL;
