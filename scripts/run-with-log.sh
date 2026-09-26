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
# Read the run you are in with `tail -100 .data/logs/<task>-latest.log`, or list
# the day's runs with `ls -t .data/logs/<task>-*.log`. `.data/` is the log
# directory this repo already has — `VideoEditorLoggerService` writes its
# per-Video logs beside these — and it is gitignored whole.

set -uo pipefail

task="${1:?usage: run-with-log.sh <turbo-task>}"
log_dir=".data/logs"

mkdir -p "$log_dir"

# ONE FILE PER RUN, NOT PER TASK. Two dev servers in two worktrees are normal
# here, and a single `dev.log` makes them fight: both truncate it at start, both
# write into it, and the file ends up a shuffle of two servers that reads like
# one broken one. The timestamp separates the runs; the PID separates two runs
# that start inside the same second.
log="$log_dir/$task-$(date +%Y-%m-%dT%H-%M-%S)-$$.log"
: >"$log"

# `<task>-latest.log` is the path to paste to an agent, so nobody has to know
# the timestamp. With several servers up it points at the one that started last
# — when that is the wrong one, `ls -t` above lists them all.
ln -sfn "$(basename "$log")" "$log_dir/$task-latest.log"

# ONE DAY OF HISTORY. Enough to read back this morning's crash, not so much
# that `.data/logs` becomes an archive nobody prunes. Age is taken from mtime,
# not from the name, so a server that has been up for two days keeps its log:
# it is still being written to.
#
# The glob is `<task>-*`, never `*.log`. The per-Video logs live in this same
# directory and are not ours to delete.
find "$log_dir" -maxdepth 1 -name "$task-*.log" \
  \( -type f -mmin +1440 -o -xtype l \) -delete 2>/dev/null

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
