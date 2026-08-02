# R3 — pre-pilot test plan

**Purpose.** Establish, with evidence, that R3 does what `product-requirement.md` says it does —
before the CTO demo, the hosting request, and pilot planning. The plan is written to be run mostly in
parallel and to produce three artifacts a CTO will ask for:

1. **A coverage record** — every capability and screen exercised by a human on its real device, pass
   or fail, dated.
2. **A resource sizing** — measured memory, CPU, disk and backup growth at pilot load, not estimated.
3. **A disclosed risk list** — what is known-broken, known-unverified, and known-unbuilt, with the
   decision each needs. **Disclose these; do not let the demo discover them.**

**Scope note.** This tests the app as built. It is not a spec review — where behaviour disagrees with
a foundation doc, that is a defect to file, not a thing to fix mid-test. `domain-modeling.md` is
locked and wins any conflict.

---

## 0. What is already proven, and what a green gate does not mean

`./scripts/gate.sh` is green as of 2026-08-01 — **646 server tests across 41 files, 784 client tests
across 20 files, 1,430 total.** It proves eight things, and **nothing beyond them**:

migrations apply to an empty database · server typecheck · client typecheck (app + service worker) ·
server suite against that migrated DB · client suite · no stubbed service functions · no `@r3/shared`
package imports · `db/types.ts` matches the database.

**Do not re-test any of that by hand.** Test what it structurally cannot see. This project has
already produced three defects that four consecutive green gates missed, and each is a *category* to
probe rather than a fixed bug:

| What slipped through | Why the gate could not see it | What to test instead |
| :---- | :---- | :---- |
| **Categories were never seeded** (`phases-1-3.md` §6) | The test created the eleven rows itself, then asserted eleven existed — true against an empty DB | **Boot a genuinely fresh box** and look at what is in it before touching anything |
| **`IdlePrompt` fired instantly for every volunteer** | `setTimeout` overflows above ~24.8 days; only the 30-day Volunteer window crosses it, so it broke for exactly one persona | **Sign in as each persona on its real device and wait**, rather than exercising the API |
| **Two tests passed only outside 09:00–13:00** | The suite straddled wall-clock `now`; a wave was promoted on a green that was luck of the clock | **Run the suite at several times of day**, and date every manual result |

**The standing lesson:** a green gate is evidence only about the things it runs. Nothing in it has
ever rendered a DOM at phone width, sent a real push, restored a backup, or had two people use the
app at once.

---

## 1. Preconditions — settle these before anyone starts

### 1.1 The NTFB mapping blocks the export, by design

`ntfb_category` ships empty and `category.ntfb_storage` ships null (`phases-1-3.md` D12, D15).
Until a Reporter fills both on S3.1, **S3.1 shows every category unmapped and refuses to export.**
That is correct behaviour, not a bug — but it means the export path is untestable and undemoable as
shipped.

**Draw this line clearly and hold it:**

- **In `r3_dev` / test databases: enter placeholder mapping values and exercise the whole export
  path.** You must — otherwise D13's worksheet, D15's `(category, storage)` pair grain, and the
  blocking behaviour itself all ship unexercised.
- **Never seed those placeholders into a migration, `dev-seed.ts`, or anything that reaches
  production.** That is precisely what D12 forbids, and every gate here would pass while it happened.

**For the demo:** either get the real list from the pantry first (best — it is one conversation and
it also unblocks the pilot), or demo the export with placeholder mapping and *say so on the slide*.
The mapping screen refusing to export is itself a good demo beat: it is Success Metric 4 working.

**Ask the pantry for:** the full NTFB category dropdown, where `Frz Non Meat` reports, the storage
wording their form uses, and the NTFB donor codes for the stores on our routes.

### 1.2 A realistic world, not the four-run seed

`./scripts/dev.sh --reset --seed` gives four accounts, four donors, two trucks, two routes and four
unclaimed runs. That is enough to boot, not enough to test. Build a **two-week world** covering:

- All three tiers and all three duties, including a volunteer with `DRIVE` **and** `RECEIVE`, and one
  with neither (the read-only case, `A112`).
