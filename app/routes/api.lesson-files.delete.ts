import { Console, Effect, Schema } from "effect";
import { FileSystem } from "@effect/platform";
import type { Route } from "./+types/api.lesson-files.delete";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { runtimeLive } from "@/services/layer.server";
import { data } from "react-router";
import path from "path";

const deleteFileSchema = Schema.Struct({
  videoId: Schema.String,
  filename: Schema.String.pipe(Schema.minLength(1)),
});

export const action = async (args: Route.ActionArgs) => {
  const formData = await args.request.formData();
  const formDataObject = Object.fromEntries(formData);

  return Effect.gen(function* () {
    const parsed =
      yield* Schema.decodeUnknown(deleteFileSchema)(formDataObject);

    const videoOps = yield* VideoOperationsService;
    const fs = yield* FileSystem.FileSystem;

    const video = yield* videoOps.getVideoDeepById(parsed.videoId);
    if (video.lessonId === null) {
      return yield* Effect.die(
        data("Cannot delete lesson files from standalone videos", {
          status: 400,
        })
      );
    }

    const lesson = video.lesson!;
    const repo = lesson.section.repoVersion.repo;
    const section = lesson.section;
    const lessonPath = path.join(repo.filePath!, section.path, lesson.path);

    const filePath = path.resolve(lessonPath, parsed.filename);

    if (!filePath.startsWith(lessonPath + path.sep)) {
      return yield* Effect.die(data("Invalid filename", { status: 400 }));
    }

    const fileExists = yield* fs.exists(filePath);
    if (!fileExists) {
      return yield* Effect.die(data("File not found", { status: 404 }));
    }

    yield* fs.remove(filePath);

    return { success: true, filename: parsed.filename };
  }).pipe(
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("ParseError", () => {
      return Effect.die(data("Invalid request", { status: 400 }));
    }),
    Effect.catchTag("NotFoundError", () => {
      return Effect.die(data("Video not found", { status: 404 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};
