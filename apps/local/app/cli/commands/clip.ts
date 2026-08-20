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
import {
  CLIP_ZOOM_TYPES,
  type ClipZoomType,
} from "@/features/videos/clip-zoom";
import { MINIMUM_CLIP_LENGTH_SECONDS } from "@/silence-detection-constants";
import { readFootageSidecar } from "@/services/footage-cache";
import { sliceTranscriptText } from "@/services/footage-chunking";
import {
  CLIP_HELP,
  LIST_HELP,
  GET_HELP,
  ADD_HELP,
  UPDATE_HELP,
  MOVE_HELP,
  DELETE_HELP,
} from "./clip.help";

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
 *   clip add --video <id> --source <p>   cut a new clip, text sliced from the
 *     --start <t> --end <t>              cached footage transcript
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
 * `video tree`, then resolve ids with `clip get`. A clip is normally captured by OBS append or
 * "create video from selection", but `clip add` also creates one by hand from a footage file and a
 * time range, taking its text from that footage's cached transcript (see `cvm footage transcribe`).
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

const videoAddOpt = Options.text("video").pipe(
  Options.withDescription("The Video id to add the clip to (required).")
);

const sourceOpt = Options.text("source").pipe(
  Options.withDescription(
    "Path to the source footage file the clip is cut from (required). Its " +
      "cached transcript (from 'cvm footage transcribe') supplies the clip text."
  )
);

const addStartOpt = Options.float("start").pipe(
  Options.withDescription("In-point into the source file, seconds (required).")
);

const addEndOpt = Options.float("end").pipe(
  Options.withDescription("Out-point into the source file, seconds (required).")
);

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
 * Resolve `clip move`/`clip add`'s --before/--after into the single "anchor id"
 * the service positions against (mirrors `beat move`'s resolveBeforeBeatId, but
 * over the merged clip+chapter order space since clips and chapters share
 * one fractional order key). --after X resolves to whatever item currently
 * follows X — which may legitimately be a Chapter id, since the service's
 * `moveClipToPosition`/`createClip` positions against either.
 *
 * Neither flag returns `null` — "append to the end" for `add`. `clip move`
 * requires exactly one and rejects the neither case at its own call site (a move
 * that keeps a clip where it is would be a silent no-op, not an append).
 * `excludeId` is the clip being MOVED (skipped so it never anchors to itself);
 * `add` omits it, since the new clip is not on the timeline yet.
 */
const resolveBeforeItemId = (params: {
  readonly videoId: string;
  readonly before: Option.Option<string>;
  readonly after: Option.Option<string>;
  readonly excludeId?: string;
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
      return null;
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

const addCmd = Command.make(
  "add",
  {
    video: videoAddOpt,
    source: sourceOpt,
    start: addStartOpt,
    end: addEndOpt,
    before: beforeOpt,
    after: afterOpt,
  },
  ({ video, source, start, end, before, after }) =>
    Effect.gen(function* () {
      if (start >= end) {
        return yield* parseError(
          `--start (${start}) must be before --end (${end})`,
          "clip"
        );
      }
      if (end - start < MINIMUM_CLIP_LENGTH_SECONDS) {
        return yield* parseError(
          `clip would be ${(end - start).toFixed(3)}s, below the ` +
            `${MINIMUM_CLIP_LENGTH_SECONDS}s minimum clip length`,
          "clip"
        );
      }

      // The video must exist. `createClip`'s draft-guard passes a missing video
      // straight through (the insert would then fail on the FK), so confirm here
      // for a clean not-found (exit 2) instead.
      const videoOps = yield* VideoOperationsService;
      yield* videoOps
        .getVideoWithClipsById(video)
        .pipe(Effect.catchTag("NotFoundError", () => notFound("video", video)));

      // Text is SLICED FROM THE CACHED footage transcript — never a live Whisper
      // call. No cache -> tell the agent to transcribe the footage first.
      const sidecar = yield* readFootageSidecar(source);
      if (sidecar === null) {
        return yield* parseError(
          `no cached transcript for ${source} — run ` +
            `'cvm footage transcribe ${source}' first`,
          "clip"
        );
      }
      const text = sliceTranscriptText(sidecar, start, end);

      const beforeItemId = yield* resolveBeforeItemId({
        videoId: video,
        before,
        after,
      });

      const clipOps = yield* ClipOperationsService;
      const clip = yield* clipOps.createClip({
        videoId: video,
        videoFilename: source,
        sourceStartTime: start,
        sourceEndTime: end,
        text,
        beforeItemId,
      });
      yield* emitObject(clip);
    })
).pipe(Command.withDescription(detail(ADD_HELP)));

const updateCmd = Command.make(
  "update",
  { id: idArg, zoom: zoomOpt, start: startOpt, end: endOpt },
  ({ id, zoom, start, end }) =>
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
).pipe(Command.withDescription(detail(UPDATE_HELP)));

const moveCmd = Command.make(
  "move",
  { id: idArg, before: beforeOpt, after: afterOpt },
  ({ id, before, after }) =>
    Effect.gen(function* () {
      const existing = yield* requireActiveClip(id);
      if (Option.isNone(before) && Option.isNone(after)) {
        return yield* parseError(
          "move needs one of --before / --after",
          "clip"
        );
      }
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
).pipe(Command.withDescription(detail(MOVE_HELP)));

const deleteCmd = Command.make("delete", { id: idArg }, ({ id }) =>
  Effect.gen(function* () {
    yield* requireActiveClip(id);
    const clipOps = yield* ClipOperationsService;
    yield* clipOps.archiveClip(id);
    const [archived] = yield* clipOps.getClipsByIds([id]);
    yield* emitObject(archived);
  })
).pipe(Command.withDescription(detail(DELETE_HELP)));

export const clipCommand = Command.make("clip").pipe(
  Command.withDescription(detail(CLIP_HELP)),
  Command.withSubcommands([
    listCmd,
    getCmd,
    addCmd,
    updateCmd,
    moveCmd,
    deleteCmd,
  ])
);
