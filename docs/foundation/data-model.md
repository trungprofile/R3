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

  -- The pantry's identity at North Texas Food Bank, off its own Meal Connect receipts
  -- (migration 0013). Defaulted for the same reason `timezone` is: this repo is one
  -- self-hosted pantry's system of record, and its own identifiers are configuration.
  ntfb_agency_code    text NOT NULL DEFAULT '026357P',
  ntfb_food_bank      text NOT NULL DEFAULT 'North Texas Food Bank',
  ntfb_food_bank_code text NOT NULL DEFAULT '24',

  -- D27 — the pantry-wide trash deduction rates (migration 0017). A store with no
  -- override of its own falls back to these. Defaults are the pantry's current
  -- practice for a typical store; Sam's Club and Costco run produce at 0.10 and
  -- carry a per-donor override instead.
  trash_rate_bakery   numeric(5,4) NOT NULL DEFAULT 0.1000,
  trash_rate_produce  numeric(5,4) NOT NULL DEFAULT 0.0500,
  trash_rate_deli     numeric(5,4) NOT NULL DEFAULT 0.1500,
  CONSTRAINT ck_config_trash_rates CHECK (
    trash_rate_bakery  BETWEEN 0 AND 1 AND
    trash_rate_produce BETWEEN 0 AND 1 AND
    trash_rate_deli    BETWEEN 0 AND 1),

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
  ntfb_donor_code text,                              -- NTFB's own number for this store, as Meal Connect's picker shows it: `H-E-B Food Stores (810)`. Nullable — it is theirs to issue (migration 0013)
  map_url        text,                               -- D20: explicit map link for a store whose address does not name the door. NULL = derive one from `address`, which the client does (migration 0014)
  -- D27 — per-store trash rates (migration 0017). NULL means "use the pantry
  -- default from app_config", which is NOT the same as 0.0000: a store that
  -- genuinely wastes nothing is an explicit zero, and the difference has to
  -- survive an edit that clears the field.
  trash_rate_bakery  numeric(5,4),
  trash_rate_produce numeric(5,4),
  trash_rate_deli    numeric(5,4),
  deactivated_at timestamptz,                        -- ACTIVE ⇄ DEACTIVATED (Domain Modeling §3.3)
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_donor_trash_rates CHECK (
    (trash_rate_bakery  IS NULL OR trash_rate_bakery  BETWEEN 0 AND 1) AND
    (trash_rate_produce IS NULL OR trash_rate_produce BETWEEN 0 AND 1) AND
    (trash_rate_deli    IS NULL OR trash_rate_deli    BETWEEN 0 AND 1))
);

