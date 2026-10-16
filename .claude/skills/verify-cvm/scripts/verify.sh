#!/usr/bin/env bash
# Harness for the verify-cvm skill. One entry point, a handful of verbs.
#
#   verify.sh mode [--production]    which database `launch` would use (no connection)
#   verify.sh template          does the template exist, and how old is it (local Postgres only)
#   verify.sh launch [--production]  start a verification server, print its RUN ID
#
# Every verb below takes that run id as its first argument. There is no default
# run, no "latest", no environment variable: no id, no command.
#   verify.sh url <run>         base URL of the run's server
#   verify.sh dir <run>         the run's evidence directory
#   verify.sh session <run>     agent-browser session name for the run
#   verify.sh ab <run> <agent-browser args…>
#                               drive the run's own browser (relative URLs go to its server)
#   verify.sh shot <run> <name> [args]   screenshot into <evidence>/<name>.png
#   verify.sh snap <run> <name> [args]   snapshot into <evidence>/<name>.snapshot.txt
#   verify.sh doctor <run>      read-only "is this instance worth driving?" check
#   verify.sh guard <run> baseline   open the Write Ledger window
#   verify.sh guard <run> check      close it, write WRITE-LEDGER.md (exact: clone triggers + app SQL log)
#   verify.sh guard <run> forensics <table> [since]
#                               name the rows that moved in one table
#   verify.sh sql <run> "<query>"    read back from this run's test clone (test-clone mode only)
#   verify.sh tiny-course <run> seed the Tiny Course (1 Video, 1 Clip, seconds long) into
#                               the clone; prints its id. The only Course you Publish or encode.
#   verify.sh cvm <run> <cvm args…>
#                               the real `cvm` from this checkout, on this run's
#                               clone only: its own apps/remote on 127.0.0.1, a
#                               clone-only token, the local-only gate open for
#                               the clone. Refuses anything that is not loopback.
#                               A run's first `cvm diagram` waits for the run's app
#                               to serve its render page first.
#   verify.sh cleanup <run>     stop what this run started, drop its clone, keep the evidence
#   verify.sh cleanup --all     the same for every live run THIS worktree launched
#
# Two database modes, chosen at launch and recorded in the run directory:
#   test clone   THE DEFAULT. launch clones the template named by VERIFY_DATABASE_URL
#                (exported, or in ~/.config/cvm/verify.env) into cvm_verify_<run id>,
#                the server runs on that clone, cleanup drops it. Writes are allowed.
#                No template, no run: launch fails and says to ask Matt.
#   PRODUCTION   only with `launch --production`. The server uses .env's DATABASE_URL
#                with default_transaction_read_only on, so it cannot write at all.
#
# Runs are independent: several can drive at once. A run belongs to the
# worktree that launched it — its directory is <worktree>/.verify/run-<id> and
# it records that worktree — and a verb run from any other checkout refuses it.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
STATE_DIR="$REPO_ROOT/.verify"

# --- port bands -----------------------------------------------------------
# Two bands, and they never overlap. The CVM owns 5170-5199 — 5172 is the
# Stream Deck forwarder hub, 5173 Matt's dev server (pinned there by
# apps/local/vite.config.ts), 5174 the forwarder's HTTP side. Verification runs
# take 5200-5299. A run that lands in the CVM's band is driving the window Matt
# is looking at, so the band is checked, not hoped for.
CVM_BAND_MIN=5170
CVM_BAND_MAX=5199
VERIFY_BAND_MIN=5200
VERIFY_BAND_MAX=5299

in_cvm_band() { [ "$1" -ge "$CVM_BAND_MIN" ] && [ "$1" -le "$CVM_BAND_MAX" ]; }

log() { printf '%s\n' "$*" >&2; }
die() { log "FAIL: $*"; exit 1; }

