#!/usr/bin/env bash
# The mechanical half of the wave gate (phase-1-build-plan.md §5.2).
#
# Exit code IS the verdict. The lead decides what the next wave is; it does not
# decide whether the last one passed — a lead reading its own agents' reports
# will rationalize a partial pass, which is the failure mode this script exists
# to remove.
#
# The other half of the gate is `doc-qa` over the merged diff, which is an agent
# and cannot run from a shell. Both must pass.

set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

FAILED=0
step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
fail() { printf '\033[31m  FAIL: %s\033[0m\n' "$1"; FAILED=1; }
ok()   { printf '\033[32m  ok\033[0m\n'; }

# 1. Migrations apply cleanly to an EMPTY database.
#    This is why the test DB is dropped and recreated rather than reused: a
#    migration that only works against an already-migrated database is a
#    deploy-time failure we want to catch here instead (architecture.md §5.3).
step "migrations apply to an empty database"
if ./scripts/test-db.sh >/tmp/r3-gate-migrate.log 2>&1; then
  # test-db.sh runs in a subshell, so its DATABASE_URL export dies with it.
  # Every later step needs that value, so read it back off the script's last line
  # rather than duplicating the naming logic here and letting the two drift.
  export DATABASE_URL="$(sed -n 's/^test database ready: //p' /tmp/r3-gate-migrate.log | tail -1)"
  if [ -z "$DATABASE_URL" ]; then
    fail "could not determine DATABASE_URL from test-db.sh output"
  else
    ok
  fi
else
  fail "migrations did not apply — see /tmp/r3-gate-migrate.log"
  tail -20 /tmp/r3-gate-migrate.log
fi

# 2. Typecheck. Agents write most of this codebase; a type error caught at
#    compile time is a defect that never ships (architecture.md §4.6).
step "typecheck"
if [ -d node_modules ]; then
  if npx tsc --noEmit --pretty false 2>&1 | tee /tmp/r3-gate-tsc.log | tail -20; then
    grep -q "error TS" /tmp/r3-gate-tsc.log && fail "type errors" || ok
  else
    fail "typecheck failed"
  fi
else
  fail "node_modules missing — dependencies are Wave-0-owned"
fi

# 2b. Typecheck the browser half. The root tsconfig covers shared/ + server/ only,
#     so without this every line of client code Waves 1 and 4 write would reach the
#     PR untypechecked — the gate would be green about a codebase it never read.
#     Two programs because the service worker's WebWorker lib collides with DOM.
#     The shell config is skipped while client/src still holds nothing but sw.ts —
#     tsc treats an empty program as an error, and that is the state between Wave 0
#     and the Surface lane's first merge. It arms itself the moment a file lands.
step "typecheck (client)"
if [ -d node_modules ]; then
  CLIENT_TSC=0
  CFGS="client/tsconfig.sw.json"
  if [ -n "$(find client/src -name '*.ts' -o -name '*.tsx' | grep -v '^client/src/sw.ts$' || true)" ]; then
    CFGS="client/tsconfig.json $CFGS"
  else
    printf '  (no client shell sources yet — tsconfig.json skipped)\n'
  fi
  for cfg in $CFGS; do
    npx tsc --noEmit --pretty false -p "$cfg" 2>&1 | tee "/tmp/r3-gate-tsc-$(basename "$cfg").log" | tail -20
    grep -q "error TS" "/tmp/r3-gate-tsc-$(basename "$cfg").log" && CLIENT_TSC=1
  done
  [ "$CLIENT_TSC" -eq 0 ] && ok || fail "type errors in client"
else
  fail "node_modules missing"
fi

# 3. Test suite, against the migrated database from step 1. Never a fixture
#    schema: tier-1/2 invariants exist only as real DDL (CLAUDE.md).
step "test suite"
if [ -d node_modules ]; then
  if npx vitest run --root server >/tmp/r3-gate-test.log 2>&1; then
    ok
  else
    fail "tests failed — see /tmp/r3-gate-test.log"
    tail -30 /tmp/r3-gate-test.log
  fi
