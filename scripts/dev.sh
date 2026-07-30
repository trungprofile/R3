#!/usr/bin/env bash
# Run R3 locally: Express + the job scheduler on :3000, Vite on :5173.
#
# This exists because until it did, nothing could load a page. The gate proves the
# code typechecks and its units behave; it cannot prove a screen renders, and
# `doc-qa` twice declined to run UI tests for the honest reason that the app could
# not be started. Nine screens is too many to first run all at once.
#
# NOT the production topology. On the box, one process serves the built SPA itself
# with a catch-all fallback and there is no Vite (`architecture.md §4.5`). Here Vite
# serves the client and proxies `/api` to Express, so the session cookie is
# same-origin in both — the one property that must not differ, since a cookie that
# works in dev and not on the box is the bug this arrangement prevents.
#
# Database: a PERSISTENT `r3_dev`, unlike `scripts/test-db.sh`'s disposable one.
# Development wants yesterday's data still there; a suite wants a guaranteed-empty
# schema. Same local Homebrew postgresql@16 on 55432, same migrations, different
# lifecycle. Use `--reset` to drop and rebuild, and `--seed` to put a world in it.
#
# Usage:
#   ./scripts/dev.sh                one-time setup, then run
#   ./scripts/dev.sh --seed         reseed, then run  (destructive: see dev-seed.ts)
#   ./scripts/dev.sh --reset --seed drop the database, migrate, seed, run

set -euo pipefail

cd "$(dirname "$0")/.."

PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@16/bin}"
PGPORT_DEV="${PGPORT_DEV:-55432}"
PGUSER_DEV="${PGUSER_DEV:-r3}"
DB_NAME="${R3_DEV_DB:-r3_dev}"

DO_RESET=0
DO_SEED=0
for arg in "$@"; do
  case "$arg" in
    --reset) DO_RESET=1 ;;
    --seed)  DO_SEED=1 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

export PGPASSWORD="${PGPASSWORD:-r3}"
export DATABASE_URL="postgres://${PGUSER_DEV}:r3@localhost:${PGPORT_DEV}/${DB_NAME}"

if ! "$PGBIN/pg_isready" -p "$PGPORT_DEV" -q; then
  echo "error: no Postgres accepting connections on port ${PGPORT_DEV}." >&2
  echo "       start it with: brew services start postgresql@16" >&2
  exit 1
fi

if [ "$DO_RESET" -eq 1 ]; then
  "$PGBIN/dropdb" -p "$PGPORT_DEV" -U "$PGUSER_DEV" --if-exists "$DB_NAME"
fi

# Idempotent: createdb fails loudly if it exists, which is not an error here.
if ! "$PGBIN/psql" -p "$PGPORT_DEV" -U "$PGUSER_DEV" -lqt \
     | cut -d'|' -f1 | grep -qw "$DB_NAME"; then
  "$PGBIN/createdb" -p "$PGPORT_DEV" -U "$PGUSER_DEV" "$DB_NAME"
  echo "created database ${DB_NAME}"
fi

# Migrations are forward-only and idempotent by ledger, so running them every boot
# is right: it means a pull that adds a migration cannot leave a stale dev schema
# behind to produce confusing runtime errors.
npm run --workspace @r3/server migrate:up

if [ "$DO_SEED" -eq 1 ]; then
  npx tsx scripts/dev-seed.ts
fi

# Dev-only secrets. NODE_ENV is deliberately NOT production: `middleware/cookies.ts`
# only demands a real SESSION_COOKIE_SECRET and sets the cookie `Secure` when it is,
# and localhost is plain HTTP, so a Secure cookie would never come back (§4.2).
export NODE_ENV="${NODE_ENV:-development}"
export SESSION_COOKIE_SECRET="${SESSION_COOKIE_SECRET:-dev-only-not-a-secret}"
export PORT="${PORT:-3000}"
export TRUST_PROXY="${TRUST_PROXY:-loopback}"

# VAPID is intentionally left unset unless the caller exports it. `architecture.md
# §5.1` makes the keys deploy configuration, and an unconfigured box is a supported
# state, not a broken one: `PushConfigResponse.publicKey` goes null, alerts are
# skipped, and the in-app inbox remains the source of truth (PRD channel strategy).
if [ -z "${VAPID_PUBLIC_KEY:-}" ]; then
  echo "note: no VAPID keys — push is off, the inbox still works (by design)"
fi

# One Ctrl-C must take both down. Without the trap, killing this script orphans
# Express holding :3000, and the next run fails on a port already in use.
pids=()
cleanup() {
  trap - INT TERM EXIT
  for pid in "${pids[@]:-}"; do
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

echo
echo "  API     http://localhost:${PORT}/api"
echo "  App     http://localhost:5173"
echo "  DB      ${DATABASE_URL}"
echo

npm run --workspace @r3/server dev & pids+=("$!")
npm run --workspace @r3/client dev & pids+=("$!")

# Exit as soon as EITHER half dies, rather than sitting on a half-running app that
# looks up but serves 500s from a dead API.
#
# Polled rather than `wait -n`, which needs bash 4 — macOS still ships bash 3.2 as
# /bin/bash, so `wait -n` fails here, and under `set -e` that took the whole script
# down a second after boot. A one-second poll is the portable form.
while :; do
  for pid in "${pids[@]}"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "a dev process exited — shutting the other down" >&2
      exit 1
    fi
  done
  sleep 1
done
