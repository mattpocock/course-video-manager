#!/bin/bash

# Prevent CJS __dirname/__filename in an ESM project.
# Use import.meta.dirname / import.meta.filename instead.

found_violations=0

while IFS= read -r file; do
  case "$file" in
    *.ts|*.tsx|*.js|*.mjs) ;;
    *) continue ;;
  esac

  matches=$(grep -nP '\b__dirname\b|\b__filename\b' "$file" | grep -vP '^\d+:\s*//' || true)
  if [ -n "$matches" ]; then
    if [ "$found_violations" -eq 0 ]; then
      echo ""
      echo "ERROR: CJS globals found — use import.meta.dirname / import.meta.filename instead:"
      echo ""
    fi
    echo "$matches" | while IFS= read -r match; do
      echo "  $file:$match"
    done
    found_violations=1
  fi
done < <(git diff --cached --name-only --diff-filter=d)

if [ "$found_violations" -eq 1 ]; then
  echo ""
  echo "This is an ESM project (\"type\": \"module\"). Use import.meta.dirname instead of __dirname."
  exit 1
fi
