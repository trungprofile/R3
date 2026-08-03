# QA round 2 — results

Automated sweep, 2026-08-02, against `r3_dev` rebuilt by `scripts/qa-world.ts`.
Round 1 was one person on one account at one screen size. This is the attempt to cover the
rest of the app mechanically, and — just as importantly — to draw an honest line around what
a browser-driving agent cannot reach, so the remaining human hours go where they matter.

**Nothing in the repo was changed.** Every finding below is reported, not fixed. The only
files this round added are `scripts/qa-world.ts` and this directory.

> **Superseded in part, 2026-08-02.** QA round 3 fixed several of the findings below. Do not
> re-file these:
>
> | Finding | Now |
> | :---- | :---- |
> | **Blocker** — a RECEIVE-only volunteer cannot reach the receive screens above 1023px | **Fixed** (`D22`). The tablet band's empty nav is gone, and `Receive` has a nav entry on every viewport. |
> | `report.css`'s `body * { visibility: hidden }` leaks, so Ctrl+P prints blank on any screen after visiting the report | **Fixed.** Every print rule is scoped behind a body class added on mount and removed on unmount. |
> | The account-tier picker "defect" | **Was never a defect** — `services/user.ts` refuses admin-at-creation outright. The *spec* was stale and has been corrected. |
> | `report.ts` returning unfiltered entries after a correction, and the drill-in summing intake under a reported row | **Addressed** by the drill-in rework (`D27`): gross, deduction and net are now three explicit lines, and gross counts reportable entries only. |
> | **`A160`** — the 403px fixed topbar at 390px | **Still open, deliberately.** `phases-1-3.md §3.2` says both known fixes degrade something and must not be picked silently. `D22` created a third option (move the alerts chip, the 194px trigger, onto the Home hub) which is recommended but unbuilt. |
> | The board's `?edit=` deep link being inert | **Still open.** |
>
> The reconciliation figures below are still valid as **gross intake**, which is what S3.2
> reports. They no longer equal the printed receipt: `D27` moves weight into a computed Trash
> line (without changing the total) and `D28` rounds every line to whole pounds (which can move
> it by a pound or two per receipt). Both are intended.

Read `docs/features/test-plan.md` for the tracks these map onto, and
`docs/features/qa-round-1-changes.md` for what the R-numbers refer to.

---

## 0. The world everything ran against

`scripts/qa-world.ts` replaces `dev-seed.ts`'s four unclaimed runs with the two-week world
`test-plan.md` §1.2 asks for. It prints its own hand-totals, and those numbers are the third
opinion every screen's arithmetic is checked against — one source reporting success is not
evidence.

| | |
| :---- | :---- |
| Closed week | 2026-07-20 .. 07-26, every run `COMPLETED` |
| In progress | 2026-07-27 .. 08-02, mixed states, 4 runs still open |
| Ahead | 2026-08-03 onward, open runs + Lane B's isolated race fixtures |
| Accounts | 8, covering every tier and duty combination including **no duties at all** (`A112`) and a deactivated owner |
| Deliberately awkward rows | a voided weight, a driver-skipped stop, a reassigned stop, a reportable walk-in, an **un**reportable walk-in, a lapsed `IN_PROGRESS` run |

**Hand-totals**: closed week 445.75 lb reported and intake; current week 305.25 reported,
321.00 intake, 15.75 unreported. Full printout in [`qa-round-2/world.txt`](qa-round-2/world.txt).

It never touches `ntfb_category` (`D12`). Placeholder mapping is entered through the Admin UI
during the pass that tests that screen, and leaves nothing behind.

**One thing the world builder got wrong, and the app got right.** Its first draft filed both
walk-ins under the closed week and disagreed with S3.1 by exactly 60 lb. A walk-in has no
shift and therefore no `occurrence_date` (`D10`), so its `report_day` is `received_date` —
today. The union's date rule (`data-model.md §8`) held; my arithmetic didn't. Worth recording
because it is the failure mode the report is most likely to have, seen from the outside.

---

## 1. Lane B — 1,083 HTTP checks, one defect

No browser. Per-role cookie jars, which is the one thing a single Chrome profile cannot have,
and the only way to get two genuinely simultaneous requests. Script and full output in
[`qa-round-2/lane-b.txt`](qa-round-2/lane-b.txt).

### What passed

**The access matrix is exhaustive by construction.** It imports `apiRoutes` and probes every
route the server actually registers — 97 of them — against 7 personas, comparing the observed
status to what each route's own `access` declaration says should happen. A route added next
month is covered the day it is added, without anyone updating a list.

