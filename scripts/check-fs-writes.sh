#!/bin/bash

# A path the app did not build itself — an absolute `filePath` read from the
# database, a path out of a request — must pass `assertUnder`
# (apps/local/app/services/assert-under.ts) before anything writes to it or
# deletes it. On a verify-cvm test clone the rows still name Matt's real
# files; the guard is what keeps a clone's save inside its run's scratch/.
#
# Flags every fs write, delete, rename or copy in apps/local/app/routes and
# apps/local/app/services — `fs.writeFile*`, `.remove`, `.unlink*`, `.rm*`,
# `.rename*`, `.copyFile*`, `.truncate`, `.appendFile*` on a file-system
# receiver, and `removeBestEffort(fs, path)` — whose destination is not a
# variable assigned straight from a guard:
#
#   const target = yield* assertUnderEffect(getVideoFilesBaseDir(), row.filePath);
#   yield* fs.writeFile(target, bytes);
#
# The guards are `assertUnder`, `assertUnderEffect`, and the resolvers that
# call it (`assertUnderFinishedVideos`, `resolveVideoFilePath`,
# `resolveClipMockupPath`, `locateClipMockupFile`), or the guard called inline
# as the argument. Test files and harnesses are exempt.
#
# Writes that genuinely never see such a path (ffmpeg scratch files in the OS
# temp dir, a daemon's own lock file) are counted per file in ALLOWLIST below.
# The count must match exactly: one more is a new unguarded write (guard it,
# never raise the count); one fewer means the entry is stale (lower it, or
# delete it at 0). The list only ever shrinks — MAX_ALLOWLISTED is its ceiling.
#
# Default: staged files (pre-commit). `--all`: every tracked file (CI).

file_list() {
  if [ "${1:-}" = "--all" ]; then
    git ls-files
  else
    git diff --cached --name-only --diff-filter=d
  fi
}

# file:count — each a write whose path is built by the app, never read from a
# row or a request. Do not add to this list: route the path through
# assertUnder instead.
ALLOWLIST=(
  # Remove-on-failure of ffmpeg/whisper intermediates in the OS temp dir.
  "apps/local/app/services/video-export-passes.ts:2"
  "apps/local/app/services/render-vertical-video-service.ts:3"
  "apps/local/app/services/whisper-transcription-service.ts:1"
  "apps/local/app/services/footage-transcription.ts:3"
  "apps/local/app/services/overlay-content-renderer.ts:2"
  # The Clip Mockup daemon's own lock file and socket.
  "apps/local/app/services/clip-mockup-daemon/server.ts:5"
  # The footage transcript sidecar, written beside a footage file the user
  # names on the CLI.
  "apps/local/app/services/footage-cache.ts:1"
  # The export digest sidecar: every caller hands it an export path that
  # the export code built under finished-videos/ on a Storage Root.
  "apps/local/app/services/export-sha256-sidecar.ts:1"
)
MAX_ALLOWLISTED=18

# The definition of removeBestEffort: its callers are what gets checked.
EXEMPT=(
  "apps/local/app/services/remove-best-effort.ts"
)

found_violations=0

