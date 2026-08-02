# QA round 1 — what changed, and how to undo any of it

The first hands-on pass over the running app (2026-08-02, admin account) produced about
eighteen pieces of feedback. This is the record of what was done about each one, written
so that any single change can be backed out without disturbing the others.

**Read `phases-1-3.md §2` first for the *why*.** Six decisions came out of this round —
`D16`–`D21` — and three of them overturn or bend something earlier. This file is the
mechanical companion: which files moved, and what reverting each piece costs.

## How to revert

Work landed as **one commit per lane**, so the normal undo is `git revert <sha>` for that
lane alone. Two things are not lane-local and are called out per row below:

- **Migration `0014`** is forward-only, like every migration here. Reverting the code that
  reads `route.default_staff_note`, `donor.map_url` or `donor_photo` leaves the columns in
  place, unread. That is harmless and is the intended failure mode; **write a new migration
  if you actually want them gone**, and only while the database is still empty.
- **Copy changes are spread across every lane** rather than concentrated in one, because a
  string lives next to the screen that renders it. Reverting one lane reverts its copy too.

---

## 1. Feedback that needed no work

| Asked for | Already true |
| :---- | :---- |
| PIN auto-generated from the last 4 digits of the phone | `server/src/services/auth.ts` `defaultPin()`. Four random digits only when no phone is on file, and that case is shown to the admin once and never logged. Specified by `architecture.md §4.2`. |
| Admin can change a staff or admin password | `server/src/services/user.ts` `setCredential()`, surfaced on S1.8. Note there is deliberately **no self-service reset and no unlock path** — a forgotten admin password is a database-level fix, which is what you described doing. |
| Completed runs should show on the board | `COMPLETED` runs were already returned and rendered; the board's query never filtered on status. What was missing was a way to *look back at a past week*, which is row 5 below. |

---

## 2. Wave 0 — foundation

Everything else builds on this. Reverting it alone breaks every lane.

| Change | Files | Reverting |
| :---- | :---- | :---- |
| Migration `0014`: `route.default_staff_note`, `donor.map_url`, `donor_photo` table | `server/migrations/0014_driver_aids_and_route_defaults.sql`, `server/src/db/types.ts` | Forward-only. See above. |
| `BackLink` component | `client/src/components/BackLink.tsx` | Callers in S1.3 and S1.8 would need their old ad-hoc buttons back. |
| `TimeField` component | `client/src/components/TimeField.tsx` | S1.4 still has its own private time grid, so the old `TimeChoice` pattern is not lost. |
| Router query strings (`?tab=`, `?edit=`) | `client/src/app/router.tsx` | Needed by the board's Edit link and by Admin's tabs. |
| Week helpers extracted so the board and the report agree on "this week" | `client/src/app/week.ts` (re-exported by `s3-1-report/report.ts`) | Pure move; the report screen's imports are unchanged. |

---

## 3. What changed, by feedback item

