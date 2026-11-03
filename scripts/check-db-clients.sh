#!/bin/bash

# Every database connection this repo opens goes through the connection guard
# (packages/core/db/connection-guard.ts): from a git worktree, no writable
# connection to a remote database. The guard only runs where a client is built
# by one of the GUARDED factories below — code that builds its own client, or
# reads the connection string itself, bypasses it.
#
# Flags, anywhere outside those factories and the ALLOWLIST:
#   TS/JS:  new Pool( / new Client( (bare or `pg.`), postgres(, neon(,
#           drizzle(, new PGlite(, and READS of process.env.DATABASE_URL /
#           DIRECT_DATABASE_URL (dot, bracket or destructured). Assigning or
#           deleting the variable is not a read and is not flagged.
#   Shell:  psql / pg_dump / pg_restore / pg_dumpall, and $DATABASE_URL /
#           $DIRECT_DATABASE_URL — shell cannot call the guard at all.
#
# Build a client through a factory instead:
#   app / server code   DrizzleService (@cvm/core/services/drizzle-service.server)
#   one-off DB scripts  scriptPgClient() / scriptDrizzle()
#                       (apps/local/scripts/script-database-url.ts)
#   tests               createTestDb() / createBlankDb() / withQueryLog()
#                       (packages/core/test-utils/test-db.ts)
#   the URL alone       resolveDatabaseUrl() (@cvm/core/db/database-url)
#
# Default: staged files (pre-commit). `--all`: every tracked file (CI), which
# also fails on an ALLOWLIST entry that no longer matches, so the list only
# ever shrinks.

# The factories that run the guard before they connect.
GUARDED=(
  packages/core/services/drizzle-service.server.ts
  apps/local/scripts/script-database-url.ts
)

# Code that legitimately builds its own client. THIS LIST MUST NOT GROW: a new
# client goes through a factory above. Each entry says why it cannot.
ALLOWLIST=(
  # Vercel build step (#2655): plain .mjs, no TypeScript step. Its only gates
  # are VERCEL_ENV=production and assert-production-source.mjs (GitHub's main,
  # cloned); the worktree guard has nothing to say about a Vercel clone.
  apps/remote/scripts/migrate-on-deploy.mjs
  # The test Postgres (ADR 0046): builds every test client, and refuses any
  # server but a local one before it connects.
  packages/core/test-utils/test-postgres.ts
  # verify-cvm: psql against its localhost clones and the local template;
  # production only with PGOPTIONS default_transaction_read_only=on.
  .claude/skills/verify-cvm/scripts/verify-db.sh
  .claude/skills/verify-cvm/scripts/verify-ledger.sh
  .claude/skills/verify-cvm/scripts/verify.sh
  # verify-cvm: migrates the run's clone; refuses anything but
  # localhost:5433/cvm_verify_<id> before it connects (stricter than the guard).
  .claude/skills/verify-cvm/scripts/migrate-clone.mjs
  # verify-cvm's template: creates the local template database, and refreshes
  # it from a read-only pg_dump of production.
  scripts/setup-verify-db.sh
  scripts/verify-snapshot.sh
  # Human-run shell: pg_dump production into a local container.
  apps/local/scripts/clone-db-to-local.sh
  # Human-run wizard for the one-off PlanetScale cutover.
  scripts/cutover-wizard.sh
)

SELF="scripts/check-db-clients.sh"

TS_PATTERN='\bnew\s+(?:pg\.)?(?:Pool|Client)\s*\(|\bpostgres\s*\(|\bneon\s*\(|\bdrizzle\s*\(|\bnew\s+PGlite\s*\(|(?<!delete )process\.env(?:\.|\[\s*["'"'"'`])(?:DIRECT_)?DATABASE_URL\b(?!(?:["'"'"'`]\s*\])?\s*=(?!=))|\{[^}]*\b(?:DIRECT_)?DATABASE_URL\b[^}]*\}\s*=\s*process\.env\b'
SH_PATTERN='(?:^|[\s;|&(`"]|\$\()(?:psql|pg_dump|pg_restore|pg_dumpall)(?=\s|$|")|\$\{?(?:DIRECT_)?DATABASE_URL\b'

file_list() {
  if [ "${1:-}" = "--all" ]; then
    git ls-files
  else
    git diff --cached --name-only --diff-filter=d
  fi
}

in_list() {
  local needle="$1"
  shift
  local item
  for item in "$@"; do
    [ "$item" = "$needle" ] && return 0
  done
  return 1
}

# Prints "line:text" for every client construction or DB-URL read in $1.
matches_in() {
  case "$1" in
    *.ts|*.tsx|*.mts|*.cts|*.js|*.mjs|*.cjs)
      grep -nP "$TS_PATTERN" "$1" | grep -vP '^\d+:\s*(//|\*|/\*)' || true ;;
    *.sh)
      grep -nP "$SH_PATTERN" "$1" | grep -vP '^\d+:\s*#' || true ;;
  esac
}

found_violations=0

while IFS= read -r file; do
  [ "$file" = "$SELF" ] && continue
  in_list "$file" "${GUARDED[@]}" "${ALLOWLIST[@]}" && continue
  case "$file" in
    node_modules/*|*/node_modules/*) continue ;;
  esac

  matches=$(matches_in "$file")
  if [ -n "$matches" ]; then
    if [ "$found_violations" -eq 0 ]; then
      echo ""
      echo "ERROR: a database client built (or its URL read) outside the guarded factories:"
      echo ""
    fi
    echo "$matches" | while IFS= read -r match; do
      echo "  $file:$match"
    done
    found_violations=1
  fi
done < <(file_list "${1:-}")

if [ "${1:-}" = "--all" ]; then
  for file in "${ALLOWLIST[@]}"; do
    if [ ! -f "$file" ] || [ -z "$(matches_in "$file")" ]; then
      echo ""
      echo "ERROR: $file is on the ALLOWLIST in $SELF but no longer builds a"
      echo "client or reads a DB URL. Remove it from the list."
      found_violations=1
    fi
  done
fi

if [ "$found_violations" -eq 1 ]; then
  echo ""
  echo "A client built by hand skips the connection guard (packages/core/db/connection-guard.ts),"
  echo "which stops a git worktree opening a writable connection to production. Use a factory:"
  echo "  app / server code   DrizzleService"
  echo "  one-off DB scripts  scriptPgClient() / scriptDrizzle() from apps/local/scripts/script-database-url.ts"
  echo "  tests               createTestDb() / createBlankDb() / withQueryLog() from packages/core/test-utils/test-db.ts"
  echo "  the URL alone       resolveDatabaseUrl() from @cvm/core/db/database-url"
  echo "Do not add to the ALLOWLIST in $SELF."
  exit 1
fi
