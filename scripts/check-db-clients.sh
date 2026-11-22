#!/bin/bash

# Every database connection this repo opens goes through the connection guard
# (packages/core/db/connection-guard.ts): from a git worktree, no writable
# connection to a remote database. Shell cannot call the guard at all, so a
# shell script that talks to a database is listed below with its reason.
#
# This is the shell half of the database-client guard. The JS/TS half is the
# lint rule local/db-clients (lint/rules/db-clients.js), whose override in
# .oxlintrc.json lists the guarded factories and the clients that cannot use
# one.
#
# Flags, in shell files outside the ALLOWLIST: psql / pg_dump / pg_restore /
# pg_dumpall, and $DATABASE_URL / $DIRECT_DATABASE_URL.
#
# Default: staged files (pre-commit). `--all`: every tracked file (CI), which
# also fails on an ALLOWLIST entry that no longer matches, so the list only
# ever shrinks.

# Shell that legitimately talks to a database. THIS LIST MUST NOT GROW. Each
# entry says why it cannot go through a factory.
ALLOWLIST=(
  # verify-cvm: psql against its localhost clones and the local template;
  # production only with PGOPTIONS default_transaction_read_only=on.
  .claude/skills/verify-cvm/scripts/verify-db.sh
  .claude/skills/verify-cvm/scripts/verify-ledger.sh
  .claude/skills/verify-cvm/scripts/verify.sh
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

# Prints "line:text" for every database tool or DB-URL use in shell file $1.
matches_in() {
  case "$1" in
    *.sh)
      grep -nP "$SH_PATTERN" "$1" | grep -vP '^\d+:\s*#' || true ;;
  esac
}

found_violations=0

while IFS= read -r file; do
  [ "$file" = "$SELF" ] && continue
  in_list "$file" "${ALLOWLIST[@]}" && continue
  case "$file" in
    node_modules/*|*/node_modules/*) continue ;;
  esac

  matches=$(matches_in "$file")
  if [ -n "$matches" ]; then
    if [ "$found_violations" -eq 0 ]; then
      echo ""
      echo "ERROR: a shell script talks to a database outside the ALLOWLIST:"
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
      echo "ERROR: $file is on the ALLOWLIST in $SELF but no longer runs a"
      echo "database tool or reads a DB URL. Remove it from the list."
      found_violations=1
    fi
  done
fi

if [ "$found_violations" -eq 1 ]; then
  echo ""
  echo "Shell cannot run the connection guard (packages/core/db/connection-guard.ts),"
  echo "which stops a git worktree opening a writable connection to production. Write the"
  echo "script in TypeScript and build its client through a factory:"
  echo "  app / server code   DrizzleService"
  echo "  one-off DB scripts  scriptPgClient() / scriptDrizzle() from apps/local/scripts/script-database-url.ts"
  echo "  tests               createTestDb() / createBlankDb() / withQueryLog() from packages/core/test-utils/test-db.ts"
  echo "  the URL alone       resolveDatabaseUrl() from @cvm/core/db/database-url"
  echo "Do not add to the ALLOWLIST in $SELF."
  exit 1
fi
