# R3 — UI/UX Specification

Governs all UI work for R3 (Amazing Grace Food Pantry rescue platform). Read alongside the PRD: **PRD wins on product logic, this doc wins on layout, interaction, and visual contract.** Build order mirrors PRD phases (1 Rescue+scheduling → 2 Receive → 3 Report+Metrics).

Primary users are older volunteers, paper-first, low tech-tolerance. Every choice below serves: big, clear, calm, intuitive, minimum steps.

---

## 0\. Device → surface map

| Device | Owner | Duty / role surface | Primary |
| :---- | :---- | :---- | :---- |
| Personal phone | Each driver | Board, my shifts, availability, pickup, inbox | `drive` |
| Shared tablet | Many volunteers | Weight entry, unscheduled donation | `receive` |
| Shared desktop | Reporter \+ coordinator \+ admin | Report, scheduling, admin, board | `report` / Staff / Admin |

A surface is **canonical** on one device and degrades gracefully elsewhere (responsive matrix, §END).

---

## 1\. Design principles (non-negotiable)

1. **One primary action per screen.** Exactly one high-emphasis button. Everything else is quieter.  
2. **Big targets.** Min interactive size 44×44px (WCAG 2.5.5 AAA / Apple HIG), not the 24px floor. 8px min gap between adjacent targets.  
3. **Large, scalable text.** Base 18px. Must survive 200% zoom without breakage. Relative units only.  
4. **Recognition over recall.** Tap your name from a list, do not type a username. Same action lives in the same place on every screen.  
5. **No fragile controls.** Avoid dropdowns, sliders, and multi-step pickers where a column of big buttons or a visible list fits. Numeric input uses a big on-screen keypad, never a tiny system keyboard.  
6. **Plain language.** No tech jargon (no "PWA", "push subscription", "session"). If a term is unavoidable, define it inline.  
7. **Strip the surface.** Nothing on screen that the task does not require. Low clutter, low memory load.  
8. **Calm, branded, light only.** White surfaces, orange accent, no dark mode, minimal color, no decoration that is not status-bearing.

---

## 2\. Design tokens

Brand values are AGFP-faithful but contrast-corrected. Three brand colors fail as UI text and are constrained accordingly.

