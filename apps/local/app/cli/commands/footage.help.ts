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
Imported Footage is never Unused Footage, so CVM never deletes it.

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
  list       [--dir <path>]              List video files in a directory
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
which re-hash the file.

Examples:
  cvm footage list
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
