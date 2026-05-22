import { Console, Effect } from "effect";
import { FileSystem } from "@effect/platform";
import type { Route } from "./+types/api.standalone-files.update";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { runtimeLive } from "@/services/layer.server";
import { withDatabaseDump } from "@/services/dump-service";
import { getStandaloneVideoFilePath } from "@/services/standalone-video-files";
import { data } from "react-router";

export const action = async (args: Route.ActionArgs) => {
  const formData = await args.request.formData();

  return Effect.gen(function* () {
    const videoId = formData.get("videoId");
    const filename = formData.get("filename");
    const textContent = formData.get("content");

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

    // Validate video exists and is a standalone video
    const video = yield* videoOps.getVideoDeepById(videoId);
    if (video.lessonId !== null) {
      return yield* Effect.die(
        data("Cannot modify files for lesson-connected videos", { status: 400 })
      );
    }

    // Construct file path
    const filePath = getStandaloneVideoFilePath(videoId, filename);

    // Check if file exists
    const fileExists = yield* fs.exists(filePath);
    if (!fileExists) {
      return yield* Effect.die(data("File not found", { status: 404 }));
    }

    // Update file (write as binary to handle all encodings properly)
    const fileData = new TextEncoder().encode(textContent);
    yield* fs.writeFile(filePath, fileData);

    return { success: true, filename };
  }).pipe(
    withDatabaseDump,
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("NotFoundError", () => {
      return Effect.die(data("Video not found", { status: 404 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};