| # | You said | What was done | Where |
| :--- | :---- | :---- | :---- |
| 1 | No return button; the browser back button is a terrible UX | Added `BackLink` at the top of S1.3, and replaced S1.8's two ad-hoc back buttons with it. S1.3 previously had **no** way back at all. | `components/BackLink.tsx`, S1.3, S1.8 |
| 2 | Remove redundant explanations | ~30 hint strings deleted app-wide under `D21`. Consequences, blocked-reasons and number definitions were **kept** — see `phases-1-3.md` `D21` for the line drawn. | every screen's copy module |
| 3 | "Stores, in the order the driver drives them" | Now **"Suggested order for the driver"**. | `s1-6-schedule/logic.ts` |
| 4 | Remove the arrow-key wording, the keys are gone | **They are not gone** — `StopRow` still handles ArrowUp/ArrowDown. So the *visible* hint was cut and the `aria` text kept: it is the only thing telling a screen-reader user the affordance exists. | `s1-6-schedule/RoutesPanel.tsx` |
| 5 | The board should show this week by default, with a from/to, and show completed runs | Board defaults to **Monday–Sunday of the current week** using the same boundary the Report screen cuts on, plus a `‹ week ›` stepper and a **This week** button. Completed runs already showed. | `s1-2-board/**` |
| 6 | The route edit panel should open at the route being edited | All three S1.6 panels now render the editor **inside the selected row's `<li>`** instead of above the list. Fixed a stale aria label that said "open below" while rendering above. | `s1-6-schedule/**` |
| 7 | "Repeating runs" → "Recurring runs"; "Routes" → "Route templates" | Both done, and the rest of the "repeating" wording was brought along so one screen does not use both words. `domain-modeling.md §1` already calls a Route a "reusable template". | `s1-6-schedule/logic.ts` |
| 8 | Add a default note to each route, editable when creating a run | `route.default_staff_note` seeds `shift.staff_note` at create. **A default, not a fifth note channel** — see `D19`; a fifth channel would contradict the locked `domain-modeling.md`. Recurrence reads it *per occurrence*, so editing a route never rewrites an existing run. | migration `0014`, `services/pickup-route.ts`, `services/recurrence.ts`, `s1-6-schedule/**` |
| 9 | "Move the date or time" → an Edit option; make it reachable from the board too | The run row now opens the inline editor; S1.7 is reached from a **"Move to another day or time"** button inside it. Staff board rows gained an **Edit** link to the same editor via `?edit=<shiftId>`. | `s1-2-board/**`, `s1-6-schedule/**` |
| 10 | Don't ask "just this date or the weekly pattern?" up front | The prompt is gone; the choice is a control **inside** the editor, defaulting to "This run". `I23`/`I24` still hold because the save path branches on the explicit scope, and the two branches now render mutually exclusive controls. | `s1-6-schedule/RunEditor.tsx` |
| 11 | Times in 15-minute steps, two buttons rather than a floating list | New `TimeField`: a button showing the time, opening a scrollable quarter-hour list. Replaces a grid of 35 always-visible buttons (which at 15-minute steps would have been 69). Applied to S1.6 **and S1.7**, so both screens step alike. | `components/TimeField.tsx`, S1.6, S1.7 |
| 12 | Category mapping is admin, not reporter | Moved to Admin's **Category matching** tab; its server routes are now `tier: 'ADMIN'`. The report routes stay `report`-duty. This overrides `D11`, which explicitly left the choice to a human. | `s1-8-admin/mapping/**`, `routes/report.ts` |
| 13 | Export to PDF | A **print view** plus the browser's Save-as-PDF. `D5` forbids a PDF dependency and `D13` says the artefact is a typing worksheet, not a document. The CSV stays; both draw from the same server function so they cannot drift. | `s3-1-report/**`, `routes/report.ts` |
| 14 | Metrics should be a tab under Admin, and the first one | Metrics is Admin's default tab. `/metrics` still resolves as a redirect. It keeps its **S3.2** spec ID. | `s1-8-admin/metrics/**`, `app/nav.tsx`, `app/routes.ts` |
| 15 | Staff-only tabs before volunteer ones | Desktop nav is now `Admin · Schedule · Report · Board · My Shifts · Inbox`. **Login still lands on `/board`** — it is the spec's adoption centrepiece and the one screen everyone can open. Phone nav is unchanged. | `app/nav.tsx` |
| 16 | Auto-generate the PIN from the phone; let admin change staff passwords | Already built. See §1. | — |
| 17 | Sign-in: make the volunteer list scrollable and add a search bar | Bounded scroll region with a filter above it, autofocused on desktop only (on a phone it would raise the keyboard over the list). The roster is already public pre-sign-in, so the filter discloses nothing new. | `s1-1-login/**` |
| 18 | Drivers: collapse the other stops; give them a map link and a store photo | Only the current stop is expanded; any stop is one tap from open. `donor.map_url` (blank derives one from the address) and a `donor_photo` table. Photo bytes live in Postgres — no upload library (`D5`) and no volume, which would be a second thing to back up. | `s1-5-pickup/**`, `services/donor.ts`, `s1-8-admin/masters.ts` |

---

## 4. Two defects the work uncovered

Neither was in the feedback; both were found while implementing it.

| Defect | Fix |
| :---- | :---- |
| `express.json` capped bodies at **64kb**, which made the store-photo endpoint unusable — a base64 photo at the schema's 400 KB ceiling needs ~533 KB, so every real upload was refused by the parser before the service's readable error could run. | Raised to `600kb` in `server/src/index.ts`. This does **not** widen what a photo may be: the size and mime limits are a `CHECK` constraint. |
| Inbox rows and push banners joined their parts with ` — `, so every notification carried an em dash that no client-side change could remove. | `services/notification.ts` and `services/inbox.ts` now join with a comma, which is also where a screen reader pauses. |

---

## 5. If you want less of this

The pieces are independent. In rough order of "easiest to drop without anyone noticing":

1. **The store photo** (`#18`, second half) — newest, most machinery, and the only change that puts bytes in the database. Dropping it leaves the map link, which delivers most of the value.
2. **The print view** (`#13`) — the CSV was never removed, so this is purely additive.
3. **The board's week range** (`#5`) — reverting returns it to today-forward with no way to look back.
4. **The mapping move** (`#12`) — a screen move and a route-access change, no data change, so it moves back the same way.

The two hardest to unpick are the **microcopy sweep** (`#2`, deliberately spread across every
lane) and the **route default note** (`#8`, which has a migration behind it). Neither is
risky to keep.
