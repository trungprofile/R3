# Phase 2 — build plan & standing decisions

Phase 2 is **Receive**: caps 12 and 14 plus truck-inbound (`product-requirement.md §4`).
Read this **with** the foundation doc that owns your area (`CLAUDE.md` routing table), not
instead of it. The foundation docs still win on any rule; this doc records decisions they
left open, and the ones Phase 1 deferred that now come due.

Decision numbering continues `phase-1-build-plan.md`'s series (D1–D6), so a citation like
"D3" means the same thing in both documents.

## 1. How Phase 2 is built, and why it differs from Phase 1

Phase 1 ran as unattended waves of worktree-isolated lane agents under
`bypassPermissions` (D4). **Phase 2 does not**, for one reason that is not a preference:
`.claude/settings.json` now sets `defaultMode: "default"` and
`disableBypassPermissionsMode: "disable"`, so no agent runs unattended any more.

What replaced it:

- **The invariant-dense layer is built serially by the lead.** Migration 0011, the two
  services, the routes, the jobs and every server test. Phase 1's §2 said "Coverage is the
  risk … do not fan it out" about the layer holding most of its invariants; intake is the
  Phase-2 equivalent, holding I12–I18 and I29 between two files.
- **Screens fan out, one agent per `S2.x` folder**, exactly as Phase 1's Wave 4 did. Screens
  are genuinely file-disjoint and hold no invariants — every rule they touch is enforced
  again server-side (`CLAUDE.md`).
- **The gate is unchanged.** `scripts/gate.sh` plus `doc-qa` over the diff, both mandatory,
  and the gate still decides pass/fail rather than the lead (`phase-1-build-plan.md §5.2`).

## 2. Standing decisions

### D7 — `COMPLETED` becomes reachable, and exactly once

D1 said a Phase-1 run never reaches `COMPLETED`, because I11 makes the receiver's
receive-done the only completion action and the receiver shipped in Phase 2. That deferral
now expires.

- `services/receive.ts` `receiveDone()` is **the only** function in the codebase that writes
  `status = 'COMPLETED'`, and the only route that reaches it is `POST /receive/runs/:id/done`.
- D1 predicted a second completion path "would have to be removed in Phase 2". There was
  never a second one to remove — Phase 1 built none — so this is an addition, not a
  correction. The driver still has no completion step.
- `S1.2`'s **Done** board state, built and left unexercised in Phase 1, is now reachable.
- Phase-1 tests asserting a started run stays `IN_PROGRESS` after the driver resolves every
  stop **remain correct** and are not touched: they are about the driver's paths, and I27's
  handoff still does not complete anything.

### D8 — the driver's ad-hoc flag carries a category

**A real conflict between two foundation docs**, resolved by `CLAUDE.md`'s authority order
rather than by preference. Flagged to the human at the time rather than settled quietly.

| Doc | Says |
| :---- | :---- |
| `ui-ux-spec.md:193` (S1.5) | the control is "**just** a donor picker (or free-text label) and an optional note, no weight entry here" |
| `domain-modeling.md §2.3` (**locked**) | `UnscheduledDonation` → `Category \| required`, with no `SUGGESTED` exemption — and an explicit one granted to `weight` in the very next row |
| `data-model.md §7.2` | `category_id uuid NOT NULL`; `weight numeric(8,2)` nullable |

A `SUGGESTED` row therefore **cannot be stored** without a category. The locked doc wins, so
the driver picks a category and still enters no weight — `ui-ux-spec.md:193`'s "just" is the
loser. The receiver may correct the category at confirm time, which is what makes the
driver's pick a prefill rather than a commitment.

Recorded in `shared/src/donation.ts` on `FlagAdHocRequest`, where a reader meets it first.
**`ui-ux-spec.md` has not been edited** — an inconsistency between a locked doc and a lower
one is the human's to resolve, not the builder's (`phase-1-build-plan.md §5.5`).

### D9 — the edit window gates edits, never the completion

`domain-modeling.md §3.1` makes receiver edits Reporter-only after
`app_config.receiver_edit_window_days` from shift start. Applied to `addWeight`,
`reviseWeight`, `voidWeight`, `skipStop`, `confirmDonation` and `setReportable`.

**Not applied to `receiveDone`.** Closing the run is the completion action (I11), not an
edit, and gating it would make a run whose window lapsed *permanently unclosable* — there is
no other transition into `COMPLETED` to rescue it, by D7's own design. The escape hatch for
a late correction is Phase 3's Reporter path, which is about editing intake, not about
closing runs.

### D10 — receiver-authored donations are walk-ins; only driver-adds carry a shift

`UnscheduledDonation.shift_id` is 0..1 — "set when it arrived on a run; null for a true
walk-in" (`domain-modeling.md §2.3`). The API makes that structural rather than a judgement
call at each call site:

- `POST /shifts/:id/donations` (driver, DRIVE duty) always sets `shift_id`, and
  `received_date = shift.occurrence_date`.
- `POST /donations` (receiver, RECEIVE duty) never sets it, and `received_date` is the
  pantry-local receive day.

S2.3 is reachable from inside a run's weighing session, so the alternative was to let the UI
path decide. It should not: the shift records *where the food came from*, and a walk-in
handed over while someone happens to be weighing a run did not come from that run.

## 3. Single-owner files

Unchanged from `phase-1-build-plan.md §3`, and the lead owns every one of them this phase:

- `server/migrations/` and the generated `server/src/db/types.ts`
- `shared/src/` — including the new `receive.ts` and `donation.ts`
- the route registry (`server/src/routes/index.ts`) and the job registry
- `client/src/app/routes.ts`, `client/src/main.tsx`, `client/src/tokens/`
- `package.json` (all workspaces) — **no dependency was added in Phase 2**

## 4. What Phase 2 builds

| Capability | Where |
| :---- | :---- |
| 14 — weight entry | `services/receive.ts`, `routes/receive.ts`, S2.1b / S2.2 / S2.2b |
| 12 — unscheduled donation, both halves | `services/donation.ts`, `routes/donations.ts`, S1.5 flag + S2.3 |
| 13 — truck-inbound, the row Phase 1 held back | `services/execution.ts` `completePickup`, S2.4 |

Plus the two Phase-1 deferrals that come due with the tables:

- **I21's predicates** gained referencing tables — `donorHasHistory`, `categoryHasHistory`
  and `userHasHistory` each grew probes, and nothing else changed. That was D3's whole
  argument for one function per entity, and `masters-category.test.ts` now asserts the
  referencing-table set so a third one cannot arrive unnoticed.
- **I30's "unweighed" clause** became enforceable. Phase 1 could only check the stored
  disposition; a `COLLECTED` stop that has since produced a weight projects to `WEIGHED`
  (I12) and is refused a move.

## 5. Cross-doc dependencies

| Doc | Owns | This doc depends on it for |
| :---- | :---- | :---- |
| `product-requirement.md` | phasing, capability numbers | the Phase-2 cap list; the notification matrix's truck-inbound row |
| `domain-modeling.md` (locked) | I1–I30, state machines | D7's reading of I11/I12; D8's resolution; D9's window |
| `architecture.md` | enforcement tiers, transactions, jobs | the tier each new rule lands in; the I17 sweep's shape |
| `data-model.md` | physical schema | migration 0011 is §7 transcribed; §8's `report_day` anchor |
| `ui-ux-spec.md` | screens S2.1–S2.4 | the screen split; D8's losing side |
| `phase-1-build-plan.md` | D1–D6 | D7 lifts D1; D3's deferrals are §4 above |
