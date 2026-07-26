# R3 \- Product Requirement 

## 1\. Problem & Vision

**Problem.** AGFP runs weekly food rescues from grocery donors (Kroger, Target, others) under North Texas Food Bank (NTFB), its mother agency. Today the entire loop runs on paper and phone calls, and it breaks in four places:

- **Rescue.** Routes are assigned on a paper calendar and adjusted by word of mouth. Drivers have no way to see what's scheduled or to volunteer for open runs, so coordination is entirely push: the coordinator assigns everyone and manually chases replacements when someone drops. Available drivers are invisible to the system. Surprise, unscheduled donations are common but get scribbled on paper that downstream staff must re-record or remember.  
- **Receive.** Receivers do not know when a truck is returning, so they drop what they are doing and scramble to unload so the driver's next route is not stalled.  
- **Report.** One person spends hours each week collecting weight sheets, summing categories by hand in Excel, remapping AGFP categories to NTFB's, and entering the portal report. Lost or illegible sheets force guessing or misreporting. The math is repetitive and error-prone.  
- **Admin.** No granular per-store metrics, so leadership cannot see recurring patterns (e.g., a store consistently under-donates) and cannot make informed sourcing decisions.

**Vision.** R3 replaces the paper-and-phone loop with a single system of record for the rescue cycle. Coordinators publish driver shifts (one-off and recurring); a shared board shows every shift and its owner, and drivers self-select open runs or declare unavailability so gaps surface before a pickup is at risk. Drivers pick their route and truck at start and log surprises in-app instead of on paper. Receivers are notified when a truck is inbound and enter weights directly. At week's end the report is already calculated and inspectable down to a single store-category-day, so the reporter files NTFB numbers in minutes instead of hours, and admins read per-store metrics to make sourcing decisions.

## 2\. Users & Roles

R3 separates two independent axes: an **access tier** (exactly one per user, strictly hierarchical) that gates administrative permissions, and a set of **duties** — `drive`, `receive`, `report` — assigned per user and orthogonal to tier, that gate operational actions. Every operational volunteer, along with all Staff and Admins, has a single user account; there is no separate person-vs-account distinction.

**Access tiers** (Volunteer ⊂ Staff ⊂ Admin):

| Tier | Can do | Cannot do |
| :---- | :---- | :---- |
| **Volunteer** | See own personal info, shifts, and assignments. Perform any operational duty assigned to them (`drive`, `receive`, and/or `report`). | Manage accounts; see anyone else's PII; create/delete donors; reassign other people's shifts. |
| **Staff** | Everything a Volunteer can, plus operational coordination: publish shifts, assign/reassign drivers, reschedule shifts, view operational status across all volunteers (availability, assignments). | Manage accounts; assign access tiers; see others' PII; create/delete permanent donors. |
| **Admin** | Everything Staff can, plus the Admin-only delta: account lifecycle (create/delete non-admin accounts, assign tiers and duties), PII visibility, donor & truck master data, metrics review. | — |

Duties. Three operational duties — drive, receive, report — are assigned per user, independently of tier. A user sees the duties they hold and, where a duty has a dedicated workflow on a shared device, chooses which duty they are performing.

- **drive** — self-select or be assigned pickup shifts, see the shared shift board, receive shift notifications, use the in-app driver view (route/store details, truck selection, stop check-off, pickup notes).  
- **receive** — enter weights at the receiver tablet.  
- **report** — generate and file the NTFB report.

Duties are orthogonal to tier: a Volunteer may hold any combination, and `report` is **not** tier-restricted — any user holding it can file. A single user combining tier and duties (e.g., a Staff member who also drives) uses one account for everything.

**Accounts & login.** Usernames are auto-generated as `firstname` \+ `lastname`, normalized (lowercased, diacritics and punctuation stripped). On collision, a numeric suffix (`2..n`) is appended in account-creation order; a username is immutable once assigned (a later deletion never renumbers anyone). Authentication is by access tier: Volunteers use a 4-digit PIN (defaulting to the last four digits of their phone number); Staff and Admins use a password.

**Shared devices.** The receiver tablet and reporter desktop are shared *physical devices*. Each user logs in personally to weigh or to report, and a session ends by manual logout or inactivity timeout. The receiver tablet additionally holds a device-level push subscription used only for the truck-inbound alert; this is a notification endpoint, not a login, and it fires regardless of who (if anyone) is logged in.

## 3\. Capabilities & Scope

### Administration

