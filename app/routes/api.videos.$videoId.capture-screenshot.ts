import { Effect, Schema } from "effect";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { FFmpegCommandsService } from "@/services/ffmpeg-commands";
import { makeAction } from "@/services/route-action.server";
import { getStandaloneVideoFilePath } from "@/services/standalone-video-files";
import { FileSystem } from "@effect/platform";
import path from "node:path";

const RequestSchema = Schema.Struct({
  timestamp: Schema.Number,
  videoFilename: Schema.String,
});

export const action = makeAction({
  input: "json",
  dump: false,
  errors: { NotFoundError: 404, FFmpegError: 500 },
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const { timestamp, videoFilename } =
        yield* Schema.decodeUnknown(RequestSchema)(payload);

      const videoOps = yield* VideoOperationsService;
      const ffmpeg = yield* FFmpegCommandsService;
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

      yield* fs.makeDirectory(baseDir, { recursive: true });
      let counter = 1;
      let filename: string;
      do {
        filename = `screenshot-${counter}.png`;
        const exists = yield* fs.exists(path.join(baseDir, filename));
        if (!exists) break;
        counter++;
      } while (true);

      const outputPath = path.join(baseDir, filename);

      yield* ffmpeg.captureFrameAtTime(videoFilename, timestamp, outputPath);

      return { imagePath: `./${filename}` };
    }),
});
