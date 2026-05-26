import { Effect, Schema } from "effect";
import { FileSystem } from "@effect/platform";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { makeAction } from "@/services/route-action.server";
import { data } from "react-router";
import path from "path";

const deleteFileSchema = Schema.Struct({
  videoId: Schema.String,
  filename: Schema.String.pipe(Schema.minLength(1)),
});

export const action = makeAction({
  input: "formData",
  dump: false,
  errors: { NotFoundError: 404 },
  effect: ({ payload }) =>
    Effect.gen(function* () {
      const parsed = yield* Schema.decodeUnknown(deleteFileSchema)(payload);

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
    }),
});