- **672 authorization checks, all correct.** 276 should-admit, 396 should-refuse, no leaks and
  no false refusals. Anonymous gets 401, under-privileged gets 403, and the two are never
  swapped.
- `D17`'s move landed: `/report/mappings` and `/report/ntfb-categories` are `tier: ADMIN`,
  while `/report` itself stays `REPORT`-duty. Sam the coordinator reads the report and is
  refused the mapping, which is exactly the split round 1 asked for.
- **Default-deny holds.** `/not-a-route`, `/admin`, `/metrics` and `/shifts/x/y/z` all return
  403 to a signed-in **admin**. Undeclared is not open.
- **The public roster carries names only** — `id, username, firstName, lastName,
  credentialKind`. No phone, no address, no hash (`A33`).
- **`I20`** — two drivers claiming one run in the same instant: exactly one won, the loser got
  `409 "That run was just taken by Rosa."`
- **`A95`** — `NO_DRIVE_DUTY` and `DEACTIVATED` are hard refusals **even for an admin**, with
  the eligibility reasons named in the response. The exemption really is scoped.
- **No lost or duplicated write.** Eight parallel weight entries against one stop: 4 accepted,
  stored delta exactly 4.00 lb. A `SERIALIZABLE` retry that replayed its write instead of
  re-reading would show here and nowhere else.
- A stop cannot be weighed and skipped at once; a stop cannot be reassigned and resolved at
  once. In both races one side lost cleanly with a 409.
- **`D9`/`D14`, the pair `test-plan.md` §5 calls the most easily broken behaviour in the app,
  works end to end.** On a run picked up twelve days ago and never received: the receiver is
  refused `403 "The time to change this run has passed. Ask someone with reporting access to
  fix it."`; `receiveDone` on that same run still returns **200**, so a forgotten run can
  still be closed; and the Reporter can still revise its weights.

### The defect

> **Contention past the retry budget surfaces as a 500, not a refusal.**
> Severity: **major**. Track D. `server/src/db/transaction.ts:52`.
>
> Eight simultaneous weight entries against one stop: 4 succeeded, **4 returned
> `500 INTERNAL "Something went wrong. Try again."`** with a correlation id. The server log
> records each as `unhandled_error` with a full stack.
>
> `writeTransaction` retries SQLSTATE `40001` three times and then rethrows the raw `pg`
> error. Nothing maps it to an `AppError`, so the error handler treats a serialization
> failure — a normal, expected outcome under contention — as a crash.
>
> **Why it matters.** The data is correct; nothing is lost. What is wrong is what the
> receiver is told. "Something went wrong" gives a volunteer at a dock no reason to believe
> retrying will help, and it is indistinguishable in the log from a genuine fault, which
> defeats `architecture.md §5.4`'s "a rising retry rate is a signal worth watching."
>
> **How likely.** Low at ~15 pickups a week and under 10 users — but the receiving tablet is
> *shared* by design, and two people weighing one truckload is the workflow, not an abuse of
> it. Eight-way contention is artificial; two-way is Tuesday.
>
> **Not fixed here.** The shape of a fix is a judgement call — a longer retry budget, a
> jittered backoff, or mapping exhausted `40001` to a 409 with honest words — and it touches
> the one wrapper every write in the app goes through.

### Two things my own probes got wrong first, recorded so nobody re-derives them

1. A `..` traversal probe returned 200 and looked like a hole. `fetch` normalises the path
   before it leaves the process, so the server received the plain public route. **Traversal
   is untested** — it needs a raw socket, and it is on the list below.
2. The first `D9` probe picked a `COMPLETED` run and got "That run is already finished."
   `requireReceivable` checks status *before* the window, so that probe could never have
   exercised the window gate. It took a purpose-built lapsed run to reach the real behaviour
   — and the real behaviour is correct.

---

## 2. The copy scan — four em dashes the round-1 sweep missed

Mechanical, no browser, across `client/src`, `shared/src` and `server/src/services`.

**Forbidden vocabulary (`§7`): clean.** The only hits are the forbidden-word lists themselves
and import paths. No banned word can reach a user.

**Em dashes in user-visible strings: four survivors**, severity **polish**, all in the
staff-assign path that round 1's lanes did not own:

| Where | String |
| :---- | :---- |
| `shared/src/coverage.ts:289` | `…already has another run — assign anyway?` |
| `shared/src/coverage.ts:291` | `…marked themselves away then — assign anyway?` |
| `shared/src/coverage.ts:292` | `…already has a run at that time — assign anyway?` |
| `server/src/services/coverage.ts:688` | `That run has already started — its driver can't be removed.` |

