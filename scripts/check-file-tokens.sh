#!/bin/bash

MAX_TOKENS=5500
found_violations=0

# Patterns to exclude from the check
EXCLUDE_PATTERNS=(
  "*.lock"
  "package-lock.json"
  "docs/*"
  "progress.txt"
  "public/*"
  "app/db/migrations/*"
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
