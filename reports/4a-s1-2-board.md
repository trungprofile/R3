# Wave 4a — s1-2-board

**Status:** complete

> **Gate note, read this first.** `./scripts/gate.sh` exits 1 in this worktree, on a
> failure I do not own and did not introduce: two tests in
> `server/test/recurrence-materialization.test.ts` (the Wave-3 schedule lane's file)
> are **time-of-day dependent** and fail on any run started between 09:00 and 13:00
> local. Full diagnosis and the fix under *Deliberately not done*. Seven of the
> gate's eight steps are green, including both client steps. My diff is client-only
> (`git diff 1c09255..HEAD --name-only` lists nothing outside my lane's folder), and
> `vitest --root server` never loads a client source, so the two are causally
> unrelated. A sibling worktree (`agent-a2aabbb6c854a3d9d`) hit the byte-identical
> failure at the same time, which places the defect on `phase-1` at `1c09255`.

**Built:**
- `BoardScreen` — S1.2, the app's home screen at `/board`: one vertical list of big rows grouped by day, open runs floated to the top of each day, one action (Claim) on the rows that have no owner.
- Segmented `All · Open · Mine` filter, applied through the server's own `?open=`/`?mine=` query parameters rather than sieved client-side.
- Row states, all six: Open (orange chip + Claim), Mine (success chip, opens S1.3), Claimed-by-other (muted + owner name, no action), In progress (no action), Done (muted, read-only — **built, styled, unexercised** per D1), At-risk (warning chip, staff view only).
- Optimistic claim (§6): the tapped row re-renders as the viewer's before the server answers, and reverts with the server's own sentence on a lost race.
- Repeating-run scope prompt — S1.2's "Claim every Tuesday run, or just this one?" — offered only when `recurrencePatternId` is non-null, mapping to the server's `ONE`/`SERIES` scopes.
- Partial-success feedback: the server's `summary` as a toast **and** a persistent card that survives the toast's 4s, with a "See which dates" modal listing each skipped run and why.
- Empty / loading / error states, one per filter, per §3's "every list defines all three".
- `Segmented` — a segmented control, built locally because §3 has no contract for one (see `Assumed:`).

**Files:**
- `client/src/screens/s1-rescue/s1-2-board/Board.tsx` (new)
- `client/src/screens/s1-rescue/s1-2-board/Segmented.tsx` (new)
- `client/src/screens/s1-rescue/s1-2-board/board.ts` (new — every rule and every sentence of copy)
- `client/src/screens/s1-rescue/s1-2-board/api.ts` (new)
- `client/src/screens/s1-rescue/s1-2-board/board.css` (new)
- `client/src/screens/s1-rescue/s1-2-board/board.test.ts` (new)
- `client/src/screens/s1-rescue/s1-2-board/index.ts` (new — the barrel exporting `BoardScreen`)

Nothing outside this folder is touched. `client/src/main.tsx` is untouched as instructed: the screen is exported as `BoardScreen` from the barrel and awaits the lead's `board: BoardScreen` registry line.

**Invariants:**
- **I7** — derived at read time, never stored. At-risk is computed from `status === 'OPEN'` and `startsAt` against a 24h lead, not read off the wire, because there is no such column and there must not be. `AT_RISK_LEAD_MS` mirrors `services/coverage.ts`'s constant so the chip and the sweep that alerts on it cannot drift.
- **I1 / I2** — tier is hierarchical, duty is set membership, and the board needs both kept apart: the at-risk chip is gated on `atLeastTier(user, 'STAFF')` (Admin passes without being named), while the Claim button is gated on `hasDuty(user, 'DRIVE')` (a Staff coordinator who does not drive is offered no Claim, matching the server's `anyDuty: ['DRIVE']`).
- **I20** — repeated for communication only. The client never evaluates eligibility; it renders the server's refusal verbatim and, for a series claim, renders which runs I20's gate skipped rather than implying they were taken.
- **I23 / I24** — the `SERIES` scope is offered only on a run minted from a pattern, because claim-all is §5.3's named pattern-level exception; the client makes the choice available and the server makes the change.
- **I10 / I11** — cancelled runs are off the board (the server excludes them by default) and there is no action anywhere on this screen that transitions anything to `COMPLETED`.

All of these are **tier 3 or lower and enforced server-side**. Nothing on this screen is an enforcement point: `architecture.md §4.5` makes the client's copy of a rule communication, so a volunteer is not offered a button that would be refused, and the refusal on `POST /shifts/:id/claim` is the rule itself.

**Tests:** 31 passing / 0 failing — `npx vitest run --root client client/src/screens`
(whole client suite: 81 passing / 0 failing — `npx vitest run --root client`)

Covers the day grouping and its ascending order, "open floats to the top", the start-time-then-route tiebreak, the ownership overlay, the repeating tag, the at-risk derivation from both sides of its 24h boundary and its staff-only gate, the action each of the six row states offers, the optimistic overlay's immutability, the skipped-run reasons, and every sentence of copy against §7's forbidden-word list.

**Deliberately not done:**
- **The inherited gate failure — not mine to fix, and the lead needs it.** `server/test/recurrence-materialization.test.ts` fails two tests on any run between 09:00 and 13:00 local. Mechanism: the fixture pattern is `09:00–11:00` on `EVERY_DAY`; both tests then edit it to `13:00–15:00`. `materializeIn` mints occurrences over `[now, horizon]` and documents that "an occurrence whose window has already begun is not minted", and `updatePattern` re-materializes after the edit. So after 09:00 today's original slot is past and absent from `before`, while today's *new* 13:00 slot is still future and gets minted into `after` — leaving a row in `after` that `before.find(...)` cannot match, hence `TypeError: Cannot read properties of undefined (reading 'starts_at')` at line 502 (and the same mechanism at line 481). **The service is correct**; §5.3's loop is exactly what it implements. The test is what assumes a window edit cannot change the instance set. It is `server/test/`, owned by the schedule lane, and my brief forbids me touching another lane's files — so I diagnosed it and left it. It gated green in this same worktree at 07:46 and red at 12:58 on an unchanged tree, which is the clock and nothing else.
- **No rendering tests.** There is no jsdom and no component renderer in the repo, and adding one is a dependency (§3/D5). So `board.ts` holds every rule and is fully covered; `Board.tsx` holds only wiring and is covered by typecheck alone. Untested by machine: that the optimistic row actually repaints, that the modals trap focus, and the CSS.
- **No "close run" action**, no auto-complete, no path to `COMPLETED` (D1). The Done state is built and styled and cannot be reached in Phase 1.
- **No release from the board.** S1.3 owns Release run; S1.2's only action is Claim.
- **No staff assign/unassign, no reschedule entry point.** Those are S1.6/S1.7 and belong to Wave 4b.
- **No polling or live refresh.** The board reloads on filter change and after a claim. Nothing in the spec asks for a live board, and §6 makes retry a user-initiated affordance.

**Assumed:**
- **Row element order.** S1.2 lists a row's contents as "date/time, route name, truck, owner name (or 'OPEN'), status chip" but does not fix their visual order. The date is the day heading above the row; the row is route name (title), time range (subtitle), then owner / truck / "repeats weekly" (meta), with the chip in the right-hand slot. Route name is the title because §1 principle 4 is recognition, and the route is what a driver recognises.
- **An open row is not itself tappable.** S1.2 gives an open row one action, Claim, and a `<button>` cannot legally nest inside the `ListRow` button. So open rows are static rows carrying a Claim button; only Mine rows (and staff, below) open S1.3.
- **Staff may open any row into S1.3.** S1.3 names "owner (phone), staff (desktop)" as its two users, and no other screen routes there, so the board is staff's only way in. S1.2 literally says only a Mine row opens S1.3; I read staff's access as the more specific statement. Navigation only — the server gates the screen.
- **The board is bounded to today forward.** It sends `?from=<today>` and no `to`. S1.2 says "see every shift" without stating a window; an unbounded board would accumulate every past run forever. `to` is omitted because the horizon already bounds materialization.
- **Today's date is the device's.** `?from=` is built from the browser's local date, and the time range on each row is formatted in the device's own timezone with the `en-US` locale. The client is not given `app_config.timezone` and is explicitly forbidden from converting pantry-local values; the day *grouping* therefore uses the server-resolved `occurrenceDate` and never `startsAt`, so grouping cannot drift. Only the fetch bound and the displayed wall clock use the device, and every user of this pantry is in its timezone.
- **A segmented control is built inside my folder.** §3 has no contract for one and S1.2 asks for one by name. It is a row of ≥44px buttons with `aria-pressed`, orange fill on the selected item per §2's "accent … selected bar". If §3 later grows one, this is the thing to delete.
- **One primary-variant Claim button per open row.** §1 principle 1 wants exactly one high-emphasis button per screen; S1.2 makes Claim *the* primary action, and it repeats once per open row. I read the repeated button as one action rather than competing ones, and there is no other primary on the screen.
- **The scope prompt has three buttons, not two.** §3's modal contract is "one question, two buttons", but S1.2's question is a two-way choice, so it renders Cancel (the calm default §6 requires) plus "Just this one" and "Every Tuesday".
- **The weekday in the prompt comes from the tapped run's own date.** A pattern repeating on several weekdays would make "Claim every Tuesday run" narrower than what `SERIES` actually does; the server's `summary` afterwards uses `weekdayLabel` over the real weekday set, so the outcome is always stated accurately even when the prompt named one day.
- **Copy I wrote** (everything else on the screen is either verbatim from S1.2/§6 or rendered from the server's own `summary`/`message`):
  - `The coordinator adds runs here as they are scheduled.` — body under S1.2's "No runs scheduled yet."
  - `You're not on any runs yet.` / `Tap Open to see what needs a driver.` — the Mine filter's empty state, which no doc specifies.
  - `Claiming every one puts you on the runs that fit your schedule, now and in future.` — the consequence line under the scope question, per §7's question+consequence pattern.
  - `Just this one` / `Every Tuesday` — the two scope choices.
  - `See which dates` — S1.2 asks for "a link to view which dates were skipped" without naming it.
  - `Runs that were skipped` / `Done` / `Dismiss` — the skipped-list modal and the summary card.
  - `Someone else took it first.` — the one skip reason with no server sentence, because `NO_LONGER_OPEN` is a lost race rather than an eligibility fact. Every other skip reason renders the server's `claimRefusedMessage`.
  - `Which runs` — the screen-reader name for the filter group.
  - `Claim <route>, <time>` — the Claim button's `aria-label`, since a screen reader hears the button without its row.
  - `Today, August 4` / `Tomorrow, August 5` / `Thursday, August 6` — the day headings. No doc fixes their format; "Today"/"Tomorrow" replace the weekday where they apply.

**Unblocked:**
- The lead can wire `board: BoardScreen` into `main.tsx`'s registry; `/board` is `HOME_PATH`, so this closes the landing screen for every signed-in user.
- S1.3 (shift detail) now has a caller: the board navigates to `shift` with `{ shiftId }` for Mine rows and for staff.
- **Blocking the wave's gate, needs a fixer on another lane's file:** the two time-dependent tests in `server/test/recurrence-materialization.test.ts` above. The fix is to pin the clock the tests run against, or to pick a fixture window that cannot straddle "now" — not to change the service, which is behaving as `domain-modeling.md §5.3` specifies.