The last one is server-side, which is the class round 1 discovered the hard way: no
client-side change can reach it. The `'—'` empty-value **glyphs** in `parts.tsx`,
`detail.ts` and `DrillIn.tsx` are correct and stay — `D21` exempts them.

---

## 3. Lane A — the browser passes

Five sequential passes, one login each. Serial because a cookie is per browser profile, not
per tab: two agents signed in as different people would silently sign each other out, and the
failures would look like app bugs. Full reports in [`qa-round-2/`](qa-round-2/).

### Pass 1 — driver, phone, true 390px ([`pass-1.md`](qa-round-2/pass-1.md))

`A160` reproduced, which is the canary: a pass reporting the phone as clean has tested a
clamped 614px window rather than a phone.

**What passed.** Roster search matches the display name and not the username, and does not
autofocus on a phone. The board's week stepper, the closed week's `COMPLETED` runs, and the
"This week" button all work. `I5`'s snapshot held — confirmed against the reassigned-stop
fixture. R8's one-stop-at-a-time works, `D8`'s category gate refuses an ad-hoc flag without
one, S1.3's new BackLink is present, and the console was clean on every screen.

#### Defects

> **1. `A160` — the phone topbar overflows, measured.** Severity **major**, known and unfixed.
>
> The bar's content is **403px wide and does not respond to the viewport at all**. At 390px
> the `Log out` button (`.r3-topbar__action`) ends at **402.7px — a 12.7px overflow** — and it
> is already at the 44px tap floor, so it cannot shrink. At 320px the overflow is **83px**; at
> 195px (a 390px phone at 200% zoom) it is **208px**, and the 180px alerts chip overflows on
> its own as well.
>
> This is the number `phases-1-3.md §3.2` was waiting for. `flex-wrap: wrap` costs 44px of
> height and truncates nothing; ellipsizing the chip holds the bar at 56px and truncates text.
> **It is a design call and it is visible in any phone demo.**

> **2. The user's own name renders at zero width.** Severity **major**, new, same flex row.
>
> The username span has `flex-shrink: 1` and no `min-width`, so at 390px it collapses to
> **0px** — "Karen Diaz" is not truncated, it is *gone*. On a shared device the name in the
> bar is how you check whose session you are in before you touch anything. Worth fixing in
> the same change as `A160`, since it is the same starved row.

> **3. S1.4's availability day cells are under the tap floor.** Severity **major**, new.
>
> **38×44px with 4px gaps**, against `ui-ux-spec.md §1.2`'s 44×44 minimum and 8px separation.
> This is a calendar an older volunteer taps on a phone to say they are away, and a mis-tap
> books the wrong day.

> **4. PIN keypad digits are 62px wide.** Severity **minor**, new. The spec asks for ≥64px.

#### Open questions from this pass

1. The at-risk notification says "tomorrow" as static wording, while its own timestamp is
   same-day. One of the two is lying to the reader.
2. The search-empty state reads "No names match." — accurate, and it tells a volunteer who
   cannot find themselves nothing about what to do next.
3. A probable no-show fixture (Friday 07-31, Karen-owned, never started) was left untouched
   rather than mutate a run a later pass needs.

#### Untestable from Pass 1 {#untestable-1}

`A120`'s timezone rendering **cannot be distinguished here** — the test machine is already on
`America/Chicago`, so a device-zone bug and correct behaviour look identical. That needs a
machine on another zone and is on the human list. Also: real touch events, the clean
claim-success toast, and the 30-second "Still here?" prompt.

### Pass 2 — receiver, tablet landscape ([`pass-2.md`](qa-round-2/pass-2.md))

**What passed.** `A165` held exactly: `120.56` round-tripped through subtotal, stop total and
run total with no float drift, the six-whole-digit and two-place caps are both enforced, and
an explicit `0` is accepted end to end. `D7` holds — `receiveDone` is the only route to
`COMPLETED`. `I13`'s void-and-reinsert looks like an overwrite and totals correctly. The
driver-flagged Lakeview Deli prefill confirmed with donor, category, note and report toggle
all carried over. No forbidden microcopy, no sub-44px target, no overflow on S2.1b/S2.2/S2.3.

**`D9`'s pair confirmed from the browser too**, on the fifteen-day-old run: the edit is refused
with words that point at the Reporter, and `receiveDone` on that same run still succeeds.

And the dead-end sweep came back clean *within* the flows: every refusal — the I12 gate, the
window refusal, a generic error — carries a way out as a control, not just as advice.

#### The blocker

