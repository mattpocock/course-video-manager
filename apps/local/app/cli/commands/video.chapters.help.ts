/**
 * Long-form --help text for `cvm video chapters`, split out of
 * video.chapters.ts as the other video help text is.
 */

export const CHAPTERS_HELP = `Read a Video's chapter list: where each Chapter starts in the EXPORTED video.

A Chapter carries no timestamp of its own; it starts where the Clips above it
end. This verb works that out with the same code the published course.json, the
"Copy YouTube chapters" button and the AI writer use, so all of them agree:

  - a Chapter starts at the floored sum of what the Clips above it add to the
    exported video (each Clip's span of source, plus the long Pause the export
    appends to a Clip whose Pause Type is "long")
  - a Chapter with no Clip time below it is dropped
  - when the first kept Chapter starts after 0:00, an "Intro" Chapter is added
    at 0:00 (YouTube needs one there)
  - a Video with no Chapters gives an empty list

The times are for an export of the Video as it is NOW. A Clip edited since the
last export moves them; re-export before you publish them anywhere.

Accepts a SINGLE video id (standalone or lesson-bound; a lineageId resolves to
the current Draft). Missing id -> NotFoundError on stderr, exit 2.

Output is one JSON object:
  { id, title, exportDurationSeconds, chapters: [{ title, startTime, timestamp }] }
where 'startTime' is whole seconds from the start of the video, 'timestamp' is
the same time as M:SS (H:MM:SS past the hour), and 'exportDurationSeconds' is
the length the export of these Clips comes out at.

Examples:
  cvm video chapters <id>
  cvm video chapters <id> | jq -r '.chapters[] | "\\(.timestamp) \\(.title)"'`;