# --- databases --------------------------------------------------------------
# Test clone vs production, URL helpers, clone/drop: all in verify-db.sh.
# shellcheck source=SCRIPTDIR/verify-db.sh
. "$(dirname "${BASH_SOURCE[0]}")/verify-db.sh"
# Template checks, clone creation, offline credentials, the stale-clone sweep.
# shellcheck source=SCRIPTDIR/verify-clones.sh
. "$(dirname "${BASH_SOURCE[0]}")/verify-clones.sh"

# --- runs and their browser -------------------------------------------------
# Resolving a run id to its directory (and refusing one this worktree did not
# launch), the browser verbs, and the channels that keep a run off Matt's desk.
# shellcheck source=SCRIPTDIR/verify-run.sh
. "$(dirname "${BASH_SOURCE[0]}")/verify-run.sh"

# --- picking a port -------------------------------------------------------
port_listening() { ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$1$"; }

# Ports a live sibling run recorded, in any worktree. A run holds its port from
# the moment it writes it, which is earlier than the moment the server listens.
ports_held_by_runs() {
  local d
  for d in $(all_run_dirs); do
    run_is_live "$d" || continue
    [ -f "$d/server.port" ] && cat "$d/server.port"
  done
  return 0
}

# The order launch tries. VERIFY_PORT, when set, is the whole list: an explicit
# address is a request, not a starting point.
candidate_ports() {
  if [ -n "${VERIFY_PORT:-}" ]; then
    printf '%s\n' "$VERIFY_PORT"
    return 0
  fi
  local held p
  held="$(ports_held_by_runs)"
  for p in $(seq "$VERIFY_BAND_MIN" "$VERIFY_BAND_MAX"); do
    printf '%s\n' "$held" | grep -qx "$p" && continue
    port_listening "$p" && continue
    printf '%s\n' "$p"
  done
}

# Extra environment for the dev server, as NAME=value words. launch fills it
# per mode: the clone's DATABASE_URL and scratch file directories in test-clone
# mode, the PlanetScale root certificate in production mode.
SERVER_ENV=()

# Start the server on exactly $2, or fail. Leaves no process behind on failure,
# so the caller can try the next port without leaking a half-started Vite.
start_server() {
  local dir="$1" wanted="$2"
  echo "$wanted" > "$dir/server.port"

  # `exec` replaces the subshell with the server, so $! is the server's own pid
  # and cleanup can kill exactly what this run started.
  ( cd "$REPO_ROOT/apps/local" &&
    exec env "${SERVER_ENV[@]}" "${LIVE_CHANNELS_OFF[@]}" nohup ./node_modules/.bin/react-router dev --port "$wanted" \
      > "$dir/server.log" 2>&1 ) &
  local pid=$!
  echo "$pid" > "$dir/server.pid"

  # Read the port the server actually took, not the one we asked for. Vite
  # colours its banner, so strip the escapes before matching.
  local announced="" _
  for _ in $(seq 1 60); do
    announced="$(sed -e 's/\x1b\[[0-9;]*m//g' "$dir/server.log" 2>/dev/null |
            grep -aoE 'Local:[[:space:]]+http://localhost:[0-9]+' |
            grep -oE '[0-9]+$' | head -1 || true)"
    [ -n "$announced" ] && break
    kill -0 "$pid" 2>/dev/null || break
    sleep 2
  done

  if [ "$announced" = "$wanted" ]; then return 0; fi

  # Either it died (strictPort refusing a taken port looks exactly like this)
  # or it answered somewhere we did not ask for. Neither is drivable.
  [ -n "$announced" ] &&
    log "launch: asked for $wanted, server announced $announced — refusing it"
  pkill -TERM -P "$pid" 2>/dev/null || true
  kill -TERM "$pid" 2>/dev/null || true
  sleep 1
  kill -KILL "$pid" 2>/dev/null || true
  rm -f "$dir/server.pid" "$dir/server.port"
  return 1
}

# --- launch ---------------------------------------------------------------
# The mode is the test clone unless the caller says --production, out loud, on
# this one command. Nothing in the environment flips a run onto production.
mode_from_args() {
  case "${1:-}" in
    "")           echo test-clone ;;
    --production) echo production ;;
    *)            die "unknown argument '$1' — the only option is --production" ;;
  esac
}