> **A RECEIVE-only volunteer cannot reach the receive screens on any current tablet.**
> Severity: **blocker**. Track B / Track E.
>
> `client/src/tokens/index.ts:82` sets `desktopMinPx: 1024`, so `useViewport`'s `classify()`
> calls anything ≥1024px a desktop. `homePathFor(receiver, 'desktop')` returns `/board` —
> intentional, and asserted in `shell.test.ts:196`. The desktop nav is the back office by
> design (`ui-ux-spec.md §4`), so it has **no Receive entry** — `nav.tsx:83-90` builds Admin,
> Schedule, Report, Board, My Shifts, Inbox and nothing else. AppShell's dead-end recovery
> button resolves through the same `homePathFor` and therefore also says "Go to the board".
>
> So above 1023px there is no path into `/receive` at all except typing the URL.
>
> **The reason this is a blocker and not a boundary quibble: the tablet band 768–1023 does
> not contain any current tablet in landscape.**
>
> | Device | Landscape CSS width | Classified |
> | :---- | :---- | :---- |
> | iPad 9.7" (and iPad 2 / Air 1–2 / 5th–6th gen) | **1024** | desktop |
> | iPad 10.2", 9th gen | 1080 | desktop |
> | iPad mini 6 | 1133 | desktop |
> | iPad Air 4–5 | 1180 | desktop |
> | iPad Pro 11" | 1194 | desktop |
> | iPad Pro 12.9" | 1366 | desktop |
>
> Only a tablet in **portrait** (768 wide) lands in the tablet band. Yet `ui-ux-spec.md`
> names "tablet **landscape**" as the device for S2.1b, S2.2, S2.2b and S2.3 — four times,
> explicitly — and the responsive matrix marks weight entry **canonical** there.
>
> This is not the code disagreeing with the spec. Every piece behaves as written and as
> unit-tested. It is a breakpoint chosen against a device population that does not exist,
> and the consequence is that the pantry's shared tablet, propped in a stand at the dock in
> the orientation the spec calls canonical, sends a receiving volunteer to a board with no
> way to the keypad.
>
> **The fix is a design decision, not a one-liner**, which is why it is reported rather than
> patched. At least three defensible answers: raise `desktopMinPx` above the tablet range;
> give `RECEIVE`-duty users a Receive entry in the desktop nav; or route the landing screen
> by duty rather than by width, which is arguably what "navigation is derived from what the
> user can do" (`§4`) meant in the first place.
>
> **Confirm before deciding: which tablet does AGFP actually have, and does it sit in
> landscape or portrait?** The answer does not change that this is broken, but it changes
> how loudly.

#### Also from Pass 2

> **The finish-run confirmation makes a promise it cannot keep.** Severity **minor**.
> "Finish this run?" always says *"You can still fix a weight afterwards"*. Once `D9`'s
> window has closed that is false for the receiver — only the Reporter can. Telling a
> volunteer they have a safety net they do not have is the kind of copy `test-plan.md` §12
> singles out as worse than no copy.

> **Save and Skip toasts sit over the bottom-left keypad keys for ~4s.** Severity **polish**,
> observational. Whether they actually block taps could not be confirmed from discrete
> screenshots — it is on the human list.

#### Untestable from Pass 2

**S2.4's truck-inbound banner could not be triggered at all** — no service worker is
registered in this dev environment, and a synthetic `ServiceWorkerContainer` message did not
reach it. The dispatch mechanism itself was sanity-checked and works, so this is either a real
gap or a dev-harness limitation and the pass could not tell which. Push is unverifiable in dev
by design (`A12`, `A76`), so **S2.4 remains completely unexercised** and needs the VAPID box.

An intermittent "Something went wrong" on cold navigation into S2.2/S2.3, always recoverable
via Try again, coincided with Vite HMR reconnect logs — flagged as a likely dev-server
artifact rather than filed. **Worth one look on the built container**, since the production
topology has no Vite at all.

### Pass 3 — staff scheduling, desktop ([`pass-3.md`](qa-round-2/pass-3.md))

**`D19` passed all four steps, including the one that mattered.** After changing a route's
default note and saving, a run already published from that route **kept its original note**.
That is `I25` holding and `D19` behaving as a default rather than a live link — the single
thing that would have made round 1's answer to "add a default note per route" wrong.

**`R4`'s scopes render genuinely different controls**, so the separation is real rather than
decorative: "This run" offers Note, Save, Set a driver, Take driver off, Move and Cancel;
"Every Tuesday" offers only "Edit the weekly pattern" and Done. `I23`/`I24` are not at risk.

Also confirmed: `TimeField` steps at 15 minutes on both S1.6 and S1.7, the end list excludes
anything at or before the start, Escape and outside-click close it, and Home/Enter/arrows all
work. `A111`'s computed "starting" date is read-only. Keyboard route reorder works via the
drag handle. The vocabulary is consistent — "Recurring runs", "Route templates", "Suggested
order for the driver", no stray "repeating". Sam, who has no `DRIVE` duty, is never offered
Claim, and can still coordinate — cap 4 is a staff capability, not a driving one.

