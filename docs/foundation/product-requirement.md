# R3 — Product Requirement

## 1. Problem & Vision

**Problem.** AGFP runs weekly food rescues from grocery donors (Kroger, Target, others) under North Texas Food Bank (NTFB), its mother agency. Today the entire loop runs on paper and phone calls, and it breaks in four places:

- **Rescue.** Routes are assigned on a paper calendar and adjusted by word of mouth. Drivers have no way to see what's scheduled or to volunteer for open runs, so coordination is entirely push: the coordinator assigns everyone and manually chases replacements when someone drops. Available drivers are invisible to the system. Surprise, unscheduled donations are common but get scribbled on paper that downstream staff must re-record or remember.  
- **Receive.** Receivers do not know when a truck is returning, so they drop what they are doing and scramble to unload so the driver's next route is not stalled.  
- **Report.** One person spends hours each week collecting weight sheets, summing categories by hand in Excel, remapping AGFP categories to NTFB's, and entering the portal report. Lost or illegible sheets force guessing or misreporting. The math is repetitive and error-prone.  
- **Admin.** No granular per-store metrics, so leadership cannot see recurring patterns (e.g., a store consistently under-donates) and cannot make informed sourcing decisions.

**Vision.** R3 replaces the paper-and-phone loop with a single system of record for the rescue cycle. Coordinators publish driver shifts (one-off and recurring); a shared board shows every shift and its owner, and drivers self-select open runs or declare unavailability so gaps surface before a pickup is at risk. Drivers start their already-routed shift, pick a truck, and log surprises in-app instead of on paper. Receivers are notified when a truck is inbound and enter weights directly. At week's end the report is already calculated and inspectable down to a single store-category-day, so the reporter files NTFB numbers in minutes instead of hours, and admins read per-store metrics to make sourcing decisions.

## 2. Users & Roles

R3 separates two independent axes: an **access tier** (exactly one per user, strictly hierarchical) that gates administrative permissions, and a set of **duties** — `drive`, `receive`, `report` — assigned per user and orthogonal to tier, that gate operational actions. Every operational volunteer, along with all Staff and Admins, has a single user account; there is no separate person-vs-account distinction.

**Access tiers** (Volunteer ⊂ Staff ⊂ Admin):

| Tier | Can do | Cannot do |
| :---- | :---- | :---- |
| **Volunteer** | See own personal info, shifts, and assignments. Perform any operational duty assigned to them (`drive`, `receive`, and/or `report`). | Manage accounts; see anyone else's PII; create/delete donors; reassign other people's shifts. |
| **Staff** | Everything a Volunteer can, plus operational coordination: publish shifts, assign/reassign drivers, reschedule shifts, view operational status across all volunteers (availability, assignments, **and contact details — a coordinator has to be able to phone the driver**). | Manage accounts; assign access tiers; **edit** anyone's phone/address; create/delete permanent donors. |
| **Admin** | Everything Staff can, plus the Admin-only delta: account lifecycle (create/delete non-admin accounts, assign tiers and duties), **editing** anyone's phone/address, donor & truck master data, metrics review. | — |

- **"Coordinator"** is not a separate role or schema flag — it's the notification matrix's name for every user holding Staff tier (Staff ⊆ Admin also qualifies). Fan-out to "Coordinator" means fan-out to all active Staff-tier-and-above users, however many that is at a given deployment; §6's "1 coordinator (Clark)" is this org's current headcount, not a distinct concept from Staff.

- **"PII"** here means phone number and address — the things a Volunteer shouldn't see about someone else. It does **not** include name: names are public-within-org by design (shown on the shared login screen so anyone can find their own account, and on the shared shift board so drivers see who owns each run). Only phone/address are gated to Staff-tier-and-above.

  **Seeing is not editing.** Staff *see* everyone's phone and address, because coordinating a run means being able to call the driver; only Admin can *change* them, as part of account lifecycle. Everyone always sees their own. The role table above stated this the other way round until 2026-07-28 and was corrected — `architecture.md §4.3` (`viewer.tier >= STAFF` OR `viewer.id == subject.id`) had it right, and is the enforcement point.

**Duties**. Three operational duties — drive, receive, report — are assigned per user, independently of tier. A user sees the duties they hold and, where a duty has a dedicated workflow on a shared device, chooses which duty they are performing.

- **drive** — self-select or be assigned pickup shifts, see the shared shift board, receive shift notifications, use the in-app driver view (route/store details, truck selection, stop check-off, pickup notes).  
- **receive** — enter weights at the receiver tablet.  
- **report** — generate and file the NTFB report.

Duties are orthogonal to tier: a Volunteer may hold any combination, and `report` is **not** tier-restricted — any user holding it can file. A single user combining tier and duties (e.g., a Staff member who also drives) uses one account for everything.

