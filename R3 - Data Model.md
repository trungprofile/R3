# R3 \- Data Model

**Purpose.** Physical PostgreSQL schema for R3: concrete types, nullability, constraints, and indexes that *enforce* the locked domain model (`01-domain.md`, I1–I29) at the storage layer, plus the concerns `01` explicitly punts here: concurrency/optimistic locking, soft-delete mechanics, the polymorphic `Donor` FK \+ free-text label, and the `horizon` config. Owns *how data is stored and constrained*. Defers full PII/credential attributes (→ access/`03`), report and metric definitions (→ reporting doc), and notification delivery mechanics (→ notifications doc).

Reconciled against `01-domain.md` (locked) and the PRD. Invariant citations (I\#) are verified against `01 §4`.

---

## 0\. Conventions (apply to every table; not restated per-table)

- **PK:** `uuid PRIMARY KEY DEFAULT gen_random_uuid()` (pgcrypto / PG ≥13).  
- **Instants:** every point in time is `timestamptz`. No naive `timestamp`, no stored UTC offsets. Pantry-local rendering is a presentation concern.  
- **Local wall-clock** (recurrence rule times) stored as `time`/`date`, converted to instants only at materialization via `app_config.timezone`.  
- **Naming:** snake\_case; `app_user` not `user` (reserved word).  
- **Extensions:** `pgcrypto` (uuid). (No `citext` — usernames are forced lowercase, see §3.)  
- **Soft-delete pattern (masters Donor/Category/Truck/User, per I21):** `deactivated_at timestamptz`, `NULL = active`. One physical bit for the ACTIVE⇄{ARCHIVED|INACTIVE|DEACTIVATED} toggles in `01 §3.3` (the labels are UI-only). Active reads filter `WHERE deactivated_at IS NULL`. Field edits always allowed; soft-delete governs removal only.  
- **Provenance pattern (I26):** `created_by` / `updated_by uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT`. Last-writer only; real FKs, never loose ids.  
- **FK-RESTRICT pattern:** *every* FK is `ON DELETE RESTRICT`. This restrict **is** the I21 history guard: a hard `DELETE` of a master succeeds iff zero rows reference it, else fails at the DB. App-level reference-counting is only for friendly error text, not correctness.  
- **State-machine guards are NOT CHECKs.** Per-row CHECKs enforce state↔column coupling. Transition legality (I9 cancel-guard, I10 terminal, I11 completion-only-via-receiver, I12 completion gate) depends on the *prior* state and lives in the service layer via the conditional-UPDATE predicates in §9.

---

## 1\. Enum types (native PG)

Value-sets transcribed from `01` and the PRD; verified.

CREATE TYPE tier                  AS ENUM ('VOLUNTEER', 'STAFF', 'ADMIN');     \-- I1, hierarchical (V ⊂ S ⊂ A)

CREATE TYPE duty                  AS ENUM ('DRIVE', 'RECEIVE', 'REPORT');      \-- I2

CREATE TYPE shift\_status          AS ENUM ('OPEN','CLAIMED','IN\_PROGRESS','COMPLETED','CANCELLED'); \-- I7; MISSED is derived, not stored

CREATE TYPE shiftstop\_disposition AS ENUM ('PENDING','COLLECTED','SKIPPED');   \-- WEIGHED is derived (I12), never stored

CREATE TYPE donation\_status       AS ENUM ('SUGGESTED','CONFIRMED');           \-- 01 §2.3

Tradeoff accepted (decision 4): adding/renaming a state later needs `ALTER TYPE ... ADD VALUE`. Fine, these sets are domain-locked.

---

## 2\. `app_config` — system config (singleton)

CREATE TABLE app\_config (

  id            boolean PRIMARY KEY DEFAULT true CHECK (id),           \-- singleton: only one row (id=true)

  timezone      text    NOT NULL DEFAULT 'America/Chicago',            \-- IANA zone, DST-aware. NEVER a fixed offset.

  horizon\_days  integer NOT NULL DEFAULT 365 CHECK (horizon\_days \> 0), \-- recurrence materialization horizon (ops knob)

  receiver\_edit\_window\_days integer NOT NULL DEFAULT 7 CHECK (receiver\_edit\_window\_days \> 0), \-- 01 §3.1 "N days"

  updated\_at    timestamptz NOT NULL DEFAULT now()

);

`horizon` and `timezone` are **system config, not domain fields** (`01 §5.3`): changeable without redeploy, auditable. `receiver_edit_window_days` is the `N` from the completion model (`01 §3.1`): window after which receiver edits become Reporter-only and lingering `SUGGESTED` rows are purged. `RecurrencePattern.end_date` (domain) is separate from `horizon_days` (system).

---

## 3\. Identity & access

CREATE TABLE app\_user (

  id             uuid PRIMARY KEY DEFAULT gen\_random\_uuid(),

  username       text NOT NULL,                    \-- lowercase \[a-z0-9\], non-empty (I3)

  tier           tier NOT NULL,                     \-- I1

  \-- credential (PIN hash for Volunteer / password hash for Staff+Admin) and PII (name, phone)

  \-- are owned by 03/access. PIN defaults to last 4 of phone (PRD §2). NOT modeled here.

  deactivated\_at timestamptz,                        \-- NULL \= active

  created\_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq\_user\_username   UNIQUE (username),                    \-- spans deactivated users (I3: reserved, no reuse)

  CONSTRAINT ck\_user\_username   CHECK  (username \~ '^\[a-z0-9\]+$')     \-- lowercase alnum, non-empty

);

CREATE TABLE user\_duty (

  user\_id uuid NOT NULL REFERENCES app\_user(id) ON DELETE RESTRICT,

  duty    duty NOT NULL,

  PRIMARY KEY (user\_id, duty)                        \-- 0..3 duties per user (I2); junction (decision 4\)

);

- `username` uniqueness is enforced at the DB (`uq_user_username`) and **includes deactivated users** (I3 / `01 §5.1`): a freed username is not reused, handles stay reserved. The §5.1 generation algorithm checks the full assembled string against this constraint and **retries on conflict** (the concurrency hook `01 §5.1` defers here).  
- **Immutability** of `username` (I3) is service-layer (no update path); optionally a trigger blocking `username` UPDATE.

---

## 4\. Master data — Donor, Category, Truck

Full attributes in `01`/PRD. Only lifecycle \+ load-bearing columns here.

CREATE TABLE donor (

  id             uuid PRIMARY KEY DEFAULT gen\_random\_uuid(),

  \-- name, address, contact, permanent per-store notes (PRD cap 11): see 01/PRD

  deactivated\_at timestamptz,                        \-- ACTIVE ⇄ DEACTIVATED (01 §3.3)

  created\_at     timestamptz NOT NULL DEFAULT now()

);

CREATE TABLE category (

  id             uuid PRIMARY KEY DEFAULT gen\_random\_uuid(),

  deactivated\_at timestamptz,                        \-- ACTIVE ⇄ ARCHIVED (01 §3.3)

  created\_at     timestamptz NOT NULL DEFAULT now()

);

CREATE TABLE truck (

  id             uuid PRIMARY KEY DEFAULT gen\_random\_uuid(),

  truck\_name     text NOT NULL,

  plate          text,                               \-- optional (01 §2.3)

  deactivated\_at timestamptz,                        \-- ACTIVE ⇄ INACTIVE; inactive hidden from driver selection

  created\_at     timestamptz NOT NULL DEFAULT now()

);

Hard-delete is attempted as a real `DELETE`; FK-RESTRICT from all children (incl. provenance stamps) blocks it iff history exists (I21). No stored "has history" flag. **No truck exclusivity** (I22): double-booking a truck across concurrent shifts is allowed, so no unique constraint ties a truck to a time window.

---

## 5\. Scheduling — Route, RouteStop, RecurrencePattern, Shift

### 5.1 Route \+ RouteStop (template)

CREATE TABLE route (

  id             uuid PRIMARY KEY DEFAULT gen\_random\_uuid(),

  name           text NOT NULL,

  deactivated\_at timestamptz,                        \-- archive toggle (extends 01 §3.3; see divergence note)

  created\_at     timestamptz NOT NULL DEFAULT now()

);

\-- Lifecycle (extends 01 §3.3, which is silent on Route): archive via deactivated\_at (soft), OR hard-delete

\-- when nothing references it (FK-RESTRICT lets it through). Same pattern as the I21 masters. 01 §3.3 needs a Route line.

CREATE TABLE route\_stop (

  id       uuid PRIMARY KEY DEFAULT gen\_random\_uuid(),

  route\_id uuid NOT NULL REFERENCES route(id) ON DELETE RESTRICT,

  donor\_id uuid NOT NULL REFERENCES donor(id) ON DELETE RESTRICT,

  position integer NOT NULL,                                       \-- integer order (decision 8\)

  CONSTRAINT uq\_route\_stop\_donor    UNIQUE (route\_id, donor\_id),               \-- I28 (template side): ≤1 stop per donor

  CONSTRAINT uq\_route\_stop\_position UNIQUE (route\_id, position) DEFERRABLE INITIALLY DEFERRED

);

`position` UNIQUE is **deferrable**: a reorder rewrites several rows in one txn (transient collisions allowed mid-txn, checked at commit). Renumber-in-txn; no fractional index (routes are tiny).

### 5.2 RecurrencePattern

CREATE TABLE recurrence\_pattern (

  id               uuid PRIMARY KEY DEFAULT gen\_random\_uuid(),

  route\_id         uuid NOT NULL REFERENCES route(id) ON DELETE RESTRICT,

  weekdays         smallint\[\] NOT NULL,              \-- ISO dow 1..7; job iterates these

  start\_time       time NOT NULL,                     \-- LOCAL wall-clock; \-\> instant at materialization via app\_config.timezone

  end\_time         time NOT NULL,

  end\_date         date,                              \-- domain field; NULL \= open-ended (01 §5.3)

  owner\_default\_id uuid REFERENCES app\_user(id) ON DELETE RESTRICT,  \-- "claim all future" target; NULL \= none

  active           boolean NOT NULL DEFAULT true,     \-- 01 §5.3 pattern.active (NOT the I21 soft-delete pattern)

  created\_by       uuid NOT NULL REFERENCES app\_user(id) ON DELETE RESTRICT,  \-- pattern author (decision 2; physical add beyond I26)

  created\_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ck\_rp\_weekdays CHECK (array\_length(weekdays,1) \>= 1

                                   AND weekdays \<@ ARRAY\[1,2,3,4,5,6,7\]::smallint\[\]),

  CONSTRAINT ck\_rp\_window   CHECK (end\_time \> start\_time)  \-- intra-day windows only (no overnight pickups, confirmed)

);

`created_by` is a **physical addition beyond I26's named set** (which lists only WeightEntry/UnscheduledDonation/Shift). It exists solely to source the minted-shift author per decision 2\. (OPEN: confirm, or tell me where the pattern author is otherwise recorded.)

### 5.3 Shift (materialized instance, or one-off)

CREATE TABLE shift (

  id                    uuid PRIMARY KEY DEFAULT gen\_random\_uuid(),

  recurrence\_pattern\_id uuid REFERENCES recurrence\_pattern(id) ON DELETE RESTRICT,  \-- NULL \= one-off

  route\_id              uuid NOT NULL REFERENCES route(id)     ON DELETE RESTRICT,  \-- I4: bound at schedule time

  occurrence\_date       date  NOT NULL,                        \-- calendar slot (pantry-local date)

  starts\_at             timestamptz NOT NULL,                  \-- instant

  ends\_at               timestamptz NOT NULL,

  status                shift\_status NOT NULL DEFAULT 'OPEN',

  owner\_id              uuid REFERENCES app\_user(id) ON DELETE RESTRICT,  \-- NULL while OPEN; may be set at birth (born-CLAIMED)

  truck\_id              uuid REFERENCES truck(id)    ON DELETE RESTRICT,  \-- NULL before IN\_PROGRESS (I8)

  pickup\_completed\_at   timestamptz,                           \-- I27 handoff milestone; gate is service-layer

  note                  text,                                  \-- Shift.note: one run-level note (01 §2.3)

  created\_by            uuid NOT NULL REFERENCES app\_user(id) ON DELETE RESTRICT,  \-- \= recurrence\_pattern.created\_by for minted (decision 2\)

  updated\_by            uuid NOT NULL REFERENCES app\_user(id) ON DELETE RESTRICT,

  created\_at            timestamptz NOT NULL DEFAULT now(),

  updated\_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq\_shift\_occurrence UNIQUE (recurrence\_pattern\_id, occurrence\_date),  \-- idempotency (decision 6\)

  CONSTRAINT ck\_shift\_window     CHECK (ends\_at \> starts\_at),

  CONSTRAINT ck\_shift\_truck      CHECK (truck\_id IS NULL OR status IN ('IN\_PROGRESS','COMPLETED')),  \-- I8

  CONSTRAINT ck\_shift\_owner      CHECK (                                           \-- I7 / 01 §2.2 (LOCKED)

       (status \= 'OPEN'                                  AND owner\_id IS NULL)

    OR (status IN ('CLAIMED','IN\_PROGRESS','COMPLETED')  AND owner\_id IS NOT NULL)

    OR (status \= 'CANCELLED'                             AND owner\_id IS NULL)      \-- 01 §2.2: owner cleared on cancel

  )

);

**owner-on-cancel (LOCKED, per `01 §2.2`):** cancel clears `owner_id` in the same UPDATE. The prior owner's identity is **not** retained on the row (`updated_by` is the canceller, possibly staff). If "which driver was bumped" is ever needed for analytics it must come from the notification log or an audit trail, not `shift`. CANCELLED is excluded from MISSED/NO\_SHOW (`01 §3.1`).

**Materialization provenance:** a minted shift's `created_by = recurrence_pattern.created_by`. No system user. Minted-vs-one-off \= `recurrence_pattern_id IS NOT NULL`.

**Idempotency:** `uq_shift_occurrence` makes the rolling job safe under retry/overlap. Job inserts `ON CONFLICT (recurrence_pattern_id, occurrence_date) DO NOTHING`. One-offs have `recurrence_pattern_id = NULL`; PG default **NULLS DISTINCT** lets multiple one-offs share a date. **Do not** use `NULLS NOT DISTINCT`.

**Born-CLAIMED (I25):** at insert the job may set `owner_id = pattern.owner_default_id` *iff* `eligible()` holds for that instance (`01 §5.2`/§5.3), else `owner_id` NULL / status OPEN. The eligibility check is service/job-layer.

**Duplicate-run identity is a SOFT check, NOT a constraint** (your call, last round):

real\_conflict(new) := ∃ shift S, S.occurrence\_date \= new.occurrence\_date

                      ∧ S.status \<\> 'CANCELLED'

                      ∧ S.starts\_at \= new.starts\_at ∧ S.ends\_at \= new.ends\_at

                      ∧ stop\_set(S) \= stop\_set(new)            \-- donor-id SET, order-insensitive

                      ∧ S.recurrence\_pattern\_id IS DISTINCT FROM new.recurrence\_pattern\_id

Surfaced only at **pattern create/edit** (staff present); the rolling job never conflict-checks. **No** unique index on `(occurrence_date, starts_at, ends_at, stops)` — cross-pattern overlapping runs are legitimate. `uq_shift_occurrence` covers same-pattern-same-date only. Warn-don't-block flow → `05`.

---

## 6\. Execution — ShiftStop (snapshot)

CREATE TABLE shift\_stop (

  id          uuid PRIMARY KEY DEFAULT gen\_random\_uuid(),

  shift\_id    uuid NOT NULL REFERENCES shift(id) ON DELETE RESTRICT,

  donor\_id    uuid NOT NULL REFERENCES donor(id) ON DELETE RESTRICT,  \-- LIVE FK (membership frozen, donor attrs read live)

  position    integer NOT NULL,                                       \-- frozen order at start; reorderable in-run (I5)

  disposition shiftstop\_disposition NOT NULL DEFAULT 'PENDING',       \-- {PENDING, COLLECTED, SKIPPED}; never WEIGHED

  CONSTRAINT uq\_shift\_stop\_donor    UNIQUE (shift\_id, donor\_id),                  \-- I28 (shift side)

  CONSTRAINT uq\_shift\_stop\_position UNIQUE (shift\_id, position) DEFERRABLE INITIALLY DEFERRED

);

**Snapshot semantics (I5/I6):** rows exist only from `IN_PROGRESS` onward, created by copying the route's ordered RouteStops at start. The snapshot freezes *which donors, in what order*; `donor_id` stays a **live FK** (name/address render current). Editing a Route never touches a started/finished shift's stops.

**Derived `WEIGHED` (I12):** never stored. A stop reads `WEIGHED` iff `EXISTS(non-voided weight_entry WHERE shift_id=stop.shift_id AND donor_id=stop.donor_id)`. That is why the enum has no `WEIGHED` member, preventing a stored WEIGHED from passing the completion gate on a voided-then-abandoned weight.

**Completion gate (I12, service-layer):** `Shift→COMPLETED` requires every ShiftStop ∈ {WEIGHED(derived), SKIPPED}. **Pickup milestone gate (I27, service-layer):** `pickup_completed_at` settable only when every ShiftStop ∈ {COLLECTED, SKIPPED}. Both are cross-row predicates → not CHECK-expressible.

---

## 7\. Receive / intake

### 7.1 WeightEntry (planned intake; append-only)

CREATE TABLE weight\_entry (

  id          uuid PRIMARY KEY DEFAULT gen\_random\_uuid(),

  shift\_id    uuid NOT NULL REFERENCES shift(id)    ON DELETE RESTRICT,   \-- grain key (I13); NO shift\_stop FK

  donor\_id    uuid NOT NULL REFERENCES donor(id)    ON DELETE RESTRICT,   \-- need not be in snapshot (off-route allowed; UI warns)

  category\_id uuid NOT NULL REFERENCES category(id) ON DELETE RESTRICT,

  weight      numeric(8,2) NOT NULL CHECK (weight \>= 0),                  \-- lb, single unit

  voided      boolean NOT NULL DEFAULT false,                             \-- soft void (I13); excluded from every sum

  note        text,                                                       \-- per-row note (01 §2.3)

  created\_by  uuid NOT NULL REFERENCES app\_user(id) ON DELETE RESTRICT,   \-- I26

  updated\_by  uuid NOT NULL REFERENCES app\_user(id) ON DELETE RESTRICT,   \-- I26; void is the only update \-\> \= the voider

  created\_at  timestamptz NOT NULL DEFAULT now(),

  updated\_at  timestamptz NOT NULL DEFAULT now()

);

Grain is `(Shift, Donor, Category)`, **many rows allowed** per grain (I13). **No `ShiftStop` FK** (receiving is dock-side, decoupled from per-stop check-off). **Immutability (I13):** value columns (`weight`, `donor_id`, `category_id`) never change — enforced by the service layer (no update path). The *only* mutation is voiding (`false→true`, once), which stamps `updated_by`/`updated_at`:

UPDATE weight\_entry SET voided=true, updated\_by=:me, updated\_at=now()

WHERE id=:id AND voided=false;     \-- idempotent; rowcount 0 \= already voided

Corrections \= void-then-insert, never edit. **Totals are SUM-on-read**, never stored:

total(scope) := SUM(weight) FROM weight\_entry WHERE NOT voided AND \<scope\>

### 7.2 UnscheduledDonation (unplanned intake; polymorphic donor)

CREATE TABLE unscheduled\_donation (

  id            uuid PRIMARY KEY DEFAULT gen\_random\_uuid(),

  shift\_id      uuid REFERENCES shift(id)    ON DELETE RESTRICT,  \-- 0..1: set for driver-add on a run; NULL for walk-in

  donor\_id      uuid REFERENCES donor(id)    ON DELETE RESTRICT,  \-- master donor, XOR label, XOR neither(anon)

  donor\_label   text,                                             \-- free-text donor; never auto-creates a master Donor

  category\_id   uuid NOT NULL REFERENCES category(id) ON DELETE RESTRICT,

  weight        numeric(8,2) CHECK (weight IS NULL OR weight \>= 0), \-- NULL while SUGGESTED; required on CONFIRMED

  status        donation\_status NOT NULL DEFAULT 'SUGGESTED',      \-- SUGGESTED only from driver-add (I17)

  reportable    boolean NOT NULL DEFAULT true,                     \-- I15; editable in-window then Reporter-only

  received\_date date NOT NULL,                                     \-- report/metrics day (see §8); service-set

  note          text,

  created\_by    uuid NOT NULL REFERENCES app\_user(id) ON DELETE RESTRICT,  \-- I26

  updated\_by    uuid NOT NULL REFERENCES app\_user(id) ON DELETE RESTRICT,  \-- I26

  created\_at    timestamptz NOT NULL DEFAULT now(),

  updated\_at    timestamptz NOT NULL DEFAULT now(),

  \-- (decision 1\) source is FK XOR label XOR neither(anon); never both

  CONSTRAINT ck\_ud\_source\_exclusive CHECK (donor\_id IS NULL OR donor\_label IS NULL),

  \-- shape table: CONFIRMED \=\> weight present (unconditional)

  CONSTRAINT ck\_ud\_confirmed\_weight CHECK (status \<\> 'CONFIRMED' OR weight IS NOT NULL),

  \-- I16: CONFIRMED ∧ reportable \=\> source present

  CONSTRAINT ck\_ud\_i16\_source CHECK (

    NOT (status \= 'CONFIRMED' AND reportable)

    OR  (donor\_id IS NOT NULL OR donor\_label IS NOT NULL)

  )

);

Source discriminator is **derived** (`donor_id` → master; `donor_label` → label; both NULL → anon), never stored. **Peer to WeightEntry (I18):** neither references the other; report/metrics union them, never nest.

**On-route guard (I29, service-layer):** if `shift_id` is non-null, `donor_id` must **not** match any `shift_stop.donor_id` of that shift (more food from a scheduled stop is additional WeightEntry rows, not an UnscheduledDonation). Cross-table → not CHECK-expressible.

**SUGGESTED lifecycle (I17):** unconfirmed `SUGGESTED` rows are **hard-deleted** at the shift's receive-done or edit-window expiry (zero ledger value). Allowed because a SUGGESTED row has no children.

---

## 8\. Report & metrics day (grouping anchor)

The report/metrics views (owned by the reporting doc) union two entities with no shared date column. **Anchor on a business day, never on `created_at`/`updated_at`** (those are entry/edit instants and mis-bucket when receiving lags past midnight or a `reportable` toggle fires later):

report\_day(weight\_entry)         \= shift.occurrence\_date            \-- via join; no duplicated column (derived-vs-stored)

report\_day(unscheduled\_donation) \= unscheduled\_donation.received\_date

`received_date` is stored NOT NULL (set by the service to the pantry-local arrival day; \= `shift.occurrence_date` for driver-adds, the receive day for walk-ins) so the union is branch-uniform.

Two distinct numbers (`01` "Intake ≠ NTFB-reported", PRD §3):

report  \= weight\_entry\[NOT voided\]  ∪  unscheduled\_donation\[CONFIRMED ∧ reportable\]

metrics \= weight\_entry\[NOT voided\]  ∪  unscheduled\_donation\[CONFIRMED\]            \-- ignores reportable

Neither may filter the union on `shift` (walk-ins have none). Grouping is `report_day × category × donor-or-label`; anonymous walk-ins collapse to one "unattributed" bucket (decision 1 surfacing).

---

## 9\. Concurrency & locking (decision 3\)

- **No `version` column anywhere.** No `SELECT ... FOR UPDATE` on common paths.  
- **Lifecycle transitions \= state-predicate conditional UPDATE.** The precondition *is* the optimistic check; `rowcount = 0` \= lost race / stale state.  
    
  \-- claim (OPEN \-\> CLAIMED). Eligibility (I20) checked service-side BEFORE this UPDATE.  
    
  UPDATE shift SET owner\_id=:me, status='CLAIMED', updated\_by=:me, updated\_at=now()  
    
  WHERE id=:id AND status='OPEN' AND owner\_id IS NULL;       \-- 0 rows \=\> "no longer available"  
    
  \-- start (CLAIMED \-\> IN\_PROGRESS): same txn picks truck \+ snapshots ShiftStops  
    
  UPDATE shift SET status='IN\_PROGRESS', truck\_id=:truck, updated\_by=:me, updated\_at=now()  
    
  WHERE id=:id AND status='CLAIMED' AND owner\_id=:me;  
    
  \-- cancel (OPEN|CLAIMED \-\> CANCELLED): predicate enforces I9 (never from IN\_PROGRESS/COMPLETED); owner cleared (01 §2.2)  
    
  UPDATE shift SET status='CANCELLED', owner\_id=NULL, updated\_by=:me, updated\_at=now()  
    
  WHERE id=:id AND status IN ('OPEN','CLAIMED');  
    
- **No claim count cap exists** (corrected). The claim gate is `eligible()` (I20: Drive duty ∧ no overlapping AvailabilityBlock ∧ no overlapping owned CLAIMED/IN\_PROGRESS shift), enforced service-side at claim time, block-declaration, and materialization.  
- **Receive-done (I11/I12)** and **pickup milestone (I27)** run their cross-row gates in the service layer, then transition.  
- **Field edits \= LWW** (`reportable` toggle, stop reorder, `donor_label` fix): last write wins, `updated_at`/`updated_by` stamped. Acceptable at \<10 concurrency (PRD §6).  
- **Materialization insert** is retry-safe via `uq_shift_occurrence` \+ `ON CONFLICT DO NOTHING`.

---

## 10\. AvailabilityBlock (eligibility input)

CREATE TABLE availability\_block (

  id         uuid PRIMARY KEY DEFAULT gen\_random\_uuid(),

  user\_id    uuid NOT NULL REFERENCES app\_user(id) ON DELETE RESTRICT,

  starts\_at  timestamptz NOT NULL,                  \-- whole-person, time-only (I19): NO route scope

  ends\_at    timestamptz NOT NULL,

  created\_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ck\_ab\_window CHECK (ends\_at \> starts\_at)

);

Whole-person, time-only (I19) — `01` deliberately dropped the PRD's route-scoped availability to keep eligibility a pure temporal overlap (`01 §5.2`, appendix). Overlap test: `b.starts_at < shift.ends_at AND shift.starts_at < b.ends_at` (half-open).

Shape ratified: `(user_id, starts_at, ends_at)`, no `route_id`. If route-scoped unavailability is ever needed, that is a change to `01` first (add nullable `route_id`, NULL \= all routes), then here.

---

## 11\. Notification persistence (co-owned with notifications doc)

Sketch only; delivery mechanics, event scheduling, and the fan-out matrix are the notifications doc's. The persisted state:

CREATE TABLE notification (

  id           uuid PRIMARY KEY DEFAULT gen\_random\_uuid(),

  recipient\_id uuid NOT NULL REFERENCES app\_user(id) ON DELETE RESTRICT,

  event        text NOT NULL,                        \-- event taxonomy owned by notifications doc

  payload      jsonb NOT NULL DEFAULT '{}',

  read\_at      timestamptz,                           \-- NULL \= unread (in-app inbox \= source of truth, PRD)

  created\_at   timestamptz NOT NULL DEFAULT now()

);

CREATE TABLE push\_subscription (

  id         uuid PRIMARY KEY DEFAULT gen\_random\_uuid(),

  user\_id    uuid REFERENCES app\_user(id) ON DELETE RESTRICT,  \-- NULL \= device-level (receiver tablet, truck-inbound only)

  endpoint   text NOT NULL,

  p256dh     text NOT NULL,

  auth       text NOT NULL,

  label      text,                                   \-- e.g. "receiver tablet"

  created\_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq\_push\_endpoint UNIQUE (endpoint)

);

Added in reconciliation. `user_id NULL` models the device-level receiver-tablet subscription (PRD §2: "a notification endpoint, not a login"). Recommend deferring final shape to the notifications doc; included here so the data model isn't silently incomplete.

---

## 12\. Indexes (consolidated)

\-- active-only pickers (I21 masters): partial on the soft-delete predicate

CREATE INDEX ix\_donor\_active    ON donor    (id) WHERE deactivated\_at IS NULL;

CREATE INDEX ix\_category\_active ON category (id) WHERE deactivated\_at IS NULL;

CREATE INDEX ix\_truck\_active    ON truck    (id) WHERE deactivated\_at IS NULL;

CREATE INDEX ix\_route\_active    ON route    (id) WHERE deactivated\_at IS NULL;

CREATE INDEX ix\_user\_active     ON app\_user (id) WHERE deactivated\_at IS NULL;

\-- WEIGHED-EXISTS (I12) \+ per-(shift,donor) SUM-on-read

CREATE INDEX ix\_weight\_active   ON weight\_entry (shift\_id, donor\_id) WHERE voided \= false;

\-- shift board (claim) \+ date-scoped queries

CREATE INDEX ix\_shift\_open      ON shift (occurrence\_date) WHERE status \= 'OPEN';

CREATE INDEX ix\_shift\_date      ON shift (occurrence\_date);

CREATE INDEX ix\_shift\_owner     ON shift (owner\_id) WHERE owner\_id IS NOT NULL;  \-- "my shifts" \+ overlap checks

\-- intake reporting/metrics filters (CONFIRMED serves metrics; report adds reportable)

CREATE INDEX ix\_ud\_confirmed    ON unscheduled\_donation (received\_date, category\_id) WHERE status \= 'CONFIRMED';

\-- eligibility overlap probe (btree fine at this scale; GiST on tstzrange if availability volume grows)

CREATE INDEX ix\_ab\_user\_window  ON availability\_block (user\_id, starts\_at, ends\_at);

\-- inbox

CREATE INDEX ix\_notif\_unread    ON notification (recipient\_id, created\_at) WHERE read\_at IS NULL;

\-- FK indexes (PG does NOT auto-index FKs; needed for joins \+ RESTRICT delete checks). Add on:

\--   route\_stop(route\_id), shift(route\_id, recurrence\_pattern\_id, truck\_id, created\_by),

\--   shift\_stop(shift\_id), weight\_entry(category\_id, created\_by), unscheduled\_donation(shift\_id, donor\_id, category\_id),

\--   recurrence\_pattern(route\_id, owner\_default\_id, created\_by), user\_duty(user\_id via PK)

\--   (donor-bearing FKs are covered by the UNIQUE/partial indexes above)

---

## Candidate invariants for CLAUDE.md

1. All instants `timestamptz`; one pantry tz in `app_config.timezone` (IANA, DST-aware). Never a fixed offset, never naive `timestamp`.  
2. Soft-delete \= `deactivated_at` (`NULL`\=active) on Donor/Category/Truck/User (I21). Active reads filter `deactivated_at IS NULL`.  
3. Every FK `ON DELETE RESTRICT` — this **is** the I21 history guard. `created_by`/`updated_by` are real, `NOT NULL` FKs (I26) → a stamped user can't be hard-deleted.  
4. Minted `shift.created_by = recurrence_pattern.created_by`. No system user. Minted ⇔ `recurrence_pattern_id IS NOT NULL`.  
5. `shiftstop_disposition` ∈ {PENDING,COLLECTED,SKIPPED}; `WEIGHED` derived (I12) via EXISTS over non-voided WeightEntry, never stored.  
6. WeightEntry value columns immutable; sole mutation is void (`false→true`, once). Totals \= `SUM(weight) WHERE NOT voided` (I13). Never store a running total.  
7. UnscheduledDonation: `donor_id` XOR `donor_label` XOR neither; `CONFIRMED ⇒ weight`; `CONFIRMED ∧ reportable ⇒ source` (I16). `shift_id` is 0..1 (driver-add has one, walk-in NULL).  
8. `report = weight_entry[¬voided] ∪ unscheduled_donation[CONFIRMED ∧ reportable]`; `metrics` drops the `reportable` filter. Never filter the union on shift. Day \= `shift.occurrence_date` / `unscheduled_donation.received_date`.  
9. Recurrence idempotency: `UNIQUE(recurrence_pattern_id, occurrence_date)`, NULLS DISTINCT; job inserts `ON CONFLICT DO NOTHING`. Born-CLAIMED only if `owner_default_id` set ∧ `eligible()` (I25).  
10. Cross-pattern duplicate-run identity is a soft warn at pattern create/edit, never a constraint; the rolling job never conflict-checks.  
11. No `version` column. Lifecycle via state-predicate UPDATE (`rowcount 0` \= lost); cancel predicate `status IN ('OPEN','CLAIMED')` enforces I9. Field edits LWW. No claim count cap; claim gate is `eligible()` (I20).  
12. `UNIQUE(parent, donor)` on route\_stop/shift\_stop \= I28. Integer `position`, deferrable unique, renumber-in-txn.  
13. I29 (on-shift walk-in donor ≠ a ShiftStop donor) and the I12/I27 completion/handoff gates are service-layer (cross-table/cross-row, non-declarative).  
14. `username` `text`, lowercase `[a-z0-9]` non-empty, UNIQUE across deactivated users, immutable (I3).  
15. Truck: no exclusivity (I22), no unique time-binding. AvailabilityBlock: whole-person, time-only (I19).

---

## Cross-doc dependencies

- **03-architecture:** materialization job (reads `app_config.horizon_days` \+ `timezone`; converts local rule times → instants DST-aware; `ON CONFLICT DO NOTHING`; born-CLAIMED via `eligible()`); auth/session boundary owns `app_user` credential (PIN/password by tier) \+ PII columns; service-layer transition guards (I9/I10/I11/I12/I27) and `eligible()`.  
- **04-api:** endpoint contracts for claim/start/receive-done/weigh/skip/void/confirm/reportable-toggle.  
- **05-workflow:** duplicate-run soft-warn flow (proceed/skip-dates/cancel) at pattern create/edit; receive worklist via WEIGHED-EXISTS; pickup-complete handoff sets `pickup_completed_at`; SUGGESTED purge at receive-done/window expiry (I17).  
- **06-uiux:** `reportable` toggle default+visibility; off-route donor warning (WeightEntry donor not in snapshot); board preview beyond horizon (read-only, no rows); active-only pickers rely on `deactivated_at IS NULL`.  
- **Reporting doc:** owns `report`/`metrics` view definitions and MISSED/UNCLAIMED/NO\_SHOW derivations; consumes the day-anchor \+ union shape in §8.  
- **Notifications doc:** owns event taxonomy, fan-out matrix, scheduling; consumes `notification`/`push_subscription` (§11).  
- **01-domain (canonical, locked):** full attribute lists, state machines, I1–I29. This doc transcribes value-sets into DDL; on any mismatch, `01` wins.

---

## Divergences to fold into `01` / PRD (extends the locked docs; track so they don't drift)

1. **`01 §3.3`** — add Route to the master-data lifecycle: archive (`deactivated_at`) \+ hard-delete when unreferenced.  
2. **I26 (provenance set)** — note that `RecurrencePattern` also carries `created_by` (physical requirement of the decision-2 minted-shift stamp).  
3. **PRD capability 7** — strike "scoped to a specific recurring route or to all routes"; availability is whole-person/time-only, matching I19.

