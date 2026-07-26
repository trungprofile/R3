# R3 \- Domain Modeling 

**Status:** locked for build. **Owns:** the conceptual model — ubiquitous language, entities \+ relationships (cardinalities), state machines, hard invariants, and the three named algorithms. **Does not own:** column types / nullability / indexes / physical schema (→ data-model doc), endpoint shapes (→ API doc), screens (→ UI doc), the report and metrics (→ reporting doc), auth/sessions (→ access doc).

---

## Purpose

Defines *what the R3 things are*, how they relate, how they change state, and the rules that must always hold. This is the source of truth the builder reads before any schema, endpoint, or screen. The PRD owns *what/why*; this doc owns the *technical how* of the domain only.

---

## 1\. Glossary

| Term | Meaning |
| :---- | :---- |
| **User** | Any account in the system. |
| **Tier** | Access level: `Volunteer ⊂ Staff ⊂ Admin`. Exactly one per user, hierarchical. (Enum attribute, not an entity.) |
| **Duty** | Capability flag: `Drive` / `Receive` / `Report`. A user holds any subset (0–3). |
| **Driver** | A User holding the `Drive` duty. A role, not its own entity. |
| **Donor** | A grocery store (or other source) that donates. Admin-managed master data: editable, and soft-deleted (not removed) once it has history. |
| **Route** | An ordered list of Donors to visit. Reusable template. |
| **RouteStop** | A Donor's position within a Route (template-side). |
| **Shift** | One dated, claimable pickup **and** its execution (route, owner, status, truck, notes). UI label: "pickup shift". |
| **ShiftStop** | A RouteStop **as executed** within a Shift (resolution state). Snapshot of the RouteStop, not a live pointer to it. |
| **Truck** | Vehicle selected at Shift start. |
| **AvailabilityBlock** | A Driver's unavailability window. Whole-person, time-only. |
| **RecurrencePattern** | The rule that generates repeating Shifts. |
| **WeightEntry** | Weight logged at receive, per Donor \+ Category, tied to a Shift. The **planned** intake path. |
| **UnscheduledDonation** | Intake **not** on the staff's planned route (ad-hoc store call, walk-in). |
| **Category** | Admin-managed food category used to bucket weights. |
| **Notification** | A push/alert sent to a User. |

---

## 2\. Entities & relationships

### 2.1 Entity catalog

`User`, `Donor`, `Route`, `RouteStop`, `Shift`, `ShiftStop`, `Truck`, `AvailabilityBlock`, `RecurrencePattern`, `WeightEntry`, `UnscheduledDonation`, `Category`, `Notification`, plus `Duty` (fixed enum surfaced as an M:N). `Tier` is a single-valued enum attribute on `User`, not an entity.

### 2.2 Cardinalities

Read as **left : right** (instances of left per one right ; instances of right per one left).

| Relationship | Card | Note |
| :---- | :---- | :---- |
| `User` — holds — `Duty` | 0..N : 0..3 | M:N over the fixed `{Drive, Receive, Report}` enum. |
| `User` — owns — `Shift` | 0..1 : 0..N | Open shift has no owner. Owner null until claimed, back to null on release/cancel. |
| `User` — declares — `AvailabilityBlock` | 1 : 0..N |  |
| `User` — receives — `Notification` | 1 : 0..N |  |
| `Route` — contains — `RouteStop` | 1 : 1..N | A route has at least one stop. |
| `Donor` — listed in — `RouteStop` | 1 : 0..N | ≤1 RouteStop per Donor within a Route (I28). |
| `Route` — plans — `Shift` | 1 : 0..N | Route bound at schedule time. Required on every shift. |
| `RecurrencePattern` — generates — `Shift` | 0..1 : 1..N | One-off shift has no pattern. |
| `Truck` — assigned — `Shift` | 0..1 : 0..N | Truck null until start. |
| `Shift` — has — `ShiftStop` | 1 : 0..N | Zero stops until start, then frozen snapshot. |
| `Donor` — at — `ShiftStop` | 1 : 0..N |  |
| `Shift` — produces — `WeightEntry` | 1 : 0..N |  |
| `Donor` — credits — `WeightEntry` | 1 : 0..N | Donor required on a WeightEntry. |
| `Category` — buckets — `WeightEntry` | 1 : 0..N |  |
| `Shift` — context of — `UnscheduledDonation` | 0..1 : 0..N | Set if it arrived on a run; null for walk-in. |
| `Donor` — attributed — `UnscheduledDonation` | 0..1 : 0..N | Optional; may instead be free-text label or null. |
| `Category` — buckets — `UnscheduledDonation` | 1 : 0..N |  |