cmd_mode() {
  local mode t id
  mode="$(mode_from_args "${1:-}")"
  id="$(date +%Y%m%d-%H%M%S)-$$"
  if [ "$mode" = test-clone ]; then
    t="$(require_template_url)" || exit 1
    log "DB: test clone (writes allowed, dropped on cleanup)"
    log "  template:  $(url_redact "$t")"
    if [ -n "${VERIFY_DATABASE_URL:-}" ]; then log "  from:      the environment"; else log "  from:      $VERIFY_ENV_FILE"; fi
    log "  launch would run:  create database \"$(clone_name_for "$id")\" template \"$(url_db "$t")\""
    log "  and start the server with DATABASE_URL=$(url_redact "$(url_with_db "$t" "$(clone_name_for "$id")")")"
    log "  '$0 template' checks the template exists and how old it is."
  else
    log "DB: PRODUCTION (read-only: the server cannot write)"
    log "  launch --production would start the server on .env's DATABASE_URL"
    log "  with default_transaction_read_only=on."
  fi
  echo "$mode"
}

cmd_template() {
  local t; t="$(require_template)" || exit 1
  log "template: $(url_db "$t") on $(url_host "$t") — $(psql_admin -At -c "select pg_size_pretty(pg_database_size('$(url_db "$t")'))")"
  report_template_age "$t"
}

