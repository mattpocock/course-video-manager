import { Args, Command, Options } from "@effect/cli";
import { FileSystem } from "@effect/platform";
import { Effect, Option } from "effect";
import path from "node:path";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import {
  deleteVideoFile,
  InvalidVideoFilePathError,
  isDefaultEnabled,
  listVideoFiles,
  readVideoFileString,
  resolveVideoFilePath,
  videoFileExists,
  writeVideoFile,
} from "@/services/video-files";
import {
  detail,
  emitNdjson,
  emitObject,
  notFound,
  parseError,
  type ParseError,
} from "@/cli/helpers";
import {
  NEEDS_VIDEO_FILES_DIRECTORY,
  requireLocalMachine,
} from "@/cli/local-only";
import { HELP, LIST_HELP, ADD_HELP, GET_HELP, DELETE_HELP } from "./file.help";

// ---------------------------------------------------------------------------
// Options / Args
// ---------------------------------------------------------------------------

const videoOption = Options.text("video").pipe(
  Options.withDescription("The Video id whose files to operate on (required).")
);

const asOption = Options.text("as").pipe(
  Options.withDescription(
    "Store under this name instead of the source basename (single source only)."
  ),
  Options.optional
);

const forceOption = Options.boolean("force").pipe(
  Options.withDescription("Overwrite an existing file at the target name.")
);

const sourcePathsArg = Args.text({ name: "path" }).pipe(Args.atLeast(1));
const filePathArg = Args.text({ name: "path" });

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Video Files are on DISK, so every verb here is local-only. Each subcommand
 * yields this first, before its arguments are looked at and before a row is
 * read: on a Remote Box `add` and `delete` could otherwise scatter files into
 * whatever checkout happened to be there, invisibly to everything else.
 */
const requireLocalFileStore = requireLocalMachine(
  "cvm file",
  NEEDS_VIDEO_FILES_DIRECTORY
);

/**
 * Files hang off a Video's `lineageId`, not its id — resolve one to the other,
 * refusing archived videos the way every other noun refuses archived rows.
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

/** A path escaping the video's directory is bad input, not a missing file. */
const asParseError = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.mapError(
    effect,
    (e): Exclude<E, InvalidVideoFilePathError> | ParseError =>
      e instanceof InvalidVideoFilePathError
        ? parseError(`${e.path}: ${e.message}`, "file")
        : (e as Exclude<E, InvalidVideoFilePathError>)
  );

const entryFor = (relativePath: string, size: number) => ({
  path: relativePath,
  size,
  defaultEnabled: isDefaultEnabled(relativePath),
});

// ---------------------------------------------------------------------------
// Verbs
// ---------------------------------------------------------------------------

const listCmd = Command.make("list", { video: videoOption }, ({ video }) =>
  Effect.gen(function* () {
    yield* requireLocalFileStore;
    const row = yield* requireActiveVideo(video);
    const entries = yield* listVideoFiles(row.lineageId);
    yield* emitNdjson(entries);
  })
).pipe(Command.withDescription(detail(LIST_HELP)));

const addCmd = Command.make(
  "add",
  {
    video: videoOption,
    as: asOption,
    force: forceOption,
    paths: sourcePathsArg,
  },
  ({ video, as, force, paths }) =>
    Effect.gen(function* () {
      yield* requireLocalFileStore;
      const fs = yield* FileSystem.FileSystem;
      const rename = Option.getOrUndefined(as);

      if (rename !== undefined && paths.length > 1) {
        return yield* parseError(
          `--as takes a single source path (got ${paths.length})`,
          "file"
        );
      }

      const row = yield* requireActiveVideo(video);

      const entries = yield* Effect.forEach(paths, (sourcePath) =>
        Effect.gen(function* () {
          const target = rename ?? path.basename(sourcePath);

          // Resolve first: a bad target should fail before we read anything.
          yield* asParseError(resolveVideoFilePath(row.lineageId, target));

          const exists = yield* asParseError(
            videoFileExists(row.lineageId, target)
          );
          if (exists && !force) {
            return yield* parseError(
              `${target} already exists — pass --force to overwrite`,
              "file"
            );
          }

          const content = yield* fs
            .readFile(sourcePath)
            .pipe(
              Effect.catchAll(() =>
                parseError(`cannot read source file ${sourcePath}`, "file")
              )
            );

          yield* asParseError(writeVideoFile(row.lineageId, target, content));

          return entryFor(target, content.length);
        })
      );

      if (entries.length === 1) {
        yield* emitObject(entries[0]);
        return;
      }
      yield* emitNdjson(entries);
    })
).pipe(Command.withDescription(detail(ADD_HELP)));

const getCmd = Command.make(
  "get",
  { video: videoOption, path: filePathArg },
  ({ video, path: filePath }) =>
    Effect.gen(function* () {
      yield* requireLocalFileStore;
      const row = yield* requireActiveVideo(video);

      const exists = yield* asParseError(
        videoFileExists(row.lineageId, filePath)
      );
      if (!exists) {
        return yield* notFound("file", filePath);
      }

      const content = yield* asParseError(
        readVideoFileString(row.lineageId, filePath)
      );

      yield* emitObject({
        videoId: row.id,
        ...entryFor(filePath, Buffer.byteLength(content)),
        content,
      });
    })
).pipe(Command.withDescription(detail(GET_HELP)));

const deleteCmd = Command.make(
  "delete",
  { video: videoOption, path: filePathArg },
  ({ video, path: filePath }) =>
    Effect.gen(function* () {
      yield* requireLocalFileStore;
      const row = yield* requireActiveVideo(video);

      const exists = yield* asParseError(
        videoFileExists(row.lineageId, filePath)
      );
      if (!exists) {
        return yield* notFound("file", filePath);
      }

      yield* asParseError(deleteVideoFile(row.lineageId, filePath));

      yield* emitObject({
        videoId: row.id,
        path: filePath,
        deleted: true,
      });
    })
).pipe(Command.withDescription(detail(DELETE_HELP)));

export const fileCommand = Command.make("file").pipe(
  Command.withDescription(detail(HELP)),
  Command.withSubcommands([listCmd, addCmd, getCmd, deleteCmd])
);
