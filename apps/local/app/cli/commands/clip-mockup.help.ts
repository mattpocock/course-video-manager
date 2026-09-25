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

Like a Beat and the Script, a Clip Mockup is an internal planning artifact: it
is NEVER published into course.json. Deleting is an archive, and archived ==
deleted (there is no restore verb).

LANDSCAPE ONLY. 'add' refuses a Video whose Video Format is 'short'.

LOCAL-ONLY. The frames are a directory on the author's machine
(CLIP_MOCKUP_DIR), so every verb here needs that machine. On any other box the
command is refused before it does anything, with _tag "LocalOnlyCommandError"
and exit 7, naming what it would have needed. That is a full stop, not a
retry.

Output fields: id, videoId, line (the spoken words), imagePath (relative to
{CLIP_MOCKUP_DIR}/{lineageId}/), durationSeconds (the measured length of the
line's speech; null until speech synthesis fills it), order (fractional sort
key), archived, createdAt.

Verbs (flags come BEFORE any positional <id> — a flag after it exits 3):
  add    --video <id> --image <path> --say "…"  Add a frame + line at the end
  list   --video <id>                           The Video's Animatic, in order
  get    <id…>                                  Read one or more back
  delete <id>                                   Archive (delete) one

Every write echoes the affected row as one pretty JSON object.

Examples:
  cvm clip-mockup add --video vid_123 --image /tmp/frame-01.png --say "Here's the problem."
  cvm clip-mockup list --video vid_123
  cvm clip-mockup get cm_456
  cvm clip-mockup delete cm_456`;

export const ADD_HELP = `WRITES. Add a Clip Mockup to the end of a Video's Animatic. Requires --video,
--image and --say; any of them missing is invalid input (exit 3).

Flags:
  --video <id>     the Video to add the Clip Mockup to. Unknown or archived is
                   a not-found (exit 2). A Video whose format is 'short' is
                   REFUSED — Clip Mockups are Landscape only (exit 3).
  --image <path>   a ready-made PNG on the local filesystem. It is COPIED into
                   {CLIP_MOCKUP_DIR}/{lineageId}/ under a fresh name, so the
                   CVM holds its own copy and clearing your scratch folder can
                   never empty the Animatic. The row stores the path RELATIVE
                   to that directory — never the path you passed. A missing or
                   unreadable source is invalid input (exit 3).
  --say "<text>"   the spoken line for this moment. One line per Clip Mockup:
                   it maps to the Clip it will become. Must not be empty.

Echoes the created row (with its new id, imagePath and computed order) as one
pretty JSON object. 'durationSeconds' is null: it is the measured length of
the line's speech and nothing synthesises speech yet.

Examples:
  cvm clip-mockup add --video vid_123 --image ./frames/01.png --say "Here's the problem."
  cvm clip-mockup add --video vid_123 --image /tmp/f.png --say "And here's the fix."`;

export const LIST_HELP = `READS. List a Video's full, ordered Animatic as NDJSON (one compact JSON
object per line; an empty Animatic prints nothing and exits 0). Requires
--video <videoId>.

Rows sort by 'order' ascending — playback order. Archived (deleted) Clip
Mockups are always excluded; there is no flag to include them.

The line's POSITION in this stream is how the author addresses one in
conversation ("number 14 is too dense"), so read it top to bottom rather than
by id.

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

export const DELETE_HELP = `WRITES. Delete (archive) a single Clip Mockup by id. For Clip Mockups,
archived == deleted: it leaves the Animatic and can never be listed or
addressed again (there is no restore verb).

The PNG on disk is deliberately LEFT ALONE. The row is the state; an orphan
frame in the Clip Mockup directory costs nothing and is never served.

Immediate — there is no confirmation prompt (this is an agent-facing tool).
Echoes the now-archived row ({ ..., archived: true }). An unknown or
already-deleted id is a not-found (exit 2).

Example:
  cvm clip-mockup delete cm_456`;
