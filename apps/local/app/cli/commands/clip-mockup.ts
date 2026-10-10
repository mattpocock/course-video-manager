import { Args, Command, Options } from "@effect/cli";
import {
  entityIdArg,
  entityIdOption,
  draftIdOption,
  optionalDraftId,
} from "../entity-id";
import { Effect, Option } from "effect";
import {
  ClipMockupOperationsService,
  type ClipMockupBatchEntry,
  type ClipMockupEdit,
} from "@/services/db-clip-mockup-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import {
  InvalidClipMockupPathError,
  withClipMockupFiles,
  writeClipMockupFile,
} from "@/services/clip-mockup-files";
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
  produceFrames,
  readAddEntries,
  readUpdateEntries,
  type UpdateEntry,
} from "./clip-mockup.batch";
import { captureCmd } from "./clip-mockup.capture";
import { queueClipMockupVoices, withVoiceDuration } from "./clip-mockup.voice";
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

const videoOption = draftIdOption("video", "video").pipe(
  Options.withDescription(
    "The parent Video id whose Animatic to operate on (required)."
  )
);

/**
 * THE ONE INPUT of `add` and `update`: a JSON file of entries, or "-" for
 * STDIN. What an entry holds is in `clip-mockup.batch.ts` and the verbs' help.
 */
const clipMockupsJsonOption = Options.text("clip-mockups-json").pipe(
  Options.withDescription(
    'Path to a JSON array of entries, one per Clip Mockup (see this verb\'s help for their keys); "-" reads STDIN. Paths inside it are relative to the file.'
  )
);

/**
 * The addressing half of `--video`. On 'add' and 'list' the Video is what the
 * verb operates on; on 'update' / 'move' / 'delete' it is only the list the
 * `--at` position is counted in, so it is optional there and refused next to a
 * bare <id>.
 */