cmd_launch() {
  local mode; mode="$(mode_from_args "${1:-}")"
  local template=""
  if [ "$mode" = test-clone ]; then
    template="$(require_template)" || exit 1
    [ -f "$REPO_ROOT/.env" ] &&
      log "warn $REPO_ROOT/.env exists — the clone's DATABASE_URL overrides it, but its other keys (Dropbox, Anthropic, …) still load into the server. A test-clone run needs no .env; remove the symlink."
  else
    [ -f "$REPO_ROOT/.env" ] ||
      die "no .env at $REPO_ROOT/.env — --production needs the main checkout's one: ln -s ../../.env $REPO_ROOT/.env"
  fi

  if [ -n "${VERIFY_PORT:-}" ] && in_cvm_band "$VERIFY_PORT"; then
    die "VERIFY_PORT=$VERIFY_PORT is in the CVM's band ($CVM_BAND_MIN-$CVM_BAND_MAX) — that port is Matt's own CVM, not yours. Use $VERIFY_BAND_MIN-$VERIFY_BAND_MAX."
  fi

  # Clones a crashed run left behind, in this checkout or any sibling worktree.
  if [ "$mode" = test-clone ]; then
    sweep_stale_clones || log "warn the sweep of stale clones failed — carrying on"
  fi

  if [ -L "$STATE_DIR" ]; then
    log "warn $STATE_DIR is a symlink to $(readlink "$STATE_DIR") — other worktrees' runs may sit beside yours there. Each is still refused by id, but a plain directory keeps them apart: rm $STATE_DIR"
  fi

  local id dir
  id="$(date +%Y%m%d-%H%M%S)-$$"
  dir="$STATE_DIR/run-$id"
  mkdir -p "$dir"
  # Ownership first: every later verb checks it before touching the run.
  echo "$REPO_ROOT" > "$dir/checkout"
  # While launch runs, its own pid is what marks the run live, so a sibling's
  # sweep never takes a clone whose server has not started yet.
  echo "$$" > "$dir/launch.pid"
  echo "verify-cvm-$id" > "$dir/browser-session"
  echo "$mode" > "$dir/db-mode"

  if [ "$mode" = test-clone ]; then
    local clone; clone="$(clone_name_for "$id")"
    # Recorded before it exists, so a failed launch still knows what to drop.
    echo "$clone" > "$dir/db-name"
    # From here on, any failure drops the clone: no orphaned databases.
    trap 'drop_run_clone "'"$dir"'" >/dev/null 2>&1 || true' EXIT
    create_clone "$(url_db "$template")" "$clone"
    log "launch: cloned $(url_db "$template") into $clone"
    # The template only moves when Matt runs `pnpm db:verify-snapshot`, so it
    # lags every merged migration. Bring the CLONE (never the template) up to
    # this checkout's migrations — before the Ledger's triggers, so the
    # migration's own writes are not counted as the run's.
    migrate_run_clone "$(url_with_db "$template" "$clone")" "$clone" 2> >(tee "$dir/migrations.txt" >&2) ||
      die "could not apply this checkout's migrations to $clone — the server would run on a stale schema, so the run stops here"
    # The Write Ledger's triggers go in before the server can write anything.
    install_write_ledger "$(url_with_db "$template" "$clone")" ||
      die "could not install the write ledger on $clone — the Ledger would be blind, so the run stops here"

    local clone_url; clone_url="$(url_with_db "$template" "$clone")"
    # Age read from the clone, not the template: a connection on the template
    # would block a sibling's clone.
    report_template_age "$clone_url" 2> >(tee "$dir/template-age.txt" >&2)
    clone_app_env "$dir" "$clone_url"
    SERVER_ENV=(
      "${CLONE_APP_ENV[@]}"
      # For the Write Ledger: every statement into server.log; who wrote what.
      "CVM_LOG_SQL=1"
      "PGAPPNAME=$LEDGER_APP_SERVER"
    )
  else
    # The app's own connections are read-only (node-postgres reads PGOPTIONS):
    # production cannot take a write from this run, whatever gets clicked.
    # PlanetScale wants the system root certificate.
    # CVM_LOG_SQL: every statement the app sends lands in server.log, which is
    # what the Write Ledger reads to prove this run sent no write.
    SERVER_ENV=("PGSSLROOTCERT=system" "PGOPTIONS=$PSQL_RO_OPTIONS" "CVM_LOG_SQL=1")
  fi

  # Pick a port out of the verification band and ask for exactly it. Vite runs
  # with strictPort, so a taken port fails startup rather than drifting into the
  # CVM's band. VERIFY_PORT overrides the pick. The app gets the run's socket.
  SERVER_ENV+=("CVM_SIDECAR_SOCKET=$(sidecar_socket_for "$id")")
  local wanted port="" pid=""
  for wanted in $(candidate_ports); do
    if start_server "$dir" "$wanted"; then port="$wanted"; break; fi
    log "launch: port $wanted did not come up — trying the next one"
  done
  [ -n "$port" ] ||
    die "no free port in $VERIFY_BAND_MIN-$VERIFY_BAND_MAX — run 'verify.sh cleanup --all' to free the band"
  pid="$(cat "$dir/server.pid")"

  local db_line
  if [ "$mode" = test-clone ]; then
    db_line="DB: test clone $(cat "$dir/db-name") (writes allowed, dropped on cleanup)"
  else
    db_line="DB: PRODUCTION (read-only: the server cannot write)"
  fi

  {
    echo "started:   $(date --iso-8601=seconds)"
    echo "checkout:  $REPO_ROOT"
    echo "branch:    $(git -C "$REPO_ROOT" branch --show-current)"
    echo "commit:    $(git -C "$REPO_ROOT" rev-parse --short HEAD)"
    echo "port:      $port"
    if [ "$mode" = test-clone ]; then
      echo "db:        test clone $(cat "$dir/db-name") of $(url_db "$template") on $(url_host "$template")"
    else
      echo "db host:   $(db_host) (PRODUCTION, server read-only)"
    fi
    echo "session:   verify-cvm-$id"
  } > "$dir/run.txt"

  local i
  for i in $(seq 1 30); do
    if curl -sf -o /dev/null "http://localhost:$port/"; then
      desk_isolated "$port" || { stop_server "$dir"; die "the server's pages still point at Matt's Stream Deck hub — refusing to run"; }
      launch_sidecar "$dir" "$id" "$mode"
      trap - EXIT
      rm -f "$dir/launch.pid"
      log "$db_line"
      log "ready:    http://localhost:$port/  (pid $pid)"
      log "session:  verify-cvm-$id"
      log "evidence: $dir"
      log "run id:   $id   <- pass it to every later verb: $0 <verb> $id …"
      echo "$id"
      return 0
    fi
    kill -0 "$pid" 2>/dev/null || { tail -20 "$dir/server.log" >&2; stop_server "$dir"; die "server died on startup"; }
    sleep 2
  done
  tail -20 "$dir/server.log" >&2
  stop_server "$dir"
  die "server announced port $port but never answered on it"
}

