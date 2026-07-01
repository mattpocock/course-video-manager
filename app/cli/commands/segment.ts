import { Args, Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";
import { SegmentOperationsService } from "@/services/db-segment-operations.server";
import { PitchOperationsService } from "@/services/db-pitch-operations.server";
import {
  SEGMENT_KINDS,
  DEFAULT_SEGMENT_KIND,
} from "@/features/segments/segment-kinds";
import {
  detail,
  emitNdjson,
  emitObject,
  notFound,
  parseError,
  rejectBothFlags,
} from "@/cli/helpers";
import {
  HELP,
  LIST_HELP,
  ADD_HELP,
  UPDATE_HELP,
  MOVE_HELP,
  DELETE_HELP,
} from "./segment.help";

/**
 * `segment` — the film-time planning units of a single Video.
 *
 * A Segment is one planning unit of a Video's plan: an ordered, pre-recording
 * sketch of "what this video will do for the viewer". A Video's plan is an
 * ordered sequence of Segments authored BEFORE the video is recorded — planning
 * a video means choosing "one of these, then one of these". Segments are a
 * first-class entity that belongs to a Video (not the Lesson or Pitch), so each
 * Video carries its own plan and duplicating a Video copies its Segments. A
 * Segment can be moved between Videos (reassigning its parent Video), which is
 * why `videoId` is mutable.
 *
 * A Segment is DELIBERATELY DISTINCT from a Chapter and a Clip: a Chapter is a
 * recorded-timeline grouping that maps 1:1 to YouTube and groups Clips, whereas
 * a Segment is the INTENDED structure and need not correspond to any Chapter or
 * Clip. Two separate views: "what I planned to shoot" (Segments) vs "what I
 * actually shot" (Clips / Chapters).
 *
 * A Segment's `kind` is the film-time job it does, drawn from the Mise en Place
 * glossary. Five kinds:
 *   - definition   — Explain a concept, term, or idea.
 *   - walkthrough  — Step through existing code or a process.
 *   - playthrough  — Build something live, start to finish.
 *   - quest        — Set the viewer a challenge to attempt.
 *   - reaction     — React to or review code or content.
 *
 * Segments are PURELY an in-app authoring aid — neither the Segment plan nor a
 * Segment's free-text `description` is ever published (Publish skips them).
 *
 * WRITE SURFACE. `segment` is one of cvm's write-capable nouns: it exposes
 * `add` / `update` / `delete` / `move` alongside `list`, because authoring a
 * Video's Segment plan is exactly the kind of low-stakes, never-published
 * planning work an agent should help draft. (`lesson`, `video` and `pitch` also
 * carry write verbs now — see `cvm --help`.) Writes hit the database
 * immediately; there is no confirmation prompt (this is an agent-facing tool)
 * and no dry-run.
 *
 * Addressing: Segments have no stable public address. `list` requires
 * `--video <videoId>`; the write verbs address a single Segment by its `id`
 * (from `list`). There is no get-by-id verb and no `tree`.
 *
 * POSITIONING (shared by `add` and `move`). A Segment's place in its Video's
 * plan is chosen with an anchor, NOT a numeric index — the CLI computes the
 * fractional `order` key for you:
 *   --before <segmentId>   Place immediately BEFORE that segment.
 *   --after  <segmentId>   Place immediately AFTER that segment.
 *   (neither)              Append to the END of the plan.
 * `--before` and `--after` are mutually exclusive. `--after <last>` and
 * omitting both both land at the end. An anchor that is not a segment of the
 * target Video is a not-found (exit 2).
 *
 * Output fields (per segment row):
 *   - id          — the Segment's id.
 *   - videoId     — the parent Video this Segment belongs to (mutable: a Segment
 *                   can be dragged into another Video).
 *   - kind        — one of the five Segment kinds above (the film-time job).
 *   - title       — short label for the Segment (may be empty "").
 *   - description — free-text planning note ("what I'm going to do/say here").
 *                   Never published; may be empty "".
 *   - order       — fractional-index sort key; list output is already sorted by
 *                   it (ascending = plan order).
 *   - archived    — false for active Segments; a deleted Segment is archived
 *                   (archived == deleted for Segments — they are filtered out of
 *                   `list` and can never be addressed again).
 *   - createdAt   — when the Segment was created.
 *
 * Verbs:
 *   list   --video <id>            List a Video's full, ordered plan (active).
 *   add    --video <id> [flags]    Create a Segment in a Video's plan.
 *   update [flags] <id>            Patch a Segment's title/description/kind.
 *   move   --video <id> [flags] <id>  Reorder, or move it to another Video.
 *   delete <id>                    Archive (delete) a Segment.
 *
 * FLAG ORDER: options must come BEFORE the positional <id> (e.g.
 * `cvm segment update --title "Setup" seg_456`); a flag placed AFTER the id
 * is an invalid-input error (exit 3), matching every other cvm verb.
 *
 * Every write echoes the affected Segment row as one pretty-printed JSON object
 * (delete echoes the now-archived row). Reads are variadic; writes are single-id.
 *
 * Examples:
 *   # The full ordered plan for a video, one segment per line (NDJSON):
 *   cvm segment list --video vid_123
 *
 *   # Add a quest at the end of a video's plan, with a title and a note:
 *   cvm segment add --video vid_123 --kind quest --title "Try it" \
 *     --description "Viewer attempts the refactor before I show mine"
 *
 *   # Insert a definition right before an existing segment:
 *   cvm segment add --video vid_123 --kind definition --before seg_456
 *
 *   # Rename a segment and change its kind in one call (flags BEFORE the id):
 *   cvm segment update --title "Setup" --kind walkthrough seg_456
 *
 *   # Reorder within the same video (move seg_456 after seg_789):
 *   cvm segment move --video vid_123 --after seg_789 seg_456
 *
 *   # Drag a segment into a different video, at the end:
 *   cvm segment move --video vid_999 seg_456
 *
 *   # Delete (archive) a segment:
 *   cvm segment delete seg_456
 */

// ---------------------------------------------------------------------------
// Options / Args
// ---------------------------------------------------------------------------

const videoListOption = Options.text("video").pipe(
  Options.withDescription(
    "The parent Video id whose Segment plan to list (required)."
  )
);

const videoTargetOption = Options.text("video").pipe(
  Options.withDescription("The target Video id for the Segment (required).")
);

const videoAddOption = Options.text("video").pipe(
  Options.withDescription(
    "The target Video id (mutually exclusive with --pitch)."
  ),
  Options.optional
);

const pitchAddOption = Options.text("pitch").pipe(
  Options.withDescription(
    "Target a Pitch's video instead of --video: resolves the pitch's single " +
      "video (auto-creating one if the pitch has none; error if it has more " +
      "than one). Mutually exclusive with --video."
  ),
  Options.optional
);

const kindOption = Options.choice("kind", [...SEGMENT_KINDS]).pipe(
  Options.withDescription(
    "Segment kind: definition|walkthrough|playthrough|quest|reaction."
  ),
  Options.optional
);

const titleOption = Options.text("title").pipe(
  Options.withDescription("The Segment's short title label."),
  Options.optional
);

const descriptionOption = Options.text("description").pipe(
  Options.withDescription(
    "The Segment's free-text planning note (never published)."
  ),
  Options.optional
);

const beforeOption = Options.text("before").pipe(
  Options.withDescription(
    "Place immediately before this segment id (mutually exclusive with --after)."
  ),
  Options.optional
);

const afterOption = Options.text("after").pipe(
  Options.withDescription(
    "Place immediately after this segment id (mutually exclusive with --before)."
  ),
  Options.optional
);

const idArg = Args.text({ name: "id" });

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the CLI's --before/--after/none anchor into the service's
 * `beforeSegmentId` (or null == append to end), validating the anchor against
 * the target Video's ACTIVE plan.
 *
 * - both --before and --after  -> invalid input (exit 3).
 * - neither                    -> null (append to end).
 * - --before <id>              -> that id (must be a segment of the video).
 * - --after  <id>              -> the id of the segment following it, or null
 *                                 (== end) if it is last. Must be a segment of
 *                                 the video.
 *
 * `excludeId` drops a segment from the anchor view (used by `move`, whose
 * service recomputes order over the target's segments MINUS the moved one — so
 * anchoring must see the same set).
 */
const resolveBeforeSegmentId = (params: {
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
      entity: "segment",
    });
    if (before === undefined && after === undefined) {
      return null;
    }

    const svc = yield* SegmentOperationsService;
    const rows = (yield* svc.listSegmentsByVideoId(params.videoId)).filter(
      (s) => s.id !== params.excludeId
    );

    if (before !== undefined) {
      if (!rows.some((s) => s.id === before)) {
        return yield* notFound("segment", before);
      }
      return before;
    }

    const idx = rows.findIndex((s) => s.id === after);
    if (idx === -1) {
      return yield* notFound("segment", after!);
    }
    return rows[idx + 1]?.id ?? null;
  });