**Accounts & login.** Usernames are auto-generated as `firstname` + `lastname`, normalized (lowercased, diacritics and punctuation stripped). On collision, a numeric suffix (`2..n`) is appended in account-creation order; a username is immutable once assigned (a later deletion never renumbers anyone). Authentication is by access tier: Volunteers use a 4-digit PIN (defaulting to the last four digits of their phone number); Staff and Admins use a password.

**Shared devices.** The receiver tablet and reporter desktop are shared *physical devices*. Each user logs in personally to weigh or to report, and a session ends by manual logout or inactivity timeout. The receiver tablet additionally holds a device-level push subscription used only for the truck-inbound alert; this is a notification endpoint, not a login, and it fires regardless of who (if anyone) is logged in.

## 3. Capabilities & Scope

### Administration

> Capability numbers are permanent identifiers assigned in order of introduction, not reading order — every other doc cites them by number, so they are never renumbered when a capability is added to an existing group. Cap 17 sitting among caps 1–3 is expected, not an error.

| # | Capability |
| :---- | :---- |
| 1 | **Account management** — Admin creates/deletes non-admin accounts, assigns access tiers and duties. |
| 2 | **Donor management** — Admin maintains permanent store donors (master data). |
| 3 | **Truck management** — Admin maintains the truck list. A truck is a selectable entity chosen by the driver at route start (identity + attribution only). Telemetry, mileage, and maintenance are out of scope. |
| 17 | **Category management** — Admin maintains the list of weight-entry categories (master data): add a category, archive one (hidden from new entry, preserved in history/reports). Seeded with the 11 AGFP categories at launch; not a fixed enum. |

### Driver scheduling & coordination

| # | Capability |
| :---- | :---- |
| 4 | **Shift & route scheduling** — Staff publishes pickup shifts (one-off and recurring patterns) and defines/edits routes as ordered stores (drag-and-drop ordering). Shifts exist independently of any driver. Staff can edit a shift's date/time after creation, and edit a single recurring instance without breaking the pattern. |
| 5 | **Shared shift board** — All drivers see every shift, open and claimed, with date/time, route, truck, status, and the owning driver's name. This is the collaborative, self-selection surface: situational awareness plus claiming open runs. |
| 6 | **Shift claim & assignment** — A driver self-selects an open shift (primary path), or Staff assigns/defaults a driver (fallback); both set the same owner. Self-select is gated by eligibility (no overlap with the driver's other owned shifts or declared availability); staff-assign is **not** gated — Staff gets a warning and explicit confirmation if the assignment conflicts, but can proceed anyway, and the shift is flagged so the driver sees the conflict and can raise it with Staff. Claiming a recurring shift once covers all current and future instances that pass the same eligibility gate as a single claim — an instance that would conflict with the driver's own overlapping shift or declared availability is skipped, not force-claimed, and the driver sees which instances didn't go through; releasing a range of them (see cap 8) returns just that range to the board. Open shifts are claimed atomically (no double-claim). |
| 7 | **Driver availability** — A driver marks unavailability as a date range or a specific time window within given dates. Availability applies only to shifts the driver does **not** own. Declaring a block that overlaps a shift the driver **does** own (claimed or in-progress) is rejected — the driver must cancel/release that shift first (or, if it's already in progress and can't be cancelled, wait until it finishes). Availability informs Staff; it never auto-blocks a self-selected assignment, and Staff can still override it deliberately when assigning (see cap 6). |
| 8 | **Release** — A driver releases an owned shift at any time before it starts; no approval is required, and the coordinator plus eligible drivers are notified immediately as the shift returns to the board as open. In-progress and past shifts cannot be released, and there is no minimum-notice floor. Recurring instances can be released per instance or in bulk across a date range — both return the affected instances to `OPEN` (refillable by another driver or staff); this is release, not deletion, and the series keeps generating beyond the range. Staff separately has a distinct, staff-only bulk-terminate for permanently ending part of a series (e.g. a closed store or retired route) — that action is terminal (`CANCELLED`), not covered by this driver capability. |
| 9 | **Reschedule** — Staff moves a shift's date/time. The owner is kept by default; the app surfaces any conflict with that driver's declared availability before Staff confirms. On a confirmed conflict, the owner is released and the shift returns to the board. The system never auto-selects a replacement person. |

### Pickup

| # | Capability |
| :---- | :---- |
| 10 | **Pickup execution** — The driver starts their already-routed shift (the route was fixed by Staff at scheduling, cap 6) and selects a truck; the system already knows the driver from login. Driver sees route and store info, checks off stops (freely reordering them to suit however the run actually goes) or skips a stop. No step is required to *close* the shift — that stays receiver-only (cap 14, receive-done). Once every stop is resolved, the driver may optionally confirm "heading back," which signals the receiver (triggers the truck-inbound notification) but does not itself complete anything; if the driver never taps it, the receiver still resolves the run normally. Separately, if a driver can't finish (truck trouble, called off), Staff can move that driver's remaining unresolved stops to another driver's shift mid-run — this is a staff action, not something the driver does themselves. |
| 11 | **Directional notes** — Four independent channels: (1) coordinator→driver, staff-authored, shown on the driver's shift detail; (2) driver→receiver, one per stop, shown to the receiver at weight entry for that stop; (3) driver's own whole-run remarks (one per shift, distinct from the per-stop note); (4) Admin's permanent per-store note, always visible wherever that donor appears. Each is its own field — none of the four share storage. |
| 12 | **Unscheduled donation** — Record a donation that arrives outside a scheduled pickup, with a report toggle (default ON, since most are store donations that must be reported). Donor attribution is captured and is optional when the donation is not flagged for reporting. A driver mid-run can also flag an ad-hoc stop (donor + note, no weight) as a prefill for the receiver, who then confirms it with weights at S2.3; the driver-flagged version never touches the planned route (no `ShiftStop` created). Both halves — driver flag and receiver record/confirm — ship together in Phase 2. |

### Notifications

| # | Capability |
| :---- | :---- |
| 13 | **Notifications** — Web push plus an in-app notification flag/inbox, per the matrix below. Covers the shift lifecycle, shift reminders, at-risk coverage gaps, and truck-inbound alerts. |

**Notification matrix:**

| Event | Recipients | Channel | Trigger |
| :---- | :---- | :---- | :---- |
| Shift assigned / defaulted to you | The owning driver | push + flag | event |
| Shift reminder (hard-coded 1-hour offset before start) | The owning driver | push + flag | time |
| Driver sets unavailability | Coordinator (Staff) only | push + flag | event |
| Shift returns to the board as open — release (cap 8), reschedule conflict (cap 9), or staff unassign. Never from `CANCELLED`, which is terminal. | Coordinator + eligible drivers | push + flag | event |
| Shift still open and at-risk (1 day before start) | Coordinator + eligible drivers | push + flag | time |
| Truck inbound | receiver tablet (device push subscription; fires regardless of who is logged in) | push + flag | event |

Eligible driver (the fan-out set for open-shift and at-risk alerts) is computed at send time as: holding the drive duty AND no unavailability block overlapping the open shift's time window on that date AND not already owning a **CLAIMED or IN_PROGRESS** shift whose time window overlaps the open shift (a COMPLETED or CANCELLED shift of theirs doesn't count against them, even if its window would have overlapped). Non-overlapping shifts or blocks on the same day still count as eligible.

