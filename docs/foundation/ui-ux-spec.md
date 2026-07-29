# R3 — UI/UX Specification

Governs all UI work for R3 (Amazing Grace Food Pantry rescue platform). Read alongside the PRD: **PRD wins on product logic, this doc wins on layout, interaction, and visual contract.** Build order mirrors PRD phases (1 Rescue+scheduling → 2 Receive → 3 Report+Metrics).

Primary users are older volunteers, paper-first, low tech-tolerance. Every choice below serves: big, clear, calm, intuitive, minimum steps.

---

## 0. Device → surface map

| Device | Owner | Duty / role surface | Primary |
| :---- | :---- | :---- | :---- |
| Personal phone | Each driver | Board, my shifts, availability, pickup, inbox | `drive` |
| Shared tablet | Many volunteers | Weight entry, unscheduled donation | `receive` |
| Shared desktop | Reporter + coordinator + admin | Report, scheduling, admin, board | `report` / Staff / Admin |

A surface is **canonical** on one device and degrades gracefully elsewhere (responsive matrix, §END).

---

## 1. Design principles (non-negotiable)

1. **One primary action per screen.** Exactly one high-emphasis button. Everything else is quieter.  
2. **Big targets.** Min interactive size 44×44px (WCAG 2.5.5 AAA / Apple HIG), not the 24px floor. 8px min gap between adjacent targets.  
3. **Large, scalable text.** Base 18px. Must survive 200% zoom without breakage. Relative units only.  
4. **Recognition over recall.** Tap your name from a list, do not type a username. Same action lives in the same place on every screen.  
5. **No fragile controls.** Avoid dropdowns, sliders, and multi-step pickers where a column of big buttons or a visible list fits. Numeric input uses a big on-screen keypad, never a tiny system keyboard.  
6. **Plain language.** No tech jargon (no "PWA", "push subscription", "session"). If a term is unavoidable, define it inline.  
7. **Strip the surface.** Nothing on screen that the task does not require. Low clutter, low memory load.  
8. **Calm, branded, light only.** White surfaces, orange accent, no dark mode, minimal color, no decoration that is not status-bearing.

---

## 2. Design tokens

Brand values are AGFP-faithful but contrast-corrected. Three brand colors fail as UI text and are constrained accordingly.

| Token | Hex | Role | Note |
| :---- | :---- | :---- | :---- |
| `--brand-orange` | `#e97900` | Accent only: active state, selected bar, focus ring, the heart, icons | Never text. Never carries white text (2.9:1, fails). |
| `--brand-gold` | `#c49e0d` | Logo/decorative only | Never a UI color. |
| `--text` | `#333333` | All body + headings, on white/light backgrounds only | 12.6:1 on white. Drops to 4.33:1 on `--action-fill` — fails AA there, never use `--text` on orange. |
| `--text-muted` | `#747474` | Non-critical labels only | 4.7:1, AA only. Never body text. |
| `--text-on-brand` | `#1f2933` | Label color specifically for text on `--action-fill` | 5.0:1 on `--action-fill`. |
| `--action-fill` | `#e97900` | Primary button background | Label is `--text-on-brand`, 5.0:1. |
| `--link` | `#b35c00` | In-content links, always underlined | Darkened from site's #d86800. |
| `--success` | `#2b7a44` | Confirmed pickup, reported, submitted | White text passes. |
| `--warning` | `#e6a700` | Needs attention, at-risk | Fill behind dark text. |
| `--danger` | `#c2381f` | Cancel, conflict, destructive | White text passes. |
| `--surface` | `#ffffff` | Page background | Matches site. |
| `--surface-paper` | `#f5f3ef` | Receive sheet, cards | Warm off-white. |
| `--structural-dark` | `#363839` | Top bar, footer band | Matches site footer. |
| `--border` | `#d6d2cc` | Grid lines, dividers | Echoes the paper grid. |

**Type scale** (base 18px / 1.5):

- Body 18px · Label 16px (muted only) · H3 22px · H2 28px · H1 34px · Numeric display (weights, totals) 32px bold tabular.

**Spacing:** 4 / 8 / 12 / 16 / 24 / 32 / 48. Default screen padding 24px. **Radii:** 8px controls, 12px cards. **Focus ring:** 3px `--brand-orange`, 2px offset, on every focusable element.

