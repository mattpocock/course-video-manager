/**
 * Long-form --help text for the `cvm footage` verbs, split out of footage.ts to
 * keep that command module under the repo's per-file token budget. These are
 * domain-teaching prose strings consumed only by Command.withDescription.
 */
export const HELP = `Footage — a raw recording on disk, before it is a Video.

Footage is a source video FILE on the author's machine that has not been cut
into Clips yet: a CVM-recorder Recording Session's camera, screen and mic files,
an older OBS recording, or Imported Footage (a file CVM did not film, copied in
under raw-footage/imported/ on a Storage Root). Unlike every other noun in the
domain model it has NO DATABASE ROW: its identity is its path RELATIVE TO A
STORAGE ROOT ("raw-footage/take.mkv"; STORAGE_ROOTS lists the drives, first hit
wins), so it is the same Footage whichever drive holds it, and
its transcript is cached in a SIDECAR file next to it
("<path>.transcript.json") — the same "the filesystem is the state" convention
as a Video File. There is no 'RawFootage' table and no id; you always address
footage by path: a root-relative path (looked up on each Storage Root in order),
or an absolute one as 'footage list' prints it. CVM deletes Footage only from
the Storage page: Unused Footage (7+ days old, no Clip uses it, after a
confirmation) and a moved file's original that has an identical copy elsewhere.
Imported Footage is never Unused Footage, so CVM never deletes it. A file comes
in as Imported Footage only through 'cvm footage import', which copies it (the
original is never moved, changed or deleted) or downloads it from a YouTube URL,
and transcribes the copy.

The point of transcribing footage is to read what was said BEFORE editing, so an
agent can decide where Clips and Chapters should fall. The loop is:
  cvm footage list                       # what raw files are around
  cvm footage transcribe <path>          # cache a whole-file transcript
  cvm footage transcript <path>          # read it back (words + segments)
  cvm clip add --video <id> --source <path> --start <t> --end <t>
                                         # cut a Clip whose text is sliced from
                                         # that cached transcript (no re-Whisper)

Transcription is whole-file and speaker-agnostic: mono 64kbps audio, Local
Whisper ('large-v3-turbo', run by the Sidecar on this machine) with segment +
word timestamps, NO diarization. A long file is split into ~27-minute chunks cut
at detected silence (never mid-word) and merged back onto one timeline. The cache is keyed by a
content hash of the source, so replacing/re-recording a file re-transcribes it
rather than serving stale words. The transcription itself is a Job the Sidecar
runs ('pnpm dev' / 'pnpm start' starts it), so it survives a restart.

LOCAL-ONLY. Footage lives on the author's disk, so every verb here needs that
machine; on any other box it is refused before doing anything (_tag
"LocalOnlyCommandError", exit 7). That is a full stop, not a retry.

Verbs:
  list       [--dir <path> | --imported] List video files in a directory, or
                                         every Imported Footage file
  import     <file|youtube-url>          Copy a 16:9 file (or download a
             [--no-wait]                 YouTube video) in as Imported
                                         Footage, and transcribe it
  search     <query>                     Find a phrase in what was said in
                                         Imported Footage (per segment)
  transcribe <path> [--no-wait]          Transcribe a file, caching the result
  transcript <path>                      Read the cached transcript (never runs
                                         Whisper; not-found if never transcribed)`;

export const LIST_HELP = `List the video files in a directory as NDJSON (one compact object per line;
an empty directory prints nothing, exit 0).

--dir <path> chooses the directory; without it, the OBS_RECORDING_DIR config key
is used (the same directory the recorder writes to), falling back to ~/Videos.

Only video files are listed (mp4/mkv/mov/webm/avi/m4v), sorted by path. The new
recorder writes each Recording Session into a folder of its own in that directory
(camera.mkv, screen.mkv, mic.mkv); each folder's mic.mkv is listed too, as
"<folder>/mic.mkv". It is the file to transcribe when searching a CVM-recorder
take: a CVM-recorder Clip's 'videoFilename' is that same mic file. Its transcript
is in the mic file's own time; a Clip's source times are that plus the session's
mic offset (default 150 ms). Each line carries:
  path         absolute path to the file, on whichever Storage Root it was
               found (feed straight to 'footage transcribe')
  size         bytes
  transcribed  whether a transcript sidecar exists next to it

'transcribed' only reports that a sidecar is PRESENT; whether it is still fresh
for the current bytes is checked by 'footage transcript' / 'footage transcribe',
which re-hash the file unless its size and mtime are still those it was
hashed at.

--imported lists Imported Footage instead: every video file under
raw-footage/imported/ (nested folders too) on every Storage Root, each once
(the first root that has it wins; an Offline root lists nothing). Its 'path' is
ROOT-RELATIVE ("raw-footage/imported/interview.mp4"), ready for 'clip add
--source'. --dir and --imported cannot be passed together.

Examples:
  cvm footage list
  cvm footage list --imported
  cvm footage list --dir /mnt/d/raw-footage
  cvm footage list | jq -r 'select(.transcribed | not) | .path'`;

