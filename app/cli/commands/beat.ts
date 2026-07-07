import { Args, Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";
import { BeatOperationsService } from "@/services/db-beat-operations.server";
import { PitchOperationsService } from "@/services/db-pitch-operations.server";
import { BEAT_KINDS, DEFAULT_BEAT_KIND } from "@/features/beats/beat-kinds";
import {
  detail,
  emitNdjson,
  emitObject,
  notFound,
  parseError,
  rejectBothFlags,
} from "@/cli/helpers";
import { withBackupCoordination } from "@/cli/backup-coordinator";
import {
  HELP,
  LIST_HELP,
  ADD_HELP,
  UPDATE_HELP,
  MOVE_HELP,
  DELETE_HELP,
} from "./beat.help";

// ---------------------------------------------------------------------------
// Options / Args
// ---------------------------------------------------------------------------

const videoListOption = Options.text("video").pipe(
  Options.withDescription(
    "The parent Video id whose Beat plan to list (required)."
  )
);

const videoTargetOption = Options.text("video").pipe(
  Options.withDescription("The target Video id for the Beat (required).")
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

const kindOption = Options.choice("kind", [...BEAT_KINDS]).pipe(
  Options.withDescription(
    "Beat kind: definition|walkthrough|playthrough|quest|reaction."
  ),
  Options.optional
);

const titleOption = Options.text("title").pipe(
  Options.withDescription("The Beat's short title label."),
  Options.optional
);

const descriptionOption = Options.text("description").pipe(
  Options.withDescription(
    "The Beat's free-text planning note (never published)."
  ),
  Options.optional
);

const beforeOption = Options.text("before").pipe(
  Options.withDescription(
    "Place immediately before this beat id (mutually exclusive with --after)."
  ),
  Options.optional
);

const afterOption = Options.text("after").pipe(
  Options.withDescription(
    "Place immediately after this beat id (mutually exclusive with --before)."
  ),
  Options.optional
);

const idArg = Args.text({ name: "id" });

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const resolveBeforeBeatId = (params: {
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
      entity: "beat",
    });
    if (before === undefined && after === undefined) {
      return null;
    }

    const svc = yield* BeatOperationsService;
    const rows = (yield* svc.listBeatsByVideoId(params.videoId)).filter(
      (s) => s.id !== params.excludeId
    );

    if (before !== undefined) {
      if (!rows.some((s) => s.id === before)) {
        return yield* notFound("beat", before);
      }
      return before;
    }

    const idx = rows.findIndex((s) => s.id === after);
    if (idx === -1) {
      return yield* notFound("beat", after!);
    }
    return rows[idx + 1]?.id ?? null;
  });

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
      entity: "beat",
    });
    if (video === undefined && pitch === undefined) {
      return yield* parseError(
        "beat add needs one of --video / --pitch",
        "beat"
      );
    }
    if (video !== undefined) {
      return video;
    }

    const pitchSvc = yield* PitchOperationsService;
    const row = yield* pitchSvc
      .getPitchWithVideos(pitch!)
      .pipe(Effect.catchTag("NotFoundError", () => notFound("pitch", pitch!)));
    if (row.archived) {
      return yield* notFound("pitch", pitch!);
    }

    const videos = row.videos;
    if (videos.length > 1) {
      return yield* parseError(
        `pitch ${pitch} has ${videos.length} videos — target one directly with --video <id>`,
        "beat"
      );
    }
    if (videos.length === 1) {
      return videos[0]!.id;
    }
    const created = yield* pitchSvc.createVideoFromPitch(pitch!);
    return created.id;
  });

const requireActiveBeat = (id: string) =>
  Effect.gen(function* () {
    const svc = yield* BeatOperationsService;
    const row = yield* svc
      .getBeatById(id)
      .pipe(Effect.catchTag("NotFoundError", () => notFound("beat", id)));
    if (row.archived) {
      return yield* notFound("beat", id);
    }
    return row;
  });

// ---------------------------------------------------------------------------
// Verbs
// ---------------------------------------------------------------------------

const listCmd = Command.make("list", { video: videoListOption }, ({ video }) =>
  Effect.gen(function* () {
    const svc = yield* BeatOperationsService;
    const rows = yield* svc.listBeatsByVideoId(video);
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
    withBackupCoordination(
      Effect.gen(function* () {
        const videoId = yield* resolveTargetVideoId({ video, pitch });
        const beforeBeatId = yield* resolveBeforeBeatId({
          videoId,
          before,
          after,
        });
        const svc = yield* BeatOperationsService;
        const beat = yield* svc.createBeat(
          videoId,
          Option.getOrUndefined(kind) ?? DEFAULT_BEAT_KIND,
          beforeBeatId,
          Option.getOrUndefined(title) ?? "",
          Option.getOrUndefined(description) ?? ""
        );
        yield* emitObject(beat);
      })
    )
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
    withBackupCoordination(
      Effect.gen(function* () {
        const t = Option.getOrUndefined(title);
        const d = Option.getOrUndefined(description);
        const k = Option.getOrUndefined(kind);

        if (t === undefined && d === undefined && k === undefined) {
          return yield* parseError(
            "update needs at least one of --title / --description / --kind",
            "beat"
          );
        }

        const svc = yield* BeatOperationsService;
        let row = yield* requireActiveBeat(id);
        if (t !== undefined) row = yield* svc.renameBeat(id, t);
        if (d !== undefined) row = yield* svc.setBeatDescription(id, d);
        if (k !== undefined) row = yield* svc.setBeatKind(id, k);
        yield* emitObject(row);
      })
    )
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
    withBackupCoordination(
      Effect.gen(function* () {
        const svc = yield* BeatOperationsService;
        yield* requireActiveBeat(id);
        const beforeBeatId = yield* resolveBeforeBeatId({
          videoId: video,
          before,
          after,
          excludeId: id,
        });
        const moved = yield* svc
          .moveBeat(id, video, beforeBeatId)
          .pipe(
            Effect.catchTag("NotFoundError", (e) =>
              notFound("beat", (e.params as { id?: string }).id ?? id)
            )
          );
        yield* emitObject(moved);
      })
    )
).pipe(Command.withDescription(detail(MOVE_HELP)));

const deleteCmd = Command.make("delete", { id: idArg }, ({ id }) =>
  withBackupCoordination(
    Effect.gen(function* () {
      const svc = yield* BeatOperationsService;
      yield* requireActiveBeat(id);
      yield* svc.deleteBeat(id);
      const archived = yield* svc
        .getBeatById(id)
        .pipe(Effect.catchTag("NotFoundError", () => notFound("beat", id)));
      yield* emitObject(archived);
    })
  )
).pipe(Command.withDescription(detail(DELETE_HELP)));

export const beatCommand = Command.make("beat").pipe(
  Command.withDescription(detail(HELP)),
  Command.withSubcommands([listCmd, addCmd, updateCmd, moveCmd, deleteCmd])
);
