/**
 * Long-form --help text for the `cvm short` verbs. Domain-teaching prose
 * consumed only by Command.withDescription.
 */
export const HELP = `Short — a Standalone Video in the Short (vertical, 1080x1920) Video Format.

A Short is posted on its own, never part of a Course. Its picture is drawn by
the vertical render: its Clips concatenated, burned-in captions from their
Transcript Words, and its Overlays above them. The rendered file is
finished-videos/<videoId>.mp4 on a Storage Root.

  cvm short create --name <n> (--video <id> | --recording-session <id> |
    --footage <path>) --range <r> [--range <r>…]
                                       # cut a new Short from ranges of a source
  cvm short render <videoId>           # render the vertical file and print its path

Find a Short's id with 'cvm video list --format short'.

'short create' cuts a Short without opening the editor. Its Clips point at the
same raw Footage as the source: nothing is copied on disk, and the source is
never changed, so one stream can feed many Shorts.

THE STREAM-TO-SHORT LOOP:
  1. 'cvm video transcript <id>' and 'cvm clip words <clipId>' on the stream
     Video, to find each answer worth a Short;
  2. 'cvm short create' for each answer;
  3. 'cvm footage frame' to choose crops;
  4. 'cvm clip layer add' on one Clip, then 'cvm clip update --layers-from' for
     the rest;
  5. optionally 'cvm overlay add --kind chatCard' (a copied stream Clip keeps
     its Recording Session, so its Chat Highlights are found);
  6. 'cvm clip frame' to check;
  7. 'cvm short render', then post it.`;

export const RENDER_HELP = `Render a Short's vertical file into finished-videos/ and print its path.

The command runs none of the render itself. It ENQUEUES the 'render-vertical'
Job — the same Job the Shorts page starts — and the Sidecar (started by
'pnpm dev' / 'pnpm start' on the author's machine) runs it with ffmpeg. Its
progress shows in the Upload Manager and its log is at
.data/logs/jobs/<jobId>.jsonl. If the Sidecar is not running, the Job waits in
the queue until it is (a 'waiting' line says so on STDERR). A failed attempt is
retried, up to 3 attempts in all.

OUTPUT
  By default it waits for the Job and prints { videoId, path }: the absolute
  path of the finished file. With --no-wait it prints { jobId, status:
  "queued", videoId, log } at once.

FAILURES
  A failed render prints the render's own error on STDERR — its _tag (e.g.
  "RenderVerticalError") and message — and exits non-zero.
  A Landscape Video is refused (exit 3): only a Short renders vertically.
  An unknown Video id is a not-found (exit 2).

LOCAL-ONLY
  The render reads raw footage and writes finished-videos/ on this machine's
  disk, so on any other box it is refused before anything happens — _tag
  "LocalOnlyCommandError", exit 7, no Job. Stop rather than retry.

It does no upload: posting is a separate step.`;

export const CREATE_HELP = `Make a Standalone Short (no Lesson, Short format) named --name from one or
more ranges of ONE source, joined in the order given (jump cuts). One range is
the normal case. Prints the new Short as one NDJSON line, with its 'clipIds' in
timeline order.

SOURCES AND RANGE SYNTAX:
  --video <id>     --range <clipId>[+<s>]..<clipId>[+<e>]
      Seconds into each Clip, the frame 'cvm clip words' uses (+<s> defaults to
      the first Clip's start, +<e> to the last Clip's end). The range takes a
      COPY of every Clip it covers, in timeline order, and trims the first and
      last. A copy keeps its Recording Session, text, Transcript Words
      (trimmed with it), Scene Override, Clip Zoom and Layers; Chapters and
      Overlays are left behind. Clip Origin: copy.
  --recording-session <id>   --range <s>-<e>
      Seconds on the Recording Session's clock (from its T0, the clock its
      Chat Highlights use). One new Clip cut from that session, drawn from its
      files, with text and Transcript Words from its mic file's Footage
      transcript. Clip Origin: cli.
  --footage <path>   --range <s>-<e>
      Seconds into the file. One new Clip, as 'clip add --source' makes it
      (stored root-relative), text from the file's Footage transcript. Clip
      Origin: cli.

REFUSED (exit 3, nothing written):
  an empty, reversed or out-of-range range; a range (or a trimmed Clip) below
  the minimum Clip length; an archived Clip or a Clip of another Video; an
  unknown Recording Session or Footage path; Footage with no fresh transcript
  yet (run the 'cvm footage transcribe <path>' it names first).

EXAMPLES:
  # Part of one Clip of a stream Video:
  cvm short create --name "Why types" --video vid_1 --range clip_a+3.2..clip_a+41

  # Across three Clips, skipping a tangent with a second range:
  cvm short create --name "Generics" --video vid_1 \\
    --range clip_a+12..clip_c+4.5 --range clip_e..clip_e+20

  # Speech between a stream's Clips, on the session's clock:
  cvm short create --name "Q&A" --recording-session rs_1 --range 1520-1563.5

  # Any Footage file, Imported Footage included:
  cvm short create --name "Demo" --footage raw-footage/imported/demo.mp4 --range 10-52`;
