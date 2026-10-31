#!/usr/bin/env bash
# Is Matt filming right now? Exit 0 = filming, 1 = not filming.
#
#   scripts/is-filming.sh          # silent; the exit code is the answer
#   scripts/is-filming.sh -v       # also prints why, on stdout
#
# Filming means a take is recording (or a Live Stream is on, or a stopped
# take is still closing its files). The recorder service logs "takes:
# recording" and "takes: none" as that changes, and "takes: none" straight
# after its "listening" line. So, in the run of the service since its last
# "listening" line:
#   - no log, or "stopped cleanly" last: not filming;
#   - its last "takes:" line says "recording": filming (a service that died
#     mid-take, with no "stopped cleanly", counts: its writers may still run);
#   - its last "takes:" line says "none": not filming (the app is only open);
#   - no "takes:" line at all: a service from older code, which can't tell,
#     so filming. When in doubt, Matt's footage comes first.
#
# The log is in Matt's main checkout, `.data/logs/recorder-service.log`, and
# never in a worktree, so the checkout is found through Git's common dir, from
# this script's own location: every worktree gets the same answer. Set
# CVM_RECORDER_LOG to read another file (tests).
#
# It only reads the log. It never contacts the recorder or Matt's app.
set -euo pipefail

verbose=0
[ "${1:-}" = "-v" ] && verbose=1
say() { [ "$verbose" -eq 0 ] || printf '%s\n' "$*"; }

log_path() {
  if [ -n "${CVM_RECORDER_LOG:-}" ]; then
    printf '%s\n' "$CVM_RECORDER_LOG"
    return
  fi
  local common
  common="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse \
    --path-format=absolute --git-common-dir)"
  printf '%s/.data/logs/recorder-service.log\n' "$(dirname "$common")"
}

LOG="$(log_path)"
if [ ! -f "$LOG" ]; then
  say "not filming: no recorder log at $LOG"
  exit 1
fi

last_line_number() { { grep -n -- "$1" "$LOG" || true; } | tail -n 1 | cut -d: -f1; }
listening="$(last_line_number "listening")"
stopped="$(last_line_number "stopped cleanly")"

if [ -z "$listening" ] || [ "$listening" -le "${stopped:-0}" ]; then
  say "not filming: ${stopped:+$(sed -n "${stopped}p" "$LOG")}"
  exit 1
fi

# The service is up: its own run's last "takes:" line decides.
takes="$(last_line_number " takes: ")"
if [ -z "$takes" ] || [ "$takes" -lt "$listening" ]; then
  say "filming: $(sed -n "${listening}p" "$LOG") (it logs no takes: older code, so assumed filming)"
  exit 0
fi
line="$(sed -n "${takes}p" "$LOG")"
case "$line" in
  *" takes: none"*)
    say "not filming: $line"
    exit 1
    ;;
esac
say "filming: $line"
exit 0
