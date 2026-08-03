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
- **Segmented control** — one row of ≥44px buttons, exactly one chosen, all options visible without opening anything. This is the stand-in for the dropdown §1.5 rules out; use it wherever a screen offers a small, fixed set of choices. Selected = `--action-fill` with a `--text-on-brand` label, in every use. Two behaviors, and the difference is not cosmetic:
  - **Filter** (default) — narrows a list that stays on screen (S1.2's All · Open · Mine). Toggle semantics; every option is reachable by keyboard directly, so a keyboard user does not change the filter twice on the way to the third one.
  - **Tabs** — switches which panel is shown (S1.4's My runs / When I'm away; S1.8's five sub-screens). Tab semantics, which oblige the rest of the pattern: one stop in the tab order, arrow keys between tabs, Home/End to the ends, and each tab bound to the panel it controls. A screen using this behavior must render exactly one panel and bind it back. Declaring tabs without the keyboard behavior is worse than not declaring them, because it promises an interaction that is not there.  
- **Big list row** — tappable row ≥56px, name/title left, status chip right, full row is the target. Used for shifts, names, stores.  
- **Numeric keypad** — large 0–9 + decimal + backspace, ≥64px keys. The only weight/PIN input. No system keyboard.  
- **Text input** — 48px tall, 18px text, visible label above (never placeholder-only). Used sparingly (notes, names in admin).  
- **Card** — `--surface-paper`, 12px radius, 1px `--border`.  
- **Form section** — a heading plus one sentence over a group of related fields inside a longer form. For a group whose fields change something the person filling it in cannot otherwise see: the donor form's trash rates change what the food bank is told (S1.8). Not decoration and not for every form — a heading over fields that explain themselves is the restated hint §7 deletes.  
- **Status chip** — pill, text + color: Open (orange), Claimed (muted), In progress (`--brand-orange` filled), Done (muted), At-risk (warning), Cancelled (muted strike). One chip per row, reflecting `Shift.status`.  
- **Mine** is an *ownership overlay*, not a status — it renders in success color and replaces the Claimed chip when the viewer is the owner. Every other status keeps its own chip regardless of who owns the shift.  
- **Top bar** — `--structural-dark`, product name in words on the left, current user + logout right, notification bell with unread count, push-state chip. **Not the AGFP mark**: it is dark type on a white ground and cannot sit on this bar without a plate. Since `D32` the mark lives at the top of the side nav (§4), where it has the ground it was drawn for.  
- **Bottom nav (phone and tablet)** — ≤4 items, icon + label always (no icon-only). 56px tall. The cap is load-bearing, not cosmetic: it is what forces the office entries onto the Home hub rather than into a bar nobody can read (`D22`, §4). Since `D30` the bar is not a truncation of the desktop list — the desktop list is one entry per capability too, and the bar simply carries the two duty entries plus Home and Inbox.  
- **Modal / confirm** — centered, one question, two buttons. Destructive confirm names the consequence ("Cancel this run? It goes back to the board for others to pick up."). The calm default reads "Cancel" unless the destructive action is itself a cancel, in which case it takes a distinct word ("Keep it") — two buttons reading "Cancel" is not a choice.  
- **Toast** — bottom, 4s, success/error. Never the only signal for a critical action.  
- **Inbox row** — read/unread dot, event text, time, tap to act.  
- **Empty / loading / error blocks** — every list defines all three. Empty states say what to do next, not just "nothing here". A **dead-end** state — no access, not found, nothing to act on — must also carry the way out as a control, not only as advice. The original reason was that the tablet had no nav; `D22` gave it one, but the rule outlived its justification and is now stated in its own right: **a full-screen route has no nav either** (login, and S1.5's pickup takeover including its read-only completed summary), so any screen that can be reached and not acted on needs a door. "Read only" is a statement about the data, not a reason to trap someone.

---

## 4. App shell, navigation, role/duty

Navigation is **derived from what the logged-in user can do**, not a manual duty switcher. There is still **no duty-picker modal** and adding one is a spec change, not a feature.

> **Amended by `D22`, 2026-08-02.** The original rule read "the PRD's 'choose which duty' only arises if one shared device hosts multiple duty workflows; with tablet=receive and desktop=report it does not." **The conclusion survived; the premise did not.** A volunteer holding `DRIVE` **and** `RECEIVE` (a real account) carries both workflows on one device, and the tablet is not only a receive station — a desktop window narrowed to iPad width lands in the same band. The old rule gave that band *no navigation at all*, so every link vanished and `Receive` had no nav entry on **any** surface: a receiver could not find how to start weighing. Navigation is now present on every surface and **grouped by capability**, which separates the duties without ever asking the user to choose between them.

**Home (`/`)** is the landing screen for everyone, replacing the board as the front door. It shows one large card per thing this user can do, derived from tier and duty exactly as the nav is. It is not a duty picker: nothing is being selected, and every capability is visible at once.

> **Amended again by `D30`, 2026-08-02.** `D22`'s grouping left two or three entries inside some
> groups, and the four-item bar could only show the first of each — which read as truncation rather
> than design. The rule is now **one nav entry per capability, on every surface**. The groups go
> with it: a heading over a single item is noise.

**Home (`/`)** is the landing screen for everyone, replacing the board as the front door. It shows one large card per thing this user can do, derived from tier and duty exactly as the nav is. It is not a duty picker: nothing is being selected, and every capability is visible at once. **Home is capped at six cards** (`D31`) — Pick up food, Receive a load, Report, Schedule, Admin, Inbox — which is every capability a single account can hold.

- **Phone and tablet:** bottom nav, **capped at four items** (§3), icon and label: `Home · Pick up (DRIVE) · Receive (RECEIVE) · Inbox`. A user holding neither duty gets Pick up food in the second slot rather than a two-item bar. Office work (Schedule, Report, Admin) is reached **through Home** on these surfaces — the cap leaves room for four and an admin who also drives has six destinations, which is what earns Home its place. Labels are shorter here than on the desktop for one reason: the bar is 56px tall with the icon above the word, and "Receive a load" does not fit on a 375px phone at four across. Pickup remains a full-screen takeover while a route is active.
- **Desktop (back office):** left nav, one flat run, no headings:

  | Entry | Shown when |
  | :---- | :---- |
  | Home | always |
  | Pick up food | `DRIVE` **or** Staff tier |
  | Receive a load | `RECEIVE` duty |
  | Report | `report` duty |
  | Schedule | Staff tier |
  | Admin | Admin tier |
  | Inbox | always |

  **The order is the order a week runs** — pick the food up, receive it, report it — with the two screens everyone holds bracketing it. This replaces `D22`'s staff-first reading of the back office, and it is the order the Home cards use, so the two surfaces cannot teach a volunteer different vocabulary. The board stays available to the **Staff tier** as well as to drivers: a coordinator watches claims land there.

  **Two screens lost their own entry and gained a home inside one.** *My shifts* is a tab on the board (`?tab=mine`, `D30`), because a driver's own runs and their days off are the same capability as the board they claim from. *Log a donation* is reached from the `Unscheduled donation` button on S2.1b, which is on screen in every state including the empty one. Neither is stranded, and neither earns a top-level slot.

  Admin leads to metrics, accounts, donors, trucks and **categories** — five tabs since `D40` merged category matching into the categories tab.

The **AGFP mark sits at the top of the desktop side nav**, not in the top bar (`D32`): the mark is dark type on a white ground and §3 pins the top bar to `--structural-dark`, where it can only appear on a light plate that reads as a sticker. Tapping it goes Home. The consequence, accepted: **the mark does not appear on a phone or tablet at all**, which have no side nav — an unreadable mark is worth less than none, and a light-on-dark variant of the pantry's own branding is theirs to supply, not ours to invent. The top bar carries the product name in words.

Truck-inbound is a device-level banner (§5, fires regardless of login) and is not a nav entry. Top bar is identical everywhere for consistency.

---

## 5. Auth & onboarding

**Login (shared devices, tablet/desktop):**

1. Screen shows a **list of names** (recognition, no typing). Tap your name.  
2. Volunteer → big PIN keypad (4-digit, defaults to last 4 of phone). Staff/Admin → password field.  
3. Session ends by **Logout** (always visible, top bar) or inactivity timeout. Timeout shows a 30s "Still here?" prompt before logging out, so a mid-weighing volunteer is never dumped silently.

**Login (personal phone):** same, but device may remember the user, so it opens to the PIN keypad with the name pre-shown. Persisted login allowed (personal device).

**PWA install + notifications onboarding** (required, platform-aware):

- First visit on phone shows a one-card guide: "Add R3 to your home screen so it works like an app and can alert you." Detect iOS vs Android and show the matching 2-step illustration. iOS must install before alerts are possible; say so plainly.  
- After install, a single card: the heading "Turn on alerts" and a button reading the same. One tap. *(The explanatory sentence beneath it was cut under `D21` — it restated the heading.)*  
- **Push-state chip** is always visible in the inbox header: "Alerts ON" (success) or "Alerts OFF, tap to fix" (warning). Tapping re-walks the permission flow. In-app inbox is the source of truth; the app is fully usable with alerts off, and the copy must never imply otherwise.

---

## 6. Global interaction patterns

- **Loading:** skeleton rows for lists, never a bare spinner on a blank screen. Sub-300ms actions show nothing.  
- **Empty:** instructive ("No open runs right now. Check back, or set your availability.").  
- **Error:** plain, recoverable ("Could not save. Tap to try again." + retry). Never a code.  
- **Destructive confirm:** modal naming the consequence. Cancel is the calm default; the destructive button is red.  
- **Optimistic claim (atomic):** claiming a shift updates instantly. If lost (someone claimed first), revert with a clear toast: "That run was just taken by Karen." This is the only place the no-double-claim rule is user-visible.  
- **Timeout (shared device):** "Still here?" prompt, §5.  
- **Offline:** not supported (PRD). If the network drops, show a blocking banner reading "You're offline." Do not fake offline capability. *(The second sentence was cut under `D21` — it restated the first. It survives verbatim in `api/errors.ts`, where a failed request has no heading above it.)*  
- **Editing a weight looks like overwrite, isn't stored that way:** to the user, editing a weight just replaces the number with no undo/history UI (PRD), and the entry shows the prior value so they see what they're replacing. Underneath, the original entry is voided (not deleted) and a new one inserted (Domain I13) — weight rows are immutable for audit purposes; the UI simply never surfaces the void history.

---

## 7. Microcopy rules

- Plain, short, second person. "Open runs", not "Unassigned shifts". "Weigh", not "Record intake".  
- Forbidden in UI: PWA, push subscription, session, payload, endpoint, atomic, instance.  
- Confirm pattern: question + consequence. Error pattern: what happened + what to do.  
- Numbers and weights are big and tabular. Units always shown ("lb").  
- Define any unavoidable term inline in parentheses the first time.
- **No em dashes.** Write two sentences, or use a comma. Do not substitute a hyphen or an en dash — that is the same habit with different punctuation. A `—` standing in for an *empty value* (`{value === '' ? '—' : value}`) is a glyph, not prose, and is fine. Where a runtime string joins parts for a label or an `aria-label`, join with a comma: a screen reader pauses on one.
- **Delete a hint that restates the control it sits under.** "Tap your name." above a list of names, or "Turn on alerts so you hear about open runs." under a heading reading *Turn on alerts*, teach nothing and make the screen longer.  
  Keep what the reader cannot see for themselves: **what an irreversible action will do**, **why something is blocked or missing**, and **what a number means** where two similar numbers sit together. That third one is why S3.2 spells out Intake versus NTFB-reported and why S3.1 keeps `remapNotice`.  
  This rule trims copy; it does not remove the two component contracts that require it. `EmptyState` still needs a body — it says what to do next, never "nothing here" — and `ConfirmModal` still needs a `consequence`. Shorten the words inside them.

*The last two rules are `D21`, taken after the first hands-on QA pass read the app back as over-explained.*

---

# PHASE 1 — Rescue loop + scheduling

Caps 1–11, 13 (minus truck-inbound). Canonical devices: phone (driver) + desktop (staff/admin).

### S1.0 Home (hub)

*Added by `D22`, 2026-08-02. Not part of the original screen set — recorded here as a deliberate addition rather than a screen that was always meant to exist.*

- User/device: all / every surface. This is where sign-in lands, replacing the board as the front door.
- Layout: a greeting, then one large tappable card per capability this user holds, in the order duties-then-tier: **Pick up food** and **My shifts** (`DRIVE`) · **Receive a load** (`RECEIVE`) · **Reports** (`report`) · **Schedule** (Staff) · **Admin** (Admin) · **Inbox** (always, last).
- Cards are derived from tier and duty by the same rule as the nav (§4). **This is not a duty picker**: nothing is chosen and every capability is visible at once. §4's ban stands.
- Card subtitles are **static descriptive text**, not live counts. A hub that fans out five API calls on every sign-in is worse than one that does not; the card list is built so a live line can be added later without restructuring.
- Empty state: a volunteer with no duties (a real case) gets the Inbox card plus "Nothing is assigned to you yet." and is told to ask a coordinator. They must never be stranded.
- Why it exists rather than a longer nav: §3 caps the bottom nav at four items, and an admin who also drives has six destinations. The hub is where the surplus goes.

### S1.1 Login

- User/device: all / shared + phone.  
- Layout: the AGFP wordmark, then name list → PIN keypad or password. Per §5.  
- The wordmark is the pantry's own logo file: it is dark type on transparent, so it reads on `--surface` and would disappear on the `--structural-dark` top bar, which is why the bar carries the product name in words instead (§3, `D32`). Since `D32` this is no longer the *only* screen carrying the mark — the desktop side nav carries it too, on the same light ground and for the same reason. Signed-out is still the one moment the app belongs to the pantry rather than to a duty. Alt text is "Amazing Grace Food Pantry" — the mark *is* that name set in type, so "logo" would drop the only word it carries.  
- Primary action: Enter.  
- Edge: wrong PIN shows an inline count ("3 tries left"). At zero the account soft-locks for ~15 minutes and the message says so exactly — "Too many tries. Try again in 15 minutes." The lock always self-clears; copy must never imply a volunteer needs staff to unlock them, because nobody can (Architecture §4.2). Repeated attempts during the lock do not extend it.

### S1.2 Shared shift board (adoption centerpiece)

- User/device: drivers (phone), staff (desktop).  
- Purpose: see every shift and its owner; claim open runs.  
- Layout: vertical list of big rows grouped by day. Each row: date/time, route name, truck, owner name (or "OPEN"), status chip. Open runs float to the top of each day. Filter is a simple segmented control: All · Open · Mine (no dropdown).  
- Primary action: on an Open row, **Claim**. On a Mine row, the row opens S1.3.  
- States: Open (orange chip + Claim), Mine (success chip), Claimed-by-other (muted, owner name; **no action for a driver — staff open S1.3**), In progress (**no action for a driver on someone else's run; the driver's own opens S1.3** — staff open any), Done (muted, read-only), At-risk (warning chip, staff view).  
- **Who may open a row into S1.3.** A driver opens only their own (Mine) rows. **Staff open any row**, including Claimed-by-other and In progress — S1.3 names staff as one of its two users and this board is its primary entry point, so a driver-only reading would leave the staff half of S1.3 unreachable. This is navigation only: it confers no action on the board itself, and everything S1.3 offers is re-authorized there. (Scoped per-viewer the same way At-risk already is.)  
- Edge: recurring shift shows a small "repeats weekly" tag. Claiming prompts: "Claim every Tuesday run, or just this one?" (covers PRD: claim-once-covers-all vs single).  
- **Partial-success feedback:** claiming "every Tuesday run" only claims instances where `eligible()` holds (Domain) — some future instances may be skipped (conflict with the driver's own overlapping shift or declared availability), never force-claimed. On completion, a toast/summary states the actual result: "Claimed 10 of 12 Tuesday runs. 2 skipped (conflicts with your schedule).", with a link to view which dates were skipped. A full-success claim (12 of 12) shows the normal, unremarkable success toast — the partial-result summary only appears when at least one instance was skipped.  
- Copy: header "Pickup runs". Empty "No runs scheduled yet."
- **Two tabs since `D30`:** `Board` (default) and `My shifts`, in `?tab=` so a tab is a link someone can send and survives a reload — the same pattern S1.8 uses, including "an unknown tab lands on the default, not a 404". The tab row appears **only for a driver**: a coordinator who does not drive has no second tab, and a single tab is noise. `My shifts` mounts S1.4 without its own heading, since the board owns the page title. This is where S1.4 went when the nav collapsed to one entry per capability; `/my-shifts` still resolves for a bookmark.

### S1.3 Shift detail

- User/device: owner (phone), staff (desktop).  
- Layout: route stops in order, truck, time, any coordinator→driver note (`Shift.staff_note`, PRD cap 11) — staff can add/edit it here (desktop view); driver sees it read-only. One primary action by context.  
- Conflict flag: if staff assigned this shift over a declared-availability or overlapping-shift conflict (PRD cap 6), the owner sees a persistent banner: "This run conflicts with your declared availability. Contact staff if that's a problem." Informational only; does not block pickup execution.  
- Primary action: owner sees **Cancel this run** (red). Before-start only; in-progress/past hide it. **When it is hidden, the owner is told why** and given the way out ("This run has started…", pointing at a coordinator) — QA found the button's silent disappearance read as the feature being missing. The gate itself is unchanged: `CLAIMED` is the only state with a release edge (§3.1).  
- **Driver-facing verb.** Drivers read "cancel", never the domain's "release" — the plainer word is what they reach for. The transition is still `CLAIMED → OPEN` (§3.1) and never `CANCELLED`, which stays staff-only and terminal (I10), so *every* driver-facing sentence must also state where the run goes ("it goes back to the board"). The word alone would promise the pickup is off, which is the opposite of what happens. Code, routes and payloads keep `release`, which names the actual edge; only copy changes.  
- Cancel flow: confirm naming consequence → returns to board as Open → notifies coordinator + eligible drivers (PRD cap 8). Recurring: "Cancel just this one, or this and future?" with a date-range option for bulk. Either way the affected instance(s) go back to Open for someone else to claim — the series itself is untouched and keeps generating beyond the range. (This is distinct from staff's separate, staff-only bulk-terminate for permanently ending part of a series — not available to drivers.)  
- **Reassign stop (staff-only, PRD cap 10):** on an `IN_PROGRESS` shift's stop list (staff/desktop view only), each unresolved stop (PENDING or COLLECTED-not-yet-weighed) shows a **Reassign** action. Picking it opens a driver picker (any driver with an open or in-progress shift today); confirming marks that stop `REASSIGNED` on this shift (excluded from this shift's completion gate, shown struck-through here) and adds it as a new pending stop at the end of the destination driver's active shift. Already-weighed stops have no Reassign action — there's nothing left to move.

### S1.4 My shifts + availability

- User/device: driver (phone).  
- **Reached as a tab on S1.2, not from the nav** (`D30`). It is the same capability as the board — a driver's own runs and their days off — and one capability gets one nav entry. It keeps its own route (`/my-shifts`) for bookmarks, where it renders standalone with its own heading; embedded as a tab it drops that heading and the board's title stands.  
- Layout: two tabs, "My runs" (list) and "When I'm away".  
- Availability entry: pick a date range OR a time window within dates. The window is **two `TimeField` pickers** (§3), start and end, not a grid of every half-hour — the same control the scheduling form uses, for the same reason: a wall of always-visible time buttons is its own kind of unusable. Applies whole-person — it blocks that time across every route, not a specific one — and only to runs you do not own. If the range overlaps a run you own, Save is blocked with an inline error: "You own a run in this window. Cancel it first." (or, if that run is already in progress, "This run is in progress and can't be cancelled. Try again once it's done."). Saving notifies coordinator only.  
- Primary action: Save availability.  
- Copy: explain plainly "Telling us you're away helps the coordinator fill runs. It won't cancel runs you already own. You'll need to cancel those yourself first."

### S1.5 Driver pickup execution

- User/device: driver (phone), full-screen takeover while active.  
- Start: one big step — pick a truck (list). The route itself is already fixed (Staff bound it at scheduling, S1.6); the driver is starting their claimed/assigned shift, not choosing among routes. Driver is known from login.  
- Active view: ordered list of stops as big check-off rows. Tap to mark picked up. Reordering allowed, via **large "Move up" / "Move down" buttons on each stop — not a drag handle**. Drag was specified here originally and rejected in Wave 4a: HTML drag-and-drop does not fire on touch at all, so it would work on the staff desktop and silently fail on the phone this screen is built for; a hand-rolled touch drag is exactly the fragile control §1.5 rules out; and a drag library is a dependency (build-plan §3/D5). Buttons also survive the one-handed, gloved, moving-truck case that drag does not. A stop can be skipped (swipe or a "Skip" action with reason-free confirm). No step is required to close the shift (still receiver-only, S2.2b Receive done) — the route just ends when stops are done. Reassigning a stop to another driver mid-run is a **staff-only** action (S1.6/S1.3), not something the driver does from here — see S1.6.  
- Per-stop: store info, address, permanent store note (admin, `Donor.note`), and a field to add a **driver→receiver note** — `ShiftStop.note`, this stop only (PRD cap 11), distinct from the whole-run note below.  
- Primary action: the next unchecked stop is visually the focus.  
- **Completing the run (`D23`, amended 2026-08-02):** once every stop is COLLECTED, SKIPPED or REASSIGNED (no PENDING left — I27's gate; a stop moved to another driver is resolved *for this run*, per the Reassign action above), a **"Complete this run"** button appears below the stop list. Tapping it opens a **confirm modal** carrying the shift summary (route, stop-by-stop status, each stop's `ShiftStop.note` if any) and the driver's whole-run note (`Shift.note`), with a single confirming action.
  - Confirming sets `Shift.pickup_completed_at` and then **navigates to Home**. The shift itself stays `IN_PROGRESS` and nothing downstream is gated on this: **`I11` (locked) makes the receiver's receive-done the only completion, and `I12` holds `COMPLETED` behind every stop being WEIGHED.** What the button completes is the *driving*, and no copy on this screen may suggest otherwise. The wording is a deliberate human choice recorded in `D23`; the state machine did not move.
  - Afterwards the run is a **read-only summary with no actions** — stops, dispositions, notes, and the run note now **locked**. There is no re-open and no "Review your run". Re-opening the run from S1.4 shows the same summary.
  - **"Flag a stop not on my route" is gone from the summary too**, which is the cost of the read-only choice. The screen therefore says so and tells the driver to phone the pantry. The one control that remains is the way *off* the screen: S1.5 is a full-screen takeover with no nav, so a read-only screen still needs a door.
  - **In Phase 2** confirming also fires the truck-inbound push (device-scoped, S2.4) to the receiver tablet — that alert was explicitly out of Phase 1 (`product-requirement.md §5` scopes it as caps 1–11, 13 *minus* truck-inbound) and the Phase-1 server deliberately enqueued nothing here. It stays optional: a driver who never taps it causes no problem, and the receiver still resolves stops normally.
- **Flag ad-hoc pickup (Phase 2):** a secondary action ("Flag a stop not on my route") lets the driver record a donor they picked up from mid-run that isn't part of the planned route — **just a donor picker or a typed store name, and an optional note. No weight entry and no category.** This creates a `SUGGESTED` UnscheduledDonation (PRD cap 12, Domain I17) that prefills S2.3 for the receiver to confirm with weights later; it never creates or touches a `ShiftStop`, so the planned route stays unaffected.
  - *This sentence was briefly untrue and is now true again.* `D8` had to add a category picker here, because the locked `domain-modeling.md §2.3` required a Category on every `UnscheduledDonation` and a `SUGGESTED` row could not be stored without one. `D24` (2026-08-02) made the category optional until `CONFIRMED`, so the driver's picker is gone — they cannot know the category and it is not their job. **The lower-authority doc was right all along**; the conflict is resolved in its favour rather than against it.
  - The anonymous "no name for it" option is also gone: the choices are a store from the list, or **Other** with a **required** typed name.  
- Edge: changing order never loses check state. Store permanent notes are read-only here.

### S1.6 Staff — shift & route scheduling

- User/device: staff (desktop).  
- Publish shift: date/time, route. No truck field here — truck is picked by the driver at start (S1.5), not set by staff at publish. Recurring builder: pick a weekly pattern with plain language ("Every Tuesday, starting Aug 4, no end" or an end date). **The "starting" date is displayed, not entered** — it is the first occurrence the pattern will actually mint, computed from today and the chosen weekday, and the control is read-only. A pattern has no stored start date: `domain-modeling.md §5.3` (locked) names `endDate` as the only stop condition and runs the loop over `[now, horizon]`, and `data-model.md §5.2` has no `start_date` column. A series therefore begins when it is created, and the sentence tells the user which date that works out to rather than asking them to choose one. Shifts exist with no driver (PRD cap 4).  
- Route builder: a route is an ordered list of stores. **Drag-and-drop ordering** with large handles; add store from the donor list. Editing a single recurring instance must not break the pattern (PRD cap 4) — surface this as "Edit just this date" vs "Edit the weekly pattern". *(Built as a scope control **inside** the run editor rather than a prompt in front of it: QA found being asked the question before seeing the run made staff guess. Both phrases survive verbatim as the control's legend and its pattern option, and the save path still branches on the explicit scope, which is what keeps `I23`/`I24` true.)*  
- **Reordering is drag or arrow keys, and there is no touch path.** The handle is a focusable button that reorders on ArrowUp / ArrowDown, so a keyboard user is covered; HTML5 drag events do not fire on touch at all, so a touch-only tablet cannot reorder a route. This is a ruling, not an oversight — three commands per row read as verbose beside a handle that already covers the common case, so the per-row Move up / Move down buttons were removed (`phase-1-state.md` A151, superseded). Everything else on this screen still works on a tablet; **reordering specifically is desktop-or-keyboard only**, which is the caveat behind this screen's "usable" mark in the responsive matrix.  
- Assign/default: staff may set an owner as fallback (PRD cap 6). Same owner field as self-select. If the chosen driver conflicts with their declared availability or another owned shift, staff sees an inline warning and must confirm ("Karen marked herself away then — assign anyway?") before it goes through; the assignment is not blocked. The resulting shift shows a conflict flag to the driver (their board/shift-detail view), prompting them to contact staff.  
- Primary action: Publish / Save.

### S1.7 Staff — reschedule

- User/device: staff (desktop).  
- Flow: move date/time. Owner kept by default. Before confirm, app surfaces any conflict with that owner's declared availability (PRD cap 9). On confirmed conflict, owner is released → shift returns to board Open. System never auto-picks a replacement.  
- Primary action: Confirm new time.  
- Copy: conflict warning is explicit: "Karen marked herself away then. Moving this releases her run back to the board."

### S1.8 Admin — accounts, donors, trucks

- User/device: admin (desktop).  
- Layout: five sub-screens — **Metrics** (default), Accounts, Donors, Trucks, **Categories** — selected by the §3 segmented control in its **tabs** behavior. One is shown at a time; §1.5 rules out putting them behind a dropdown. The tab is addressable as `?tab=`, so a link can open one directly.
  - **Metrics** is S3.2, unchanged in what it computes; `D18` folded it in because Admin and Metrics were two adjacent ADMIN-only nav entries that read as two places. `/metrics` still resolves, as a redirect.
  - **Category matching is no longer its own tab (`D40`, 2026-08-02).** `D17` moved the AGFP→NTFB mapping here from S3.1 (superseding `D11`); `D40` retires the *tab* — not the mapping, whose rules are unchanged. Where a category reports to is now edited **where the category is configured**, which is the same instinct as `D30`: one thing, one place. `?tab=mapping` still resolves, as a redirect to Categories — the courtesy `D18` gave `/metrics`. Its routes stay `tier: 'ADMIN'`; the report's own routes stay `report`-duty.  
- Accounts: list of users; create (first/last → auto username shown read-only), assign tier (Volunteer/Staff/Admin) and duties (drive/receive/report as toggles), set/reset PIN or password. Delete non-admin. Username immutable once set (PRD §2).  
- Donors: list of permanent stores (master data), add/edit/delete, attach permanent per-store note. Also holds two things the food bank needs and nothing else in the app can set:
  - **Food bank store number** (`donor.ntfb_donor_code`) — NTFB's own number for this store, as their picker shows it (`H-E-B Food Stores (810)`). It prints on every receipt for that store. Until `D27` this column existed but had **no write path anywhere in the app** and could only be set by hand-written SQL.
  - **Trash deduction** (`D27`) — three percentages, bakery / produce / deli, under a heading with one sentence saying what they do. **Blank means "use the pantry default"**, and a blank field shows the effective default beside it; an explicit `0` means this store is deducted nothing, and the two must stay visually distinct because they are different facts. This is the one place in the app where a number silently changes what the food bank is told, so `§7`'s "keep what the reader cannot see for themselves" applies and the explanation stays.  
- Trucks: simple list, add/edit/delete. Identity + attribution only (no telemetry).  
- Categories: **two sections on one tab since `D40`.** Above, the pantry's own categories — name, plus **where it reports to** (NTFB category and Storage) edited inline on the same row, so an admin never finishes here and goes somewhere else to say where it reports. Below, **North Texas Food Bank's categories**: the reference list `D26` seeds, read-mostly, each showing how many of ours map to it.
  - Add, archive, delete. **Removal follows I21 like every other master record**: a category with referencing history is archived (deactivated), never destroyed — it stays hidden from the S2.2 weight-entry keypad while history and reports keep resolving it — but one with no referencing history at all may be hard-deleted, which is how a category added by mistake is undone. The UI does not make the user choose: *Delete* asks the domain, and the domain decides which of the two happened (PRD "Category management"). Seeded with the 11 AGFP categories at launch.  
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
- **Three bands since `D38`**, because a flat list of every open run was described by a long-serving volunteer as overwhelming, and tomorrow's run sat close enough to today's to be tapped by mistake:
  1. **Still to weigh** — large, roughly square cards. The visual centre of the screen and the only thing a receiver usually needs.
  2. **Ready to finish** — the existing horizontal rows. Deliberately *not* labelled "Finished": these runs have every stop resolved but are still `IN_PROGRESS`, and calling them finished would claim `I11` had happened when it has not.
  3. **Later this week** — collapsed behind a disclosure, closed by default. One tap opens it; nothing is removed.
- **Band 1 catches overdue runs, not only today's.** The cut is `occurrence_date <= pantry today`, not `= today`: a run left unweighed from last Tuesday is not "later this week", and burying it is how it stays unclosed. Only future runs collapse.
- **No band heading says "Today" or "Yesterday".** The grouping is against the pantry's today, but the wording is not, so a heading can never contradict the `occurrence_date` shown on a row.
- Each row shows the run's stops with a status dot (pending / weighed / skipped) and an "N of M done" count — this is the stop list the old store-only flow had no room for.  
- **`Unscheduled donation` is on screen in every state, including the empty one.** Since `D30` removed its nav entry, this button is the only way to reach S2.3. It stays `secondary`: §1's one high-emphasis action per screen belongs to picking a run, which is the question the screen asks.  
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
- Per-stop resolution: **Done** finalizes this stop (any non-voided weight_entry already resolves it to WEIGHED — this button just navigates on to the next unresolved stop). **Skip** sets the stop's disposition to SKIPPED (confirm dialog, since it can't be un-skipped from here). Either advances the stop-status strip and returns to the run's next pending stop, or to S2.1b if none remain. *(Both were longer — "Mark stop weighed" and "Skip stop" — until `D37`. The buttons carry an accessible name that still states the object, "Done with this stop" and "Skip this stop", so shortening the visible label did not shorten what a screen reader announces. The skip **confirm** still says "Skip stop": §3 wants a destructive confirm to name the action, not echo the button that opened it.)*  
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
- **Three states, not two (`D37`, 2026-08-02).** The screen used to offer `Receive done` whether or not the run was already closed, so a volunteer could tap it a second time:
  - **Blocked** — a stop is unresolved. Lists what is outstanding; the picker routes to it.
  - **Confirm** — every stop resolved, run still open. `Receive done` is primary, and beside it **Change a weight** returns to S2.2, because the confirm step must stay reversible until it is taken. Submitting navigates to **Home** (`D22` gave Home to every surface; the old "returns to S2.1b" predates it).
  - **Closed** — the run is `COMPLETED`. A **read-only summary and no action**, plus a way back to the runs: §3's dead-end rule applies here as everywhere.
- **The confirm names the right person.** It reads "you cannot change a weight yourself — ask whoever does the reporting", because `requireReceivable()` refuses every receiver write once the shift is `COMPLETED` and corrections belong to the Reporter (`D14`). It previously promised "you can still fix a weight afterwards", which the server denied.
- **The client can only see half the edit window.** Whether a run is closed is inferable (a closed run leaves `GET /receive/runs`), but `receiver_edit_window_days` is exposed nowhere in the receive API. **Change a weight** can therefore appear on an open run whose day window has lapsed, and the server refuses the write with its own sentence. Closing that gap needs a field on the receive payload; until then the refusal is the guard.

### S2.3 Unscheduled donation

- User/device: receiver (tablet), one button from S2.2.  
- Purpose: record a donation arriving outside a scheduled pickup (PRD cap 12). If the driver flagged it mid-run (S1.5, "Flag ad-hoc pickup"), it arrives here pre-filled (donor + note) as a `SUGGESTED` row awaiting the receiver's weights and confirm; otherwise the receiver starts one from scratch.  
- Layout: same weight-by-category surface, plus a **Report toggle, default ON** ("Report this to North Texas Food Bank") and a donor field. Donor attribution is optional only when the toggle is OFF.  
- Key boundary surfaced: ON → counts toward the NTFB report. OFF → tracked for pantry metrics only, never reported. Copy must make this visible: "Reported donations go in the weekly NTFB report. Unreported ones still count in our own totals."  
- Primary action: Submit.

### S2.4 Truck-inbound alert (device-level)

- The tablet holds a device push subscription that fires regardless of who, if anyone, is logged in (PRD §2).  
- Behavior: full-width banner at top + sound, "Truck inbound. Sam's run returning." Dismiss is large. Does not require login to show. If someone is mid-weighing, it banners above without stealing the keypad.

---

# PHASE 3 — Report & Metrics

Caps 15–16. Canonical device: shared desktop. Pure aggregation over Phase 1+2 data.

### S3.1 Report generation

- User/device: anyone with `report` duty (desktop).  
- Purpose: produce the weekly NTFB (Meal Connect) report from system data, no Excel re-summing (Success Metric 3).  
- Layout: pick a week. Show AGFP categories with auto-summed weights, mapped to NTFB categories via an **in-app AGFP→NTFB mapping** (the mapping itself is maintained in **Admin → Categories**, `D17` then `D40`; this screen shows its effect and names what is unmapped). Every line is **inspectable down to store-category-day** (Success Metric 4: 100% traceable) — click a number to expand the underlying entries with the store, day, and receiver.  
- Only donations flagged for reporting flow in (the toggle). The screen states the two numbers separately where relevant.  
- **Every figure on this screen is whole pounds (`D28`)**, because it is what gets typed into Meal Connect and the receipt has to agree with the screen it was read off. **S3.2 does not round**, so the same week reads a pound or two apart on the two screens and both are right. That difference is stated on this screen in words: nobody can deduce it from the numbers, which is the case `§7` keeps copy for. All three totals round together — rounding only the reported one would send `received but not reported` negative.  
- **The drill-in shows the trash deduction where there is one (`D27`).** For the three categories the pantry deducts from, the subtotal becomes three lines — *weighed under this category*, *counted as trash instead*, *reported under this category* — because the entries listed are gross and the line above them is now net, and two numbers that disagree with no explanation read as a bug. The gross counts **reportable entries only**, so a donation somebody switched off cannot inflate the apparent deduction. The other categories keep their single subtotal unchanged; the explanation appears only where there is something to explain (`§7`).
- **Reporter edit (PRD cap 15):** in the drill-in, each entry has an edit affordance (✎, same overwrite-look/void-insert-underneath pattern as S2.2). The reportable toggle is a plain switch, not a void-insert — flipping it overwrites in place (PRD cap 15). Before the receiver's edit window closes, this mirrors what the receiver could already do at the tablet; after it closes, this is the *only* remaining way to correct that entry — the tablet no longer allows it. No separate approval step; the Reporter's edit is itself the correction.  
- **The mapping row is a pair (`phase-3-build-plan.md` D15).** A Meal Connect line item is `Category · Storage · Description · Pounds`, so each of our categories is matched to an NTFB category *and* the Storage it reports under (`Frozen`, `Dry`, `Refrigeration` on the receipt we have — free text, typed as their form words it). Storage is chosen in the same step as the category and shown with it on the row. A missing storage is named on the row but does **not** block the export; an unmapped category still does. One NTFB category under two storage values renders as two lines, because it is two line items on the receipt. **Since `D26` the whole mapping ships seeded**, so this screen and the Admin tab now *edit* it rather than being where it is entered from nothing — the unmapped-category refusal is kept because an admin can still clear a mapping.  
- **The screen leads with the report, not the totals (`D34`, 2026-08-02).** The reporter's job is the Meal Connect submission; the week's figures are context. So a single primary **Meal Connect Report** sits at the top, and the numbers sit under it, compact. Print moved *inside* that view, where the cards are.
- **Two figures, not three.** **Everything received** and **Reported to North Texas Food Bank**. "Received but not reported" was removed — it is the difference between the two and can be read off them. The per-figure explanatory sentences went with it; the labels carry the distinction in full instead, and neither may shorten to "Total", which would erase the intake-vs-reported split `D21` kept them for. `D28`'s rounding note moved into the report view, beside the figures a reporter actually types.
- **From / To, defaulting to this week (`D41`).** The week picker is gone. The default is the Monday–Sunday week containing the pantry's today — the same helper S3.2 uses, so the two screens cannot disagree about what "this week" means. A backwards range is refused rather than silently swapped. `?week=` still resolves, for a pre-`D41` bookmark.
- Primary action: **Meal Connect Report**, which fetches the range's receipts and shows them, one store at a time. Secondary: drill-in.
- **What Export produces (`D29`, superseding `D13`'s column list and `D16`'s CSV/print pairing; `D13`'s "no file import" finding stands).** Meal Connect is **three web screens a person types into**, and screenshots of them settled the shape: a receipt is `(Pickup Date, Donor)` with two checkboxes, then N line items of `Category · Storage · Description · Pounds`, then `Number of Items` and `Total Pounds` on its review list. So the export is a **printable mimic of that form** — one card per store per day, read top to bottom while typing. **There is no CSV**: one export path cannot disagree with itself, and the browser's own Save-as-PDF still covers "export as PDF" without a library (`D5`).
  - **No Description column.** The portal has the field; it is the reporter's own free text and not ours to fill.
  - **One line per AGFP category, never merged** — Deli and Frz Non Meat both report as `Prepared Meal / Frozen`, and the sample receipt carries two separate `Prepared Meals` rows for exactly that reason.
  - **The portal block is exactly what the portal asks for, and nothing else.** Everything of ours sits **below it**, under a rule and a heading saying none of it goes into Meal Connect — not as a fourth column, which would invite someone to type it in. That block holds: which of our categories each line came from (identified by category, storage *and* pounds, since the pair alone cannot tell two identical `Prepared Meal / Frozen` rows apart), the note that **Trash is computed** and nothing was weighed into it (`D27`), and the notes.
  - **Every note rides along**, labelled by channel — coordinator, driver, per-stop, receiver, walk-in. This is what carries "the store wasn't open at the scheduled time" to the food bank. Nothing is submitted automatically; Meal Connect has one free-text box and the reporter decides which remarks belong in it.
  - **Receipts are emitted for pickups that produced nothing.** `Scheduled Pickup Not Attempted` is ticked for a skipped stop or a run nobody worked; `No Pounds` for a pickup that happened and came to nothing. Both previously produced **no export row at all**, which made them invisible to NTFB — the same lost-sheet misreporting the system exists to end.
  - The agency and food bank codes are **no longer printed** (`D25`): the person entering the submission already knows them.
  - **One store at a time, with a filed check-off (`D35`).** The portal takes one submission at a time and has no import, so the view is a compact list of receipts — date, store, total, filed-or-not — and tapping one opens that store's full card. Ticking **Mark as submitted to Meal Connect** asks for confirmation before it writes; a ticked row shows who filed it and when. Un-ticking asks nothing: it takes a claim back rather than making one. The tick is **idempotent** — a second reporter ticking an already-filed store gets the state they wanted, and the first filer's name stands, because refusing would be telling them off for agreeing.
  - **A receipt with no store cannot be filed.** A walk-in carrying only a free-text label has no `Donor` to key on (`domain-modeling.md §2.1`), and Meal Connect's own donor picker could not be pointed at it either. The card says so rather than offering a control that would fail.  
- States: incomplete week (show what is missing), ready, exported.  
- Edge: an edited weight upstream (from either the receiver in-window or the Reporter here) reflects live; no version history shown beyond the underlying void trail (PRD out-of-scope as a UI feature).

### S3.2 Admin metrics

- User/device: admin (desktop).  
- Purpose: per-store and total-intake metrics, including **unreported** donation volume (PRD cap 16, intake ≠ reported).  
- Layout: per-store table (total rescued, reported, unreported, trend) + totals. Simple bar/line, no heavy dashboard. Surfaces patterns like a store consistently under-donating (PRD problem statement).  
- **Coverage tab (PRD cap 16):** counts of `UNCLAIMED` (window passed, never claimed) and `NO_SHOW` (claimed, never started) shifts, derived read-only (never stored, Domain I7) — filterable by driver, route, and period. Surfaces "this route keeps going unclaimed" or "this driver has three no-shows this month" the same way the donation table surfaces under-donating stores.  
- **Period: From / To, defaulting to this week (`D39`, answering `A179`).** The 1-week / 4-week / 12-week preset control is gone; any of the three is two dates away. `Earlier` / `Later` still step by the chosen range's **own length**, so the previous-period comparison stays like-for-like whatever window is picked. The default is the same Monday–Sunday week S3.1 uses (`D41`), which is the first time the two screens have named the same period — `A179` had picked 28 days because no doc settled it.
- Primary action: none destructive; this is read + export.  
- Key: keep Intake and NTFB-reported as two distinct, clearly labeled numbers everywhere.

---

## Responsive matrix

| Surface | Phone | Tablet | Desktop |
| :---- | :---- | :---- | :---- |
| Home hub | canonical | canonical | canonical |
| Shift board | canonical | usable | usable (staff) |
| Pickup execution | canonical | degraded | n/a |
| My shifts / availability | canonical | usable | usable |
| Weight entry | n/a | **canonical** | usable |
| Unscheduled donation | n/a | canonical | usable |
| Scheduling / reschedule | cramped | usable¹ | **canonical** |
| Admin (metrics/accounts/donors/trucks/categories) | n/a | usable | **canonical** |
| Report (S3.1) | n/a | usable | **canonical** |
| Inbox + push state | canonical | canonical | canonical |

"Degraded" = works but not optimized; "n/a" = not a target for that device.

**"n/a" is about intent, never about reachability.** The columns are the device a surface is *designed for*, not a gate on who may open it. Weight entry reads `n/a` on a phone because a phone is a poor place to weigh a pallet, not because a receiver on a phone should be stranded. Reading this table as an access rule is what produced the `D22` blocker, where the entire 768–1023 band had no navigation. Every screen a user's tier and duty permit must be reachable at every width.

**The bands (`D36`, 2026-08-02): phone < 768, tablet 768–1199, desktop ≥ 1200.** Desktop was ≥ 1024, which put **every current iPad in landscape** (1024–1194) on the desktop side-nav layout — a squeezed sidebar on a receiving dock, which is what the pantry saw. At 1200 those devices land in the tablet band and get the bottom bar and the full width. The number is repeated in a handful of media queries because CSS cannot read a custom property there; they must move with `tokens/index.ts`.

¹ With one hole: **route-stop reordering has no touch path** (S1.6 — drag does not fire on touch, and the arrow-key equivalent needs a keyboard). Everything else on the scheduling screens is usable on a tablet. Recorded rather than fixed, per the A151 ruling.

---

## Open assumptions (confirm or override)

1. **No tare math in v1.** Volunteers currently subtract tare by hand (visible on the sheet). Left out per "nothing not needed"; can add a per-entry tare helper later.  
2. ~~**No duty-picker modal.** Nav is derived from role/duty because each shared device hosts one duty workflow. If a future device hosts two, a picker returns.~~ **RESOLVED, 2026-08-02 (`D22`).** A device already hosts two: a volunteer holding `DRIVE` and `RECEIVE` is a real account, and hands-on QA found the two capabilities indistinguishable. **A picker did not return, and must not.** The answer was to group the nav by capability and add the **Home** hub, which shows every capability at once rather than asking anyone to choose between them. The derived-nav rule stands; only its justification was wrong.  
3. ~~**AGFP→NTFB category mapping** is maintained in the Report screen (or Admin). Confirm where you want it to live.~~ **RESOLVED, 2026-08-02.** Phase 3 built it on S3.1 under the `report` duty (`D11`), and the first QA pass moved it to **S1.8 → Category matching** under `tier: 'ADMIN'` (`D17`): the pantry reads the mapping as setup, and every other setup decision is already in Admin. The report's own routes stay `report`-duty — an Admin without the duty is still not a Reporter.

 