**Hard rules:** orange is fill-or-accent, never text. Body is `#333333`. Green/gold from the brand are decorative; functional success is `--success`.

---

## 3. Components (behavior contracts, stack-agnostic)

Each lists states: default / hover / active / disabled / loading where relevant.

- **Button** — primary (orange fill, dark label), secondary (white, border), danger (red fill, white). Min 44px tall, 18px label. Disabled = greyed, but prefer hiding over disabling.  
- **Big list row** — tappable row ≥56px, name/title left, status chip right, full row is the target. Used for shifts, names, stores.  
- **Numeric keypad** — large 0–9 + decimal + backspace, ≥64px keys. The only weight/PIN input. No system keyboard.  
- **Text input** — 48px tall, 18px text, visible label above (never placeholder-only). Used sparingly (notes, names in admin).  
- **Card** — `--surface-paper`, 12px radius, 1px `--border`.  
- **Status chip** — pill, text + color: Open (orange), Claimed (muted), In progress (`--brand-orange` filled), Done (muted), At-risk (warning), Cancelled (muted strike). One chip per row, reflecting `Shift.status`.  
- **Mine** is an *ownership overlay*, not a status — it renders in success color and replaces the Claimed chip when the viewer is the owner. Every other status keeps its own chip regardless of who owns the shift.  
- **Top bar** — `--structural-dark`, AGFP heart logo left, current user + logout right, notification bell with unread count, push-state chip.  
- **Bottom nav (phone)** — ≤4 items, icon + label always (no icon-only). 56px tall.  
- **Modal / confirm** — centered, one question, two buttons. Destructive confirm names the consequence ("Release this run? It goes back to the board for others.").  
- **Toast** — bottom, 4s, success/error. Never the only signal for a critical action.  
- **Inbox row** — read/unread dot, event text, time, tap to act.  
- **Empty / loading / error blocks** — every list defines all three. Empty states say what to do next, not just "nothing here".

---

## 4. App shell, navigation, role/duty

Navigation is **derived from what the logged-in user can do**, not a manual duty switcher. The PRD's "choose which duty" only arises if one shared device hosts multiple duty workflows; with tablet=receive and desktop=report it does not, so no duty-picker modal. Keep it implicit.

- **Phone (driver):** bottom nav = Board · My Shifts · Inbox · (Pickup appears as a full-screen takeover only while a route is active). Availability lives inside My Shifts.  
- **Tablet (receive):** no nav. Login → Weight entry. Unscheduled donation is one button from there. Truck-inbound is a device-level banner (§5, fires regardless of login).  
- **Desktop (back office):** left nav, sections shown by role/duty:  
  - `report` duty → Report  
  - Staff tier → Schedule (publish, routes, reschedule, assign), Board  
  - Admin tier → Admin (accounts, donors, trucks), Metrics  
  - A Staff member who also reports sees both Report and Schedule. No switching, just both present.

Top bar is identical everywhere for consistency.

---

## 5. Auth & onboarding

**Login (shared devices, tablet/desktop):**

1. Screen shows a **list of names** (recognition, no typing). Tap your name.  
2. Volunteer → big PIN keypad (4-digit, defaults to last 4 of phone). Staff/Admin → password field.  
3. Session ends by **Logout** (always visible, top bar) or inactivity timeout. Timeout shows a 30s "Still here?" prompt before logging out, so a mid-weighing volunteer is never dumped silently.

**Login (personal phone):** same, but device may remember the user, so it opens to the PIN keypad with the name pre-shown. Persisted login allowed (personal device).

**PWA install + notifications onboarding** (required, platform-aware):

- First visit on phone shows a one-card guide: "Add R3 to your home screen so it works like an app and can alert you." Detect iOS vs Android and show the matching 2-step illustration. iOS must install before alerts are possible; say so plainly.  
- After install, a single prompt: "Turn on alerts so you hear about open runs and reminders." One tap.  
- **Push-state chip** is always visible in the inbox header: "Alerts ON" (success) or "Alerts OFF — tap to fix" (warning). Tapping re-walks the permission flow. In-app inbox is the source of truth; the app is fully usable with alerts off, and the copy must never imply otherwise.

---

## 6. Global interaction patterns