### Receive & Report

| # | Capability |
| :---- | :---- |
| 14 | **Weight entry** — The logged-in receiver picks the run/shift they're receiving against, then records weights by stop and category at the receiver tablet; each entry is attributed to that user and confirmed on submit (no separate sign-off step at the entry level). Closing out the whole run is a separate, explicit "Receive done" action once every stop is weighed or skipped. |
| 15 | **Report generation** — Auto-calculated, inspectable to store-category-day, with in-app AGFP→NTFB (Meal Connect) category mapping, exportable. Every inspected entry is editable from this drill-in. **Weight corrections** use the same void-old + insert-new mechanism as receiver edits (cap 14), preserving the audit trail. The **reportable flag** is a plain field edit — last write wins, stamped with who and when — since it carries no weight and has no prior value worth preserving as a row. Before the receiver's edit window closes (`N` days from shift start, ops-configured), the receiver can also edit their own entries directly at the tablet (cap 14); after it closes, editing is Reporter-only, exclusively from here — the only path to correct a bad entry discovered later without reopening receiver access. |
| 16 | **Metrics view** — Admin sees per-store and total-intake metrics, including unreported donation volume. Also surfaces shift-coverage failures: unclaimed shifts (window passed, never claimed) and no-shows (claimed, never started), by driver/store/period — the same "consistently under-covered route" or "this driver flakes" visibility the store-donation pattern gets. |

**Key data boundary:** *Intake ≠ NTFB-reported.* R3 records all rescued/donated weight for admin metrics, but only donations flagged for reporting (the toggle, ON by default) flow to the NTFB report. Unreported donations are tracked for metrics, never reported. These are two distinct numbers the system keeps separate from day one.

### Channel strategy (applies to all notifications)

- **In-app flags are the source of truth.** Every notification lands in the in-app inbox with read/unread state, regardless of push. The app is fully usable, with zero missed signal, for a user who never enables push.  
- **Web push is the primary alerting layer but best-effort.** It is platform-dependent and notably degraded on iOS, which requires home-screen install before push is available at all.  
- **Guided, platform-aware install + permission onboarding is required**, and the app must surface push permission state in-app ("push ON/OFF — tap to fix") so a denied or missing permission is visible and recoverable.

