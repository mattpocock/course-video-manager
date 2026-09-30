/**
 * Long-form --help text for the `cvm clip-mockup` verbs, split out of
 * clip-mockup.ts to keep that command module under the repo's per-file token
 * budget. These are domain-teaching prose strings consumed only by
 * Command.withDescription.
 */
export const HELP = `Clip Mockup — one still image and one spoken line: a single moment of a Video,
decided before it is filmed. Played in order, a Video's Clip Mockups are its
ANIMATIC. Every Clip Mockup has an image AND a line.

Verbs (flags come BEFORE any positional <id> — a flag after it exits 3):
  add     --video <id> --clip-mockups-json <file>  Add a run of moments at the end
  list    --video <id> [--with-chapters]           The Video's Animatic, in order
  get     <id…>                                    Read one or more back
  update  --clip-mockups-json <file>               Swap frames and/or lines
  move    <id> | --video <id> --at <n>             Reorder within the Video
  delete  <id> | --video <id> --at <n>             Archive (delete) one
  capture <page.html>… [--sheet <sheet.png>]       Render pages to PNGs only — no row

THE BATCH FILE. 'add' and 'update' take one input, --clip-mockups-json <file>
(or "-" for STDIN): a JSON array, one entry per Clip Mockup, e.g.
  [{ "say": "Here's the problem.", "html": "01.html" }, { "chapter": "The fix" }]
File order is Animatic order; paths are relative to the file; the whole file
is checked first and lands together or not at all. Entry keys are in
'clip-mockup add --help' and 'clip-mockup update --help'.

Rows carry imagePath / audioPath (relative to {CLIP_MOCKUP_DIR}/{lineageId}/)
and imageFile / audioFile (the same files as absolute paths — read these).
An 'update' entry, 'move' and 'delete' address a Clip Mockup by id or by
Video + position (counting from 1, as 'list' and the player show it).

Exit codes: 2 not found; 3 invalid input (naming the entry); 4 a frame or a
line could not be made (_tag FrameCaptureError / SpeechSynthesisError) — no
row is written; 7 not the author's machine.

LOCAL-ONLY. Frames, speech and the headless browser are on the author's
machine (CLIP_MOCKUP_DIR). Elsewhere every verb is refused before doing
anything: _tag "LocalOnlyCommandError", exit 7. Stop; do not retry.

Examples:
  cvm clip-mockup capture frames/*.html --sheet frames/sheet.png
  cvm clip-mockup add --video vid_123 --clip-mockups-json frames/clip-mockups.json
  cvm clip-mockup list --video vid_123 | jq -r .imageFile
  echo '[{"video":"vid_123","at":14,"say":"Shorter."}]' | cvm clip-mockup update --clip-mockups-json -`;

export const CAPTURE_HELP = `RENDERS ONLY. Capture each page as a PNG, exactly as 'add' would — the same
headless Chromium, 1920x1080, after web fonts load — and write <page>.png
beside each <page>.html. Touches no row, voices no line, writes nothing to the
Clip Mockup store. Use it to LOOK at a frame before you 'add' it.

  cvm clip-mockup capture <page.html>... [--sheet <sheet.png>]

  <page.html>...        one or more .html / .htm pages. A page that is not
                        there, or is not .html, is invalid input (exit 3),
                        found before anything is captured.
  --sheet <sheet.png>   also write ONE contact sheet: every page, in the order
                        given, as a grid 3 tiles across (each tile 608x342, a
                        frame at under a third of its size), each labelled
                        with its 1-based index and file name. The sheet is
                        1920px wide and as tall as its rows. Check a run of
                        Reveals with one image read, then open any tile you
                        cannot read at full size.

Prints one NDJSON row per page, in the order given:
  {"html":"/abs/01.html","png":"/abs/01.png"}
and, with --sheet, a last row:
  {"sheet":"/abs/sheet.png"}

A page that will not render is a FrameCaptureError (exit 4) naming the page —
never a blank PNG. Local-only, like every verb here (exit 7 elsewhere).

Examples:
  cvm clip-mockup capture frames/01.html
  cvm clip-mockup capture frames/0*.html --sheet frames/sheet.png`;