export const TRANSCRIBE_HELP = `Transcribe a raw footage file and cache the transcript beside it.

Extracts the file's audio (mono, 64kbps), transcribes it with Local Whisper
('large-v3-turbo', run by the Sidecar; segment + word timestamps, no
diarization), and writes a sidecar cache at "<path>.transcript.json". A long
file is split into ~27-minute chunks, each cut at a detected silence point
(never mid-word), transcribed independently, and merged back onto the file's own
timeline.

The cache is keyed by a CONTENT HASH of the source file. Re-recording or
replacing the file at the same path changes the hash, so the next transcribe
re-does the work instead of serving the previous file's words; an unchanged file
overwrites its own sidecar.

A JOB THE SIDECAR RUNS
  The command ENQUEUES a 'transcribe-footage' Job and, by default, waits for it:
  the Sidecar ('pnpm dev' / 'pnpm start' on the author's machine) runs it, with
  the same Whisper permits as Clip transcription, and logs it at
  .data/logs/jobs/<jobId>.jsonl. A long file blocks until done. If the Sidecar
  is not running, the Job waits in the queue until it is (one line on STDERR
  says so). Transcribing a file that is already being transcribed follows that
  Job instead of starting a second one.
  Each finished chunk is kept beside the file ("<path>.transcript.partial/")
  until the transcript is written, so a Sidecar restart mid-run resumes rather
  than transcribing finished chunks again. A run cut off for good (its Sidecar
  died) ends FootageTranscriptionInterruptedError (exit 4): run the command again
  and it resumes from those chunks.

Echoes one JSON object: { path, sidecar, sourceHash, transcribedAt, words,
segments } (words/segments are counts). Read the transcript itself back with
'footage transcript'. A Whisper or ffmpeg failure ends with its own tagged error
on STDERR (exit 4); a missing file is a ParseError (exit 3).

--no-wait returns as soon as the Job is queued, echoing { jobId, status:
"queued", path, sidecar, log }; read the result later with 'footage transcript'.

Examples:
  cvm footage transcribe raw-footage/take.mkv     # found on the first Storage Root that has it
  cvm footage transcribe /mnt/d/raw-footage/take.mkv
  cvm footage transcribe ./rec.mp4 | jq '{words, segments}'
  cvm footage transcribe --no-wait /mnt/d/raw-footage/take.mkv`;

export const TRANSCRIPT_HELP = `Read a footage file's cached transcript. NEVER transcribes — this only reads the
sidecar written by 'footage transcribe'.

Echoes one JSON object: { path, sourceHash, transcribedAt, words, segments },
where words and segments are the full arrays of { start, end, text } on the
file's own timeline.

A file that was never transcribed — or whose sidecar is stale because the file's
bytes have changed since (its content hash no longer matches) — is a not-found
(exit 2). Run 'footage transcribe' first.

Examples:
  cvm footage transcript raw-footage/take.mkv
  cvm footage transcript /mnt/d/raw-footage/take.mkv
  cvm footage transcript ./rec.mp4 | jq -r '.segments[].text'`;

