import { Args, Command, Options } from "@effect/cli";
import { FileSystem } from "@effect/platform";
import { Effect, Option } from "effect";
import { ClipMockupOperationsService } from "@/services/db-clip-mockup-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import {
  InvalidClipMockupPathError,
  newFrameFilename,
  writeClipMockupFile,
} from "@/services/clip-mockup-files";
import {
  detail,
  emitGet,
  emitNdjson,
  emitObject,
  notFound,
  parseError,
  type ParseError,
} from "@/cli/helpers";
import {
  NEEDS_CLIP_MOCKUP_DIRECTORY,
  requireLocalMachine,
} from "@/cli/local-only";
import {
  HELP,
  ADD_HELP,
  LIST_HELP,
  GET_HELP,
  DELETE_HELP,
} from "./clip-mockup.help";

// ---------------------------------------------------------------------------
// Options / Args
// ---------------------------------------------------------------------------

const videoOption = Options.text("video").pipe(
  Options.withDescription(
    "The parent Video id whose Animatic to operate on (required)."
  )
);

/**
 * Optional rather than required so that the "exactly one frame source" rule is
 * checked by `resolveFrameSource` below, in ONE place and with ONE message.
 * `--html` (capture a frame from an HTML page) slots in beside it there
 * without reshaping this verb.
 */
const imageOption = Options.text("image").pipe(
  Options.withDescription(
    "Path to a ready-made PNG on this machine. It is copied into the Clip Mockup directory."
  ),
  Options.optional
);

const sayOption = Options.text("say").pipe(
  Options.withDescription("The spoken line for this Clip Mockup (required)."),
  Options.optional
);

const idArg = Args.text({ name: "id" });
const idsArg = Args.text({ name: "id" }).pipe(Args.repeated);

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Clip Mockup frames are on DISK, so every verb here is local-only — including
 * the reads, because `imagePath` is meaningless without the directory it is
 * relative to. Each subcommand yields this FIRST, before its arguments are
 * looked at and before a row is read: on a Remote Box `add` would otherwise
 * scatter frames into whatever checkout happened to be there, invisibly to
 * everything else.
 */
const requireLocalFrameStore = requireLocalMachine(
  "cvm clip-mockup",
  NEEDS_CLIP_MOCKUP_DIRECTORY
);

/**
 * Frames hang off a Video's `lineageId`, not its id — resolve one to the
 * other, refusing archived videos the way every other noun refuses archived
 * rows.
 */
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

/** A path escaping the Video's frame directory is bad input, not a missing file. */
const asParseError = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.mapError(
    effect,
    (e): Exclude<E, InvalidClipMockupPathError> | ParseError =>
      e instanceof InvalidClipMockupPathError
        ? parseError(`${e.path}: ${e.message}`, "clipMockup")
        : (e as Exclude<E, InvalidClipMockupPathError>)
  );

/** The row must exist and be active. */
const requireActiveClipMockup = (id: string) =>
  Effect.gen(function* () {
    const svc = yield* ClipMockupOperationsService;
    const row = yield* svc
      .getClipMockupById(id)
      .pipe(Effect.catchTag("NotFoundError", () => notFound("clipMockup", id)));
    if (row.archived) {
      return yield* notFound("clipMockup", id);
    }
    return row;
  });

/**
 * Produce the PNG bytes for a new Clip Mockup from whichever frame source the
 * caller named, and the name to store them under.
 *
 * THE SEAM FOR A SECOND SOURCE. Today there is exactly one (`--image`, a ready
 * PNG read off disk). `--html` — capture the page with a browser, then store
 * the bytes it produced — is another branch of this function and nothing else:
 * the "exactly one of" rule, the copy, the containment guard and the row write
 * are all already on this side of it.
 */
const resolveFrameSource = (params: {
  readonly image: Option.Option<string>;
}) =>
  Effect.gen(function* () {
    const image = Option.getOrUndefined(params.image);

    if (image === undefined) {
      return yield* parseError(
        "clip-mockup add needs --image <path> (a Clip Mockup must have a picture)",
        "clipMockup"
      );
    }

    const fs = yield* FileSystem.FileSystem;
    const content = yield* fs
      .readFile(image)
      .pipe(
        Effect.catchAll(() =>
          parseError(`cannot read source image ${image}`, "clipMockup")
        )
      );

    return { content, filename: newFrameFilename(image) };
  });

// ---------------------------------------------------------------------------
// Verbs
// ---------------------------------------------------------------------------

const addCmd = Command.make(
  "add",
  { video: videoOption, image: imageOption, say: sayOption },
  ({ video, image, say }) =>
    Effect.gen(function* () {
      yield* requireLocalFrameStore;

      const line = Option.getOrUndefined(say);
      if (line === undefined || line.trim() === "") {
        return yield* parseError(
          'clip-mockup add needs --say "<line>" (a Clip Mockup must have a line)',
          "clipMockup"
        );
      }

      const row = yield* requireActiveVideo(video);
      if (row.format === "short") {
        return yield* parseError(
          `video ${video} is a Short — Clip Mockups are Landscape only`,
          "clipMockup"
        );
      }

      const frame = yield* resolveFrameSource({ image });

      // Write the frame BEFORE the row: a row whose imagePath points at
      // nothing is the one state an authoring agent cannot see or fix.
      yield* asParseError(
        writeClipMockupFile(row.lineageId, frame.filename, frame.content)
      );

      const svc = yield* ClipMockupOperationsService;
      const created = yield* svc.createClipMockup(row.id, line, frame.filename);
      yield* emitObject(created);
    })
).pipe(Command.withDescription(detail(ADD_HELP)));

const listCmd = Command.make("list", { video: videoOption }, ({ video }) =>
  Effect.gen(function* () {
    yield* requireLocalFrameStore;
    const row = yield* requireActiveVideo(video);
    const svc = yield* ClipMockupOperationsService;
    yield* emitNdjson(yield* svc.listClipMockupsByVideoId(row.id));
  })
).pipe(Command.withDescription(detail(LIST_HELP)));

const getCmd = Command.make("get", { ids: idsArg }, ({ ids }) =>
  Effect.gen(function* () {
    yield* requireLocalFrameStore;
    yield* emitGet({
      entity: "clipMockup",
      ids,
      fetch: (id) =>
        Effect.flatMap(ClipMockupOperationsService, (svc) =>
          svc.getClipMockupById(id).pipe(
            Effect.catchTag("NotFoundError", () => Effect.succeed(undefined)),
            Effect.map((row) => (row?.archived ? undefined : row))
          )
        ),
    });
  })
).pipe(Command.withDescription(detail(GET_HELP)));

const deleteCmd = Command.make("delete", { id: idArg }, ({ id }) =>
  Effect.gen(function* () {
    yield* requireLocalFrameStore;
    const svc = yield* ClipMockupOperationsService;
    yield* requireActiveClipMockup(id);
    yield* svc.deleteClipMockup(id);
    const archived = yield* svc
      .getClipMockupById(id)
      .pipe(Effect.catchTag("NotFoundError", () => notFound("clipMockup", id)));
    yield* emitObject(archived);
  })
).pipe(Command.withDescription(detail(DELETE_HELP)));

export const clipMockupCommand = Command.make("clip-mockup").pipe(
  Command.withDescription(detail(HELP)),
  Command.withSubcommands([addCmd, listCmd, getCmd, deleteCmd])
);
