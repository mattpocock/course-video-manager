# shellcheck shell=bash
# Sourced by wizard.sh, below its STAGES marker: the helpers its stages call.
# Split out of wizard.sh only to keep each file under the repo's per-file size
# limit; read wizard.sh for the order of the stages. Uses wizard.sh's globals
# (OUT, DRY_RUN, SESSION, NAMES, RIG_DIR, the library's colours and helpers).
# shellcheck disable=SC2154,SC2034  # globals live in wizard.sh

PS_EXE=/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe
ps_file() { "$PS_EXE" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$(wslpath -w "$RIG_DIR/lib/$1")" "${@:2}"; }

# ── keep Windows awake (lib/awake.ps1), restored on any exit ─────────────────
AWAKE_STATE="$OUT/wizard/awake-saved.json"; AWAKE_STOP="$OUT/wizard/awake.stop"; AWAKE_PID=""
awake_start() {
  rm -f "$AWAKE_STOP"
  (cd /mnt/c && ps_file awake.ps1 -Hold -State "$(wslpath -w "$AWAKE_STATE")" -StopFile "$(wslpath -w "$AWAKE_STOP")" -MaxMinutes 300) \
    >> "$SESSION/awake.log" 2>&1 &
  AWAKE_PID=$!
}
awake_stop() {
  [[ -n "$AWAKE_PID" ]] || return 0
  touch "$AWAKE_STOP"
  for _ in $(seq 1 40); do kill -0 "$AWAKE_PID" 2>/dev/null || break; sleep 0.5; done
  (cd /mnt/c && ps_file awake.ps1 -Restore -State "$(wslpath -w "$AWAKE_STATE")") >> "$SESSION/awake.log" 2>&1 || true
  AWAKE_PID=""
}
# ── the phone's marker video, served on the LAN while the start screen shows ──
PHONE_PID=""; PHONE_URL=""
phone_start() {
  local urlf="$OUT/phone/url.txt" bind=()
  (( DRY_RUN )) && bind=(--bind 127.0.0.1)   # a dry run never listens on the LAN
  mkdir -p "$OUT/phone"; rm -f "$urlf"
  note "Phone video: building it if it isn't cached yet (first time ~20 s)…"
  if ./rig phone --out "$OUT" > "$SESSION/phone-build.log" 2>&1; then ok "phone video: $(tail -n1 "$SESSION/phone-build.log")"
  else bad "phone video: build failed (see $SESSION/phone-build.log)"; return 1; fi
  ./rig phone --serve "${bind[@]}" --url-file "$urlf" --out "$OUT" > "$SESSION/phone-serve.log" 2>&1 &
  PHONE_PID=$!
  for _ in $(seq 1 60); do [[ -s "$urlf" ]] && break; kill -0 "$PHONE_PID" 2>/dev/null || break; sleep 0.5; done
  PHONE_URL=$(head -n1 "$urlf" 2>/dev/null || true)
  if [[ -z "$PHONE_URL" ]]; then bad "phone video: the download server didn't start (see $SESSION/phone-serve.log)"; return 1; fi
}
phone_stop() {
  [[ -n "$PHONE_PID" ]] || return 0
  mkdir -p "$OUT/phone"; touch "$OUT/phone/serve.stop"
  wait "$PHONE_PID" 2>/dev/null || true
  PHONE_PID=""
}

# ── helpers ────────────────────────────────────────────────────────────────

finished() { [[ -n "$(state_get "STAGE_$1")" ]]; }

skip_if_done() {
  if finished "$1"; then
    _STAGE_INDEX=$((_STAGE_INDEX + 1))
    printf '  %s✓ Stage %s/%s · %s: %s (done earlier, not re-run; --redo %s to repeat)%s\n' \
      "$DIM" "$1" "$TOTAL_STAGES" "$2" "$(state_get "STAGE_$1")" "$1" "$RESET"
    return 0
  fi
  return 1
}

ok()   { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$1"; }
bad()  { printf '  %s✗ %s%s\n' "$RED" "$1" "$RESET"; }
free_gb() { local d="$1"; while [[ ! -d "$d" ]]; do d=$(dirname "$d"); done; df -BG --output=avail "$d" | tail -n1 | tr -dc '0-9'; }
disk_note() {
  local free; free=$(free_gb "$OUT")
  if (( free < $1 + 5 )); then warn "Only ${free} GB free; this step writes up to ~$1 GB. Running anyway."
  else note "Disk: ${free} GB free, this step writes up to ~$1 GB."; fi
}

winrig() { node --input-type=module -e "const w = await import('./lib/win.ts'); $1"; }

# rig MODE ARGS...: the real ./rig, or under --dry-run a stub that writes a fake
# run folder with a report.md, prints progress and honours Ctrl-C. The baseline
# is NOT stubbed: it drives the mock OBS for 12 s with no page.
rig() {
  if (( ! DRY_RUN )); then ./rig "$@" --out "$OUT"; return; fi
  local mode="$1" n="$_STAGE_INDEX" i dir verdict="PASS"
  if [[ "$mode" == baseline ]]; then ./rig baseline --minutes 0.2 --no-page --out "$OUT"; return; fi
  [[ "${DRY_FAIL:-}" == "$n" ]] && verdict="FAIL"
  dir="$OUT/runs/$(date -u +%Y-%m-%dT%H-%M-%S)-$mode"; mkdir -p "$dir"
  ( trap 'echo "[stub] Ctrl-C: stopping ffmpeg (q)…"; exit 0' INT
    for i in 1 2 3; do echo "[stub $mode] ${i}s / 3s  screen 60 fps, camera 29.97 fps"; sleep 1; done )
  printf '# Rig report: %s (dry run)\n\n## Stop criteria\n\n| Criterion | Result |\n|---|---|\n| audio/screen drift | %s |\n| no dropped frames | PASS |\n\n## Frames\n' "$mode" "$verdict" > "$dir/report.md"
  echo '{}' > "$dir/report.json"
  [[ "$verdict" == PASS ]]
}

# verdict_rows REPORT.md: its Stop criteria as "Criterion: Result", broken at
# spaces to the terminal's width with a hanging indent. Never left to the
# terminal's soft wrap: copying that out drops the space at each wrap.
verdict_rows() {
  local w="${COLUMNS:-100}"; (( w > 120 )) && w=120; (( w < 40 )) && w=40
  sed -n '/^## Stop criteria/,/^## /p' "$1" | grep '^| ' | grep -v '^| Criterion |' |
    sed 's/^| //; s/ |$//; s/ | /: /' |
    awk -v w="$((w - 1))" '{
      n = split($0, word, " "); cur = "    " word[1]
      for (i = 2; i <= n; i++) {
        if (length(cur) + 1 + length(word[i]) > w) { print cur; cur = "        " word[i] }
        else cur = cur " " word[i]
      }
      print cur
    }'
}

# run_rig N MODE ARGS...: runs the rig, shows each new run's verdict table,
# copies the small result files into the session folder and records PASS/FAIL.
# Never stops the session: the next stage runs either way.
run_rig() {
  local n="$1"; shift
  local before after new d rc=0 verdict
  mkdir -p "$OUT/runs"
  before=$(ls "$OUT/runs")
  IN_RUN=1; INTERRUPTED=0
  printf '\n'
  rig "$@" || rc=$?
  IN_RUN=0
  after=$(ls "$OUT/runs")
  new=$(comm -13 <(printf '%s\n' "$before" | sort) <(printf '%s\n' "$after" | sort) | grep . || true)

  printf '\n%s%s▸ Stage %s/%s · %s: result%s\n' "$BOLD" "$BLUE" "$n" "$TOTAL_STAGES" "${NAMES[$n]}" "$RESET"
  verdict="PASS"; (( rc )) && verdict="FAIL"
  for d in $new; do
    mkdir -p "$SESSION/$n-$1/$d"
    cp "$OUT/runs/$d"/{report.md,report.json,meta.json,events.jsonl} "$SESSION/$n-$1/$d/" 2>/dev/null || true
    printf '\n  %s%s%s\n' "$BOLD" "$d" "$RESET"
    # report.md's stop criteria, or a kill -9 run's meta.crash (the selftest's
    # crash phase writes only meta.json): ./rig verdict judges both.
    local rows
    rows=$(./rig verdict "$OUT/runs/$d") || verdict="FAIL"
    verdict_rows <(printf '%s\n' "$rows")
    [[ -f "$OUT/runs/$d/report.md" || -f "$OUT/runs/$d/meta.json" ]] ||
      warn "no report.md or meta.json in this run (see the ffmpeg logs in $OUT/runs/$d)"
  done
  [[ -z "$new" ]] && { warn "the rig wrote no run folder"; verdict="FAIL"; }
  (( rc )) && note "./rig $1 exited with code $rc"

  if (( INTERRUPTED )); then
    printf '\n'; warn "Stopped with Ctrl-C. The recorders were stopped; this step is not marked done."
    note "Run ./wizard.sh again to redo it (the partial run stays in $OUT/runs)."
    exit 130
  fi
  state_set "STAGE_$n" "$verdict"
  state_set "RUNS_$n" "$(printf '%s\n' "$new" | paste -sd' ' -)"
  if [[ "$verdict" == PASS ]]; then printf '\n  %s✓ PASS%s\n' "$GREEN" "$RESET"
  elif (( n == 2 )); then printf '\n  %s✗ FAIL%s\n' "$RED" "$RESET"
  else printf '\n  %s✗ FAIL%s (recorded; carrying on)\n' "$RED" "$RESET"; fi
}

# obs_gone N: OBS must be closed before the rig opens the camera and mic. Closes
# it again if it came back; records FAIL for stage N and returns 1 if it won't go.
obs_gone() {
  ./rig obs status >/dev/null 2>&1 || return 0
  warn "OBS is running: closing it before this step."
  ./rig obs close || true
  ./rig obs status >/dev/null 2>&1 || return 0
  bad "OBS is still running, so the camera and mic are taken. Not running this step."
  state_set "STAGE_$1" "FAIL (OBS still running)"
  return 1
}

# ── 1 · Preflight (attended: its results are on the start screen) ──────────

preflight() {
  local okp=1 exe devices hit want free screens url
  if exe=$(winrig "console.log(w.windowsTool('ffmpeg'))" 2>&1); then
    ok "ffmpeg $("$exe" -hide_banner -version | head -n1 | awk '{print $3}')"
  else bad "ffmpeg: $exe"; okp=0; fi

  if ./rig check >"$SESSION/rig-check.log" 2>&1; then ok "./rig check: $(tail -n1 "$SESSION/rig-check.log" | sed 's/^\[[^]]*\] //')"
  else bad "./rig check failed (see $SESSION/rig-check.log)"; okp=0; fi

  if screens=$(./rig screens 2>&1) && grep -q '<- the rig records this one' <<<"$screens"; then
    ok "screen: $(grep '<- the rig' <<<"$screens" | sed 's/^\[[^]]*\] //; s/  <- the rig records this one//')"
  else bad "no DELL U2424H among the screens: $(printf '%s\n' "$screens" | sed 's/^\[[^]]*\] //' | paste -sd';' -)"; okp=0; fi

  if (( DRY_RUN )); then
    devices=$'video\tCam Link 4K\naudio\tVoicemeeter Out B1 (VB-Audio Voicemeeter VAIO)'; note "[stub] device list"
  else
    # Listed by name only (DirectShow enumeration). Never opened here.
    devices=$(winrig "const l = w.listDshowDevicesRaw(); for (const d of l.devices) console.log(d.kind + '\t' + d.name); if (!l.devices.length) console.log('RAW\t' + (l.raw.slice(0, 1500) || '(empty)').replace(/\n/g, ' | '))" 2>&1 || true)
  fi
  for want in "video:Cam Link 4K" "audio:Voicemeeter Out B1"; do
    hit=$(printf '%s\n' "$devices" | grep -i "^${want%%:*}	.*${want#*:}" | head -n1 | cut -f2 || true)
    if [[ -n "$hit" ]]; then ok "${want%%:*}: $hit"
    else bad "no ${want%%:*} device matching \"${want#*:}\". Found: $(printf '%s\n' "$devices" | grep -v '^RAW	' | cut -f2 | paste -sd, -)"; okp=0
      # Nothing parsed: show what the enumeration actually printed (or threw).
      if ! grep -q $'^\(video\|audio\)\t' <<<"$devices"; then note "raw listing: $(printf '%s' "$devices" | sed 's/^RAW\t//' | tr '\n' ' ' | cut -c1-1500)"; fi
    fi
  done

  free=$(free_gb "$OUT")
  if (( free >= 40 )); then ok "disk: ${free} GB free (the test writes ~30 GB)"
  else bad "disk: only ${free} GB free (the test writes ~30 GB)"; okp=0; fi

  url=$(./rig obs url 2>/dev/null || true)
  ok "OBS websocket: ${url%%	*} (${url#*	}, no password, as CVM)"
  if (( DRY_RUN )); then note "[dry run] OBS is lib/mock-obs.ts; the real OBS is not looked at"
  elif [[ -f "/mnt/c/Program Files/obs-studio/bin/64bit/obs64.exe" ]]; then ok "OBS installed (the wizard launches it if needed)"
  else bad "obs64.exe not found in C:\\Program Files\\obs-studio"; okp=0; fi
  if [[ -f "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe" ]]; then ok "Chrome installed (the page opens fullscreen on the DELL by itself)"
  else bad "chrome.exe not found"; okp=0; fi

  if (( okp )); then state_set STAGE_1 PASS; else state_set STAGE_1 FAIL; fi
}