- A recurring pattern with a claimed instance, an open instance, and one whose owner was deactivated.
- One week fully closed: every stop resolved, weights entered, receive-done, so S3.1 has a complete
  week to report and S3.2 has a previous period to compare against.
- One week in progress, so S3.1's "incomplete week" states are reachable (`A184`).
- At least one `SKIPPED` stop, one `REASSIGNED` stop, one voided weight, one walk-in donation and one
  driver-flagged prefill — these are the rows the report union is most likely to get wrong.

### 1.3 Environment matrix

| Surface | Device | Why it must be real hardware |
| :---- | :---- | :---- |
| Driver | **Phone**, ~390px | `A160` lives here; macOS Chrome clamps window width at ~614px, so a desktop browser **cannot** reproduce it. Use a real phone or a same-origin iframe. |
| Receiver | **Shared tablet**, 768–1023px | No nav at all on this surface by design (`ui-ux-spec.md §4`). A dead end here is unrecoverable for the user. |
| Staff / Reporter | Desktop, ≥1024px | Back-office screens; the only surface with full nav. |

---

## 2. How to parallelize this

**One app instance, many people.** `dev.sh` hardcodes `r3_dev`, `PORT=3000`, and Vite on `5173`; the
Vite proxy target `http://localhost:3000` is **hardcoded in `client/vite.config.ts:20`**, not read
from the environment. So a second instance on another port would still proxy its API to the first.

That is fine, and arguably better: at ~15 pickups a week and under 10 concurrent users, **testing
against one shared instance with different logins is the realistic configuration** and exercises
concurrency for free. Tracks A–F below can run simultaneously against it.

**What must be isolated, because it is destructive:**

| Track | Isolation needed |
| :---- | :---- |
| Ops rehearsal (§9) — migrations, backup, restore | Its own database. `./scripts/test-db.sh` derives a per-checkout name automatically; or set `R3_DEV_DB` explicitly. |
| Anything running `--reset --seed` | Same. **A reset wipes the world every other track is testing against** — this is the single most likely way to lose a day. |

**Rule: one person owns `r3_dev`'s lifecycle.** Everyone else reads the announcement before
resetting. If tracks genuinely need parallel isolated app instances, that is a small change to
`vite.config.ts` to read the API port from the environment — decide it before, not during.

**Suggested split across four testers** (or four `ui-tester` sessions):

- **Tester 1 — driver persona, phone.** Tracks A1–A3, B (S1.x), E.
- **Tester 2 — receiver persona, tablet.** Tracks A4–A5, B (S2.x), F.
- **Tester 3 — staff/admin, desktop.** Tracks B (S1.6/S1.8), C, D.
- **Tester 4 — reporter + ops, desktop.** Tracks A6, B (S3.x), G, H, I.

---

## 3. Track A — the weekly cycle end to end *(this is the demo spine)*

Run it as one continuous narrative, by three different people on three devices, in order. **This is
also the demo script**, so rehearse it until it is boring.

| # | Step | Actor / device | What must be true |
| :---- | :---- | :---- | :---- |
| A1 | Schedule a week — one-off and a recurring pattern | Staff, desktop (S1.6) | "starting __" is **read-only and computed** (`A111`). No truck field at publish (I8). Route reorder works by drag *and* keyboard; **touch cannot reorder** (`A151`) |
| A2 | Driver sees the board, claims a run | Driver, phone (S1.2 → S1.3) | Times render in the **pantry's** zone, not the device's (`A120`). Claiming a run someone just took fails honestly |
| A3 | Declare unavailability, watch a run go at-risk | Driver + Staff (S1.4, S1.9) | Coordinator is alerted; at-risk fires once per run, not per newly-eligible driver (`A106`) |
| A4 | Start the run, work the stops, flag an ad-hoc donation, head back | Driver, phone (S1.5) | Stop list is the **snapshot**, not the live route (I5). Ad-hoc flag **requires a category** (D8). Skip and reassign both work. Confirming sets `pickup_completed_at` |
| A5 | Truck-inbound banner, weigh the load, close the run | Receiver, tablet (S2.4 → S2.1b → S2.2 → S2.2b) | Banner arrives without stealing the keypad (`A171`). Weight is a **decimal string** end to end (`A165`). `receiveDone` is the **only** path to `COMPLETED` (D7) |
| A6 | Confirm walk-ins, then report the week and export | Receiver + Reporter (S2.3 → S3.1) | Walk-in carries **no** `shift_id` (D10). Report totals match the weights entered. Export is **refused** while anything is unmapped (D12), then produces a receipt-ordered worksheet (D13) |
| A7 | Read the metrics | Admin, desktop (S3.2) | Per-store intake and coverage failures reconcile with what actually happened in A1–A6 |

