/**
 * Long-form --help text for the `cvm video` verbs, split out of video.ts to
 * keep that command module under the repo's per-file token budget (mirrors
 * segment.help.ts). Domain-teaching prose consumed only by
 * Command.withDescription — keep in sync with CONTEXT.md.
 */

export const VIDEO_HELP = `Video — a container of Clips and Chapters that represents a single producible video output.

A Video holds two ordered, interleaved children:
  - Clips:    timestamped slices of source footage (start/end time + a source
              filename), each carrying transcribed 'text'. Clips are the words.
  - Chapters: named markers/dividers that visually group Clips and map 1:1 to
              YouTube chapters. Chapters are the headings.
Together, projected in timeline order, Clips + Chapters form the Video's
TRANSCRIPT (see 'video transcript').

A Standalone Video has no lesson association (lessonId = NULL) and is used for
reference or temporary content; it may be packaged by a Pitch. A lesson-bound
Video belongs to a Lesson inside a Section of a Course Version.

This command exposes ONLY Standalone Videos for 'list' (the complete set, not
the UI's recent-5). 'get', 'tree' and 'transcript' accept ANY video id
(standalone or lesson-bound).

Archived Videos are soft-deleted (hidden from active views). Only Standalone
Videos have a real viewable archive — pass --archived to 'list' to see them.

Verbs:
  list                 every Standalone Video (active by default; --archived for the archive)
  get <id...>          a Video plus its Clips and Chapters (variadic; NDJSON when >1 id)
  tree <id>            skeleton: video -> clips/chapters (id/kind/name/children)
  transcript <id>      the ordered text projection (Clips + Chapters as prose)
  create --name <n>    create a Video (--lesson <id> | --pitch <id> | neither=standalone) (WRITE)
  move <id>            re-home a Video to a lesson/pitch (--lesson | --pitch) (WRITE)
  update <id>          patch a Video's name / body / SEO description (WRITE)

Worked example (find a video, then read it):
  cvm video list | jq -r '.id'                     # map name -> id
  cvm video get <id> | jq '.clips | length'        # how many clips
  cvm video tree <id>                              # skeleton overview
  cvm video transcript <id> | jq -r '.transcript'  # the prose transcript`;

export const LIST_HELP = `List the COMPLETE set of Standalone Videos (lessonId = NULL, pitch-bound or not).

Active videos only by default, ordered by most-recently-updated. Each row is the
full video plus its non-archived Clips, so an agent can map name -> id in one
call. Output is NDJSON (one compact JSON object per line); an empty set prints
nothing and exits 0.

Key fields:
  id         the stable video id (use with get/tree/transcript)
  name       uniform display label every noun's 'list' carries (mirrors 'path'),
             so you never have to guess the label field
  path       the video's name within its lesson (its display/file name)
  pitchId    set when a Pitch packages this standalone video; else null
  archived   soft-delete flag (always false here unless --archived)
  clips[]    the video's clips in timeline order (order, text, source times)

Flags:
  --archived   include the ARCHIVE instead: only soft-deleted Standalone Videos
               (getArchivedStandaloneVideos). Standalone Videos are the only
               videos with a viewable archive.

Examples:
  cvm video list
  cvm video list --archived
  cvm video list | jq -r '"\\(.id)\\t\\(.path)"'`;

export const GET_HELP = `Get one or more Videos by id (variadic), each with its immediate children.

This is a shallow, fixed-depth read: the video row plus its non-archived Clips
(in timeline order) and Chapters, and a little parent context (its Lesson /
Section / Course Version when lesson-bound). Accepts ANY video id — standalone
OR lesson-bound.

Output:
  - exactly one id, found    -> one pretty JSON object, exit 0
  - exactly one id, missing  -> {"_tag":"NotFoundError","entity":"video",...} on
                                stderr, exit 2
  - multiple ids             -> NDJSON of the FOUND videos on stdout; any missing
                                ids are reported on stderr and the exit code is 2
                                (stdout stays pure data)

Selected fields:
  id, path, lessonId, pitchId, archived
  clips[]    { id, order, text, videoFilename, sourceStartTime, sourceEndTime,
               transcribedAt, beatType, ... } — order is a fractional index
  chapters[] { id, order, name } — named YouTube-style dividers

Examples:
  cvm video get <id>
  cvm video get <id1> <id2> <id3>
  cvm video get <id> | jq '.clips[] | .text'`;

