/**
 * Long-form --help text for the `cvm chapter` verbs, split out of chapter.ts to
 * keep that command module under the repo's per-file token budget. These are
 * domain-teaching prose strings consumed only by Command.withDescription.
 */
export const HELP = `chapter — a named divider grouping clips on a Video's timeline.

A Chapter is a titled marker within a Video that visually groups the Clips that
follow it (it maps 1:1 to a YouTube chapter). Clips and Chapters share ONE
fractional 'order' space — interleaving them in timeline order is exactly what
forms the Video's Transcript, where each Chapter renders as a '## <title>'
header. Chapters are children of a Video, addressed by id only; there is no
version scoping and archived chapters are always hidden (no --archived flag, no
restore verb — same one-way convention as 'clip delete').

Do NOT confuse a Chapter (the recorded-timeline grouping) with a Beat (the
pre-recording plan) — see 'cvm beat'.

Verbs:
  chapter list --video <videoId>          every active chapter on a Video (NDJSON)
  chapter get <id...>                      fetch one or more chapters by id (variadic)
  chapter add --video <id> --title <t>     add a chapter (append by default, or
              [--before | --after <id>]    place relative to a clip/chapter id)
  chapter update <id> --title <t>          rename a chapter
  chapter move <id> --before/--after <id>  reposition within the timeline
  chapter delete <id>                       archive the chapter (soft delete; no restore)

All writes are immediate — no confirmation, no dry-run (agent-facing tool). Like
every clip/chapter write they need the owning CourseVersion to be a Draft.`;

export const LIST_HELP = `List every active (non-archived) Chapter on a Video, in timeline order.

Requires --video <videoId>. Output is NDJSON — one compact chapter object per
line; a Video with no chapters prints nothing and exits 0. An unknown video id
is a not-found (exit 2).

Each line carries the chapter row: id, videoId, name (its title), order,
createdAt.

Examples:
  cvm chapter list --video vid_123
  cvm chapter list --video vid_123 | jq -r '.name'`;

export const GET_HELP = `Fetch one or more Chapters by id. Variadic: 'chapter get <id> [<id> ...]'.

Output contract (same as 'clip get'):
  - one id, found     -> a single pretty-printed JSON object (exit 0)
  - one id, missing   -> NotFoundError on stderr, exit 2
  - many ids          -> NDJSON of the FOUND chapters on stdout; any missing ids
                         are reported on stderr and the process exits 2

Archived chapters are treated as deleted and are never returned. Args are ids
ONLY — find them with 'chapter list --video <id>'.

Examples:
  cvm chapter get chap_abc
  cvm chapter get chap_abc chap_def`;

export const ADD_HELP = `Add a Chapter to a Video's timeline.

Requires --video <id> and --title <t>. Optionally one of --before / --after
<id> to place it against another item on the SAME video; because clips and
chapters share one order space, the anchor may be a Clip OR a Chapter id
(so 'chapter add --after <clipId>' opens a chapter right after a given clip).
With neither flag the chapter is appended to the END of the timeline.

Echoes the created chapter row. An unknown --video is a not-found (exit 2);
passing both --before and --after is invalid input (exit 3). Immediate, no
confirmation (agent-facing tool); needs the owning CourseVersion to be a Draft.

Examples:
  cvm chapter add --video vid_123 --title "Introduction"
  cvm chapter add --video vid_123 --title "Setup" --after clip_abc
  cvm chapter add --video vid_123 --title "Wrap up" --before chap_def`;

export const UPDATE_HELP = `Rename a Chapter. Requires --title <t> (the new title). Echoes the updated row.

An unknown or archived id is a not-found (exit 2). Immediate, no confirmation
(agent-facing tool); needs the owning CourseVersion to be a Draft.

Example:
  cvm chapter update chap_abc --title "Getting started"`;

export const MOVE_HELP = `Reposition a Chapter within its Video's timeline.

Requires exactly one of --before / --after <id>, where <id> is another item on
the SAME video (a Clip OR a Chapter, since they share one order space). Jumps
straight to the position in one call. An unknown anchor, or a chapter that does
not exist / is archived, is a not-found (exit 2); passing both flags or neither
is invalid input (exit 3). Needs the owning CourseVersion to be a Draft.

Examples:
  cvm chapter move chap_abc --before chap_def
  cvm chapter move chap_abc --after clip_ghi`;

export const DELETE_HELP = `Archive (soft-delete) a Chapter.

Sets 'archived: true'. Archived chapters are ALWAYS filtered out (no --archived
flag, no 'chapter get' access, no restore) — same one-way convention as
'clip delete'. Immediate, no confirmation (agent-facing tool); needs the owning
CourseVersion to be a Draft. Echoes the archived row.

Example:
  cvm chapter delete chap_abc`;
