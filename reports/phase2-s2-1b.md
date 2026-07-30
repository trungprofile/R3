# Phase 2 — S2.1b run picker

**Status:** complete

**Built:**
- `RunPickerScreen` — asks "Which run are you receiving?", lists every receivable run as a big tappable row, and carries a persistent `Unscheduled donation` action that needs no run.
- Each row: the run's own label ("Karen's Tue AM run"), route + **`occurrenceDate`** + window, a status dot per stop (pending / weighed / skipped / moved), an "N of M done" count, and the words for what the tap does ("Next: Kroger" / "Receive done").
- Tap → `/receive/:shiftId/stops/:stopId` for the run's **first unresolved stop**, via `buildPath('receive-stop', …)`; a run with `readyForReceiveDone` goes to `/receive/:shiftId/done` instead; `Unscheduled donation` goes to `/donations/new`.
- On tap the run's stop list is re-read (`GET /receive/runs/:id/stops`) so two receivers working the same run in parallel do not land on the same store; a failed re-read falls back to the stale target.
- All three §3/§6 list states: `SkeletonRows` (after §6's 300ms, never a bare spinner), an instructive `EmptyState`, and a plain retryable `ErrorBlock`. Rows already on screen survive a slow or failed refresh rather than dissolving.
- Pure logic split into `run-picker.ts` (ordering, counts, dot mapping, target resolution, state decisions, copy) so all of it is testable without a DOM.

**Files:** all inside `client/src/screens/s2-receive/s2-1b-run-picker/`
- `api.ts`
- `run-picker.ts`
- `run-picker.test.ts`
- `RunPickerScreen.tsx`
- `RunCard.tsx`
- `run-picker.css`
- `index.ts` (exports `RunPickerScreen`)

Nothing outside the folder was touched. `main.tsx`, `app/routes.ts`, `components/`, `tokens/`, `shared/`, `server/` are all unmodified — the lead wires the `receive-runs` registry entry.

**Tests:** 52 passing (485 total in the client suite, up from a 433 baseline) — `npx vitest run --root client`. Typecheck clean: `npx tsc --noEmit -p client/tsconfig.json`.

Covered: the date rule (a Tuesday-night run reads Tuesday whenever it is received; `YYYY-MM-DD` never parsed as UTC midnight; no relative "Today"), pantry-zone clock and AM/PM, the run label incl. the unowned and `…s`-name cases, dot mapping for all five `ReceiveStopState` members, route-order stop sorting, first-unresolved-stop selection, the two navigation targets and the no-stops case, the freshness re-read's target, the done count, list ordering, the card view, the five list states, and §7's forbidden vocabulary.

**Deliberately not done:**
- **No component renderer.** Nothing renders in the tests — there is no jsdom and adding one is a dependency (build-plan §3/D5). So the JSX itself, the CSS, and the async tap handler in `RunPickerScreen.tsx` are unasserted; only the logic they call is. Same shape as every S1.x screen's coverage.
- **No auto-refresh / polling.** S2.1b says the list "re-sorts/refreshes as stops resolve"; that happens on load and on the per-tap stop re-read, not on a timer. A poll is a background job on the client and nothing in `architecture.md §4.4` asks for one. If the human wants a live list, that is a follow-up.
- **No manual "Refresh" button.** Not in the spec, and the receiver returns to this screen from S2.2/S2.2b, which remounts and reloads it.
- **No phone layout.** The responsive matrix marks weight entry `n/a` on phone. A narrow window gets the same single column, stacked — not a phone design.
- **`app/pantry-day.ts` was checked and not used.** It answers "what is today for the pantry", which this screen must never ask (see `Assumed:` below). It is not needed for the fetch either — `GET /receive/runs` takes no date bound (A162).

**Assumed:**

1. **The date is absolute and never relative.** S2.1b forbids the device's today, so I went further and never say "Today"/"Yesterday" at all, even computed from the *pantry's* today via `todayInZone`. Reason: a Tuesday run read at 12:30am Wednesday would say "Yesterday", which is a fact about the reader, not about the run — and A162 says a run from last week can legitimately still be listed. Every row says "Tuesday, April 21". If the human would rather see "Today" on same-day runs, that is a one-function change in `calendarDateLabel`.

2. **A fourth status dot for `REASSIGNED` ("moved").** S2.1b names three (pending / weighed / skipped) but `ReceiveStopState` has five members. `COLLECTED` is folded into **pending** — it is unresolved work for the receiver and still blocks I12. `REASSIGNED` got its own hollow dashed dot and the word "moved", because it counts as *resolved* toward the done count yet is neither weighed nor skipped, and drawing it as "skipped" would state something untrue.

3. **List ordering is invented.** No doc gives one. Chosen: runs with weighing left before runs waiting only on the closing tap, then **oldest `occurrenceDate` first**, then `startsAt`, then route name. The oldest-first choice is deliberate — A162 keeps unclosed runs from previous days on the list, and putting them at the bottom is how they stay unclosed. The alternative (newest first, today's run at the top) is equally defensible and is a one-line change in `compareRuns`.

4. **The run label is a construction, not a field.** "Karen's Tue AM run" is built from `ownerName` + weekday-of-`occurrenceDate` + AM/PM-of-`startsAt`, matching the spec's mock and S2.2's header. `routeName` is not dropped — it leads the subtitle line. Possessive is always `'s` (so "Chris's", not "Chris'"). An unowned run reads "Tue AM run" with no possessive; the spec never shows one, since a run must be claimed to be `IN_PROGRESS`.

5. **A stop re-read on every tap.** `GET /receive/runs/:id/stops` is called before navigating, so the "first unresolved stop" is current rather than as-of-page-load — S2.1b explicitly allows several receivers on one run. It adds one round trip to the tap (the row goes non-interactive while it is in flight) and silently falls back to the stale target on failure. If the extra hop is unwanted, delete `openRun`'s `try` block and navigate straight to `card.target`.

6. **`Unscheduled donation` is a `secondary` button, so the screen has no primary.** §1 allows exactly one high-emphasis button; here the emphasis belongs to the list of runs, which is the question the screen asks. Making the donation button orange would point the eye at the exception. It stays visible in the empty state too — it is the one thing a receiver can do when nothing is listed — and is not duplicated inside the `EmptyState`, so there is only ever one such target on screen.

7. **`readyForReceiveDone` is taken at its word.** The client never recomputes I12; a run the server calls not-ready with every stop resolved yields no target at all rather than a client-side override. Pinned by a test.

8. **A run with zero stops renders as information only.** It can be neither weighed nor closed (I12 needs at least one resolved stop), so the row has no `onClick` and reads "No stops on this run yet." rather than "0 of 0 done". §3 prefers hiding an action to disabling one. Whether such a shift can exist is the scheduler's business, not this screen's.

9. **Copy that is not in the spec.** The empty state ("No runs to weigh right now." / "A run shows up here once its driver starts it. If food arrived on its own, use Unscheduled donation below."), the "Next: <store>" tap hint, the "All stops done — " prefix on a ready run, and the donation hint are all mine. §7's forbidden list is enforced by test; a copy review is still outstanding for Phase 1's nine screens and this makes ten.

10. **No component class was overridden.** The row is `components/ListRow.tsx` as built, inside `List`/`ListItem` — so it is §3's "big list row" rather than the spec sketch's boxed card. Making the rows look like cards would mean restyling `.r3-row` from a screen stylesheet, which no other screen does. If the human wants visible cards, that is a `components/` change and outside this folder.
