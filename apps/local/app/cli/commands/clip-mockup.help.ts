/**
 * Long-form --help text for the `cvm clip-mockup` verbs, split out of
 * clip-mockup.ts to keep that command module under the repo's per-file token
 * budget. These are domain-teaching prose strings consumed only by
 * Command.withDescription.
 */
export const HELP = `Clip Mockup — one still image and one spoken line of a Video's plan.

A Clip Mockup is a single moment of a Video decided BEFORE it is filmed: the
picture that is on screen, and the words said over it. Clip Mockups belong to
a VIDEO and are ordered the way Beats are. Played in order, a Video's Clip
Mockups are its ANIMATIC — the film term for a timed cut of the storyboard,
watched before the shoot. There is no Animatic record: the word names the
playback of these rows and nothing else.

Where it sits on the fidelity ladder:
  Beat         what this part of the video does for the viewer (loose, the
               author's inspiration at film time)
  Clip Mockup  the picture and the words (this noun)
  Script       written from the Clip Mockup lines once the author is happy
  Clip         what was actually filmed

Deliberately distinct from a Beat: a Beat is a job, a Clip Mockup is a frame.
A Clip Mockup does NOT point at a Beat — one that serves no Beat is a real and
useful thing, because it means the plan missed a moment. Deliberately distinct
from a Clip: a Clip is footage that exists, a Clip Mockup is a picture that
stands in for footage that does not exist yet.

THE CONSTRAINT IS THE POINT. A Clip Mockup must have an IMAGE and must have a
LINE. The CLI will not accept a description of a picture, only a picture — so
every moment of the Lesson has to be decided before the camera is switched on.

TWO WAYS TO GIVE THE PICTURE, and exactly one per call. '--image <path>' is a
PNG you already have. '--html <path>' is a page you WROTE: it is rendered in a
headless browser at 1920x1080 and the screenshot becomes the frame. --html is
the one to reach for — writing one HTML page gets you real code highlighting,
real fonts and a real layout, and it is a file you can edit and re-capture
after feedback. Passing both, or neither, is invalid input (exit 3).

Like a Beat and the Script, a Clip Mockup is an internal planning artifact: it
is NEVER published into course.json. Deleting is an archive, and archived ==
deleted (there is no restore verb).

LANDSCAPE ONLY. 'add' refuses a Video whose Video Format is 'short'.

LOCAL-ONLY. The frames are a directory on the author's machine
(CLIP_MOCKUP_DIR), and --html needs the headless browser installed beside it,
so every verb here needs that machine. On any other box the
command is refused before it does anything, with _tag "LocalOnlyCommandError"
and exit 7, naming what it would have needed. That is a full stop, not a
retry.

Output fields: id, videoId, line (the spoken words), imagePath (relative to
{CLIP_MOCKUP_DIR}/{lineageId}/), durationSeconds (the measured length of the
line's speech; null until speech synthesis fills it), order (fractional sort
key), archived, createdAt.

TWO WAYS TO ADDRESS ONE. 'update', 'move' and 'delete' each take either a bare
<id> or '--video <id> --at <position>'. A position counts from 1 and is exactly
the position the Clip Mockup has in 'list' and in the player — because the
author watching the Animatic sees a number, not a uuid, and says "number 14 is
too dense". Giving both an <id> and --at is invalid input (exit 3), and so is a
position outside the list, which says how long the list actually is.

Verbs (flags come BEFORE any positional <id> — a flag after it exits 3):
  add    --video <id> (--html|--image) <path> --say "…"
                                                Add a frame + line at the end
  list   --video <id>                           The Video's Animatic, in order
  get    <id…>                                  Read one or more back
  update <id> | --video <id> --at <n>           Swap the frame and/or the line
  move   <id> | --video <id> --at <n>           Reorder within the Video
  delete <id> | --video <id> --at <n>           Archive (delete) one

Every write echoes the affected row as one pretty JSON object.

Examples:
  cvm clip-mockup add --video vid_123 --html /tmp/frame-01.html --say "Here's the problem."
  cvm clip-mockup add --video vid_123 --image /tmp/frame-01.png --say "Here's the problem."
  cvm clip-mockup list --video vid_123
  cvm clip-mockup get cm_456
  cvm clip-mockup update --say "Shorter." --video vid_123 --at 14
  cvm clip-mockup move --video vid_123 --at 14 --before cm_456
  cvm clip-mockup delete cm_456`;

