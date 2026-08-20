/**
 * Long-form --help text for the `cvm footage` verbs, split out of footage.ts to
 * keep that command module under the repo's per-file token budget. These are
 * domain-teaching prose strings consumed only by Command.withDescription.
 */
export const HELP = `Footage — a raw recording on disk, before it is a Video.

Footage is a source video FILE on the author's machine (an OBS capture, a screen
recording) that has not been cut into Clips yet. Unlike every other noun in the
domain model it has NO DATABASE ROW: its identity is its filesystem path, and
its transcript is cached in a SIDECAR file next to it
("<path>.transcript.json") — the same "the filesystem is the state" convention
as a Video File. There is no 'RawFootage' table and no id; you always address
footage by path.

The point of transcribing footage is to read what was said BEFORE editing, so an
agent can decide where Clips and Chapters should fall. The loop is:
  cvm footage list                       # what raw files are around
  cvm footage transcribe <path>          # cache a whole-file transcript
  cvm footage transcript <path>          # read it back (words + segments)
  cvm clip add --video <id> --source <path> --start <t> --end <t>
                                         # cut a Clip whose text is sliced from
                                         # that cached transcript (no re-Whisper)

Transcription is whole-file and speaker-agnostic: mono 64kbps audio, Whisper
'whisper-1' with segment + word timestamps, NO diarization. A file too large for
Whisper's 25MB upload is split into ~27-minute chunks cut at detected silence
(never mid-word) and merged back onto one timeline. The cache is keyed by a
content hash of the source, so replacing/re-recording a file re-transcribes it
rather than serving stale words.

LOCAL-ONLY. Footage lives on the author's disk, so every verb here needs that
machine; on any other box it is refused before doing anything (_tag
"LocalOnlyCommandError", exit 7). That is a full stop, not a retry.

Verbs:
  list       [--dir <path>]              List video files in a directory
  transcribe <path>                      Transcribe a file, caching the result
  transcript <path>                      Read the cached transcript (never runs
                                         Whisper; not-found if never transcribed)`;

export const LIST_HELP = `List the video files in a directory as NDJSON (one compact object per line;
an empty directory prints nothing, exit 0).

--dir <path> chooses the directory; without it, the OBS_RECORDING_DIR config key
is used (the same directory the recorder writes to), falling back to ~/Videos.

Only video files are listed (mp4/mkv/mov/webm/avi/m4v), sorted by path. Each line
carries:
  path         absolute path to the file (feed straight to 'footage transcribe')
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

Extracts the file's audio (mono, 64kbps), transcribes it with Whisper
('whisper-1', segment + word timestamps, no diarization), and writes a sidecar
cache at "<path>.transcript.json". A file whose audio exceeds Whisper's 25MB
upload cap is split into ~27-minute chunks, each cut at a detected silence point
(never mid-word), transcribed independently, and merged back onto the file's own
timeline.

The cache is keyed by a CONTENT HASH of the source file. Re-recording or
replacing the file at the same path changes the hash, so the next transcribe
re-does the work instead of serving the previous file's words; an unchanged file
overwrites its own sidecar. This is SYNCHRONOUS — a long file blocks until done.

Echoes one JSON object: { path, sidecar, sourceHash, transcribedAt, words,
segments } (words/segments are counts). Read the transcript itself back with
'footage transcript'.

Examples:
  cvm footage transcribe /mnt/d/raw-footage/take.mkv
  cvm footage transcribe ./rec.mp4 | jq '{words, segments}'`;

export const TRANSCRIPT_HELP = `Read a footage file's cached transcript. NEVER transcribes — this only reads the
sidecar written by 'footage transcribe'.

Echoes one JSON object: { path, sourceHash, transcribedAt, words, segments },
where words and segments are the full arrays of { start, end, text } on the
file's own timeline.

A file that was never transcribed — or whose sidecar is stale because the file's
bytes have changed since (its content hash no longer matches) — is a not-found
(exit 2). Run 'footage transcribe' first.

Examples:
  cvm footage transcript /mnt/d/raw-footage/take.mkv
  cvm footage transcript ./rec.mp4 | jq -r '.segments[].text'`;
