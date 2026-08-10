import { Effect, Schema } from "effect";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { makeAction } from "@/services/route-action.server";
import { videoFileExists, writeVideoFile } from "@/services/video-files";
import { data } from "react-router";

// Content is a plain string: only text files can be edited in place.
const updateFileSchema = Schema.Struct({
  videoId: Schema.String,
  path: Schema.String.pipe(Schema.minLength(1)),
  content: Schema.String,
});

export const action = makeAction({
  input: "formData",
  errors: { NotFoundError: 404, InvalidVideoFilePathError: 400 },
  effect: ({ payload }) =>
    Effect.gen(function* () {
      const parsed = yield* Schema.decodeUnknown(updateFileSchema)(payload);

      const videoOps = yield* VideoOperationsService;

      const video = yield* videoOps.getVideoDeepById(parsed.videoId);

      const fileExists = yield* videoFileExists(video.lineageId, parsed.path);
      if (!fileExists) {
        return yield* Effect.die(data("File not found", { status: 404 }));
      }

      yield* writeVideoFile(video.lineageId, parsed.path, parsed.content);

      return { success: true, path: parsed.path };
    }),
});