| \# | Capability |
| :---- | :---- |
| 1 | **Account management** — Admin creates/deletes non-admin accounts, assigns access tiers and duties. |
| 2 | **Donor management** — Admin maintains permanent store donors (master data). |
| 3 | **Truck management** — Admin maintains the truck list. A truck is a selectable entity chosen by the driver at route start (identity \+ attribution only). Telemetry, mileage, and maintenance are out of scope. |

### Driver scheduling & coordination

| \# | Capability |
| :---- | :---- |
| 4 | **Shift & route scheduling** — Staff publishes pickup shifts (one-off and recurring patterns) and defines/edits routes as ordered stores (drag-and-drop ordering). Shifts exist independently of any driver. Staff can edit a shift's date/time after creation, and edit a single recurring instance without breaking the pattern. |
| 5 | **Shared shift board** — All drivers see every shift, open and claimed, with date/time, route, truck, status, and the owning driver's name. This is the collaborative, self-selection surface: situational awareness plus claiming open runs. |
| 6 | **Shift claim & assignment** — A driver self-selects an open shift (primary path), or Staff assigns/defaults a driver (fallback); both set the same owner. Claiming a recurring shift once covers all current and future instances; bulk cancel releases a range of them. Open shifts are claimed atomically (no double-claim). |
| 7 | **Driver availability** — A driver marks unavailability as a date range or a specific time window within given dates. Availability applies only to shifts the driver does **not** own. Declaring a block that overlaps a shift the driver **does** own (claimed or in-progress) is rejected — the driver must cancel/release that shift first (or, if it's already in progress and can't be cancelled, wait until it finishes). Availability informs Staff; it never auto-blocks an assignment. |
| 8 | **Cancellation** — A driver releases an owned shift at any time before it starts; no approval is required, and the coordinator plus eligible drivers are notified immediately as the shift returns to the board as open. In-progress and past shifts cannot be cancelled, and there is no minimum-notice floor. Recurring instances can be cancelled per instance or bulk-cancelled across a date range. |
| 9 | **Reschedule** — Staff moves a shift's date/time. The owner is kept by default; the app surfaces any conflict with that driver's declared availability before Staff confirms. On a confirmed conflict, the owner is released and the shift returns to the board. The system never auto-selects a replacement person. |

### Pickup

| \# | Capability |
| :---- | :---- |
| 10 | **Pickup execution** — At route start the driver selects route and truck; the system already knows the driver from login. Driver sees route and store info, checks off stops (changing the order is allowed); the stop set can be reassigned or skipped mid-cycle. No completion-confirmation step. |
| 11 | **Directional notes** — Driver logs pickup notes; coordinator→driver and driver→receiver notes flow downstream; Admin can attach permanent per-store notes. |
| 12 | **Unscheduled donation** — Record a donation that arrives outside a scheduled pickup, with a report toggle (default ON, since most are store donations that must be reported). Donor attribution is captured and is optional when the donation is not flagged for reporting. |

### Notifications

| \# | Capability |
| :---- | :---- |
| 13 | **Notifications** — Web push plus an in-app notification flag/inbox, per the matrix below. Covers the shift lifecycle, shift reminders, at-risk coverage gaps, and truck-inbound alerts. |

**Notification matrix:**

| Event | Recipients | Channel | Trigger |
| :---- | :---- | :---- | :---- |
| Shift assigned / defaulted to you | The owning driver | push \+ flag | event |
| Shift reminder (hard-coded 1-hour offset before start) | The owning driver | push \+ flag | time |
| Driver sets unavailability | Coordinator (Staff) only | push \+ flag | event |
| Shift becomes open (due to cancellation) | Coordinator \+ eligible drivers | push \+ flag | event |
| Shift still open and at-risk (1 day before start) | Coordinator \+ eligible drivers | push \+ flag | time |
| Truck inbound | receiver tablet (device push subscription; fires regardless of who is logged in) | push \+ flag | event |

Eligible driver (the fan-out set for open-shift and at-risk alerts) is computed at send time as: holding the drive duty AND no unavailability block overlapping the open shift's time window on that date AND not already owning a shift whose time window overlaps the open shift. Non-overlapping shifts or blocks on the same day still count as eligible.

### Receive & Report

| \# | Capability |
| :---- | :---- |
| 14 | **Weight entry** — The logged-in receiver records weights by store and category at the receiver tablet; entries are attributed to that user and confirmed on submit (no separate sign-off step). |
| 15 | **Report generation** — Auto-calculated, inspectable to store-category-day, with in-app AGFP→NTFB (Meal Connect) category mapping, exportable. |
| 16 | **Metrics view** — Admin sees per-store and total-intake metrics, including unreported donation volume. |

