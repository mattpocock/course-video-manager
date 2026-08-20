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

/**
 * Resolve --before/--after into the single "anchor id" the chapter service
 * positions against, over the MERGED clip+chapter order space (the same one
 * `clip move` uses). The anchor may be a Clip OR a Chapter, since they share one
 * fractional order key. Neither flag returns `null` — "append to the end" for
 * `add`; `move` requires exactly one and rejects the neither case itself.
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
      entity: "chapter",
    });
    if (before === undefined && after === undefined) {
      return null;
    }

    const clipOps = yield* ClipOperationsService;
    const items = (yield* clipOps.listTimelineOrder(params.videoId)).filter(
      (item) => item.id !== params.excludeId
    );

    if (before !== undefined) {
      if (!items.some((item) => item.id === before)) {
        return yield* notFound("chapter", before);
      }
      return before;
    }

    const idx = items.findIndex((item) => item.id === after);
    if (idx === -1) {
      return yield* notFound("chapter", after!);
    }
    return items[idx + 1]?.id ?? null;
  });

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
