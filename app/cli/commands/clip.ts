import { Args, Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import {
  detail,
  emitNdjson,
  emitObject,
  notFound,
  notFoundMany,
  parseError,
  rejectBothFlags,
} from "@/cli/helpers";
import { withBackupCoordination } from "@/cli/backup-coordinator";
import {
  CLIP_ZOOM_TYPES,
  type ClipZoomType,
} from "@/features/videos/clip-zoom";
import { MINIMUM_CLIP_LENGTH_SECONDS } from "@/silence-detection-constants";

/**
 * clip — a timestamped slice of source footage inside a Video.
 *
 * DOMAIN (see CONTEXT.md "Video and clips"):
 *   A Clip is one captured segment of source footage living on a Video's
 *   recorded timeline. It is defined by a source filename
 *   (`videoFilename`) and an in/out window into that file
 *   (`sourceStartTime`/`sourceEndTime`, in seconds). Clips and Chapters share
 *   a single fractional `order` space (varchar collate-C keys) — interleaving
 *   them in timeline order is exactly what produces the Video's Transcript.
 *   A Clip's `text` is the spoken transcription, populated from its audio
 *   (Transcription) and timestamped by `transcribedAt`. An "Effect Clip" is a
 *   special clip for non-speech content (white noise, transitions) inserted by
 *   hand. `pauseType` is the held pause after the clip ("none" or "long").
 *
 *   Clips are CHILDREN of a Video, addressed only by id. There is no version
 *   scoping here — clips belong to the live recorded timeline of one Video.
 *   Archived clips are treated as deleted: they are ALWAYS filtered out and
 *   never surfaced (no --archived flag on this noun, and no restore verb —
 *   same one-way convention as `beat delete`).
 *
 * OUTPUT FIELDS:
 *   id               clip id (use with `clip get`)
 *   videoId          parent Video id
 *   videoFilename    source footage file this clip is cut from
 *   sourceStartTime  in-point into the source file, seconds (float)
 *   sourceEndTime    out-point into the source file, seconds (float)
 *   order            fractional-index sort key (shared with Chapters)
 *   text             spoken transcription of the clip (the Transcript unit)
 *   transcribedAt    when `text` was last produced (null = not transcribed)
 *   scene / profile  optional capture metadata
 *   pauseType         held pause after clip; "none" or "long"
 *   zoomType          Clip Zoom; "none" or "subtle" (camera scenes only)
 *   diagramSnapshotId pinned DiagramSnapshot filmed against this clip, if any
 *   archived         always false in CLI output (archived rows are hidden)
 *   createdAt        row creation timestamp
 *
 * VERBS:
 *   clip list --video <videoId>          every active clip on a Video, timeline order
 *   clip get <id...>                     one or more clips by id (variadic)
 *   clip update <id> [flags]             set --zoom and/or retime --start/--end
 *   clip move <id> --before/--after <id> reposition within the Video's timeline
 *   clip delete <id>                     archive (soft delete; no restore)
 *
 * `update`'s --start/--end retime the cut WITHOUT touching `text`/`transcribedAt` — there is no
 * re-transcription step, so a retimed clip's text can drift out of sync with its new audio range
 * until something re-transcribes it. This was a deliberate v1 tradeoff, not an oversight: there
 * is no "what changed" signal to retranscribe from yet (see issue #1532, audio introspection).
 *
 * All writes here are IMMEDIATE — no confirmation, no dry-run (this is an agent-facing tool, same
 * convention as `beat`/`file`). The real safety net is version scoping: every write requires the
 * owning CourseVersion to be a draft, so published content can't be clobbered from here.
 *
 * Clips are leaf timeline rows — there is no `clip tree`. To explore a Video's structure use
 * `video tree`, then resolve ids with `clip get`. There is no `clip add`: every existing creator
 * (OBS capture append, "create video from selection") needs a real footage file + time range on
 * disk, so manual single-clip creation doesn't have anywhere to hang off yet.
 *
 * EXAMPLES:
 *   # All clips on a video, in timeline order (NDJSON):
 *   cvm clip list --video vid_123
 *
 *   # Just the transcript text of each clip:
 *   cvm clip list --video vid_123 | jq -r '.text'
 *
 *   # Find untranscribed clips:
 *   cvm clip list --video vid_123 | jq 'select(.transcribedAt == null) | .id'
 *
 *   # tree -> get workflow: pull clip ids off a video skeleton, then fetch them:
 *   cvm video tree --depth all vid_123 \
 *     | jq -r '.. | objects | select(.kind=="clip") | .id' \
 *     | xargs cvm clip get
 */
const CLIP_HELP = `clip — a timestamped slice of source footage on a Video's recorded timeline.

A Clip is one captured segment of source footage, defined by a source filename and an in/out
window into it (sourceStartTime/sourceEndTime, seconds). Clips and Chapters share one fractional
'order' space; interleaving them in order is what forms the Video's Transcript. A clip's 'text' is
its spoken transcription. Clips are children of a Video, addressed by id only; there is no version
scoping and archived clips are always hidden (no --archived flag, no restore verb).

Verbs:
  clip list --video <videoId>          every active clip on a Video, in timeline order (NDJSON)
  clip get <id...>                     fetch one or more clips by id (variadic)
  clip update <id> [flags]             set --zoom and/or retime --start/--end
  clip move <id> --before/--after <id> reposition within the timeline
  clip delete <id>                     archive the clip (soft delete; irreversible from the CLI)

All writes are immediate — no confirmation, no dry-run (agent-facing tool). There is no 'clip tree'
(clips are leaves) — use 'video tree' then 'clip get'. There is no 'clip add': creating a clip needs
a real footage file + time range, which no CLI-facing creator exists for yet.`;

const UPDATE_HELP = `Update a Clip: set its Clip Zoom and/or retime its cut.

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

Examples:
  cvm clip update clip_abc --zoom subtle
  cvm clip update clip_abc --start 12.4 --end 18.9
  cvm clip update clip_abc --end 18.9 --zoom none

  # Zoom every camera clip on a video:
  cvm clip list --video vid_123 \
    | jq -r 'select(.scene == "Camera") | .id' \
    | xargs -n1 -I{} cvm clip update {} --zoom subtle`;

const MOVE_HELP = `Reposition a Clip within its Video's timeline.

Requires exactly one of --before / --after <id>, where <id> is another active clip on the SAME
video (a clip cannot move across videos via this command). Clips and Chapters share one fractional
order space, so the new position is computed against both — landing a clip "after" the last clip
before a Chapter is well-defined even though the anchor id is a clip.

This jumps straight to an arbitrary position in one call, unlike a step-by-step up/down nudge.

Immediate — there is no confirmation prompt (this is an agent-facing tool).

Examples:
  cvm clip move clip_abc --before clip_def   # clip_abc lands immediately before clip_def
  cvm clip move clip_abc --after clip_def    # clip_abc lands immediately after clip_def`;

const DELETE_HELP = `Archive (soft-delete) a Clip.

Sets 'archived: true'. Archived clips are ALWAYS filtered out everywhere (no --archived flag, no
'clip get' access, no restore verb) — same one-way convention as 'beat delete'. The row still
exists in the database (unlike 'file delete', which is a real unlink), but nothing in this CLI can
bring it back.

Immediately, no confirmation prompt (this is an agent-facing tool). Only its ClipWebLinks cascade
on delete at the database level; nothing else references a Clip by foreign key, so deleting one
does not orphan any Beat, Script, or Deliverable.

Examples:
  cvm clip delete clip_abc`;

const LIST_HELP = `List every active (non-archived) Clip on a Video, in timeline order.

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

const GET_HELP = `Fetch one or more Clips by id. Variadic: 'clip get <id> [<id> ...]'.

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

const videoOpt = Options.text("video").pipe(
  Options.withDescription("Parent Video id whose clips to list")
);

const listCmd = Command.make("list", { video: videoOpt }, ({ video }) =>
  Effect.gen(function* () {
    const videoOps = yield* VideoOperationsService;
    const found = yield* videoOps
      .getVideoWithClipsById(video)
      .pipe(Effect.catchTag("NotFoundError", () => notFound("video", video)));
    yield* emitNdjson(found.clips);
  })
).pipe(Command.withDescription(detail(LIST_HELP)));

const ids = Args.text({ name: "id" }).pipe(Args.repeated);

const getCmd = Command.make("get", { ids }, ({ ids }) =>
  Effect.gen(function* () {
    const clipOps = yield* ClipOperationsService;
    // Clip is a leaf noun: archived = deleted, ALWAYS hidden (no flag). The
    // shared getClipsByIds has no archived filter, so the CLI enforces the
    // contract here — archived ids fall through to the not-found path (exit 2).
    const rows = (yield* clipOps.getClipsByIds(ids)).filter((r) => !r.archived);

    const byId = new Map(rows.map((row) => [row.id, row]));
    const found = ids
      .map((id) => byId.get(id))
      .filter((row): row is NonNullable<typeof row> => row !== undefined);
    const missing = ids.filter((id) => !byId.has(id));

    if (ids.length === 1) {
      if (found.length === 1) {
        yield* emitObject(found[0]);
        return;
      }
      return yield* notFound("clip", ids[0]!);
    }

    yield* emitNdjson(found);
    if (missing.length > 0) {
      return yield* notFoundMany("clip", missing);
    }
  })
).pipe(Command.withDescription(detail(GET_HELP)));

const zoomOpt = Options.choice("zoom", CLIP_ZOOM_TYPES).pipe(
  Options.withDescription(
    `Clip Zoom to set: ${CLIP_ZOOM_TYPES.join(" | ")}. Camera scenes only.`
  ),
  Options.optional
);

const startOpt = Options.float("start").pipe(
  Options.withDescription(
    "New sourceStartTime, in seconds (in-point into the source file)."
  ),
  Options.optional
);

const endOpt = Options.float("end").pipe(
  Options.withDescription(
    "New sourceEndTime, in seconds (out-point into the source file)."
  ),
  Options.optional
);

const beforeOpt = Options.text("before").pipe(
  Options.withDescription(
    "Place immediately before this clip id (mutually exclusive with --after)."
  ),
  Options.optional
);

const afterOpt = Options.text("after").pipe(
  Options.withDescription(
    "Place immediately after this clip id (mutually exclusive with --before)."
  ),
  Options.optional
);

const idArg = Args.text({ name: "id" });

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Resolve + gate a clip for a write: a bad id is a clean not-found (exit 2)
 * rather than arriving as a service failure, and archived clips are deleted
 * as far as this noun is concerned, so they are not-found too.
 */
const requireActiveClip = (id: string) =>
  Effect.gen(function* () {
    const clipOps = yield* ClipOperationsService;
    const [existing] = yield* clipOps.getClipsByIds([id]);
    if (!existing || existing.archived) {
      return yield* notFound("clip", id);
    }
    return existing;
  });

/**
 * Resolve `clip move`'s --before/--after into the single "anchor id" the
 * service positions against (mirrors `beat move`'s resolveBeforeBeatId, but
 * over the merged clip+chapter order space since clips and chapters share
 * one fractional order key). --after X resolves to whatever item currently
 * follows X — which may legitimately be a Chapter id, since the service's
 * `moveClipToPosition` positions against either.
 */
const resolveBeforeItemId = (params: {
  readonly videoId: string;
  readonly before: Option.Option<string>;
  readonly after: Option.Option<string>;
  readonly excludeId: string;
}) =>
  Effect.gen(function* () {
    const before = Option.getOrUndefined(params.before);
    const after = Option.getOrUndefined(params.after);

    yield* rejectBothFlags({
      a: before,
      b: after,
      flags: ["--before", "--after"],
      entity: "clip",
    });
    if (before === undefined && after === undefined) {
      return yield* parseError("move needs one of --before / --after", "clip");
    }

    const clipOps = yield* ClipOperationsService;
    const items = (yield* clipOps.listTimelineOrder(params.videoId)).filter(
      (item) => item.id !== params.excludeId
    );

    if (before !== undefined) {
      if (!items.some((item) => item.type === "clip" && item.id === before)) {
        return yield* notFound("clip", before);
      }
      return before;
    }

    const idx = items.findIndex(
      (item) => item.type === "clip" && item.id === after
    );
    if (idx === -1) {
      return yield* notFound("clip", after!);
    }
    return items[idx + 1]?.id ?? null;
  });

// ---------------------------------------------------------------------------
// Verbs
// ---------------------------------------------------------------------------

const updateCmd = Command.make(
  "update",
  { id: idArg, zoom: zoomOpt, start: startOpt, end: endOpt },
  ({ id, zoom, start, end }) =>
    withBackupCoordination(
      Effect.gen(function* () {
        const z = Option.getOrUndefined(zoom);
        const s = Option.getOrUndefined(start);
        const e = Option.getOrUndefined(end);

        if (z === undefined && s === undefined && e === undefined) {
          return yield* parseError(
            "update needs at least one of --zoom / --start / --end",
            "clip"
          );
        }

        const clipOps = yield* ClipOperationsService;
        let row = yield* requireActiveClip(id);

        if (s !== undefined || e !== undefined) {
          const newStart = s ?? row.sourceStartTime;
          const newEnd = e ?? row.sourceEndTime;
          if (newStart >= newEnd) {
            return yield* parseError(
              `--start (${newStart}) must be before --end (${newEnd})`,
              "clip"
            );
          }
          if (newEnd - newStart < MINIMUM_CLIP_LENGTH_SECONDS) {
            return yield* parseError(
              `clip would be ${(newEnd - newStart).toFixed(3)}s, below the ` +
                `${MINIMUM_CLIP_LENGTH_SECONDS}s minimum clip length`,
              "clip"
            );
          }
          row = yield* clipOps.updateClip(id, {
            sourceStartTime: newStart,
            sourceEndTime: newEnd,
          });
        }

        // setClipZoom re-checks eligibility — it is the service that owns the
        // rule. Translating its failure here is only about the exit code: an
        // ineligible clip is bad input (exit 3), not an internal fault.
        if (z !== undefined) {
          row = yield* clipOps
            .setClipZoom(id, z satisfies ClipZoomType)
            .pipe(
              Effect.catchTag("ClipNotZoomableError", (e) =>
                parseError(e.message, "clip")
              )
            );
        }

        yield* emitObject(row);
      })
    )
).pipe(Command.withDescription(detail(UPDATE_HELP)));

const moveCmd = Command.make(
  "move",
  { id: idArg, before: beforeOpt, after: afterOpt },
  ({ id, before, after }) =>
    withBackupCoordination(
      Effect.gen(function* () {
        const existing = yield* requireActiveClip(id);
        const beforeItemId = yield* resolveBeforeItemId({
          videoId: existing.videoId,
          before,
          after,
          excludeId: id,
        });

        const clipOps = yield* ClipOperationsService;
        const moved = yield* clipOps
          .moveClipToPosition(id, beforeItemId)
          .pipe(
            Effect.catchTag("NotFoundError", (e) =>
              notFound("clip", (e.params as { clipId?: string }).clipId ?? id)
            )
          );
        yield* emitObject(moved);
      })
    )
).pipe(Command.withDescription(detail(MOVE_HELP)));

const deleteCmd = Command.make("delete", { id: idArg }, ({ id }) =>
  withBackupCoordination(
    Effect.gen(function* () {
      yield* requireActiveClip(id);
      const clipOps = yield* ClipOperationsService;
      yield* clipOps.archiveClip(id);
      const [archived] = yield* clipOps.getClipsByIds([id]);
      yield* emitObject(archived);
    })
  )
).pipe(Command.withDescription(detail(DELETE_HELP)));

export const clipCommand = Command.make("clip").pipe(
  Command.withDescription(detail(CLIP_HELP)),
  Command.withSubcommands([listCmd, getCmd, updateCmd, moveCmd, deleteCmd])
);
