import { Effect, Schema } from "effect";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { CloudinaryMarkdownService } from "@/services/cloudinary-markdown-service";
import { makeAction } from "@/services/route-action.server";
import { getStandaloneVideoFilePath } from "@/services/standalone-video-files";
import { FileSystem } from "@effect/platform";
import path from "node:path";

const RequestSchema = Schema.Struct({
  body: Schema.String,
  deleteLocalFiles: Schema.optional(Schema.Boolean),
});

export const action = makeAction({
  input: "json",
  dump: false,
  errors: {
    NotFoundError: 404,
    ImageUploadError: 400,
    CloudinaryUrlNotSetError: 500,
    CouldNotParseCloudinaryUrlError: 500,
  },
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const { body, deleteLocalFiles } =
        yield* Schema.decodeUnknown(RequestSchema)(payload);

      const videoOps = yield* VideoOperationsService;
      const cloudinaryMarkdown = yield* CloudinaryMarkdownService;
      const fs = yield* FileSystem.FileSystem;

      const video = yield* videoOps.getVideoDeepById(params.videoId!);

      let baseDir: string;
      if (!video.lesson) {
        baseDir = path.resolve(getStandaloneVideoFilePath(params.videoId!));
      } else {
        const repo = video.lesson.section.repoVersion.repo;
        const section = video.lesson.section;
        baseDir = path.join(repo.filePath!, section.path, video.lesson.path);
      }

      const result = yield* cloudinaryMarkdown.uploadImagesInMarkdown(
        body,
        baseDir
      );

      if (deleteLocalFiles && result.uploadedFilePaths.length > 0) {
        for (const filePath of result.uploadedFilePaths) {
          yield* fs.remove(filePath).pipe(Effect.catchAll(() => Effect.void));
        }
      }

      return { body: result.body };
    }),
});
