#!/bin/bash

# Run a long-lived turbo task and keep a copy of its output on disk, so what the
# server printed outlives the terminal it printed to.
#
# THE POINT IS THE AGENT. A crash in a loader, an unhandled rejection in a
# stream, a stack that names only `undici` — none of that is in a test, a build
# artifact or the database. It lives for a few seconds in a scrollback buffer,
# and an agent asked to fix it can work only from whatever the author thought to
# paste. With this, the agent reads the stack itself, and reads the log again
# after the fix to check that the page it broke now loads.
#
# Read it with `tail -100 .data/logs/<task>.log`. `.data/` is the log directory
# this repo already has — `VideoEditorLoggerService` writes its per-Video logs
# beside these — and it is gitignored whole.

set -uo pipefail

task="${1:?usage: run-with-log.sh <turbo-task>}"
log_dir=".data/logs"
log="$log_dir/$task.log"

mkdir -p "$log_dir"

# ONE RUN PER FILE. The only question anyone asks this log is "what did the
# server just do", and a month of appended runs buries the answer under its own
# history. The previous run goes when a new one starts, on purpose.
: >"$log"

# The colour codes come out. They are invisible in a terminal and they are
# rubbish in a file — a grep for an error message misses it because a bold
# escape sits in the middle of the word. `-u` keeps sed line-buffered, so a
# persistent task's output reaches both the terminal and the file as it happens
# rather than in 4KB blocks.
#
# The cost, stated plainly: the terminal loses colour too. Stripping only the
# file's copy needs a process substitution that is not waited for, which drops
# the last lines when the task is interrupted — and the last lines before a
# Ctrl-C are the ones worth keeping.
#
# turbo's `ui` is already `stream` repo-wide (turbo.json), which is the format
# that survives being written to a file: one prefixed line per line of output,
# no repainting. `pnpm exec` because this runs as a file, so turbo is not on
# PATH by itself.
pnpm exec turbo run "$task" --filter='!@cvm/overlay-renderer' 2>&1 |
  sed -u -E 's/\x1b\[[0-9;]*[a-zA-Z]//g' |
  tee "$log"

# turbo's status, not sed's and not tee's: a dev server that fails to start has
# to fail this script.
exit "${PIPESTATUS[0]}"