#### Defects

> **1. The board's Edit deep link is inert.** Severity **major**. Round-1 item 9.
>
> `Board.tsx:255` navigates to `/schedule?edit=<shiftId>`. The URL updates. **The editor
> never opens** — on client navigation and on a fresh full page load alike. Clicking Edit on
> the same row inside S1.6 works, so only the query-param wiring is dead.
>
> Verified in source: **`useQuery()` is exported from `router.tsx:109` and consumed nowhere
> in the app.** S1.6 has an `edit` mode (`RunsPanel.tsx:39`) but nothing ever puts it there
> from the URL. Admin's tabs work because they read `useRouter().query` instead — a different
> path — which is why `?tab=` survives a reload and `?edit=` does nothing.
>
> So round 1 shipped both ends of this feature and no middle. It is a small fix, and it is
> the second half of "make Edit reachable from the main board", which was the whole ask.

> **2. The cancel-a-run modal uses "Cancel" for both meanings.** Severity **major**.
> `logic.ts:451-455`.
>
> "Cancel this run?" pairs a calm **Cancel** button with a destructive **Cancel the run**
> button. `ui-ux-spec.md §3`'s confirm contract wants the calm default to be a distinct word
> precisely when the destructive action is itself a cancellation — "Keep it" is the spec's
> own example. As shipped, the two buttons differ only by three trailing words, on a screen
> where one of them destroys a scheduled run.

#### Open question

One anomalous `End`-key result in `TimeField` appeared during a trial that mixed mouse-wheel
scrolling into a keyboard session, and **did not reproduce** across two clean keyboard-only
retests on either screen. Logged rather than filed.

#### Untestable from Pass 3

The assign-driver and reschedule **conflict-warning copy** was never reached: no driver in the
dataset had a declared-availability conflict against a run that was safe to edit, and creating
one needs a second login, which a single-session pass cannot have.

**This is exactly where the copy scan earns its place.** Three of the four surviving em dashes
live in `assignWarningMessage` — strings this pass could not make appear. A static scan and a
browser pass fail in opposite directions, which is why both ran.

### Pass 4 — admin back office, desktop ([`pass-4.md`](qa-round-2/pass-4.md))

**The photo path works, on the case that used to break it.** A 3200×2400 source JPEG of
318 KB uploaded cleanly and was **stored resized to 800×600, about 26 KB**, and survived a
fresh navigation. That is the `resizedPhotoDataUrl` canvas path doing its job and the raised
600 KB body limit doing its job — and a smaller test image would have sailed past the bug
round 1 found.

**`I21`'s two branches both confirmed, from one control.** A throwaway donor and a throwaway
user with no history were **hard-deleted** ("Nothing in R3 pointed at it"); a seeded donor
carrying weight history was **archived** ("off the pickup lists. Past runs still show it") and
kept a Deactivated chip. The user is never asked which should happen — the server decides,
which is the whole point of `I21`.

Also: the Admin tab really lives in the URL — `?tab=accounts` survives a reload rather than
bouncing to Metrics — `/metrics` redirects correctly, and the tablist has real roving
tabindex with arrows and Home/End.

**The mapping editor reads well.** Unmatched categories rise to the top with an orange "Not
matched yet" pill, matched ones show `NTFB · Storage` and sink below, so what is left to do is
visible without counting. The storage field has an explicit label and example wording.

#### Not a defect — the spec is stale

Pass 4 filed the account-creation tier picker as a minor defect: "Add someone" offers only
Volunteer and Staff, while "Edit account" offers all three, and `ui-ux-spec.md:228` says
creation assigns "tier (Volunteer/Staff/Admin)".

**The client is right and the spec line is wrong.** `server/src/services/user.ts:248` refuses
outright: *"Admin accounts are not created directly. Create the account, then raise its
tier."* The client mirrors an enforced server rule, and `dev-seed.ts` takes exactly those two
steps for the same reason. Under `CLAUDE.md`'s authority chain `ui-ux-spec.md` is the lowest
doc and loses.

> **Doc fix needed:** `ui-ux-spec.md:228` should say tier is Volunteer or Staff at creation,
> and Admin is reached by editing afterwards. Filed as a stale doc, not a code change.

#### The number that looked wrong, and wasn't

Pass 4 flagged that S3.1's current-week "Reported to NTFB" read 362.54 while `world.txt` said
305.25, and correctly declined to judge it.

