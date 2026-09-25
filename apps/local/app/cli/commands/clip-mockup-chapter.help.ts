/**
 * Long-form --help text for the `cvm clip-mockup-chapter` verbs, split out of
 * clip-mockup-chapter.ts to keep that command module under the repo's per-file
 * token budget. These are domain-teaching prose strings consumed only by
 * Command.withDescription.
 */
export const HELP = `clip-mockup-chapter — a named divider grouping a Video's Clip Mockups in its Animatic.

A Clip Mockup Chapter has a title and a position in the Animatic and nothing
else. It groups the Clip Mockups that follow it, in the spirit of a YouTube
chapter: coarse and navigational. It is never published, so its title is read by
the author and not by a viewer. He reads it as a divider in the Animatic
sidebar, where it collapses the moments under it. The row belongs to the VIDEO,
not to an Animatic — there is no Animatic record, and nothing is addressed by
that word.

ONE SHARED ORDER SPACE. A Chapter's 'order' is a fractional index in the SAME
key space as a Clip Mockup's, exactly as a Chapter shares one with a Clip. So
--before / --after accept ANY id in that space — a Clip Mockup id or another
Chapter id — and inserting a divider between two moments is one write with no
renumbering.

MEMBERSHIP IS IMPLICIT. A Clip Mockup belongs to the last Chapter above it in
the Animatic. There is no 'chapterId' on a Clip Mockup, so nothing is
re-parented when a row moves, and Clip Mockups above the first divider belong to
no Chapter. Deleting a Chapter therefore absorbs its Clip Mockups into the
Chapter above (or leaves them unchaptered) with no further write.

TWO DELIBERATE DIFFERENCES from 'cvm chapter', and both are on purpose:

  NOT LOCAL-ONLY. Every 'cvm clip-mockup' verb is refused off the author's machine,
  because a frame and a WAV are a directory there. A Clip Mockup Chapter is a
  row and touches no disk, so every verb here works from any box with a token —
  including the Remote Box. 'cvm clip-mockup-chapter list' works where
  'cvm clip-mockup list' beside it is refused.

  NO DRAFT COURSE VERSION. Every 'clip' and 'chapter' write needs the owning
  Course Version to be a Draft. No write here does. Clip Mockups sit outside
  that write-closure, and their grouping follows the thing it groups.

Do NOT confuse a Clip Mockup Chapter (the plan's dividers, before filming) with
a Chapter (the filmed timeline's dividers, which map 1:1 to YouTube chapters and
group Clips) — see 'cvm chapter'. The two nouns never meet: there is no link
between them, and a Clip Mockup Chapter has no link to a Beat either.

Addressed by BARE ID only. There is no --at and no lookup by title: a Chapter
has no position for --at to count to, and titles are not unique. Read the ids off
'clip-mockup-chapter list'.

Verbs:
  clip-mockup-chapter list --video <id>       the Video's active Chapters (NDJSON)
  clip-mockup-chapter get <id...>             one or more Chapters by id
  clip-mockup-chapter add --video <id>        open a Chapter (append by default,
      --title <t> [--before | --after <id>]   or place against any Animatic row)
  clip-mockup-chapter update --title <t> <id> rename a Chapter
  clip-mockup-chapter move                    slide a Chapter; an anchor is
      [--before | --after <anchor>] <id>      REQUIRED, unlike clip-mockup move
  clip-mockup-chapter delete <id>             archive it; its Clip Mockups are
                                              absorbed into the Chapter above

All writes are immediate — no confirmation, no dry-run (agent-facing tool). Read
an Animatic's lines with 'cvm clip-mockup list --video <id>'.`;

export const LIST_HELP = `List every active (non-archived) Clip Mockup Chapter on a Video, in Animatic order.

Requires --video <id>. Output is NDJSON — one compact Chapter object per line; a
Video with no Chapters prints nothing and exits 0. An unknown or archived video
id is a not-found (exit 2).

Each line carries the row: id, videoId, name (its title), order, archived,
createdAt. Archived Chapters are deleted as far as this noun is concerned and
are never returned; there is no restore verb.

Works from any box with a token — this verb is NOT local-only, unlike
'cvm clip-mockup list'.

Examples:
  cvm clip-mockup-chapter list --video vid_123
  cvm clip-mockup-chapter list --video vid_123 | jq -r '.id + " " + .name'`;

