import { Console, Effect } from "effect";
import { FileSystem } from "@effect/platform";
import type { Route } from "./+types/api.standalone-files.create";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { runtimeLive } from "@/services/layer.server";
import { withDatabaseDump } from "@/services/dump-service";
import { getStandaloneVideoFilePath } from "@/services/standalone-video-files";
import { data } from "react-router";

export const action = async (args: Route.ActionArgs) => {
  const formData = await args.request.formData();

  return Effect.gen(function* () {
    const videoId = formData.get("videoId");
    const filenameOverride = formData.get("filename");
    const file = formData.get("file");
    const textContent = formData.get("content");

    if (typeof videoId !== "string" || !videoId) {
      return yield* Effect.die(data("videoId is required", { status: 400 }));
    }

    const videoOps = yield* VideoOperationsService;
    const fs = yield* FileSystem.FileSystem;

    // Validate video exists and is a standalone video
    const video = yield* videoOps.getVideoDeepById(videoId);
    if (video.lessonId !== null) {
      return yield* Effect.die(
        data("Cannot add files to lesson-connected videos", { status: 400 })
      );
    }

    let filename: string;
    let fileData: Uint8Array;

    // Handle file upload (binary or text)
    if (file instanceof File) {
      // Use override filename if provided, otherwise use uploaded filename
      filename =
        typeof filenameOverride === "string" && filenameOverride.trim()
          ? filenameOverride.trim()
          : file.name;

      // Read file as binary data
      const arrayBuffer = yield* Effect.promise(() => file.arrayBuffer());
      fileData = new Uint8Array(arrayBuffer);
    } else if (typeof textContent === "string") {
      // Check if this is base64 image data (from paste modal)
      if (textContent.startsWith("data:")) {
        // Parse base64 data URL
        const match = textContent.match(/^data:([^;]+);base64,(.+)$/);
        if (!match) {
          return yield* Effect.die(
            data("Invalid base64 data URL format", { status: 400 })
          );
        }

        const base64Data = match[2];
        if (!base64Data) {
          return yield* Effect.die(
            data("Missing base64 data", { status: 400 })
          );
        }

        if (typeof filenameOverride !== "string" || !filenameOverride) {
          return yield* Effect.die(
            data("filename is required for base64 content", { status: 400 })
          );
        }

        filename = filenameOverride;

        // Decode base64 to binary
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        fileData = bytes;
      } else {
        // Plain text content
        if (typeof filenameOverride !== "string" || !filenameOverride) {
          return yield* Effect.die(
            data("filename is required for text content", { status: 400 })
          );
        }
        filename = filenameOverride;
        fileData = new TextEncoder().encode(textContent);
      }
    } else {
      return yield* Effect.die(
        data("Either file or content must be provided", { status: 400 })
      );
    }

    // Construct file path
    const videoDir = getStandaloneVideoFilePath(videoId);
    const filePath = getStandaloneVideoFilePath(videoId, filename);

    // Check if file already exists
    const fileExists = yield* fs.exists(filePath);
    if (fileExists) {
      return yield* Effect.die(data("File already exists", { status: 409 }));
    }

    // Ensure directory exists
    const dirExists = yield* fs.exists(videoDir);
    if (!dirExists) {
      yield* fs.makeDirectory(videoDir, { recursive: true });
    }

    // Write file as binary data
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
