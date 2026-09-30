import { Args, Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";
import {
  ClipMockupCommentOperationsService,
  type ClipMockupCommentTarget,
} from "@/services/db-clip-mockup-comment-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import {
  detail,
  emitGet,
  emitNdjson,
  emitObject,
  notFound,
  parseError,
} from "@/cli/helpers";
import {
  ADD_HELP,
  DELETE_HELP,
  GET_HELP,
  HELP,
  LIST_HELP,
  UPDATE_HELP,
} from "./clip-mockup-comment.help";

/**
 * `cvm clip-mockup-comment` — the author's notes pinned to one Clip Mockup or
 * one Clip Mockup Chapter, shown in the teleprompter on the filming day.
 *
 * NOT LOCAL-ONLY, like `clip-mockup-chapter`: a comment is a row and touches no
 * disk. Every write goes through the Draft guard in the service.
 */

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

const videoOpt = Options.text("video").pipe(
  Options.withDescription("Parent Video id (required).")
);

const bodyOpt = Options.text("body").pipe(
  Options.withDescription("The comment's text. Required.")
);

const clipMockupOpt = Options.text("clip-mockup").pipe(
  Options.withDescription(
    "Pin the comment to this Clip Mockup id (mutually exclusive with --clip-mockup-chapter)."
  ),
  Options.optional
);

const clipMockupChapterOpt = Options.text("clip-mockup-chapter").pipe(
  Options.withDescription(
    "Pin the comment to this Clip Mockup Chapter id (mutually exclusive with --clip-mockup)."
  ),
  Options.optional
);

const idArg = Args.text({ name: "id" });
const idArgs = Args.text({ name: "id" }).pipe(Args.repeated);

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** The Video must exist and be active before its comments are read. */
const requireActiveVideo = (id: string) =>
  Effect.gen(function* () {
    const svc = yield* VideoOperationsService;
    const row = yield* svc
      .getVideoDeepById(id)
      .pipe(Effect.catchTag("NotFoundError", () => notFound("video", id)));
    if (row.archived) {
      return yield* notFound("video", id);
    }
    return row;
  });

/** Exactly one of the two parent flags, as the service's target. */
const resolveTarget = (
  clipMockup: Option.Option<string>,
  clipMockupChapter: Option.Option<string>
) => {
  if (Option.isSome(clipMockup) && Option.isNone(clipMockupChapter)) {
    return Effect.succeed<ClipMockupCommentTarget>({
      type: "clip-mockup",
      id: clipMockup.value,
    });
  }
  if (Option.isSome(clipMockupChapter) && Option.isNone(clipMockup)) {
    return Effect.succeed<ClipMockupCommentTarget>({
      type: "clip-mockup-chapter",
      id: clipMockupChapter.value,
    });
  }
  return parseError(
    "add needs exactly one of --clip-mockup / --clip-mockup-chapter",
    "clipMockupComment"
  );
};

// ---------------------------------------------------------------------------
// Verbs
// ---------------------------------------------------------------------------

const listCmd = Command.make("list", { video: videoOpt }, ({ video }) =>
  Effect.gen(function* () {
    const row = yield* requireActiveVideo(video);
    const svc = yield* ClipMockupCommentOperationsService;
    yield* emitNdjson(yield* svc.listClipMockupCommentsByVideoId(row.id));
  })
).pipe(Command.withDescription(detail(LIST_HELP)));

const getCmd = Command.make("get", { ids: idArgs }, ({ ids }) =>
  Effect.gen(function* () {
    const svc = yield* ClipMockupCommentOperationsService;
    yield* emitGet({
      entity: "clipMockupComment",
      ids,
      fetch: (id) =>
        svc
          .getClipMockupCommentById(id)
          .pipe(Effect.catchTag("NotFoundError", () => Effect.succeed(null))),
    });
  })
).pipe(Command.withDescription(detail(GET_HELP)));

const addCmd = Command.make(
  "add",
  {
    clipMockup: clipMockupOpt,
    clipMockupChapter: clipMockupChapterOpt,
    body: bodyOpt,
  },
  ({ clipMockup, clipMockupChapter, body }) =>
    Effect.gen(function* () {
      const target = yield* resolveTarget(clipMockup, clipMockupChapter);
      const svc = yield* ClipMockupCommentOperationsService;
      yield* emitObject(yield* svc.createClipMockupComment(target, body));
    })
).pipe(Command.withDescription(detail(ADD_HELP)));

const updateCmd = Command.make(
  "update",
  { id: idArg, body: bodyOpt },
  ({ id, body }) =>
    Effect.gen(function* () {
      const svc = yield* ClipMockupCommentOperationsService;
      yield* emitObject(yield* svc.updateClipMockupComment(id, { body }));
    })
).pipe(Command.withDescription(detail(UPDATE_HELP)));

const deleteCmd = Command.make("delete", { id: idArg }, ({ id }) =>
  Effect.gen(function* () {
    const svc = yield* ClipMockupCommentOperationsService;
    yield* emitObject(yield* svc.deleteClipMockupComment(id));
  })
).pipe(Command.withDescription(detail(DELETE_HELP)));

export const clipMockupCommentCommand = Command.make(
  "clip-mockup-comment"
).pipe(
  Command.withDescription(detail(HELP)),
  Command.withSubcommands([listCmd, getCmd, addCmd, updateCmd, deleteCmd])
);
