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

CONTENT — the Definition Card. An Overlay's visible content is exactly a
'--title' plus a '--description': a small, branded on-screen card defining a
term at the moment it is spoken. That is the only content-kind there is, which
is why there is no --kind flag. The text is written inline on each Overlay;
there is no shared glossary or dictionary entity to pick from, and no
deduplication between placements — two Overlays that define the same term each
carry their own copy of the words.

Overlays are a WRITE surface with no editor UI: 'cvm overlay' is the only way
to author one. Writes are immediate — no confirmation, no dry-run — and each
echoes the affected row as one pretty JSON object.

DELETE IS A REAL DELETE. Unlike clip/beat/chapter, an Overlay has no archived
flag: 'overlay delete' removes the row outright and there is no restore. Its
title and description are gone with it.

Output fields: id, clipId (the anchor Clip), at (Clip-relative seconds),
durationInSeconds, title, description.

Verbs (flags come BEFORE the positional <id> — a flag after it exits 3):
  list   --video <id> [--clip <id>]   every Overlay on a Video, timeline order
  get    <id...>                      one or more Overlays by id (variadic)
  add    --clip <id> --at <s> --duration <s> --title <t> --description <d>
  update [flags] <id>                 re-anchor and/or edit in place
  delete <id>                         hard-delete (no archive, no restore)

Examples:
  cvm overlay list --video vid_123
  cvm overlay add --clip clip_9 --at 4.25 --duration 5 \\
    --title "Hydration" --description "Attaching event handlers to server HTML."
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

Each line carries: id, clipId, at, durationInSeconds, title, description.

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

Fields: id, clipId, at, durationInSeconds, title, description.

Examples:
  cvm overlay get ovl_456
  cvm overlay get ovl_456 ovl_789`;

export const ADD_HELP = `Place a new Overlay — a Definition Card — on a Clip. Every flag is required:
an Overlay with no anchor, no length or no words is not a thing worth having.

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
  --title <text>       the term being defined — the card's heading.
  --description <text> the definition itself — the card's body.

Nothing stops two Overlays overlapping in time; the export pipeline, not this
verb, decides what that means.

Echoes the created Overlay row, including its new id, as one pretty JSON object.

Example:
  cvm overlay add --clip clip_9 --at 4.25 --duration 5 \\
    --title "Hydration" --description "Attaching event handlers to server HTML."`;

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
  --title <text>       new card heading (the term).
  --description <text> new card body (the definition).

An unknown overlay id, or an unknown/archived --clip, is a not-found (exit 2).
Echoes the updated row. Flags must come BEFORE the <id> (a flag after it
exits 3).

Examples:
  cvm overlay update --at 6.5 ovl_456
  cvm overlay update --duration 8 --description "..." ovl_456
  cvm overlay update --clip clip_10 --at 0 ovl_456   # move to the next Clip`;

export const DELETE_HELP = `Delete a single Overlay by id. This is a HARD delete: the row is removed, not
archived. There is no restore verb and no --archived listing to find it in
afterwards — the Definition Card's title and description go with it.

Immediate: there is no confirmation prompt (this is an agent-facing tool).
Echoes the row that was deleted, so the words are at least on your terminal if
you deleted the wrong one. An unknown id is a not-found (exit 2).

Example:
  cvm overlay delete ovl_456`;
