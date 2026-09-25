#!/usr/bin/env bash
# Harness for the verify-cvm skill. One entry point, seven verbs.
#
#   verify.sh launch            start a verification server, print its run directory
#   verify.sh url               base URL of the run's server
#   verify.sh session           agent-browser session name for the run
#   verify.sh doctor            read-only "is this instance worth driving?" check
#   verify.sh guard baseline    record the database write counters
#   verify.sh guard check       diff them, write the Write Ledger
#   verify.sh guard forensics <table> [since]
#                               name the rows that moved in one table
#   verify.sh cleanup [--all]   stop what this run started, keep the evidence
#
# Runs are independent: several can drive at once. Every verb after `launch`
# needs to know WHICH run it means. Set VERIFY_RUN to the directory `launch`
# printed; with exactly one live run the verbs find it themselves.
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

# --- production database access ------------------------------------------
# PlanetScale rejects the connection without a root certificate; `system` uses
# the OS trust store, which is the only root available on this box.
# default_transaction_read_only makes every statement below incapable of
# writing, whatever it says.
export PGSSLROOTCERT=system
export PGOPTIONS='-c default_transaction_read_only=on'

db_url() {
  # `.env` holds unquoted values with spaces in them, so sourcing it breaks.
  # Read the one key instead.
  local env_file="$REPO_ROOT/.env"
  [ -f "$env_file" ] || die "no .env at $env_file — the launch section says how to get one"
  grep -E '^DATABASE_URL=' "$env_file" | tail -1 |
    sed -e 's/^DATABASE_URL=//' -e 's/^"//' -e 's/"$//'
}

db_host() { db_url | sed -e 's#.*@##' -e 's#/.*##'; }

psql_ro() { psql "$(db_url)" -At -F'|' "$@"; }

# --- finding a run --------------------------------------------------------
# A run is live when the server it recorded is still alive. That is the only
# registry: no shared "current" pointer to clobber, so two runs never collide.
live_runs() {
  local d pid
  for d in "$STATE_DIR"/run-*; do
    [ -f "$d/server.pid" ] || continue
    pid="$(cat "$d/server.pid")"
    kill -0 "$pid" 2>/dev/null && printf '%s\n' "$d"
  done
  return 0
}

run_dir() {
  if [ -n "${VERIFY_RUN:-}" ]; then
    [ -d "$VERIFY_RUN" ] || die "VERIFY_RUN=$VERIFY_RUN is not a directory"
    # Absolute, so it compares equal to what live_runs prints.
    ( cd "$VERIFY_RUN" && pwd )
    return 0
  fi
  local runs count
  runs="$(live_runs)"
  count="$(printf '%s' "$runs" | grep -c . || true)"
  case "$count" in
    1) printf '%s\n' "$runs" ;;
    0) die "no live run — call 'verify.sh launch' first" ;;
    *) log "$runs"
       die "$count runs are live — set VERIFY_RUN to the one you mean" ;;
  esac
}

run_port()    { cat "$(run_dir)/server.port"; }
run_session() { cat "$(run_dir)/browser-session"; }
run_base()    { printf 'http://localhost:%s\n' "$(run_port)"; }