export const ADD_HELP = `Open a Clip Mockup Chapter in a Video's Animatic.

Requires --video <id> and --title <t>. With neither anchor the Chapter is
APPENDED to the end of the Animatic — which is the shape to use while
authoring: open a Chapter, then keep adding Clip Mockups into it, because a new
Clip Mockup also appends and so lands inside it.

Optionally one of --before / --after <id> to place the Chapter against a row on
the SAME Video. Because Clip Mockups and Chapters share one order space, the
anchor may be a Clip Mockup id OR another Chapter id, so "open a Chapter right
before number 14's row" is one call. Read the ids with
'cvm clip-mockup list --video <id>' and 'cvm clip-mockup-chapter list --video
<id>'.

Echoes the created row. An unknown --video or an unknown anchor is a not-found
(exit 2); passing both --before and --after is invalid input (exit 3).

No Draft Course Version is needed, and the verb is not local-only.

Examples:
  cvm clip-mockup-chapter add --video vid_123 --title "The problem"
  cvm clip-mockup-chapter add --video vid_123 --title "Setup" --after cm_abc
  cvm clip-mockup-chapter add --video vid_123 --title "Wrap up" --before cmc_def`;

export const GET_HELP = `Fetch one or more Clip Mockup Chapters by id. Variadic: 'clip-mockup-chapter get <id> [<id> ...]'.

Output contract (the same as every other noun's 'get'):
  - one id, found     -> a single pretty-printed JSON object (exit 0)
  - one id, missing   -> NotFoundError on stderr, exit 2
  - many ids          -> NDJSON of the FOUND Chapters on stdout; any missing ids
                         are named on stderr and the process exits 2

Args are BARE IDS only — there is no lookup by title, because titles are not
unique. Find the ids with 'clip-mockup-chapter list --video <id>'.

Archived Chapters are deleted as far as this noun is concerned and are never
returned; there is no restore verb.

Examples:
  cvm clip-mockup-chapter get cmc_abc
  cvm clip-mockup-chapter get cmc_abc cmc_def`;

export const UPDATE_HELP = `Rename a Clip Mockup Chapter. Requires --title <t> (the new title).

Takes --title, then the BARE ID (the flags come first). There is no --at and no
lookup by title: a Chapter has no
position for --at to count to, and titles are not unique. A title is a label
only, so renaming moves nothing and regroups nothing.

Echoes the updated row. An unknown or archived id is a not-found (exit 2). No
Draft Course Version is needed, and the verb is not local-only.

Example:
  cvm clip-mockup-chapter update --title "Getting started" cmc_abc`;

export const MOVE_HELP = `Slide a Clip Mockup Chapter to a new point in its Video's Animatic.

Takes EXACTLY ONE of --before / --after <id>, then the BARE ID of the Chapter to
move (the flags come first — @effect/cli reads the positional id last). Because Clip
Mockups and Chapters share one order space, the anchor may be a Clip Mockup id OR
another Chapter id, and the jump is one write with no renumbering.

AN ANCHOR IS REQUIRED — and this is where 'clip-mockup move' differs. That verb
sends a row to the END when you give it no anchor. A divider's job is to sit in
front of something, so the end of the Animatic is no meaningful home for it: a
call with no anchor is invalid input (exit 3), not "append". Both anchors at once
is invalid input too (exit 3).

Moving a Chapter regroups by position alone. Membership is implicit, so the Clip
Mockups the Chapter leaves behind are absorbed into the Chapter above them, and
the ones it lands in front of become its own. Nothing is re-parented.

An unknown anchor, or a Chapter that does not exist or is archived, is a
not-found (exit 2). No Draft Course Version is needed, and the verb is not
local-only.

Examples:
  cvm clip-mockup-chapter move --before cmc_def cmc_abc
  cvm clip-mockup-chapter move --after cm_ghi cmc_abc`;

export const DELETE_HELP = `Archive (soft-delete) a Clip Mockup Chapter. Takes a BARE ID.

Sets 'archived: true' and writes NOTHING ELSE. Archived Chapters are ALWAYS
filtered out — no --archived flag, no 'get' access, no restore verb.

ITS CLIP MOCKUPS SURVIVE. Membership is implicit, so deleting a divider does not
delete or re-parent one frame: every Clip Mockup that was under it is absorbed
into the Chapter above, or is left unchaptered if the deleted Chapter was the
first. A following 'cvm clip-mockup list --video <id>' still shows all of them.
An organisational verb can never destroy hours of frames and speech.

An unknown or archived id is a not-found (exit 2). Echoes the archived row.
Immediate, no confirmation (agent-facing tool). No Draft Course Version is
needed, and the verb is not local-only.

Example:
  cvm clip-mockup-chapter delete cmc_abc`;
