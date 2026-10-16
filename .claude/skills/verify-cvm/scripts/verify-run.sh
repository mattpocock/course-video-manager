# Run half of verify.sh — sourced by it, never run on its own. A run is
# addressed by the id `launch` printed and nothing else, and it belongs to the
# worktree that launched it. Expects log, die, REPO_ROOT and STATE_DIR from
# verify.sh.
# shellcheck shell=bash

# --- off Matt's desk --------------------------------------------------------
# The browser side of the CVM connects to the Stream Deck forwarder hub
# (ws://localhost:5172 — Stream Deck presses, teleprompter controls, browser
# link-capture). A run's editor on that hub acts on Matt's real button presses.
# Every run points it at the discard port, where nothing answers: the run
# hears nothing from his desk and his desk hears nothing from the run.
# Read by apps/local/app/lib/live-channels.ts.
LIVE_CHANNELS_OFF=(
  "VITE_STREAM_DECK_HUB_URL=ws://127.0.0.1:9"
)

# Read the address back from the module the run's own server serves its
# pages: proof, not hope, that its editor cannot join Matt's hub.
desk_isolated() {
  local src; src="$(curl -sf "http://localhost:$1/app/lib/live-channels.ts")" || return 1
  [ "$(grep -o 'ws://127\.0\.0\.1:9"' <<< "$src" | wc -l)" -ge 1 ]
}

# --- who holds the port ---------------------------------------------------
# Prints the listener on port $1 that belongs to run pid $2 — $2 itself, or a
# DIRECT child of it (`react-router dev` relaunches itself as a child node
# process, and the child binds the port) — else `other`, or `none` when nothing
# listens. A grandchild, or any other process, is `other`.
port_owner() {
  local owner p child=""
  owner="$(ss -ltnp 2>/dev/null | grep ":$1 " || true)"
  [ -n "$owner" ] || { echo none; return 0; }
  for p in $(grep -oE 'pid=[0-9]+' <<< "$owner" | cut -d= -f2 | sort -u || true); do
    [ "$p" = "$2" ] && { echo "$p"; return 0; }
    if [ "$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')" = "$2" ]; then child="$p"; fi
  done
  echo "${child:-other}"
}

# --- finding a run --------------------------------------------------------
# A run is live when the server it recorded is still alive. That is the only
# registry: no shared "current" pointer to clobber, so two runs never collide.
live_runs() {
  local d pid
  for d in "$STATE_DIR"/run-*; do
    [ -f "$d/server.pid" ] || continue
    run_owned "$d" || continue
    pid="$(cat "$d/server.pid")"
    kill -0 "$pid" 2>/dev/null && printf '%s\n' "$d"
  done
  return 0
}

RUN_ID_RE='^[0-9]{8}-[0-9]{6}-[0-9]+$'

# The checkout a run was launched from: the `checkout` file launch writes first,
# or run.txt's line for a run an older verify.sh launched.
run_checkout() {
  if [ -f "$1/checkout" ]; then cat "$1/checkout"
  else sed -n 's/^checkout:[[:space:]]*//p' "$1/run.txt" 2>/dev/null | head -1
  fi
}
run_owned() { [ "$(run_checkout "$1")" = "$REPO_ROOT" ]; }

# The run a verb acts on, from the id `launch` printed — and nothing else.
# Never a guess: a missing id, an id this worktree did not launch, or a path
# outside this worktree's .verify/ is an error, so one agent's command can
# never land on another agent's server, browser or database.
RUN_DIR=""
resolve_run() {
  local handle="${1:-}" id dir
  [ -n "$handle" ] || die "no run id — every verb after launch takes the id launch printed: verify.sh ${VERB:-<verb>} <run-id> …
  There is no default run. Your live runs in this worktree:
$(live_runs | sed 's#^.*/run-#    #' | grep . || echo '    (none)')"
  case "$handle" in
    */*)
      [ -d "$handle" ] || die "run $handle: no such directory"
      [ "$(cd "$handle" && pwd -P)" = "$(cd "$STATE_DIR" 2>/dev/null && pwd -P)/$(basename "$handle")" ] ||
        die "run $handle is not in this worktree's $STATE_DIR — it belongs to another checkout; refusing"
      handle="$(basename "$handle")" ;;
  esac
  id="${handle#run-}"
  [[ "$id" =~ $RUN_ID_RE ]] || die "'$handle' is not a run id (want e.g. 20261007-141025-2353133, as launch printed)"
  dir="$STATE_DIR/run-$id"
  [ -d "$dir" ] || die "no run $id in this worktree ($STATE_DIR) — a run belongs to the worktree that launched it"
  local owner; owner="$(run_checkout "$dir")"
  [ "$owner" = "$REPO_ROOT" ] ||
    die "run $id was launched from ${owner:-an unknown checkout}, not this worktree ($REPO_ROOT) — refusing to touch another agent's run"
  RUN_DIR="$dir"
}

# For the sourced guard verbs: the run the dispatcher resolved.
run_dir() {
  [ -n "$RUN_DIR" ] || die "internal: no run resolved"
  printf '%s\n' "$RUN_DIR"
}

run_port()    { cat "$(run_dir)/server.port"; }
run_session() { cat "$(run_dir)/browser-session"; }
run_base()    { printf 'http://localhost:%s\n' "$(run_port)"; }

# --- the browser ------------------------------------------------------------
# agent-browser, pinned to this run's session and this run's server. Nothing
# from the environment or the arguments can point it at another session.
AB_REFUSED_FLAGS='--session --session-name --profile --state --auto-connect --cdp'
run_ab() {
  local session port a; session="$(run_session)"; port="$(run_port)"
  for a in "$@"; do
    case " $AB_REFUSED_FLAGS " in *" ${a%%=*} "*)
      die "'$a' is not yours to set — 'verify.sh ab' pins this run's own session ($session)" ;; esac
    if [[ "$a" =~ ^(https?://)?(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:([0-9]+))? ]] &&
       [ "${BASH_REMATCH[4]:-80}" != "$port" ]; then
      die "$a is not this run's server (http://localhost:$port) — refusing to drive another server"
    fi
  done
  [ "${1:-}" = close ] && [ "${2:-}" = --all ] && die "'close --all' would close every agent's browser — use 'cleanup <run>'"
  # A path after open/goto/navigate means a page of this run's server.
  if [ "$#" -ge 2 ] && [[ "$1" =~ ^(open|goto|navigate)$ ]] && [[ "$2" == /* ]]; then
    set -- "$1" "http://localhost:$port$2" "${@:3}"
  fi
  env -u AGENT_BROWSER_SESSION -u AGENT_BROWSER_SESSION_NAME -u AGENT_BROWSER_PROFILE -u AGENT_BROWSER_STATE \
    agent-browser --session "$session" "$@"
}

evidence_name() {
  local name="${1:-}" ext="$2"
  name="${name%"$ext"}"
  [[ "$name" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] ||
    die "evidence name '${1:-}' must be a plain file name (letters, digits, . _ -) — it lands in this run's evidence directory"
  printf '%s/%s%s\n' "$(run_dir)" "$name" "$ext"
}

cmd_shot() {
  local f; f="$(evidence_name "${1:-}" .png)"; shift || true
  run_ab screenshot "$f" "$@" >&2
  echo "$f"
}

cmd_snap() {
  local f; f="$(evidence_name "${1:-}" .snapshot.txt)"; shift || true
  run_ab snapshot "$@" | tee "$f"
  log "snap: saved $f"
}


# --- the run's sidecar --------------------------------------------------------
# A test-clone run gets a background-jobs sidecar of its own
# (apps/local/sidecar/), on the run's clone and nothing else: same DATABASE_URL,
# same scratch directories and dud credentials as its server. Its socket is a
# Unix socket, never a port, so it can never land in either band. The socket
# lives in $XDG_RUNTIME_DIR (else /tmp) because a run directory's path is too
# long for one (a Unix socket path is capped at 107 bytes); it is named by the
# run id, so no two runs share it, and cleanup removes it. The sidecar's own
# output goes to <run>/sidecar.log and each Job's log to <run>/logs/jobs/.
SIDECAR_ENV=()

# Some hosts (WSL with no systemd login session) export
# XDG_RUNTIME_DIR=/run/user/<uid> without creating it; the sidecar's mkdir of
# the socket's parent then dies on EACCES. A runtime dir that is not a
# writable directory is no runtime dir: unset it (this process and its
# children only), so the socket falls back to /tmp. Runs at source time.
if [ -n "${XDG_RUNTIME_DIR:-}" ] && ! { [ -d "$XDG_RUNTIME_DIR" ] && [ -w "$XDG_RUNTIME_DIR" ]; }; then
  log "env: XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR is not a writable directory — unset for this run (sidecar socket goes to /tmp)"
  unset XDG_RUNTIME_DIR
fi

sidecar_socket_for() { printf '%s/cvm-sidecar-%s.sock\n' "${XDG_RUNTIME_DIR:-/tmp}" "$1"; }
run_sidecar_socket() { cat "$1/sidecar.socket" 2>/dev/null || true; }
run_sidecar_pid()    { cat "$1/sidecar.pid" 2>/dev/null || true; }

# sidecar_health <socket> — the sidecar's /health answer, or nothing.
sidecar_health() {
  [ -S "$1" ] || return 1
  curl -sf --max-time 3 --unix-socket "$1" http://sidecar/health
}

# start_sidecar <run dir> <run id> — start it and wait for its socket to answer.
start_sidecar() {
  local dir="$1" socket pid _
  socket="$(sidecar_socket_for "$2")"
  echo "$socket" > "$dir/sidecar.socket"
  mkdir -p "$dir/logs/jobs"
  # `node --import tsx`, not the tsx CLI: the CLI runs the script in a child
  # process, and the pid recorded here must be the sidecar itself.
  ( cd "$REPO_ROOT/apps/local" &&
    exec env "${SIDECAR_ENV[@]}" "CVM_SIDECAR_SOCKET=$socket" "CVM_SIDECAR_LOG_DIR=$dir/logs/jobs" \
      nohup node --import tsx sidecar/run-sidecar.ts > "$dir/sidecar.log" 2>&1 ) &
  pid=$!
  echo "$pid" > "$dir/sidecar.pid"
  for _ in $(seq 1 60); do
    sidecar_health "$socket" > /dev/null && return 0
    kill -0 "$pid" 2>/dev/null || return 1
    sleep 1
  done
  return 1
}

# launch_sidecar <run dir> <run id> <mode> — launch's step, once the server
# answers. A sidecar that does not come up stops the server and fails the launch.
# The sidecar shares the server's environment (SERVER_ENV) but not its
# PGAPPNAME (the Ledger's way to tell their writes apart) nor its
# statement log: its polling would bury the app's in no time, and the clone's
# triggers already count its writes, on a line of their own in the Ledger.
launch_sidecar() {
  local dir="$1" e
  if [ "$3" != test-clone ]; then
    log "sidecar:  none — production is read-only, so a sidecar could not hold its lease"
    return 0
  fi
  for e in "${SERVER_ENV[@]}"; do
    case "$e" in CVM_LOG_SQL=*|PGAPPNAME=*) ;; *) SIDECAR_ENV+=("$e") ;; esac
  done
  # Its own application_name, so the Ledger lists its writes apart from the server's.
  SIDECAR_ENV+=("PGAPPNAME=$LEDGER_APP_SIDECAR")
  start_sidecar "$dir" "$2" || {
    tail -20 "$dir/sidecar.log" >&2
    stop_sidecar "$dir"; stop_server "$dir"
    die "the run's sidecar did not come up — see $dir/sidecar.log"
  }
  log "sidecar:  pid $(run_sidecar_pid "$dir"), socket $(run_sidecar_socket "$dir"), job logs in $dir/logs/jobs"
  echo "sidecar:   pid $(run_sidecar_pid "$dir") socket $(run_sidecar_socket "$dir")" >> "$dir/run.txt"
}

# stop_sidecar <run dir> — SIGTERM, so it puts its running Jobs back and lets
# go of its lease, then make sure nothing is left on its socket. Cleanup calls
# it before it stops the server and drops the clone, while the clone is there.
stop_sidecar() {
  local dir="$1" pid socket _
  pid="$(run_sidecar_pid "$dir")"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid" 2>/dev/null || true
    for _ in $(seq 1 40); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
    if kill -0 "$pid" 2>/dev/null; then
      kill -KILL "$pid" 2>/dev/null || true
      log "cleanup: sidecar pid $pid ignored SIGTERM for 10s — killed it"
    else
      log "cleanup: stopped sidecar pid $pid"
    fi
  fi
  socket="$(run_sidecar_socket "$dir")"
  if [ -n "$socket" ] && [ -e "$socket" ]; then
    rm -f "$socket"
    log "cleanup: removed the sidecar's leftover socket $socket"
  fi
}

# The run's sidecar: alive, answering on its own socket, and holding the lease
# in THIS run's clone (its lease row names the clone and the sidecar's pid).
doctor_sidecar() {
  local dir="$1" pid socket health lease clone fail=0
  if [ "$(run_mode "$dir")" != test-clone ]; then log "ok   no sidecar: production is read-only"; return 0; fi
  pid="$(run_sidecar_pid "$dir")"; socket="$(run_sidecar_socket "$dir")"
  clone="$(run_clone_name "$dir")"
  if [ -z "$pid" ]; then log "FAIL no sidecar was started for this run"; return 1; fi
  kill -0 "$pid" 2>/dev/null &&
    log "ok   sidecar process $pid alive" || { log "FAIL sidecar process $pid gone — see $dir/sidecar.log"; fail=1; }
  if health="$(sidecar_health "$socket")" && grep -q "\"pid\":$pid[,}]" <<< "$health"; then
    log "ok   sidecar answers on its socket $socket"
  else
    log "FAIL nothing of this run's answers on $socket"; fail=1
  fi
  lease="$(psql_ro "$dir" -c 'select pid, database, lease_until > now() from "course-video-manager_sidecar_lease"' 2>/dev/null || true)"
  if [ "$lease" = "$pid|$clone|t" ]; then
    log "ok   sidecar holds the lease in $clone"
  else
    log "FAIL the sidecar lease in $clone is not this run's sidecar's (pid|database|live: ${lease:-no row})"; fail=1
  fi
  return "$fail"
}
