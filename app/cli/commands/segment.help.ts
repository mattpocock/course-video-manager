/**
 * Long-form --help text for the `cvm segment` verbs, split out of segment.ts
 * to keep that command module under the repo's per-file token budget. These
 * are domain-teaching prose strings consumed only by Command.withDescription.
 */
export const HELP = `Segment — the film-time planning units of a single Video.

A Segment is one unit of a Video's PLAN: an ordered, pre-recording sketch of
"what this video does for the viewer", authored before the video is recorded.
Segments belong to a Video (not the Lesson/Pitch); each Video carries its own
plan and a Segment can be moved between Videos (its parent videoId is mutable).

Deliberately distinct from a Chapter/Clip: a Segment is the INTENDED structure
("what I planned to shoot") and need not map to any recorded Chapter or Clip
("what I shot"). Segments are an in-app authoring aid and are NEVER published.

segment is one of cvm's write-capable nouns: it has add/update/delete/move in
addition to list (lesson, video and pitch also carry write verbs now — see
'cvm --help'). Writes are immediate — no confirmation, no dry-run. archived ==
deleted (a deleted Segment is gone).

Segment kinds (the film-time job, from the Mise en Place glossary):
  definition   Explain a concept, term, or idea
  walkthrough  Step through existing code or a process
  playthrough  Build something live, start to finish
  quest        Set the viewer a challenge to attempt
  reaction     React to or review code or content

Positioning (add & move): pick a place with an anchor, not an index —
  --before <id>  before that segment | --after <id>  after it | (neither) end.
--before/--after are mutually exclusive; the CLI computes the fractional order.

Output fields: id, videoId, kind, title, description (never published), order
(fractional sort key), archived, createdAt.

Verbs (flags come BEFORE the positional <id> — a flag after it exits 3):
  list   --video <id>              A Video's full ordered plan (active only)
  add    --video|--pitch <id> [flags]  Create a Segment in a Video's plan
                                   (--pitch targets a pitch's video)
  update [flags] <id>              Patch title/description/kind
  move   --video <id> [flags] <id> Reorder, or move to another Video
  delete <id>                      Archive (delete) a Segment

Every write echoes the affected row as one pretty JSON object.

Examples:
  cvm segment list --video vid_123
  cvm segment add --video vid_123 --kind quest --title "Try it"
  cvm segment update --title "Setup" --kind walkthrough seg_456
  cvm segment move --video vid_123 --after seg_789 seg_456
  cvm segment delete seg_456`;

export const LIST_HELP = `List a Video's full, ordered Segment plan as NDJSON (one compact JSON object
per line; empty plan prints nothing). Requires --video <videoId>.

The list is the COMPLETE active plan, already sorted by 'order' ascending (plan
order). Archived (deleted) Segments are always excluded — there is no flag to
include them.

Each line carries: id, videoId, kind (definition|walkthrough|playthrough|quest|
reaction), title, description (in-app planning note; never published), order
(fractional sort key), archived (always false), createdAt.

Find a video id with 'cvm video list' or 'cvm video tree <id>'.

Examples:
  cvm segment list --video vid_123
  cvm segment list --video vid_123 | jq -r '.title'
  cvm segment list --video vid_123 | jq -r 'select(.kind=="walkthrough") | .id'`;

export const ADD_HELP = `Create a Segment in a Video's plan. Requires EXACTLY ONE of --video / --pitch
to name the target video (passing both, or neither, is invalid input, exit 3).

Flags:
  --video <id>        the Video to add the Segment to.
  --pitch <id>        target a PITCH's video instead: resolves the pitch's single
                      active video and adds the Segment there. If the pitch has
                      NO video yet, one is AUTO-CREATED (named after the pitch)
                      and the Segment is added to it — so 'add --pitch' can have
                      the side effect of creating a video. If the pitch has more
                      than one video it is ambiguous: invalid input (exit 3);
                      target the video directly with --video. An unknown or
                      archived pitch id is a not-found (exit 2).
  --kind <kind>       one of definition|walkthrough|playthrough|quest|reaction.
                      Defaults to 'definition'.
  --title <text>      short label (default "").
  --description <text> free-text planning note (default ""; never published).
  --before <id>       place immediately before that segment.
  --after <id>        place immediately after that segment.
                      (omit both --before/--after to append to the end.)

Echoes the created Segment row (including its new id and computed order) as one
pretty JSON object. --before/--after are mutually exclusive; an anchor that is
not a segment of the target video is a not-found (exit 2).

Examples:
  cvm segment add --video vid_123
  cvm segment add --video vid_123 --kind quest --title "Try it" --description "..."
  cvm segment add --video vid_123 --before seg_456
  cvm segment add --pitch pit_123 --kind quest --title "Try it"`;

export const UPDATE_HELP = `Patch a single Segment's content by id. At least one of --title / --description
/ --kind is required (an update with no fields is an invalid-input error, exit 3).

update ONLY changes content — it never repositions the Segment or moves it
between Videos (use 'move' for that). Only the flags you pass change; the rest
are left untouched.

Flags:
  --title <text>       new short label.
  --description <text> new planning note (never published).
  --kind <kind>        definition|walkthrough|playthrough|quest|reaction.

Echoes the updated Segment row. An unknown or already-deleted id is a not-found
(exit 2). Flags must come BEFORE the <id> (a flag after it exits 3).

Examples:
  cvm segment update --title "Setup" seg_456
  cvm segment update --kind walkthrough --description "Step through it" seg_456`;

export const MOVE_HELP = `Reposition a Segment within its plan, or move it into another Video. Requires
--video <targetVideoId> (pass the Segment's CURRENT video to reorder in place,
or a DIFFERENT video to drag it across).

Placement uses the same anchors as 'add':
  --before <id>  place immediately before that segment (of --video).
  --after  <id>  place immediately after it.
  (neither)      append to the end of --video's plan.

--before/--after are mutually exclusive and must name a segment of --video;
otherwise it is a not-found (exit 2). Echoes the moved Segment row with its new
videoId and computed order. Flags must come BEFORE the <id> (a flag after it
exits 3).

Examples:
  cvm segment move --video vid_123 --after seg_789 seg_456   # reorder in place
  cvm segment move --video vid_123 --before seg_789 seg_456
  cvm segment move --video vid_999 seg_456                   # to another video, end`;

export const DELETE_HELP = `Delete (archive) a single Segment by id. For Segments, archived == deleted: the
Segment is removed from its plan and can never be listed or addressed again
(there is no restore verb).

Immediate — there is no confirmation prompt (this is an agent-facing tool).
Echoes the now-archived row ({ ..., archived: true }). An unknown or
already-deleted id is a not-found (exit 2).

Example:
  cvm segment delete seg_456`;