# --- doctor ---------------------------------------------------------------
cmd_doctor() {
  local dir; dir="$(run_dir)"
  local pid port; pid="$(cat "$dir/server.pid")"; port="$(cat "$dir/server.port")"
  local ok=0

  kill -0 "$pid" 2>/dev/null &&
    log "ok   server process $pid alive" || { log "FAIL server process $pid gone"; ok=1; }

  if in_cvm_band "$port"; then
    log "FAIL port $port is in the CVM's band ($CVM_BAND_MIN-$CVM_BAND_MAX) — stop and cleanup, you may be driving Matt's own CVM"
    ok=1
  else
    log "ok   port $port is outside the CVM's band ($CVM_BAND_MIN-$CVM_BAND_MAX)"
  fi

  local owner; owner="$(port_owner "$port" "$pid")"
  case "$owner" in
    "$pid") log "ok   port $port owned by this run" ;;
    none)   log "FAIL nothing listening on $port"; ok=1 ;;
    other)  log "FAIL port $port owned by another process — do not drive it"; ok=1 ;;
    *)      log "ok   port $port owned by this run (pid $owner, a direct child of $pid)" ;;
  esac

  curl -sf -o /dev/null "http://localhost:$port/" &&
    log "ok   / answers 200" || { log "FAIL / does not answer"; ok=1; }
  desk_isolated "$port" &&
    log "ok   off Matt's desk: the Stream Deck hub points at a dead port" ||
    { log "FAIL this run's pages can reach Matt's Stream Deck hub (5172) — cleanup now"; ok=1; }

  if [ "$(run_mode "$dir")" = test-clone ]; then
    local t; t="$(verify_template_url)"
    case "$(url_host "$t")" in
      "")           log "FAIL VERIFY_DATABASE_URL is no longer set — this run cannot reach its clone"; ok=1 ;;
      *psdb.cloud*) log "FAIL VERIFY_DATABASE_URL points at PlanetScale — that is production"; ok=1 ;;
      *)            log "ok   DB: test clone $(run_clone_name "$dir") on $(url_host "$t") — writes allowed, dropped on cleanup" ;;
    esac
  else
    case "$(db_host)" in
      *psdb.cloud*) log "ok   DB: PRODUCTION ($(db_host)) — the server is read-only, treat every row as real" ;;
      *)            log "warn database is NOT production ($(db_host))" ;;
    esac
  fi

  psql_ro "$dir" -c 'select 1' > /dev/null 2>&1 &&
    log "ok   read-only psql reaches the database" || { log "FAIL psql cannot reach the database"; ok=1; }

  doctor_sidecar "$dir" || ok=1

  local others; others="$(all_run_dirs | while read -r d; do
      [ "$d" -ef "$dir" ] && continue; run_is_live "$d" && echo "$d"; done | sort -u || true)"
  if [ -n "$others" ]; then
    if [ "$(run_mode "$dir")" = test-clone ]; then
      log "note other verification runs are live — each has its own database, so they stay out of your Ledger:"
    else
      log "note other verification runs are live — their writes land in your Ledger too:"
    fi
    printf '       %s\n' $others >&2
  fi

  [ "$ok" = 0 ] || die "doctor found problems — fix them before driving"
  log "doctor: healthy — base URL http://localhost:$port"
}

# --- database write guard -------------------------------------------------
# baseline, check (the Write Ledger) and forensics: all in verify-guard.sh.
# shellcheck source=SCRIPTDIR/verify-ledger.sh
. "$(dirname "${BASH_SOURCE[0]}")/verify-ledger.sh"
# shellcheck source=SCRIPTDIR/verify-guard.sh
. "$(dirname "${BASH_SOURCE[0]}")/verify-guard.sh"