/**
 * Resolve the target Video for a `segment add`, from EXACTLY ONE of --video /
 * --pitch:
 *   - neither / both  -> invalid input (exit 3).
 *   - --video <id>    -> that id verbatim (existing behavior).
 *   - --pitch <id>    -> the pitch's single active video, following the
 *                        resolve-or-create policy:
 *                          0 videos -> auto-create one (createVideoFromPitch,
 *                                      named after the pitch) and use it.
 *                          1 video  -> use it.
 *                         >1 videos -> invalid input (exit 3): the pitch is
 *                                      ambiguous; target the video with --video.
 *     An unknown or archived (deleted) pitch id is a not-found (exit 2).
 */
const resolveTargetVideoId = (params: {
  readonly video: Option.Option<string>;
  readonly pitch: Option.Option<string>;
}) =>
  Effect.gen(function* () {
    const video = Option.getOrUndefined(params.video);
    const pitch = Option.getOrUndefined(params.pitch);

    yield* rejectBothFlags({
      a: video,
      b: pitch,
      flags: ["--video", "--pitch"],
      entity: "segment",
    });
    if (video === undefined && pitch === undefined) {
      return yield* parseError(
        "segment add needs one of --video / --pitch",
        "segment"
      );
    }
    if (video !== undefined) {
      return video;
    }

    const pitchSvc = yield* PitchOperationsService;
    const row = yield* pitchSvc
      .getPitchWithVideos(pitch!)
      .pipe(Effect.catchTag("NotFoundError", () => notFound("pitch", pitch!)));
    // Archived pitches are deleted-equivalent (never addressable).
    if (row.archived) {
      return yield* notFound("pitch", pitch!);
    }

    const videos = row.videos;
    if (videos.length > 1) {
      return yield* parseError(
        `pitch ${pitch} has ${videos.length} videos — target one directly with --video <id>`,
        "segment"
      );
    }
    if (videos.length === 1) {
      return videos[0]!.id;
    }
    // No video yet: create the pitch's backing video (named after the pitch).
    const created = yield* pitchSvc.createVideoFromPitch(pitch!);
    return created.id;
  });

