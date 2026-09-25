#!/usr/bin/env bash
# Harness for the verify-cvm skill. One entry point, five verbs.
#
#   verify.sh launch            start a verification dev server, print the run dir
#   verify.sh doctor            read-only "is this instance worth driving?" check
#   verify.sh guard baseline    record the database write counters
#   verify.sh guard check       diff them, write the Write Ledger
#   verify.sh guard forensics <table> [since]
#                               name the rows that moved in one table
#   verify.sh cleanup           stop what this run started, keep the evidence
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
VERIFY_PORT="${VERIFY_PORT:-5199}"
BROWSER_SESSION="${AGENT_BROWSER_SESSION:-verify-cvm}"
STATE_DIR="$REPO_ROOT/.verify"
CURRENT="$STATE_DIR/current"

# The author's own CVM runs here all day, pointed at the same production
# database. This run must never touch it.
AUTHOR_PORT=5173

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

run_dir() {
  [ -f "$CURRENT" ] || die "no active run — call 'verify.sh launch' first"
  cat "$CURRENT"
}

# --- launch ---------------------------------------------------------------
cmd_launch() {
  if [ -f "$CURRENT" ] && [ -f "$(cat "$CURRENT")/server.pid" ] &&
     kill -0 "$(cat "$(cat "$CURRENT")/server.pid")" 2>/dev/null; then
    die "a verification server is already up at $(cat "$CURRENT") — drive that one, or run cleanup"
  fi

  [ -f "$REPO_ROOT/.env" ] ||
    die "no .env at $REPO_ROOT/.env — symlink the main checkout's one: ln -s ../../.env $REPO_ROOT/.env"

  local dir="$STATE_DIR/run-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$dir"
  echo "$dir" > "$CURRENT"

  {
    echo "started:   $(date --iso-8601=seconds)"
    echo "checkout:  $REPO_ROOT"
    echo "branch:    $(git -C "$REPO_ROOT" branch --show-current)"
    echo "commit:    $(git -C "$REPO_ROOT" rev-parse --short HEAD)"
    echo "port:      $VERIFY_PORT"
    echo "db host:   $(db_host)"
    echo "session:   $BROWSER_SESSION"
  } > "$dir/run.txt"

  # `exec` replaces the subshell with the server, so $! is the server's own pid
  # and cleanup can kill exactly what this run started.
  ( cd "$REPO_ROOT/apps/local" &&
    exec nohup ./node_modules/.bin/react-router dev --port "$VERIFY_PORT" \
      > "$dir/server.log" 2>&1 ) &
  echo $! > "$dir/server.pid"

  local pid; pid="$(cat "$dir/server.pid")"
  for _ in $(seq 1 60); do
    if curl -sf -o /dev/null "http://localhost:$VERIFY_PORT/"; then
      log "ready: http://localhost:$VERIFY_PORT/  (pid $pid, run $dir)"
      echo "$dir"
      return 0
    fi
    kill -0 "$pid" 2>/dev/null || { tail -20 "$dir/server.log" >&2; die "server died on startup"; }
    sleep 2
  done
  tail -20 "$dir/server.log" >&2
  die "server did not answer on $VERIFY_PORT within 120s"
}

# --- doctor ---------------------------------------------------------------
cmd_doctor() {
  local dir; dir="$(run_dir)"
  local pid; pid="$(cat "$dir/server.pid")"
  local ok=0

  kill -0 "$pid" 2>/dev/null &&
    log "ok   server process $pid alive" || { log "FAIL server process $pid gone"; ok=1; }

  local owner; owner="$(ss -ltnp 2>/dev/null | grep ":$VERIFY_PORT " || true)"
  case "$owner" in
    *"pid=$pid"*) log "ok   port $VERIFY_PORT owned by this run" ;;
    "")           log "FAIL nothing listening on $VERIFY_PORT"; ok=1 ;;
    *)            log "FAIL port $VERIFY_PORT owned by another process — do not drive it"; ok=1 ;;
  esac

  curl -sf -o /dev/null "http://localhost:$VERIFY_PORT/" &&
    log "ok   / answers 200" || { log "FAIL / does not answer"; ok=1; }

  case "$(db_host)" in
    *psdb.cloud*) log "ok   database is production ($(db_host)) — treat every row as real" ;;
    *)            log "warn database is NOT production ($(db_host))" ;;
  esac

  psql_ro -c 'select 1' > /dev/null 2>&1 &&
    log "ok   read-only psql reaches the database" || { log "FAIL psql cannot reach the database"; ok=1; }

  if ss -ltnp 2>/dev/null | grep -q ":$AUTHOR_PORT "; then
    log "note the author's own CVM is up on $AUTHOR_PORT — leave it alone"
  fi

  [ "$ok" = 0 ] || die "doctor found problems — fix them before driving"
  log "doctor: healthy"
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
      echo "These counters are database-wide. The author's own CVM and the deployed"
      echo "apps/remote write to the same tables, so a row here is a lead, not a verdict."
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

  local where=""
  for c in $cols; do
    [ -n "$where" ] && where="$where or "
    where="$where\"$c\" > '$since'"
  done

  psql_ro -c "select * from \"$table\" where $where" |
    tee "$dir/forensics-$table.txt"
  log "guard: rows of $table touched since $since written to $dir/forensics-$table.txt"
}

# --- cleanup --------------------------------------------------------------
cmd_cleanup() {
  [ -f "$CURRENT" ] || { log "cleanup: nothing to do"; return 0; }
  local dir; dir="$(cat "$CURRENT")"

  if [ -f "$dir/server.pid" ]; then
    local pid; pid="$(cat "$dir/server.pid")"
    # Kill the process group this run started, never anything matched by name.
    if kill -0 "$pid" 2>/dev/null; then
      pkill -TERM -P "$pid" 2>/dev/null || true
      kill -TERM "$pid" 2>/dev/null || true
      sleep 2
      kill -KILL "$pid" 2>/dev/null || true
      log "cleanup: stopped server pid $pid"
    fi
  fi

  agent-browser --session "$BROWSER_SESSION" close 2>/dev/null &&
    log "cleanup: closed browser session $BROWSER_SESSION" || true

  rm -f "$CURRENT"
  log "cleanup: done — evidence kept at $dir"
  echo "$dir"
}

case "${1:-}" in
  launch)  cmd_launch ;;
  doctor)  cmd_doctor ;;
  guard)
    case "${2:-}" in
      baseline)  cmd_guard_baseline ;;
      check)     cmd_guard_check ;;
      forensics) shift 2; cmd_guard_forensics "$@" ;;
      *) die "usage: verify.sh guard <baseline|check|forensics <table>>" ;;
    esac ;;
  cleanup) cmd_cleanup ;;
  *) sed -n '2,10p' "$0"; exit 1 ;;
esac
