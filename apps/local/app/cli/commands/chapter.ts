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
} from "@/cli/helpers";
import { resolveBeforeItemId } from "./timeline-position";
import {
  HELP,
  LIST_HELP,
  GET_HELP,
  ADD_HELP,
  UPDATE_HELP,
  MOVE_HELP,
  DELETE_HELP,
} from "./chapter.help";

// ---------------------------------------------------------------------------
// Options / Args
// ---------------------------------------------------------------------------

const videoOpt = Options.text("video").pipe(
  Options.withDescription("Parent Video id (required).")
);

const titleOpt = Options.text("title").pipe(
  Options.withDescription("The Chapter's title (its 'name'). Required.")
);

const beforeOpt = Options.text("before").pipe(
  Options.withDescription(
    "Place immediately before this clip/chapter id (mutually exclusive with --after)."
  ),
  Options.optional
);

const afterOpt = Options.text("after").pipe(
  Options.withDescription(
    "Place immediately after this clip/chapter id (mutually exclusive with --before)."
  ),
  Options.optional
);

const idArg = Args.text({ name: "id" });
const ids = Args.text({ name: "id" }).pipe(Args.repeated);

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// `resolveBeforeItemId` (the --before/--after anchor resolver) is shared with
// `clip` in ./timeline-position — clips and chapters share one order space, so
// the resolution is identical and an anchor may be a Clip OR a Chapter.

/**
 * Resolve + gate a chapter for a write: a bad id is a clean not-found (exit 2),
 * and archived chapters are deleted as far as this noun is concerned, so they
 * are not-found too (mirrors `requireActiveClip`).
 */
const requireActiveChapter = (id: string) =>
  Effect.gen(function* () {
    const clipOps = yield* ClipOperationsService;
    const [existing] = yield* clipOps.getChaptersByIds([id]);
    if (!existing || existing.archived) {
      return yield* notFound("chapter", id);
    }
    return existing;
  });

/** A video must exist before we read/write its chapters — clean not-found. */
const requireVideo = (videoId: string) =>
  Effect.gen(function* () {
    const videoOps = yield* VideoOperationsService;
    yield* videoOps
      .getVideoWithClipsById(videoId)
      .pipe(Effect.catchTag("NotFoundError", () => notFound("video", videoId)));
  });

// ---------------------------------------------------------------------------
// Verbs
// ---------------------------------------------------------------------------

const listCmd = Command.make("list", { video: videoOpt }, ({ video }) =>
  Effect.gen(function* () {
    yield* requireVideo(video);
    const clipOps = yield* ClipOperationsService;
    const rows = yield* clipOps.listChaptersByVideoId(video);
    yield* emitNdjson(rows);
  })
).pipe(Command.withDescription(detail(LIST_HELP)));

const getCmd = Command.make("get", { ids }, ({ ids }) =>
  Effect.gen(function* () {
    const clipOps = yield* ClipOperationsService;
    // Archived = deleted, ALWAYS hidden (no flag): archived ids fall through to
    // the not-found path, exactly like `clip get`.
    const rows = (yield* clipOps.getChaptersByIds(ids)).filter(
      (r) => !r.archived
    );

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
      return yield* notFound("chapter", ids[0]!);
    }

    yield* emitNdjson(found);
    if (missing.length > 0) {
      return yield* notFoundMany("chapter", missing);
    }
  })
).pipe(Command.withDescription(detail(GET_HELP)));

const addCmd = Command.make(
  "add",
  { video: videoOpt, title: titleOpt, before: beforeOpt, after: afterOpt },
  ({ video, title, before, after }) =>
    Effect.gen(function* () {
      yield* requireVideo(video);
      const beforeItemId = yield* resolveBeforeItemId({
        entity: "chapter",
        videoId: video,
        before,
        after,
      });
      const clipOps = yield* ClipOperationsService;
      const chapter = yield* clipOps.createChapterAtItem(
        video,
        title,
        beforeItemId
      );
      yield* emitObject(chapter);
    })
).pipe(Command.withDescription(detail(ADD_HELP)));

const updateCmd = Command.make(
  "update",
  { id: idArg, title: titleOpt },
  ({ id, title }) =>
    Effect.gen(function* () {
      yield* requireActiveChapter(id);
      const clipOps = yield* ClipOperationsService;
      const row = yield* clipOps.updateChapter(id, { name: title });
      yield* emitObject(row);
    })
).pipe(Command.withDescription(detail(UPDATE_HELP)));

const moveCmd = Command.make(
  "move",
  { id: idArg, before: beforeOpt, after: afterOpt },
  ({ id, before, after }) =>
    Effect.gen(function* () {
      const existing = yield* requireActiveChapter(id);
      if (Option.isNone(before) && Option.isNone(after)) {
        return yield* parseError(
          "move needs one of --before / --after",
          "chapter"
        );
      }
      const beforeItemId = yield* resolveBeforeItemId({
        entity: "chapter",
        videoId: existing.videoId,
        before,
        after,
        excludeId: id,
      });
      const clipOps = yield* ClipOperationsService;
      const moved = yield* clipOps
        .moveChapterToPosition(id, beforeItemId)
        .pipe(
          Effect.catchTag("NotFoundError", (e) =>
            notFound(
              "chapter",
              (e.params as { chapterId?: string }).chapterId ?? id
            )
          )
        );
      yield* emitObject(moved);
    })
).pipe(Command.withDescription(detail(MOVE_HELP)));

const deleteCmd = Command.make("delete", { id: idArg }, ({ id }) =>
  Effect.gen(function* () {
    yield* requireActiveChapter(id);
    const clipOps = yield* ClipOperationsService;
    yield* clipOps.archiveChapter(id);
    const [archived] = yield* clipOps.getChaptersByIds([id]);
    yield* emitObject(archived);
  })
).pipe(Command.withDescription(detail(DELETE_HELP)));

export const chapterCommand = Command.make("chapter").pipe(
  Command.withDescription(detail(HELP)),
  Command.withSubcommands([
    listCmd,
    getCmd,
    addCmd,
    updateCmd,
    moveCmd,
    deleteCmd,
  ])
);