- **Loading:** skeleton rows for lists, never a bare spinner on a blank screen. Sub-300ms actions show nothing.  
- **Empty:** instructive ("No open runs right now. Check back, or set your availability.").  
- **Error:** plain, recoverable ("Could not save. Tap to try again." + retry). Never a code.  
- **Destructive confirm:** modal naming the consequence. Cancel is the calm default; the destructive button is red.  
- **Optimistic claim (atomic):** claiming a shift updates instantly. If lost (someone claimed first), revert with a clear toast: "That run was just taken by Karen." This is the only place the no-double-claim rule is user-visible.  
- **Timeout (shared device):** "Still here?" prompt, §5.  
- **Offline:** not supported (PRD). If the network drops, show a blocking banner "You're offline. R3 needs a connection." Do not fake offline capability.  
- **Editing a weight looks like overwrite, isn't stored that way:** to the user, editing a weight just replaces the number with no undo/history UI (PRD), and the entry shows the prior value so they see what they're replacing. Underneath, the original entry is voided (not deleted) and a new one inserted (Domain I13) — weight rows are immutable for audit purposes; the UI simply never surfaces the void history.

---

## 7. Microcopy rules

- Plain, short, second person. "Open runs", not "Unassigned shifts". "Weigh", not "Record intake".  
- Forbidden in UI: PWA, push subscription, session, payload, endpoint, atomic, instance.  
- Confirm pattern: question + consequence. Error pattern: what happened + what to do.  
- Numbers and weights are big and tabular. Units always shown ("lb").  
- Define any unavoidable term inline in parentheses the first time.

---

# PHASE 1 — Rescue loop + scheduling

Caps 1–11, 13 (minus truck-inbound). Canonical devices: phone (driver) + desktop (staff/admin).

### S1.1 Login

- User/device: all / shared + phone.  
- Layout: name list → PIN keypad or password. Per §5.  
- Primary action: Enter.  
- Edge: wrong PIN shows an inline count ("3 tries left"). At zero the account soft-locks for ~15 minutes and the message says so exactly — "Too many tries. Try again in 15 minutes." The lock always self-clears; copy must never imply a volunteer needs staff to unlock them, because nobody can (Architecture §4.2). Repeated attempts during the lock do not extend it.

### S1.2 Shared shift board (adoption centerpiece)

