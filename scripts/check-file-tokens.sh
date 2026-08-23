#!/bin/bash

MAX_TOKENS=5500
found_violations=0

# Patterns to exclude from the check
EXCLUDE_PATTERNS=(
  "*.lock"
  "pnpm-lock.yaml"
  "docs/*"
  "progress.txt"
  "apps/local/public/*"
  "packages/core/db/migrations/*"
  # Vendored, generated, append-only icon data. It is committed on purpose
  # (see packages/lucide-icons/README.md) and is never hand-edited, so the
  # "split this into smaller modules" advice does not apply.
  "packages/lucide-icons/lib/generated/*"
  # The ubiquitous-language document, same category as docs/* above. It was
  # already over the limit before this exclusion existed.
  "CONTEXT.md"
  # The drizzle schema registry. drizzle-kit and `import * as schema` both
  # consume it as ONE module, so it grows by one table at a time and cannot be
  # split the way application code can.
  "packages/core/db/schema.ts"
  # The one-off cutover wizard. It is a runbook that a human reads and answers
  # from top to bottom at one terminal; sourcing it in fragments would hide the
  # order of the stages, which is the only thing it teaches. It was already over
  # the limit when it landed.
  "scripts/cutover-wizard.sh"
)

should_skip() {
  local file="$1"
  for pattern in "${EXCLUDE_PATTERNS[@]}"; do
    case "$file" in
      $pattern) return 0 ;;
    esac
  done
  return 1
}

while IFS= read -r file; do
  if should_skip "$file"; then
    continue
  fi

  # Skip binary files
  if file --mime-encoding "$file" 2>/dev/null | grep -q "binary"; then
    continue
  fi

  bytes=$(wc -c < "$file")
  tokens=$((bytes / 4))

  if [ "$tokens" -gt "$MAX_TOKENS" ]; then
    if [ "$found_violations" -eq 0 ]; then
      echo ""
      echo "ERROR: The following files exceed the ${MAX_TOKENS}-token limit:"
      echo ""
    fi
    echo "  $file (~${tokens} tokens)"
    found_violations=1
  fi
done < <(git diff --cached --name-only --diff-filter=d)

if [ "$found_violations" -eq 1 ]; then
  echo ""
  echo "Please split these files into smaller modules or test files."
  exit 1
fi
