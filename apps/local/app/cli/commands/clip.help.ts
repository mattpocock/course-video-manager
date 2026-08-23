/**
 * Long-form --help text for the `cvm clip` verbs, split out of clip.ts to keep
 * that command module under the repo's per-file token budget. These are
 * domain-teaching prose strings consumed only by Command.withDescription.
 */
import { MINIMUM_CLIP_LENGTH_SECONDS } from "@/silence-detection-constants";

export const CLIP_HELP = `clip — a timestamped slice of source footage on a Video's recorded timeline.

A Clip is one captured segment of source footage, defined by a source filename and an in/out
window into it (sourceStartTime/sourceEndTime, seconds). Clips and Chapters share one fractional
'order' space; interleaving them in order is what forms the Video's Transcript. A clip's 'text' is
its spoken transcription. Clips are children of a Video, addressed by id only; there is no version
scoping and archived clips are always hidden (no --archived flag, no restore verb).

Verbs:
  clip list --video <videoId>          every active clip on a Video, in timeline order (NDJSON)
  clip get <id...>                     fetch one or more clips by id (variadic)
  clip add --video <id> --source <p> --start <t> --end <t>
                                       cut a new clip, text sliced from <source>'s cached transcript
  clip update <id> [flags]             set --zoom and/or retime --start/--end
  clip move <id> --before/--after <id> reposition within the timeline
  clip delete <id>                     archive the clip (soft delete; irreversible from the CLI)
  clip words <id>                      the clip's Transcript Words, in spoken order (NDJSON)

All writes are immediate — no confirmation, no dry-run (agent-facing tool). There is no 'clip tree'
(clips are leaves) — use 'video tree' then 'clip get'. 'clip add' cuts a single clip from a footage
file + time range and takes its text from that footage's cached transcript (see 'cvm footage').`;

export const UPDATE_HELP = `Update a Clip: set its Clip Zoom and/or retime its cut.

At least one of --zoom / --start / --end is required.

--zoom <t>: "none" (as filmed) or "subtle", rendering the clip slightly tighter so a run of
face-only camera clips has some visual change across its cuts. Only camera scenes can be zoomed —
'Camera' and 'TikTok Face'. Anything else (a 'Code' clip, or a clip filmed before CVM recorded
scenes) is refused with exit 3. Reaches the Export Hash, so setting it marks the Video for
re-export.

--start / --end <seconds>: move the in/out point into the source file. Either can be passed alone
(the other keeps its current value) or both together. Rejected with exit 3 if the resulting range
has start >= end, or is shorter than the ${MINIMUM_CLIP_LENGTH_SECONDS}s minimum clip length.

IMPORTANT: retiming does NOT touch 'text' or 'transcribedAt' — the transcript is not
re-generated for the new range. A retimed clip's text can be stale until something re-transcribes
it; there is currently no CLI signal for "this text no longer matches this range" (only the
pre-existing "never transcribed" signal, transcribedAt == null).

Retiming DOES cascade to everything positioned relative to the clip's start, in the same
transaction as the recut itself, because moving the in-point moves the footage out from under
every stored offset:

  Transcript Words ('cvm clip words') are shifted by the same delta as the recut. A word the new,
  shorter range no longer contains — either end outside [0, duration] — is DROPPED. Words are
  read-side data, reproducible by re-transcribing, and one claiming a moment the clip no longer
  holds is worse than no word at all.

  Overlays ('cvm overlay list') anchored to the clip have their 'at' shifted by that same delta,
  and an anchor pushed out of the new range is CLAMPED back inside it — to 0, or to the clip's new
  end (which for the video's final clip is the video's last frame). An Overlay is NEVER deleted by
  a retime, and its title/description are never touched: an unrelated trim must not be able to
  destroy hand-authored content. Check 'cvm overlay list --clip <id>' after a big retime — a
  clamped Definition Card is in the wrong place until you move it.

Examples:
  cvm clip update clip_abc --zoom subtle
  cvm clip update clip_abc --start 12.4 --end 18.9
  cvm clip update clip_abc --end 18.9 --zoom none

  # Zoom every camera clip on a video:
  cvm clip list --video vid_123 \
    | jq -r 'select(.scene == "Camera") | .id' \
    | xargs -n1 -I{} cvm clip update {} --zoom subtle`;

export const MOVE_HELP = `Reposition a Clip within its Video's timeline.

Requires exactly one of --before / --after <id>, where <id> is another active clip on the SAME
video (a clip cannot move across videos via this command). Clips and Chapters share one fractional
order space, so the new position is computed against both — landing a clip "after" the last clip
before a Chapter is well-defined even though the anchor id is a clip.

This jumps straight to an arbitrary position in one call, unlike a step-by-step up/down nudge.

Immediate — there is no confirmation prompt (this is an agent-facing tool).

Examples:
  cvm clip move clip_abc --before clip_def   # clip_abc lands immediately before clip_def
  cvm clip move clip_abc --after clip_def    # clip_abc lands immediately after clip_def`;