**The screen is right.** Recomputed in SQL, bypassing `services/report.ts` entirely: the
current week really is 362.54 reported against 381.29 intake. Passes 2 and 3 legitimately
added weights and donations while testing them. The **closed week is still exactly 445.75**,
untouched, and that is the figure Pass 5 reconciles against.

The lesson is about method, not about the app: **a static baseline expires the moment a pass
starts writing.** Ground truth for the report has to be recomputed at the point of use, which
is what Pass 5 was given.

#### Fixture restored

Pass 4 left Riverside Market archived after testing `I21`'s history branch. It carries weight
in the closed week and an archived store reads differently on a report, so it was reactivated
before Pass 5 began.

### Pass 5 — the report and the metrics, desktop ([`pass-5.md`](qa-round-2/pass-5.md))

#### The reconciliation passed exactly

This is the check the pilot rests on. Closed week 2026-07-20:

| Source | Figure |
| :---- | :---- |
| SQL union, computed without `services/report.ts` | **445.75** |
| S3.1 week total | **445.75** |
| S3.2 period total, same range | **445.75** |
| Worksheet `Receipt Total (lb)`, summed | **445.75** |
| (a fifth) `metrics-intake` CSV | **445.75** |

And all three of `phases-1-3.md §1`'s named failure modes were **empirically excluded**, not
merely assumed absent:

- **A `shift`-filtered join** would drop every walk-in. Walk-ins are present — the current
  week reads 381.29 intake against 302.54 for weights alone.
- **`created_at` bucketing** would collapse everything into one day. Every seeded row carries
  `created_at = 2026-08-02` and yet the weeks bucket correctly by `report_day`.
- **Float summation** would drift. Every figure is exact to two places.

**The voided 999.00 lb leaked nowhere** — absent from the week total, from the Produce line,
from the drill-in, from the CSV, and from S3.2's Northside row, while still sitting on disk.
`I13` intact.

**CSV and print refuse identically** — the same endpoint one `format=` apart, byte-identical
409s, and when blocked the screen renders neither button. The worksheet's grain and sort are
right: one row per line item, **day → donor → category** receipt order, receipt totals
repeated on every row, agency line `026357P` / North Texas Food Bank (24).

**A correction to my own instruction, worth recording.** I told Pass 5 to unmap `Frz Non Meat`
to reproduce the refusal, following Pass 4's suggestion. It carries **no weight anywhere**, so
unmapping it correctly leaves the export enabled — the toast even says "while it carries
weight". The pass noticed, unmapped `Produce` (120.50 lb) instead, exercised the refusal
properly, and restored all eleven mappings. Two passes and I both had the wrong category; the
screen was right about its own rule.

#### Defects

> **1. A Reporter correction leaves the drill-in showing the wrong list.** Severity **major**.
> `services/report.ts:490`.
>
> `reviseReportedWeight` returns `reportEntries(anchor)` **unfiltered**, so after correcting
> one weight the Bakery panel listed four entries drawn from three categories, under a
> "Bakery 130.25" header, with a footer claiming they "add up to 450.75". It self-heals on
> reload and neither the export nor the stored totals are affected — but the screen a Reporter
> is looking at while correcting a number is showing them somebody else's numbers.

> **2. The drill-in footer sums intake under a reported row.** Severity **major**.
> A Bakery row of 57.29 sits above a footer of 60.29, and nothing on screen explains the
> 3.00. Two numbers `domain-modeling.md §6` is locked around being silently mixed in the one
> place a Reporter goes to check a figure they doubt.

> **3. The blocked-export banner drops the number the server sent.** Severity **minor**.
> The server supplies the unmapped weight (`total: "120.50"`); the banner does not show it. So
> the totals card says 445.75 while the visible rows sum to 325.25, with nothing accounting
> for the gap — which is the "lost-sheet misreporting" shape Success Metric 4 exists to kill,
> appearing in the very screen built to prevent it.

