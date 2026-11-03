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
  cvm short post [--dry-run] <videoId…> # add Shorts to the Posting Queue
  cvm short queue                      # list the Posting Queue and when each goes out

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
  7. 'cvm short render' to check the file;
  8. 'cvm video update --name … --description …', then 'cvm short post'.

THE POSTING QUEUE:
  A Short is posted from CVM's own Posting Queue, never at once. Each UK day
  (Europe/London) gets at least one Posting Slot, 13:00, even if its queue was
  empty at 00:00. On weekdays more than 14 queued at 00:00 gives 2 (09:00,
  18:00) and more than 21 gives 3 (09:00, 13:00, 18:00); Saturday and Sunday
  always 1. A slot posts the oldest Short queued at that time: one queued
  after 13:00 on a one-a-day day goes out the next day. A weekday after a day
  that had a Short to post and posted nothing takes the next pattern up
  (catch-up; Monday looks back over the weekend). At a
  slot this machine's Sidecar posts the oldest Queued Short to YouTube
  (public, direct) and to TikTok (through Buffer, "share now").`;

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
      Overlays are left behind. A Landscape Clip's Footage Layers (its B-roll)
      move into the Short's frame by fractions, their Source Crop narrowed
      about its centre so nothing stretches. Clip Origin: copy.
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

export const POST_HELP = `Add Shorts to the Posting Queue, oldest first in the order given, and print
when each goes out. Prints one NDJSON line per Short:
  { videoId, title, verdict: "queued" | "refused", reason, slot, goesOutAt }
'slot' is the ISO instant, 'goesOutAt' the UK wall-clock time ("Wed
2026-11-04 13:00"). A slot already missed today shows as now: it goes out at
the Sidecar's next check.

Nothing is posted here: the Sidecar posts each Short at its Posting Slot. A
Short is checked before it is queued; it needs a title of its own and a
description (the Video's description, set with 'cvm video update --name …
--description …'), which become its YouTube title and description. The
Shorts page's Add to Posting Queue does the same as this verb: its
description field is the Video's description.

REFUSED (exit 3, _tag "ShortPostRefusedError", 'refusals' names each Short and
why). If ANY Short of the batch is refused, NONE is queued:
  a Landscape Video; a Short still on its default title ("Short 11/3/2026");
  a Short with no description; a Short already in the Posting Queue (Queued,
  Posting or Held); a Short already Posted on both YouTube and TikTok.
An unknown Video id is a not-found (exit 2).

--dry-run prints every verdict, refusals included, and writes nothing. It
exits as the real run would: 0 when all would be queued, 3 when any would be
refused.

LOCAL-ONLY
  Only this machine's Sidecar posts from the Posting Queue, so on any other
  box it is refused before anything happens — _tag "LocalOnlyCommandError",
  exit 7. Stop rather than retry.

EXAMPLES:
  cvm short post --dry-run vid_1 vid_2 vid_3
  cvm short post vid_1 vid_2 vid_3`;

export const QUEUE_HELP = `List the Posting Queue and when each Short goes out. Prints one object:
  { days, entries: [{ entryId, videoId, title, state, slot, goesOutAt,
                      lastFailureReason }] }
in posting order: Shorts being posted first, then the Queued ones by when they
go out (oldest queued first, unless moved), then any that Failed recently.
'days' is how many UK days the Queued Shorts' slots fall on — how many days
of content the queue holds.

States: Queued (waiting for its slot), Posting (claimed a slot, being
posted), Held (a channel's outcome is unknown: check before retrying),
Failed (a channel failed 3 times).

'lastFailureReason' says why a Short is not going out: for a Posting Short,
that its render failed ("Its render failed: …"). A Short whose vertical
export is missing or out of date (its Short Export Hash differs) is rendered
at its slot, before it posts; there is no need to render it first.

'slot' is the ISO instant, 'goesOutAt' the UK wall-clock time; for a
Posting, Held or Failed Short it is the slot it claimed. The projection is the
same one 'cvm short post --dry-run' and the Shorts page use, from the same
Slot Schedule, so they always agree.`;
