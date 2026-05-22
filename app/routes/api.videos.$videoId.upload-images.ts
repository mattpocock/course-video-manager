import { Console, Effect, Schema } from "effect";
import type { Route } from "./+types/api.videos.$videoId.upload-images";
import { DBFunctionsService } from "@/services/db-service.server";
import { CloudinaryMarkdownService } from "@/services/cloudinary-markdown-service";
import { runtimeLive } from "@/services/layer.server";
import { data } from "react-router";
import { getStandaloneVideoFilePath } from "@/services/standalone-video-files";
import { FileSystem } from "@effect/platform";
import path from "node:path";

const RequestSchema = Schema.Struct({
  body: Schema.String,
  deleteLocalFiles: Schema.optional(Schema.Boolean),
});

export const action = async (args: Route.ActionArgs) => {
  const videoId = args.params.videoId;
  const json = await args.request.json();

  return Effect.gen(function* () {
    const { body, deleteLocalFiles } =
      yield* Schema.decodeUnknown(RequestSchema)(json);

    const db = yield* DBFunctionsService;
    const cloudinaryMarkdown = yield* CloudinaryMarkdownService;
    const fs = yield* FileSystem.FileSystem;

    const video = yield* db.getVideoById(videoId);

    // Determine base directory for resolving image paths
    let baseDir: string;
    if (!video.lesson) {
      // Standalone video — images relative to video's asset directory
      baseDir = path.resolve(getStandaloneVideoFilePath(videoId));
    } else {
      // Lesson-connected video — images relative to lesson directory
      const repo = video.lesson.section.repoVersion.repo;
      const section = video.lesson.section;
      baseDir = path.join(repo.filePath!, section.path, video.lesson.path);
    }

    const result = yield* cloudinaryMarkdown.uploadImagesInMarkdown(
      body,
      baseDir
    );

    // Delete local files if requested and upload succeeded
    if (deleteLocalFiles && result.uploadedFilePaths.length > 0) {
      for (const filePath of result.uploadedFilePaths) {
        yield* fs.remove(filePath).pipe(Effect.catchAll(() => Effect.void));
      }
    }

    return { body: result.body };
  }).pipe(
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("ParseError", () => {
      return Effect.die(data("Invalid request", { status: 400 }));
    }),
    Effect.catchTag("NotFoundError", () => {
      return Effect.die(data("Video not found", { status: 404 }));
    }),
    Effect.catchTag("ImageUploadError", (e) => {
      return Effect.die(data(e.message, { status: 400 }));
    }),
    Effect.catchTag("CloudinaryUrlNotSetError", () => {
      return Effect.die(
        data("CLOUDINARY_URL environment variable is not configured", {
          status: 500,
        })
      );
    }),
    Effect.catchTag("CouldNotParseCloudinaryUrlError", () => {
      return Effect.die(
        data("CLOUDINARY_URL environment variable is malformed", {
          status: 500,
        })
      );
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Failed to upload images", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};
