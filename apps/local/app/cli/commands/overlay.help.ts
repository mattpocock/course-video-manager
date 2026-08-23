/**
 * Long-form --help text for the `cvm overlay` verbs, split out of overlay.ts
 * to keep that command module under the repo's per-file token budget. These
 * are domain-teaching prose strings consumed only by Command.withDescription.
 */
export const OVERLAY_HELP = `overlay — a visual layer composited on top of a Video's footage.

An Overlay is anchored to ONE Clip at '--at', a plain offset in SECONDS from
that Clip's own start (0 = the first frame of the Clip). Anchoring to a Clip
rather than to the Video's timeline is the point: retiming or reordering
earlier Clips carries the Overlay's anchor along with them.

Its '--duration' is INDEPENDENT of the anchor Clip's length. An Overlay
commonly runs on past the end of its anchor Clip and across however many
further Clips it takes to fill its length, truncated at the Video's own end.

CONTENT — the '--kind'. An Overlay carries one content-kind, and each kind has
its own content flags. Passing the other kind's is refused, not ignored.

  definitionCard (the default, and what every Overlay authored before the flag
    existed is): '--title' plus '--description' — a small, branded on-screen
    card defining a term at the moment it is spoken.
  bulletPanel: '--title' (the panel's own heading) plus '--bullets-json', a
    JSON file of at most 4 bullets, each an icon, a line of text and its own
    'revealAt'. The panel is drawn down the LEFT of frame — the side is fixed,
    not a choice — while the camera pans and zooms to clear room for it.

'revealAt' is SECONDS AFTER THE OVERLAY'S OWN START, so an authoring agent
derives it straight from the transcript as 'wordStartTime - overlayAt'. Bullets
must be listed in the order they are revealed, none may be negative, and each
needs 0.35s of room to ease in before the Overlay's own exit begins.

Icons are lucide names, kebab-case ("circle-check", "triangle-alert"). Any
lucide name works; one that is not a lucide name is refused at authoring time,
not discovered in a render.

The text is written inline on each Overlay; there is no shared glossary or
dictionary entity to pick from, and no deduplication between placements — two
Overlays that define the same term each carry their own copy of the words.

ANIMATION. An Overlay eases in and out by default. '--disable-enter-animation
true' and '--disable-exit-animation true' hard-cut instead, and they govern the
panel content and the camera move TOGETHER so the two can never desync. With
the enter animation off, bullets still appear at their own 'revealAt' — the
timing holds, only the motion goes.

THE CAMERA — derived, never authored. An Overlay's kind decides whether the
footage underneath it MOVES. A 'bulletPanel' pans and zooms the camera from its
centred framing to a right-shifted one for exactly the Overlay's window, and
back again — there is no flag for the move, and no keyframes to write: making it
a 'bulletPanel' is what gets it. A 'definitionCard' moves nothing. Because that
move is a crop, and a Clip Zoom is ALSO a crop that is already baked into the
footage by then, a camera-moving Overlay whose window lands on any Clip with a
Clip Zoom is refused (exit 3) rather than compounding the two — clear that
Clip's zoom ('cvm clip update --zoom none <id>'), or move the Overlay off it.

ONE AT A TIME. At most one Overlay is ever on screen at a given moment across
the whole Video — there are no tracks and no layering. An 'add' or an 'update'
whose window would overlap another Overlay's is refused (exit 3), whatever the
two kinds are and whichever Clips they are anchored to. The comparison is on
the VIDEO's flattened timeline, because an Overlay's duration is free to outrun
its anchor Clip. Windows that merely touch — one Overlay starting exactly where
the last one ended — are fine.

Overlays are a WRITE surface with no editor UI: 'cvm overlay' is the only way
to author one. Writes are immediate — no confirmation, no dry-run — and each
echoes the affected row as one pretty JSON object.

DELETE IS A REAL DELETE. Unlike clip/beat/chapter, an Overlay has no archived
flag: 'overlay delete' removes the row outright and there is no restore. Its
title and description are gone with it.

Output fields: id, clipId (the anchor Clip), at (Clip-relative seconds),
durationInSeconds, kind, title, description, bullets, disableEnterAnimation,
disableExitAnimation.

Verbs (flags come BEFORE the positional <id> — a flag after it exits 3):
  list   --video <id> [--clip <id>]   every Overlay on a Video, timeline order
  get    <id...>                      one or more Overlays by id (variadic)
  add    --clip <id> --at <s> --duration <s> [--kind <k>] --title <t>
         (--description <d> | --bullets-json <path|->)
  update [flags] <id>                 re-anchor and/or edit in place
  delete <id>                         hard-delete (no archive, no restore)

Examples:
  cvm overlay list --video vid_123
  cvm overlay add --clip clip_9 --at 4.25 --duration 5 \\
    --title "Hydration" --description "Attaching event handlers to server HTML."
  cvm overlay add --clip clip_9 --at 12 --duration 9 --kind bulletPanel \\
    --title "Three checks" --bullets-json ./bullets.json
  cvm overlay update --at 6 ovl_456
  cvm overlay update --clip clip_10 --at 0 ovl_456
  cvm overlay delete ovl_456`;