### Out-of-scope

- Distribution / food going out to families  
- Multi-tenant  
- Native mobile app (responsive web / PWA only)  
- Offline support  
- Truck telemetry, mileage, maintenance tracking (truck *identity and selection* are in scope; tracking is not)  
- Real-time GPS / map integration / live driver-location tracking (truck-inbound notification is the lightweight substitute)  
- Undo / version history for weights, in the sense of a user-facing history UI (edits appear as a simple overwrite to the user; underneath, the prior entry is voided and a new one inserted — see UI §6, Domain I13 — so an audit trail exists, it's just not surfaced)  
- Out-of-app notifications via SMS, email, or hardware (web/PWA push **is** in scope)

## 4. Build Phasing

| Phase | Ships | Why this order |
| :---- | :---- | :---- |
| **1 — Rescue loop + scheduling** | Accounts, donors, trucks, categories; route/shift scheduling incl. recurring; shared board; claim/self-select & assign; availability; release + bulk release; reschedule; pickup execution (route + truck selection); directional notes; notifications for the shift lifecycle, reminders, and at-risk gaps; install/onboarding (caps 1–11, 13 minus truck-inbound, 17) | Scheduling **is** the adoption lever — the shared board, self-selection, and availability are what make drivers want the system rather than tolerate it. Everything downstream is dataless without a working schedule→claim→pickup loop. Cancel-and-replace needs notifications, so the notification mechanism is built here. |
| **2 — Receive** | Weight entry (attributed to the logged-in receiver), unscheduled-donation intake, truck-inbound notification (reuses the Phase-1 notification mechanism) (caps 12, 14, + truck-inbound) | Receive consumes a completed pickup; pointless before Rescue produces real pickups to weigh. Personal login on the shared receiver tablet (with session timeout) first appears here. |
| **3 — Report & Metrics** | Report generation with NTFB mapping, admin metrics (caps 15–16) | Pure aggregation over Rescue + Receive data. Buildable only once both upstream sources exist. |

## 5. Success Metrics

| # | Metric | Pass condition | Failure mode it kills |
| :---- | :---- | :---- | :---- |
| 1 | Coordination is in-app | A shift & route can be published, self-selected or assigned, cancelled, and replaced with zero out-of-app phone calls or messages. | Coordination chaos |
| 2 | Pickups & weighing are digital | A driver runs a full route (selects truck, sees stores, checks off stops, logs notes) and a receiver enters weights with zero paper. | Paper notes |
| 3 | Report generated, not assembled | The weekly NTFB report is produced from system data in Meal Connect format and exportable, with no manual re-summing in Excel. | Hours of manual reporting |
| 4 | Every reported number is traceable & editable | 100% of report line items resolve to a store-category-day entry | Lost-sheet misreporting |

## 6. Constraints & Assumptions

**Technology:**

- **Stack:** PERN (PostgreSQL, Express, React, Node).  
- **Hosting:** self-hosted on AGFP's own Ubuntu server, containerized using Docker. No first-party cloud services. (Web push necessarily depends on external browser-vendor push gateways; this is the one accepted external dependency.)  
- **Delivery:** responsive web, packaged as a PWA.

**Notifications:**

- Web push (PWA) is the primary alerting channel; the in-app notification flag/inbox is the reliable baseline and source of truth. Push is best-effort and platform-dependent (notably degraded on iOS, which requires a home-screen install before push is available).  
- Guided, platform-aware install and notification onboarding is a requirement, with in-app visibility of push permission state.

**Scale (current operation, real numbers):**

- ~15 scheduled pickups per week.  
- Users: ~4 drivers (personal mobile phones), 1 shared receiver tablet (shared by many volunteers, each logging in personally to weigh), 1 shared reporter desktop, 1 coordinator (Clark), 1 admin (Scott).  
- Concurrency: near-zero. Realistic peak ~5 simultaneous users, ceiling well under 10. R3 is explicitly NOT engineered for load.

**Devices:**

- Drivers: personal mobile phones.  
- Receiver: a single shared pantry tablet.  
- Reporter: a shared desktop.  
- Responsive web is a requirement, spanning phone, tablet, and desktop.

**Environmental:**

- **Connectivity.** Assume a reliable network for drivers during pickups and a stable network at the pantry.  
- **Tech literacy.** Primary users are older volunteers. Every interface must be intuitive and simple: minimum steps, no non-essential controls, nothing on screen that does not need to be there.

**Adoption (assumptions):**

- Drivers will install the PWA to their home screen and grant notification permission, with one-time assisted setup by the coordinator if needed. Users who decline push still receive all information via in-app flags.  
- Self-selection is the primary driver's coordination path; assignment/default-driver is the fallback.

