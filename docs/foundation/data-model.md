# R3 — Data Model

**Purpose.** Physical PostgreSQL schema for R3: concrete types, nullability, constraints, and indexes that *enforce* the locked domain model (`domain-modeling.md`, I1–I30) at the storage layer, plus the concerns `Domain Modeling` explicitly punts here: concurrency/optimistic locking, soft-delete mechanics, the polymorphic `Donor` FK + free-text label, and the `horizon` config. Owns *how data is stored and constrained*. Defers full PII/credential attributes and the `session` table (→ `architecture.md` §4.2), report and metric definitions (→ reporting doc, deferred), and notification delivery mechanics (→ notifications doc, deferred).

Reconciled against `domain-modeling.md` (locked) and the PRD. Invariant citations (I#) are verified against `Domain Modeling §4`.

---

## 0. Conventions (apply to every table; not restated per-table)

- **PK:** `uuid PRIMARY KEY DEFAULT gen_random_uuid()` (pgcrypto / PG ≥13).  
- **Instants:** every point in time is `timestamptz`. No naive `timestamp`, no stored UTC offsets. Pantry-local rendering is a presentation concern.  
- **Local wall-clock** (recurrence rule times) stored as `time`/`date`, converted to instants only at materialization via `app_config.timezone`.  
- **Naming:** snake_case; `app_user` not `user` (reserved word).  
- **Extensions:** `pgcrypto` (uuid). (No `citext` — usernames are forced lowercase, see §3.)  
- **Soft-delete pattern (masters Donor/Category/Truck/User, per I21):** `deactivated_at timestamptz`, `NULL = active`. One physical bit for the ACTIVE⇄{ARCHIVED|INACTIVE|DEACTIVATED} toggles in `Domain Modeling §3.3` (the labels are UI-only). Active reads filter `WHERE deactivated_at IS NULL`. Field edits always allowed; soft-delete governs removal only.  
- **Provenance pattern (I26):** `created_by` / `updated_by uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT`. Last-writer only; real FKs, never loose ids.  
- **FK-RESTRICT pattern:** *every* FK is `ON DELETE RESTRICT`. This restrict **is** the I21 history guard: a hard `DELETE` of a master succeeds iff zero rows reference it, else fails at the DB. App-level reference-counting is only for friendly error text, not correctness.  
- **State-machine guards are NOT CHECKs.** Per-row CHECKs enforce state↔column coupling. Transition legality (I9 cancel-guard, I10 terminal, I11 completion-only-via-receiver, I12 completion gate) depends on the *prior* state and lives in the service layer via the conditional-UPDATE predicates in §9.

---

## 1. Enum types (native PG)

Value-sets transcribed from `Domain Modeling` and the PRD; verified.

```sql
CREATE TYPE tier                  AS ENUM ('VOLUNTEER', 'STAFF', 'ADMIN');            -- I1, hierarchical (V ⊂ S ⊂ A)
CREATE TYPE duty                  AS ENUM ('DRIVE', 'RECEIVE', 'REPORT');             -- I2
CREATE TYPE shift_status          AS ENUM ('OPEN','CLAIMED','IN_PROGRESS','COMPLETED','CANCELLED'); -- I7; MISSED is derived, not stored
CREATE TYPE shiftstop_disposition AS ENUM ('PENDING','COLLECTED','SKIPPED','REASSIGNED'); -- WEIGHED is derived (I12), never stored; REASSIGNED is terminal (I30)
CREATE TYPE donation_status       AS ENUM ('SUGGESTED','CONFIRMED');                  -- Domain Modeling §2.3
```

Native enums rather than lookup tables. Tradeoff accepted: adding or renaming a state later needs `ALTER TYPE ... ADD VALUE`. Fine — these sets are domain-locked, and an enum makes an invalid state unrepresentable rather than merely unreferenced.

---

## 2. `app_config` — system config (singleton)

```sql
CREATE TABLE app_config (
  id            boolean PRIMARY KEY DEFAULT true CHECK (id),           -- singleton: only one row (id=true)
  timezone      text    NOT NULL DEFAULT 'America/Chicago',            -- IANA zone, DST-aware. NEVER a fixed offset.
  horizon_days  integer NOT NULL DEFAULT 365 CHECK (horizon_days > 0), -- recurrence materialization horizon (ops knob)
  receiver_edit_window_days integer NOT NULL DEFAULT 7 CHECK (receiver_edit_window_days > 0), -- Domain Modeling §3.1 "N days"
  updated_at    timestamptz NOT NULL DEFAULT now()
);
```

`horizon` and `timezone` are **system config, not domain fields** (`Domain Modeling §5.3`): changeable without redeploy, auditable. `receiver_edit_window_days` is the `N` from the completion model (`Domain Modeling §3.1`): window after which receiver edits become Reporter-only and lingering `SUGGESTED` rows are purged. `RecurrencePattern.end_date` (domain) is separate from `horizon_days` (system).

---

## 3. Identity & access

```sql
CREATE TABLE app_user (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username       text NOT NULL,                    -- lowercase [a-z0-9], non-empty (I3)
  tier           tier NOT NULL,                     -- I1
  -- credential (PIN hash for Volunteer / password hash for Staff+Admin) and PII (phone, address — NOT name, which is public-within-org and shown on login/board to everyone)
  -- are owned by `architecture.md` §4.2. PIN defaults to last 4 of phone, is NOT unique, and is never force-changed (Architecture §4.2). NOT modeled here.
  deactivated_at timestamptz,                        -- NULL = active
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_username   UNIQUE (username),                    -- spans deactivated users (I3: reserved, no reuse)
  CONSTRAINT ck_user_username   CHECK  (username ~ '^[a-z0-9]+$')     -- lowercase alnum, non-empty
);

CREATE TABLE user_duty (
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  duty    duty NOT NULL,
  PRIMARY KEY (user_id, duty)                        -- 0..3 duties per user (I2); junction, not a column set
);
```

- `username` uniqueness is enforced at the DB (`uq_user_username`) and **includes deactivated users** (I3 / `Domain Modeling §5.1`): a freed username is not reused, handles stay reserved. The §5.1 generation algorithm checks the full assembled string against this constraint and **retries on conflict** (the concurrency hook `Domain Modeling §5.1` defers here).  
- **Immutability** of `username` (I3) is service-layer (no update path); optionally a trigger blocking `username` UPDATE.

---

## 4. Master data — Donor, Category, Truck

Full attributes in `Domain Modeling`/PRD. Only lifecycle + load-bearing columns here.

```sql
CREATE TABLE donor (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  address        text,
  contact        text,                                -- free-text: phone/email/contact person, no fixed shape
  note           text,                                -- Donor.note: permanent per-store note (PRD cap 11, admin-authored)
  deactivated_at timestamptz,                        -- ACTIVE ⇄ DEACTIVATED (Domain Modeling §3.3)
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE category (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,                       -- required for admin-managed master data
  deactivated_at timestamptz,                        -- ACTIVE ⇄ ARCHIVED (Domain Modeling §3.3)
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE truck (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  truck_name     text NOT NULL,
  plate          text,                               -- optional (Domain Modeling §2.3)
  deactivated_at timestamptz,                        -- ACTIVE ⇄ INACTIVE; inactive hidden from driver selection
  created_at     timestamptz NOT NULL DEFAULT now()
);
```

Hard-delete is attempted as a real `DELETE`; FK-RESTRICT from all children (incl. provenance stamps) blocks it iff history exists (I21). No stored "has history" flag. **No truck exclusivity** (I22): double-booking a truck across concurrent shifts is allowed, so no unique constraint ties a truck to a time window.

---

## 5. Scheduling — Route, RouteStop, RecurrencePattern, Shift

### 5.1 Route + RouteStop (template)

```sql
CREATE TABLE route (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  deactivated_at timestamptz,                        -- archive toggle (extends Domain Modeling §3.3)
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Lifecycle (Domain Modeling §3.3, Route row): archive via deactivated_at (soft), OR hard-delete
-- when nothing references it (FK-RESTRICT lets it through). Same pattern as the I21 masters.

CREATE TABLE route_stop (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL REFERENCES route(id) ON DELETE RESTRICT,
  donor_id uuid NOT NULL REFERENCES donor(id) ON DELETE RESTRICT,
  position integer NOT NULL,                                       -- contiguous integer order; reorder renumbers the route (~8 stops, so fractional ranks buy nothing)
  CONSTRAINT uq_route_stop_donor    UNIQUE (route_id, donor_id),               -- I28 (template side): ≤1 stop per donor
  CONSTRAINT uq_route_stop_position UNIQUE (route_id, position) DEFERRABLE INITIALLY DEFERRED
);
```

`position` UNIQUE is **deferrable**: a reorder rewrites several rows in one txn (transient collisions allowed mid-txn, checked at commit). Renumber-in-txn; no fractional index (routes are tiny).

### 5.2 RecurrencePattern

```sql
CREATE TABLE recurrence_pattern (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id         uuid NOT NULL REFERENCES route(id) ON DELETE RESTRICT,
  weekdays         smallint[] NOT NULL,              -- ISO dow 1..7; job iterates these
  start_time       time NOT NULL,                     -- LOCAL wall-clock; -> instant at materialization via app_config.timezone
  end_time         time NOT NULL,
  end_date         date,                              -- domain field; NULL = open-ended (Domain Modeling §5.3)
  owner_default_id uuid REFERENCES app_user(id) ON DELETE RESTRICT,  -- "claim all future" target; NULL = none
  created_by       uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,  -- pattern author; physical add beyond I26
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_rp_weekdays CHECK (array_length(weekdays,1) >= 1
                                   AND weekdays <@ ARRAY[1,2,3,4,5,6,7]::smallint[]),
  CONSTRAINT ck_rp_window   CHECK (end_time > start_time)  -- intra-day only, no overnight pickups (Domain Modeling §5.3)
);
```

`created_by` is a **physical addition beyond I26's named set** (which lists only WeightEntry/UnscheduledDonation/Shift). It exists solely to source the minted-shift author: the materialization job has no logged-in user, so a recurring shift inherits its `created_by` from whoever authored the pattern.

### 5.3 Shift (materialized instance, or one-off)

```sql
CREATE TABLE shift (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recurrence_pattern_id uuid REFERENCES recurrence_pattern(id) ON DELETE RESTRICT,  -- NULL = one-off
  route_id              uuid NOT NULL REFERENCES route(id)     ON DELETE RESTRICT,  -- I4: bound at schedule time
  occurrence_date       date  NOT NULL,                        -- calendar slot (pantry-local date)
  starts_at             timestamptz NOT NULL,                  -- instant
  ends_at               timestamptz NOT NULL,
  status                shift_status NOT NULL DEFAULT 'OPEN',
  owner_id              uuid REFERENCES app_user(id) ON DELETE RESTRICT,  -- NULL while OPEN; may be set at birth (born-CLAIMED)
  truck_id              uuid REFERENCES truck(id)    ON DELETE RESTRICT,  -- NULL before IN_PROGRESS (I8)
  pickup_completed_at   timestamptz,                           -- I27 handoff milestone; gate is service-layer
  note                  text,                                  -- Shift.note: one run-level note, driver-authored (Domain Modeling §2.3)
  staff_note            text,                                  -- coordinator→driver note, staff-authored, shown on driver's shift detail (PRD cap 11)
  created_by            uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,  -- = recurrence_pattern.created_by for minted shifts
  updated_by            uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_shift_occurrence UNIQUE (recurrence_pattern_id, occurrence_date),  -- idempotency: what makes the materialization sweep safe to re-run
  CONSTRAINT ck_shift_window     CHECK (ends_at > starts_at),
  CONSTRAINT ck_shift_truck      CHECK (truck_id IS NULL OR status IN ('IN_PROGRESS','COMPLETED')),  -- I8
  CONSTRAINT ck_shift_owner      CHECK (                                           -- I7 / Domain Modeling §2.2 (LOCKED)
       (status = 'OPEN'                                  AND owner_id IS NULL)
    OR (status IN ('CLAIMED','IN_PROGRESS','COMPLETED')  AND owner_id IS NOT NULL)
    OR (status = 'CANCELLED'                             AND owner_id IS NULL)      -- Domain Modeling §2.2: owner cleared on cancel
  )
);
```

**owner-on-cancel (LOCKED, per `Domain Modeling §2.2`):** cancel clears `owner_id` in the same UPDATE. The prior owner's identity is **not** retained on the row (`updated_by` is the canceller, possibly staff). If "which driver was bumped" is ever needed for analytics it must come from the notification log or an audit trail, not `shift`. CANCELLED is excluded from MISSED/NO_SHOW (`Domain Modeling §3.1`).

**Materialization provenance:** a minted shift's `created_by = recurrence_pattern.created_by`. No system user. Minted-vs-one-off = `recurrence_pattern_id IS NOT NULL`.

**Idempotency:** `uq_shift_occurrence` makes the rolling job safe under retry/overlap. Job inserts `ON CONFLICT (recurrence_pattern_id, occurrence_date) DO NOTHING`. One-offs have `recurrence_pattern_id = NULL`; PG default **NULLS DISTINCT** lets multiple one-offs share a date. **Do not** use `NULLS NOT DISTINCT`.

**Born-CLAIMED (I25):** at insert the job may set `owner_id = pattern.owner_default_id` *iff* `eligible()` holds for that instance (`Domain Modeling §5.2`/§5.3), else `owner_id` NULL / status OPEN. The eligibility check is service/job-layer.

**Duplicate-run identity is a SOFT check, NOT a constraint:**

```
real_conflict(new) := ∃ shift S, S.occurrence_date = new.occurrence_date
                      ∧ S.status <> 'CANCELLED'
                      ∧ S.starts_at = new.starts_at ∧ S.ends_at = new.ends_at
                      ∧ stop_set(S) = stop_set(new)            -- donor-id SET, order-insensitive
                      ∧ S.recurrence_pattern_id IS DISTINCT FROM new.recurrence_pattern_id
```

Surfaced only at **pattern create/edit** (staff present); the rolling job never conflict-checks. **No** unique index on `(occurrence_date, starts_at, ends_at, stops)` — cross-pattern overlapping runs are legitimate. `uq_shift_occurrence` covers same-pattern-same-date only. Warn-don't-block flow → `05`.

---

## 6. Execution — ShiftStop (snapshot)

```sql
CREATE TABLE shift_stop (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id    uuid NOT NULL REFERENCES shift(id) ON DELETE RESTRICT,
  donor_id    uuid NOT NULL REFERENCES donor(id) ON DELETE RESTRICT,  -- LIVE FK (membership frozen, donor attrs read live)
  position    integer NOT NULL,                                       -- frozen order at start; reorderable in-run (I5)
  disposition shiftstop_disposition NOT NULL DEFAULT 'PENDING',       -- {PENDING, COLLECTED, SKIPPED, REASSIGNED}; never WEIGHED (derived, I12)
  note        text,                                                   -- driver-authored, this stop only (PRD cap 11); receiver-visible at S2.2
  CONSTRAINT uq_shift_stop_donor    UNIQUE (shift_id, donor_id),                  -- I28 (shift side)
  CONSTRAINT uq_shift_stop_position UNIQUE (shift_id, position) DEFERRABLE INITIALLY DEFERRED
);
```

**Snapshot semantics (I5/I6):** rows exist only from `IN_PROGRESS` onward, created by copying the route's ordered RouteStops at start. The snapshot freezes *which donors, in what order*; `donor_id` stays a **live FK** (name/address render current). Editing a Route never touches a started/finished shift's stops.

**Derived `WEIGHED` (I12):** never stored. A stop reads `WEIGHED` iff `EXISTS(non-voided weight_entry WHERE shift_id=stop.shift_id AND donor_id=stop.donor_id)`. That is why the enum has no `WEIGHED` member, preventing a stored WEIGHED from passing the completion gate on a voided-then-abandoned weight.

**Completion gate (I12, service-layer):** `Shift→COMPLETED` requires every ShiftStop ∈ {WEIGHED(derived), SKIPPED, REASSIGNED}. **Pickup milestone gate (I27, service-layer):** `pickup_completed_at` settable only when every ShiftStop ∈ {COLLECTED, SKIPPED, REASSIGNED}. Both are cross-row predicates → not CHECK-expressible.

**Mid-run reassignment (I30, service-layer):** staff-only transaction — set the source `ShiftStop.disposition = 'REASSIGNED'` (only legal from PENDING or COLLECTED-without-a-non-voided-WeightEntry; a WEIGHED stop has nothing left to move) and INSERT a new `ShiftStop` row on the destination `shift_id` for the same `donor_id`, `position` appended (respects `uq_shift_stop_position` and I28's per-shift donor uniqueness independently on each shift).

---

## 7. Receive / intake

### 7.1 WeightEntry (planned intake; append-only)

```sql
CREATE TABLE weight_entry (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id    uuid NOT NULL REFERENCES shift(id)    ON DELETE RESTRICT,   -- grain key (I13); NO shift_stop FK
  donor_id    uuid NOT NULL REFERENCES donor(id)    ON DELETE RESTRICT,   -- need not be in snapshot (off-route allowed; UI warns)
  category_id uuid NOT NULL REFERENCES category(id) ON DELETE RESTRICT,
  weight      numeric(8,2) NOT NULL CHECK (weight >= 0),                  -- lb, single unit
  voided      boolean NOT NULL DEFAULT false,                             -- soft void (I13); excluded from every sum
  note        text,                                                       -- per-row note (Domain Modeling §2.3)
  created_by  uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,   -- I26
  updated_by  uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,   -- I26; void is the only update -> = the voider
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
```

Grain is `(Shift, Donor, Category)`, **many rows allowed** per grain (I13). **No `ShiftStop` FK** (receiving is dock-side, decoupled from per-stop check-off). **Immutability (I13):** value columns (`weight`, `donor_id`, `category_id`) never change — enforced by the service layer (no update path). The *only* mutation is voiding (`false→true`, once), which stamps `updated_by`/`updated_at`:

```sql
UPDATE weight_entry SET voided=true, updated_by=:me, updated_at=now()
WHERE id=:id AND voided=false;     -- idempotent; rowcount 0 = already voided
```

Corrections = void-then-insert, never edit. **Totals are SUM-on-read**, never stored:

```
total(scope) := SUM(weight) FROM weight_entry WHERE NOT voided AND <scope>
```

### 7.2 UnscheduledDonation (unplanned intake; polymorphic donor)

```sql
CREATE TABLE unscheduled_donation (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id      uuid REFERENCES shift(id)    ON DELETE RESTRICT,  -- 0..1: set for driver-add on a run; NULL for walk-in
  donor_id      uuid REFERENCES donor(id)    ON DELETE RESTRICT,  -- master donor, XOR label, XOR neither(anon)
  donor_label   text,                                             -- free-text donor; never auto-creates a master Donor
  category_id   uuid NOT NULL REFERENCES category(id) ON DELETE RESTRICT,
  weight        numeric(8,2) CHECK (weight IS NULL OR weight >= 0), -- NULL while SUGGESTED; required on CONFIRMED
  status        donation_status NOT NULL DEFAULT 'SUGGESTED',      -- SUGGESTED only from driver-add (I17)
  reportable    boolean NOT NULL DEFAULT true,                     -- I15; editable in-window then Reporter-only
  received_date date NOT NULL,                                     -- report/metrics day (see §8); service-set
  note          text,
  created_by    uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,  -- I26
  updated_by    uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,  -- I26
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- source is FK XOR label XOR neither(anon); never both. Free text never auto-creates a master Donor.
  CONSTRAINT ck_ud_source_exclusive CHECK (donor_id IS NULL OR donor_label IS NULL),
  -- I16(a): CONFIRMED => weight present (unconditional; metrics count unreportable rows too)
  CONSTRAINT ck_ud_confirmed_weight CHECK (status <> 'CONFIRMED' OR weight IS NOT NULL),
  -- I16(b): CONFIRMED ∧ reportable => source present
  CONSTRAINT ck_ud_i16b_source CHECK (
    NOT (status = 'CONFIRMED' AND reportable)
    OR  (donor_id IS NOT NULL OR donor_label IS NOT NULL)
  )
);
```

Source discriminator is **derived** (`donor_id` → master; `donor_label` → label; both NULL → anon), never stored. **Peer to WeightEntry (I18):** neither references the other; report/metrics union them, never nest.

**On-route guard (I29, service-layer):** if `shift_id` is non-null, `donor_id` must **not** match any `shift_stop.donor_id` of that shift (more food from a scheduled stop is additional WeightEntry rows, not an UnscheduledDonation). Cross-table → not CHECK-expressible.

**SUGGESTED lifecycle (I17):** unconfirmed `SUGGESTED` rows are **hard-deleted** — inline in the receive-done transaction, or, for a shift never received against, by the daily sweep once the edit window has expired (zero ledger value either way). Allowed because a SUGGESTED row has no children.

---

## 8. Report & metrics day (grouping anchor)

The report/metrics views (owned by the reporting doc) union two entities with no shared date column. **Anchor on a business day, never on `created_at`/`updated_at`** (those are entry/edit instants and mis-bucket when receiving lags past midnight or a `reportable` toggle fires later):

```
report_day(weight_entry)         = shift.occurrence_date            -- via join; no duplicated column (derived-vs-stored)
report_day(unscheduled_donation) = unscheduled_donation.received_date
```

`received_date` is stored NOT NULL (set by the service to the pantry-local arrival day; = `shift.occurrence_date` for driver-adds, the receive day for walk-ins) so the union is branch-uniform.

Two distinct numbers (`Domain Modeling` "Intake ≠ NTFB-reported", PRD §3):

```
report  = weight_entry[NOT voided]  ∪  unscheduled_donation[CONFIRMED ∧ reportable]
metrics = weight_entry[NOT voided]  ∪  unscheduled_donation[CONFIRMED]            -- ignores reportable
```

Neither may filter the union on `shift` (walk-ins have none). Grouping is `report_day × category × donor-or-label`; anonymous walk-ins collapse to one "unattributed" bucket — the visible consequence of allowing a null source.

---

## 9. Concurrency & locking

- **No `version` column anywhere.** No `SELECT ... FOR UPDATE` on common paths.  
- **Lifecycle transitions = state-predicate conditional UPDATE.** The precondition *is* the optimistic check; `rowcount = 0` = lost race / stale state.

  ```sql
  -- claim (OPEN -> CLAIMED). Eligibility (I20) checked service-side BEFORE this UPDATE.
  UPDATE shift SET owner_id=:me, status='CLAIMED', updated_by=:me, updated_at=now()
  WHERE id=:id AND status='OPEN' AND owner_id IS NULL;       -- 0 rows => "no longer available"

  -- start (CLAIMED -> IN_PROGRESS): same txn picks truck + snapshots ShiftStops
  UPDATE shift SET status='IN_PROGRESS', truck_id=:truck, updated_by=:me, updated_at=now()
  WHERE id=:id AND status='CLAIMED' AND owner_id=:me;

  -- cancel (OPEN|CLAIMED -> CANCELLED): predicate enforces I9 (never from IN_PROGRESS/COMPLETED); owner cleared (Domain Modeling §2.2)
  UPDATE shift SET status='CANCELLED', owner_id=NULL, updated_by=:me, updated_at=now()
  WHERE id=:id AND status IN ('OPEN','CLAIMED');
  ```

- **No claim count cap exists.** The claim gate is `eligible()` (I20: Drive duty ∧ no overlapping AvailabilityBlock ∧ no overlapping owned CLAIMED/IN_PROGRESS shift), enforced service-side at claim time, block-declaration, and materialization.  
- **Receive-done (I11/I12)** and **pickup milestone (I27)** run their cross-row gates in the service layer, then transition.  
- **Field edits = LWW** (`reportable` toggle, stop reorder, `donor_label` fix): last write wins, `updated_at`/`updated_by` stamped. Acceptable at <10 concurrency (PRD §6).  
- **Materialization insert** is retry-safe via `uq_shift_occurrence` + `ON CONFLICT DO NOTHING`.

---

## 10. AvailabilityBlock (eligibility input)

```sql
CREATE TABLE availability_block (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  starts_at  timestamptz NOT NULL,                  -- whole-person, time-only (I19): NO route scope
  ends_at    timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_ab_window CHECK (ends_at > starts_at)
);
```

Whole-person, time-only (I19) — `Domain Modeling` deliberately dropped the PRD's route-scoped availability to keep eligibility a pure temporal overlap (`Domain Modeling §5.2`). Overlap test: `b.starts_at < shift.ends_at AND shift.starts_at < b.ends_at` (half-open).

Shape ratified: `(user_id, starts_at, ends_at)`, no `route_id`. If route-scoped unavailability is ever needed, that is a change to `Domain Modeling` first (add nullable `route_id`, NULL = all routes), then here.

---

## 11. Notification persistence (co-owned with notifications doc)

Sketch only; delivery mechanics, event scheduling, and the fan-out matrix are the notifications doc's. The persisted state:

```sql
CREATE TABLE notification (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id   uuid REFERENCES app_user(id) ON DELETE RESTRICT,      -- NULL = device-scoped (truck-inbound only)
  subscription_id uuid REFERENCES push_subscription(id) ON DELETE RESTRICT, -- set when recipient_id IS NULL; identifies which device
  event          text NOT NULL,                        -- event taxonomy owned by notifications doc
  shift_id       uuid REFERENCES shift(id) ON DELETE RESTRICT,  -- subject shift when the event has one; NULL otherwise
  payload        jsonb NOT NULL DEFAULT '{}',
  read_at        timestamptz,                           -- NULL = unread (in-app inbox = source of truth, PRD); device-scoped rows have no inbox reader and are never marked read
  -- Push dispatch state (outbox pattern; owned by Architecture §4.4). The row is written INSIDE the
  -- business transaction; the push is dispatched OUTSIDE it, because write transactions run
  -- SERIALIZABLE with retry and a retried transaction would re-send (Architecture §4.1).
  delivered_at    timestamptz,                          -- NULL = push not yet delivered. Inbox delivery never depends on this.
  attempts        integer NOT NULL DEFAULT 0,           -- dispatch attempts; give up after a cap (push is best-effort, PRD channel strategy)
  last_attempt_at timestamptz,                          -- drives retry backoff
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_notif_recipient CHECK (
    (recipient_id IS NOT NULL AND subscription_id IS NULL) OR
    (recipient_id IS NULL AND subscription_id IS NOT NULL)
  )
);

-- Send-idempotency for catch-up sweeps (Architecture §4.4): time-based jobs (1-hour reminder,
-- at-risk-1-day) are written as "find what's due and unsent", so a delayed or repeated run must not
-- re-send. Enforced as a constraint, not by job discipline. Only shift-scoped, time-triggered events
-- need it; event-triggered notifications fire once by construction.
CREATE UNIQUE INDEX uq_notif_shift_event ON notification (event, shift_id, recipient_id)
  WHERE shift_id IS NOT NULL AND recipient_id IS NOT NULL;

CREATE TABLE push_subscription (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES app_user(id) ON DELETE RESTRICT,  -- NULL = device-level (receiver tablet, truck-inbound only)
  endpoint   text NOT NULL,
  p256dh     text NOT NULL,
  auth       text NOT NULL,
  label      text,                                   -- e.g. "receiver tablet"
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_push_endpoint UNIQUE (endpoint)
);
```

Added in reconciliation. `user_id NULL` models the device-level receiver-tablet subscription (PRD §2: "a notification endpoint, not a login"). Recommend deferring final shape to the notifications doc; included here so the data model isn't silently incomplete.

**`shift_id` serves two purposes** (hence a real FK rather than a `payload` key): it is the deep-link anchor for the in-app inbox (UI S1.9, "tap to act") and the dedupe key for `uq_notif_shift_event` above. Nullable — not every event has a subject shift (e.g. "driver sets unavailability").

**Dispatch state is architecture's, not the notifications doc's.** `delivered_at` / `attempts` / `last_attempt_at` exist because the `notification` row *is* the outbox: it is committed atomically with the business change, and a separate in-process sweep delivers the push. If the process dies between commit and delivery the row survives and the next sweep retries it. Delivery is **at-least-once** (a crash between "push sent" and "mark delivered" re-sends — a duplicate banner is preferable to a lost reminder). A permanently failed push is **not** a data-integrity problem: the in-app inbox is the source of truth (PRD channel strategy), so dispatch gives up after a cap and logs. A `410 Gone` from the push gateway means the subscription is dead (uninstalled / permission revoked) → delete the `push_subscription` row; this is the normal end of a subscription's life, not an error.

**Also note the receiver edit window is NOT a job.** `now < shift.starts_at + app_config.receiver_edit_window_days` is derived at request time; only the `SUGGESTED` purge (I17) needs a scheduled write.

`notification.recipient_id` is nullable because truck-inbound is a genuinely device-scoped event (fires at the receiver tablet regardless of who, if anyone, is logged in) and has no `app_user` to point at. Its row instead carries `subscription_id`, referencing the device's `push_subscription` row. Every other event type keeps `recipient_id NOT NULL` / `subscription_id NULL` — this is a one-event carve-out, not a general schema loosening (`ck_notif_recipient` enforces exactly one of the two is set).

---

## 12. Indexes (consolidated)

```sql
-- active-only pickers (I21 masters): partial on the soft-delete predicate
CREATE INDEX ix_donor_active    ON donor    (id) WHERE deactivated_at IS NULL;
CREATE INDEX ix_category_active ON category (id) WHERE deactivated_at IS NULL;
CREATE INDEX ix_truck_active    ON truck    (id) WHERE deactivated_at IS NULL;
CREATE INDEX ix_route_active    ON route    (id) WHERE deactivated_at IS NULL;
CREATE INDEX ix_user_active     ON app_user (id) WHERE deactivated_at IS NULL;

-- WEIGHED-EXISTS (I12) + per-(shift,donor) SUM-on-read
CREATE INDEX ix_weight_active   ON weight_entry (shift_id, donor_id) WHERE voided = false;

-- shift board (claim) + date-scoped queries
CREATE INDEX ix_shift_open      ON shift (occurrence_date) WHERE status = 'OPEN';
CREATE INDEX ix_shift_date      ON shift (occurrence_date);
CREATE INDEX ix_shift_owner     ON shift (owner_id) WHERE owner_id IS NOT NULL;  -- "my shifts" + overlap checks

-- intake reporting/metrics filters (CONFIRMED serves metrics; report adds reportable)
CREATE INDEX ix_ud_confirmed    ON unscheduled_donation (received_date, category_id) WHERE status = 'CONFIRMED';

-- eligibility overlap probe (btree fine at this scale; GiST on tstzrange if availability volume grows)
CREATE INDEX ix_ab_user_window  ON availability_block (user_id, starts_at, ends_at);

-- inbox
CREATE INDEX ix_notif_unread    ON notification (recipient_id, created_at) WHERE read_at IS NULL AND recipient_id IS NOT NULL;
CREATE INDEX ix_notif_device    ON notification (subscription_id, created_at) WHERE subscription_id IS NOT NULL;

-- push dispatch drain (Architecture §4.4): "undelivered, oldest first"
CREATE INDEX ix_notif_pending   ON notification (created_at) WHERE delivered_at IS NULL;

-- FK indexes (PG does NOT auto-index FKs; needed for joins + RESTRICT delete checks). Add on:
--   route_stop(route_id), shift(route_id, recurrence_pattern_id, truck_id, created_by),
--   shift_stop(shift_id), weight_entry(category_id, created_by), unscheduled_donation(shift_id, donor_id, category_id),
--   recurrence_pattern(route_id, owner_default_id, created_by), user_duty(user_id via PK)
--   (donor-bearing FKs are covered by the UNIQUE/partial indexes above)
```

---

## 13. Cross-doc dependencies

- **Architecture (`architecture.md`):** materialization job (reads `app_config.horizon_days` + `timezone`; converts local rule times → instants DST-aware; `ON CONFLICT DO NOTHING`; born-CLAIMED via `eligible()`); auth/session boundary owns `app_user` credential (PIN/password by tier) + PII columns; service-layer transition guards (I9/I10/I11/I12/I27) and `eligible()`. **Adds to this schema:** a `session` table (§4.2), credential + PII columns on `app_user`, session-lifetime keys in `app_config`, and the `notification` dispatch columns already applied in §11. **Constrains this schema's use:** all write transactions run `SERIALIZABLE` with retry, so the §9 conditional-UPDATE predicates are a second line of defence rather than the only one; and every invariant is pushed to the lowest enforcement tier that can express it (Architecture §4.1), which is the principle this doc's CHECK-vs-service split already follows.  
- **API doc (deferred):** endpoint contracts for claim/start/receive-done/weigh/skip/void/confirm/reportable-toggle.  
- **Workflow doc (deferred):** duplicate-run soft-warn flow (proceed/skip-dates/cancel) at pattern create/edit; receive worklist via WEIGHED-EXISTS; pickup-complete handoff sets `pickup_completed_at`; SUGGESTED purge at receive-done/window expiry (I17).  
- **UI/UX Spec** (`ui-ux-spec.md`): `reportable` toggle default+visibility; off-route donor warning (WeightEntry donor not in snapshot); board preview beyond horizon (read-only, no rows); active-only pickers rely on `deactivated_at IS NULL`.  
- **Reporting doc:** owns `report`/`metrics` view definitions and MISSED/UNCLAIMED/NO_SHOW derivations; consumes the day-anchor + union shape in §8.  
- **Notifications doc:** owns event taxonomy, fan-out matrix, scheduling; consumes `notification`/`push_subscription` (§11).  
- **Domain Modeling (canonical, locked):** full attribute lists, state machines, I1–I30. This doc transcribes value-sets into DDL; on any mismatch, `Domain Modeling` wins.