/**
 * The addressing rules are identical for move / delete, so they are written
 * once and appended to both verbs' help. An 'update' entry takes the same two
 * forms as JSON keys, spelled out in UPDATE_HELP.
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

export const ADD_HELP = `WRITES. Add a run of Clip Mockups — and, if you like, the Clip Mockup Chapters
that divide them — to the END of a Video's Animatic, in the order the file
gives them. Requires --video and --clip-mockups-json.

Flags:
  --video <id>               the Video to add to. Unknown or archived is a
                             not-found (exit 2). A Video whose format is
                             'short' is REFUSED — Clip Mockups are Landscape
                             only (exit 3).
  --clip-mockups-json <path> a JSON array of entries; "-" reads STDIN. Paths
                             in it are relative to the file.

Each entry is ONE of:
  { "say": "<line>", "html": "<page.html>" }   a moment, from a page you wrote
  { "say": "<line>", "image": "<frame.png>" }  a moment, from a ready-made PNG
  { "chapter": "<title>" }                     a Clip Mockup Chapter: a divider
                                               above the moments after it

  "say"     the spoken line. One line per Clip Mockup: it maps to the Clip it
            will become. Must not be empty. It is SPOKEN, and the WAV written
            next to the frame. The same line twice is only voiced once.
  "html"    an HTML page, rendered in a headless Chromium at exactly 1920x1080;
            the screenshot becomes the frame. Prefer this: write the page, look
            at the result, rewrite the page. A page that will not render is a
            FrameCaptureError (exit 4) — a NAMED failure, never a blank frame.
  "image"   a ready-made PNG. It is COPIED into {CLIP_MOCKUP_DIR}/{lineageId}/
            under a fresh name, so clearing your scratch folder can never empty
            the Animatic. The row stores the path RELATIVE to that directory.
            The same image in several entries is copied once, and shared.
  "chapter" the divider's title — a coarse part of the plan, never a Beat.
            Takes no line and no picture.

An unknown key, a missing "say", both or neither of "html" / "image", or a
source file that does not exist is invalid input (exit 3), naming the entry —
and it is found BEFORE any frame is captured or line voiced. A capture or
speech failure (exit 4) creates no row.

Prints every row it wrote as NDJSON, in file order, each with a 'type' —
'clipMockup' (with its id, line, imagePath, audioPath, imageFile, audioFile,
durationSeconds and order) or 'clipMockupChapter' (with its id and name).
imagePath and audioPath are relative to {CLIP_MOCKUP_DIR}/{lineageId}/;
imageFile and audioFile are the same files as ABSOLUTE paths. audioPath is
named by a hash of the line, so two moments saying the same words share a WAV,
and durationSeconds is that WAV's measured length (a float — sum it for a
Video's run time).

Want to see a frame before it becomes a row? 'cvm clip-mockup capture' renders
pages to PNGs and writes nothing else.

The house style for a frame page ships in this repo, at frame-examples/ —
house.css, a class index in its README, and example pages (editor, terminal,
Claude Code, browser, title card, diagram). The stylesheet is the contract;
the markup is not. Copy the example nearest your moment, ALONGSIDE house.css,
and rewrite it freely.

Frames and speech are made by the CLIP MOCKUP DAEMON: one background process
on this machine holding one Chromium and one Kokoro-82M voice (af_heart) on
the GPU, shared by every call. The first call starts it; it stops after five
idle minutes; its log is in ~/.cache/cvm/clip-mockup-daemon/. Work from other
calls queues first come first served, so give 'add' a generous timeout. There
is no CPU fallback: a GPU that will not load fails with exit 4, and the
message carries the one-time install command.

The browser binary is a one-off install on this machine:
  pnpm --filter @cvm/local exec playwright install chromium

Example — frames/clip-mockups.json:
  [
    { "chapter": "The problem" },
    { "say": "Here's the problem.", "html": "01.html" },
    { "say": "It fails on every empty list.", "html": "02.html" },
    { "chapter": "The fix" },
    { "say": "And here's the fix.", "image": "03.png" }
  ]

  cvm clip-mockup add --video vid_123 --clip-mockups-json frames/clip-mockups.json
  cvm clip-mockup add --video vid_123 --clip-mockups-json frames/clip-mockups.json | jq -r .id`;

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

Flags:
  --with-chapters  also print the Video's Clip Mockup Chapters — the dividers
                   that group the Animatic — interleaved in the same order, and
                   add two fields to EVERY row:

                   'type'      'clipMockup' or 'clipMockupChapter'. The
                               discriminator: a reader never has to guess which
                               kind of row it holds, because the two shapes
                               differ (a Chapter has a 'name', no 'line', no
                               frame and no duration).
                   'position'  the '--at' number, 1..N over the CLIP MOCKUPS
                               ONLY, and null on a Chapter.

                   READ 'position' — NEVER COUNT THE LINES. Chapter rows sit in
                   this stream, so a line count runs ahead of the real position
                   and gives the wrong '--at' number for every Clip Mockup
                   below the first divider. That wrong number is what you would
                   pass to 'update', 'move' or 'delete', and what you would say
                   back to the author. The field makes the mistake impossible.

Every Clip Mockup row carries imagePath / audioPath (relative to
{CLIP_MOCKUP_DIR}/{lineageId}/) and imageFile / audioFile — the same files as
ABSOLUTE paths, so you can open a frame without knowing where the store is.

Without --with-chapters the stream is Clip Mockups only, with no 'type' or
'position' field. So every pipeline written against it keeps working,
including the run-time sum below.

Examples:
  cvm clip-mockup list --video vid_123
  cvm clip-mockup list --video vid_123 | jq -r .line
  cvm clip-mockup list --video vid_123 | jq -s length
  cvm clip-mockup list --video vid_123 | jq -s 'map(.durationSeconds) | add'
  cvm clip-mockup list --video vid_123 --with-chapters
  cvm clip-mockup list --video vid_123 --with-chapters | jq -r '"\\(.position // "--") \\(.line // .name)"'`;

export const GET_HELP = `READS. Read one or more Clip Mockups back by id. Variadic: pass as many ids
as you like.

ONE id => one pretty JSON object (exit 0), or a not-found (exit 2) if it is
unknown or already deleted. SEVERAL ids => NDJSON of the ones that were found
on stdout, then a not-found naming the missing ones on stderr (exit 2) — so
stdout stays pure data either way.

Each row carries imageFile and audioFile: the ABSOLUTE paths of its frame and
its WAV (imagePath / audioPath are the same files, relative to the store).

Find ids with 'cvm clip-mockup list --video <id>'.

Examples:
  cvm clip-mockup get cm_456
  cvm clip-mockup get cm_456 cm_789 | jq -r .imageFile`;

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

export const UPDATE_HELP = `WRITES. Change the frame, the line, or both, of any number of existing Clip
Mockups — a whole round of notes in one call. The Clip Mockups may belong to
different Videos. Requires --clip-mockups-json.

Flags:
  --clip-mockups-json <path> a JSON array of entries; "-" reads STDIN. Paths
                             in it are relative to the file.

Each entry names ONE Clip Mockup, and at least one change:
  "id"             the Clip Mockup id, as printed by 'list'/'get'; OR
  "video" + "at"   the Clip Mockup at POSITION "at" of that Video's Animatic,
                   counting from 1 — the number the author reads off the
                   screen. Every position is counted in the list as it is
                   BEFORE this call, so one entry never shifts another.
  "say"            the new spoken line. Must not be empty. New words are new
                   speech: the line is RE-SYNTHESISED and 'durationSeconds'
                   replaced in the same write, so the row can never claim a
                   run time for words it no longer says. A line this Video
                   has already voiced reuses that WAV.
  "html"           a new page, captured at 1920x1080 exactly as 'add' does.
                   This is the redraw loop: "number 14 is too dense" — edit the
                   page, list it here.
  "image"          a new PNG, copied in under a FRESH name, as 'add' does.

The two halves are INDEPENDENT: a new picture leaves the line exactly as it
was, and a new line leaves the picture alone. The old frame and the old WAV
are left on disk — the row is the state. There is no way to move a Clip Mockup
between Videos: its frame lives under its Video's directory.

Invalid input (exit 3), naming the entry, and found before any work: an
unknown key, an entry with both an "id" and a position (or neither), an entry
that changes nothing, "html" beside "image", a missing source file, a position
outside its list, and two entries for the same Clip Mockup. An unknown or
archived id is a not-found (exit 2). All the edits land together, or none do.

Prints every updated row as NDJSON, in file order, with imageFile and
audioFile (absolute paths) beside imagePath and audioPath.

Example — notes.json:
  [
    { "video": "vid_123", "at": 14, "say": "Shorter, and it lands harder." },
    { "video": "vid_123", "at": 15, "html": "frames/15-v2.html" },
    { "id": "cm_456", "image": "frames/fix.png", "say": "Both." }
  ]

  cvm clip-mockup update --clip-mockups-json notes.json`;

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
