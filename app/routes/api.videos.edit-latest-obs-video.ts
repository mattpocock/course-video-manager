import { DBService } from "@/services/db-service";
import { layerLive } from "@/services/layer";
import { Effect, Schema } from "effect";
import type { Route } from "./+types/api.videos.edit-latest-obs-video";
import { execSync } from "child_process";

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

    const db = yield* DBService;

    const lesson = yield* db.getLessonById(lessonId);

    const video = yield* db.createVideo(lesson.id, {
      path,
    });

    execSync("tt queue-auto-edited-video-for-course " + video.id);

    return video;
  }).pipe(Effect.provide(layerLive), Effect.runPromise);
};