-- D20 — the store photo a driver sees on the current stop (migration 0014).
-- Its OWN TABLE, not a `donor` column: every donor read in the codebase selects whole
-- rows, so a bytea column would drag images into the board, the route builder, the
-- admin list and the report. Only the one endpoint that wants an image pays for it.
-- Bytes in Postgres rather than on disk because a file upload needs a multipart
-- dependency (D5) and a mounted volume, and a volume is a second thing to back up.
-- Here it is already inside pg_dump.
CREATE TABLE donor_photo (
  donor_id   uuid PRIMARY KEY REFERENCES donor(id) ON DELETE RESTRICT,  -- PK: one photo per store, so replacing is an UPSERT and versions cannot accumulate
  bytes      bytea NOT NULL,
  mime       text  NOT NULL CHECK (mime IN ('image/jpeg', 'image/png')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT donor_photo_size CHECK (octet_length(bytes) BETWEEN 1 AND 400000)  -- ~400 KB; a client-resized 800px JPEG is tens of KB
);

CREATE TABLE category (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,                       -- required for admin-managed master data
  -- D27 — which trash rate this category is deducted at, or NULL for none
  -- (migration 0017). A COLUMN and not a match on the literal name 'Bakery':
  -- I21 lets an admin rename a category, and a name match would silently stop
  -- deducting the moment they did. `uq_category_trash_key` (§12) keeps it to one
  -- active category per key, because two would deduct twice.
  trash_rate_key text CHECK (trash_rate_key IS NULL OR trash_rate_key IN ('BAKERY','PRODUCE','DELI')),
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

### 4.1 `ntfb_category` + the AGFP→NTFB mapping (co-owned with the reporting doc)

Added in Phase 3 (migration 0012) for PRD cap 15's "in-app AGFP→NTFB mapping", and
widened by 0013 once a real Meal Connect receipt showed what a line item actually is.
Stated here the way §11 states the notification tables: the *reporting* doc owns what
these mean, this doc owns their shape, and that doc is still deferred.

```sql
CREATE TABLE ntfb_category (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  code           text,                                -- Meal Connect's entry form keys on the NAME; kept, nullable, and no longer exported (0013)
  deactivated_at timestamptz,                        -- ACTIVE ⇄ ARCHIVED, same shape as the §4 masters
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE category ADD COLUMN ntfb_category_id uuid REFERENCES ntfb_category(id) ON DELETE RESTRICT;
ALTER TABLE category ADD COLUMN ntfb_storage     text;   -- the Storage half of a Meal Connect line item (0013)
```

**A line item is `(category, storage)`, and `storage` lives on the AGFP side.** Meal
Connect's entry form asks for `Category · Storage · Description · Pounds` per line, and
its receipts print `Storage Requirement` as its own column. `ntfb_storage` sits on
`category`, beside `ntfb_category_id`, because storage varies *within* one NTFB bucket:
two AGFP categories may report under the same NTFB category frozen and dry
respectively, and the sample receipt confirms Meal Connect allows exactly that by
carrying two separate `Prepared Meals` lines. On `ntfb_category` it would force one
answer per bucket and file frozen food as dry. The report and the export therefore roll
up on the pair, not on the category alone.

**Text, not an enum.** Not because the values are unknown — they are known now — but
because the pantry may be given more of them, and `§1`'s case for a native enum assumes
a value set that does not grow. A null storage does **not** block the export the way an
unmapped category does: the weight still reaches the right category, and only one of the
form's four fields is blank.

**Ships seeded** (`D26`, migration 0016, 2026-08-02). *This paragraph previously read
"ships empty… a Reporter fills it in on S3.1", which was true for exactly as long as
NTFB's vocabulary was unknown to us.* The pantry supplied their real category list and
the storage requirement for each, so the table now ships with **10 rows** and all **11**
AGFP categories mapped, storage included:

| AGFP category | NTFB category | Storage |
| :---- | :---- | :---- |
| Frozen Meat | Meat | Frozen |
| Bakery | Bread | Dry |
| Produce | Produce | Refrigerated |
| Deli | Prepared Meal | Frozen |
| Dairy | Dairy | Refrigerated |
| Dry | Dry Food | Dry |
| Frz Non Meat | Prepared Meal | Frozen |
| Non Food | Non-Food | Dry |
| Pet | Pet Food | Dry |
| Health & Beauty | Health & Beauty | Dry |
| Trash | Trash | Dry |

Deli and Frz Non Meat deliberately share both a bucket **and** a storage value, so they
roll into one report line — the many-to-one case this design anticipated. Closing
`Frz Non Meat`, which matched none of the ten names on the sample receipt, is precisely
what made `D12` retirable: the list is no longer nine-tenths of a guess.

The seed is idempotent — the insert is guarded on the table being empty and each mapping
on `ntfb_category_id IS NULL` — so an admin's later edit survives a replay. S3.1 and the
Admin mapping tab now **edit** this rather than entering it from nothing.

The AGFP `Trash` category ships **archived**: under `D27` trash is computed from the
other categories, so a receiver weighing into it would double-count.

**A column, not a join table.** The cardinality is many-to-one — several AGFP
categories may report under one NTFB bucket — so a join table would permit one AGFP
category mapped to two NTFB ones, a state the report has no way to interpret. Same
instinct as §1's native enums: make it unrepresentable rather than check for it.

`NULL` means "not mapped yet". Since `D26` **no row launches unmapped** — the state is
now only reachable by an admin clearing a mapping, or by adding a new AGFP category. An
unmapped category carrying weight still **blocks the export** rather than being dropped
from it, and that guard is kept precisely because the seed can be edited away.

**Soft-delete follows the §4 masters by analogy, not by I21.** I21 enumerates Donor /
Category / Truck / User and does not mention this table — it did not exist when the
invariant was written. The shape is the same and the reasoning is the same (a mapping
or an exported week may reference it), but the citation is an analogy and is recorded
as one.

---

## 5. Scheduling — Route, RouteStop, RecurrencePattern, Shift

### 5.1 Route + RouteStop (template)

```sql
CREATE TABLE route (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  default_staff_note text,                           -- D19: seeds shift.staff_note when a run is created on this route. A DEFAULT, not a fifth note channel (migration 0014)
  deactivated_at timestamptz,                        -- archive toggle (extends Domain Modeling §3.3)
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Lifecycle (Domain Modeling §3.3, Route row): archive via deactivated_at (soft), OR hard-delete
-- when nothing references it (FK-RESTRICT lets it through). Same pattern as the I21 masters.
--
-- `default_staff_note` (D19) is read at the moment a Shift is created — by the publish
-- form, and by recurrence materialization, which reads it per occurrence rather than
-- capturing it when the pattern was made. It seeds `shift.staff_note`, PRD cap 11's
-- channel 2. It is NOT a fifth note channel: Domain Modeling's four channels are
-- unchanged and none of them share storage. Editing a route never rewrites a Shift
-- that already exists, which is I25's independence applied to this field.

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
  assigned_over_conflict boolean NOT NULL DEFAULT false,        -- I20 staff-assign exemption; drives S1.3's persistent banner (migration 0008)
  created_by            uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,  -- = recurrence_pattern.created_by for minted shifts
  updated_by            uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_shift_occurrence UNIQUE (recurrence_pattern_id, occurrence_date),  -- idempotency: what makes the materialization sweep safe to re-run
  CONSTRAINT ck_shift_window     CHECK (ends_at > starts_at),
  CONSTRAINT ck_shift_truck      CHECK (truck_id IS NULL OR status IN ('IN_PROGRESS','COMPLETED')),  -- I8
  CONSTRAINT ck_shift_conflict_flag CHECK (assigned_over_conflict = false OR owner_id IS NOT NULL),  -- the flag cannot outlive the owner it warns
  CONSTRAINT ck_shift_owner      CHECK (                                           -- I7 / Domain Modeling §2.2 (LOCKED)
       (status = 'OPEN'                                  AND owner_id IS NULL)
    OR (status IN ('CLAIMED','IN_PROGRESS','COMPLETED')  AND owner_id IS NOT NULL)
    OR (status = 'CANCELLED'                             AND owner_id IS NULL)      -- Domain Modeling §2.2: owner cleared on cancel
  )
);
```

**owner-on-cancel (LOCKED, per `Domain Modeling §2.2`):** cancel clears `owner_id` in the same UPDATE. The prior owner's identity is **not** retained on the row (`updated_by` is the canceller, possibly staff). If "which driver was bumped" is ever needed for analytics it must come from the notification log or an audit trail, not `shift`. CANCELLED is excluded from MISSED/NO_SHOW (`Domain Modeling §3.1`).

**There is no `completed_by`, and `D46` deliberately did not add one.** S2.2b names who signed a run off by reading `updated_by`/`updated_at` **on a `COMPLETED` row only**. That is sound *because* `I10` makes `COMPLETED` terminal: nothing can write to the row afterwards, so the last writer is the person who confirmed receive-done. **The dependency runs the wrong way round for comfort** — a display feature resting on a state-machine property — so it is recorded in both places. If `COMPLETED` ever gains an outbound edge, this stops being a fact and starts being a plausible-looking wrong name, and the fix is a real column, not a patch to the query. Contrast the cancel case directly above, where `updated_by` is explicitly *not* a safe read for the same question.

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
  category_id   uuid REFERENCES category(id) ON DELETE RESTRICT,    -- D24: NULL while SUGGESTED; required on CONFIRMED, exactly like `weight`
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
  -- I16(c), added by D24 (migration 0015): CONFIRMED => category present. The driver
  -- who flags a pickup cannot know the category and it is not their job, so the row
  -- arrives without one and the receiver picks it at confirm time. Reporting is
  -- unaffected: report and metrics union CONFIRMED rows only.
  CONSTRAINT ck_ud_confirmed_category CHECK (status <> 'CONFIRMED' OR category_id IS NOT NULL),
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

### 8.1 `meal_connect_submission` — what has been filed with the food bank (`D35`)

Records that a receipt was typed into Meal Connect's web form. **It carries no weight and changes
no total** — dropping every row would leave every reported figure identical. It answers one
question for the reporter: which receipts are already in.

```sql
CREATE TABLE meal_connect_submission (
  pickup_date   date        NOT NULL,
  donor_id      uuid        NOT NULL REFERENCES donor (id) ON DELETE RESTRICT,
  submitted_at  timestamptz NOT NULL DEFAULT now(),
  submitted_by  uuid        NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT,
  PRIMARY KEY (pickup_date, donor_id)
);
CREATE INDEX ix_mcs_donor ON meal_connect_submission (donor_id);
```

- **The composite primary key is the enforcement**, tier 1. It is the same grain as the receipt
  (`D29`), so two reporters ticking the same store on the same day produce one row, not two, and
  the first writer stands. The service ticks with `ON CONFLICT DO NOTHING`: a second reporter
  agreeing is not an error to report back to them.
- **No `updated_at`, no soft delete.** Un-ticking is a `DELETE`; the row's existence *is* the
  claim, and a retracted claim leaves nothing behind worth keeping.
- **`ON DELETE RESTRICT` on both FKs.** A donor with filing history is archived, never destroyed,
  which is `I21`'s existing rule — this table is one more thing that makes it true.
- **The primary key's own index leads on `pickup_date`**, which is what a range read (`D41`) wants;
  `ix_mcs_donor` serves the other direction, "has this store ever been filed".

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
  -- assigned_over_conflict MUST be cleared in the same statement: ck_shift_conflict_flag
  -- forbids a flagged shift with no owner, so omitting it raises rather than silently
  -- leaving a stale banner. Same for release and staff-unassign (migration 0008).
  UPDATE shift SET status='CANCELLED', owner_id=NULL, assigned_over_conflict=false,
                   updated_by=:me, updated_at=now()
  WHERE id=:id AND status IN ('OPEN','CLAIMED');
  ```

  **Any statement that clears `owner_id` must clear `assigned_over_conflict` with it.** The CHECK
  makes this loud rather than optional — a release, cancel or staff-unassign that forgets fails the
  transaction instead of leaving the next driver a banner about a conflict that was never theirs.
  Wave 3 owns release and staff-unassign; only cancel is written out here.

- **No claim count cap exists.** The claim gate is `eligible()` (`domain-modeling.md §5.2` — driver active (I21) ∧ Drive duty ∧ no overlapping AvailabilityBlock ∧ no overlapping owned CLAIMED/IN_PROGRESS shift), enforced service-side at claim time, block-declaration, and materialization.  
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
-- re-send. Enforced as a constraint, not by job discipline. Only shift-scoped, TIME-TRIGGERED events
-- may be covered, and the predicate must enumerate them -- an unfiltered index silently swallows the
-- SECOND legitimate send of an event-triggered notification. Event-triggered events do NOT fire once
-- by construction: release -> re-claim -> release fans SHIFT_OPENED out twice about the same run, and
-- both sends are real. Migration 0009 added the `event IN (...)` clause for exactly that defect; the
-- list is kept in lockstep with `TIME_TRIGGERED_EVENTS` in services/notification.ts.
CREATE UNIQUE INDEX uq_notif_shift_event ON notification (event, shift_id, recipient_id)
  WHERE shift_id IS NOT NULL
    AND recipient_id IS NOT NULL
    AND event IN ('SHIFT_REMINDER', 'SHIFT_AT_RISK');

-- The enumerated shared devices (Architecture §4.2). Membership IS the
-- shared-device marker: an admin registers the receiver tablet and the reporter
-- desktop, and anything unregistered is personal. `session.device_id` references
-- this table, NULL meaning personal.
CREATE TABLE device (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label      text NOT NULL,                          -- "receiver tablet", "reporter desktop"
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE push_subscription (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES app_user(id) ON DELETE RESTRICT,  -- a person's own subscription
  device_id  uuid REFERENCES device(id)   ON DELETE RESTRICT,  -- device-level (receiver tablet, truck-inbound only)
  endpoint   text NOT NULL,
  p256dh     text NOT NULL,
  auth       text NOT NULL,
  label      text,
  revoked_at timestamptz,                            -- 410 Gone; dispatch skips revoked rows
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_push_endpoint UNIQUE (endpoint),
  CONSTRAINT ck_push_owner CHECK (
    (user_id IS NOT NULL AND device_id IS NULL) OR
    (user_id IS NULL     AND device_id IS NOT NULL)
  )
);
```

Added in reconciliation. `device_id` set (with `user_id` null) models the device-level receiver-tablet subscription (PRD §2: "a notification endpoint, not a login"), and binding it to the `device` row is what makes a lost shared-device registration announce itself by also killing truck-inbound alerts (Architecture §4.2). Recommend deferring final shape to the notifications doc; included here so the data model isn't silently incomplete.

**A dead subscription is revoked, not deleted.** A `410 Gone` sets `revoked_at`. §0's blanket `ON DELETE RESTRICT` means a subscription referenced by any `session` or `notification` row cannot be hard-deleted at all, so the alternative is not "delete sometimes" but "delete never works once used". Revocation also keeps the record of which device a past alert went to. Same soft-delete shape as the I21 masters, for the same reason.

**`shift_id` serves two purposes** (hence a real FK rather than a `payload` key): it is the deep-link anchor for the in-app inbox (UI S1.9, "tap to act") and the dedupe key for `uq_notif_shift_event` above. Nullable — not every event has a subject shift (e.g. "driver sets unavailability").

**Dispatch state is architecture's, not the notifications doc's.** `delivered_at` / `attempts` / `last_attempt_at` exist because the `notification` row *is* the outbox: it is committed atomically with the business change, and a separate in-process sweep delivers the push. If the process dies between commit and delivery the row survives and the next sweep retries it. Delivery is **at-least-once** (a crash between "push sent" and "mark delivered" re-sends — a duplicate banner is preferable to a lost reminder). A permanently failed push is **not** a data-integrity problem: the in-app inbox is the source of truth (PRD channel strategy), so dispatch gives up after a cap and logs. A `410 Gone` from the push gateway means the subscription is dead (uninstalled / permission revoked) → set `push_subscription.revoked_at`; dispatch skips revoked rows. This is the normal end of a subscription's life, not an error. Revoked rather than deleted: §0's blanket `ON DELETE RESTRICT` means a subscription referenced by any `session` or `notification` row cannot be hard-deleted at all, so deletion is not merely discouraged here — it is unreachable once the row has been used.

**Also note the receiver edit window is NOT a job.** `now < shift.starts_at + app_config.receiver_edit_window_days` is derived at request time; only the `SUGGESTED` purge (I17) needs a scheduled write.

`notification.recipient_id` is nullable because truck-inbound is a genuinely device-scoped event (fires at the receiver tablet regardless of who, if anyone, is logged in) and has no `app_user` to point at. Its row instead carries `subscription_id`, referencing the device's `push_subscription` row. Every other event type keeps `recipient_id NOT NULL` / `subscription_id NULL` — this is a one-event carve-out, not a general schema loosening (`ck_notif_recipient` enforces exactly one of the two is set).

---

## 12. Indexes (consolidated)

```sql
-- active-only pickers (I21 masters): partial on the soft-delete predicate
CREATE INDEX ix_donor_active    ON donor    (id) WHERE deactivated_at IS NULL;
CREATE INDEX ix_category_active ON category (id) WHERE deactivated_at IS NULL;
-- §4.1, Phase 3: the NTFB mapping. Name is a vocabulary, so duplicates are a
-- data-entry mistake; partial so an archived name can be reused.
CREATE INDEX ix_ntfb_active     ON ntfb_category (id) WHERE deactivated_at IS NULL;
CREATE INDEX ix_category_ntfb   ON category (ntfb_category_id);
CREATE UNIQUE INDEX uq_ntfb_name ON ntfb_category (lower(name)) WHERE deactivated_at IS NULL;
-- D27: one active category per trash rate key. Two would deduct the same weight twice
-- and inflate the Trash line, which is a number that leaves the building.
CREATE UNIQUE INDEX uq_category_trash_key ON category (trash_rate_key)
  WHERE trash_rate_key IS NOT NULL AND deactivated_at IS NULL;
-- §4, 0013: two live stores sharing one NTFB donor number is a data-entry mistake.
-- Partial on both predicates — NULL is the ordinary unknown and repeats freely, and a
-- deactivated store must not hold its code against a replacement row.
CREATE UNIQUE INDEX uq_donor_ntfb_code ON donor (ntfb_donor_code) WHERE ntfb_donor_code IS NOT NULL AND deactivated_at IS NULL;
CREATE INDEX ix_truck_active    ON truck    (id) WHERE deactivated_at IS NULL;
CREATE INDEX ix_route_active    ON route    (id) WHERE deactivated_at IS NULL;
CREATE INDEX ix_user_active     ON app_user (id) WHERE deactivated_at IS NULL;

-- §8.1, D35: the composite PK already indexes (pickup_date, donor_id), which is what a
-- range read wants. This serves the other direction — "has this store ever been filed",
-- which is what I21's history check on a donor asks.
CREATE INDEX ix_mcs_donor       ON meal_connect_submission (donor_id);

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
--
-- `updated_by` is indexed ALONGSIDE `created_by` on every table whose rows carry both
-- stamps: shift, weight_entry, unscheduled_donation. I21's `userHasHistory` probes
-- both — a receiver who only ever VOIDED someone else's weight is `updated_by` on
-- that row and nothing else — so indexing only the author would leave half the
-- predicate scanning. Applied in 0007 (shift) and 0011 (intake).
CREATE INDEX ix_ud_suggested ON unscheduled_donation (shift_id) WHERE status = 'SUGGESTED';
```

The last one is the I17 sweep's index: the daily job asks "which `SUGGESTED` rows are
past their shift's edit window?", which without it is a sequential scan over the whole
intake table for a query that should touch a handful of rows.

---

## 13. Cross-doc dependencies

- **Architecture (`architecture.md`):** materialization job (reads `app_config.horizon_days` + `timezone`; converts local rule times → instants DST-aware; `ON CONFLICT DO NOTHING`; born-CLAIMED via `eligible()`); auth/session boundary owns `app_user` credential (PIN/password by tier) + PII columns; service-layer transition guards (I9/I10/I11/I12/I27) and `eligible()`. **Adds to this schema:** a `session` table (§4.2), credential + PII columns on `app_user`, session-lifetime keys in `app_config`, and the `notification` dispatch columns already applied in §11. **Constrains this schema's use:** all write transactions run `SERIALIZABLE` with retry, so the §9 conditional-UPDATE predicates are a second line of defence rather than the only one; and every invariant is pushed to the lowest enforcement tier that can express it (Architecture §4.1), which is the principle this doc's CHECK-vs-service split already follows.  
- **API doc (deferred):** endpoint contracts for claim/start/receive-done/weigh/skip/void/confirm/reportable-toggle.  
- **Workflow doc (deferred):** duplicate-run soft-warn flow (proceed/skip-dates/cancel) at pattern create/edit; receive worklist via WEIGHED-EXISTS; pickup-complete handoff sets `pickup_completed_at`; SUGGESTED purge at receive-done/window expiry (I17).  
- **UI/UX Spec** (`ui-ux-spec.md`): `reportable` toggle default+visibility; off-route donor warning (WeightEntry donor not in snapshot); board preview beyond horizon (read-only, no rows); active-only pickers rely on `deactivated_at IS NULL`.  
- **Reporting doc:** owns `report`/`metrics` view definitions and MISSED/UNCLAIMED/NO_SHOW derivations; consumes the day-anchor + union shape in §8.  
- **Notifications doc:** owns event taxonomy, fan-out matrix, scheduling; consumes `notification`/`push_subscription` (§11).  
- **Domain Modeling (canonical, locked):** full attribute lists, state machines, I1–I30. This doc transcribes value-sets into DDL; on any mismatch, `Domain Modeling` wins.