# --- picking a port -------------------------------------------------------
port_listening() { ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$1$"; }

# Ports a live sibling run recorded. A run holds its port from the moment it
# writes it, which is earlier than the moment the server listens on it.
ports_held_by_runs() {
  local d
  for d in $(live_runs); do
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

# Start the server on exactly $2, or fail. Leaves no process behind on failure,
# so the caller can try the next port without leaking a half-started Vite.
start_server() {
  local dir="$1" wanted="$2"
  echo "$wanted" > "$dir/server.port"

  # `exec` replaces the subshell with the server, so $! is the server's own pid
  # and cleanup can kill exactly what this run started.
  ( cd "$REPO_ROOT/apps/local" &&
    exec nohup ./node_modules/.bin/react-router dev --port "$wanted" \
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
cmd_launch() {
  [ -f "$REPO_ROOT/.env" ] ||
    die "no .env at $REPO_ROOT/.env — symlink the main checkout's one: ln -s ../../.env $REPO_ROOT/.env"

  if [ -n "${VERIFY_PORT:-}" ] && in_cvm_band "$VERIFY_PORT"; then
    die "VERIFY_PORT=$VERIFY_PORT is in the CVM's band ($CVM_BAND_MIN-$CVM_BAND_MAX) — that port is Matt's own CVM, not yours. Use $VERIFY_BAND_MIN-$VERIFY_BAND_MAX."
  fi

  local id dir
  id="$(date +%Y%m%d-%H%M%S)-$$"
  dir="$STATE_DIR/run-$id"
  mkdir -p "$dir"
  echo "verify-cvm-$id" > "$dir/browser-session"

  # Pick a port out of the verification band and ask for exactly it. Vite runs
  # with strictPort, so a taken port is a startup failure rather than a silent
  # drift onto the neighbour — which is what used to walk a run up into the
  # CVM's band. VERIFY_PORT overrides the pick when you need a known address.
  local wanted port="" pid=""
  for wanted in $(candidate_ports); do
    if start_server "$dir" "$wanted"; then port="$wanted"; break; fi
    log "launch: port $wanted did not come up — trying the next one"
  done
  [ -n "$port" ] ||
    die "no free port in $VERIFY_BAND_MIN-$VERIFY_BAND_MAX — run 'verify.sh cleanup --all' to free the band"
  pid="$(cat "$dir/server.pid")"

  {
    echo "started:   $(date --iso-8601=seconds)"
    echo "checkout:  $REPO_ROOT"
    echo "branch:    $(git -C "$REPO_ROOT" branch --show-current)"
    echo "commit:    $(git -C "$REPO_ROOT" rev-parse --short HEAD)"
    echo "port:      $port"
    echo "db host:   $(db_host)"
    echo "session:   verify-cvm-$id"
  } > "$dir/run.txt"

  local i
  for i in $(seq 1 30); do
    if curl -sf -o /dev/null "http://localhost:$port/"; then
      log "ready:   http://localhost:$port/  (pid $pid)"
      log "run:     $dir"
      log "session: verify-cvm-$id"
      log "export VERIFY_RUN=$dir"
      echo "$dir"
      return 0
    fi
    kill -0 "$pid" 2>/dev/null || { tail -20 "$dir/server.log" >&2; die "server died on startup"; }
    sleep 2
  done
  tail -20 "$dir/server.log" >&2
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

  local owner; owner="$(ss -ltnp 2>/dev/null | grep ":$port " || true)"
  case "$owner" in
    *"pid=$pid"*) log "ok   port $port owned by this run" ;;
    "")           log "FAIL nothing listening on $port"; ok=1 ;;
    *)            log "FAIL port $port owned by another process — do not drive it"; ok=1 ;;
  esac

  curl -sf -o /dev/null "http://localhost:$port/" &&
    log "ok   / answers 200" || { log "FAIL / does not answer"; ok=1; }

  case "$(db_host)" in
    *psdb.cloud*) log "ok   database is production ($(db_host)) — treat every row as real" ;;
    *)            log "warn database is NOT production ($(db_host))" ;;
  esac

  psql_ro -c 'select 1' > /dev/null 2>&1 &&
    log "ok   read-only psql reaches the database" || { log "FAIL psql cannot reach the database"; ok=1; }

  local others; others="$(live_runs | grep -vx "$dir" || true)"
  if [ -n "$others" ]; then
    log "note other verification runs are live — their writes land in your Ledger too:"
    printf '       %s\n' $others >&2
  fi

  [ "$ok" = 0 ] || die "doctor found problems — fix them before driving"
  log "doctor: healthy — base URL http://localhost:$port"
}

# --- database write guard -------------------------------------------------
# pg_stat_user_tables counts every insert, update and delete each table has
# taken. Reading it costs one catalog scan, never a table scan, so the guard
# is cheap enough to run around every drive.
counters() {
  psql_ro -c "select relname, n_tup_ins, n_tup_upd, n_tup_del
              from pg_stat_user_tables order by relname"
}

cmd_guard_baseline() {
  local dir; dir="$(run_dir)"
  date --iso-8601=seconds > "$dir/guard-since.txt"
  counters > "$dir/guard-baseline.txt"
  log "guard: baseline recorded for $(wc -l < "$dir/guard-baseline.txt") tables"
}