export const LIST_HELP = `List every Overlay on a Video as NDJSON (one compact JSON object per line; a
Video with no Overlays prints nothing and exits 0). Requires --video <videoId>.

Ordering is TIMELINE order: by the anchor Clip's position in the Video, then by
'at' within that Clip. Overlays anchored to an archived (deleted) Clip are never
listed — an archived Clip is off the timeline and so are its Overlays.

  --video <id>   the Video whose Overlays to list (required).
  --clip  <id>   narrow to the Overlays anchored to just this Clip. The Clip
                 must belong to --video; one that does not simply matches
                 nothing (empty output, exit 0).

Each line carries: id, clipId, at, durationInSeconds, kind, title,
description, bullets, disableEnterAnimation, disableExitAnimation.

An unknown --video id is a not-found (exit 2). Find a video id with
'cvm video list'; find its clip ids with 'cvm clip list --video <id>'.

Examples:
  cvm overlay list --video vid_123
  cvm overlay list --video vid_123 --clip clip_9
  cvm overlay list --video vid_123 | jq -r '"\\(.at)s \\(.title)"'`;

export const GET_HELP = `Fetch one or more Overlays by id. Ids only — there is no lookup by title.

  cvm overlay get <id>          one pretty-printed JSON object.
  cvm overlay get <id> <id> …   NDJSON, one compact object per line.

A single unknown id is a not-found (exit 2). With several ids the found ones are
still emitted on STDOUT and the MISSING ids are reported on STDERR with exit 2,
so a partly-stale list of ids still tells you everything it can.

Fields: id, clipId, at, durationInSeconds, kind, title, description, bullets,
disableEnterAnimation, disableExitAnimation.

Examples:
  cvm overlay get ovl_456
  cvm overlay get ovl_456 ovl_789`;

export const ADD_HELP = `Place a new Overlay on a Clip. Everything but '--kind' and the animation
toggles is required: an Overlay with no anchor, no length or no words is not a
thing worth having. Which CONTENT flag is required depends on '--kind'.

  --clip <id>          the anchor Clip. Unknown or archived is a not-found
                       (exit 2).
  --at <seconds>       offset from that Clip's OWN start, in seconds. 0 is the
                       Clip's first frame. Must be >= 0 and LESS than that
                       Clip's own length (exit 3 otherwise) — the anchor is a
                       moment inside the Clip, so an offset past its end would
                       show the card over a later Clip instead.
                       Read a precise spoken moment off the Clip's transcript
                       rather than guessing.
  --duration <seconds> how long the card stays on screen. Must be > 0. NOT
                       bounded by the anchor Clip: an Overlay may run on past
                       the Clip's end and across the Clips that follow.
  --kind <kind>        which content-kind to carry: 'definitionCard' (the
                       default, applied when the flag is omitted) or
                       'bulletPanel', which also moves the camera for the
                       Overlay's own window.
  --title <text>       the heading — the term being defined, or the Bullet
                       Panel's own title.
  --description <text> the definition itself — the card's body. REQUIRED for a
                       definitionCard, refused for a bulletPanel.
  --bullets-json <path|->
                       the Bullet Panel's bullets, as a JSON file ('-' reads
                       STDIN). REQUIRED for a bulletPanel, refused for a
                       definitionCard. An array of at most 4 objects:
                         [{ "icon": "circle-check",
                            "text": "It ships behind a flag",
                            "revealAt": 1.5 }]
                       'icon' is a lucide name (kebab-case); an unknown one is
                       refused here rather than at render time. 'revealAt' is
                       seconds after THIS OVERLAY's start — derive it as
                       'wordStartTime - overlayAt'. Bullets must be listed in
                       reveal order, none may be negative, and each needs 0.35s
                       to ease in before the Overlay's exit begins.
  --disable-enter-animation <true|false>
  --disable-exit-animation <true|false>
                       hard-cut in/out instead of easing. Governs the panel
                       content and the camera move together. Default false.
                       With the enter animation off, bullets still appear at
                       their own 'revealAt'.

Refused (exit 3) if the Overlay's window would overlap one already on this
Video, of either kind and on any Clip — only one Overlay is ever on screen at a
time. 'cvm overlay list --video <id>' shows what is already placed. Also refused
(exit 3) if a camera-moving kind's window lands on a Clip that already has a
Clip Zoom: the two crops compound rather than compose.

Echoes the created Overlay row, including its new id, as one pretty JSON object.

Examples:
  cvm overlay add --clip clip_9 --at 4.25 --duration 5 \\
    --title "Hydration" --description "Attaching event handlers to server HTML."
  cvm overlay add --clip clip_9 --at 12 --duration 9 --kind bulletPanel \\
    --title "Three checks" --bullets-json ./bullets.json`;