/**
 * Fetch a Segment by id, treating a missing OR archived row as not-found
 * (archived == deleted == unaddressable). Returns the active row. Fails with
 * the CLI NotFoundError (exit 2) otherwise.
 */
const requireActiveSegment = (id: string) =>
  Effect.gen(function* () {
    const svc = yield* SegmentOperationsService;
    const row = yield* svc
      .getSegmentById(id)
      .pipe(Effect.catchTag("NotFoundError", () => notFound("segment", id)));
    if (row.archived) {
      return yield* notFound("segment", id);
    }
    return row;
  });

// ---------------------------------------------------------------------------
// Verbs
// ---------------------------------------------------------------------------

const listCmd = Command.make("list", { video: videoListOption }, ({ video }) =>
  Effect.gen(function* () {
    const svc = yield* SegmentOperationsService;
    const rows = yield* svc.listSegmentsByVideoId(video);
    yield* emitNdjson(rows);
  })
).pipe(Command.withDescription(detail(LIST_HELP)));

const addCmd = Command.make(
  "add",
  {
    video: videoAddOption,
    pitch: pitchAddOption,
    kind: kindOption,
    title: titleOption,
    description: descriptionOption,
    before: beforeOption,
    after: afterOption,
  },
  ({ video, pitch, kind, title, description, before, after }) =>
    Effect.gen(function* () {
      const videoId = yield* resolveTargetVideoId({ video, pitch });
      const beforeSegmentId = yield* resolveBeforeSegmentId({
        videoId,
        before,
        after,
      });
      const svc = yield* SegmentOperationsService;
      const segment = yield* svc.createSegment(
        videoId,
        Option.getOrUndefined(kind) ?? DEFAULT_SEGMENT_KIND,
        beforeSegmentId,
        Option.getOrUndefined(title) ?? "",
        Option.getOrUndefined(description) ?? ""
      );
      yield* emitObject(segment);
    })
).pipe(Command.withDescription(detail(ADD_HELP)));

