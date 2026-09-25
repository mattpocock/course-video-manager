#!/bin/bash

# Every file in apps/local/app/routes becomes a public route. A test file or a
# utility module put there is served to the internet, so those live beside the
# feature they belong to instead.
#
# Default: staged files (pre-commit). `--all`: every tracked file (CI).

set -uo pipefail

ROUTES_DIR="apps/local/app/routes"

if [ "${1:-}" = "--all" ]; then
  files=$(git ls-files "$ROUTES_DIR")
else
  files=$(git diff --cached --name-only --diff-filter=d -- "$ROUTES_DIR")
fi

[ -z "$files" ] && exit 0

offenders=$(echo "$files" | grep -E '\.(test|spec)\.(ts|tsx)$|[-.](utils|helpers)\.(ts|tsx)$|/__tests__/' || true)

if [ -n "$offenders" ]; then
  echo ""
  echo "ERROR: These files are inside $ROUTES_DIR, which is public routing:"
  echo ""
  echo "$offenders" | sed 's/^/  /'
  echo ""
  echo "Move each one next to the feature it serves. Routes hold routes only."
  exit 1
fi
