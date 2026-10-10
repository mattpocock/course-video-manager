#!/bin/bash

# Every environment variable the code reads must have a line in .env.example,
# so a fresh checkout fails at startup with a name, not at minute thirteen of a
# render. Reads `process.env.NAME` and `Config.*("NAME")`.
#
# Default: staged files (pre-commit). `--all`: every tracked file (CI).

set -uo pipefail

# Supplied by the runtime or by the workflow that spawns the process, never
# by .env: OUTPUT_DIR and TSX_TSCONFIG_PATH belong to the .sandcastle harness;
# the VERCEL_* keys are Vercel system variables, set in its build.
RUNTIME_KEYS=(CI NODE_ENV VITEST OUTPUT_DIR TSX_TSCONFIG_PATH PATH
  VERCEL_ENV VERCEL_GIT_PROVIDER VERCEL_GIT_COMMIT_REF VERCEL_GIT_COMMIT_SHA)

# Known gaps, from before this check existed. THIS LIST ONLY SHRINKS — document
# the key in .env.example and delete its line here. Do not add one.
KNOWN_GAPS=(
  AI_HERO_BASE_URL
  CLOUDINARY_URL
  KIT_SEQUENCE_URL
  OBS_RECORDING_DIR
)

if [ "${1:-}" = "--all" ]; then
  files=$(git ls-files '*.ts' '*.tsx' '*.mts' '*.mjs')
else
  files=$(git diff --cached --name-only --diff-filter=d -- '*.ts' '*.tsx' '*.mts' '*.mjs')
fi

[ -z "$files" ] && exit 0

# Keys the code reads.
used=$(echo "$files" | xargs -r grep -hoP '(?:process\.env\.|Config\.(?:string|number|boolean|redacted)\(")\K[A-Z_0-9]+' 2>/dev/null | sort -u)

# Keys .env.example documents, commented-out optional ones included.
documented=$(grep -oP '^#?\s*\K[A-Z_0-9]+(?==)' .env.example | sort -u)

ignored=$(printf '%s\n' "${RUNTIME_KEYS[@]}" "${KNOWN_GAPS[@]}" | sort -u)

missing=$(comm -23 <(echo "$used") <(printf '%s\n' "$documented" "$ignored" | sort -u))

if [ -n "$missing" ]; then
  echo ""
  echo "ERROR: These environment variables are read but absent from .env.example:"
  echo ""
  echo "$missing" | sed 's/^/  /'
  echo ""
  echo "Add each one, with a comment saying what it is for and whether it is optional."
  exit 1
fi