cmd_guard_check() {
  local dir; dir="$(run_dir)"
  [ -f "$dir/guard-baseline.txt" ] || die "no baseline — call 'verify.sh guard baseline' before driving"
  counters > "$dir/guard-after.txt"

  local ledger="$dir/WRITE-LEDGER.md"
  {
    echo "# Write Ledger"
    echo
    echo "Run: $dir"
    echo "Window opened: $(cat "$dir/guard-since.txt")"
    echo "Window closed: $(date --iso-8601=seconds)"
    echo "Database: $(db_host)"
    echo
  } > "$ledger"

  local moved
  moved="$(join -t'|' -j1 "$dir/guard-baseline.txt" "$dir/guard-after.txt" |
    awk -F'|' '{ ins=$5-$2; upd=$6-$3; del=$7-$4;
                 if (ins||upd||del) printf "%s|%d|%d|%d\n", $1, ins, upd, del }')"

  if [ -z "$moved" ]; then
    echo "No table took an insert, update or delete during the window. Nothing was modified." >> "$ledger"
    log "guard: clean — no writes"
  else
    {
      echo "**Writes landed during this run.**"
      echo
      echo "| Table | Inserted | Updated | Deleted |"
      echo "| --- | --- | --- | --- |"
      printf '%s\n' "$moved" | awk -F'|' '{ printf "| %s | %d | %d | %d |\n", $1, $2, $3, $4 }'
      echo
      echo "These counters are database-wide. Matt's own CVM, the deployed apps/remote"
      echo "and any other live verification run write to the same tables, so a row here"
      echo "is a lead, not a verdict."
      echo "Run 'verify.sh guard forensics <table>' on each one to name the rows."
    } >> "$ledger"
    log "guard: WRITES DETECTED — see $ledger"
    printf '%s\n' "$moved" >&2
  fi
  echo "$ledger"
}

cmd_guard_forensics() {
  local table="$1"
  local dir; dir="$(run_dir)"
  local since="${2:-$(cat "$dir/guard-since.txt")}"

  local cols
  cols="$(psql_ro -c "select column_name from information_schema.columns
                      where table_schema='public' and table_name='$table'
                        and column_name in ('created_at','updated_at')")"
  [ -n "$cols" ] || die "$table has no created_at or updated_at — inspect it by hand"

  local where="" c
  for c in $cols; do
    [ -n "$where" ] && where="$where or "
    where="$where\"$c\" > '$since'"
  done

  psql_ro -c "select * from \"$table\" where $where" |
    tee "$dir/forensics-$table.txt"
  log "guard: rows of $table touched since $since written to $dir/forensics-$table.txt"
}

# --- cleanup --------------------------------------------------------------
stop_run() {
  local dir="$1"
  if [ -f "$dir/server.pid" ]; then
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
  fi
  if [ -f "$dir/browser-session" ]; then
    agent-browser --session "$(cat "$dir/browser-session")" close 2>/dev/null &&
      log "cleanup: closed browser session $(cat "$dir/browser-session")" || true
  fi
  log "cleanup: done — evidence kept at $dir"
  echo "$dir"
}

cmd_cleanup() {
  if [ "${1:-}" = "--all" ]; then
    local runs; runs="$(live_runs)"
    [ -n "$runs" ] || { log "cleanup: no live runs"; return 0; }
    local d; for d in $runs; do stop_run "$d"; done
    return 0
  fi
  stop_run "$(run_dir)"
}

case "${1:-}" in
  launch)  cmd_launch ;;
  url)     run_base ;;
  session) run_session ;;
  doctor)  cmd_doctor ;;
  guard)
    case "${2:-}" in
      baseline)  cmd_guard_baseline ;;
      check)     cmd_guard_check ;;
      forensics) shift 2; cmd_guard_forensics "$@" ;;
      *) die "usage: verify.sh guard <baseline|check|forensics <table>>" ;;
    esac ;;
  cleanup) shift; cmd_cleanup "$@" ;;
  *) sed -n '2,16p' "$0"; exit 1 ;;
esac
