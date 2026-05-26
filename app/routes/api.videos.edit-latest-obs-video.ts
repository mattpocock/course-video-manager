import { VideoOperationsService } from "@/services/db-video-operations.server";
import { LessonSectionOperationsService } from "@/services/db-lesson-section-operations.server";
import { makeAction } from "@/services/route-action.server";
import { Effect, Schema } from "effect";
import { Command } from "@effect/platform";

const editLatestObsVideoSchema = Schema.Struct({
  lessonId: Schema.String,
  path: Schema.String,
});

export const action = makeAction({
  input: "formData",
  errors: { NotFoundError: 404 },
  effect: ({ payload }) =>
    Effect.gen(function* () {
      const { lessonId, path } = yield* Schema.decodeUnknown(
        editLatestObsVideoSchema
      )(payload);

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
    }),
});