**Provenance (attribute references, not first-class relationships):** `WeightEntry`, `UnscheduledDonation`, and `Shift` each reference a `User` as `created_by` and `updated_by` (last-writer only).

### 2.3 Entity contracts (the non-obvious rules)

**ShiftStop — snapshot, not a pointer.** At Shift start, the route's ordered RouteStops are **copied** into `ShiftStop` rows owned by the Shift. The snapshot freezes *which donors, in what order*. It keeps a **live `Donor` FK** (do not copy donor name/address). Consequence: editing a `Route` never alters a started or finished Shift's stops. Reorder / skip / weigh during the run mutate the snapshot, never the template.

**WeightEntry — grain, append-only, void-by-flag.** Keyed by `(Shift, Donor, Category)`. **No `ShiftStop` FK** (receiving is decoupled from the driver's per-stop check-off). The donor need not be in the snapshot (off-route donor allowed; UI warns, not a domain error). **Many rows allowed** per `(Shift, Donor, Category)`. Weight rows are **immutable**: a correction is **void-old \+ insert-new**, never an in-place edit. Void is a soft flag (`voided`, default `false`); voided rows are retained for audit and **excluded from every sum and derivation**. The total is `SUM(non-voided)` at read time. Never store a running total (avoids the lost-update problem under concurrent/reopened receiving).

**Intake split — planned vs. unplanned, by entity type.** `WeightEntry` \= food from a **planned** route stop (always NTFB-reportable). `UnscheduledDonation` \= food **not** on the staff's plan. Two sources:

- *Driver-add:* driver flags an ad-hoc pickup mid-run → creates a `SUGGESTED` UnscheduledDonation (prefill for the receiver). **Never writes a `ShiftStop` row**, so the planned route stays pristine and planned/unplanned is structurally distinguishable.  
- *Receiver standalone:* off-schedule donation the receiver logs directly (store call relayed to the dock, walk-in).

`reportable` follows a one-way implication: **scheduled ⇒ reportable** (every `WeightEntry` is reportable, so it carries no flag), but **unscheduled does not imply reportable** — a store-call is ON, a non-store walk-in is OFF. Default ON.

**UnscheduledDonation — shape.**

| Field | Rule |
| :---- | :---- |
| `Shift` | 0..1. Set when it arrived on a run; null for a true walk-in. |
| `Donor` | FK to master `Donor`, **or** free-text label, **or** null (anonymous). Free-text never auto-creates a master Donor. |
| `Category` | required |
| `weight` | null while `SUGGESTED`; required once `CONFIRMED`. |
| `reportable` | default ON. Receiver-editable in window, then Reporter only. |
| `status` | `SUGGESTED → CONFIRMED`. A `SUGGESTED` row only ever comes from a driver-add. |
| `note` | optional. |

**On-route donor guard.** If an `UnscheduledDonation` has a non-null `Shift`, its `Donor` must **not** already be a `ShiftStop` of that Shift. More food from a scheduled stop is additional `WeightEntry` rows (the grain already allows many per `(Shift, Donor, Category)`), not an unscheduled donation. Keeps planned/unplanned structurally disjoint (I29).

**WeightEntry and UnscheduledDonation are peers, not nested.** Both are weight records sharing a *grain* (donor-or-label, category, weight, day, reportable). An `UnscheduledDonation` is itself a weight record — it does **not** contain or reference a `WeightEntry`, and an unscheduled donation is still weighed and bucketed into a `Category` exactly like a scheduled one. Report and metrics **union** the two entities; they never nest. The shared shape is realized as a reporting view, not a shared entity (→ reporting doc).

**Notes — two levels.** `Shift.note` \= one run-level note (driver remarks about the whole run). Per-row `note` on both `WeightEntry` and `UnscheduledDonation`.

**Availability — whole-person, time-only.** No route scope. Eligibility is a pure time-overlap test.

**Soft-delete rule (applies to `Donor`, `Category`, `Truck`, `User`).** Has any referencing history → **soft-delete only** (deactivate/archive; hidden from new use; preserved everywhere referenced). Has no history → hard-delete permitted (fix a mistaken create). (Field edits — name, address, notes — are always allowed; soft-delete is only about removal.) For `User`, "referencing history" includes owned shifts, `created_by`/`updated_by` stamps, and any intake rows; auth/session mechanics live in the access doc.

**Truck.** `truck_name`, optional `plate`, `active` status. Inactive trucks hidden from driver selection. **No exclusivity invariant** — double-booking the same truck across concurrent shifts is allowed (soft, low-impact).

---

## 3\. State machines

### 3.1 Shift

Stored states: **`OPEN` → `CLAIMED` → `IN_PROGRESS` → `COMPLETED`**, plus **`CANCELLED`**. `MISSED` is **not** a stored state — it is a derived metric: **window passed ∧ state ∈ `{OPEN, CLAIMED}`** (passed without reaching `IN_PROGRESS`, and not `CANCELLED`). Owned by the reporting doc. Two sub-cases reporting splits: `OPEN`\-passed \= **UNCLAIMED** (no driver took it), `CLAIMED`\-passed \= **NO\_SHOW** (owner committed and flaked).

              claim            start            receive-done

   ●──▶ OPEN ───────▶ CLAIMED ───────▶ IN\_PROGRESS ───────▶ COMPLETED

          │             │  ▲                                (terminal)

          │   staff     │  │ release / availability conflict

          │   removes   │  │

          ▼             ▼  │

       CANCELLED ◀──────┘ (back to OPEN)

       (terminal)   staff cancels

| From | Event | To | Side effect |
| :---- | :---- | :---- | :---- |
| — | staff publishes | `OPEN` | Route bound (planned). No `ShiftStop` rows yet. |
| `OPEN` | driver claims | `CLAIMED` | Owner set. Recurring claim covers future instances (§5.3). |
| `OPEN` | staff removes | `CANCELLED` | — |
| `CLAIMED` | release / availability conflict | `OPEN` | Owner cleared. |
| `CLAIMED` | staff cancels | `CANCELLED` | — |
| `CLAIMED` | driver starts | `IN_PROGRESS` | Truck picked; route snapshots into `ShiftStop` rows. |
| `IN_PROGRESS` | **receiver** marks receive-done | `COMPLETED` | Requires completion gate (§3.2). Unconfirmed `SUGGESTED` donations deleted. |
| `OPEN` / `CLAIMED` | window passes, never started | *(derived `MISSED`)* | Not a transition; a reporting query. `OPEN`→UNCLAIMED, `CLAIMED`→NO\_SHOW. |

**Completion model (Option B — no auto-complete).**

- The **only** explicit completion action is the **receiver's** receive-done. The driver has no completion step.  
- `IN_PROGRESS` spans both driving and receiving (the system can't know when driving ends, so there is no separate `RECEIVING` state).  
- A shift may legitimately sit in `IN_PROGRESS` indefinitely. The **receiver edit window is time-based** (`N` days from start; `N` is ops config), then edits are Reporter-only. The same timer expiry also clears any lingering unconfirmed `SUGGESTED` rows.  
- **Abort.** An abandoned run (e.g. truck breakdown) with unresolved stops **remains `IN_PROGRESS`**; there is no abort-to-terminal transition, so closure still requires explicit per-stop resolution before receive-done.  
- A `COMPLETED` shift with **zero** non-voided weight is valid (empty run). Completion asserts "this run is closed," not "food was received."

**Pickup-complete milestone (within `IN_PROGRESS`, optional).**

- `Shift.pickup_completed_at` — nullable timestamp, set by an explicit driver tap ("done / heading back"). The tap doubles as a review screen (shift info \+ driver notes) before confirming.  
- **Gate:** it can be set only once every `ShiftStop ∈ {COLLECTED, SKIPPED}` (driver has resolved all assigned stops).  
- **Not a state, not a completion.** The shift stays `IN_PROGRESS`; only the receiver's receive-done closes it. This is a handoff signal, compatible with the PRD's "no driver completion step" (that rule is about *closing* the shift, not this milestone).  
- **Trigger:** setting it fires a notification to the Receiver(s) ("driver heading back"). Delivery mechanics → notifications doc.  
- **Optional:** a driver may never tap it; the receiver-resolves-`PENDING` fallback (§3.2) still applies. When tapped, the receiver inherits a shift with **no `PENDING` stops** — only `COLLECTED` ones left to weigh.

### 3.2 ShiftStop

One shared entity advanced by **two actors in sequence**: the driver during the run, the receiver at the dock.

                driver collects               receiver weighs

   PENDING ───────────────────▶ COLLECTED ───────────────────▶ WEIGHED

      │  │                          │                       (resolved, derived)

      │  │ driver skips             │ receiver: nothing came

      │  └──────────────┐          ▼

      │                 ▼      SKIPPED  (resolved, weight \= 0\)

      └─ receiver resolves a PENDING ShiftStop directly: weigh (→WEIGHED) or skip (→SKIPPED)

| State | Meaning | Set by |
| :---- | :---- | :---- |
| `PENDING` | Initial state, set when a RouteStop is snapshotted into a ShiftStop (Shift start, `CLAIMED → IN_PROGRESS`). | system |
| `COLLECTED` | Driver picked up; awaiting receiver. Intermediate. | driver |
| `WEIGHED` | Has ≥1 **non-voided** `WeightEntry` for its donor. Resolved. | derived: a non-voided `WeightEntry` exists |
| `SKIPPED` | No weight (treated as 0). Resolved. **No phantom zero row stored.** | driver **or** receiver |

- **Stored disposition ∈ `{PENDING, COLLECTED, SKIPPED}`.** `WEIGHED` is a read-time projection, **not** a stored value: a stop reads as `WEIGHED` iff a **non-voided** `WeightEntry` exists for `(shift, shiftstop.donor)`. No write ever sets `WEIGHED`; the weight lives on `WeightEntry`, never on `ShiftStop`.  
- **`SKIPPED` is an explicit stored disposition.** Driver-`SKIPPED` carries over to the receiver UI; the receiver does not re-skip it.  
- **Completion gate:** `Shift → COMPLETED` requires **every** `ShiftStop ∈ {WEIGHED, SKIPPED}`. No `PENDING` and no unweighed `COLLECTED` may remain. (Hard gate — guarantees no silently-dropped pickup reaches NTFB.)  
- Reorder is a position attribute, not a state.  
- Driver-side resolution — every `ShiftStop ∈ {COLLECTED, SKIPPED}` — is the gate for the pickup-complete milestone (§3.1). Distinct from the receive-side completion gate above (`{WEIGHED, SKIPPED}`): `COLLECTED` still needs the receiver to weigh it.

### 3.3 Master-data lifecycles (single toggle each)

Category   ACTIVE ⇄ ARCHIVED      archived: hidden from new entry, preserved in history/reports

Truck      ACTIVE ⇄ INACTIVE      inactive: hidden from driver selection

Donor      ACTIVE ⇄ DEACTIVATED   hard-delete only if zero referencing history

User       ACTIVE ⇄ DEACTIVATED   hard-delete only if zero referencing history (login/session → access doc)

---

## 4\. Invariants (consolidated)

IDENTITY

I1   Each User has exactly one Tier; tiers are hierarchical (Volunteer ⊂ Staff ⊂ Admin).

I2   A User holds 0..3 Duties from {Drive, Receive, Report}.

I3   username is unique, immutable after creation, lowercase \[a-z0-9\], never empty.

     A deactivated (soft-deleted) user's username stays reserved (no reuse, no renumber);

     a hard-deleted zero-history account frees its username (harmless — nothing referenced it).

ROUTE / SNAPSHOT

I4   Every Shift is bound to exactly one Route at schedule time.

I5   ShiftStop rows exist only from IN\_PROGRESS onward; they are a frozen snapshot of the

     route's ordered RouteStops at start (donor refs \+ order frozen; live Donor FK kept).

I6   Editing a Route never alters the ShiftStops of an already-started or finished Shift.

SHIFT LIFECYCLE

I7   Shift states are OPEN, CLAIMED, IN\_PROGRESS, COMPLETED, CANCELLED. MISSED is derived.

I8   Truck is null before IN\_PROGRESS.

I9   No transition into CANCELLED from IN\_PROGRESS or COMPLETED (cancel-guard).

I10  COMPLETED, CANCELLED are terminal.

I11  The only completion action is the receiver's receive-done. No auto-complete.

I12  Shift → COMPLETED requires every ShiftStop ∈ {WEIGHED, SKIPPED}.

INTAKE

I13  WeightEntry is keyed (Shift, Donor, Category), has no ShiftStop FK, and is append-only.

     Weight rows are immutable; corrections are void-old \+ insert-new. Voided rows are retained

     but excluded from every sum/derivation; totals are SUM(non-voided)-on-read, never stored.

I14  Planned intake → WeightEntry. Unplanned intake → UnscheduledDonation. A driver-add

     never creates a ShiftStop row.

I15  scheduled ⇒ reportable (one-way): every WeightEntry is reportable and needs no flag.

     Only UnscheduledDonation carries a reportable flag (default ON); unscheduled does NOT

     imply reportable (store-call \= ON, walk-in \= OFF).

I16  CONFIRMED ∧ reportable=true ⇒ (Donor FK or donor\_label non-null) ∧ weight non-null.

I17  A SUGGESTED UnscheduledDonation originates only from a driver-add; unconfirmed

     SUGGESTED rows are deleted at that shift's receive-done (or edit-window expiry).

I18  WeightEntry and UnscheduledDonation are peer weight records; neither references the

     other. Report/metrics union them, never nest.

AVAILABILITY / ELIGIBILITY

I19  AvailabilityBlock is whole-person and time-scoped only (no route scope).

I20  An owned CLAIMED/IN\_PROGRESS shift never time-overlaps another owned CLAIMED/IN\_PROGRESS

     shift of the same driver, nor any of that driver's AvailabilityBlocks. Enforced at three

     points: claim time (gate), new-block declaration (gate — rejected if it overlaps an owned

     CLAIMED or IN\_PROGRESS shift; driver must cancel/release that shift first), and

     materialization (born-CLAIMED only if eligible).

MASTER DATA

I21  Donor / Category / Truck / User: soft-delete (deactivate) if any referencing history,

     else hard-delete OK. Field edits are always allowed (soft-delete governs removal only).

I22  No exclusivity on Truck assignment (double-booking allowed).

RECURRENCE

I23  Per-instance edit / cancel / release never mutates the RecurrencePattern.

I24  The pattern changes only via an explicit pattern-level edit.

I25  Newly-materialized instances inherit pattern defaults; an instance is born CLAIMED only if

     ownerDefault is set AND eligible() holds for that instance, else born OPEN. Thereafter each

     instance is independent.

PROVENANCE

I26  WeightEntry, UnscheduledDonation, and Shift carry last-writer created\_by / updated\_by.

PICKUP HANDOFF

I27  Shift.pickup\_completed\_at (nullable) may be set only when every ShiftStop ∈

     {COLLECTED, SKIPPED}. It does NOT change the Shift state (stays IN\_PROGRESS) and does

     NOT complete the shift. Setting it triggers a Receiver notification.

DONOR UNIQUENESS

I28  A Donor appears at most once per Route, hence at most once among a Shift's ShiftStops.

I29  An UnscheduledDonation with non-null Shift must not reference a Donor that is a ShiftStop

     of that Shift (on-route food → WeightEntry; UnscheduledDonation is off-plan only).

---

## 5\. Named algorithms

### 5.1 Username generation \+ collision

normalize(s):

    NFKD decompose, strip combining marks (José → jose)

    lowercase

    keep \[a-z0-9\] only (drop spaces, punctuation, hyphens, apostrophes)

    \# "O'Brien-Núñez" → "obriennunez"

generate\_username(first, last):

    base \= normalize(first) \+ normalize(last)

    if base \== "":              base \= "user"          \# all-punctuation / non-Latin fallback

    if base is free:            return base

    k \= 2

    while (base \+ str(k)) is taken:  k \+= 1            \# check the FULL assembled string

    return base \+ str(k)

- **Collision is on the final string**, so the suffix shares the namespace: if `johnsmith2` already exists (literally or generated), the next John Smith becomes `johnsmith3`. Creation order falls out automatically.  
- **"taken" includes deactivated users** → handles stay reserved, no reuse, no renumber (ties to I3 / I21).  
- Concurrency: two simultaneous creates can race for the same `k`. Enforce uniqueness at the storage layer and retry on conflict. *(→ data-model doc.)*

### 5.2 Eligible-driver

window     \= \[start, end)                       \# half-open, pantry-local time

overlap(A,B) := A.start \< B.end AND B.start \< A.end

eligible(driver, shift):

    return  Drive ∈ driver.duties

        AND  no AvailabilityBlock b of driver with overlap(b, shift.window)

        AND  no other shift S, S ≠ shift, owned by driver,

             S.state ∈ {CLAIMED, IN\_PROGRESS}, with overlap(S.window, shift.window)

**When it runs:**

- *Claim time* — a gate; an ineligible driver cannot claim.  
- *Availability declaration* — a gate, not a side-effecting sweep: a driver cannot **save** an `AvailabilityBlock` that overlaps a shift they already own in state `CLAIMED` or `IN_PROGRESS`. The save is rejected; the driver must cancel/release the owned shift first (I9 still blocks cancelling `IN_PROGRESS`, so in that case the block simply cannot be declared until the run finishes). This mirrors I20/I2: an owned shift never overlaps availability, by construction, never by auto-release.  
- `COMPLETED` / `CANCELLED` owned shifts are excluded by the state filter — availability may freely overlap them.  
- Over recurring series, "another owned shift" means another **concrete materialized** instance (§5.3).

### 5.3 Recurrence materialization — eager-to-horizon

RecurrencePattern

  rule          weekly on {days} \+ time-of-day \+ route

  ownerDefault  0..1 User      \# "claim all future" sets this

  endDate       optional       \# staff: "runs until Dec 20"  |  null \= open-ended (domain)

  active        bool

horizon \= system config, LOCKED at \~1 year, rolling. NOT a domain field. (→ ops / data-model.)

Materialization (rolling job):

  for each active pattern:

    for each occurrence date D in \[now, horizon\]:

        if pattern.endDate and D \> pattern.endDate:  stop this pattern

        if no Shift exists for (pattern, D):

            create Shift(pattern, D)

            if ownerDefault set AND eligible(ownerDefault, this Shift):  born CLAIMED

            else:                                                        born OPEN

- **Born-CLAIMED is gated, not automatic.** Two paths create owned instances: `claim-all` (flips existing future OPEN rows) and this rolling job (mints newly-in-range rows). Both run `eligible()` per instance so I20 holds by construction. Without the gate here, a block declared *before* its conflicting instance is materialized would never be checked against that instance (the row didn't exist yet), and the job would mint a born-CLAIMED shift overlapping the owner's own availability.  
- **Two stop conditions, different owners:** `endDate` is staff/domain ("series is over"); `horizon` is system/storage ("rows pre-built this far"). A no-`endDate` pattern regenerates out to `horizon` forever, one window at a time.  
- **Beyond the horizon:** the board may show **read-only computed previews** from the pattern (no rows, not individually claimable). Board navigation range is decoupled from the materialization horizon — staff can look arbitrarily far ahead; the system only materializes to `horizon`.

Operations (all plain row writes — no virtual expansion):

  claim-all    set ownerDefault \= driver; set owner on existing future OPEN instances → CLAIMED

               (eligible() checked per instance; overlapping conflicts skipped, not claimed)

  release-one  one instance CLAIMED → OPEN; ownerDefault unchanged

  edit-one     mutate that single Shift row; pattern untouched

  bulk-cancel  CANCELLED on instances in \[from, to\]; pattern still generates beyond the range

(See invariants I23–I25.)

---

## 6\. Candidate invariants for CLAUDE.md

Global rules this section revealed, to promote into the project-wide builder contract:

1. `ShiftStop` is a frozen snapshot taken at Shift start; route edits never alter a started/finished shift (I5, I6).  
2. Intake is append-only; totals are SUM-on-read; never store a running total (I13).  
3. `reportable = true ⇒ source (donor FK or label) and weight are non-null` (I16).  
4. Master data with history is soft-deleted only; hard-delete is for zero-history mistakes only (I21).  
5. A Shift completes only via the receiver's receive-done; no auto-complete (I11).  
6. A Shift cannot complete until every ShiftStop is `WEIGHED` or `SKIPPED` (I12).  
7. Never transition into `CANCELLED` from `IN_PROGRESS` or `COMPLETED` (I9).  
8. `username` is unique, immutable, lowercase, and never reused while a user is deactivated (I3).  
9. No driver may hold two time-overlapping active shifts, nor a shift overlapping their availability (I20).  
10. Per-instance recurrence operations never mutate the pattern (I23).

---

## 7\. Cross-doc dependencies

| Concern | Owns | This doc depends on it for |
| :---- | :---- | :---- |
| **Data model (02)** | Column types, nullability, indexes, unique/`username` constraint, concurrency/optimistic locking on intake, soft-delete implementation, the polymorphic `Donor` FK \+ free-text label, materialization `horizon` config. | Physical enforcement of every invariant here. |
| **API** | Endpoint shapes. | Claim / start / receive-done / weigh / skip operations. |
| **UI** | Screens; receiver worklist; the `reportable` toggle's default \+ visibility (now load-bearing for NTFB accuracy); board preview beyond horizon; off-route donor warning. | Surfacing snapshots, suggestions, and the completion gate. |
| **Reporting** | The NTFB report and all metrics. `report = WeightEntry[voided = false] ∪ UnscheduledDonation[CONFIRMED ∧ reportable]`. The report query **must not filter on `Shift`** (walk-ins have none). Metrics union everything. `MISSED = passed ∧ state ∈ {OPEN, CLAIMED}`, split UNCLAIMED (OPEN) vs NO\_SHOW (CLAIMED). | Definition of reportable intake. |
| **Access & Sessions** | Auth (PIN/password by tier), sessions, inactivity timeout, who-can-edit-when enforcement, the `User` behind `created_by`. | Identity that `created_by` / ownership reference. |
| **Notifications** | Delivery mechanics; reminder scheduling. | Reminders require materialized near-term instances (§5.3). |
| **Audit (deferred)** | Full edit history (every intermediate value). | Only `last-writer` is modeled here; promote to a full trail only if NTFB disputes require it. |

---

## Appendix — resolved decisions (why the model looks like this)

Short log of the calls made during design, for a human reviewer. Stripped when condensing to CLAUDE.md.

- **Donor, not Store** — one master entity; "store" was an overloaded synonym. Admin-editable; soft-deleted once it has history.  
- **Shift \= schedule \+ execution merged** — one entity; execution fields sit null until start.  
- **ShiftStop ≠ RouteStop** — execution snapshot vs. template; forced by report traceability \+ mid-run reorder/skip. Named to parallel RouteStop.  
- **WeightEntry grain `(Shift, Donor, Category)`, no ShiftStop FK** — receiving is dock-side and decoupled from per-stop check-off.  
- **WeightEntry and UnscheduledDonation are peers** — same grain, unioned for reporting, never nested; an unscheduled donation is its own weight record.  
- **Availability is whole-person, time-only** — drivers block times, not routes; keeps eligibility a pure temporal test.  
- **Intake split \= planned (`WeightEntry`) vs unplanned (`UnscheduledDonation`)** by entity type; `reportable` is a separate flag on `UnscheduledDonation`, not the discriminator. scheduled ⇒ reportable (one-way).  
- **Driver-add never writes a ShiftStop** — keeps the staff plan pristine so planned/unplanned is structural.  
- **`origin` (driver vs receiver) dropped**; `status` (SUGGESTED/CONFIRMED) kept as the prefill lifecycle.  
- **No auto-complete (Option B)** — completion is the receiver's receive-done only; edit window is time-based.  
- **Pickup-complete milestone added as a flag** (`pickup_completed_at`), not a state — explicit driver tap, gated on all stops resolved, fires the "driver heading back" notification. Reverses the earlier "no handoff state" call: that assumed no driver signal existed, and this adds one. Stays a flag (not a 6th state) because the milestone is optional.  
- **Completion gate is hard** — every planned ShiftStop must be WEIGHED or SKIPPED before COMPLETED.  
- **Recurrence \= eager-to-horizon, horizon locked at \~1 year** — rows are nearly free at this scale; virtual/hybrid is over-engineering and doesn't even escape the horizon (reminders force one).  
- **WeightEntry void \= soft flag, not hard-delete or reversing entry** — ledger rows feed an externally-reported (NTFB) number, so retractions stay as audit evidence; void-flag keeps SUM(non-voided)-on-read simple and avoids the lost-update risk a running total would create. Hard-delete reserved for zero-ledger-value rows (unconfirmed SUGGESTED, zero-history master data).  
- **WEIGHED is a derived projection, not a stored disposition** — stored set is {PENDING, COLLECTED, SKIPPED}; WEIGHED computed from a non-voided WeightEntry. Prevents a stored 'WEIGHED' from passing the completion gate on a voided-then-abandoned weight.  
- **Born-CLAIMED gated by eligible() at materialization** — closes the I20 hole where a block declared before its instance is materialized would otherwise escape the eligibility check. Same gate as claim-all, applied at both creation paths.  
- **Availability declaration is always a gate, never a side-effecting release** — a block overlapping an owned CLAIMED or IN\_PROGRESS shift is rejected outright; the driver must cancel/release that shift first (CLAIMED case) or wait for it to finish (IN\_PROGRESS, since I9 blocks cancelling it). No availability save ever auto-changes a shift's state.  
- **MISSED \= passed ∧ state ∈ {OPEN, CLAIMED}** — includes never-claimed (UNCLAIMED), not just claimed-no-show (NO\_SHOW); excludes CANCELLED (a deliberate non-pickup, not a miss).  
- **Abort stays IN\_PROGRESS** — no abort-to-terminal transition; an abandoned run is closed only by explicit per-stop resolution, keeping it distinguishable from a normal empty run.  
- **Donor uniqueness (I28) \+ on-route guard (I29)** — a Donor is at most one stop per route/shift, and an on-shift UnscheduledDonation cannot reuse a scheduled donor; keeps WEIGHED-by-donor well-defined and planned/unplanned disjoint.