else
  fail "node_modules missing"
fi

# 3b. Client test suite. Separate run because it needs no database and must not
#     get one: these are pure-logic tests (routing, tier/duty comparison, nav
#     derivation), and a client test that reaches a database is testing the wrong
#     thing. Skipped until the first client test exists, for the same reason the
#     client typecheck is.
step "test suite (client)"
if [ -d node_modules ] && [ -n "$(find client/src -name '*.test.ts' -o -name '*.test.tsx' 2>/dev/null)" ]; then
  if npx vitest run --root client >/tmp/r3-gate-test-client.log 2>&1; then
    ok
  else
    fail "client tests failed — see /tmp/r3-gate-test-client.log"
    tail -30 /tmp/r3-gate-test-client.log
  fi
elif [ ! -d node_modules ]; then
  fail "node_modules missing"
else
  printf '  (no client tests yet)\n'
  ok
fi

# 4. No stubbed service functions. A wave that reports "complete" while leaving
#    a service throwing NotImplemented has moved work into the next wave without
#    saying so, and the report contract (§5.1) would not catch it.
step "no stubs in the service layer"
STUBS=$(grep -rnE "TODO|FIXME|not implemented|NotImplemented" server/src/services/ 2>/dev/null || true)
if [ -n "$STUBS" ]; then
  fail "stubbed or unfinished service code:"
  echo "$STUBS"
else
  ok
fi

# 4b. Nothing imports the `@r3/shared` package alias.
#
#     Agents build in git worktrees that share one node_modules by symlink
#     (build-plan §3), so `node_modules/@r3/shared` resolves to the MAIN
#     checkout's `shared/src` — not the copy in the worktree doing the work. A
#     lane editing shared types then typechecks against a DIFFERENT FILE than the
#     one it is writing, silently, right up until merge.
#
#     Wave 2's pwa lane proved this with `tsc --traceResolution` (A78) after the
#     identity lane had already hit it from the server side (A34). Both waves
#     worked around it by convention; a convention that has been rediscovered
#     twice is one the gate should hold instead. Server code imports
#     `shared/src/<area>.ts` by relative path; client code goes through
#     `client/src/api/shared.ts`.
#
#     Comments naming the alias are fine — this looks for imports only. Backticks and
#     `require.resolve` are matched too: both are ways *past* the check rather than
#     plausible accidents, and a gate with a known hole is worse than no gate.
step "no @r3/shared package imports (worktrees resolve it to the wrong tree)"
ALIAS=$(grep -rnE "(from|import|require(\.resolve)?)[[:space:]]*\(?[[:space:]]*['\"\`]@r3/shared" \
          server/src server/test client/src shared/src 2>/dev/null || true)
if [ -n "$ALIAS" ]; then
  fail "import the source by relative path instead — see A34 / A78:"
  echo "$ALIAS"
else
  ok
fi

# 5. Generated types are not hand-edited. Schema flows one direction only:
#    DDL -> migration -> database -> generated types (architecture.md §4.6).
#    Editing types.ts to silence an error desyncs code from where invariants
#    are actually enforced.
step "db/types.ts matches the database"
if [ -d node_modules ] && [ -f server/src/db/types.ts ]; then
  cp server/src/db/types.ts /tmp/r3-types-before.ts
  if npm run --workspace @r3/server codegen >/dev/null 2>&1; then
    if diff -q /tmp/r3-types-before.ts server/src/db/types.ts >/dev/null; then
      ok
    else
      fail "db/types.ts is stale or hand-edited — regenerate it from the database"
      diff /tmp/r3-types-before.ts server/src/db/types.ts | head -20
    fi
  else
    fail "codegen did not run"
  fi
else
  fail "db/types.ts missing"
fi

printf '\n'
if [ "$FAILED" -eq 0 ]; then
  printf '\033[32m▸ GATE PASSED\033[0m (mechanical half — doc-qa still required)\n'
else
  printf '\033[31m▸ GATE FAILED\033[0m\n'
fi
exit "$FAILED"
