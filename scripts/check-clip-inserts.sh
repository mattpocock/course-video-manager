#!/bin/bash

# A copy of a Clip must carry its Transcript Words, Clip Web Links and
# Overlays. copyClipsOntoVideo (packages/core/services/copy-child-rows.ts)
# does that, and the copy-path guards (copy-paths-table-guard.test.ts,
# copy-paths.round-trip.test.ts) hold every path in COPY_PATHS to it. A
# hand-written copy that is NOT in COPY_PATHS escapes both — so it can drop
# Clip children silently.
#
# Flags any insert into the clip table or a Clip child table (Drizzle
# `.insert(clips)`, `insertInChunks(tx, clips, …)`, or raw `INSERT INTO`)
# outside the allowlist below. Test files and test harnesses are exempt.

# Default: staged files (pre-commit). `--all`: every tracked file (CI).
file_list() {
  if [ "${1:-}" = "--all" ]; then
    git ls-files
  else
    git diff --cached --name-only --diff-filter=d
  fi
}

# Every file that may insert Clip rows, and why. Keep this short: a new entry
# should be a genuinely new way to CREATE a Clip, never a copy.
ALLOWLIST=(
  # The shared copy helper: copyClipsOntoVideo / copyClipChildren.
  "packages/core/services/copy-child-rows.ts"
  # Submit (COPY_PATHS.submit) and duplicateCourse (COPY_PATHS.duplicateCourse):
  # Version-level copies, children via copyClipChildren.
  "packages/core/services/db-version-copy.server.ts"
  "packages/core/services/db-course-duplicate.server.ts"
  # Fresh Clips: createClip / appendClips / createClipWebLinks.
  "packages/core/services/db-clip-operations.server.ts"
  # Fresh Clips cut by `cvm short create` (its copies go through
  # copyClipsOntoVideo, COPY_PATHS.shortCreate).
  "packages/core/services/db-short-create.server.ts"
  # Fresh Clips from recording: appendClips / insert-at-position.
  "apps/local/app/services/clip-service-handler.helpers.ts"
  # Fresh child rows on one existing Clip.
  "packages/core/services/db-overlay-operations.server.ts"
  "packages/core/services/db-transcript-word-operations.server.ts"
)

TABLES='(schema\.)?(clips|clipWebLinks|clipTranscriptWords|overlays)\b'
SQL_TABLES='"?(course-video-manager_)?(clip|clip_web_link|clip_transcript_word|overlay)"?(\s|\()'
PATTERN="\.insert\(\s*${TABLES}|insertInChunks\([^,]*,\s*${TABLES}|(?i:insert\s+into\s+)${SQL_TABLES}"

found_violations=0

# A moved or renamed file must take its allowlist entry with it.
for allowed in "${ALLOWLIST[@]}"; do
  if [ ! -f "$allowed" ]; then
    echo "ERROR: scripts/check-clip-inserts.sh allowlists $allowed, which does not exist."
    found_violations=2
  fi
done
[ "$found_violations" -eq 2 ] && exit 1

while IFS= read -r file; do
  case "$file" in
    *.ts|*.tsx|*.js|*.mjs|*.cjs|*.sql) ;;
    *) continue ;;
  esac
  case "$file" in
    *.test.*|*.spec.*|*/test-utils/*|*test-harness*|*/migrations/*) continue ;;
  esac
  for allowed in "${ALLOWLIST[@]}"; do
    [ "$file" = "$allowed" ] && continue 2
  done

  matches=$(grep -nP "$PATTERN" "$file" | grep -vP '^\d+:\s*(//|\*|/\*)' || true)
  if [ -n "$matches" ]; then
    if [ "$found_violations" -eq 0 ]; then
      echo ""
      echo "ERROR: Clip rows inserted outside the allowlist:"
      echo ""
    fi
    echo "$matches" | while IFS= read -r match; do
      echo "  $file:$match"
    done
    found_violations=1
  fi
done < <(file_list "${1:-}")

if [ "$found_violations" -eq 1 ]; then
  echo ""
  echo "Copies go through copyClipsOntoVideo (packages/core/services/copy-child-rows.ts)"
  echo "and must be listed in COPY_PATHS (packages/core/services/version-copy-manifest.ts),"
  echo "so the copy-path guards hold them to carrying every Clip child."
  echo "Creating genuinely fresh Clips? Add the file to ALLOWLIST in scripts/check-clip-inserts.sh."
  exit 1
fi
