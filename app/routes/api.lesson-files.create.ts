import { Console, Effect } from "effect";
import { FileSystem } from "@effect/platform";
import type { Route } from "./+types/api.lesson-files.create";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { runtimeLive } from "@/services/layer.server";
import { withDatabaseDump } from "@/services/dump-service";
import { data } from "react-router";
import path from "path";

export const action = async (args: Route.ActionArgs) => {
  const formData = await args.request.formData();

  return Effect.gen(function* () {
    const videoId = formData.get("videoId");
    const filenameParam = formData.get("filename");
    const textContent = formData.get("content");

    if (typeof videoId !== "string" || !videoId) {
      return yield* Effect.die(data("videoId is required", { status: 400 }));
    }

    if (typeof filenameParam !== "string" || !filenameParam) {
      return yield* Effect.die(data("filename is required", { status: 400 }));
    }

    if (typeof textContent !== "string") {
      return yield* Effect.die(
        data("content must be provided", { status: 400 })
      );
    }

    const videoOps = yield* VideoOperationsService;
    const fs = yield* FileSystem.FileSystem;

    // Validate video exists and is a lesson-connected video
    const video = yield* videoOps.getVideoWithClipsById(videoId);
    if (video.lessonId === null) {
      return yield* Effect.die(
        data("Cannot add files to standalone videos via this endpoint", {
          status: 400,
        })
      );
    }

    const lesson = video.lesson!;
    const repo = lesson.section.repoVersion.repo;
    const section = lesson.section;
    const lessonPath = path.join(repo.filePath!, section.path, lesson.path);

    let filename: string;
    let fileData: Uint8Array;

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
        return yield* Effect.die(data("Missing base64 data", { status: 400 }));
      }

      filename = filenameParam;

      // Decode base64 to binary
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      fileData = bytes;
    } else {
      // Plain text content
      filename = filenameParam;
      fileData = new TextEncoder().encode(textContent);
    }

    // Construct file path in lesson directory
    const filePath = path.join(lessonPath, filename);

    // Check if file already exists
    const fileExists = yield* fs.exists(filePath);
    if (fileExists) {
      return yield* Effect.die(data("File already exists", { status: 409 }));
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
