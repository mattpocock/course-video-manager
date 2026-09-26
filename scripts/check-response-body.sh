#!/bin/bash

# A file becomes a response body through `webFileStream`, and no other way.
#
# THE CRASH THIS GUARDS (#1722). A Node read stream is not a `ReadableStream`,
# so `new Response(createReadStream(path))` compiles only behind a cast. undici
# then sees an object it does not recognise, notices it is async-iterable, and
# wraps it in its own `ReadableStreamFrom` — which closes its controller inside a
# `queueMicrotask`. A browser that abandons the request in that one microtask
# closes the stream first, and the close then throws from a microtask with
# nothing to catch it: an uncaught exception that takes the whole server down,
# with a stack naming only `undici` and never the route that served the file.
#
# Eight routes had this, each one copied from the last. No type could catch it,
# because the cast is what turned the type off. So it is caught here.
#
# `apps/local/app/services/web-file-stream.server.ts` is the one place a read
# stream belongs: it converts with `Readable.toWeb`, which needs no cast and has
# no such window.

# CI ONLY, unlike the other four guards: this one is in `pnpm run check`, which
# the Check workflow runs on every PR, and NOT in `.husky/pre-commit`. Nothing
# about it is slow — it is a grep, 0.2s of it — but the commit hook is a hot loop
# and this pattern reaches a Response in a route, which CI sees long before the
# code can hurt anyone. Run it by hand whenever you like: `pnpm run
# check:response-body` for the staged files, `--all` for every tracked one.

# Default: staged files, for a run by hand. `--all`: every tracked file (CI).
file_list() {
  if [ "${1:-}" = "--all" ]; then
    git ls-files
  else
    git diff --cached --name-only --diff-filter=d
  fi
}

# A comment is prose, not code. The module comment in web-file-stream.server.ts
# quotes both banned patterns to explain them, and must not trip its own guard.
NOT_A_COMMENT='^[0-9]+[:-][[:space:]]*($|//|\*|/\*)'

# Where a read stream is allowed to exist.
STREAM_OWNER="apps/local/app/services/web-file-stream.server.ts"
# An upload to the OpenAI SDK, which takes a Node stream and never a Response.
STREAM_UPLOAD="apps/local/app/services/video-processing-service.ts"

found_violations=0

report() {
  if [ "$found_violations" -eq 0 ]; then
    echo ""
    echo "ERROR: a file must reach a Response through webFileStream:"
    echo ""
  fi
  found_violations=1
  echo "$1" | while IFS= read -r match; do
    echo "  $2:$match"
  done
}

while IFS= read -r file; do
  case "$file" in
    *.ts|*.tsx|*.mts|*.mjs) ;;
    *) continue ;;
  esac
  [ "$file" = "$STREAM_OWNER" ] && continue

  # 1. `createReadStream` at all. Import style is irrelevant — a namespace
  #    import (`fs.createReadStream`) reaches it just as well as a named one.
  if [ "$file" != "$STREAM_UPLOAD" ]; then
    matches=$(grep -nP '\bcreateReadStream\b' "$file" | grep -vP "$NOT_A_COMMENT" || true)
    [ -n "$matches" ] && report "$matches" "$file"
  fi

  # 2. A cast inside a `new Response(...)`, whatever it is casting. The cast is
  #    the carrier: it is the only reason the broken body type-checked.
  matches=$(grep -n -A2 -P 'new Response\(' "$file" |
    grep -P '\bas any\b|\bas unknown as\b' |
    grep -vP "$NOT_A_COMMENT" || true)
  [ -n "$matches" ] && report "$matches" "$file"
done < <(file_list "${1:-}")

if [ "$found_violations" -eq 1 ]; then
  echo ""
  echo "Use webFileStream from @/services/web-file-stream.server. It converts with"
  echo "Readable.toWeb, so the body is already a web stream and undici never"
  echo "reaches for the async-iterable wrapper that crashes on a cancelled request."
  echo "Its own comment has the detail."
  exit 1
fi