/**
 * The addressing rules are identical for update / move / delete, so they are
 * written once and appended to each of those three verbs' help.
 */
export const ADDRESSING_HELP = `Addressing — pick ONE of:
  <id>                        the Clip Mockup id, as printed by 'list'/'get'.
  --video <id> --at <n>       the Clip Mockup at POSITION n of that Video's
                              Animatic, counting from 1, in exactly the order
                              'list' and the player show. This is the number
                              the author reads off the screen.
Both at once is invalid input (exit 3), as is --at without --video, --video
beside a bare <id>, and a position outside the list — that last one says how
many Clip Mockups the Video actually has.`;

export const ADD_HELP = `WRITES. Add a Clip Mockup to the end of a Video's Animatic. Requires --video,
--say and EXACTLY ONE of --html / --image; any of them missing — or both frame
sources at once — is invalid input (exit 3).

Flags:
  --video <id>     the Video to add the Clip Mockup to. Unknown or archived is
                   a not-found (exit 2). A Video whose format is 'short' is
                   REFUSED — Clip Mockups are Landscape only (exit 3).
  --html <path>   an HTML page on the local filesystem. It is rendered in a
                   headless Chromium at exactly 1920x1080 and the screenshot
                   becomes the frame, which is then stored exactly as --image's
                   PNG is. Prefer this: write the page, look at the result,
                   rewrite the page. A missing file is invalid input (exit 3);
                   a page that will not render is a FrameCaptureError (exit 4)
                   — a NAMED failure, never a blank frame — and it leaves no
                   row and no file behind.
  --image <path>   a ready-made PNG on the local filesystem. It is COPIED into
                   {CLIP_MOCKUP_DIR}/{lineageId}/ under a fresh name, so the
                   CVM holds its own copy and clearing your scratch folder can
                   never empty the Animatic. The row stores the path RELATIVE
                   to that directory — never the path you passed. A missing or
                   unreadable source is invalid input (exit 3).
                   --html and --image are MUTUALLY EXCLUSIVE and exactly one is
                   required; both, or neither, is invalid input (exit 3).
  --say "<text>"   the spoken line for this moment. One line per Clip Mockup:
                   it maps to the Clip it will become. Must not be empty.

Echoes the created row (with its new id, imagePath and computed order) as one
pretty JSON object. 'durationSeconds' is null: it is the measured length of
the line's speech and nothing synthesises speech yet.

The browser binary is a one-off install on this machine:
  pnpm --filter @cvm/local exec playwright install chromium

Examples:
  cvm clip-mockup add --video vid_123 --html ./frames/01.html --say "Here's the problem."
  cvm clip-mockup add --video vid_123 --image ./frames/01.png --say "Here's the problem."
  cvm clip-mockup add --video vid_123 --image /tmp/f.png --say "And here's the fix."`;

export const LIST_HELP = `READS. List a Video's full, ordered Animatic as NDJSON (one compact JSON
object per line; an empty Animatic prints nothing and exits 0). Requires
--video <videoId>.

Rows sort by 'order' ascending — playback order. Archived (deleted) Clip
Mockups are always excluded; there is no flag to include them.

The line's POSITION in this stream, counted from 1, is how the author addresses
one in conversation ("number 14 is too dense") — pass it straight back as
'--video <id> --at 14' to 'update', 'move' or 'delete'. So read this stream top
to bottom rather than by id.

An unknown or archived --video is a not-found (exit 2).

Examples:
  cvm clip-mockup list --video vid_123
  cvm clip-mockup list --video vid_123 | jq -r .line
  cvm clip-mockup list --video vid_123 | jq -s length`;

