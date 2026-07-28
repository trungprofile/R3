#!/usr/bin/env bash
# Migration rehearsal — REQUIRED before any migration runs against production
# (architecture.md §5.3). Applies from go-live onward; before then schema changes
# are drop-and-recreate and there is no production data to preserve.
#
#   restore most recent dump into a throwaway Postgres container ON THE BOX
#   -> run the migration against it -> smoke-test -> destroy the container
#
# Runs on the pantry box, not a laptop: dumps contain volunteer phone numbers and
# addresses, which stay inside the §3 trust boundary.
#
# THIS IS ALSO THE RESTORE TEST. A backup never restored is a rumor; making restore
# a required step of a routine already performed means a broken backup blocks the
# next deploy, loudly, while nothing is on fire.
#
# Smoke test is a fixed checklist, not a suite:
#   1. Did the migration complete, and how long did it take?
#   2. Do the constraint predicates still hold when run as queries over real rows?
#   3. Do derived reads return the same numbers as before — SUM-on-read totals,
#      the WEIGHED-EXISTS projection, status counts?
#   4. Does the application boot against the migrated database?
#
# Does NOT cover environment differences (ingress, container networking); that
# would need a persistent second stack, which §5.3 declines.

set -euo pipefail

echo "TODO: implement once migrations exist and there is production data to rehearse against."
exit 1
