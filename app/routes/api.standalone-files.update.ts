import { Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { makeAction } from "@/services/route-action.server";
import { getStandaloneVideoFilePath } from "@/services/standalone-video-files";
import { data } from "react-router";

export const action = makeAction({
  input: "formData",
  errors: { NotFoundError: 404 },
  effect: ({ payload }) =>
    Effect.gen(function* () {
      const p = payload as Record<string, unknown>;
      const videoId = p.videoId;
      const filename = p.filename;
      const textContent = p.content;

      if (typeof videoId !== "string" || !videoId) {
        return yield* Effect.die(data("videoId is required", { status: 400 }));
      }

      if (typeof filename !== "string" || !filename) {
        return yield* Effect.die(data("filename is required", { status: 400 }));
      }

      if (typeof textContent !== "string") {
        return yield* Effect.die(
          data("content must be a string (only text files can be edited)", {
            status: 400,
          })
        );
      }

      const videoOps = yield* VideoOperationsService;
      const fs = yield* FileSystem.FileSystem;

      const video = yield* videoOps.getVideoDeepById(videoId);
      if (video.lessonId !== null) {
        return yield* Effect.die(
          data("Cannot modify files for lesson-connected videos", {
            status: 400,
          })
        );
      }

      const filePath = getStandaloneVideoFilePath(videoId, filename);

      const fileExists = yield* fs.exists(filePath);
      if (!fileExists) {
        return yield* Effect.die(data("File not found", { status: 404 }));
      }

      const fileData = new TextEncoder().encode(textContent);
      yield* fs.writeFile(filePath, fileData);

      return { success: true, filename };
    }),
});
