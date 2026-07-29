# Wave 4a — s1-4-my-shifts

**Status:** complete

**Built:**
- `S1.4 My shifts + availability` as a two-tab screen ("My runs", "When I'm away"), exported as
  `MyShiftsScreen` matching `AppShell`'s `ScreenProps` contract, from an `index.ts` barrel. Not
  wired into `main.tsx` — that seam is the lead's.
- "My runs": this driver's runs from `GET /api/shifts?mine=true`, split into **Coming up** and
  **Earlier** on the run's end instant, each row a full-width target opening S1.3
  (`/shifts/:shiftId`), with the ownership-overlay `Mine` chip (§3).
- "When I'm away": the declared blocks from `GET /api/availability`, same past/future split, each
  with a **Remove** that goes through the destructive-confirm modal (§6) to
  `DELETE /api/availability/:id`.
- The declaration form: a month grid of big day targets (two taps make a range), an
  **All day / Part of the day** choice mapping to `DATES` / `WINDOW`, half-hour time buttons for a
  window, a read-back sentence, and one primary **Save time away** posting
  `POST /api/availability` as `YYYY-MM-DD` + `HH:MM` — never an instant.
- The refusal path: a 409 `AVAILABILITY_CONFLICT` renders the **server's own sentence** inline,
  which is how S1.4's two different refusals (releasable vs already in progress) stay in step with
  `services/availability.ts` instead of being re-derived here.
- Loading / empty / error states for both lists (§3, §6), a screen-local stylesheet built from
  tokens only, and 32 pure-logic tests.

**Files:** (all inside this lane's declared ownership, `client/src/screens/s1-rescue/s1-4-my-shifts/**`,
plus this report)
- `client/src/screens/s1-rescue/s1-4-my-shifts/index.ts`
- `client/src/screens/s1-rescue/s1-4-my-shifts/MyShiftsScreen.tsx`
- `client/src/screens/s1-rescue/s1-4-my-shifts/RunsPanel.tsx`
- `client/src/screens/s1-rescue/s1-4-my-shifts/AwayPanel.tsx`
- `client/src/screens/s1-rescue/s1-4-my-shifts/AwayForm.tsx`
- `client/src/screens/s1-rescue/s1-4-my-shifts/DayRangePicker.tsx`
- `client/src/screens/s1-rescue/s1-4-my-shifts/Tabs.tsx`
- `client/src/screens/s1-rescue/s1-4-my-shifts/data.ts`
- `client/src/screens/s1-rescue/s1-4-my-shifts/logic.ts`
- `client/src/screens/s1-rescue/s1-4-my-shifts/my-shifts.css`
- `client/src/screens/s1-rescue/s1-4-my-shifts/my-shifts.test.ts`
- `reports/4a-s1-4-my-shifts.md`

Nothing under `server/`, `shared/`, `client/src/app/`, `client/src/components/`, `client/src/api/`,
`client/src/tokens/`, `client/src/pwa/`, `client/src/main.tsx` or any other screen folder was
touched. No dependency was added.

**Invariants:** none is *enforced* here — this is a browser screen, and every rule below is enforced
again server-side (`architecture.md §4.5`). What the screen does is **communicate** them, and each
citation sits in a code comment at the point it shows up:
- **I20** (declaration gate, `domain-modeling.md §5.2`) — tier 3 / service
  (`services/availability.ts`, inside `writeTransaction`). The screen posts the whole declaration,
  and on 409 renders the server's message inline; it never decides for itself which of S1.4's two
  sentences applies, because only the server knows whether the conflicting run is releasable (I9).
- **I19** (availability is whole-person, time-scoped only) — tier 3, and visible here as an
  *absence*: the form offers no route field, and the copy says the block applies across runs.
- **I2** (duty is set membership) — the route declares `anyDuty: ['DRIVE']` in `app/routes.ts` and
  the server declares the same on `POST`/`DELETE /api/availability`; the screen adds nothing.
- **I11 / build-plan D1** (no `COMPLETED` in Phase 1) — the runs list has no "close run" action, and
  `groupRuns` splits on the run's **end instant**, never on status, so a permanently `IN_PROGRESS`
  run whose window has passed lands in *Earlier* as expected rather than looking stuck. A test
  asserts exactly that.
- **A58** (a `WINDOW` declaration is one row per date) — the list shows one row per stored block and
  `Remove` withdraws that row only; merging them would offer a Remove that deletes rows the driver
  was never shown.

**Tests:** 32 passing / 0 failing — `npx vitest run --root client src/screens/s1-rescue/s1-4-my-shifts`
(82 passing / 0 failing for the whole client suite, `npx vitest run --root client`).

`./scripts/test-db.sh` then `./scripts/gate.sh`: green — migrations, both typechecks, client suite,
server suite (500 passing), no stubs, no `@r3/shared` imports, `db/types.ts` unchanged.

