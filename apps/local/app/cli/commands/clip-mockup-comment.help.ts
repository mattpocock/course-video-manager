/**
 * Long-form --help text for the `cvm clip-mockup-comment` verbs, split out of
 * clip-mockup-comment.ts to keep that command module under the repo's per-file
 * token budget.
 */
export const HELP = `clip-mockup-comment — a note the author pins to one Clip Mockup or one Clip Mockup Chapter.

A Clip Mockup Comment is a body of text and nothing else. It hangs off EXACTLY
ONE parent: a Clip Mockup (one moment of the Animatic) or a Clip Mockup Chapter
(one of its dividers). A parent can have many comments. The teleprompter shows
them under the line or divider they hang off, so the author sees them while he
films. Read them before you review or rewrite a Video's Clip Mockups: they are
the author's own notes on the plan.

There is NO AUTHOR on a comment. The CVM has no users, so every comment is
simply a comment.

The Video is read off the parent — you never pass --video to a write. When the
parent is archived its comments are hidden and cannot be written. Deleting a
comment is a real delete: there is no archive and no restore.

NOT LOCAL-ONLY, like 'clip-mockup-chapter': every verb here works from any box
with a token. Every write needs the Video's Course Version to be a Draft
(VersionNotDraftError, exit 3, otherwise), like 'clip' and 'chapter'.

Verbs:
  clip-mockup-comment list --video <id>        the Video's comments, oldest first (NDJSON)
  clip-mockup-comment get <id...>              one or more comments by id
  clip-mockup-comment add --body <text>        pin a new comment
      (--clip-mockup <id> | --clip-mockup-chapter <id>)
  clip-mockup-comment update --body <text> <id> replace a comment's body
  clip-mockup-comment delete <id>              delete it for good

All writes are immediate — no confirmation, no dry-run (agent-facing tool).`;

export const LIST_HELP = `List every visible comment on a Video's Clip Mockups and Clip Mockup Chapters, oldest first.

Requires --video <id>. Output is NDJSON — one comment per line; a Video with no
comments prints nothing and exits 0. An unknown or archived video id is a
not-found (exit 2).

Each line carries: id, videoId, clipMockupId, clipMockupChapterId (exactly one
of the two is set), body, createdAt, updatedAt. Join clipMockupId to
'cvm clip-mockup list --video <id>' and clipMockupChapterId to
'cvm clip-mockup-chapter list --video <id>' to see what each comment is about.

Examples:
  cvm clip-mockup-comment list --video vid_123
  cvm clip-mockup-comment list --video vid_123 | jq -r '(.clipMockupId // .clipMockupChapterId) + " " + .body'`;

export const ADD_HELP = `Pin a new comment to a Clip Mockup or a Clip Mockup Chapter.

Requires --body <text> and EXACTLY ONE of --clip-mockup <id> /
--clip-mockup-chapter <id>. Neither or both is invalid input (exit 3). An
unknown or archived parent is a not-found (exit 2). A Course Version that is not
a Draft refuses the write (exit 3).

Echoes the created row.

Examples:
  cvm clip-mockup-comment add --clip-mockup cm_abc --body "Say this slower."
  cvm clip-mockup-comment add --clip-mockup-chapter cmc_def --body "Film this part last."`;

export const GET_HELP = `Fetch one or more comments by id. Variadic: 'clip-mockup-comment get <id> [<id> ...]'.

Output contract (the same as every other noun's 'get'):
  - one id, found     -> a single pretty-printed JSON object (exit 0)
  - one id, missing   -> NotFoundError on stderr, exit 2
  - many ids          -> NDJSON of the FOUND comments on stdout; any missing ids
                         are named on stderr and the process exits 2

A comment whose parent is archived is not found.

Example:
  cvm clip-mockup-comment get cmt_abc`;

export const UPDATE_HELP = `Replace a comment's body. Requires --body <text>, then the BARE ID.

The parent never changes: to move a note, delete it and add it again. Echoes
the updated row. An unknown id is a not-found (exit 2); a Course Version that is
not a Draft refuses the write (exit 3).

Example:
  cvm clip-mockup-comment update --body "Say this much slower." cmt_abc`;

export const DELETE_HELP = `Delete a comment for good. Takes a BARE ID.

This is a real delete, not an archive: there is no restore. Echoes the row as it
was. An unknown id is a not-found (exit 2); a Course Version that is not a Draft
refuses the write (exit 3).

Example:
  cvm clip-mockup-comment delete cmt_abc`;