**The arithmetic check that matters most:** hand-total the weights entered in A5 and A6, then compare
against S3.1's week total, S3.2's period total, and the exported worksheet's `Receipt Total (lb)`.
All four must agree exactly. `phases-1-3.md §1` names the three ways this goes wrong while still
looking right — a `shift`-filtered join, `created_at` bucketing, and float summation.

---

## 4. Track B — role × screen coverage

Every screen, opened by a user of the right tier and duty, on its canonical device. Record
pass/fail/blocked per cell, dated, with the tester's name.

**14 screens:** S1.1 login · S1.2 board · S1.3 shift detail · S1.4 my shifts · S1.5 pickup ·
S1.6 schedule · S1.7 reschedule · S1.8 admin · S1.9 inbox · S2.1b run picker · S2.2 weight entry ·
S2.2b receive done · S2.3 donation · S2.4 truck banner *(a mounted banner, not a route)* ·
S3.1 report · S3.2 metrics.

For each, verify: it renders, the console is clean on load, the **primary action is exactly one**
(`ui-ux-spec.md §1.1`), empty states read correctly, destructive actions confirm, and every tap
target meets the minimum.

**Negative access is half of this track.** For each screen, try to reach it as a user who should not:
a Volunteer opening `/admin`, a driver opening someone else's run, a `RECEIVE`-only user opening
`/report`. The server must refuse independently of whether the UI offered the affordance — client
checks are communication only.

---

## 5. Track C — rules and adversarial cases

The invariants have unit tests. What is untested is whether they hold **through the HTTP surface,
from a browser, by a determined user.** One case each:

- **Default-deny** (`architecture.md §4.3`) — a route declaring no tier/duty is rejected, not open.
  Probe unauthenticated and under-privileged on every route family.
- **I20 double-claim** — two drivers, one run, same second. One wins, one gets an honest refusal.
- **I20 staff-assign exemption** — Staff may confirm through `AVAILABILITY_BLOCK` and
  `OWNED_SHIFT_OVERLAP` only; `NO_DRIVE_DUTY` and `DEACTIVATED` are hard refusals even for Staff
  (`A95`).
- **The receiver edit window (D9)** — a receiver edit after the window is refused; **`receiveDone` is
  not window-gated**, so a lapsed run can still be closed. Then confirm the **Reporter** can still
  correct that entry on S3.1 (D14) — this pair is the most easily broken behaviour in the app.
- **I21 delete branches** — deleting a donor/category/truck/user with history deactivates; without
  history it hard-deletes. The UI must **not** make the user choose. Voided rows count as history
  (`A169`).
- **I13 void-and-insert** — a corrected weight leaves the original voided, not mutated, and the
  audit trail resolves.
- **PII** (`pii.ts`) — Staff *see* phone/address, only Admin *edits* (`A24`). Donor `address`/
  `contact` are **never** trimmed — drivers need them.
- **I3** — username is auto-generated and immutable after creation; the S1.8 preview matches what the
  server returns (`A146`).
- **Unmapped weight is surfaced, never dropped** (D12) — the whole point of Success Metric 4.

---

## 6. Track D — concurrency

`SERIALIZABLE` + 40001 retry is load-bearing and has unit coverage, including the canonical
write-skew case. **Nothing has exercised it from two browsers.** With ≤10 users this is low-volume,
but a lost weight is unacceptable in a system of record.