| Token | Hex | Role | Note |
| :---- | :---- | :---- | :---- |
| `--brand-orange` | `#e97900` | Accent only: active state, selected bar, focus ring, the heart, icons | Never text. Never carries white text (2.9:1, fails). |
| `--brand-gold` | `#c49e0d` | Logo/decorative only | Never a UI color. |
| `--text` | `#333333` | All body \+ headings | 12.6:1 on white. |
| `--text-muted` | `#747474` | Non-critical labels only | 4.7:1, AA only. Never body text. |
| `--action-fill` | `#e97900` | Primary button background | Label is `--text` (\#1f2933), 5.0:1. |
| `--link` | `#b35c00` | In-content links, always underlined | Darkened from site's \#d86800. |
| `--success` | `#2b7a44` | Confirmed pickup, reported, submitted | White text passes. |
| `--warning` | `#e6a700` | Needs attention, at-risk | Fill behind dark text. |
| `--danger` | `#c2381f` | Cancel, conflict, destructive | White text passes. |
| `--surface` | `#ffffff` | Page background | Matches site. |
| `--surface-paper` | `#f5f3ef` | Receive sheet, cards | Warm off-white. |
| `--structural-dark` | `#363839` | Top bar, footer band | Matches site footer. |
| `--border` | `#d6d2cc` | Grid lines, dividers | Echoes the paper grid. |

**Type scale** (base 18px / 1.5):

- Body 18px · Label 16px (muted only) · H3 22px · H2 28px · H1 34px · Numeric display (weights, totals) 32px bold tabular.

**Spacing:** 4 / 8 / 12 / 16 / 24 / 32 / 48\. Default screen padding 24px. **Radii:** 8px controls, 12px cards. **Focus ring:** 3px `--brand-orange`, 2px offset, on every focusable element.

**Hard rules:** orange is fill-or-accent, never text. Body is `#333333`. Green/gold from the brand are decorative; functional success is `--success`.

---

## 3\. Components (behavior contracts, stack-agnostic)

Each lists states: default / hover / active / disabled / loading where relevant.

- **Button** — primary (orange fill, dark label), secondary (white, border), danger (red fill, white). Min 44px tall, 18px label. Disabled \= greyed, but prefer hiding over disabling.  
- **Big list row** — tappable row ≥56px, name/title left, status chip right, full row is the target. Used for shifts, names, stores.  
- **Numeric keypad** — large 0–9 \+ decimal \+ backspace, ≥64px keys. The only weight/PIN input. No system keyboard.  
- **Text input** — 48px tall, 18px text, visible label above (never placeholder-only). Used sparingly (notes, names in admin).  
- **Card** — `--surface-paper`, 12px radius, 1px `--border`.  
- **Status chip** — pill, text \+ color: Open (orange), Mine (success), Claimed (muted), At-risk (warning), Cancelled (muted strike).  
- **Top bar** — `--structural-dark`, AGFP heart logo left, current user \+ logout right, notification bell with unread count, push-state chip.  
- **Bottom nav (phone)** — ≤4 items, icon \+ label always (no icon-only). 56px tall.  
- **Modal / confirm** — centered, one question, two buttons. Destructive confirm names the consequence ("Release this run? It goes back to the board for others.").  
- **Toast** — bottom, 4s, success/error. Never the only signal for a critical action.  
- **Inbox row** — read/unread dot, event text, time, tap to act.  
- **Empty / loading / error blocks** — every list defines all three. Empty states say what to do next, not just "nothing here".

---

## 4\. App shell, navigation, role/duty

Navigation is **derived from what the logged-in user can do**, not a manual duty switcher. The PRD's "choose which duty" only arises if one shared device hosts multiple duty workflows; with tablet=receive and desktop=report it does not, so no duty-picker modal. Keep it implicit.

- **Phone (driver):** bottom nav \= Board · My Shifts · Inbox · (Pickup appears as a full-screen takeover only while a route is active). Availability lives inside My Shifts.  
- **Tablet (receive):** no nav. Login → Weight entry. Unscheduled donation is one button from there. Truck-inbound is a device-level banner (§5, fires regardless of login).  
- **Desktop (back office):** left nav, sections shown by role/duty:  
  - `report` duty → Report  
  - Staff tier → Schedule (publish, routes, reschedule, assign), Board  
  - Admin tier → Admin (accounts, donors, trucks), Metrics  
  - A Staff member who also reports sees both Report and Schedule. No switching, just both present.

Top bar is identical everywhere for consistency.

---

## 5\. Auth & onboarding

**Login (shared devices, tablet/desktop):**

1. Screen shows a **list of names** (recognition, no typing). Tap your name.  
2. Volunteer → big PIN keypad (4-digit, defaults to last 4 of phone). Staff/Admin → password field.  
3. Session ends by **Logout** (always visible, top bar) or inactivity timeout. Timeout shows a 30s "Still here?" prompt before logging out, so a mid-weighing volunteer is never dumped silently.

**Login (personal phone):** same, but device may remember the user, so it opens to the PIN keypad with the name pre-shown. Persisted login allowed (personal device).

**PWA install \+ notifications onboarding** (required, platform-aware):

- First visit on phone shows a one-card guide: "Add R3 to your home screen so it works like an app and can alert you." Detect iOS vs Android and show the matching 2-step illustration. iOS must install before alerts are possible; say so plainly.  
- After install, a single prompt: "Turn on alerts so you hear about open runs and reminders." One tap.  
- **Push-state chip** is always visible in the inbox header: "Alerts ON" (success) or "Alerts OFF — tap to fix" (warning). Tapping re-walks the permission flow. In-app inbox is the source of truth; the app is fully usable with alerts off, and the copy must never imply otherwise.

---

## 6\. Global interaction patterns

- **Loading:** skeleton rows for lists, never a bare spinner on a blank screen. Sub-300ms actions show nothing.  
- **Empty:** instructive ("No open runs right now. Check back, or set your availability.").  
- **Error:** plain, recoverable ("Could not save. Tap to try again." \+ retry). Never a code.  
- **Destructive confirm:** modal naming the consequence. Cancel is the calm default; the destructive button is red.  
- **Optimistic claim (atomic):** claiming a shift updates instantly. If lost (someone claimed first), revert with a clear toast: "That run was just taken by Karen." This is the only place the no-double-claim rule is user-visible.  
- **Timeout (shared device):** "Still here?" prompt, §5.  
- **Offline:** not supported (PRD). If the network drops, show a blocking banner "You're offline. R3 needs a connection." Do not fake offline capability.  
- **Last-write-wins on weights:** editing a weight overwrites with no undo/history (PRD). Editing shows the prior value so the user sees what they are replacing.

---

## 7\. Microcopy rules

- Plain, short, second person. "Open runs", not "Unassigned shifts". "Weigh", not "Record intake".  
- Forbidden in UI: PWA, push subscription, session, payload, endpoint, atomic, instance.  
- Confirm pattern: question \+ consequence. Error pattern: what happened \+ what to do.  
- Numbers and weights are big and tabular. Units always shown ("lb").  
- Define any unavoidable term inline in parentheses the first time.

---

# PHASE 1 — Rescue loop \+ scheduling

Caps 1–11, 13 (minus truck-inbound). Canonical devices: phone (driver) \+ desktop (staff/admin).

### S1.1 Login

- User/device: all / shared \+ phone.  
- Layout: name list → PIN keypad or password. Per §5.  
- Primary action: Enter.  
- Edge: wrong PIN shows inline count ("3 tries left"), never locks silently on a shared device without telling staff.

### S1.2 Shared shift board (adoption centerpiece)

- User/device: drivers (phone), staff (desktop).  
- Purpose: see every shift and its owner; claim open runs.  
- Layout: vertical list of big rows grouped by day. Each row: date/time, route name, truck, owner name (or "OPEN"), status chip. Open runs float to the top of each day. Filter is a simple segmented control: All · Open · Mine (no dropdown).  
- Primary action: on an Open row, **Claim**. On a Mine row, the row opens S1.3.  
- States: Open (orange chip \+ Claim), Mine (success chip), Claimed-by-other (muted, owner name, no action), At-risk (warning chip, staff view).  
- Edge: recurring shift shows a small "repeats weekly" tag. Claiming prompts: "Claim every Tuesday run, or just this one?" (covers PRD: claim-once-covers-all vs single).  
- Copy: header "Pickup runs". Empty "No runs scheduled yet."

### S1.3 Shift detail

- User/device: owner (phone), staff (desktop).  
- Layout: route stops in order, truck, time, any coordinator→driver note. One primary action by context.  
- Primary action: owner sees **Cancel run** (red). Before-start only; in-progress/past hide it.  
- Cancel flow: confirm naming consequence → returns to board as Open → notifies coordinator \+ eligible drivers (PRD cap 8). Recurring: "Cancel just this one, or this and future?" with a date-range option for bulk.

### S1.4 My shifts \+ availability

- User/device: driver (phone).  
- Layout: two tabs, "My runs" (list) and "When I'm away".  
- Availability entry: pick a date range OR a time window within dates; scope \= "a specific weekly route" or "all routes" (big buttons, not dropdown). Applies only to runs you do not own. If the range overlaps a run you own, Save is blocked with an inline error: "You own a run in this window — cancel it first" (or, if that run is already in progress, "This run is in progress and can't be cancelled — try again once it's done"). Saving notifies coordinator only.  
- Primary action: Save availability.  
- Copy: explain plainly "Telling us you're away helps the coordinator fill runs. It won't cancel runs you already own — you'll need to cancel those yourself first."

### S1.5 Driver pickup execution

- User/device: driver (phone), full-screen takeover while active.  
- Start: two big steps. (1) Pick route (list). (2) Pick truck (list). Driver is known from login.  
- Active view: ordered list of stops as big check-off rows. Tap to mark picked up. Reordering allowed (drag handle, large). A stop can be skipped (swipe or a "Skip" action with reason-free confirm) or the stop set reassigned mid-cycle (PRD cap 10). No completion-confirmation step; the route just ends when stops are done.  
- Per-stop: store info, address, permanent store note (admin), and a field to add a **driver→receiver note** (PRD cap 11).  
- Primary action: the next unchecked stop is visually the focus.  
- Edge: changing order never loses check state. Store permanent notes are read-only here.

### S1.6 Staff — shift & route scheduling

- User/device: staff (desktop).  
- Publish shift: date/time, route, optional truck default. Recurring builder: pick a weekly pattern with plain language ("Every Tuesday, starting \_\_, no end" or an end date). Shifts exist with no driver (PRD cap 4).  
- Route builder: a route is an ordered list of stores. **Drag-and-drop ordering** with large handles; add store from the donor list. Editing a single recurring instance must not break the pattern (PRD cap 4\) — surface this as "Edit just this date" vs "Edit the weekly pattern".  
- Assign/default: staff may set an owner as fallback (PRD cap 6). Same owner field as self-select.  
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
- Trucks: simple list, add/edit/delete. Identity \+ attribution only (no telemetry).  
- Primary action varies per sub-screen (Save).  
- Note: 11 receive categories are treated as a fixed AGFP enum here unless you decide to make them admin-editable (flagged, §Assumptions).

### S1.9 Notification inbox

- User/device: all (phone \+ desktop).  
- Layout: list of events newest first, unread dot, tap to act (deep-links to the relevant shift). Header carries the push-state chip (§5).  
- Source of truth: every event lands here regardless of push (PRD channel strategy).  
- Events (PRD matrix): assigned to you, 1-hour reminder, your unavailability recorded (coordinator only), shift became open, at-risk 1 day before, truck inbound (tablet only, Phase 2).

---

# PHASE 2 — Receive

Caps 12, 14, \+ truck-inbound. Canonical device: shared tablet (landscape).

### S2.1 Receiver login

- Per §5: tap name → PIN. Opens straight to S2.2. Logout \+ timeout active.

### S2.2 Weight entry (THE paper sheet, centerpiece)

- User/device: logged-in receiver, tablet landscape.  
- Mental model \= the Retail Rescue Log. One screen \= one store \+ today \+ this receiver.

┌──────────────────────────────────────────────────────────┐

│ \[AGFP ♥\]   Store:  Sam's ▾      Today · 4-23     Karen  ⎋  │  store picker, date=today (read-only), receiver from login

├──────────────────────────────────────────────────────────┤

│ Tap a category, type the weight, Add. Totals add up for you.│

│                                                            │

│ ┌Frozen Meat┐ ┌Bakery┐ ┌Produce┐ ┌Deli┐ ┌Dairy┐ ┌Dry┐ →   │  11 category tiles, scroll/grid; each \= big target

│ │  293 lb   │ │323 lb│ │1222 lb│ │31 lb│ │  0  │ │528│     │  LIVE subtotal per category (replaces hand math)

│ │ 61 232 ✎  │ │ 323  │ │516 706│ │ 31  │ │     │ │528│     │  running entries underneath (gapless, no line \#s)

│ └───────────┘ └──────┘ └───────┘ └─────┘ └─────┘ └───┘     │

├──────────────────────────────────────────────────────────┤

│ Selected: Produce            entry: \[ 5 1 6 \] lb   ⌫       │

│   ┌───┬───┬───┐                                            │

│   │ 7 │ 8 │ 9 │     \[  Add weight  \]                       │  big keypad, ≥64px keys

│   ├───┼───┼───┤                                            │

│   │ 4 │ 5 │ 6 │     Today's total:  2192 lb                │

│   ├───┼───┼───┤                                            │

│   │ 1 │ 2 │ 3 │     \[  Submit sheet  \]  (success)          │

│   ├───┴───┼───┤                                            │

│   │   0   │ . │                                            │

│   └───────┴───┘                                            │

└──────────────────────────────────────────────────────────┘

- Categories (fixed, from the sheet): Frozen Meat, Bakery, Produce, Deli, Dairy, Dry, Frz Non Meat, Non Food, Pet, Health & Beauty, Trash.  
- Flow: tap a category tile (it highlights with `--brand-orange` bar) → type weight on keypad → **Add weight**. The number appends to that category's running list and the subtotal updates. Repeat. **Submit sheet** confirms the whole store session (PRD cap 14: confirmed on submit, no separate sign-off).  
- Edit: tap an existing entry (✎) to overwrite it (last-write-wins, shows prior value, no undo).  
- Why it works: paper-parity (category columns, running numbers, totals row, "the sheet") \+ big targets \+ auto-totals (kills the hand arithmetic) \+ no line-skipping concept.  
- States: empty store (prompt to pick a store first, keypad disabled), unsaved entries (Submit emphasized), submitted (success confirmation, screen resets for next store).  
- Edge: switching store mid-sheet with unsaved entries warns. Decimal allowed (scale reads).

### S2.3 Unscheduled donation

- User/device: receiver (tablet), one button from S2.2.  
- Purpose: record a donation arriving outside a scheduled pickup (PRD cap 12).  
- Layout: same weight-by-category surface, plus a **Report toggle, default ON** ("Report this to North Texas Food Bank") and a donor field. Donor attribution is optional only when the toggle is OFF.  
- Key boundary surfaced: ON → counts toward the NTFB report. OFF → tracked for pantry metrics only, never reported. Copy must make this visible: "Reported donations go in the weekly NTFB report. Unreported ones still count in our own totals."  
- Primary action: Submit.

### S2.4 Truck-inbound alert (device-level)

- The tablet holds a device push subscription that fires regardless of who, if anyone, is logged in (PRD §2).  
- Behavior: full-width banner at top \+ sound, "Truck inbound — Sam's run returning." Dismiss is large. Does not require login to show. If someone is mid-weighing, it banners above without stealing the keypad.

---

# PHASE 3 — Report & Metrics

Caps 15–16. Canonical device: shared desktop. Pure aggregation over Phase 1+2 data.

### S3.1 Report generation

- User/device: anyone with `report` duty (desktop).  
- Purpose: produce the weekly NTFB (Meal Connect) report from system data, no Excel re-summing (Success Metric 3).  
- Layout: pick a week. Show AGFP categories with auto-summed weights, mapped to NTFB categories via an **in-app AGFP→NTFB mapping** (editable mapping table maintained here or in Admin). Every line is **inspectable down to store-category-day** (Success Metric 4: 100% traceable) — click a number to expand the underlying entries with the store, day, and receiver.  
- Only donations flagged for reporting flow in (the toggle). The screen states the two numbers separately where relevant.  
- Primary action: **Export** (Meal Connect format). Secondary: drill-in.  
- States: incomplete week (show what is missing), ready, exported.  
- Edge: an edited weight upstream (last-write-wins) reflects here live; no version history shown (PRD out-of-scope).

### S3.2 Admin metrics

- User/device: admin (desktop).  
- Purpose: per-store and total-intake metrics, including **unreported** donation volume (PRD cap 16, intake ≠ reported).  
- Layout: per-store table (total rescued, reported, unreported, trend) \+ totals. Simple bar/line, no heavy dashboard. Surfaces patterns like a store consistently under-donating (PRD problem statement).  
- Primary action: none destructive; this is read \+ export.  
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
| Report \+ metrics | n/a | usable | **canonical** |
| Inbox \+ push state | canonical | canonical | canonical |

"Degraded" \= works but not optimized; "n/a" \= not a target for that device.

---

## Open assumptions (confirm or override)

1. **11 receive categories are a fixed enum**, taken from the paper sheet, not admin-editable in v1. If NTFB categories or store mix change often, make them master data (adds an Admin screen).  
2. **No tare math in v1.** Volunteers currently subtract tare by hand (visible on the sheet). Left out per "nothing not needed"; can add a per-entry tare helper later.  
3. **No duty-picker modal.** Nav is derived from role/duty because each shared device hosts one duty workflow. If a future device hosts two, a picker returns.  
4. **AGFP→NTFB category mapping** is maintained in the Report screen (or Admin). Confirm where you want it to live.