**Key data boundary:** *Intake ≠ NTFB-reported.* R3 records all rescued/donated weight for admin metrics, but only donations flagged for reporting (the toggle, ON by default) flow to the NTFB report. Unreported donations are tracked for metrics, never reported. These are two distinct numbers the system keeps separate from day one.

### Channel strategy (applies to all notifications)

- **In-app flags are the source of truth.** Every notification lands in the in-app inbox with read/unread state, regardless of push. The app is fully usable, with zero missed signal, for a user who never enables push.  
- **Web push is the primary alerting layer but best-effort.** It is platform-dependent and notably degraded on iOS, which requires home-screen install before push is available at all.  
- **Guided, platform-aware install \+ permission onboarding is required**, and the app must surface push permission state in-app ("push ON/OFF — tap to fix") so a denied or missing permission is visible and recoverable.

### Out-of-scope

- Distribution / food going out to families  
- Multi-tenant  
- Native mobile app (responsive web / PWA only)  
- Offline support  
- Truck telemetry, mileage, maintenance tracking (truck *identity and selection* are in scope; tracking is not)  
- Real-time GPS / map integration / live driver-location tracking (truck-inbound notification is the lightweight substitute)  
- Undo / version history for weights (simple last-write-wins edit only)  
- Out-of-app notifications via SMS, email, or hardware (web/PWA push **is** in scope)

## 4\. Build Phasing

| Phase | Ships | Why this order |
| :---- | :---- | :---- |
| **1 — Rescue loop \+ scheduling** | Accounts, donors, trucks; route/shift scheduling incl. recurring; shared board; claim/self-select & assign; availability; cancellation \+ bulk cancel; reschedule; pickup execution (route \+ truck selection); directional notes; notifications for the shift lifecycle, reminders, and at-risk gaps; install/onboarding (caps 1–11, 13 minus truck-inbound) | Scheduling **is** the adoption lever — the shared board, self-selection, and availability are what make drivers want the system rather than tolerate it. Everything downstream is dataless without a working schedule→claim→pickup loop. Cancel-and-replace needs notifications, so the notification mechanism is built here. |
| **2 — Receive** | Weight entry (attributed to the logged-in receiver), unscheduled-donation intake, truck-inbound notification (reuses the Phase-1 notification mechanism) (caps 12, 14, \+ truck-inbound) | Receive consumes a completed pickup; pointless before Rescue produces real pickups to weigh. Personal login on the shared receiver tablet (with session timeout) first appears here. |
| **3 — Report & Metrics** | Report generation with NTFB mapping, admin metrics (caps 15–16) | Pure aggregation over Rescue \+ Receive data. Buildable only once both upstream sources exist. |

## 5\. Success Metrics

| \# | Metric | Pass condition | Failure mode it kills |
| :---- | :---- | :---- | :---- |
| 1 | Coordination is in-app | A shift & route can be published, self-selected or assigned, cancelled, and replaced with zero out-of-app phone calls or messages. | Coordination chaos |
| 2 | Pickups & weighing are digital | A driver runs a full route (selects truck, sees stores, checks off stops, logs notes) and a receiver enters weights with zero paper. | Paper notes |
| 3 | Report generated, not assembled | The weekly NTFB report is produced from system data in Meal Connect format and exportable, with no manual re-summing in Excel. | Hours of manual reporting |
| 4 | Every reported number is traceable & editable | 100% of report line items resolve to a store-category-day entry | Lost-sheet misreporting |

## 6\. Constraints & Assumptions

**Technology:**

- **Stack:** PERN (PostgreSQL, Express, React, Node).  
- **Hosting:** self-hosted on AGFP's own Ubuntu server, containerized using Docker. No first-party cloud services. (Web push necessarily depends on external browser-vendor push gateways; this is the one accepted external dependency.)  
- **Delivery:** responsive web, packaged as a PWA.

**Notifications:**

- Web push (PWA) is the primary alerting channel; the in-app notification flag/inbox is the reliable baseline and source of truth. Push is best-effort and platform-dependent (notably degraded on iOS, which requires a home-screen install before push is available).  
- Guided, platform-aware install and notification onboarding is a requirement, with in-app visibility of push permission state.

**Scale (current operation, real numbers):**

- \~15 scheduled pickups per week.  
- Users: \~4 drivers (personal mobile phones), 1 shared receiver tablet (shared by many volunteers, each logging in personally to weigh), 1 shared reporter desktop, 1 coordinator (Clark), 1 admin (Scott).  
- Concurrency: near-zero. Realistic peak \~5 simultaneous users, ceiling well under 10\. R3 is explicitly NOT engineered for load.

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