export const UPDATE_HELP = `Patch a single Overlay by id. At least one flag is required (an update with no
fields is an invalid-input error, exit 3). Only the flags you pass change.

  --clip <id>          RE-ANCHOR the Overlay to a different Clip in the SAME
                       Video. This is how an Overlay is moved — there is no
                       'overlay move' verb, because an Overlay's position is
                       just its anchor Clip plus '--at'. Note the offset is
                       Clip-relative, so re-anchoring WITHOUT also passing --at
                       keeps the old number against the new Clip's start (and
                       is refused, exit 3, if it does not fit there). A Clip in
                       ANOTHER Video is refused (exit 3): an Overlay cannot
                       cross Videos — delete it and add one there instead.
  --at <seconds>       new Clip-relative offset. Must be >= 0 and less than the
                       anchor Clip's own length.
  --duration <seconds> new on-screen length in seconds. Must be > 0.
  --kind <kind>        new content-kind: 'definitionCard' or 'bulletPanel'.
                       Changing it must bring the NEW kind's content with it in
                       the same command, and the old kind's content is dropped.
                       Changing TO a camera-moving kind is refused (exit 3) if
                       the Overlay's window lands on a zoomed Clip.
  --title <text>       new heading (the term, or the Bullet Panel's title).
  --description <text> new card body (the definition). definitionCard only.
  --bullets-json <path|->
                       replace the Bullet Panel's bullets outright — there is
                       no per-bullet edit. bulletPanel only. Validated against
                       the duration this command LEAVES the Overlay with.
  --disable-enter-animation <true|false>
  --disable-exit-animation <true|false>
                       turn a hard-cut on or off. Omitting one leaves it as it
                       was, which is why the value is spelled out.

A move or a resize (--clip / --at / --duration) that would put this Overlay on
screen at the same moment as another one on the Video is refused (exit 3);
editing only the content leaves the window where it is and is never refused for
that reason.

An unknown overlay id, or an unknown/archived --clip, is a not-found (exit 2).
Echoes the updated row. Flags must come BEFORE the <id> (a flag after it
exits 3).

Examples:
  cvm overlay update --at 6.5 ovl_456
  cvm overlay update --duration 8 --description "..." ovl_456
  cvm overlay update --clip clip_10 --at 0 ovl_456   # move to the next Clip
  cvm overlay update --bullets-json ./bullets.json ovl_456`;

export const DELETE_HELP = `Delete a single Overlay by id. This is a HARD delete: the row is removed, not
archived. There is no restore verb and no --archived listing to find it in
afterwards — the Overlay's own content, whichever kind it is, goes with it.

Immediate: there is no confirmation prompt (this is an agent-facing tool).
Echoes the row that was deleted, so the words are at least on your terminal if
you deleted the wrong one. An unknown id is a not-found (exit 2).

Example:
  cvm overlay delete ovl_456`;