- Two receivers on the tablet weighing **different stops** of one run simultaneously.
- Two receivers on the **same stop** — one must lose cleanly, with a message that tells the truth.
- Staff reassigning a stop while the driver is resolving it.
- Two drivers claiming one run (also Track C).
- A receiver closing a run while a driver is still confirming a stop.
- **Then reconcile every total.** A retry that silently double-writes is the failure mode that a
  passing UI hides.

---

## 7. Track E — device, responsive, and the known defect

- **A160 — the phone topbar overflows at 390px, and it is unfixed.** Reproduce it, then pick between
  the two measured fixes (`phases-1-3.md` §3.2): `flex-wrap: wrap` costs 44px of vertical space and
  truncates nothing; ellipsizing the chip keeps the bar at 56px but truncates text. **This is a
  design call, and it is visible in any phone demo.** Decide before the CTO sees it.
- Every screen at 390 / 768 / 1024 / 1440, plus **200% zoom** and 320px.
- The bottom nav is `position: static` and scrolls away — an open question, not a defect, but the
  driver hits it every time they change screens (`phases-1-3.md` §3.4).
- Tablet: confirm the receiver surface has **no** navigation and that no flow can dead-end there
  (`A167`).

---

## 8. Track F — PWA, push, offline

**Push is unverifiable in dev.** `dev.sh` leaves VAPID unset, so push degrades to a logged no-op by
design (`A12`, `A76`) and the in-app inbox remains the source of truth. **Testing push at all
requires a box with real VAPID keys**, which makes it a §9 concern, not a §3 one.

- Install the PWA on iOS and Android. Confirm the home-screen icon is the real one, not the browser's
  screenshot fallback (`A158` produced the 180×180 PNG).
- Onboarding card, one-time, per browser (`A68`, `A71`).
- With VAPID configured: each of the six events reaches the right recipient (`product-requirement.md`
  notification matrix), the truck alert deep-links to `/receive` and not to a shift (`A170`), and it
  shows **both** as an OS notification and as an in-page banner (`A171`) without double-navigating.
- The service worker is **push-only, never cache-first** (`ui-ux-spec.md §4.5`). Confirm no stale
  screen is ever served — this is a system of record.
- Kill the network mid-flow on the phone and confirm the failure is honest rather than silent.

---

## 9. Track G — ops rehearsal *(this is what funds the hosting ask)*

The CTO's questions will be about this track, not about screens.

- **Build and run the real topology.** `Dockerfile` + `docker-compose.yml`, one process serving the
  built SPA with a catch-all fallback and **no Vite** (`architecture.md §4.5`). Confirm the session
  cookie behaves identically to dev — that is the one property the dev proxy exists to preserve.
- **Fresh-box boot.** Migrate an empty database and look at what is actually in it: the 11 AGFP
  categories from migration `0010` must be there, `ntfb_category` must be empty. This is the exact
  check that would have caught `A156`.
- **`./scripts/rehearse-migration.sh`** against a copy of a populated database.
- **`./scripts/backup.sh`, then restore into a clean instance and diff.** A backup nobody has
  restored is not a backup. Time it and record the number.
- **Restart mid-cycle.** Jobs ask "what is due and unhandled?", never "fire at time T", so a missed
  tick must self-heal. Kill the process during a pending reminder and confirm it recovers.
- **`TRUST_PROXY` needs its real deploy value** (`A35`) — on the box it must name the `cloudflared`
  network, or the per-IP throttle collapses to a single address and locks everyone out at once.
- **Set `SESSION_COOKIE_SECRET` and VAPID for real**, and confirm the cookie goes `Secure` under
  `NODE_ENV=production`.

**Measure and write down:** container memory at idle and under the full week's load, CPU, database
size after two weeks of realistic data, backup size and growth rate, and cold-boot time. **These
numbers are the hosting request.** At ~15 pickups a week this will be small; a specific small number
is far more persuasive than "it's lightweight."

---

## 10. Track H — security

Run `/security-review` on the branch, then verify by hand:

