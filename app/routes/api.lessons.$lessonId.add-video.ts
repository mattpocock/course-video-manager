import { Console, Effect, Schema } from "effect";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { LessonSectionOperationsService } from "@/services/db-lesson-section-operations.server";
import { runtimeLive } from "@/services/layer.server";
import type { Route } from "./+types/api.lessons.$lessonId.add-video";
import { data, redirect } from "react-router";
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

    const videoOps = yield* VideoOperationsService;
    const lessonSectionOps = yield* LessonSectionOperationsService;
    yield* lessonSectionOps.getLessonById(lessonId);

    const video = yield* videoOps.createVideo(lessonId, {
      path: result.path,
      originalFootagePath: "",
    });

    const url = new URL(args.request.url);
    const redirectTo =
      url.searchParams.get("redirectTo") === "write" ? "write" : "edit";
    return redirect(`/videos/${video.id}/${redirectTo}`);
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