> **4. `report.css`'s print rule is global and outlives the screen.** Severity **minor**,
> and I verified this one directly.
>
> `report.css:372` sets `body * { visibility: hidden }` under `@media print`. The file is
> imported as `import './report.css'` in `ReportScreen.tsx:68`, and an ESM CSS import is
> injected once and **never removed**. So once anyone opens S3.1 in a session, pressing Ctrl-P
> on *any* other screen — Admin, the board, a shift detail — prints a blank page, because
> nothing there carries `.s31-print`.
>
> The CSS comment explains the tradeoff honestly ("this file must not know the shell's class
> names, and the shell is not this lane's to edit"). The consequence was simply not foreseen.
> For a paper-first pantry, someone trying to print the board is not a far-fetched scenario.

> **5. Three copy defects.** Severity **minor**. "1 category **have** no food bank category
> yet" (agreement); "Never the same figure as the reported one" printed directly under two
> **identical** figures (445.75 / 445.75), which reads as the screen contradicting itself; and
> Export/Print are offered on a week with nothing in it.

#### Open questions from Pass 5

1. "Logged by" becomes the **Reporter** after a correction. That is `I26`-correct — the
   Reporter did log the new row — but it means the receiver's name silently disappears from
   the record of who weighed the food.
2. Unmatching a category **discards the Storage value already typed**, with no warning.
3. An "Unattributed" 0 lb row appears in the drill-in with no explanation.
4. The screen trims trailing zeros where the CSV does not, so `120.5` and `120.50` refer to
   the same weight in two places.
5. **Nothing records that a week was exported.** A Reporter interrupted mid-typing has no way
   to tell later whether they finished.

---

## 4. Coverage — exit criterion 2

Every screen × role cell, dated 2026-08-02. "Blocked" always carries its reason.

| Screen | Covered by | Verdict |
| :---- | :---- | :---- |
| S1.1 login | Pass 1, phone | pass |
| S1.2 board | Pass 1 phone, Pass 3 staff desktop | pass |
| S1.3 shift detail | Pass 1, phone | pass |
| S1.4 my shifts / availability | Pass 1, phone | **fail** — tap targets |
| S1.5 pickup execution | Pass 1, phone | pass |
| S1.6 schedule | Pass 3, desktop | **fail** — deep link, confirm copy |
| S1.7 reschedule | Pass 3, desktop | pass |
| S1.8 admin, six tabs | Pass 4, desktop | pass |
| S1.9 inbox | Pass 1, phone | pass |
| S2.1b run picker | Pass 2, tablet | pass |
| S2.2 weight entry | Pass 2, tablet | pass |
| S2.2b receive done | Pass 2, tablet | pass |
| S2.3 unscheduled donation | Pass 2, tablet | pass |
| **S2.4 truck banner** | — | **BLOCKED** — no service worker registers in dev; push is unverifiable without VAPID by design (`A12`, `A76`) |
| S3.1 report | Pass 5, desktop | **fail** — drill-in defects |
| S3.2 metrics | Pass 5, desktop | pass |
| Reaching the receive surface at all | Pass 2 | **BLOCKER** |
| Every API route × 7 personas | Lane B | pass, 672/672 |

**Negative access** — Lane B covered this exhaustively at the HTTP layer, which is where it
counts. What was *not* covered is the UI half for a `RECEIVE`-only or no-duty user: Pass 5 ran
out of sign-ins before it could open the app as `priyashah` or `ninatorres`.

---

## 5. Uncertain — please double-check these

Where an agent or I could not confidently call something. I would rather over-report here than
have you trust a wrong pass.

1. **Which tablet does AGFP actually own, and does it sit in landscape?** It does not change
   that the receive surface is unreachable above 1023px, but it decides how urgent that is.
2. **Whether toasts actually block the keypad keys they cover.** Visually they overlap for
   ~4s; discrete screenshots cannot prove a tap is swallowed. One finger will settle it.
3. **The intermittent "Something went wrong" on cold navigation into S2.2/S2.3.** It coincided
   with Vite HMR reconnect logs and always recovered on Try again. Probably a dev-server
   artifact — but the production topology has no Vite, so it deserves one look on the
   container rather than a shrug.
4. **One anomalous `End`-key result in `TimeField`** that would not reproduce on two clean
   retests. Logged, not filed.
5. **`A120`'s pre-session fallback.** The mechanism is sound — I confirmed
   `app_config.timezone` reaches `SessionResponse.timezone` end to end by flipping the pantry
   to `Pacific/Auckland` and back. But `clockTime(instant, timeZone?)` falls back to the
   **device** zone while the session is still loading, so on a device in another zone the
   first paint can show the wrong time. Invisible on a machine already on `America/Chicago`,
   which is every machine that has tested this so far.
6. **The at-risk notification says "tomorrow"** as static wording while its own timestamp is
   same-day. One of the two is wrong and I could not tell which is intended.
7. **"Logged by" becoming the Reporter after a correction** — defensible under `I26`, but it
   erases the receiver from the record. A judgement call, not a bug.

---

## 6. Yours to test — what automation could not reach

Ranked by how much it would hurt to discover during the demo. Roughly **two hours in total**,
against the ten-track plan this replaces most of.

| # | What | Why no machine could do it | Time |
| :---- | :---- | :---- | :---- |
| 1 | **Get the NTFB category list from the pantry** | Not a test. `D12` — those names are theirs to give, and everything in this app's reason for existing is downstream of them. **Blocks export, blocks pilot.** | A phone call |
| 2 | **Which tablet, and which orientation** | Decides the severity of the one blocker | A question |
| 3 | **Print → Save as PDF, actually rendered** | `window.print()` opens a native dialog that would freeze the extension. Every pass verified the print *content* and none saw the page | 2 min |
| 4 | **Ctrl-P on a non-report screen** after visiting the report | Confirm defect 4 above the way a user would meet it | 1 min |
| 5 | **A real phone**: touch reorder (`A151`), gloved taps, the iOS keyboard over the sign-in search | No touch, no device sensors | 15 min |
| 6 | **Whether a toast swallows a keypad tap** | Needs a finger | 2 min |
| 7 | **PWA install and the home-screen icon** (`A158`) | The install prompt is browser chrome | 10 min |
| 8 | **S2.4 truck-inbound, end to end** | No service worker registers in dev and VAPID is unset by design. **This screen has never been exercised by anyone** | Needs the deployed box |
| 9 | **The shared tablet at the dock, at its real angle** | An iframe is a faithful layout test and nothing more | 20 min |
| 10 | **Screen reader** on claim-a-run and weigh-a-load | Not drivable from the extension | 30 min |
| 11 | **The 30-day volunteer session** and "Still here?" | Real elapsed time — and exactly where `IdlePrompt` broke once | 5 min |
| 12 | **Copy judgement** (`test-plan.md` §12) | The forbidden words are enforced and the em dashes are found. Whether these are the *right* words is not a machine question | An hour |
| 13 | **The native file picker, clicked once** | The sweep injected the `File` directly, so the picker itself is untested | 1 min |
| 14 | **Path traversal with a raw socket** | `fetch` normalises `..` before it leaves the process | 5 min |

Items 3, 4, 6 and 13 total about six minutes and close four of the newest changes.

---

## 7. What this round did not touch

Named so nobody mistakes silence for coverage.

- **Ops rehearsal** (`test-plan.md` §9) — Docker, fresh-box boot, `rehearse-migration.sh`,
  `backup.sh` **and a restore**. Exit criterion 4 is still open, and "a backup nobody has
  restored is not a backup" still stands. This belongs after dockerizing.
- **The security pass** (§10) — throttle behaviour, cookie flags under `NODE_ENV=production`,
  session lifetimes. Lane B covered authorization thoroughly; it did not cover authentication
  hardening.
- **Accessibility** (§11) beyond keyboard traversal and tap-target measurement.
- **Two humans on two devices at once.** Lane B raced two HTTP clients, which is a real test of
  `SERIALIZABLE` and a poor substitute for two people.

---

## 8. Where the exit criteria stand

`test-plan.md` §13, honestly marked.

| # | Criterion | State |
| :---- | :---- | :---- |
| 1 | Track A end to end, twice, three people three devices, totals reconciling | **partial** — the totals reconcile exactly, by one agent on one machine |
| 2 | Every Track B cell pass or explicitly blocked | **met** — see §4, two blocked with reasons |
| 3 | Tracks C and D: no data loss, no silently-wrong number | **met** — no lost or duplicated write, no wrong total |
| 4 | A restored backup and a written resource sizing | **not started** |
| 5 | `A160` decided | **ready to decide** — measured at 390/320/195px |
| 6 | NTFB mapping real or labelled placeholder | **open** — placeholders are in `r3_dev` only and named `PLACEHOLDER …` |
| 7 | Gate green at more than one time of day | **green at 12:12 and again at 18:40 CDT**, 2026-08-02, all 8 checks |
| 8 | `doc-qa` clean on anything this changed | pending — one stale doc line already known (§Pass 4) |

**Report-only held.** `git status` at the end of the round shows exactly three untracked
entries and no modifications: `scripts/qa-world.ts`, `docs/features/qa-round-2/`, and this
file. Nothing in `client/`, `server/` or `shared/` was touched, so none of the defects above
can be an artefact of the testing.

---

## 9. If you fix only four things

1. **The receive surface being unreachable above 1023px.** It is the only finding that stops a
   core task on the device it was designed for.
2. **The two drill-in defects** (`report.ts:490` and the intake/reported footer). Both put a
   wrong number in front of the one person whose job is checking numbers.
3. **`A160` and the zero-width username**, together, since they are the same starved flex row —
   and the measurements to decide with are now in hand.
4. **S1.4's 38×44 tap targets.** An older volunteer tapping the wrong day on a calendar is the
   failure this whole system is supposed to remove, not introduce.

Everything else is copy, polish, or a decision rather than a bug.