- Login throttle: account locks at 4 failures, per-IP ceiling holds, and the counters are **in
  process memory** — a restart clears a soft lock (`A25`). Decide whether that is acceptable for the
  pilot.
- Session lifetimes actually expire: 30 min idle / 12 h absolute on shared devices, 30 d volunteer /
  7 d staff on personal (`architecture.md §4.2`). **Test the volunteer's 30-day window specifically** —
  that is where `IdlePrompt` broke.
- A shared device never holds a personal session, and a browser with an `r3_device` marker registers
  push **device-scoped, never user-scoped** (`A72`) — otherwise one person's alerts leak onto the
  shared tablet.
- The roster endpoint is public by design (`A33`); confirm it exposes names only, no PII.
- Error responses carry a correlation id and no internal detail.

---

## 11. Track I — accessibility

- Keyboard-only traversal of every screen, including the S1.6 route reorder (the drag handle is a
  focusable button reordering on ArrowUp/ArrowDown) and the S1.8 tab set (a real tablist with roving
  tabindex, arrow keys, Home/End).
- Screen reader on the two flows a volunteer must complete unaided: claim a run, and weigh a load.
- 200% zoom with no horizontal scroll — **except the known topbar defect**.
- Contrast: the tokens were computed rather than eyeballed (`A17`), so spot-check rather than re-audit.
- Tap targets meet the minimum on the phone and the tablet, gloved-hand realistic.

---

## 12. Track J — the copy review *(human only, cannot be delegated)*

**Fourteen screens of user-visible copy have never been read by a person** (`phases-1-3.md` §3.3).
The mechanical half is enforced — every screen holds a `§7` forbidden-vocabulary test, so no banned
word can reach a user. What is left is judgement: are these the right words for a paper-first reader?

Prioritise the sentences where a wrong word teaches someone something false:

- S1.7's release-no-replacement sentence and its three cannot-be-moved explanations.
- S2.2b's toast naming how many unconfirmed prefills the close discarded.
- Every refusal message in Track C — a refusal that misleads is worse than a 500.
- S1.6 is ~90 sentences on its own; budget real time for it.

---

## 13. Exit criteria

Do not schedule the demo until all of these hold:

1. Track A runs start to finish, by three people on three devices, **twice**, with all four totals
   reconciling.
2. Every cell in Track B is pass or **explicitly** blocked with a reason.
3. Tracks C and D produce no unexplained data loss and no silently-wrong number.
4. Track G has produced a **restored** backup and a written resource sizing.
5. `A160` has a decision — fixed or consciously deferred with a note.
6. The NTFB mapping is either real (from the pantry) or explicitly labelled placeholder in the demo.
7. `./scripts/gate.sh` is green, **run at more than one time of day**.
8. `doc-qa` is clean on anything this effort changes.

---

## 14. Disclose these; do not let the demo find them

A CTO who discovers a gap mid-demo discounts everything else. Lead with the list.

| Item | State | What it needs |
| :---- | :---- | :---- |
| **NTFB category list and mapping** | Deliberately unbuilt (D12) | One conversation with the pantry. **Blocks export, blocks pilot.** |
| **A160 — phone topbar overflow** | Known, unfixed, two fixes measured | A design decision |
| **14 screens of unreviewed copy** | Mechanically safe, editorially unread | Human reading time |
| **Push never verified end to end** | VAPID unset in dev by design | A box with real keys (Track G) |
| **No production data has ever existed** | True by definition | The pilot itself |
| **Stored shapes are cheap to change only while empty** (`phases-1-3.md` §4) | `A5`, `A7`, `A36`, `A58`, `A3`, `A165` | **Ratify before the pilot writes real rows** — after that each is a data migration |
| **A189** — does Meal Connect accept decimal pounds? | Unknown | Ask when the mapping is asked for. Rounding is **not** a one-line change |
| **A191** — does NTFB want receipts for fruitless pickups? | Deliberately not built | Would widen a **locked** doc's union — doc change first |

**Item 6 deserves its own slide.** The system is pre-launch and empty, which is the only time those
six decisions are free. Every one of them becomes a data migration the day the pilot starts.