export const GET_HELP = `READS. Read one or more Clip Mockups back by id. Variadic: pass as many ids
as you like.

ONE id => one pretty JSON object (exit 0), or a not-found (exit 2) if it is
unknown or already deleted. SEVERAL ids => NDJSON of the ones that were found
on stdout, then a not-found naming the missing ones on stderr (exit 2) — so
stdout stays pure data either way.

Find ids with 'cvm clip-mockup list --video <id>'.

Examples:
  cvm clip-mockup get cm_456
  cvm clip-mockup get cm_456 cm_789 | jq -r .imagePath`;

export const DELETE_HELP = `WRITES. Delete (archive) a single Clip Mockup, addressed either by a bare
<id> or by '--video <id> --at <position>'. For Clip Mockups,
archived == deleted: it leaves the Animatic and can never be listed or
addressed again (there is no restore verb).

The PNG on disk is deliberately LEFT ALONE. The row is the state; an orphan
frame in the Clip Mockup directory costs nothing and is never served.

Immediate — there is no confirmation prompt (this is an agent-facing tool).
Echoes the now-archived row ({ ..., archived: true }). An unknown or
already-deleted id is a not-found (exit 2).

${ADDRESSING_HELP}

Examples:
  cvm clip-mockup delete cm_456
  cvm clip-mockup delete --video vid_123 --at 14`;

export const UPDATE_HELP = `WRITES. Change an existing Clip Mockup's frame, its line, or both. At least
one of --html / --image / --say is required; none is invalid input (exit 3),
and so is --html beside --image.

The two fields are INDEPENDENT. A frame source swaps the picture and leaves
the line exactly as it was; --say rewrites the line and leaves the picture
alone. There
is no verb that moves a Clip Mockup between Videos: its frame lives under its
Video's directory, so the row cannot leave the picture behind.

Flags:
  --html <path>    a new HTML page, captured at 1920x1080 exactly as 'add'
                   does. This is the redraw loop: the author says "number 14 is
                   too dense", you edit the page and re-capture it in place.
  --image <path>   a new PNG on the local filesystem. Copied into
                   {CLIP_MOCKUP_DIR}/{lineageId}/ under a FRESH name and the
                   row repointed at it, exactly as 'add' does. The old frame is
                   left on disk — the row is the state. A missing or unreadable
                   source is invalid input (exit 3).
                   --html and --image are mutually exclusive (exit 3).
  --say "<text>"   the new spoken line. Must not be empty.

'durationSeconds' is deliberately NOT touched: it is the measured length of the
line's speech, so only whatever synthesises that speech may write it.

${ADDRESSING_HELP}

Echoes the updated row as one pretty JSON object.

Examples:
  cvm clip-mockup update --say "Shorter, and it lands harder." cm_456
  cvm clip-mockup update --html ./frames/14-v2.html --video vid_123 --at 14
  cvm clip-mockup update --image ./frames/14-v2.png --video vid_123 --at 14
  cvm clip-mockup update --image ./f.png --say "Both." --video vid_123 --at 14`;

export const MOVE_HELP = `WRITES. Reorder a Clip Mockup WITHIN its Video's Animatic. Ordering only: no
file on disk is read, written or moved, and the line, the frame and the
duration are all untouched.

Position it with the same anchors 'beat move' uses:
  --before <id>    place it immediately before that Clip Mockup.
  --after <id>     place it immediately after that Clip Mockup.
  neither          move it to the END of the Animatic.
--before and --after together is invalid input (exit 3). An anchor id that is
not an active Clip Mockup of this Video is a not-found (exit 2). Anchors are
ids, not positions — read them off 'list' alongside the position you are
moving.

Moving does not renumber anything the author has to track: 'list' and the
player re-read the new order, so the positions simply are what they now show.

${ADDRESSING_HELP}

Echoes the moved row as one pretty JSON object.

Examples:
  cvm clip-mockup move --before cm_123 cm_456
  cvm clip-mockup move --after cm_123 --video vid_123 --at 14
  cvm clip-mockup move --video vid_123 --at 1`;
