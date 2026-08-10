import { Effect, Schema } from "effect";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { makeAction } from "@/services/route-action.server";
import { deleteVideoFile, videoFileExists } from "@/services/video-files";
import { data } from "react-router";

const deleteFileSchema = Schema.Struct({
  videoId: Schema.String,
  path: Schema.String.pipe(Schema.minLength(1)),
});

export const action = makeAction({
  input: "formData",
  errors: { NotFoundError: 404, InvalidVideoFilePathError: 400 },
  effect: ({ payload }) =>
    Effect.gen(function* () {
      const parsed = yield* Schema.decodeUnknown(deleteFileSchema)(payload);

      const videoOps = yield* VideoOperationsService;

      const video = yield* videoOps.getVideoDeepById(parsed.videoId);

      const fileExists = yield* videoFileExists(video.lineageId, parsed.path);
      if (!fileExists) {
        return yield* Effect.die(data("File not found", { status: 404 }));
      }

      yield* deleteVideoFile(video.lineageId, parsed.path);

      return { success: true, path: parsed.path };
    }),
});
