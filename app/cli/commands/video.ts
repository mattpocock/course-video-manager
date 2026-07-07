import { readFileSync } from "node:fs";
import { Args, Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { LessonSectionOperationsService } from "@/services/db-lesson-section-operations.server";
import { PitchOperationsService } from "@/services/db-pitch-operations.server";
import {
  detail,
  emitGet,
  emitNdjson,
  emitObject,
  notFound,
  parseError,
  rejectBothFlags,
  withName,
} from "@/cli/helpers";
import { withBackupCoordination } from "@/cli/backup-coordinator";
import {
  formatProseTranscript,
  toTranscriptItems,
} from "@/lib/transcript-builder";
import {
  VIDEO_HELP,
  LIST_HELP,
  GET_HELP,
  TREE_HELP,
  TRANSCRIPT_HELP,
  CREATE_HELP,
  MOVE_HELP,
  UPDATE_HELP,
} from "./video.help";

// ---------------------------------------------------------------------------
// Shared fetch — return undefined for an absent row (CLI owns not-found).
// ---------------------------------------------------------------------------

const fetchVideoWithClips = (id: string) =>
  Effect.flatMap(VideoOperationsService, (svc) =>
    svc.getVideoWithClipsById(id)
  ).pipe(Effect.catchTag("NotFoundError", () => Effect.succeed(undefined)));

// ---------------------------------------------------------------------------
// Tree skeleton builder
// ---------------------------------------------------------------------------

interface TreeNode {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly children?: ReadonlyArray<TreeNode>;
}

const buildVideoTree = (
  video: {
    id: string;
    path: string;
    clips: ReadonlyArray<{ id: string; order: string; text: string }>;
    chapters: ReadonlyArray<{ id: string; order: string; name: string }>;
  },
  depth: number
): TreeNode => {
  const children: TreeNode[] = [
    ...video.clips.map((c) => ({
      order: c.order,
      node: { id: c.id, kind: "clip", name: c.text },
    })),
    ...video.chapters.map((c) => ({
      order: c.order,
      node: { id: c.id, kind: "chapter", name: c.name },
    })),
  ]
    .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
    .map((x) => x.node);

  const node: TreeNode = { id: video.id, kind: "video", name: video.path };
  // Clips/Chapters are leaves; only the first level of children exists.
  if (depth >= 1) {
    return { ...node, children };
  }
  return node;
};

// ---------------------------------------------------------------------------
// Verbs
// ---------------------------------------------------------------------------

const archived = Options.boolean("archived");

const listCmd = Command.make("list", { archived }, ({ archived }) =>
  Effect.gen(function* () {
    const svc = yield* VideoOperationsService;
    const videos = archived
      ? yield* svc.getArchivedStandaloneVideos()
      : yield* svc.getAllStandaloneVideos();
    yield* emitNdjson(videos.map(withName));
  })
).pipe(Command.withDescription(detail(LIST_HELP)));

const ids = Args.text({ name: "id" }).pipe(Args.repeated);

const getCmd = Command.make("get", { ids }, ({ ids }) =>
  emitGet({ entity: "video", ids, fetch: fetchVideoWithClips })
).pipe(Command.withDescription(detail(GET_HELP)));

const treeId = Args.text({ name: "id" });
const depth = Options.text("depth").pipe(Options.withDefault("1"));

const treeCmd = Command.make("tree", { id: treeId, depth }, ({ id, depth }) =>
  Effect.gen(function* () {
    const levels =
      depth === "all"
        ? Number.POSITIVE_INFINITY
        : /^\d+$/.test(depth)
          ? Number.parseInt(depth, 10)
          : NaN;
    if (Number.isNaN(levels)) {
      return yield* parseError(
        `--depth must be a non-negative integer or "all" (got "${depth}")`,
        "video"
      );
    }
    const video = yield* fetchVideoWithClips(id);
    if (video === undefined) {
      return yield* notFound("video", id);
    }
    yield* emitObject(buildVideoTree(video, levels));
  })
).pipe(Command.withDescription(detail(TREE_HELP)));

const transcriptId = Args.text({ name: "id" });

const transcriptCmd = Command.make(
  "transcript",
  { id: transcriptId },
  ({ id }) =>
    Effect.gen(function* () {
      const video = yield* fetchVideoWithClips(id);
      if (video === undefined) {
        return yield* notFound("video", id);
      }
      const items = toTranscriptItems(video.clips, video.chapters);
      const transcript = formatProseTranscript(items);
      const wordCount = transcript ? transcript.split(/\s+/).length : 0;
      yield* emitObject({
        id: video.id,
        path: video.path,
        lessonId: video.lessonId,
        transcript,
        wordCount,
        items,
      });
    })
).pipe(Command.withDescription(detail(TRANSCRIPT_HELP)));

// ---------------------------------------------------------------------------
// Write verbs: create / move / update
// ---------------------------------------------------------------------------

const nameOption = Options.text("name").pipe(
  Options.withDescription("The Video's name (its 'path').")
);
const lessonOption = Options.text("lesson").pipe(
  Options.withDescription(
    "Parent Lesson id (mutually exclusive with --pitch)."
  ),
  Options.optional
);
const pitchOption = Options.text("pitch").pipe(
  Options.withDescription(
    "Parent Pitch id (mutually exclusive with --lesson)."
  ),
  Options.optional
);

/** Ensure a Lesson id exists (clean exit 2), else NotFound. */
const requireLesson = (lessonId: string) =>
  Effect.flatMap(LessonSectionOperationsService, (svc) =>
    svc
      .getLessonById(lessonId)
      .pipe(
        Effect.catchTag("NotFoundError", () => notFound("lesson", lessonId))
      )
  );

/** Ensure a Pitch id exists (clean exit 2), else NotFound. */
const requirePitch = (pitchId: string) =>
  Effect.flatMap(PitchOperationsService, (svc) =>
    svc
      .getPitch(pitchId)
      .pipe(Effect.catchTag("NotFoundError", () => notFound("pitch", pitchId)))
  );

const createCmd = Command.make(
  "create",
  { name: nameOption, lesson: lessonOption, pitch: pitchOption },
  ({ name, lesson, pitch }) =>
    withBackupCoordination(
      Effect.gen(function* () {
        if (name.trim() === "") {
          return yield* parseError("--name must not be empty", "video");
        }
        const lessonId = Option.getOrUndefined(lesson);
        const pitchId = Option.getOrUndefined(pitch);
        yield* rejectBothFlags({
          a: lessonId,
          b: pitchId,
          flags: ["--lesson", "--pitch"],
          entity: "video",
        });

        const svc = yield* VideoOperationsService;

        if (lessonId !== undefined) {
          yield* requireLesson(lessonId);
          const created = yield* svc
            .createVideo(lessonId, { path: name, originalFootagePath: "" })
            .pipe(
              Effect.catchTag("VideoPathTakenError", (e) =>
                parseError(e.message, "video")
              )
            );
          return yield* emitObject(created);
        }

        if (pitchId !== undefined) {
          yield* requirePitch(pitchId);
          const created = yield* svc.createStandaloneVideo({ path: name });
          const linked = yield* svc.linkVideoToPitch({
            videoId: created.id,
            pitchId,
          });
          return yield* emitObject(linked);
        }

        const created = yield* svc.createStandaloneVideo({ path: name });
        yield* emitObject(created);
      })
    )
).pipe(Command.withDescription(detail(CREATE_HELP)));

const moveId = Args.text({ name: "id" });

const moveCmd = Command.make(
  "move",
  { id: moveId, lesson: lessonOption, pitch: pitchOption },
  ({ id, lesson, pitch }) =>
    withBackupCoordination(
      Effect.gen(function* () {
        const lessonId = Option.getOrUndefined(lesson);
        const pitchId = Option.getOrUndefined(pitch);
        yield* rejectBothFlags({
          a: lessonId,
          b: pitchId,
          flags: ["--lesson", "--pitch"],
          entity: "video",
        });
        if (lessonId === undefined && pitchId === undefined) {
          return yield* parseError(
            "move needs one of --lesson / --pitch",
            "video"
          );
        }

        const svc = yield* VideoOperationsService;
        yield* svc
          .getVideoRowById(id)
          .pipe(Effect.catchTag("NotFoundError", () => notFound("video", id)));

        if (lessonId !== undefined) {
          yield* requireLesson(lessonId);
          const moved = yield* svc
            .moveVideoToLesson({ videoId: id, lessonId })
            .pipe(
              Effect.catchTag("VideoPathTakenError", (e) =>
                parseError(e.message, "video")
              )
            );
          return yield* emitObject(moved);
        }

        yield* requirePitch(pitchId!);
        const moved = yield* svc.linkVideoToPitch({
          videoId: id,
          pitchId: pitchId!,
        });
        yield* emitObject(moved);
      })
    )
).pipe(Command.withDescription(detail(MOVE_HELP)));

const updateId = Args.text({ name: "id" });
const updateNameOption = Options.text("name").pipe(
  Options.withDescription("The Video's new name (its 'path')."),
  Options.optional
);
const updateBodyOption = Options.text("body").pipe(
  Options.withDescription(
    "The Video's markdown body, inline (mutually exclusive with --body-file)."
  ),
  Options.optional
);
const updateBodyFileOption = Options.text("body-file").pipe(
  Options.withDescription(
    "Read the Video's markdown body from a file; '-' reads STDIN (mutually " +
      "exclusive with --body)."
  ),
  Options.optional
);
const updateDescriptionOption = Options.text("description").pipe(
  Options.withDescription(
    "The Video's SEO description (the 'video_description' column)."
  ),
  Options.optional
);

/**
 * Read the markdown body from a file path, or from STDIN when the path is '-'.
 * An unreadable source is invalid input (exit 3), matching the CLI's treatment
 * of other bad flag values.
 */
const readBodySource = (source: string) =>
  Effect.try({
    try: () => readFileSync(source === "-" ? 0 : source, "utf8"),
    catch: () =>
      parseError(
        `could not read --body-file ${
          source === "-" ? "(stdin)" : `"${source}"`
        }`,
        "video"
      ),
  });

const updateCmd = Command.make(
  "update",
  {
    id: updateId,
    name: updateNameOption,
    body: updateBodyOption,
    bodyFile: updateBodyFileOption,
    description: updateDescriptionOption,
  },
  ({ id, name, body, bodyFile, description }) =>
    withBackupCoordination(
      Effect.gen(function* () {
        const newName = Option.getOrUndefined(name);
        const inlineBody = Option.getOrUndefined(body);
        const bodyFilePath = Option.getOrUndefined(bodyFile);
        const newDescription = Option.getOrUndefined(description);

        yield* rejectBothFlags({
          a: inlineBody,
          b: bodyFilePath,
          flags: ["--body", "--body-file"],
          entity: "video",
        });

        if (
          newName === undefined &&
          inlineBody === undefined &&
          bodyFilePath === undefined &&
          newDescription === undefined
        ) {
          return yield* parseError(
            "update needs at least one of --name / --body / --body-file / --description",
            "video"
          );
        }

        if (newName !== undefined && newName.trim() === "") {
          return yield* parseError("--name must not be empty", "video");
        }

        const newBody =
          bodyFilePath !== undefined
            ? yield* readBodySource(bodyFilePath)
            : inlineBody;

        const svc = yield* VideoOperationsService;
        yield* svc
          .getVideoRowById(id)
          .pipe(Effect.catchTag("NotFoundError", () => notFound("video", id)));

        if (newName !== undefined) {
          yield* svc
            .updateVideoPath({ videoId: id, path: newName })
            .pipe(
              Effect.catchTag("VideoPathTakenError", (e) =>
                parseError(e.message, "video")
              )
            );
        }
        if (newBody !== undefined) {
          yield* svc.updateVideoBody({ videoId: id, body: newBody });
        }
        if (newDescription !== undefined) {
          yield* svc.updateVideoDescription({
            videoId: id,
            description: newDescription,
          });
        }

        const updated = yield* svc.getVideoRowById(id);
        yield* emitObject(updated);
      })
    )
).pipe(Command.withDescription(detail(UPDATE_HELP)));

// ---------------------------------------------------------------------------
// Noun command
// ---------------------------------------------------------------------------

export const videoCommand = Command.make("video").pipe(
  Command.withDescription(detail(VIDEO_HELP)),
  Command.withSubcommands([
    listCmd,
    getCmd,
    treeCmd,
    transcriptCmd,
    createCmd,
    moveCmd,
    updateCmd,
  ])
);