# --- the Tiny Course --------------------------------------------------------
# shellcheck source=SCRIPTDIR/verify-tiny-course.sh
. "$(dirname "${BASH_SOURCE[0]}")/verify-tiny-course.sh"

# --- the real cvm, on this run's clone ---------------------------------------
# shellcheck source=SCRIPTDIR/verify-cvm-cli.sh
. "$(dirname "${BASH_SOURCE[0]}")/verify-cvm-cli.sh"

# --- cleanup --------------------------------------------------------------
stop_server() {
  local dir="$1"
  [ -f "$dir/server.pid" ] || return 0
  local pid; pid="$(cat "$dir/server.pid")"
  # Kill the process this run recorded, never anything matched by name —
  # by name would take Matt's server and every sibling run with it.
  if kill -0 "$pid" 2>/dev/null; then
    pkill -TERM -P "$pid" 2>/dev/null || true
    kill -TERM "$pid" 2>/dev/null || true
    sleep 2
    kill -KILL "$pid" 2>/dev/null || true
    log "cleanup: stopped server pid $pid"
  fi
}

# Drop a run's clone once. db-dropped marks it, so a second cleanup is a no-op.
drop_run_clone() {
  local dir="$1"
  [ "$(run_mode "$dir")" = test-clone ] || return 0
  [ -f "$dir/db-name" ] && [ ! -f "$dir/db-dropped" ] || return 0
  local name; name="$(run_clone_name "$dir")"
  if drop_clone "$name" >/dev/null; then
    date --iso-8601=seconds > "$dir/db-dropped"
    log "cleanup: dropped test clone $name"
  else
    log "cleanup: could not drop test clone $name — rerun cleanup once the template's server is up"
  fi
}

stop_run() {
  local dir="$1"
  stop_api "$dir"
  stop_sidecar "$dir"
  stop_server "$dir"
  if [ -f "$dir/browser-session" ]; then
    agent-browser --session "$(cat "$dir/browser-session")" close 2>/dev/null &&
      log "cleanup: closed browser session $(cat "$dir/browser-session")" || true
  fi
  drop_run_clone "$dir"
  log "cleanup: done — evidence kept at $dir"
  echo "$dir"
}

cmd_cleanup() {
  if [ "${1:-}" = "--all" ]; then
    # This worktree's runs only: a sibling's run is its agent's to stop.
    local d
    for d in $(live_runs); do stop_run "$d"; done
    [ -z "$(verify_template_url)" ] || sweep_stale_clones
    return 0
  fi
  resolve_run "${1:-}"
  stop_run "$RUN_DIR"
}

VERB="${1:-}"
case "$VERB" in
  mode)     shift; cmd_mode "$@" ;;
  template) cmd_template ;;
  launch)   shift; cmd_launch "$@" ;;
  cleanup)  shift; cmd_cleanup "$@" ;;
  url|dir|session|doctor|guard|sql|ab|shot|snap|tiny-course|cvm)
    shift; resolve_run "${1:-}"; shift
    case "$VERB" in
      url)     run_base ;;
      dir)     run_dir ;;
      session) run_session ;;
      doctor)  cmd_doctor ;;
      sql)     cmd_sql "$@" ;;
      tiny-course) cmd_tiny_course ;;
      cvm)     cmd_cvm "$@" ;;
      ab)      run_ab "$@" ;;
      shot)    cmd_shot "$@" ;;
      snap)    cmd_snap "$@" ;;
      guard)
        case "${1:-}" in
          baseline)  cmd_guard_baseline ;;
          check)     cmd_guard_check ;;
          forensics) shift; cmd_guard_forensics "$@" ;;
          *) die "usage: verify.sh guard <run> <baseline|check|forensics <table>>" ;;
        esac ;;
    esac ;;
  *) sed -n '2,45p' "$0"; exit 1 ;;
esac
