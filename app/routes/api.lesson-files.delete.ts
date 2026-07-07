import { Effect, Schema } from "effect";
import { FileSystem } from "@effect/platform";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { makeAction } from "@/services/route-action.server";
import { data } from "react-router";
import path from "path";
import { getVideoFilePath } from "@/services/video-files";

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

      const videoDir = getVideoFilePath(video.lineageId);
      const filePath = path.resolve(videoDir, parsed.filename);

      if (!filePath.startsWith(path.resolve(videoDir) + path.sep)) {
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
