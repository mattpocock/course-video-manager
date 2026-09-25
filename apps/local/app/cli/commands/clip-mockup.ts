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
import { resolveClipMockupSpeech } from "./clip-mockup.speech";
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
 * Turn `--before` / `--after` into the "insert before this id" anchor the
 * service takes. `null` means the end of the Animatic. A verbatim copy of the
 * Beat anchoring, because the ordering key is the same fractional index.
 */
const resolveBeforeClipMockupId = (params: {
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
      entity: "clipMockup",
    });
    if (before === undefined && after === undefined) {
      return null;
    }

    const svc = yield* ClipMockupOperationsService;
    const rows = (yield* svc.listClipMockupsByVideoId(params.videoId)).filter(
      (r) => r.id !== params.excludeId
    );

    if (before !== undefined) {
      if (!rows.some((r) => r.id === before)) {
        return yield* notFound("clipMockup", before);
      }
      return before;
    }

    const idx = rows.findIndex((r) => r.id === after);
    if (idx === -1) {
      return yield* notFound("clipMockup", after!);
    }
    return rows[idx + 1]?.id ?? null;
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
  readonly verb: string;
  readonly image: Option.Option<string>;
}) =>
  Effect.gen(function* () {
    const image = Option.getOrUndefined(params.image);

    if (image === undefined) {
      return yield* parseError(
        `clip-mockup ${params.verb} needs --image <path> (a Clip Mockup must have a picture)`,
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

      const frame = yield* resolveFrameSource({ verb: "add", image });

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

const updateCmd = Command.make(
  "update",
  {
    id: optionalIdArg,
    video: videoAddressOption,
    at: atOption,
    image: imageOption,
    say: sayOption,
  },
  ({ id, video, at, image, say }) =>
    Effect.gen(function* () {
      yield* requireLocalFrameStore;

      const source = Option.getOrUndefined(image);
      const line = Option.getOrUndefined(say);
      if (source === undefined && line === undefined) {
        return yield* parseError(
          'clip-mockup update needs at least one of --image <path> / --say "<line>"',
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
        const frame = yield* resolveFrameSource({ verb: "update", image });
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
      const beforeClipMockupId = yield* resolveBeforeClipMockupId({
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
