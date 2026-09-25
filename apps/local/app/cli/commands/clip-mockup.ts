import { Args, Command, Options } from "@effect/cli";
import { FileSystem } from "@effect/platform";
import { Effect, Option } from "effect";
import nodePath from "node:path";
import { ClipMockupOperationsService } from "@/services/db-clip-mockup-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import {
  InvalidClipMockupPathError,
  newFrameFilename,
  writeClipMockupFile,
} from "@/services/clip-mockup-files";
import { resolveClipMockupSpeech } from "@/services/resolve-clip-mockup-speech";
import {
  FrameCaptureError,
  FrameCaptureService,
} from "@/services/frame-capture-service";
import {
  detail,
  emitGet,
  emitNdjson,
  emitObject,
  notFound,
  parseError,
  rejectBothFlags,
  type ParseError,
} from "@/cli/helpers";
import {
  NEEDS_CLIP_MOCKUP_DIRECTORY,
  requireLocalMachine,
} from "@/cli/local-only";
import { resolveBeforeAnimaticItemId } from "./animatic-position";
import { listAnimaticRows } from "./animatic-rows";
import {
  HELP,
  ADD_HELP,
  LIST_HELP,
  GET_HELP,
  UPDATE_HELP,
  MOVE_HELP,
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
 * The two frame sources. Both are optional HERE so that the "exactly one of"
 * rule is checked by `resolveFrameSource` below, in ONE place and with ONE
 * message — @effect/cli's own `Options.orElse` would report it as a generic
 * validation failure instead.
 */
const imageOption = Options.text("image").pipe(
  Options.withDescription(
    "Path to a ready-made PNG on this machine. It is copied into the Clip Mockup directory. Mutually exclusive with --html."
  ),
  Options.optional
);

const htmlOption = Options.text("html").pipe(
  Options.withDescription(
    "Path to an HTML page on this machine. It is rendered in a headless browser at 1920x1080 and the resulting PNG becomes the frame. Mutually exclusive with --image."
  ),
  Options.optional
);

const sayOption = Options.text("say").pipe(
  Options.withDescription("The spoken line for this Clip Mockup (required)."),
  Options.optional
);

/**
 * The addressing half of `--video`. On 'add' and 'list' the Video is what the
 * verb operates on; on 'update' / 'move' / 'delete' it is only the list the
 * `--at` position is counted in, so it is optional there and refused next to a
 * bare <id>.
 */
const videoAddressOption = Options.text("video").pipe(
  Options.withDescription(
    "The parent Video id to count --at positions in (use with --at, instead of a bare <id>)."
  ),
  Options.optional
);

const atOption = Options.integer("at").pipe(
  Options.withDescription(
    "Address the Clip Mockup by its position in the Video's Animatic, counting from 1 (needs --video)."
  ),
  Options.optional
);

const beforeOption = Options.text("before").pipe(
  Options.withDescription(
    "Place immediately before this Clip Mockup id (mutually exclusive with --after)."
  ),
  Options.optional
);

const afterOption = Options.text("after").pipe(
  Options.withDescription(
    "Place immediately after this Clip Mockup id (mutually exclusive with --before)."
  ),
  Options.optional
);

/**
 * Off by default, and that default is a contract: without this flag the stream
 * is byte for byte what it always was. With it, every row gains `type` and
 * `position` and the Chapter rows are interleaved.
 */
const withChaptersOption = Options.boolean("with-chapters").pipe(
  Options.withDescription(
    "Interleave the Video's Clip Mockup Chapters into the stream, and add 'type' and 'position' to every row."
  )
);

const optionalIdArg = Args.text({ name: "id" }).pipe(Args.optional);
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
 * Find the ONE Clip Mockup a write verb is aimed at, from either form of
 * address: the bare `<id>` an agent reads out of `list`, or `--video <id> --at
 * <position>`, the number a human reads off the screen while watching the
 * Animatic ("number 14 is too dense"). Positions count from 1 and are exactly
 * the order `list` and the player show, because both read this same sorted
 * list.
 *
 * Every write verb goes through here so the two forms can never drift apart,
 * and so "both at once" and "off the end of the list" are one message each.
 * An out-of-range position is INVALID INPUT, not a not-found: the position is
 * only meaningful against a list whose length the caller can be told.
 */
const resolveTargetClipMockup = (params: {
  readonly id: Option.Option<string>;
  readonly video: Option.Option<string>;
  readonly at: Option.Option<number>;
}) =>
  Effect.gen(function* () {
    const id = Option.getOrUndefined(params.id);
    const video = Option.getOrUndefined(params.video);
    const at = Option.getOrUndefined(params.at);

    yield* rejectBothFlags({
      a: id,
      b: at,
      flags: ["<id>", "--at"],
      entity: "clipMockup",
    });

    if (id !== undefined) {
      if (video !== undefined) {
        return yield* parseError(
          "--video only names the list --at counts in, so it cannot be combined with a bare <id>",
          "clipMockup"
        );
      }
      return yield* requireActiveClipMockup(id);
    }

    if (at === undefined) {
      return yield* parseError(
        "address the Clip Mockup with a bare <id> or with --video <id> --at <position>",
        "clipMockup"
      );
    }
    if (video === undefined) {
      return yield* parseError(
        "--at <position> needs --video <id> to count the position in",
        "clipMockup"
      );
    }

    const videoRow = yield* requireActiveVideo(video);
    const svc = yield* ClipMockupOperationsService;
    const rows = yield* svc.listClipMockupsByVideoId(videoRow.id);
    const row = at >= 1 ? rows[at - 1] : undefined;

    if (row === undefined) {
      return yield* parseError(
        rows.length === 0
          ? `--at ${at} is out of range: video ${video} has 0 Clip Mockups`
          : `--at ${at} is out of range: video ${video} has ${rows.length} Clip Mockups, so positions run 1-${rows.length}`,
        "clipMockup"
      );
    }
    return row;
  });

/**
 * Capture an HTML page as a 1920x1080 PNG and hand back its bytes.
 *
 * The capture writes into a SCOPED temp directory that is deleted when this
 * effect finishes, however it finishes. That is what makes "a page that cannot
 * be captured leaves no orphan file" true: the only PNG that ever reaches the
 * Clip Mockup directory is one `writeClipMockupFile` put there, and that runs
 * after the capture has already succeeded.
 *
 * The `Effect.serviceOption` branch is the test seam: an ambiently-provided
 * FrameCaptureService (a `Layer.succeed` fake writing canned bytes) is used
 * when there is one, so the whole verb is exercised through the real CLI
 * without Chromium ever launching.
 */
const captureFrameFromHtml = (htmlPath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const scratch = yield* fs
      .makeTempDirectoryScoped({ prefix: "cvm-frame-capture-" })
      .pipe(
        Effect.catchAll(
          (cause) =>
            new FrameCaptureError({
              htmlPath,
              cause,
              message:
                "could not make a temp directory to capture the frame in",
            })
        )
      );
    const outputPath = nodePath.join(scratch, "frame.png");

    const provided = yield* Effect.serviceOption(FrameCaptureService);
    yield* Option.match(provided, {
      onSome: (svc) => svc.captureHtmlToPng({ htmlPath, outputPath }),
      onNone: () =>
        Effect.gen(function* () {
          const svc = yield* FrameCaptureService;
          return yield* svc.captureHtmlToPng({ htmlPath, outputPath });
        }).pipe(Effect.provide(FrameCaptureService.Default)),
    });

    const content = yield* fs.readFile(outputPath).pipe(
      Effect.catchAll(
        (cause) =>
          new FrameCaptureError({
            htmlPath,
            cause,
            message:
              "the capture reported success but wrote no PNG — refusing to create a Clip Mockup with no frame",
          })
      )
    );

    return { content, filename: newFrameFilename(outputPath) };
  }).pipe(Effect.scoped);

