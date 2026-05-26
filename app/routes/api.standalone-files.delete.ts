import { Effect, Schema } from "effect";
import { FileSystem } from "@effect/platform";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { makeAction } from "@/services/route-action.server";
import { getStandaloneVideoFilePath } from "@/services/standalone-video-files";
import { data } from "react-router";

const deleteFileSchema = Schema.Struct({
  videoId: Schema.String,
  filename: Schema.String,
});

export const action = makeAction({
  input: "formData",
  errors: { NotFoundError: 404 },
  effect: ({ payload }) =>
    Effect.gen(function* () {
      const parsed = yield* Schema.decodeUnknown(deleteFileSchema)(payload);

      const videoOps = yield* VideoOperationsService;
      const fs = yield* FileSystem.FileSystem;

      const video = yield* videoOps.getVideoDeepById(parsed.videoId);
      if (video.lessonId !== null) {
        return yield* Effect.die(
          data("Cannot delete files from lesson-connected videos", {
            status: 400,
          })
        );
      }

      const filePath = getStandaloneVideoFilePath(
        parsed.videoId,
        parsed.filename
      );

      const fileExists = yield* fs.exists(filePath);
      if (!fileExists) {
        return yield* Effect.die(data("File not found", { status: 404 }));
      }

      yield* fs.remove(filePath);

      return { success: true, filename: parsed.filename };
    }),
});