total=0
for entry in "${ALLOWLIST[@]}"; do
  allowed="${entry%:*}"
  total=$((total + ${entry##*:}))
  # A moved or renamed file must take its allowlist entry with it.
  if [ ! -f "$allowed" ]; then
    echo "ERROR: scripts/check-fs-writes.sh allowlists $allowed, which does not exist."
    found_violations=2
  fi
done
if [ "$total" -gt "$MAX_ALLOWLISTED" ]; then
  echo "ERROR: scripts/check-fs-writes.sh allowlists $total unguarded writes; the ceiling is $MAX_ALLOWLISTED."
  echo "The list only shrinks. Guard the new write with assertUnder (apps/local/app/services/assert-under.ts)."
  found_violations=2
fi
[ "$found_violations" -eq 2 ] && exit 1

allowed_count() {
  local entry
  for entry in "${ALLOWLIST[@]}"; do
    if [ "${entry%:*}" = "$1" ]; then
      echo "${entry##*:}"
      return
    fi
  done
  echo 0
}

report() {
  if [ "$found_violations" -eq 0 ]; then
    echo ""
    echo "ERROR: fs writes or deletes on a path that did not pass assertUnder:"
    echo ""
  fi
  found_violations=1
}

while IFS= read -r file; do
  case "$file" in
    apps/local/app/routes/*.ts|apps/local/app/routes/*.tsx) ;;
    apps/local/app/services/*.ts|apps/local/app/services/*.tsx) ;;
    *) continue ;;
  esac
  case "$file" in
    *.test.*|*.spec.*|*/test-utils/*|*test-harness*|*-test-setup.ts) continue ;;
  esac
  for exempt in "${EXEMPT[@]}"; do
    [ "$file" = "$exempt" ] && continue 2
  done

  matches=$(perl -0777 -ne '
    my $src = $_;
    my %guarded;
    my $guard = qr/(?:assertUnder|assertUnderEffect|assertUnderFinishedVideos|resolveVideoFilePath|resolveClipMockupPath|locateClipMockupFile)\s*\(/;
    while ($src =~ /\b(?:const|let)\s+(\w+)\s*=\s*(?:yield\*\s*)?$guard/g) {
      $guarded{$1} = 1;
    }
    my $parens = qr/(\((?:[^()]++|(?-1))*\))/;
    my $ops = qr/writeFile|writeFileString|writeFileSync|appendFile|appendFileSync|remove|unlink|unlinkSync|rm|rmSync|rmdir|rmdirSync|rename|renameSync|copyFile|copyFileSync|truncate/;
    my $fsish = qr/\b\w*(?:[fF]s|FS|fsvc|[fF]ileSystem)\b/;

    sub top_level_args {
      my ($inner) = @_;
      my @args; my $depth = 0; my $cur = "";
      for my $ch (split //, $inner) {
        if ($ch =~ /[(\[{]/) { $depth++ }
        elsif ($ch =~ /[)\]}]/) { $depth-- }
        if ($ch eq "," && $depth == 0) { push @args, $cur; $cur = ""; next }
        $cur .= $ch;
      }
      push @args, $cur if $cur =~ /\S/;
      s/^\s+|\s+$//g for @args;
      return @args;
    }

    my $ok = sub {
      my ($arg) = @_;
      return 0 unless defined $arg;
      return 1 if $arg =~ /^(?:yield\*\s*)?$guard/;
      return 1 if $arg =~ /^(\w+)$/ && $guarded{$1};
      return 0;
    };

    my @calls;
    while ($src =~ /$fsish\s*\.\s*($ops)\s*$parens/g) {
      my ($op, $args, $at) = ($1, $2, $-[0]);
      my @a = top_level_args(substr($args, 1, -1));
      my @dest = $op =~ /^copyFile/ ? ($a[1]) : $op =~ /^rename/ ? @a[0, 1] : ($a[0]);
      push @calls, [$at, $op, $args] if grep { !$ok->($_) } @dest;
    }
    while ($src =~ /(?<![\w.])removeBestEffort\s*$parens/g) {
      my ($args, $at) = ($1, $-[0]);
      my @a = top_level_args(substr($args, 1, -1));
      push @calls, [$at, "removeBestEffort", $args] unless $ok->($a[1]);
    }
    for my $c (sort { $a->[0] <=> $b->[0] } @calls) {
      my $line = 1 + (() = substr($src, 0, $c->[0]) =~ /\n/g);
      (my $flat = $c->[2]) =~ s/\s+/ /g;
      $flat = substr($flat, 0, 90) . "…" if length $flat > 90;
      print "$line: $c->[1]$flat\n";
    }
  ' "$file")

  count=0
  [ -n "$matches" ] && count=$(printf '%s\n' "$matches" | wc -l)
  allowed=$(allowed_count "$file")

  if [ "$count" -gt "$allowed" ]; then
    report
    printf '%s\n' "$matches" | while IFS= read -r match; do
      echo "  $file:$match"
    done
    [ "$allowed" -gt 0 ] && echo "  ($file is allowlisted for $allowed; it has $count)"
  elif [ "$count" -lt "$allowed" ]; then
    report
    echo "  $file: allowlisted for $allowed unguarded writes but has $count — lower its"
    echo "  ALLOWLIST entry in scripts/check-fs-writes.sh (and MAX_ALLOWLISTED), or delete it at 0."
  fi
done < <(file_list "${1:-}")

if [ "$found_violations" -eq 1 ]; then
  echo ""
  echo "Resolve the path with assertUnder / assertUnderEffect"
  echo "(apps/local/app/services/assert-under.ts) against the env-configured folder"
  echo "that kind of file lives in, assign the result to a variable, and write to"
  echo "that. Never raise an ALLOWLIST count in scripts/check-fs-writes.sh."
  exit 1
fi
