# R3

System of record for Amazing Grace Food Pantry's weekly food-rescue cycle — **r**escue → **r**eceive → **r**eport — replacing a paper-and-phone process.

## Problem

AGFP runs weekly food rescues from grocery donors (Kroger, Target, others) under North Texas Food Bank (NTFB), its mother agency. Today the loop runs on paper and phone calls: routes are assigned on a paper calendar, receivers scramble when a truck shows up unannounced, and one person spends hours each week hand-summing weight sheets into the NTFB report.

R3 replaces that with a shared shift board (drivers self-select or get assigned pickups), in-app weight entry at the receiver tablet, and an auto-calculated, drill-down-able NTFB report.

## Stack

PERN (PostgreSQL, Express, React, Node), TypeScript throughout, Kysely as the query builder (no ORM). Self-hosted on a single Docker box. Delivered as a responsive PWA — no native app, no offline support.

Scale target: ~15 pickups/week, under 10 concurrent users. Not engineered for load.

## What's built

All three phases. Each fed the next, so they were built in order.

1. **Rescue** — accounts, donors, trucks, shift/route scheduling (incl. recurring), shared board, claim/assign, availability, release, reschedule, pickup execution, notifications.
2. **Receive** — weight entry, unscheduled-donation intake, truck-inbound notification.
3. **Report** — NTFB-mapped report generation, admin metrics.

Sixteen screens, twelve migrations, 1,419 tests. The report refuses to export a week whose
categories aren't all matched to a food-bank category — a short file is invisible to
whoever receives it, so it blocks rather than under-reports.

## Running it

Needs Node and a local PostgreSQL 16 on port 55432 (Homebrew `postgresql@16`).

```bash
npm install
./scripts/dev.sh --reset --seed     # drop, migrate, seed, run
```

App on [localhost:5173](http://localhost:5173), API on `:3000`. The seed prints four
accounts covering every role; volunteers sign in with a four-digit PIN, staff with a
password.

Navigation is derived from who you are **and** your window width — phone under 768px,
tablet 768–1023, desktop 1024+. There is no device switcher, so a narrow window genuinely
is the driver's app and a mid-width one is the receiver's. The tablet has no navigation at
all, by design.

```bash
npm run gate      # migrations, both typechecks, both suites — exit code is the verdict
```

## Layout

```
client/src/
  screens/{s1-rescue,s2-receive,s3-report}/  one folder per UI screen
  components/  tokens/  api/
  sw.ts                                      service worker (push only)
server/
  migrations/                                hand-authored SQL — schema authority
  src/
    db/                                      Kysely instance + generated types
    middleware/                              auth, default-deny gate, error handler
    routes/                                  parse, declare tier/duty, shape
    services/                                domain logic, owns transactions
    jobs/                                    catch-up sweeps
  test/                                      runs against a migrated DB
shared/src/                                  types + enum values, zero runtime deps
scripts/                                     test-db, migration rehearsal, backup
docs/foundation/                             product/domain/architecture/data/UI specs
```

## Docs

Full specs live in [`docs/foundation/`](docs/foundation/): product requirements, domain modeling (entities, state machines, invariants — locked/authoritative), architecture, physical data model, and UI/UX. See each doc's own scope for what it owns.

Per-phase build plans and their assumption ledgers are in [`docs/features/`](docs/features/).
The ledgers are worth more than they look: they record every place the specs did not
answer and the build picked a reading, which is where the bugs will be.

## Status

Built and gated; **not deployed**, and no production data exists yet.

Two things are missing on purpose, because they belong to the food bank rather than to
this repo:

- **NTFB's category names.** The mapping table ships empty. Guessing at them would put
  invented values in the one column that decides what gets reported, and every check here
  would pass while it did. A reporter fills them in from the report screen.
- **The real Meal Connect export format.** The CSV carries the right numbers at the right
  grain; the header row is a best guess until someone compares it with a real submission.

Also worth stating plainly: the test suite, both type checkers and the production build all
pass, and **none of that proves a page renders correctly.** The screens have had a
first-render pass in Phase 1 only. Treat the UI as unverified until someone has clicked
through it.
