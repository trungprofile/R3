#!/usr/bin/env bash
# Bring up the disposable test database and migrate it to head.
#
# The test DB is built by RUNNING server/migrations, never from a fixture schema.
# Tier-1 and tier-2 invariants exist only as DB constraints, and I20's write-skew
# case needs two genuinely concurrent SERIALIZABLE transactions — neither is
# testable against a mock (architecture.md §4.1).
#
# Useful consequence: every test run is also a migration run, so a migration that
# does not apply cleanly fails the suite rather than the deploy. Same instinct as
# §5.3 making the rehearsal double as the restore test.

set -euo pipefail

export DATABASE_URL="postgres://r3:r3@localhost:55432/r3_test"

docker compose --profile test up -d --wait postgres-test

# TODO: run node-pg-migrate against $DATABASE_URL once the server workspace has
# its dependencies installed.
echo "test database up at ${DATABASE_URL}"
echo "TODO: apply server/migrations"
