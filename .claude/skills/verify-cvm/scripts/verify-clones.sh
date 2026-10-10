# Clone half of verify.sh — sourced by it, never run on its own. Finding the
# template, making a run's clone, keeping it offline, and sweeping up the clones
# crashed runs left behind. Expects log, die, REPO_ROOT and drop_run_clone from
# verify.sh, and the URL and admin helpers from verify-db.sh.
# shellcheck shell=bash

# --- the template -------------------------------------------------------------
# The template URL, or a FAIL that tells the agent exactly what to do.
require_template_url() {
  local t; t="$(verify_template_url)"
  [ -n "$t" ] || die "no verify template configured — VERIFY_DATABASE_URL is unset and $VERIFY_ENV_FILE does not exist.
  Stop and ask Matt to set it up: scripts/setup-verify-db.sh, then pnpm db:verify-snapshot.
  He runs both, from his own terminal; you never do. Do not fall back to --production on your own."
  refuse_production_url "$t"
  printf '%s\n' "$t"
}

require_template() {
  local t; t="$(require_template_url)" || exit 1
  psql_admin -c 'select 1' > /dev/null 2>&1 ||
    die "cannot reach the local verify Postgres at $(url_host "$t") — is the cvm-local-postgres container running? (docker start cvm-local-postgres)"
  db_exists "$(url_db "$t")" ||
    die "the verify template database $(url_db "$t") does not exist on $(url_host "$t").
  Stop and ask Matt to run:  pnpm db:verify-snapshot
  Never run it yourself — it is the one step that reads production, and it refuses an agent's shell anyway."
  printf '%s\n' "$t"
}

# --- making a clone ------------------------------------------------------------
# create database … template … fails while anyone holds a connection on the
# template — a sibling's `template` check, say. That lasts a moment: retry.
create_clone() {
  local template_db="$1" clone="$2" i
  for i in 1 2 3 4 5; do
    psql_admin -c "create database \"$clone\" template \"$template_db\"" 2>/dev/null && return 0
    sleep 2
  done
  psql_admin -c "create database \"$clone\" template \"$template_db\"" ||
    die "could not clone $template_db into $clone — is a session holding the template open? (select * from pg_stat_activity where datname = '$template_db')"
}

# migrate_run_clone <clone url> <clone name> — apply the checkout's migrations
# the clone lacks, to the clone alone. Checked twice: here, and again in
# migrate-clone.mjs, which refuses anything but localhost:5433/<this clone>.
migrate_run_clone() {
  local url="$1" name="$2"
  case "$name" in cvm_verify_[0-9]*) ;; *) die "refusing to migrate '$name' — not a per-run clone" ;; esac
  [ "$name" != "$(url_db "$(verify_template_url)")" ] || die "refusing to migrate the template itself"
  [ "$(url_db "$url")" = "$name" ] || die "refusing to migrate $(url_db "$url") — this run's clone is $name"
  case "$(url_host "$url")" in
    localhost:5433|127.0.0.1:5433) ;;
    *) die "refusing to migrate a clone on $(url_host "$url") — only localhost:5433 is migrated" ;;
  esac
  node "$(dirname "${BASH_SOURCE[0]}")/migrate-clone.mjs" "$url" "$name"
}

# A clone run is writable, so nothing it does may leave the box. Every external
# service's credential is replaced with a dud — they win over a linked .env,
# because the process environment beats .env — so Buffer, S3, Dropbox, YouTube,
# Anthropic, remove.bg, AI Hero and Cloudinary all fail closed. The services that
# read these at startup still need SOME value, or every page 500s.
OFFLINE='verify-cvm-offline'

