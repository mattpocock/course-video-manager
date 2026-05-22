import { VideoOperationsService } from "@/services/db-video-operations.server";
import { LessonSectionOperationsService } from "@/services/db-lesson-section-operations.server";
import { runtimeLive } from "@/services/layer.server";
import { Console, Effect, Schema } from "effect";
import type { Route } from "./+types/api.videos.edit-latest-obs-video";
import { withDatabaseDump } from "@/services/dump-service";
import { Command } from "@effect/platform";
import { data } from "react-router";

const editLatestObsVideoSchema = Schema.Struct({
  lessonId: Schema.String,
  path: Schema.String,
});

export const action = async (args: Route.ActionArgs) => {
  const formData = await args.request.formData();
  const formDataObject = Object.fromEntries(formData);
  return Effect.gen(function* () {
    const { lessonId, path } = yield* Schema.decodeUnknown(
      editLatestObsVideoSchema
    )(formDataObject);

    const videoOps = yield* VideoOperationsService;
    const lessonSectionOps = yield* LessonSectionOperationsService;

    const lesson = yield* lessonSectionOps.getLessonById(lessonId);

    const video = yield* videoOps.createVideo(lesson.id, {
      path,
      originalFootagePath: "",
    });

    const cmd = Command.make(
      "tt",
      "queue-auto-edited-video-for-course",
      video.id
    );

    const originalFootagePath = yield* Command.string(cmd);

    yield* videoOps.updateVideo(video.id, {
      originalFootagePath: originalFootagePath.trim(),
    });

    return video;
  }).pipe(
    withDatabaseDump,
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("ParseError", () => {
      return Effect.die(data("Invalid request", { status: 400 }));
    }),
    Effect.catchTag("NotFoundError", () => {
      return Effect.die(data("Lesson not found", { status: 404 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};