/**
 * Produce the PNG bytes for a new Clip Mockup from whichever frame source the
 * caller named, and the name to store them under.
 *
 * THE ONE PLACE THE "EXACTLY ONE FRAME SOURCE" RULE LIVES. Both sources and
 * neither are each one message here, and both branches return the same shape
 * — so the copy into {CLIP_MOCKUP_DIR}/{lineageId}/, the containment guard and
 * the row write on the far side of this function cannot tell a captured frame
 * from a supplied one, and never have to.
 */
const resolveFrameSource = (params: {
  readonly verb: string;
  readonly image: Option.Option<string>;
  readonly html: Option.Option<string>;
}) =>
  Effect.gen(function* () {
    const image = Option.getOrUndefined(params.image);
    const html = Option.getOrUndefined(params.html);

    yield* rejectBothFlags({
      a: image,
      b: html,
      flags: ["--image", "--html"],
      entity: "clipMockup",
    });

    if (image === undefined && html === undefined) {
      return yield* parseError(
        `clip-mockup ${params.verb} needs exactly one of --image <path> / --html <path> (a Clip Mockup must have a picture)`,
        "clipMockup"
      );
    }

    const fs = yield* FileSystem.FileSystem;

    if (html !== undefined) {
      // Checked here rather than inside the capture so that "you typed the
      // wrong path" stays invalid input (exit 3) and only a page that really
      // could not be rendered raises FrameCaptureError.
      if (!(yield* fs.exists(html))) {
        return yield* parseError(
          `cannot read source HTML ${html}`,
          "clipMockup"
        );
      }
      return yield* captureFrameFromHtml(html);
    }

    const content = yield* fs
      .readFile(image!)
      .pipe(
        Effect.catchAll(() =>
          parseError(`cannot read source image ${image}`, "clipMockup")
        )
      );

    return { content, filename: newFrameFilename(image!) };
  });