- User/device: drivers (phone), staff (desktop).  
- Purpose: see every shift and its owner; claim open runs.  
- Layout: vertical list of big rows grouped by day. Each row: date/time, route name, truck, owner name (or "OPEN"), status chip. Open runs float to the top of each day. Filter is a simple segmented control: All · Open · Mine (no dropdown).  
- Primary action: on an Open row, **Claim**. On a Mine row, the row opens S1.3.  
- States: Open (orange chip + Claim), Mine (success chip), Claimed-by-other (muted, owner name; **no action for a driver — staff open S1.3**), In progress (**no action for a driver — staff open S1.3**), Done (muted, read-only), At-risk (warning chip, staff view).  
- **Who may open a row into S1.3.** A driver opens only their own (Mine) rows. **Staff open any row**, including Claimed-by-other and In progress — S1.3 names staff as one of its two users and this board is its primary entry point, so a driver-only reading would leave the staff half of S1.3 unreachable. This is navigation only: it confers no action on the board itself, and everything S1.3 offers is re-authorized there. (Scoped per-viewer the same way At-risk already is.)  
- Edge: recurring shift shows a small "repeats weekly" tag. Claiming prompts: "Claim every Tuesday run, or just this one?" (covers PRD: claim-once-covers-all vs single).  
- **Partial-success feedback:** claiming "every Tuesday run" only claims instances where `eligible()` holds (Domain) — some future instances may be skipped (conflict with the driver's own overlapping shift or declared availability), never force-claimed. On completion, a toast/summary states the actual result: "Claimed 10 of 12 Tuesday runs — 2 skipped (conflicts with your schedule)," with a link to view which dates were skipped. A full-success claim (12 of 12) shows the normal, unremarkable success toast — the partial-result summary only appears when at least one instance was skipped.  
- Copy: header "Pickup runs". Empty "No runs scheduled yet."

### S1.3 Shift detail

- User/device: owner (phone), staff (desktop).  
- Layout: route stops in order, truck, time, any coordinator→driver note (`Shift.staff_note`, PRD cap 11) — staff can add/edit it here (desktop view); driver sees it read-only. One primary action by context.  
- Conflict flag: if staff assigned this shift over a declared-availability or overlapping-shift conflict (PRD cap 6), the owner sees a persistent banner: "This run conflicts with your declared availability — contact staff if that's a problem." Informational only; does not block pickup execution.  
- Primary action: owner sees **Release run** (red). Before-start only; in-progress/past hide it.  
- Release flow: confirm naming consequence → returns to board as Open → notifies coordinator + eligible drivers (PRD cap 8). Recurring: "Release just this one, or this and future?" with a date-range option for bulk. Either way the affected instance(s) go back to Open for someone else to claim — the series itself is untouched and keeps generating beyond the range. (This is distinct from staff's separate, staff-only bulk-terminate for permanently ending part of a series — not available to drivers.)  
- **Reassign stop (staff-only, PRD cap 10):** on an `IN_PROGRESS` shift's stop list (staff/desktop view only), each unresolved stop (PENDING or COLLECTED-not-yet-weighed) shows a **Reassign** action. Picking it opens a driver picker (any driver with an open or in-progress shift today); confirming marks that stop `REASSIGNED` on this shift (excluded from this shift's completion gate, shown struck-through here) and adds it as a new pending stop at the end of the destination driver's active shift. Already-weighed stops have no Reassign action — there's nothing left to move.

### S1.4 My shifts + availability

- User/device: driver (phone).  
- Layout: two tabs, "My runs" (list) and "When I'm away".  
- Availability entry: pick a date range OR a time window within dates. Applies whole-person — it blocks that time across every route, not a specific one — and only to runs you do not own. If the range overlaps a run you own, Save is blocked with an inline error: "You own a run in this window — release it first" (or, if that run is already in progress, "This run is in progress and can't be released — try again once it's done"). Saving notifies coordinator only.  
- Primary action: Save availability.  
- Copy: explain plainly "Telling us you're away helps the coordinator fill runs. It won't release runs you already own — you'll need to release those yourself first."

### S1.5 Driver pickup execution

- User/device: driver (phone), full-screen takeover while active.  
- Start: one big step — pick a truck (list). The route itself is already fixed (Staff bound it at scheduling, S1.6); the driver is starting their claimed/assigned shift, not choosing among routes. Driver is known from login.  
- Active view: ordered list of stops as big check-off rows. Tap to mark picked up. Reordering allowed, via **large "Move up" / "Move down" buttons on each stop — not a drag handle**. Drag was specified here originally and rejected in Wave 4a: HTML drag-and-drop does not fire on touch at all, so it would work on the staff desktop and silently fail on the phone this screen is built for; a hand-rolled touch drag is exactly the fragile control §1.5 rules out; and a drag library is a dependency (build-plan §3/D5). Buttons also survive the one-handed, gloved, moving-truck case that drag does not. A stop can be skipped (swipe or a "Skip" action with reason-free confirm). No step is required to close the shift (still receiver-only, S2.2b Receive done) — the route just ends when stops are done. Reassigning a stop to another driver mid-run is a **staff-only** action (S1.6/S1.3), not something the driver does from here — see S1.6.  
- Per-stop: store info, address, permanent store note (admin, `Donor.note`), and a field to add a **driver→receiver note** — `ShiftStop.note`, this stop only (PRD cap 11), distinct from the whole-run note below.  
- Primary action: the next unchecked stop is visually the focus.  
- **Heading back (optional, new):** once every stop is COLLECTED, SKIPPED or REASSIGNED (no PENDING left — I27's gate; a stop moved to another driver is resolved *for this run*, per the Reassign action above), a **"Heading back"** button appears below the stop list. Tapping it opens a short review screen — shift summary (route, stop-by-stop collected/skipped, each stop's `ShiftStop.note` if any), an editable field for the driver's whole-run note (`Shift.note`, last chance before the receiver sees it), and a single **Confirm — heading back** action. Confirming sets `Shift.pickup_completed_at`; the shift itself stays `IN_PROGRESS` and nothing downstream is gated on this. **In Phase 2** it also fires the truck-inbound push (device-scoped, S2.4) to the receiver tablet — that alert is explicitly out of Phase 1 (`product-requirement.md §5` scopes it as caps 1–11, 13 *minus* truck-inbound), the receiver tablet's device registration is itself Phase 2, and the Phase-1 server deliberately enqueues nothing here. Phase-1 copy on this screen must therefore not tell the driver anyone was notified. It's optional — a driver who never taps it causes no problem; the receiver still resolves stops normally without a "heading back" signal.  
- **Flag ad-hoc pickup (Phase 2, new):** a secondary action ("Flag a stop not on my route") lets the driver record a donor they picked up from mid-run that isn't part of the planned route — just a donor picker (or free-text label) and an optional note, no weight entry here. This creates a `SUGGESTED` UnscheduledDonation (PRD cap 12, Domain I17) that prefills S2.3 for the receiver to confirm with weights later; it never creates or touches a `ShiftStop`, so the planned route stays unaffected. Ships with the rest of cap 12 in Phase 2, not alongside the rest of this screen — the button is simply absent until then.  
- Edge: changing order never loses check state. Store permanent notes are read-only here.

### S1.6 Staff — shift & route scheduling

- User/device: staff (desktop).  
- Publish shift: date/time, route. No truck field here — truck is picked by the driver at start (S1.5), not set by staff at publish. Recurring builder: pick a weekly pattern with plain language ("Every Tuesday, starting Aug 4, no end" or an end date). **The "starting" date is displayed, not entered** — it is the first occurrence the pattern will actually mint, computed from today and the chosen weekday, and the control is read-only. A pattern has no stored start date: `domain-modeling.md §5.3` (locked) names `endDate` as the only stop condition and runs the loop over `[now, horizon]`, and `data-model.md §5.2` has no `start_date` column. A series therefore begins when it is created, and the sentence tells the user which date that works out to rather than asking them to choose one. Shifts exist with no driver (PRD cap 4).  
- Route builder: a route is an ordered list of stores. **Drag-and-drop ordering** with large handles; add store from the donor list. Editing a single recurring instance must not break the pattern (PRD cap 4) — surface this as "Edit just this date" vs "Edit the weekly pattern".  
- Assign/default: staff may set an owner as fallback (PRD cap 6). Same owner field as self-select. If the chosen driver conflicts with their declared availability or another owned shift, staff sees an inline warning and must confirm ("Karen marked herself away then — assign anyway?") before it goes through; the assignment is not blocked. The resulting shift shows a conflict flag to the driver (their board/shift-detail view), prompting them to contact staff.  
- Primary action: Publish / Save.

### S1.7 Staff — reschedule

- User/device: staff (desktop).  
- Flow: move date/time. Owner kept by default. Before confirm, app surfaces any conflict with that owner's declared availability (PRD cap 9). On confirmed conflict, owner is released → shift returns to board Open. System never auto-picks a replacement.  
- Primary action: Confirm new time.  
- Copy: conflict warning is explicit: "Karen marked herself away then. Moving this releases her run back to the board."

### S1.8 Admin — accounts, donors, trucks

- User/device: admin (desktop).  
- Accounts: list of users; create (first/last → auto username shown read-only), assign tier (Volunteer/Staff/Admin) and duties (drive/receive/report as toggles), set/reset PIN or password. Delete non-admin. Username immutable once set (PRD §2).  
- Donors: list of permanent stores (master data), add/edit/delete, attach permanent per-store note.  
- Trucks: simple list, add/edit/delete. Identity + attribution only (no telemetry).  
- Categories: simple list (name only), add, archive, delete. **Removal follows I21 like every other master record**: a category with referencing history is archived (deactivated), never destroyed — it stays hidden from the S2.2 weight-entry keypad while history and reports keep resolving it — but one with no referencing history at all may be hard-deleted, which is how a category added by mistake is undone. The UI does not make the user choose: *Delete* asks the domain, and the domain decides which of the two happened (PRD "Category management"). Seeded with the 11 AGFP categories at launch.  
- Primary action varies per sub-screen (Save).

### S1.9 Notification inbox

- User/device: all (phone + desktop).  
- Layout: list of events newest first, unread dot, tap to act (deep-links to the relevant shift). Header carries the push-state chip (§5).  
- Source of truth: every event lands here regardless of push (PRD channel strategy).  
- Events (PRD matrix): assigned to you, 1-hour reminder, your unavailability recorded (coordinator only), shift became open, at-risk 1 day before, truck inbound (tablet only, Phase 2).

---

# PHASE 2 — Receive

Caps 12, 14, + truck-inbound. Canonical device: shared tablet (landscape).

### S2.1 Receiver login

- Per §5: tap name → PIN. Opens to S2.1b (run picker). Logout + timeout active.

### S2.1b Run picker

- User/device: logged-in receiver, tablet landscape.  
- Purpose: resolve which shift/run today's weighing belongs to, since `weight_entry.shift_id` is required and a store can be one stop among several on a driver's run.  
- **Date shown is `shift.occurrence_date`, never calendar-today.** If receiving lags past midnight (e.g. a Tuesday-night run finally received at 12:30am Wednesday), the report still buckets that weight to Tuesday (Data Model §8, `report_day = shift.occurrence_date`) — showing the shift's own date here, not the device's current date, means what the receiver sees always matches what the report will show.

```
┌──────────────────────────────────────────────────────────┐
│ [AGFP ♥]                     Tue's run · 4-23     Karen  ⎋  │
├──────────────────────────────────────────────────────────┤
│ Which run are you receiving?                              │
│                                                            │
│ ┌ Karen's Tue AM run ────────────────┐                     │
│ │ Sam's ✓weighed   Kroger ●pending   │  tap → S2.2 for that │
│ │ Aldi ●pending          2 of 3 done │  run, stop list shown│
│ └─────────────────────────────────────┘                     │
│ ┌ Miguel's Tue AM run ───────────────┐                     │
│ │ Walmart ●pending        0 of 1 done│                     │
│ └─────────────────────────────────────┘                     │
│                                                            │
│ [  Unscheduled donation  ]  (goes to S2.3, no run needed)  │
└──────────────────────────────────────────────────────────┘
```

- Lists today's `IN_PROGRESS` shifts with at least one unresolved stop (i.e. not yet eligible for receive-done). Completed runs (all stops WEIGHED/SKIPPED + receive-done already done) drop off the list.  
- Each row shows the run's stops with a status dot (pending / weighed / skipped) and an "N of M done" count — this is the stop list the old store-only flow had no room for.  
- Tapping a run opens S2.2 scoped to that run; tapping a stop within S2.2 is how the receiver navigates between stores on a multi-stop run.  
- Multiple receivers can work the same run's different stops independently — the list re-sorts/refreshes as stops resolve.

### S2.2 Weight entry (THE paper sheet, centerpiece)

- User/device: logged-in receiver, tablet landscape.  
- Mental model = the Retail Rescue Log, now scoped to one run's current stop. One screen = one shift + one stop + this receiver.

```
┌──────────────────────────────────────────────────────────┐
│ [AGFP ♥]  Karen's Tue AM run   Stop: Sam's ▾   Karen  ⎋   │  run context + stop picker (switches between this run's stops); 11 tiles shown here reflect the current active-category set (S1.8)
│ Stops: Sam's✓ · Kroger● · Aldi●            2 of 3 done      │  persistent stop-status strip for this shift
├──────────────────────────────────────────────────────────┤
│ Tap a category, type the weight, Add. Totals add up for you.│
│                                                            │
│ ┌Frozen Meat┐ ┌Bakery┐ ┌Produce┐ ┌Deli┐ ┌Dairy┐ ┌Dry┐ →   │  11 category tiles, scroll/grid; each = big target
│ │  293 lb   │ │323 lb│ │1222 lb│ │31 lb│ │  0  │ │528│     │  LIVE subtotal per category (replaces hand math)
│ │ 61 232 ✎  │ │ 323  │ │516 706│ │ 31  │ │     │ │528│     │  running entries underneath (gapless, no line #s)
│ └───────────┘ └──────┘ └───────┘ └─────┘ └─────┘ └───┘     │
├──────────────────────────────────────────────────────────┤
│ Selected: Produce            entry: [ 5 1 6 ] lb   ⌫       │
│   ┌───┬───┬───┐                                            │
│   │ 7 │ 8 │ 9 │     [  Add weight  ]                       │  big keypad, ≥64px keys
│   ├───┼───┼───┤                                            │
│   │ 4 │ 5 │ 6 │     This stop's total:  2192 lb             │
│   ├───┼───┼───┤                                            │
│   │ 1 │ 2 │ 3 │     [ Mark stop weighed ]  [ Skip stop ]   │
│   ├───┴───┼───┤                                            │
│   │   0   │ . │                                            │
│   └───────┴───┘                                            │
└──────────────────────────────────────────────────────────┘
```

- Categories: active categories only, admin-managed (S1.8) — seeded at launch with the 11 AGFP categories (Frozen Meat, Bakery, Produce, Deli, Dairy, Dry, Frz Non Meat, Non Food, Pet, Health & Beauty, Trash), but the tile set renders from live active-category data, not a hardcoded list.  
- Notes visible here (read-only, receiver doesn't author any of these): driver→receiver note for this stop (`ShiftStop.note`, PRD cap 11), shown under the run/stop header if present; donor's permanent per-store note (`Donor.note`, admin); the driver's whole-run note (`Shift.note`), reachable via a small "run notes" expander so it doesn't compete with the per-stop note for space.  
- Flow: tap a category tile (it highlights with `--brand-orange` bar) → type weight on keypad → **Add weight**. The number appends to that category's running list and the subtotal updates. Repeat. Entries confirm immediately on **Add weight** — no separate sign-off at the entry level (PRD cap 14).  
- Per-stop resolution: **Mark stop weighed** finalizes this stop (any non-voided weight_entry already resolves it to WEIGHED — this button just navigates on to the next unresolved stop). **Skip stop** sets the stop's disposition to SKIPPED (confirm dialog, since it can't be un-skipped from here). Either advances the stop-status strip and returns to the run's next pending stop, or to S2.1b if none remain.  
- Edit: tap an existing entry (✎) to overwrite it — shows the prior value, no undo/history UI. Underneath, this voids the original entry and inserts a new one (Domain I13, weight rows are immutable); the UI just presents it as a simple overwrite.  
- Why it works: paper-parity (category columns, running numbers, totals row, "the sheet") + big targets + auto-totals (kills the hand arithmetic), now with just enough run/stop context to satisfy the completion gate without turning the sheet into a project-management screen.  
- States: no stop selected (prompt from S2.1b first), unsaved entries, stop resolved (status dot updates, prompts next stop), all stops resolved (banner: "All stops done — Receive done available", link back to S2.1b).  
- Edge: switching stop mid-entry with unsaved weights warns. Decimal allowed (scale reads).

### S2.2b Receive done

- User/device: logged-in receiver, tablet landscape. Reached from S2.1b once a run shows "all stops done," or via a banner link from S2.2.  
- Purpose: the single explicit action (Domain I11/I12) that closes out the shift. This is deliberately separate from per-entry submission — weighing confirms each entry as you go; receive-done confirms the whole run is finished.

```
┌──────────────────────────────────────────────────────────┐
│ [AGFP ♥]  Karen's Tue AM run                    Karen  ⎋   │
├──────────────────────────────────────────────────────────┤
│ All stops resolved:                                        │
│   Sam's — weighed, 2192 lb                                 │
│   Kroger — weighed, 640 lb                                 │
│   Aldi — skipped                                            │
│                                                            │
│           [  Receive done  ]                               │
└──────────────────────────────────────────────────────────┘
```

- Gated: only reachable/actionable once every `ShiftStop` on that shift is WEIGHED, SKIPPED, or REASSIGNED (completion gate I12) — the run simply won't show this option otherwise.  
- **Receive done** transitions the shift `IN_PROGRESS → COMPLETED` (I11). No undo; a correction after this point is the void-and-reweigh path, not a state change.  
- After confirming, returns to S2.1b; the run drops off that list.

### S2.3 Unscheduled donation

- User/device: receiver (tablet), one button from S2.2.  
- Purpose: record a donation arriving outside a scheduled pickup (PRD cap 12). If the driver flagged it mid-run (S1.5, "Flag ad-hoc pickup"), it arrives here pre-filled (donor + note) as a `SUGGESTED` row awaiting the receiver's weights and confirm; otherwise the receiver starts one from scratch.  
- Layout: same weight-by-category surface, plus a **Report toggle, default ON** ("Report this to North Texas Food Bank") and a donor field. Donor attribution is optional only when the toggle is OFF.  
- Key boundary surfaced: ON → counts toward the NTFB report. OFF → tracked for pantry metrics only, never reported. Copy must make this visible: "Reported donations go in the weekly NTFB report. Unreported ones still count in our own totals."  
- Primary action: Submit.

### S2.4 Truck-inbound alert (device-level)

- The tablet holds a device push subscription that fires regardless of who, if anyone, is logged in (PRD §2).  
- Behavior: full-width banner at top + sound, "Truck inbound — Sam's run returning." Dismiss is large. Does not require login to show. If someone is mid-weighing, it banners above without stealing the keypad.

---

# PHASE 3 — Report & Metrics

Caps 15–16. Canonical device: shared desktop. Pure aggregation over Phase 1+2 data.

### S3.1 Report generation

- User/device: anyone with `report` duty (desktop).  
- Purpose: produce the weekly NTFB (Meal Connect) report from system data, no Excel re-summing (Success Metric 3).  
- Layout: pick a week. Show AGFP categories with auto-summed weights, mapped to NTFB categories via an **in-app AGFP→NTFB mapping** (editable mapping table maintained here or in Admin). Every line is **inspectable down to store-category-day** (Success Metric 4: 100% traceable) — click a number to expand the underlying entries with the store, day, and receiver.  
- Only donations flagged for reporting flow in (the toggle). The screen states the two numbers separately where relevant.  
- **Reporter edit (PRD cap 15):** in the drill-in, each entry has an edit affordance (✎, same overwrite-look/void-insert-underneath pattern as S2.2). The reportable toggle is a plain switch, not a void-insert — flipping it overwrites in place (PRD cap 15). Before the receiver's edit window closes, this mirrors what the receiver could already do at the tablet; after it closes, this is the *only* remaining way to correct that entry — the tablet no longer allows it. No separate approval step; the Reporter's edit is itself the correction.  
- Primary action: **Export** (Meal Connect format). Secondary: drill-in.  
- States: incomplete week (show what is missing), ready, exported.  
- Edge: an edited weight upstream (from either the receiver in-window or the Reporter here) reflects live; no version history shown beyond the underlying void trail (PRD out-of-scope as a UI feature).

### S3.2 Admin metrics

- User/device: admin (desktop).  
- Purpose: per-store and total-intake metrics, including **unreported** donation volume (PRD cap 16, intake ≠ reported).  
- Layout: per-store table (total rescued, reported, unreported, trend) + totals. Simple bar/line, no heavy dashboard. Surfaces patterns like a store consistently under-donating (PRD problem statement).  
- **Coverage tab (PRD cap 16):** counts of `UNCLAIMED` (window passed, never claimed) and `NO_SHOW` (claimed, never started) shifts, derived read-only (never stored, Domain I7) — filterable by driver, route, and period. Surfaces "this route keeps going unclaimed" or "this driver has three no-shows this month" the same way the donation table surfaces under-donating stores.  
- Primary action: none destructive; this is read + export.  
- Key: keep Intake and NTFB-reported as two distinct, clearly labeled numbers everywhere.

---

## Responsive matrix

| Surface | Phone | Tablet | Desktop |
| :---- | :---- | :---- | :---- |
| Shift board | canonical | usable | usable (staff) |
| Pickup execution | canonical | degraded | n/a |
| My shifts / availability | canonical | usable | usable |
| Weight entry | n/a | **canonical** | usable |
| Unscheduled donation | n/a | canonical | usable |
| Scheduling / reschedule | cramped | usable | **canonical** |
| Admin (accounts/donors/trucks) | n/a | usable | **canonical** |
| Report + metrics | n/a | usable | **canonical** |
| Inbox + push state | canonical | canonical | canonical |

"Degraded" = works but not optimized; "n/a" = not a target for that device.

---

## Open assumptions (confirm or override)

1. **No tare math in v1.** Volunteers currently subtract tare by hand (visible on the sheet). Left out per "nothing not needed"; can add a per-entry tare helper later.  
2. **No duty-picker modal.** Nav is derived from role/duty because each shared device hosts one duty workflow. If a future device hosts two, a picker returns.  
3. **AGFP→NTFB category mapping** is maintained in the Report screen (or Admin). Confirm where you want it to live.

 