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
- **Status chip** — pill, text + color: Open (orange), Claimed (muted), In progress (`--brand-orange` filled), Done (muted), At-risk (warning), Cancelled (muted strike). One chip per row, reflecting `Shift.status`. **Since `D48` an in-progress run whose driver has confirmed heading back reads "Returning"**, in the in-progress colour — the *only* chip label not backed by a status, because heading back is a milestone inside `IN_PROGRESS` (`I27`) and giving it a colour of its own would claim a state change the domain refuses to make. **Since `D53` a row offering a Claim button shows no chip at all**: the button and the "OPEN" owner line already say it twice.  
- **Mine** is an *ownership overlay*, not a status — it renders in success color and replaces the Claimed chip when the viewer is the owner. Every other status keeps its own chip regardless of who owns the shift.  
- **Top bar** — `--structural-dark`, product name in words on the left, current user + logout right, notification bell with unread count, push-state chip. **Not the AGFP mark**: it is dark type on a white ground and cannot sit on this bar without a plate. Since `D32` the mark lives at the top of the side nav (§4), where it has the ground it was drawn for.  
- **Bottom nav (phone and tablet)** — ≤4 items, icon + label always (no icon-only). 56px tall. The cap is load-bearing, not cosmetic: it is what forces the office entries onto the Home hub rather than into a bar nobody can read (`D22`, §4). Since `D30` the bar is not a truncation of the desktop list — the desktop list is one entry per capability too, and the bar simply carries the duty entries plus Home and Inbox.  
- **The chrome is sticky (`D42`)** — top bar, bottom nav and side nav all stay put while content scrolls. Before this, `.r3-app` was `min-height: 100%` with the document scrolling, so on any screen taller than the viewport the bar sat at the bottom of the *content* and reaching navigation meant scrolling to the true page bottom. That is why several screens had grown their own bottom "Back to…" button; `D43` removes those. Sticky rather than a fixed-height shell with an inner scroller, deliberately: a fixed shell would break every screen-local `position: sticky` and scroll region at once. The chrome sits **below** the existing overlay ladder (dropdown, PWA prompt, modal, toast, truck banner, offline) so a picker opened near a bar is never clipped.  
- **Back link** — one way out, at the **top** of a screen, before the heading: a chevron plus a **noun naming the destination**, never a sentence, because the chevron already says "back". `D43` makes it the single pattern; it replaced eleven screens that had each invented their own words. A screen that is itself a nav entry has no parent and gets none. A form's *cancel* is not a back link and stays beside its submit.  
- **Modal / confirm** — centered, one question, two buttons. Destructive confirm names the consequence ("Cancel this run? It goes back to the board for others to pick up."). The calm default reads "Cancel" unless the destructive action is itself a cancel, in which case it takes a distinct word ("Keep it") — two buttons reading "Cancel" is not a choice.  
- **Toast** — bottom, 4s, success/error. Never the only signal for a critical action.  
- **Inbox row** — read/unread dot, event text, time, tap to act.  
- **Empty / loading / error blocks** — every list defines all three. Empty states say what to do next, not just "nothing here". A **dead-end** state — no access, not found, nothing to act on — must also carry the way out as a control, not only as advice. The original reason was that the tablet had no nav; `D22` gave it one, but the rule outlived its justification and is now stated in its own right: **a full-screen route has no nav either** (login; S1.5's pickup takeover including its read-only completed summary; and S2.2 since `D60`), so any screen that can be reached and not acted on needs a door. **"Full-screen" here means no nav, not no chrome** — the top bar still renders, so the door a full-screen route needs is its own `BackLink`, and every one of its pre-content states (loading, error, nothing to show) must carry that link or become a trap. "Read only" is a statement about the data, not a reason to trap someone. **Since `D43` that door may be the screen's own back link** rather than a second control inside the empty state — the requirement is that a way out exists as a control, not that it lives inside the block. Two exits on one screen is the duplication `D43` removes, and it also stops the door from appearing halfway down the page only in the failure state.
  - **The shell's own two dead ends — "That page isn't here" and "You don't have access to this page" — carry the same door, in the same slot, to the same place.** They did not: one nested its way out inside the body text while the other used the block's action slot, so one of them read as a sentence rather than a control and QA went to the URL bar instead. That is what "as a control" means — a claim about where it sits, not only that the words are present. Both now offer *Go home*, which is `homePathFor` and therefore one destination for everyone since `D22` gave every viewport a hub.
- **A form that occupies the whole screen keeps only its primary action.** The way out is the back link above it, not a second button beside Submit. This was already the practice on the admin forms; `D43` states it, because "Cancel" beside a submit that goes exactly where the back link goes is one destination wearing two labels. A form *inside* a screen that stays on screen around it is the other case, and there the cancel stays.

---

## 4. App shell, navigation, role/duty

Navigation is **derived from what the logged-in user can do**, not a manual duty switcher. There is still **no duty-picker modal** and adding one is a spec change, not a feature.

> **Amended by `D22`, 2026-08-02.** The original rule read "the PRD's 'choose which duty' only arises if one shared device hosts multiple duty workflows; with tablet=receive and desktop=report it does not." **The conclusion survived; the premise did not.** A volunteer holding `DRIVE` **and** `RECEIVE` (a real account) carries both workflows on one device, and the tablet is not only a receive station — a desktop window narrowed to iPad width lands in the same band. The old rule gave that band *no navigation at all*, so every link vanished and `Receive` had no nav entry on **any** surface: a receiver could not find how to start weighing. Navigation is now present on every surface and **grouped by capability**, which separates the duties without ever asking the user to choose between them.

**Home (`/`)** is the landing screen for everyone, replacing the board as the front door. It shows one large card per thing this user can do, derived from tier and duty exactly as the nav is. It is not a duty picker: nothing is being selected, and every capability is visible at once.

> **Amended again by `D30`, 2026-08-02.** `D22`'s grouping left two or three entries inside some
> groups, and the four-item bar could only show the first of each — which read as truncation rather
> than design. The rule is now **one nav entry per capability, on every surface**. The groups go
> with it: a heading over a single item is noise.

> **Amended a third time by `D49` and `D51`, 2026-08-03.** `D30`'s **one entry per capability**
> survives everywhere except **DRIVE**, which now has two: the driver's own runs and the shared
> board. The reason is the shape `D30` produced, not its principle — folding My shifts into the
> board put *its* two tabs inside the board's two tabs, and QA reported the nested rows as the
> confusing thing. Two sibling pages with one tab level between them is the fix.
> **The order is no longer the order a week runs**; it is descending privilege.

**Home (`/`)** is the landing screen for everyone, replacing the board as the front door. It shows one large card per thing this user can do, derived from tier and duty exactly as the nav is. It is not a duty picker: nothing is being selected, and every capability is visible at once. **Home is capped at seven cards** (`D31`, raised from six by `D50`) — Admin, Schedule, Report, Receive a load, Today's pickup, Shift board, Inbox — which is every destination a single account can hold, `D49`'s second driver page included.

- **Phone and tablet:** bottom nav, **capped at four items** (§3), icon and label. Home and Inbox always take the outer two; the middle two go to the user's duty entries in the order below — a driver gets `Home · Pickup · Board · Inbox`, a receiver-and-driver gets `Home · Receive · Pickup · Inbox`. Office work (Schedule, Report, Admin) is reached **through Home** on these surfaces, and so is Shift board for anyone whose duties already fill the middle. **The cap does not move**: an admin who drives and receives has eight destinations and a 375px phone has room for four, which is what earns Home its place. Labels are shorter here than on the desktop for one reason: the bar is 56px tall with the icon above the word, and "Receive a load" does not fit on a phone at four across. Pickup remains a full-screen takeover while a route is active.
- **Desktop (back office):** left nav, one flat run, no headings:

  | Entry | Shown when |
  | :---- | :---- |
  | Home | always |
  | Admin | Admin tier |
  | Schedule | Staff tier |
  | Report | `report` duty |
  | Receive a load | `RECEIVE` duty |
  | Today's pickup | `DRIVE` duty |
  | Shift board | `DRIVE` **or** Staff tier |
  | Inbox | always |

  **The order is descending privilege** — the narrowest capability first, the two screens everyone holds bracketing the run. This supersedes `D30`'s week-order reading; `D22`'s staff-first reading was superseded before that. It is the order the Home cards use, so the two surfaces cannot teach a volunteer different vocabulary.

  **The list has one shape, and every shorter list is that shape with rows removed** — never reshuffled. A volunteer who gains a duty sees a row appear in place rather than the bar rearranging under them. The board stays available to the **Staff tier** as well as to drivers: a coordinator watches claims land there, though only a driver gets *Today's pickup*, which would be empty for anyone who does not drive.

  **One screen lost its own entry and gained a home inside one.** *Log a donation* is reached from the `Unscheduled donation` button on S2.1b, which is on screen in every state including the empty one. It is not stranded, and it does not earn a top-level slot. (*My shifts* lost its entry to `D30` and got it back as *Today's pickup* under `D49`.)

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
- Layout: a greeting, then one large tappable card per capability this user holds, in the order duties-then-tier: **Today's pickup** and **My shifts** (`DRIVE`) · **Receive a load** (`RECEIVE`) · **Reports** (`report`) · **Schedule** (Staff) · **Admin** (Admin) · **Inbox** (always, last).
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
- Copy: header **"Shift board"** since `D49`. Empty "No runs scheduled yet."
- **This screen is one of the driver's two pages (`D49`), and it is the shared one.** It shows every run and who has it; the driver's *own* runs live on S1.4 at `/my-shifts`, which is the driver's default landing. Before `D49` both were tabs on this screen and S1.4 in turn had two tabs of its own — two nested tab rows, which QA found was the confusion, not the cure. The heading moved off "Pickup runs" for the same reason: two pages under one title is what `D49` set out to remove, and the heading now takes the nav entry's own words.
- **Two tabs since `D49`:** `Board` (default) and `When I'm away`, in `?tab=board|away` so a tab is a link someone can send and survives a reload — the same pattern S1.8 uses, including "an unknown tab lands on the default, not a 404". The tab row appears **only for a driver**: a coordinator who does not drive has no second tab, and a single tab is noise. `?tab=mine`, `D30`'s link to the retired My-shifts tab, resolves to the board rather than 404ing.
- **A refused claim is explained on the row that caused it (`D52`), not only in a toast.** `eligible()` refuses an overlapping claim with a 409 whose message the server already composes ("You already have a run at that time. Cancel it first."); QA read the resulting silence as a broken Claim button. The reason sits under its row until the viewer changes filter or week, claims successfully, or retries. **Nothing was ever half-written** — the row stays `OPEN` with a null owner — so this is a communication fix, not a correctness one.
- **A row with a Claim button shows no status chip (`D53`).** The button says "Claim" and the owner line already reads "OPEN"; a third statement of the same fact is noise. Every other row keeps its chip.
- **A run whose driver has confirmed heading back reads "Returning" (`D48`)**, not "In progress". This is presentation only: heading back is `pickup_completed_at`, a milestone *inside* `IN_PROGRESS` (`I27`), and no status changed. It reuses the in-progress colour deliberately — a second colour would claim a state change the domain does not make.
- **The board browses; Schedule manages (`D63`).** There is no per-row Edit here. One existed for staff on `OPEN`/`CLAIMED` rows and deep-linked to S1.6 anyway, so it was a management control on a browsing surface — and the one place the board addressed a viewer as staff rather than as someone looking for a run. It is `D59`'s rule one screen over. Staff still open any row into S1.3 (above), and S1.6 is one nav entry away with a calendar (`D73`).

### S1.3 Shift detail

- User/device: owner (phone), staff (desktop).  
- Layout: route stops in order, truck, time, any coordinator→driver note (`Shift.staff_note`, PRD cap 11) — staff can add/edit it here (desktop view); driver sees it read-only. One primary action by context.  
- **The screen addresses one person (`D59`).** Where the viewer *is* the run's owner, it drops the cards that describe them to themselves: no Driver row naming them, and no add/edit control on a note addressed to themselves — even when they hold the STAFF tier. `D22` let one account hold several duties, and every gate here was correct per capability and wrong per person: a staff owner was told their own name and offered a note to themselves. A staff note **written by someone else still shows, read-only**, because that is a message *to* them. The **truck row stays in both views** — it is operational, and its blank is `I8` (no truck until the driver picks one). A non-owner's view is unchanged, cards and all; that is a coordinator looking at someone else's run. Server authorization is untouched: `PATCH /shifts/:id`'s staff-note path has no owner term and does not gain one. This is what the screen offers, not what the system permits.
  - There is **no author column on `Shift.staff_note`** (`data-model.md §5.1`), so "written by someone else" is inferred from the viewer being the subject rather than read from the row. A staff owner therefore cannot edit the note *from this screen* even if they wrote it; Schedule is where a coordinator manages a run they are also driving. If an author column is ever added, this gate can become exact.
- Conflict flag: if staff assigned this shift over a declared-availability or overlapping-shift conflict (PRD cap 6), the owner sees a persistent banner: "This run conflicts with your declared availability. Contact staff if that's a problem." Informational only; does not block pickup execution.  
- Primary action: owner sees **Cancel this run** (red). Before-start only; in-progress/past hide it. **When it is hidden, the owner is told why** and given the way out ("This run has started…", pointing at a coordinator) — QA found the button's silent disappearance read as the feature being missing. The gate itself is unchanged: `CLAIMED` is the only state with a release edge (§3.1).  
- **Driver-facing verb.** Drivers read "cancel", never the domain's "release" — the plainer word is what they reach for. The transition is still `CLAIMED → OPEN` (§3.1) and never `CANCELLED`, which stays staff-only and terminal (I10), so *every* driver-facing sentence must also state where the run goes ("it goes back to the board"). The word alone would promise the pickup is off, which is the opposite of what happens. Code, routes and payloads keep `release`, which names the actual edge; only copy changes.  
- Cancel flow: confirm naming consequence → returns to board as Open → notifies coordinator + eligible drivers (PRD cap 8). Recurring: "Cancel just this one, or this and future?" with a date-range option for bulk. Either way the affected instance(s) go back to Open for someone else to claim — the series itself is untouched and keeps generating beyond the range. (This is distinct from staff's separate, staff-only bulk-terminate for permanently ending part of a series — not available to drivers.)  
- **Reassign stop (staff-only, PRD cap 10):** on an `IN_PROGRESS` shift's stop list (staff/desktop view only), each unresolved stop (PENDING or COLLECTED-not-yet-weighed) shows a **Reassign** action. Picking it opens a driver picker (any driver with an open or in-progress shift today); confirming marks that stop `REASSIGNED` on this shift (excluded from this shift's completion gate, shown struck-through here) and adds it as a new pending stop at the end of the destination driver's active shift. Already-weighed stops have no Reassign action — there's nothing left to move.

### S1.4 My shifts + availability

- User/device: driver (phone).  
- **This is the driver's default landing, and its own nav entry — "Today's pickup" (`D49`, renamed by `D64`).** The first label was "Pick up food", which named the job but not the thing that distinguishes this page from its sibling: *today*. The screen's own heading follows the entry that led here, so both moved together. `D30` had made it a tab on S1.2 and `D22` a Home card; both are superseded. The driver's own runs and the shared board are now two sibling pages with **one tab level between them**, because the previous shape put S1.4's tabs *inside* S1.2's and that nesting is what QA reported as confusing. `D30`'s one-entry-per-capability rule is softened for DRIVE alone; every other capability still gets exactly one.  
- Layout: **no tabs.** Two bands, in the order the day is lived:  
  - **Today** — the driver's run(s) today, as large cards with a block "Open this run". This is the screen's centre: they are standing there about to do it.  
  - **This week** — the rest of the week as compact rows, **both completed and upcoming**, so the week reads as one thing rather than two lists.  
  "When I'm away" moved to S1.2's second tab, where it sits beside the board a driver consults for the same reason.  
- **Runs beyond this week are counted, never dropped.** This page has no week control on purpose, so a run claimed for next Tuesday would otherwise vanish from the driver's only list of their own runs. The count and where to find it are stated instead of a third band.  
- **"Today" is a pantry-calendar question, not a device one.** Banding uses `todayInZone(timezone)` and `A178`'s Monday–Sunday week — the same cut S1.2 and S3.1 use. This screen previously read the device clock, which put a run in the wrong band for anyone whose phone was in another zone.  
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
  - **"Add an unscheduled stop not on my route" is gone from the summary too**, which is the cost of the read-only choice. The screen therefore says so and tells the driver to phone the pantry. The one control that remains is the way *off* the screen: S1.5 is a full-screen takeover with no nav, so a read-only screen still needs a door.
  - **The modal shows two lists, not one (`D65`).** "Stops on your route" is the scheduled stops with their dispositions; "Extra pickups you added" is the ad-hoc pickups made during this run, headed separately and carrying **no disposition** because they have none — an `UnscheduledDonation` is not a `ShiftStop` (`I14`, `I29`) and the two are never merged. The second list is absent when the driver added nothing. Before this, a driver who added two stores confirmed a summary showing neither.
    - **The read-only summary after confirming still shows only the stops.** The extras live in client state for the length of the visit, and the summary is exactly where a driver is most likely to reload or come back later — a list that is complete on one render and silently empty on the next is worse than one that is consistently the run's own record. Making it real needs the shift's unscheduled donations on the run payload, which is not built.
  - **In Phase 2** confirming also fires the truck-inbound push (device-scoped, S2.4) to the receiver tablet — that alert was explicitly out of Phase 1 (`product-requirement.md §5` scopes it as caps 1–11, 13 *minus* truck-inbound) and the Phase-1 server deliberately enqueued nothing here. It stays optional: a driver who never taps it causes no problem, and the receiver still resolves stops normally.
- **Add an unscheduled stop (Phase 2):** a secondary action ("Add an unscheduled stop not on my route") lets the driver record a donor they picked up from mid-run that isn't part of the planned route — **just a donor picker or a typed store name, and an optional note. No weight entry and no category.** This creates a `SUGGESTED` UnscheduledDonation (PRD cap 12, Domain I17) that prefills S2.3 for the receiver to confirm with weights later; it never creates or touches a `ShiftStop`, so the planned route stays unaffected.
  - *This sentence was briefly untrue and is now true again.* `D8` had to add a category picker here, because the locked `domain-modeling.md §2.3` required a Category on every `UnscheduledDonation` and a `SUGGESTED` row could not be stored without one. `D24` (2026-08-02) made the category optional until `CONFIRMED`, so the driver's picker is gone — they cannot know the category and it is not their job. **The lower-authority doc was right all along**; the conflict is resolved in its favour rather than against it.
  - The anonymous "no name for it" option is also gone: the choices are a store from the list, or **Other** with a **required** typed name.  
  - **The driver-facing word is "add", not "flag" (`D64`'s round).** "Flag" reads as reporting a problem; the driver is recording a pickup they made. Every sentence a driver reads uses "add" — the button, the step title, the submit, the success toast and the list of what they added — because a screen titled "Add an unscheduled stop" with a "Flag this pickup" button reads as two different actions. The COPY **keys**, the client function `flagAdHocPickup` and the route behind it keep their `flag` names: those name the code path, not the user's action.
- Edge: changing order never loses check state. Store permanent notes are read-only here.

### S1.6 Staff — shift & route scheduling

- User/device: staff (desktop).  
- Publish shift: date/time, route. No truck field here — truck is picked by the driver at start (S1.5), not set by staff at publish. Recurring builder: pick a weekly pattern with plain language ("Every Tuesday, starting Aug 4, no end" or an end date). **The "starting" date is displayed, not entered** — it is the first occurrence the pattern will actually mint, computed from today and the chosen weekday, and the control is read-only. A pattern has no stored start date: `domain-modeling.md §5.3` (locked) names `endDate` as the only stop condition and runs the loop over `[now, horizon]`, and `data-model.md §5.2` has no `start_date` column. A series therefore begins when it is created, and the sentence tells the user which date that works out to rather than asking them to choose one. Shifts exist with no driver (PRD cap 4).  
- Route builder: a route is an ordered list of stores. **Drag-and-drop ordering** with large handles; add store from the donor list. Editing a single recurring instance must not break the pattern (PRD cap 4) — surface this as "Edit just this date" vs "Edit the weekly pattern". *(Built as a scope control **inside** the run editor rather than a prompt in front of it: QA found being asked the question before seeing the run made staff guess. Both phrases survive verbatim as the control's legend and its pattern option, and the save path still branches on the explicit scope, which is what keeps `I23`/`I24` true.)*  
- **Reordering is drag or arrow keys, and there is no touch path.** The handle is a focusable button that reorders on ArrowUp / ArrowDown, so a keyboard user is covered; HTML5 drag events do not fire on touch at all, so a touch-only tablet cannot reorder a route. This is a ruling, not an oversight — three commands per row read as verbose beside a handle that already covers the common case, so the per-row Move up / Move down buttons were removed (`phase-1-state.md` A151, superseded). Everything else on this screen still works on a tablet; **reordering specifically is desktop-or-keyboard only**, which is the caveat behind this screen's "usable" mark in the responsive matrix.  
- Assign/default: staff may set an owner as fallback (PRD cap 6). Same owner field as self-select. If the chosen driver conflicts with their declared availability or another owned shift, staff sees an inline warning and must confirm ("Karen marked herself away then — assign anyway?") before it goes through; the assignment is not blocked. The resulting shift shows a conflict flag to the driver (their board/shift-detail view), prompting them to contact staff.  
- **The driver picker pre-selects whoever is already driving, and a swap is confirmed (`D74`).** It used to open with nobody selected and list the current driver unhighlighted among everyone else, so re-opening it on a claimed run gave no sign of who had it. Choosing a *different* driver now asks first, naming both ("Change the driver from Karen to Luis?") and saying what happens to the first. Taking a driver off already confirmed; replacing one is the same magnitude of change and confirmed nothing.
  - **The conflict warning is a separate question and both may be asked.** "This driver is double-booked" is `I20`'s staff-assign exemption — deliberate override authority — and "did you mean to replace Karen" is not the same question. They stack rather than merging into one prompt.
- **Runs list, and a calendar beside it (`D71`, `D73`).** The list was every run from today forward with no upper bound, under the heading "Runs coming up" — every run that will ever exist. It is now **the pantry's Monday–Sunday calendar week** (`A178`'s cut, the same one S1.2 and S3.1 use), from the week's start rather than from today, so the heading is true on a Thursday. Anything outside this week is the calendar's job.
  - The calendar carries its own range — **Day · Week · Month · Custom**, defaulting to Week — and a cell shows **the route name and the driver, or "Open", and nothing else**. Times and stop counts belong in the editor.
  - **It adds no write path.** A cell opens the *same* `RunEditor` the list opens, so every guard is inherited unchanged: Set a driver, Take the driver off, Move and Cancel are all `OPEN || CLAIMED`, and an `IN_PROGRESS` or `COMPLETED` run opens read-only from the calendar exactly as it does from the list.
  - Runs are placed by `occurrence_date` in the pantry zone, never by `startsAt` — a late-evening run must not land on the next day for a viewer in another zone.
  - **Below the tablet breakpoint the grid becomes a day-grouped list** in every range, not only Month: seven columns at 375px is unreadable whether it holds one week or five. The screen says so, because a silent collapse reads as a truncation.
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
  5. **Weighed and closed** (`D75`) — collapsed, closed by default, and read-only. Runs **closed today**. Receive-done used to make a run disappear the moment it was confirmed, which is the one moment a receiver most wants another look at what they just weighed. Bounded to the pantry's today by the server, because that is the span of one receiver's shift; anything older is the report's job. A tap opens S2.2b, which since `D46` names who signed off and when — a look, not a step. `COMPLETED` is terminal (`I10`), so there is no action to withhold. The heading names what the group is and, like every other, does not say "today".
  4. **Too late to weigh** (`D66`) — collapsed, closed by default. Runs whose receiver edit window has lapsed **and which still have an unresolved stop**. They carry "The weighing window has closed. You can still finish this run." and lead to S2.2b, not to the sheet.
     - **Readiness is asked before the window.** A run with every stop resolved has nothing left to weigh, so it cannot be too late to weigh it — the closed window costs it nothing, because its only remaining action is receive-done and that is deliberately not window-gated. It bands as **Ready to finish** however old it is. QA found a fortnight-old run with both stops reading "weighed" filed under "Too late to weigh", which told the receiver they had missed something when nothing had been missed and one tap would close it.
     - What this leaves in the band is exact and worth knowing: **only the runs the window actually took something from** — the ones with a stop nobody can now resolve *or* close (`phases-1-3.md §3.4`). The band is a list of the stuck, not a list of the old.
- **A lapsed run is demoted, never hidden (`D66`).** `A162` left this list unbounded on purpose, and its reason still holds: **receive-done is not window-gated**, and this screen is its only route, so a run filtered out of the list is an `IN_PROGRESS` run nobody can ever close. What changed is that a run nobody can weigh any more stops being *offered* as something to weigh. **Band membership is decided by the window, not the calendar** — the lapsed check runs before the `today` comparison, so a Tuesday run weighed at 12:30am Wednesday is still band 1. A `today` bound was rejected for exactly that case.
  - **One gap this exposes, and it predates `D66`.** A lapsed run with an *unresolved* stop cannot be closed at all: `receiveDone` requires every stop resolved (`I12`), and both weighing and skipping are window-gated. Its card still targets S2.2b so the receiver can at least see which stop is outstanding. Nothing here widened or narrowed that; it needs a human decision about who may resolve it (`phases-1-3.md §3.4`).
- **Band 1 catches overdue runs, not only today's.** The cut is `occurrence_date <= pantry today`, not `= today`: a run left unweighed from last Tuesday is not "later this week", and burying it is how it stays unclosed. Only future runs collapse.
- **No band heading says "Today" or "Yesterday".** The grouping is against the pantry's today, but the wording is not, so a heading can never contradict the `occurrence_date` shown on a row.
- Each row shows the run's stops with a status dot (pending / weighed / skipped) and an "N of M done" count — this is the stop list the old store-only flow had no room for.  
- **`Unscheduled donation` is a panel holding both donation lists, on screen in every state including the empty one (`D67`, widened by `D76`).** Since `D30` removed its nav entry this is the only way to reach S2.3.
  - **Why the rows are here and not on S2.3.** `D67` made this a summary *card* — counts only — on the reading that rows belong on the screen where they are worked. That was backwards for half of it. When a driver flags a store mid-run (`I17`) the food is already in the building and the receiver has to weigh it: it is a pickup in every sense except that no route planned it, and **S2.1b is the receiver's list of pickups**. A suggestion that announced itself only as "1 waiting for weights", behind a tap, was the single kind of arrival this screen did not list.
  - **Two sections, never one.** **Waiting for weights** — what a driver flagged, each row naming the driver and quoting their note, tapping through to S2.3 to weigh it. Then **Already weighed**. Suggested is somebody else's unfinished business and recorded is finished business; run together they read as one undifferentiated pile and neither is legible, which is what QA found. Suggested is first, and is **absent rather than empty** when nothing is waiting — an empty heading claims this is a place work usually is, and on most days it is not. Already weighed states its own emptiness, because a receiver checking whether they logged something needs an answer either way.
  - **`Add walk-in donation` is the panel's only control**, and `secondary`: §1's one high-emphasis action per screen belongs to picking a run, which is the question the screen asks. It moved off S2.3 with the lists (`D76`) — starting a donation from nothing is a different act from weighing one that arrived, and a screen offering both asked the receiver to choose a mode before it knew what they had in their hands.
  - **A recorded row keeps the report switch and its Reported / Ours only chip**, inline. Flipping it is a plain field edit, last write wins (PRD cap 15). The **weight is deliberately not editable from this list** — correcting a number is the ✎ on S2.2's sheet, or the Reporter's job on S3.1 once the window shuts. Two places to change one number is how the two get out of step. Past the window the switch is absent rather than disabled (§3), because the Reporter owns the row by then.
  - **Both lists are bounded by the receiver's edit window (`D77`), and the symmetry is load-bearing.** Suggested is bounded because `confirmDonation` refuses a lapsed row, so listing one offers work the next tap would refuse. Recorded is bounded to **match**: it was the pantry's calendar day at first, and that was wrong — a driver's flag carries its *run's* `received_date`, so weighing a suggestion off any other day made it vanish from the panel at the exact moment the receiver wanted to see it. **Weighing something must never make it disappear.** Nothing is stranded either way: an unconfirmed suggestion is hard-deleted at receive-done or by the daily sweep (`I17`), and a lapsed confirmed row belongs to the Reporter.
  - A consequence worth stating: **no string on this screen says "today" any more.** `D67`'s three exemptions from the never-say-today rule are gone with the calendar bound, and the copy test now sweeps every string with no exemption at all.
- **A run whose driver has confirmed heading back says so (`D48`, extended here) — while there is still something to arrive.** The card leads with "Driver is returning to the pantry" in place of the progress line, so a receiver knows food is on its way rather than reading stop counts that have not moved. Presentation only: heading back is `pickup_completed_at`, a milestone *inside* `IN_PROGRESS` (`I27`).
  - **It stops once every stop is resolved.** `pickup_completed_at` is set once and never cleared, so on its own it says "returning" forever — QA found a fortnight-old run, every stop weighed, still announcing its driver was on the way back. If every stop is resolved the receiver has already weighed what the driver brought, so the sentence is not merely stale but false. **Tied to the stops, not to a clock**, because the stops are the thing that makes it untrue.
  - The **board's and S1.4's chip is not bounded this way** and still reads "Returning" on any `IN_PROGRESS` run with the milestone set. `ShiftSummary` carries no stop-weighing state, and widening it to fix a case that only arises on an already-stuck run would be a payload change chasing a symptom. Recorded rather than hidden; the receiver's screen is where this sentence is read and acted on.
- **A finished run's card names an action, not a fact.** It reads **"Finish this run"**. It previously read "All stops done, Receive done", which states something completed — QA read the run as already closed and was then surprised the button still worked. The band heading above it stays "Ready to finish".
- Tapping a run opens S2.2 scoped to that run; tapping a stop within S2.2 is how the receiver navigates between stores on a multi-stop run.  
- Multiple receivers can work the same run's different stops independently — the list re-sorts/refreshes as stops resolve.

### S2.2 Weight entry (THE paper sheet, centerpiece)

- User/device: logged-in receiver, tablet landscape.  
- Mental model = the Retail Rescue Log, now scoped to one run's current stop. One screen = one shift + one stop + this receiver.

**Two panes since `D44`; three regions and a fixed entry column since `D61`.** The tiles used to sit in a six-across grid *above* the keypad, which made the sheet taller than the tablet it is for; the pantry's note was that the paper log showed every category at once and this did not. `D44` put categories in a single vertical column and stopped the *page* scrolling, but left the working column a stack of four blocks with the keypad **last** — so on the canonical tablet the number pad was below the fold and the receiver scrolled to reach it. That is the same defect one level down, and `D61`/`D62` finish the job.

```
┌ ‹ Runs ────────────────────────────────────────────────────┐  BackLink, top of screen (D43)
│ Weighing  Hilltop Bakery                                    │
├─────────────────────────────────────────────────────────────┤
│ Sam's✓ · Kroger● · Aldi●        2 of 3      [ Submit run ]  │  D62 progress row, one line always
├ categories ─────────────┬ entry column (FIXED) ────────────┤
│ Frozen Meat   293 lb    │ Selected: Produce   [ 5 1 6 ] lb  │
│   61  232 ✎             │                                   │
│ Bakery        323 lb    │ [ Add weight ]      ┌───┬───┬───┐ │
│   323                   │                     │ 7 │ 8 │ 9 │ │  ≥64px keys — the floor does not move
│ Produce  (7) 1222 lb    │ This stop  2192 lb  ├───┼───┼───┤ │
│   516  706  ⇕           │                     │ 4 │ 5 │ 6 │ │
│ Deli           31 lb    │ [Done]   [Skip]     ├───┼───┼───┤ │
│ Dairy           0       │                     │ 1 │ 2 │ 3 │ │
│ Dry           528 lb    │ Driver: back door   ├───┴───┼───┤ │
│ …11 rows      ↕scrolls  │ locked after 4  ↕2  │   0   │ . │ │
└─────────────────────────┴───────────────────────────────────┘
```

- **The screen is `fullScreen` (`D60`).** `D42` made the bottom nav sticky, which is right everywhere except the one screen whose entire job is tapping numbers near the bottom edge — an older volunteer weighing on a docked tablet fat-fingers the bar and loses the sheet. The `BackLink` is the way out, and it is at the top where a stray thumb does not reach. **The top bar stays**: `fullScreen` in this app means no nav, not no chrome, and `AppShell` renders the bar in that branch too. So the height reclaimed is the bottom nav's alone, and every pre-sheet state (loading, error, no stop) carries the BackLink as well or it is a dead end (§3).
- **The entry column never scrolls; the category column is the only region that does.** Everything the receiver touches — the typed line, Add weight, the stop total, Done and Skip, and the keypad — is on screen at all times. The keypad sits **right**, the actions **left**.

- **A category's entered lines cap at two rows and scroll inside the row (`D45`).** Before this, `.r3-tile__entries` had no bound, and because the tiles were a stretch grid one busy category grew every sibling in its row and lengthened the whole page. A count appears on the row when there is more than fits, since a scroll region with no visible affordance is a trap.
- **The category column is the one region allowed to scroll**, and only when it overflows; the page and the chrome do not move. On the canonical 1024×768 tablet an empty sheet fits, and it starts scrolling once a couple of categories carry entries. That is the accepted fallback, not a miss: the alternative was shrinking the keypad below §3's 64px floor, which a previous round tried and was correctly overruled on.
- **The stop strip is the top progress row and its height is constant (`D62`).** It was a wrapping flex row, so a four-stop run pushed the keypad down a line and a six-stop run pushed it down two — stop count silently changed the layout of the screen below it. It is now one non-wrapping row that scrolls horizontally, with the "N of M done" count pinned beside it. **A skipped stop counts as done**, here and everywhere: the resolved set is `WEIGHED | SKIPPED | REASSIGNED` and both ends read the same shared constant.
- **Submit run lives in that row, and it is always there.** It replaces the "All stops done" banner, which only appeared once the last stop resolved — a control that appears late is a control nobody is looking for. Pressing it when the run is finished goes to S2.2b. Pressing it early **does not navigate**: a modal names the stops still outstanding, in route order, using S2.2b's own BLOCKED wording and the shared incomplete message rather than a second phrasing of the same rule. `I11` and `I12` are untouched — this changes what the screen offers, never what the service allows.
- Below ~896px the panes stack, keeping the same order.

- Categories: active categories only, admin-managed (S1.8) — seeded at launch with the 11 AGFP categories (Frozen Meat, Bakery, Produce, Deli, Dairy, Dry, Frz Non Meat, Non Food, Pet, Health & Beauty, Trash), but the tile set renders from live active-category data, not a hardcoded list.  
- Notes visible here (read-only, receiver doesn't author any of these): driver→receiver note for this stop (`ShiftStop.note`, PRD cap 11); donor's permanent per-store note (`Donor.note`, admin); the driver's whole-run note (`Shift.note`). **All three are shown, not hidden behind a disclosure (`D68`)** — the run note sat behind a "Run notes" expander to save space, and a note the driver wrote for this receiver about this run is one most receivers would never have opened. An absent note renders nothing: absence is not worth a sentence.
  - **One line each, and the label names the author**: "Karen Diaz's note: back door is locked after 4". A label stacked over its body cost two lines apiece on the screen with the least room, and "About the whole run" told the receiver something the note's position already told them. **Who wrote it is the part they cannot see**, and it is what decides how much the note is worth acting on — a driver's remark about this morning is not an admin's standing note about a door. The store's note stays "Store note:", because it is nobody's. The possessive is always `'s`, the same single rule S2.1b's run label follows. A run with no owner names the role, not a person.
  - **They sit at the foot of the entry column, in the space Add weight and Done leave empty**, and are capped by the **keypad's own height** — the block takes what the controls above it do not want and scrolls inside itself past that. So a driver's paragraph costs the screen exactly what a one-liner costs. This is the only thing on S2.2 allowed to claim leftover space, because it is the only thing whose length the pantry does not control.
  - **The keypad defines that row.** A grid row sized `auto` is as tall as its tallest item, so the notes first *grew* the column rather than filling it and put the page back into scroll. The row is therefore definite — four keys and their three gaps, written from `--key-min` so it follows the floor if the floor ever rises.
- Flow: tap a category tile (it highlights with `--brand-orange` bar) → type weight on keypad → **Add weight**. The number appends to that category's running list and the subtotal updates. Repeat. Entries confirm immediately on **Add weight** — no separate sign-off at the entry level (PRD cap 14).  
- Per-stop resolution: **Done** finalizes this stop (any non-voided weight_entry already resolves it to WEIGHED — this button just navigates on to the next unresolved stop). **Skip** sets the stop's disposition to SKIPPED (confirm dialog, since it can't be un-skipped from here). Either advances the stop-status strip and returns to the run's next pending stop, or to S2.1b if none remain. *(Both were longer — "Mark stop weighed" and "Skip stop" — until `D37`. The buttons carry an accessible name that still states the object, "Done with this stop" and "Skip this stop", so shortening the visible label did not shorten what a screen reader announces. The skip **confirm** still says "Skip stop": §3 wants a destructive confirm to name the action, not echo the button that opened it.)*  
- Edit: tap an existing entry (✎) to overwrite it — shows the prior value, no undo/history UI. Underneath, this voids the original entry and inserts a new one (Domain I13, weight rows are immutable); the UI just presents it as a simple overwrite.  
- Why it works: paper-parity (category columns, running numbers, totals row, "the sheet") + big targets + auto-totals (kills the hand arithmetic), now with just enough run/stop context to satisfy the completion gate without turning the sheet into a project-management screen.  
- States: no stop selected (prompt from S2.1b first), unsaved entries, stop resolved (status dot updates, prompts next stop), all stops resolved (the progress row's Submit run now goes straight to S2.2b — the banner it replaced is retired under `D62`).  
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
  - **Closed** — the run is `COMPLETED`. A **read-only summary and no action**, and since `D46` it **names who signed off and when**. §3's dead-end rule applies here as everywhere; the way out is the `BackLink` at the top (`D43`), which replaced the three bottom "Back to the runs" buttons this screen used to carry, one per state.
- **The sign-off name is read, not stored.** There is no `completed_by` on `shift` — only `updated_by` (`I26`). Because `I10` makes `COMPLETED` terminal, the last writer of a completed shift **is** whoever confirmed receive-done, so no migration was needed. It is populated only when the shift is `COMPLETED`; on an open run it is null rather than the last person to touch a weight, which would name the wrong person confidently. **If `COMPLETED` ever stops being terminal, this silently starts lying** — the inference is recorded beside the code.
- **The confirm names the right person.** It reads "you cannot change a weight yourself — ask whoever does the reporting", because `requireReceivable()` refuses every receiver write once the shift is `COMPLETED` and corrections belong to the Reporter (`D14`). It previously promised "you can still fix a weight afterwards", which the server denied.
- **The edit window is now visible to the client (`D47`).** It used to see only half of it — a closed run leaves `GET /receive/runs`, but `receiver_edit_window_days` was exposed nowhere — so **Change a weight** could appear on an open run whose day window had lapsed and lead to a sheet where the server refused the write. The payload now carries `editWindowOpen`, computed by the **same predicate the service already gated on**, not a second copy of the rule, and the affordance requires both halves. The server refusal is unchanged and is still the guard; what went away is the wasted tap.

### S2.3 Unscheduled donation

- User/device: receiver (tablet landscape), one tap from S2.1b.  
- Purpose: record a donation arriving outside a scheduled pickup (PRD cap 12).
- **It weighs ONE donation (`D76`).** It used to be three things stacked — a list of what drivers had flagged, a form, and a list of what had been recorded. Both lists are on S2.1b now, beside the runs, and what is left here is **the sheet**: the same layout S2.2 weighs a stop on, sharing its stylesheet so the two cannot drift into different-looking screens.
- **Two doors, one screen.** `/donations/:id/weigh` opens a driver's `SUGGESTED` row (S1.5, "Add an unscheduled stop not on my route") — the store is settled, so the donor picker is **not** offered and the header states the store with the driver's note beneath it. `/donations/new` starts a walk-in, where the store is still a question and is asked. A donation is fetched **by id** rather than handed over by the screen that linked here, so the page survives a reload on a docked tablet and finds out from a 404 if another receiver got there first.
- **`fullScreen`, like S2.2 and for the same reason (`D60`).** A hand resting at the bottom edge of a docked tablet must not land on the nav mid-weight. The `BackLink` at the top is the only way out.
- **Which column a control goes in.** Left is *what this is* — the kind of food, the store, the report toggle, the note — and is the one region allowed to scroll. Right is *how much*: the readout, the keypad, the button, with the **keypad on the outer edge and the actions beside it**, exactly as `D61` arranged S2.2's. That division is what lets a receiver move between the two screens without relearning either, and it puts everything that grows with the data (eleven categories, a donor list) in the column that can absorb it, so the keypad cannot be pushed off.
- **Report toggle, default ON** ("Report this to North Texas Food Bank"). Donor attribution is optional only when the toggle is OFF (`I16b`). On a driver's row, where the picker is absent, that error appears under the toggle that caused it.
- Key boundary surfaced: ON → counts toward the NTFB report. OFF → tracked for pantry metrics only, never reported. Copy must make this visible: "Reported donations go in the weekly NTFB report. Unreported ones still count in our own totals."  
- **The grain is one row per category (`I18`)**, so submitting behaves differently by door. A **walk-in** stays on the screen with the store, the note and the report choice kept and only the category and weight cleared — three kinds of food is three submissions. A **driver's row is one row**; there is no second category to add to it, so a confirm returns to S2.1b, where the next thing is.
- **Discard lives here, not on the list (`D76`).** Throwing a suggestion away destroys the only record that a driver saw this food, and that judgement is made after opening the row, not while scanning past it.
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
- **The screen IS the receipts (`D54`, 2026-08-03).** There is no landing page, no totals and no drill-in. `/report` opens on the range control and the list of Meal Connect receipts, because that list is the reporter's entire job: they are typing one store at a time into somebody else's web form. Everything below describes that one screen.
- **Why the totals went.** The reporter is a data-entry volunteer, not an analyst, and QA found they read a totals-first screen as "analysis, not my job" — and so never opened the drill-in behind it, which is where `PRD` cap 15 put **the only remaining way to correct a weight after the receiver's window closes**. They reported that as a missing feature. It was not missing; it was unreachable from where they actually stood. **Intake and reported totals now live only on S3.2**, which is the screen for numbers.
- Every line is still **inspectable down to store-category-day** (Success Metric 4: 100% traceable) — the receipt *is* the inspection, keyed `(pickup date, donor)`, listing each `Category · Storage · Pounds` with our own source detail below the portal block.
- Only donations flagged for reporting flow into a receipt (the toggle). The ones that are not flagged are shown separately — see the two sections below.
- **Every figure on this screen is whole pounds (`D28`)**, because it is what gets typed into Meal Connect and the receipt has to agree with the screen it was read off. **S3.2 does not round**, so the same range reads a pound or two apart on the two screens and both are right. **That sentence now prints and no longer shows on screen (`D69`).** It is still the case `§7` keeps copy for — nobody can deduce it from the numbers — but a reporter meets the discrepancy while comparing a card against the portal, which is when they are holding the printout, not while scrolling the list. Same screen-versus-print split as `D57`, one bullet below, and for the same reason.
- **The trash deduction explains itself on the receipt (`D27`).** The drill-in's three-line breakdown — *weighed / counted as trash / reported* — went with the drill-in, and nothing was lost: a **receipt carries its own Trash line**, so what was weighed and what is reported already add up in front of the reporter. That line is the one row on a receipt with no weighing sheet behind it, and it says where it came from instead of naming a category.
- **Reporter edit (PRD cap 15), now inside the receipt.** Corrections sit in their own block **below the open receipt**, not on the receipt's own rows — deliberately, because the card above is a mimic of the portal's form (`D29`) and an editing control among its lines would invite someone to type one into Meal Connect. The block lists the underlying entries: each weight entry carries the ✎ (same overwrite-look, void-insert-underneath as S2.2), each walk-in its reportable switch. A receipt line is an *aggregate* of `(category, storage)`; an entry is what is actually correctable, which is the other reason the two cannot be the same row. Before the receiver's edit window closes this mirrors what the receiver could already do at the tablet; after it closes it is the *only* remaining way to correct that entry. No approval step; the Reporter's edit is itself the correction. **The operation did not change — only where it is rendered.**
- **✎ appears only on a weight line.** The correction service looks a `weight_entry` up by id, so offering ✎ on a walk-in donation could only ever return "No such entry" — a pre-existing defect the move exposed. A donation is corrected through the switch beside it instead.  
- **The mapping row is a pair (`phase-3-build-plan.md` D15).** A Meal Connect line item is `Category · Storage · Description · Pounds`, so each of our categories is matched to an NTFB category *and* the Storage it reports under (`Frozen`, `Dry`, `Refrigeration` on the receipt we have — free text, typed as their form words it). Storage is chosen in the same step as the category and shown with it on the row. A missing storage is named on the row but does **not** block the export; an unmapped category still does. One NTFB category under two storage values renders as two lines, because it is two line items on the receipt. **Since `D26` the whole mapping ships seeded**, so this screen and the Admin tab now *edit* it rather than being where it is entered from nothing — the unmapped-category refusal is kept because an admin can still clear a mapping.  
- *(`D34` led with the report and cut three figures to two; `D54` finished the move and removed the figures entirely. `D34`'s reasoning — the reporter's job is the submission, the totals are context — is why, and its ban on either label shortening to "Total" now applies on S3.2, where those labels live.)*
- **Two sections, and the second is not a leftover pile (`D56`).**
  - **To file into Meal Connect** — every receipt with a store. This is the work.
  - **Not filed to the food bank** — two different things, deliberately together, because they answer the same question ("why isn't this in my list?"): receipts with **no store to file under**, and **confirmed donations somebody switched off**. The second kind has no receipt at all — the report union is `WeightEntry[!voided] ∪ UnscheduledDonation[CONFIRMED ∧ reportable]`, so an unflagged donation is outside it — which is exactly why the reporter could not find any way to put one back. Each carries an inline **Put this in the report**, or the reason it cannot be.
  - **`I16(b)` decides which.** A donation with neither a store nor a typed-in label cannot be flagged reportable, so its row **says so instead of offering a control that would 400**. The read answers the same predicate the write enforces; `setReportable` is unchanged and remains the only enforcement.
  - **A label-only walk-in can be pointed at a real store (`D72`) — "File this under a store".** `I16(b)` accepts a typed-in name as a source, so such a row is legitimately *reported*: its pounds are in the total and in S3.2. But a receipt keys on `(date, donor_id)`, so it could never be **filed**, and nothing re-pointed it at a store once that store was added to our list — the pounds sat outside the food bank permanently. Picking a store merges the row into that store's receipt for that day, which is then tickable like any other.
    - **The typed name does not survive as a label**, and the screen says so rather than implying otherwise. `ck_ud_source_exclusive` is a tier-1 CHECK — a row may have a store *or* a typed name, never both — so the name moves into the pickup's own note ("Written down as sunrise bagels."), which already rides onto the receipt as a `DONATION` note. The reporter filing the card still sees what the receiver wrote, beside the store it was filed under.
    - **Two things it re-checks, because attaching a store is exactly what can newly break them**: `I29`'s on-route guard, if the donation belongs to a shift where that store is already a stop; and `D27`'s per-donor trash rates, which now apply and move weight between categories. **The reported total does not change** — asserted directly, not assumed.
    - An **archived** store cannot be picked, and a store that is genuinely not ours reads "ask an admin to add it": donors are master data and a reporter does not invent them.
- **A progress bar over the fileable receipts only**, with the sentence kept beside it — a bar with no number is not a status. Walk-ins that never needed reporting are not counted against the reporter, which is what made the old "1 of 10" read as further behind than they were.
- **A filed row differs on FOUR channels** (§2 forbids a signal carried by hue alone): a filled green chip reading "Submitted" with the tick inside it, the "submitted by … " byline, a distinct row surface, and the de-emphasised weight beside it. Any one read on its own still says done.
  - **Green was added (`D78`), and the receding treatment was the bug.** `D56` deliberately made a filed row *quiet* so it would not compete with the open one — but quiet turned out to be indistinguishable from absent, and QA reported the check-off as unclear. The colour is `--success`, whose own token comment already names this use ("confirmed pickup, reported, submitted"). It is an addition, not a replacement: the other three channels stay, so the rule §2 states is still satisfied.
  - **Filed and open can be true of the same row at once**, and must still read as two facts. They collide nowhere: the open treatment is an orange *edge* and tint on the row, the filed one is a green *fill* inside it. Different hue, different shape, different position.
  - The chip is **screen-only**. Both places it appears are already hidden under `body.s31-print-mode`, on the standing rule that the check-off is a way to *work* the list and its state is stale by the time paper is in a hand. The print rule that exists is a belt on that brace: wherever it does reach paper it is black on white, since browsers drop background fills and a chip keeping its white label would print white on white.
- **From / To, defaulting to this week (`D41`).** The week picker is gone. The default is the Monday–Sunday week containing the pantry's today — the same helper S3.2 uses, so the two screens cannot disagree about what "this week" means. A backwards range is refused rather than silently swapped. `?week=` still resolves, for a pre-`D41` bookmark.
- **Master/detail on desktop (`D55`)** — the list beside the open receipt, so the reporter keeps their place in a fifteen-row list while typing one of them into another window. It stacks below ~64rem. This splits on its own width, not on §3's device bands, because the question is whether two columns of content fit.
- **The open receipt is visibly the open one (`D70`).** `D55` gave the reporter a list beside the receipt and then let the open row look like the fourteen above it, which is a poor trade for someone whose eyes are on another window most of the time. The row and its detail card share a treatment — an accent rule, a distinct surface, `aria-current` — and **not colour alone** (§2). It must also stay distinguishable from a *submitted* row, which carries its own treatment under `D56`: "open" and "done" are different questions and must not read as one.
- **The screen no longer explains itself (`D69`).** Four standing paragraphs went: what the receipts are and what order they come in, what the corrections block is for, the whole-pounds note (now print-only, above), and the tail on the open-runs notice. **The open-runs count itself stays** — "3 runs still open in these dates" is a fact a reporter needs before filing, and `A184` still makes it surfaced, never blocking. What went was the three sentences after it. The rule this leans on is §7's: keep what a reader cannot see for themselves, and a reporter looking at a list of store cards can see what they are.
- **What Export produces (`D29`, superseding `D13`'s column list and `D16`'s CSV/print pairing; `D13`'s "no file import" finding stands).** Meal Connect is **three web screens a person types into**, and screenshots of them settled the shape: a receipt is `(Pickup Date, Donor)` with two checkboxes, then N line items of `Category · Storage · Description · Pounds`, then `Number of Items` and `Total Pounds` on its review list. So the export is a **printable mimic of that form** — one card per store per day, read top to bottom while typing. **There is no CSV**: one export path cannot disagree with itself, and the browser's own Save-as-PDF still covers "export as PDF" without a library (`D5`).
  - **No Description column.** The portal has the field; it is the reporter's own free text and not ours to fill.
  - **One line per AGFP category, never merged** — Deli and Frz Non Meat both report as `Prepared Meal / Frozen`, and the sample receipt carries two separate `Prepared Meals` rows for exactly that reason.
  - **The portal block is exactly what the portal asks for, and nothing else.** Everything of ours sits **below it**, under a rule and a heading saying none of it goes into Meal Connect — not as a fourth column, which would invite someone to type it in. That block holds: which of our categories each line came from (identified by category, storage *and* pounds, since the pair alone cannot tell two identical `Prepared Meal / Frozen` rows apart), the note that **Trash is computed** and nothing was weighed into it (`D27`), and the notes.
  - **Every note rides along**, labelled by channel — coordinator, driver, per-stop, receiver, walk-in. This is what carries "the store wasn't open at the scheduled time" to the food bank. Nothing is submitted automatically; Meal Connect has one free-text box and the reporter decides which remarks belong in it.
  - **Receipts are emitted for pickups that produced nothing.** `Scheduled Pickup Not Attempted` is ticked for a skipped stop or a run nobody worked; `No Pounds` for a pickup that happened and came to nothing. Both previously produced **no export row at all**, which made them invisible to NTFB — the same lost-sheet misreporting the system exists to end.
  - **On screen, a checkbox appears only when it is ticked (`D57`); on the print, both always appear.** The divergence is the point and is not a bug to tidy: the printout is a mimic of the portal's form, and a reporter comparing the two needs to see the box they are deliberately leaving unticked. The screen has no form to mirror, so an unticked box there is only noise.
  - **A `(date, store)` whose only intake was a switched-off donation gets no receipt at all.** It used to get one, ticked `No Pounds` — telling the food bank a store on that day came to nothing when the store had never been on the route. Under `D56` the reporter would also have seen the same donation in both sections. The receipt now requires *reportable* intake.
  - The agency and food bank codes are **no longer printed** (`D25`): the person entering the submission already knows them.
  - **One store at a time, with a filed check-off (`D35`).** The portal takes one submission at a time and has no import, so the view is a compact list of receipts — date, store, total, filed-or-not — and tapping one opens that store's full card. Ticking **Mark as submitted to Meal Connect** asks for confirmation before it writes; a ticked row shows who filed it and when. Un-ticking asks nothing: it takes a claim back rather than making one. The tick is **idempotent** — a second reporter ticking an already-filed store gets the state they wanted, and the first filer's name stands, because refusing would be telling them off for agreeing.
  - **A receipt with no store cannot be filed.** A walk-in carrying only a free-text label has no `Donor` to key on (`domain-modeling.md §2.1`), and Meal Connect's own donor picker could not be pointed at it either. The card says so rather than offering a control that would fail.  
  - **Two different gates, and the copy has to carry both.** *Reportable* needs a store **or** a typed-in name (`I16(b)`); *fileable* needs a real store. So a label-only donation flipped on under `D56` genuinely joins the reported total but **still cannot move into section 1** — and QA watched that read as "the button did nothing". The row says both halves, because the half that gets doubted is the first one: stating only "no store to file this under" would leave a reporter believing food is missing from the report when it is in it.  
- States: incomplete week (show what is missing), ready, exported.  
- Edge: an edited weight upstream (from either the receiver in-window or the Reporter here) reflects live; no version history shown beyond the underlying void trail (PRD out-of-scope as a UI feature).

### S3.2 Admin metrics

- User/device: admin (desktop).  
- Purpose: per-store and total-intake metrics, including **unreported** donation volume (PRD cap 16, intake ≠ reported).  
- Layout (`D58`, 2026-08-03): **two headline figures** — Total rescued, To the food bank — then a **three-column per-store table** (Store · Total rescued · To the food bank) with its totals row. Surfaces patterns like a store consistently under-donating (PRD problem statement).  
- **What `D58` removed, and what that costs.** The `Not reported` column, the `Change` column and its trend vocabulary, the by-store bar chart, and the lede sentence. The pantry's reading was that the screen was doing analysis nobody had asked for. **Unreported volume is still there — as the difference between the two headline figures**, on `D34`'s precedent that a derivable third number is not a third number. The aggregate stays on the payload so PRD cap 16's named figure has somewhere to live; the *previous-period* comparison was dropped outright, because it cost a second query of the whole union to render one word.
- **This screen is where S3.1's totals went (`D54`).** The reporter's screen no longer shows any, so this is the only place intake and reported appear side by side — which makes `D34`'s rule bind here now: **neither label may shorten to "Total"**, because the whole point of the pair is that the two numbers are different.  
- **Coverage tab (PRD cap 16):** counts of `UNCLAIMED` (window passed, never claimed) and `NO_SHOW` (claimed, never started) shifts, derived read-only (never stored, Domain I7) — filterable by driver, route, and period. Surfaces "this route keeps going unclaimed" or "this driver has three no-shows this month" the same way the donation table surfaces under-donating stores.  
- **Period: From / To, defaulting to this week (`D39`, answering `A179`).** The 1-week / 4-week / 12-week preset control is gone; any of the three is two dates away. `Earlier` / `Later` still step by the chosen range's **own length**, so the previous-period comparison stays like-for-like whatever window is picked. The default is the same Monday–Sunday week S3.1 uses (`D41`), which is the first time the two screens have named the same period — `A179` had picked 28 days because no doc settled it.
- Primary action: none destructive; this is read + export.  
- Key: keep Intake and NTFB-reported as two distinct, clearly labeled numbers everywhere.

---

## Responsive matrix

| Surface | Phone | Tablet | Desktop |
| :---- | :---- | :---- | :---- |
| Home hub | canonical | canonical | canonical |
| Shift board + When I'm away | canonical | usable | usable (staff) |
| Pickup execution | canonical | degraded | n/a |
| Today's pickup (today + this week) | **canonical** | usable | usable |
| Weight entry | n/a | **canonical** | usable |
| Unscheduled donation | n/a | canonical | usable |
| Scheduling / reschedule | cramped | usable¹ | **canonical** |
| Admin (metrics/accounts/donors/trucks/categories) | n/a | usable | **canonical** |
| Report (S3.1) | n/a | usable | **canonical** |
| Inbox + push state | canonical | canonical | canonical |

"Degraded" = works but not optimized; "n/a" = not a target for that device.

**"n/a" is about intent, never about reachability.** The columns are the device a surface is *designed for*, not a gate on who may open it. Weight entry reads `n/a` on a phone because a phone is a poor place to weigh a pallet, not because a receiver on a phone should be stranded. Reading this table as an access rule is what produced the `D22` blocker, where the entire 768–1023 band had no navigation. Every screen a user's tier and duty permit must be reachable at every width.

**The bands (`D36`, 2026-08-02): phone < 768, tablet 768–1199, desktop ≥ 1200.** Desktop was ≥ 1024, which put **every current iPad in landscape** (1024–1194) on the desktop side-nav layout — a squeezed sidebar on a receiving dock, which is what the pantry saw. At 1200 those devices land in the tablet band and get the bottom bar and the full width. The number is repeated in a handful of media queries because CSS cannot read a custom property there; they must move with `tokens/index.ts`.

**Two screens split on their own widths, not on these bands, and that is deliberate.** Weight entry goes two-pane at ~896px (`D44`) and the report goes master/detail on desktop (`D55`); both are about whether *two columns of content* fit, which is a different question from which navigation chrome a device gets. A layout that could only change on the three shared bands would have to pick between a squeezed two-pane at 768 and a stacked one at 1199.

**The chrome now occupies real height (`D42`).** A sticky top bar and bottom nav reserve `--top-bar-height` + `--bottom-nav-height` = 112px on phone and tablet, which any full-height screen must subtract. This is what makes "the page does not scroll" expressible at all, and it is why a very short viewport (under ~760px tall in the tablet band) scrolls the page rather than clipping the keypad's bottom row — clipping a 64px target is the worse of the two failures.

¹ With one hole: **route-stop reordering has no touch path** (S1.6 — drag does not fire on touch, and the arrow-key equivalent needs a keyboard). Everything else on the scheduling screens is usable on a tablet. Recorded rather than fixed, per the A151 ruling.

---

## Open assumptions (confirm or override)

1. **No tare math in v1.** Volunteers currently subtract tare by hand (visible on the sheet). Left out per "nothing not needed"; can add a per-entry tare helper later.  
2. ~~**No duty-picker modal.** Nav is derived from role/duty because each shared device hosts one duty workflow. If a future device hosts two, a picker returns.~~ **RESOLVED, 2026-08-02 (`D22`).** A device already hosts two: a volunteer holding `DRIVE` and `RECEIVE` is a real account, and hands-on QA found the two capabilities indistinguishable. **A picker did not return, and must not.** The answer was to group the nav by capability and add the **Home** hub, which shows every capability at once rather than asking anyone to choose between them. The derived-nav rule stands; only its justification was wrong.  
3. ~~**AGFP→NTFB category mapping** is maintained in the Report screen (or Admin). Confirm where you want it to live.~~ **RESOLVED, 2026-08-02.** Phase 3 built it on S3.1 under the `report` duty (`D11`), and the first QA pass moved it to **S1.8 → Category matching** under `tier: 'ADMIN'` (`D17`): the pantry reads the mapping as setup, and every other setup decision is already in Admin. The report's own routes stay `report`-duty — an Admin without the duty is still not a Reporter.

 