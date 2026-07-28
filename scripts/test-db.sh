#!/usr/bin/env bash
# Bring up a disposable test database and migrate it to head.
#
# The test DB is built by RUNNING server/migrations, never from a fixture schema.
# Tier-1 and tier-2 invariants exist only as DB constraints, and I20's write-skew
# case needs two genuinely concurrent SERIALIZABLE transactions — neither is
# testable against a mock (architecture.md §4.1).
#
# Useful consequence: every test run is also a migration run, so a migration that
# does not apply cleanly fails the suite rather than the deploy. Same instinct as
# §5.3 making the rehearsal double as the restore test.
#
# ONE DATABASE PER WORKTREE. Parallel agents each run this against the same
# server, so a single shared `r3_test` would let one agent's DROP/migrate wipe
# another's data mid-suite — producing green runs that mean nothing, which is
# worse than a red one. The name is derived from the checkout, so isolation is
# automatic and an agent never has to think about it.
#
# Local Postgres, not a container: the box runs postgres:16 under Compose
# (docker-compose.yml, architecture.md §5.1), but local development targets a
# Homebrew postgresql@16 on port 55432 — same major version, no container
# runtime required.

set -euo pipefail

PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@16/bin}"
PGPORT_TEST="${PGPORT_TEST:-55432}"
PGUSER_TEST="${PGUSER_TEST:-r3}"

# Database name: explicit override, else derived from this checkout's directory
# (a worktree is `.claude/worktrees/<name>`, so agents get distinct names for
# free), else the plain default in the main checkout.
if [ -n "${R3_TEST_DB:-}" ]; then
  DB_NAME="$R3_TEST_DB"
else
  WORKTREE_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
  SLUG="$(basename "$WORKTREE_ROOT" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9' '_' | sed 's/_*$//')"
  if [ "$SLUG" = "r3" ] || [ -z "$SLUG" ]; then
    DB_NAME="r3_test"
  else
    DB_NAME="r3_test_${SLUG}"
  fi
fi

export PGPASSWORD="${PGPASSWORD:-r3}"
export DATABASE_URL="postgres://${PGUSER_TEST}:r3@localhost:${PGPORT_TEST}/${DB_NAME}"

if ! "$PGBIN/pg_isready" -p "$PGPORT_TEST" -q; then
  echo "error: no Postgres accepting connections on port ${PGPORT_TEST}." >&2
  echo "       start it with: brew services start postgresql@16" >&2
  exit 1
fi

# Drop and recreate: a test database is disposable by definition, and starting
# from empty is what makes "every test run is also a migration run" true.
"$PGBIN/dropdb"   -p "$PGPORT_TEST" -U "$PGUSER_TEST" --if-exists "$DB_NAME"
"$PGBIN/createdb" -p "$PGPORT_TEST" -U "$PGUSER_TEST" "$DB_NAME"

if [ -d node_modules ] && [ -n "$(ls -A server/migrations 2>/dev/null | grep -v '^\.gitkeep$' || true)" ]; then
  npm run --workspace @r3/server migrate:up
else
  echo "note: skipping migrations (dependencies not installed, or no migrations authored yet)"
fi

echo "test database ready: ${DATABASE_URL}"