export const TREE_HELP = `Print the SKELETON of a Video: its Clips and Chapters as a shallow tree.

Each node is just { id, kind, name, children } — no full entity fields. Use this
to see a video's shape at a glance, then 'video get'/'cvm clip get' to pull
detail. A Video's natural children are its non-archived Clips (kind:"clip",
name = clip text) and Chapters (kind:"chapter", name = chapter name), interleaved
in timeline order.

Depth:
  --depth N      expand N levels (default 1 = video + its direct clips/chapters)
  --depth all    expand the full subtree
Clips and Chapters are leaves, so a Video's tree is fully expanded at depth 1.

NOTE ON FLAG ORDER
  Options must come BEFORE the positional id (e.g. 'tree --depth all <id>', NOT
  'tree <id> --depth all') — a flag placed after the id is rejected (exit 3).

Examples:
  cvm video tree <id>
  cvm video tree --depth all <id>
  cvm video tree <id> | jq '.children[] | select(.kind=="chapter") | .name'`;

export const TRANSCRIPT_HELP = `Render a Video's TRANSCRIPT — its ordered text projection.

The Transcript interleaves the Video's Clips and Chapters in timeline order and
renders each Chapter as a '## <name>' heading between paragraphs of clip text
(the same projection shipped as {video}.transcript.md at Publish). This is the
unit of comparison for changelog diffs.

Accepts a SINGLE video id (standalone or lesson-bound). Missing id ->
NotFoundError on stderr, exit 2.

Output is one JSON object:
  { id, path, lessonId, transcript, wordCount, items }
where 'transcript' is the rendered prose string and 'items' is the structured
sequence of { type:"section", name } / { type:"clip", text } entries.

Examples:
  cvm video transcript <id>
  cvm video transcript <id> | jq -r '.transcript'
  cvm video transcript <id> | jq '.wordCount'`;

export const CREATE_HELP = `Create a Video. Requires --name <n> (the video's name / path).

Choose the parent with a flag (they are mutually exclusive):
  --lesson <id>   create the video inside that Lesson.
  --pitch <id>    create the video packaged by that Pitch (a Standalone video).
  (neither)       create a free Standalone video (no lesson, no pitch).

--name is ALWAYS required, including under --pitch. Passing both --lesson and
--pitch is invalid input (exit 3). An unknown --lesson / --pitch id is a
not-found (exit 2). A --name that collides with an existing video in the same
lesson is invalid input (exit 3). Echoes the created video row.

Examples:
  cvm video create --name "Intro"
  cvm video create --name "01-setup" --lesson les_abc
  cvm video create --name "My Pitch Cut" --pitch pit_123`;

export const MOVE_HELP = `Re-home an existing Video to a Lesson or a Pitch. Requires EXACTLY ONE of
--lesson <id> / --pitch <id> (passing both, or neither, is invalid input,
exit 3).

"move" enforces the single-parent invariant: moving to a lesson clears any pitch
association, and moving to a pitch clears any lesson association — a Video always
ends up with exactly one parent. An unknown video / lesson / pitch id is a
not-found (exit 2). Moving into a lesson where the video's name is already taken
is invalid input (exit 3). Flags must come BEFORE the <id>. Echoes the moved row.

Examples:
  cvm video move --lesson les_abc vid_123
  cvm video move --pitch pit_123 vid_123`;

export const UPDATE_HELP = `Patch a Video by id. A PARTIAL update: pass only the fields you want to change,
and only those columns are written (unset flags are left untouched). At least one
of --name / --body / --body-file / --description is required (an update with none
is invalid input, exit 3).

Fields:
  --name <n>          the Video's 'name' (its 'path' column). For lesson-bound
                      videos the new name must be unique within the lesson (a
                      collision is invalid input, exit 3). Must be non-empty.
  --body <md>         the Video's markdown BODY (the 'body' column) as inline
                      text. Mutually exclusive with --body-file.
  --body-file <path>  read the markdown BODY from a file; '-' reads STDIN.
                      Mutually exclusive with --body. An unreadable path is
                      invalid input (exit 3).
  --description <s>   the Video's SEO DESCRIPTION (the 'video_description'
                      column) as inline text.

Body and SEO description are the DB-owned fields the AI Hero auto-link publishes.
Passing an empty string ("") stores an empty value (it does not clear to null).
An unknown id is a not-found (exit 2). Flags must come BEFORE the <id>. Echoes
the updated video row.

Examples:
  cvm video update --name "02-refactor" vid_123
  cvm video update --description "Learn to refactor a reducer" vid_123
  cvm video update --body "# Intro\\n\\nWelcome…" vid_123
  cvm video update --body-file ./notes.md vid_123
  some-tool | cvm video update --body-file - vid_123
  cvm video update --name "03-final" --description "The finished cut" vid_123`;