`doc-qa` — **not run by this lane, and it could not be**: the Agent tool is not available inside a
subagent, so the skill has nothing to spawn. Gate part 2 is the lead's over the merged diff anyway
(§5.2). What I could check by hand I did: §7's forbidden-word list against every user-visible string
(and one test asserts it), §2's token discipline (no literal hex in the stylesheet; the only literal
lengths are the 1px border and the 4px accent bar `components.css` already uses), §1's one-primary-
action rule per tab, and §3's "every list defines empty, loading and error".

**One caveat the lead should know about, and it is not mine to fix.** The first gate run of this
lane went red on **two server tests I did not write and cannot touch**
(`server/test/recurrence-materialization.test.ts`, "a pattern-level edit is the one thing that does
change it (I24)" and "moves the future UNCLAIMED instances onto a new window"). They are
**wall-clock dependent**, not broken by this lane — my diff is client-only and `server/` is
byte-identical to the base commit. Diagnosis, so it costs nobody a second afternoon:

> The fixture pattern is `09:00–11:00` and the edit moves it to `13:00–15:00`.
> `materializeIn` filters occurrences with `window.startsAt >= now` (`services/recurrence.ts:266`),
> so between **09:00 and 13:00 pantry-local** today's occurrence is skipped at the first
> materialization and then *minted* by the edit's re-materialization. Both tests then do
> `before.find((row) => row.id === instance.id)!` over the post-edit rows and hit the new one, which
> is `undefined` — `TypeError: Cannot read properties of undefined`. Outside that window both passes
> are consistent and the tests are green. The service is behaving correctly per §5.3; the fixture's
> absolute times are the bug. Pinning `now` in those two tests, or choosing fixture times relative
> to the current clock, fixes it.

**Deliberately not done:**
- **No component-render tests.** There is no browser test harness in the repo (no jsdom, no
  renderer) and adding one is a dependency — build-plan §3/D5. Every rule that could be separated
  from JSX lives in `logic.ts` and is tested there; the JSX itself is covered by typecheck only.
- **No Release action.** S1.3 owns **Release run** and its "just this one, or this and future?"
  prompt; a second entry point would be a second confirm dialog to keep in step with it. Rows here
  open S1.3 instead. `POST /api/shifts/:id/release` is therefore called from nowhere in this lane.
- **No pre-save conflict preview.** `declarationConflicts()` is exported by the service "so a screen
  can preview the refusal", but no HTTP route exposes it and adding one is server work outside this
  lane. S1.4's "Save is blocked with an inline error" is honoured by the round trip: the server
  refuses the whole declaration, nothing is written, and its sentence renders inline.
- **No "repeats weekly" tag** on a run row. That is S1.2's edge case, and `recurrencePatternId` is
  on the payload if a later wave wants it here.
- **No conflict-flag banner** for `assignedOverConflict`. S1.3 owns that banner ("This run conflicts
  with your declared availability…"); duplicating it on a list row would state the same fact twice
  with less room to explain it.
- **The two Wave-3 server tests above.** `server/test/` is not this lane's to edit.

**Assumed:** (the spec fixes the two tabs, the entry shapes, the two inline errors and one
explanatory sentence; everything below it left open — all copy is mine unless marked verbatim)

*Interaction the spec did not specify*
1. **The day picker is a month grid of big day targets, and a range is two taps** — first tap sets
   both ends, second extends the side it lands on, third starts over. §1.5 rules out dropdowns and
   multi-step pickers and a native date field is both; §1.4 asks for recognition, and a visible month
   is what a driver going away next week can actually see.
2. **Days before today are not offered**, even though the server accepts a past-dated block (A60):
   a run in the past cannot be filled either way, so there is nothing left for such a block to
   affect. Months before the current one are likewise not reachable; forward months are unbounded.
3. **The week starts on Sunday** and weekday/month names are English three-letter abbreviations
   rendered from a local table, not `Intl` — a calendar day is a calendar fact here and must not
   pick up the device's locale or zone.
4. **Time is chosen from half-hour buttons between 05:00 and 22:00.** A finer grid is a fragile
   control and a coarser one cannot express a 9:30 run. **"Until" offers only times later in the
   same day than "From"**, and picking a "From" at or after the current "Until" clears the latter —
   A57 makes a `WINDOW` intra-day, and §3 prefers hiding an option to disabling it.
5. **"All day" ⇒ `DATES`, "Part of the day" ⇒ `WINDOW`.** Switching to All day clears both times, so
   a stale time can never ride along on a request the server would refuse.
6. **No client-side limit on how many days one declaration spans.** `app_config.horizon_days` is the
   server's (A59) and the browser cannot read it; guessing 365 here would put a number on screen
   that could be wrong. The server's own 400 sentence is what shows.
7. **Tab state is component-local**, not a URL param — `app/routes.ts` gives `/my-shifts` no
   segment and that file is not this lane's. A deep link always opens on "My runs".
8. **Past/future split is on the run's END instant** (a run happening right now is still "Coming
   up"), upcoming ascending, past descending. Same rule for availability blocks: one you are inside
   of is still in force.
9. **The runs list is unbounded in time** — `?mine=true` with no `from`/`to`. A driver with two
   years of history gets two years of rows; no doc bounds it and the server offers no default.
10. **Withdrawal failures show as a toast, saving failures show inline.** The save has a field to sit
    under; a Remove does not.
11. **The whole-day / windowed distinction is inferred from the row**, since the API returns instants
    and not the kind that was declared: a block starting and ending at local midnight renders as
    "All day", and because `endsAt` is exclusive the last day named is `endsAt − 1 day`.

*Time zone — the one that could actually be wrong in the field*
12. **Instants are rendered in the DEVICE's zone.** No endpoint exposes `app_config.timezone`, and
    inventing one is server work outside this lane. For the ordinary case — a driver's phone standing
    in the pantry's zone — what is shown is exactly what the server stored. A driver in another zone
    sees their own clock for the *times*, and a `DATES` block will lose its "All day" wording. Run
    **dates** cannot drift either way, because they are rendered from `occurrenceDate`, the
    pantry-local calendar slot, and never from the instant. If this matters, the fix is one field on
    an existing response, not a change here.

*Copy I authored (verbatim, so the human can veto a sentence rather than a paraphrase)*
13. Screen heading **"My shifts"** — matching the nav item that leads here (`app/nav.tsx`), so the
    heading confirms where the tap landed. Tabs are S1.4's own: "My runs", "When I'm away".
14. Runs empty state: **"You're not on any runs yet."** / **"Open runs are on the board — take one
    from there."** with a **"See open runs"** button to S1.2. Same body under **"Nothing coming
    up."** when only past runs exist. Group headings **"Coming up"** and **"Earlier"**.
15. Away tab: the explanation is S1.4's, **verbatim** ("Telling us you're away helps the coordinator
    fill runs. It won't release runs you already own — you'll need to release those yourself
    first."). Empty state: **"You haven't marked any time away."** / **"Add the days or hours you
    can't drive, below."**
16. Form: **"When are you away?"**, **"Tap a day. Tap a second day to cover everything in
    between."**, **"How much of the day?"**, **"All day"** / **"Part of the day"**, **"From"** /
    **"Until"**, **"The same hours on every day you picked. For an overnight absence, use All
    day."** Primary action **"Save time away"** — S1.4 words it "Save availability", which names the
    action rather than the label; this matches the tab's plainer vocabulary (§7).
17. Read-back sentences: **"You'll be away all day on Tue, Aug 4."** / **"You'll be away all day,
    Tue, Aug 4 to Fri, Aug 7."** / **"You'll be away 9:00 AM – 12:00 PM on Tue, Aug 4."** / **"…on
    every day from Tue, Aug 4 to Thu, Aug 6."**
18. Client-side validation (communication only, nothing relaxed): **"Pick the days you'll be
    away."**, **"Pick a start time and an end time."**, **"The end time has to be later in the day
    than the start time."**
19. Save toast **"Saved — the coordinator can see it."** — declaring notifies Staff (A63), which the
    driver is entitled to know. Remove confirm: **"Remove this time away?"** / *(the block's own
    label)* + **"Runs in that window can be offered to you again."** / **"Remove"**. Removal toast
    **"Removed — you're available then again."** Neither says a notification went out, because
    withdrawal sends none (A64).

*Shape and styling*
20. **A local `Tabs` component** (`Tabs.tsx`) — `components/` has no tab or segmented control and is
    another owner's file. Built inside this folder per the wave rule. **S1.2 needs a segmented
    control too ("All · Open · Mine")**; if that lane also built one, these two are the signal to
    promote a shared one.
21. **CSS is screen-local with an `s14-` prefix**, tokens only, no literal hex. Selected/active state
    is an orange bar plus a paper tint, never an orange fill behind a label — §2's hard rule
    (orange is 2.9:1 and never carries text).
22. **Layout is CSS-only, capped at 42rem**; `useViewport` is not consulted. The responsive matrix
    makes this screen canonical on the phone and merely *usable* on tablet and desktop, which one
    max-width column satisfies without a second layout to keep in step.
23. **Loading shows nothing for 300ms, then skeleton rows** (§6, via `useAsyncData().showLoading`) —
    including the case where data has not arrived but the delay has not elapsed, which renders
    nothing rather than flashing an empty state.

**Unblocked:**
- The lead can wire `SCREENS['my-shifts'] = MyShiftsScreen` in `client/src/main.tsx` from
  `screens/s1-rescue/s1-4-my-shifts/index.ts`; nothing else is needed to make `/my-shifts` reachable.
- Wave 4b's **S1.3** is the destination of every row on this screen and the home of **Release run**;
  until it lands, a row tap reaches `AppShell`'s placeholder. Nothing here needs changing when it
  does.
- If the lead wants a pre-save conflict preview or "All day" wording that survives a driver in
  another timezone, both are single-endpoint server additions (`declarationConflicts()` already
  exists; `app_config.timezone` already exists) and this screen consumes them without a rewrite.