export const IMPORT_HELP = `Import a file CVM did not film (a StreamYard interview's composed file, a
b-roll shot), or a YouTube video by its URL, as Imported Footage, and transcribe
it.

PROBED FIRST. Before anything is copied or queued, ffprobe reads the file. It is
refused (ParseError, exit 3, naming the size and ratio found) when it is not a
video file, ffprobe can't read it, it has no video stream, or its display aspect
ratio (width x sample aspect ratio / height) is not within 1% of 16:9. A refusal
copies nothing and queues no Job. Non-16:9 files are never letterboxed or
cropped.

COPIED, NEVER MOVED. The file is copied into raw-footage/imported/ on the FIRST
Storage Root (STORAGE_ROOTS), under its own name. The original is only ever
read: never moved, changed or deleted. The copy is an 'import-footage' Job the
Sidecar runs ('pnpm dev' / 'pnpm start'), so a multi-gigabyte copy survives
closing the terminal and shows in the Jobs list. It is written as
"<name>.cvm-import-partial" and renamed into place only once its size and
checksum match the original, so a copy cut off by a restart never has the final
name (the Job redoes it). Nothing is ever overwritten:
  - a file of that name with IDENTICAL bytes is already there: no copy, that
    file is the import (running the command again is safe);
  - a file of that name with different bytes: the copy is named "<name>-2",
    "<name>-3", ... (the next free one).

TRANSCRIBED. A 'transcribe-footage' Job waits on the copy, then transcribes it
exactly as 'footage transcribe' does (Local Whisper, no diarization). An import
already transcribed is not transcribed again.

Echoes one JSON object once both Jobs are done: { path, size, width, height,
durationSeconds, transcript: { words, segments } } (counts). 'path' is
ROOT-RELATIVE ("raw-footage/imported/interview.mp4"): pass it straight to
'cvm clip add --source' (a normal Clip, Clip Origin 'cli'), or to
'cvm clip layer add --footage' (a Footage Layer, such as a B-roll).

--no-wait returns once the Jobs are queued: { jobId, transcribeJobId, status:
"queued", path }. A Job id is null when there was nothing to do (the file was
already imported, or already transcribed); status is "imported" when neither
was needed.

FROM A YOUTUBE URL (watch?v=, youtu.be/, shorts/, live/, embed/). The download
is an 'import-youtube-footage' Job the Sidecar runs with yt-dlp, which must be
on the Sidecar's PATH (Linux; the Job fails naming the install when it is not).
It takes the best video up to 1080p plus the best audio, merged to MP4, from
that one video (never a playlist). The 16:9 probe runs on the download: a
refused video is deleted and nothing lands in raw-footage/imported/. The file
is named "<title> [<video id>].mp4" (the title made filename-safe) and copied
in as above, with "<file>.youtube.json" ({ url, title, videoId }) beside it.
A video id already imported is reused, never downloaded again. The echo adds
{ title, url }. --no-wait prints { jobId, transcribeJobId, status, path }:
jobId is the download's, and path is null until it has landed.

Examples:
  cvm footage import ~/Downloads/streamyard-interview.mp4
  cvm footage import "https://www.youtube.com/watch?v=<id>"
  cvm footage import --no-wait /tmp/b-roll.mov
  cvm footage list --imported`;

export const SEARCH_HELP = `Find a phrase in what was said in Imported Footage.

Searches the transcript of every Imported Footage file (everything under
raw-footage/imported/ on every Storage Root, as 'footage list --imported'
walks it). Nothing else is searched: other Footage, Clips and Videos are not
(use 'cvm search' for those).

The match is PER SEGMENT: each transcript segment (Whisper's sentence-sized
run of words, with a start and end) is a hit when its text contains the query
as a literal, case-insensitive substring, the same rule as 'cvm search'. A
phrase split across two segments is not found. An empty query is a ParseError
(exit 3).

Only a FRESH transcript is searched: one whose content hash still matches the
file's bytes. While the file's size and mtime are those it was hashed at, the
hash is trusted and the file is not read again. A file never transcribed, still being transcribed, or changed
since is NOT TRANSCRIBED, never "no matches": after the hits, one JSON line on
STDERR names them, { notTranscribed: [path, ...] } (absent when there are
none). Transcribe one with 'footage transcribe <path>'.

Prints NDJSON, one hit per line, in path then time order (no hits prints
nothing, exit 0):
  path   ROOT-RELATIVE ("raw-footage/imported/interview.mp4"), ready for
         'clip add --source'
  start  the segment's start, in seconds on the file's own timeline
  end    the segment's end
  text   the segment's words

Examples:
  cvm footage search "type inference"
  cvm footage search "generics" | jq -r '"\\(.path) \\(.start)"'`;
