# R3

System of record for Amazing Grace Food Pantry's weekly food-rescue cycle — **r**escue → **r**eceive → **r**eport — replacing a paper-and-phone process.

## Problem

AGFP runs weekly food rescues from grocery donors (Kroger, Target, others) under North Texas Food Bank (NTFB), its mother agency. Today the loop runs on paper and phone calls: routes are assigned on a paper calendar, receivers scramble when a truck shows up unannounced, and one person spends hours each week hand-summing weight sheets into the NTFB report.

R3 replaces that with a shared shift board (drivers self-select or get assigned pickups), in-app weight entry at the receiver tablet, and an auto-calculated, drill-down-able NTFB report.

## Stack

PERN (PostgreSQL, Express, React, Node), TypeScript throughout, Kysely as the query builder (no ORM). Self-hosted on a single Docker box. Delivered as a responsive PWA — no native app, no offline support.

Scale target: ~15 pickups/week, under 10 concurrent users. Not engineered for load.

## Build order

1. **Rescue** — accounts, donors, trucks, shift/route scheduling (incl. recurring), shared board, claim/assign, availability, release, reschedule, pickup execution, notifications.
2. **Receive** — weight entry, unscheduled-donation intake, truck-inbound notification.
3. **Report** — NTFB-mapped report generation, admin metrics.

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

## Status

Scaffold only — no dependencies installed yet. Install/dev/test/migrate commands land here once tooling is added.
