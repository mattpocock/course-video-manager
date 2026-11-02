/**
 * Help text for `cvm short`. Domain-teaching, in GLOSSARY.md terms: keep in
 * sync with the glossary by hand.
 */

export const SHORT_HELP = `short — a Short: a Standalone, vertical (Short-format) Video.

A Short has no Lesson. 'short create' cuts one from ranges of a Video, a
Recording Session or any Footage file, without opening the editor. Its Clips
point at the same raw Footage as the source: nothing is copied on disk, and the
source is never changed, so one stream can feed many Shorts.

VERBS:
  short create --name <n> (--video <id> | --recording-session <id> |
               --footage <path>) --range <r> [--range <r>…]

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