export const ADD_HELP = `Add a single Clip to a Video's timeline, cut from a source footage file.

Requires --video <id>, --source <path>, --start <t> and --end <t> (seconds).
Optionally one of --before / --after <id> to place it; with neither, the clip is
appended to the END of the Video's timeline.

TEXT comes from the CACHED footage transcript, not a fresh transcription: the
words of '<source>'s cached transcript (produced by 'cvm footage transcribe')
that fall in [start, end) are sliced out as the clip's 'text'. If '<source>' has
no cached transcript this is refused (exit 3) — run 'cvm footage transcribe
<source>' first. There is no live Whisper call here.

The SAME slice also populates the clip's Transcript Words (see 'clip words'),
re-based so 0 is the clip's own start — so a clip cut this way has per-word
timing straight away, with no re-transcribe step.

--before / --after resolve exactly like 'clip move': the anchor is another item
on the SAME video, and because clips and chapters share one order space the new
clip lands correctly even when the neighbour is a Chapter. The resulting clip is
an ordinary Clip in every way — zoomable, movable, deletable, listed by
'clip list'. Rejected (exit 3) if start >= end or the range is shorter than the
${MINIMUM_CLIP_LENGTH_SECONDS}s minimum clip length; an unknown --video is a
not-found (exit 2).

Immediate — no confirmation (agent-facing tool). Like every clip write it needs
the owning CourseVersion to be a Draft (a non-Draft is refused).

Examples:
  cvm footage transcribe /footage/take.mkv
  cvm clip add --video vid_123 --source /footage/take.mkv --start 12.4 --end 40.0
  cvm clip add --video vid_123 --source /footage/take.mkv --start 5 --end 9 --before clip_def`;

export const DELETE_HELP = `Archive (soft-delete) a Clip.

Sets 'archived: true'. Archived clips are ALWAYS filtered out everywhere (no --archived flag, no
'clip get' access, no restore verb) — same one-way convention as 'beat delete'. The row still
exists in the database (unlike 'file delete', which is a real unlink), but nothing in this CLI can
bring it back.

Immediately, no confirmation prompt (this is an agent-facing tool). Only its ClipWebLinks cascade
on delete at the database level; nothing else references a Clip by foreign key, so deleting one
does not orphan any Beat, Script, or Deliverable.

Examples:
  cvm clip delete clip_abc`;

export const LIST_HELP = `List every active (non-archived) Clip on a Video, in timeline order.

Requires --video <videoId>: the parent Video whose clips to source. Derived from the Video's
clip set (getVideoWithClipsById), already ordered by the shared clip/chapter 'order' key, so the
output reflects the recorded timeline. Output is NDJSON — one compact clip object per line; an
empty video prints nothing and exits 0. An unknown video id is a not-found error (exit 2).

Each line is identity-rich (id, videoId, order, text) so an agent can map content to ids in one
call, then drill in with 'clip get'.

Examples:
  cvm clip list --video vid_123
  cvm clip list --video vid_123 | jq -r '.text'
  cvm clip list --video vid_123 | jq 'select(.transcribedAt==null) | .id'`;

export const GET_HELP = `Fetch one or more Clips by id. Variadic: 'clip get <id> [<id> ...]'.

Backed by the native multi-id getter (getClipsByIds), so many ids resolve in a single query.

Output contract:
  - one id, found     -> a single pretty-printed JSON object (exit 0)
  - one id, missing   -> NotFoundError on stderr, exit 2
  - many ids          -> NDJSON of the FOUND clips on stdout; if any id is missing, those ids are
                         reported on stderr and the process exits 2 (stdout stays pure data)

Args are ids ONLY (never names/paths). Find ids first with 'clip list --video <id>' or 'video tree'.

Examples:
  cvm clip get clip_abc
  cvm clip get clip_abc clip_def clip_ghi
  cvm clip get clip_abc | jq '{id, text, start: .sourceStartTime, end: .sourceEndTime}'`;

export const WORDS_HELP = `A Clip's Transcript Words — the per-word timing of its spoken audio.

One NDJSON object per word, in spoken order:

  { "start": 1.2, "end": 1.5, "text": "overlay" }

'start'/'end' are seconds CLIP-RELATIVE: 0 is the clip's own start, NOT an
offset into the source footage file and NOT a position in the Video's finished
timeline. They survive the source footage being re-recorded or moved, because
they are stored on the clip itself.

Words are written by transcribing the clip (the editor's transcribe action) or,
for a clip cut with 'clip add', by slicing '<source>'s cached footage transcript.
A clip that has never been transcribed simply HAS no words: that prints nothing
and exits 0 — it is an ordinary state, not an error. Clips transcribed before
Transcript Words existed are in exactly that state and need a re-transcribe.

Read-only: there is no CLI verb that writes or edits an individual word.

Examples:
  cvm clip words clip_abc

  # When was "overlay" said in this clip?
  cvm clip words clip_abc | jq 'select(.text == "overlay")'`;
