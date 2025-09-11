import { Effect, Schema } from "effect";
import { DBService } from "@/services/db-service";
import { layerLive } from "@/services/layer";
import type { Route } from "./+types/api.lessons.$lessonId.add-video";
import { redirect } from "react-router";
import { withDatabaseDump } from "@/services/dump-service";

const addVideoSchema = Schema.Struct({
  path: Schema.String,
});

export const action = async (args: Route.ActionArgs) => {
  const { lessonId } = args.params;
  const formData = await args.request.formData();
  const formDataObject = Object.fromEntries(formData);

  return Effect.gen(function* () {
    const result = yield* Schema.decodeUnknown(addVideoSchema)(formDataObject);

    const db = yield* DBService;
    yield* db.getLessonById(lessonId);

    const video = yield* db.createVideo(lessonId, {
      path: result.path,
      originalFootagePath: "",
    });

    return redirect(`/videos/${video.id}/edit`);
  }).pipe(withDatabaseDump, Effect.provide(layerLive), Effect.runPromise);
};