// ---------------------------------------------------------------------------
// Verbs
// ---------------------------------------------------------------------------

const addCmd = Command.make(
  "add",
  { video: videoOption, image: imageOption, html: htmlOption, say: sayOption },
  ({ video, image, html, say }) =>
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

      const frame = yield* resolveFrameSource({ verb: "add", image, html });

      // Speak the line BEFORE anything is written. It is the one step that
      // depends on something off this machine, so putting it first is what
      // makes a speech failure leave no row AND no orphan frame behind.
      const speech = yield* asParseError(
        resolveClipMockupSpeech({ lineageId: row.lineageId, line })
      );

      // Write the frame BEFORE the row: a row whose imagePath points at
      // nothing is the one state an authoring agent cannot see or fix.
      yield* asParseError(
        writeClipMockupFile(row.lineageId, frame.filename, frame.content)
      );

      const svc = yield* ClipMockupOperationsService;
      const created = yield* svc.createClipMockup(
        row.id,
        line,
        frame.filename,
        speech
      );
      yield* emitObject(created);
    })
).pipe(Command.withDescription(detail(ADD_HELP)));

const listCmd = Command.make(
  "list",
  { video: videoOption, withChapters: withChaptersOption },
  ({ video, withChapters }) =>
    Effect.gen(function* () {
      yield* requireLocalFrameStore;
      const row = yield* requireActiveVideo(video);
      // Two streams, and the bare one stays exactly as it was: no extra field
      // and no extra row. Every `jq` pipeline in the animatic skill reads it,
      // down to `map(.durationSeconds) | add` for a Video's run time.
      if (withChapters) {
        yield* emitNdjson(yield* listAnimaticRows(row.id));
        return;
      }
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

const updateCmd = Command.make(
  "update",
  {
    id: optionalIdArg,
    video: videoAddressOption,
    at: atOption,
    image: imageOption,
    html: htmlOption,
    say: sayOption,
  },
  ({ id, video, at, image, html, say }) =>
    Effect.gen(function* () {
      yield* requireLocalFrameStore;

      const source =
        Option.getOrUndefined(image) ?? Option.getOrUndefined(html);
      const line = Option.getOrUndefined(say);
      if (source === undefined && line === undefined) {
        return yield* parseError(
          'clip-mockup update needs at least one of --image <path> / --html <path> / --say "<line>"',
          "clipMockup"
        );
      }
      if (line !== undefined && line.trim() === "") {
        return yield* parseError(
          "--say must not be empty (a Clip Mockup must have a line)",
          "clipMockup"
        );
      }

      let row = yield* resolveTargetClipMockup({ id, video, at });
      // Both halves land under the parent Video's lineageId, so resolve it
      // once up front rather than per branch.
      const parent = yield* requireActiveVideo(row.videoId);
      const svc = yield* ClipMockupOperationsService;

      if (source !== undefined) {
        const frame = yield* resolveFrameSource({
          verb: "update",
          image,
          html,
        });
        // Same order as 'add': the frame lands before the row points at it, so
        // a failure halfway leaves an orphan PNG rather than a row whose
        // picture does not exist.
        yield* asParseError(
          writeClipMockupFile(parent.lineageId, frame.filename, frame.content)
        );
        row = yield* svc.setClipMockupImagePath(row.id, frame.filename);
      }

      // The line and the picture are independent: swapping one leaves the
      // other exactly as it was. New WORDS are new SPEECH, though — the line
      // is re-synthesised and its measured duration replaced in the same
      // write, so the row can never claim a run time for words it no longer
      // says.
      if (line !== undefined) {
        const speech = yield* asParseError(
          resolveClipMockupSpeech({ lineageId: parent.lineageId, line })
        );
        row = yield* svc.setClipMockupLine(row.id, line, speech);
      }

      yield* emitObject(row);
    })
).pipe(Command.withDescription(detail(UPDATE_HELP)));

const moveCmd = Command.make(
  "move",
  {
    id: optionalIdArg,
    video: videoAddressOption,
    at: atOption,
    before: beforeOption,
    after: afterOption,
  },
  ({ id, video, at, before, after }) =>
    Effect.gen(function* () {
      yield* requireLocalFrameStore;
      const row = yield* resolveTargetClipMockup({ id, video, at });
      // Resolved over the MERGED Animatic — Clip Mockups AND the Chapters
      // that divide them — because the two share one order key space.
      const beforeClipMockupId = yield* resolveBeforeAnimaticItemId({
        entity: "clipMockup",
        videoId: row.videoId,
        before,
        after,
        excludeId: row.id,
      });
      const svc = yield* ClipMockupOperationsService;
      // Ordering only: no frame is read, written or moved.
      const moved = yield* svc
        .moveClipMockup(row.id, beforeClipMockupId)
        .pipe(
          Effect.catchTag("NotFoundError", (e) =>
            notFound("clipMockup", (e.params as { id?: string }).id ?? row.id)
          )
        );
      yield* emitObject(moved);
    })
).pipe(Command.withDescription(detail(MOVE_HELP)));

const deleteCmd = Command.make(
  "delete",
  { id: optionalIdArg, video: videoAddressOption, at: atOption },
  ({ id, video, at }) =>
    Effect.gen(function* () {
      yield* requireLocalFrameStore;
      const row = yield* resolveTargetClipMockup({ id, video, at });
      const svc = yield* ClipMockupOperationsService;
      yield* svc.deleteClipMockup(row.id);
      const archived = yield* svc
        .getClipMockupById(row.id)
        .pipe(
          Effect.catchTag("NotFoundError", () => notFound("clipMockup", row.id))
        );
      yield* emitObject(archived);
    })
).pipe(Command.withDescription(detail(DELETE_HELP)));

export const clipMockupCommand = Command.make("clip-mockup").pipe(
  Command.withDescription(detail(HELP)),
  Command.withSubcommands([
    addCmd,
    listCmd,
    getCmd,
    updateCmd,
    moveCmd,
    deleteCmd,
  ])
);