const videoAddressOption = draftIdOption("video", "video").pipe(
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

const beforeOption = entityIdOption("before", [
  "clip-mockup",
  "clip-mockup-chapter",
]).pipe(
  Options.withDescription(
    "Place immediately before this Clip Mockup id (mutually exclusive with --after)."
  ),
  Options.optional
);

const afterOption = entityIdOption("after", [
  "clip-mockup",
  "clip-mockup-chapter",
]).pipe(
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

const optionalIdArg = entityIdArg("clip-mockup").pipe(Args.optional);
const idsArg = entityIdArg("clip-mockup").pipe(Args.repeated);

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
 * A Clip Mockup row as every verb here prints it: its files as absolute paths
 * beside the relative ones, and a run time even while its voice is pending.
 */
const present = <
  Row extends {
    readonly imagePath: string;
    readonly audioPath: string | null;
    readonly line: string;
    readonly durationSeconds: number | null;
    readonly voiceStatus: string;
  },
>(
  lineageId: string,
  row: Row
) => withVoiceDuration(withClipMockupFiles(lineageId, row));

/**
 * Find the Clip Mockup each `update` entry is aimed at, from either form of
 * address — the same two `move` and `delete` take, with the same messages.
 *
 * Each Video's list is read ONCE, however many entries count positions in it,
 * and every position is counted in the list as it is BEFORE the batch: the
 * edits change no order, so entry 3 can never shift what entry 4 points at.
 * Two entries that name the same Clip Mockup are refused, because which of
 * them should win is a decision the file has to make, not this command.
 */
const resolveUpdateTargets = (entries: ReadonlyArray<UpdateEntry>) =>
  Effect.gen(function* () {
    const svc = yield* ClipMockupOperationsService;
    const lists = new Map<
      string,
      ReadonlyArray<
        Effect.Effect.Success<ReturnType<typeof requireActiveClipMockup>>
      >
    >();

    const rows = [];
    for (const [i, entry] of entries.entries()) {
      const n = i + 1;
      if (entry.target.kind === "id") {
        rows.push(yield* requireActiveClipMockup(entry.target.id));
        continue;
      }
      const { video, at } = entry.target;
      let list = lists.get(video);
      if (list === undefined) {
        const videoRow = yield* requireActiveVideo(video);
        list = yield* svc.listClipMockupsByVideoId(videoRow.id);
        lists.set(video, list);
      }
      const row = at >= 1 ? list[at - 1] : undefined;
      if (row === undefined) {
        return yield* parseError(
          list.length === 0
            ? `entry ${n}: "at" ${at} is out of range: video ${video} has 0 Clip Mockups`
            : `entry ${n}: "at" ${at} is out of range: video ${video} has ${list.length} Clip Mockups, so positions run 1-${list.length}`,
          "clipMockup"
        );
      }
      rows.push(row);
    }

    const firstEntryFor = new Map<string, number>();
    for (const [i, row] of rows.entries()) {
      const earlier = firstEntryFor.get(row.id);
      if (earlier !== undefined) {
        return yield* parseError(
          `entries ${earlier} and ${i + 1} both change Clip Mockup ${row.id}; give each Clip Mockup one entry`,
          "clipMockup"
        );
      }
      firstEntryFor.set(row.id, i + 1);
    }
    return rows;
  });

// ---------------------------------------------------------------------------
// Verbs
// ---------------------------------------------------------------------------

const addCmd = Command.make(
  "add",
  { video: videoOption, file: clipMockupsJsonOption },
  ({ video: videoRef, file }) =>
    Effect.gen(function* () {
      yield* requireLocalFrameStore;
      const video = yield* videoRef;

      // The whole file is checked before anything slow or anything written.
      const entries = yield* readAddEntries(file);

      const row = yield* requireActiveVideo(video);
      if (row.format === "short") {
        return yield* parseError(
          `video ${video} is a Short — Clip Mockups are Landscape only`,
          "clipMockup"
        );
      }

      const moments = entries.filter((e) => e.type === "clipMockup");

      // Only the frames are made here. The VOICE is not waited for: the rows
      // are written `pending` and one `clip-mockup-voice` Job, run by this
      // machine's Sidecar, voices every line after this command returns.
      const frames = yield* produceFrames(moments.map((m) => m.frame));

      // Every frame BEFORE any row: a row whose imagePath points at nothing
      // is the one state an authoring agent cannot see or fix.
      for (const frame of new Set(frames)) {
        yield* asParseError(
          writeClipMockupFile(row.lineageId, frame.filename, frame.content)
        );
      }

      let m = 0;
      const batch = entries.map((entry): ClipMockupBatchEntry => {
        if (entry.type === "clipMockupChapter") return entry;
        const i = m++;
        return {
          type: "clipMockup",
          line: entry.line,
          imagePath: frames[i]!.filename,
        };
      });

      const svc = yield* ClipMockupOperationsService;
      const created = yield* svc.createClipMockups(row.id, batch);
      yield* queueClipMockupVoices(
        created.flatMap((r) => (r.type === "clipMockup" ? [r] : []))
      );
      yield* emitNdjson(
        created.map((r) =>
          r.type === "clipMockup" ? present(row.lineageId, r) : r
        )
      );
    })
).pipe(Command.withDescription(detail(ADD_HELP)));

const listCmd = Command.make(
  "list",
  { video: videoOption, withChapters: withChaptersOption },
  ({ video: videoRef, withChapters }) =>
    Effect.gen(function* () {
      yield* requireLocalFrameStore;
      const video = yield* videoRef;
      const row = yield* requireActiveVideo(video);
      // Two streams, and the bare one gains no extra ROW and no field but the
      // additive `imageFile` / `audioFile`. Every `jq` pipeline in the
      // animatic skill reads it, down to `map(.durationSeconds) | add`.
      if (withChapters) {
        const rows = yield* listAnimaticRows(row.id);
        yield* emitNdjson(
          rows.map((r) =>
            r.type === "clipMockup" ? present(row.lineageId, r) : r
          )
        );
        return;
      }
      const svc = yield* ClipMockupOperationsService;
      const rows = yield* svc.listClipMockupsByVideoId(row.id);
      yield* emitNdjson(rows.map((r) => present(row.lineageId, r)));
    })
).pipe(Command.withDescription(detail(LIST_HELP)));

const getCmd = Command.make("get", { ids: idsArg }, ({ ids }) =>
  Effect.gen(function* () {
    yield* requireLocalFrameStore;
    const videos = yield* VideoOperationsService;
    // A row's files sit under its Video's lineageId. The Video is read, not
    // required active: an archived Video's frames are still on disk.
    const lineageOf = new Map<string, string>();
    const lineage = (videoId: string) =>
      Effect.gen(function* () {
        const known = lineageOf.get(videoId);
        if (known !== undefined) return known;
        const video = yield* videos.getVideoDeepById(videoId);
        lineageOf.set(videoId, video.lineageId);
        return video.lineageId;
      });
    yield* emitGet({
      entity: "clipMockup",
      ids,
      fetch: (id) =>
        Effect.gen(function* () {
          const svc = yield* ClipMockupOperationsService;
          const row = yield* svc
            .getClipMockupById(id)
            .pipe(
              Effect.catchTag("NotFoundError", () => Effect.succeed(undefined))
            );
          if (row === undefined || row.archived) return undefined;
          return present(yield* lineage(row.videoId), row);
        }),
    });
  })
).pipe(Command.withDescription(detail(GET_HELP)));

const updateCmd = Command.make(
  "update",
  { file: clipMockupsJsonOption },
  ({ file }) =>
    Effect.gen(function* () {
      yield* requireLocalFrameStore;

      const entries = yield* readUpdateEntries(file);
      const rows = yield* resolveUpdateTargets(entries);

      // Both halves land under each row's parent Video's lineageId. The rows
      // may come from several Videos: a round of notes is one file.
      const lineageOf = new Map<string, string>();
      for (const row of rows) {
        if (!lineageOf.has(row.videoId)) {
          const parent = yield* requireActiveVideo(row.videoId);
          lineageOf.set(row.videoId, parent.lineageId);
        }
      }
      const lineage = (i: number) => lineageOf.get(rows[i]!.videoId)!;

      const framed = entries.flatMap((e, i) =>
        e.frame === undefined ? [] : [{ i, frame: e.frame }]
      );

      // The line and the picture are independent: an entry that changes one
      // leaves the other exactly as it was. New WORDS are new SPEECH, though:
      // the old voice is dropped in the same write and the row goes back to
      // `pending`, so no row claims a run time for words it no longer says.
      // The new voice is made by the Sidecar, after this command returns.
      const frames = yield* produceFrames(framed.map((f) => f.frame));

      // Frames first, as in 'add': a failure after this leaves an orphan file
      // rather than a row whose picture does not exist.
      for (const [k, { i }] of framed.entries()) {
        yield* asParseError(
          writeClipMockupFile(
            lineage(i),
            frames[k]!.filename,
            frames[k]!.content
          )
        );
      }

      const frameOf = new Map(framed.map((f, k) => [f.i, frames[k]!.filename]));
      // Every entry also re-queues a voice that is not `ready` — one that
      // FAILED, or one still pending whose Job is gone — whatever it changes.
      const edits = rows.map((row, i): ClipMockupEdit => ({
        id: row.id,
        ...(frameOf.has(i) ? { imagePath: frameOf.get(i)! } : {}),
        ...(entries[i]!.line === undefined
          ? {}
          : { say: { line: entries[i]!.line } }),
        requeueVoice: true,
      }));

      const svc = yield* ClipMockupOperationsService;
      const updated = yield* svc.updateClipMockups(edits);
      yield* queueClipMockupVoices(
        updated.filter((r) => r.voiceStatus === "pending")
      );
      yield* emitNdjson(
        updated.map((r) => present(lineageOf.get(r.videoId)!, r))
      );
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
  ({ id, video: videoRef, at, before, after }) =>
    Effect.gen(function* () {
      yield* requireLocalFrameStore;
      const video = Option.fromNullable(yield* optionalDraftId(videoRef));
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
      yield* emitObject(withVoiceDuration(moved));
    })
).pipe(Command.withDescription(detail(MOVE_HELP)));

const deleteCmd = Command.make(
  "delete",
  { id: optionalIdArg, video: videoAddressOption, at: atOption },
  ({ id, video: videoRef, at }) =>
    Effect.gen(function* () {
      yield* requireLocalFrameStore;
      const video = Option.fromNullable(yield* optionalDraftId(videoRef));
      const row = yield* resolveTargetClipMockup({ id, video, at });
      const svc = yield* ClipMockupOperationsService;
      yield* svc.deleteClipMockup(row.id);
      const archived = yield* svc
        .getClipMockupById(row.id)
        .pipe(
          Effect.catchTag("NotFoundError", () => notFound("clipMockup", row.id))
        );
      yield* emitObject(withVoiceDuration(archived));
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
    captureCmd,
  ])
);