# Every POSTING service's base URL. A run never reaches the real one: each
# defaults to port 9 (discard: nothing answers, so a post fails at once), and
# the only override taken from the caller's environment is a plain loopback
# URL — http://127.0.0.1:<port> or http://localhost:<port>, a path at most —
# so a run can post to a local stub and never anywhere else.
# ANTHROPIC_BASE_URL rides along: a Course Autofill calls the model, and its
# stub is a loopback Messages API (the AI SDK reads the variable itself).
# So do Dropbox's two hosts: a Publish ships its Bundle there (DROPBOX_API_URL
# carries the RPC calls and the OAuth token refresh, DROPBOX_CONTENT_URL the
# bytes).
POSTING_URL_VARS=(YOUTUBE_API_URL GOOGLE_OAUTH_TOKEN_URL BUFFER_API_URL S3_ENDPOINT AI_HERO_BASE_URL ANTHROPIC_BASE_URL DROPBOX_API_URL DROPBOX_CONTENT_URL)
DISCARD_URL='http://127.0.0.1:9'
loopback_or_discard() {
  if [[ "${1:-}" =~ ^http://(127\.0\.0\.1|localhost):[0-9]{1,5}(/[A-Za-z0-9._~/-]*)?$ ]]; then
    printf '%s\n' "$1"
  else
    printf '%s\n' "$DISCARD_URL"
  fi
}
posting_urls_env() {
  local v
  for v in "${POSTING_URL_VARS[@]}"; do
    printf '%s=%s\n' "$v" "$(loopback_or_discard "${!v:-}")"
  done
}
mapfile -t POSTING_URLS_ENV < <(posting_urls_env)

OFFLINE_SERVICES_ENV=(
  "BUFFER_API_TOKEN=$OFFLINE" "BUFFER_CHANNEL_ID=$OFFLINE"
  "S3_BUCKET=$OFFLINE" "AWS_REGION=us-east-1"
  "AWS_ACCESS_KEY_ID=$OFFLINE" "AWS_SECRET_ACCESS_KEY=$OFFLINE"
  "DROPBOX_APP_KEY=$OFFLINE" "DROPBOX_APP_SECRET=$OFFLINE"
  "GOOGLE_CLIENT_ID=$OFFLINE" "GOOGLE_CLIENT_SECRET=$OFFLINE"
  "ANTHROPIC_API_KEY=$OFFLINE" "REMOVE_BG_API_KEY=$OFFLINE"
  # YouTube, Google's token endpoint, Buffer, S3, AI Hero, Anthropic and
  # Dropbox: the discard port, or a loopback stub the caller started
  # (POSTING_URL_VARS above).
  "${POSTING_URLS_ENV[@]}"
  # Cloudinary (an image upload Job): a dud account whose uploads go to the
  # discard port, or to a loopback stub the caller names in
  # CLOUDINARY_UPLOAD_PREFIX. The SDK reads `upload_prefix` from the URL.
  "CLOUDINARY_URL=cloudinary://$OFFLINE:$OFFLINE@$OFFLINE?upload_prefix=$(loopback_or_discard "${CLOUDINARY_UPLOAD_PREFIX:-}")"
)

# A clone run's encodes, capped. Matt's machine runs 2 heavy encodes and 12 quick
# ffmpeg calls at once and 4 Dropbox uploads; a run gets one of each, so an
# encode Job on a real Course, pressed by mistake, cannot take the machine's
# memory with it. Publish the Tiny Course (`tiny-course <run>`) all the same.
CLONE_ENCODE_CAPS_ENV=(
  "FFMPEG_ENCODE_PERMITS=1" "FFMPEG_CPU_PERMITS=1" "DROPBOX_UPLOAD_CONCURRENCY=1"
)

# --- stale clones -----------------------------------------------------------
# A run is live while the launch building it, or the server it started, is
# alive. Either pid file may be missing; a dead or absent pid is not live.
run_is_live() {
  local f pid
  for f in "$1/launch.pid" "$1/server.pid"; do
    pid="$(cat "$f" 2>/dev/null || true)"
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && return 0
  done
  return 1
}

# Every run directory of every worktree of this repository: the run that owns a
# clone may live in a sibling worktree.
all_run_dirs() {
  local wt d
  git -C "$REPO_ROOT" worktree list --porcelain | sed -n 's/^worktree //p' |
    while IFS= read -r wt; do
      for d in "$wt"/.verify/run-*; do [ -d "$d" ] && printf '%s\n' "$d"; done
    done
  return 0
}

# Drop what crashed runs left behind. Every launch calls it, and cleanup --all.
#   1. A run directory, in any worktree of the repo, whose run is no longer live
#      and whose clone was never dropped.
#   2. A cvm_verify_<date>_<time>_<pid> database no live run claims, nobody is
#      connected to, and older than STALE_CLONE_HOURS — a run whose directory
#      was deleted, or lives in a checkout this one cannot see.
STALE_CLONE_HOURS="${VERIFY_STALE_CLONE_HOURS:-6}"
sweep_stale_clones() {
  local d claimed=" " name stamp born
  for d in $(all_run_dirs); do
    [ -f "$d/db-name" ] || continue
    if run_is_live "$d"; then claimed="$claimed$(cat "$d/db-name") "; continue; fi
    [ -f "$d/db-dropped" ] && continue
    log "sweep: run $d is over but its clone was never dropped"
    drop_run_clone "$d" >/dev/null
  done
  for name in $(psql_admin -At -c "select datname from pg_database d
        where datname ~ '^cvm_verify_[0-9]{8}_[0-9]{6}_[0-9]+$'
          and not exists (select 1 from pg_stat_activity a where a.datname = d.datname)"); do
    case "$claimed" in *" $name "*) continue ;; esac
    stamp="$(sed -E 's/^cvm_verify_([0-9]{8})_([0-9]{2})([0-9]{2})([0-9]{2})_.*/\1 \2:\3:\4/' <<< "$name")"
    born="$(date -d "$stamp" +%s 2>/dev/null)" || continue
    [ $(( $(date +%s) - born )) -ge $(( STALE_CLONE_HOURS * 3600 )) ] || continue
    drop_clone "$name" >/dev/null &&
      log "sweep: dropped stale clone $name (no live run, no connections, over ${STALE_CLONE_HOURS}h old)"
  done
  return 0
}