const updateCmd = Command.make(
  "update",
  {
    id: idArg,
    title: titleOption,
    description: descriptionOption,
    kind: kindOption,
  },
  ({ id, title, description, kind }) =>
    Effect.gen(function* () {
      const t = Option.getOrUndefined(title);
      const d = Option.getOrUndefined(description);
      const k = Option.getOrUndefined(kind);

      if (t === undefined && d === undefined && k === undefined) {
        return yield* parseError(
          "update needs at least one of --title / --description / --kind",
          "segment"
        );
      }

      const svc = yield* SegmentOperationsService;
      // Existence + active guard (archived == deleted == not addressable).
      let row = yield* requireActiveSegment(id);
      if (t !== undefined) row = yield* svc.renameSegment(id, t);
      if (d !== undefined) row = yield* svc.setSegmentDescription(id, d);
      if (k !== undefined) row = yield* svc.setSegmentKind(id, k);
      yield* emitObject(row);
    })
).pipe(Command.withDescription(detail(UPDATE_HELP)));

const moveCmd = Command.make(
  "move",
  {
    id: idArg,
    video: videoTargetOption,
    before: beforeOption,
    after: afterOption,
  },
  ({ id, video, before, after }) =>
    Effect.gen(function* () {
      const svc = yield* SegmentOperationsService;
      // The segment being moved must still exist (and be active).
      yield* requireActiveSegment(id);
      const beforeSegmentId = yield* resolveBeforeSegmentId({
        videoId: video,
        before,
        after,
        excludeId: id,
      });
      const moved = yield* svc.moveSegment(id, video, beforeSegmentId).pipe(
        // moveSegment re-validates existence internally; surface WHICHEVER id it
        // reports missing (the moved segment, or — defensively — a bad anchor)
        // instead of always blaming the moved id. The anchor is pre-validated by
        // resolveBeforeSegmentId above, so the anchor path is unreachable today.
        Effect.catchTag("NotFoundError", (e) =>
          notFound("segment", (e.params as { id?: string }).id ?? id)
        )
      );
      yield* emitObject(moved);
    })
).pipe(Command.withDescription(detail(MOVE_HELP)));

const deleteCmd = Command.make("delete", { id: idArg }, ({ id }) =>
  Effect.gen(function* () {
    const svc = yield* SegmentOperationsService;
    yield* requireActiveSegment(id); // exists + active guard (exit 2 otherwise)
    yield* svc.deleteSegment(id);
    // Echo the ACTUAL archived row read back — not a synthesized { ...row,
    // archived: true } — so the output stays honest if the archive path ever
    // touches other columns.
    const archived = yield* svc
      .getSegmentById(id)
      .pipe(Effect.catchTag("NotFoundError", () => notFound("segment", id)));
    yield* emitObject(archived);
  })
).pipe(Command.withDescription(detail(DELETE_HELP)));

export const segmentCommand = Command.make("segment").pipe(
  Command.withDescription(detail(HELP)),
  Command.withSubcommands([listCmd, addCmd, updateCmd, moveCmd, deleteCmd])
);
