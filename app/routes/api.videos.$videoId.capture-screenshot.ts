import { Console, Effect, Schema } from "effect";
import type { Route } from "./+types/api.videos.$videoId.capture-screenshot";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { FFmpegCommandsService } from "@/services/ffmpeg-commands";
import { runtimeLive } from "@/services/layer.server";
import { data } from "react-router";
import { getStandaloneVideoFilePath } from "@/services/standalone-video-files";
import { FileSystem } from "@effect/platform";
import path from "node:path";

const RequestSchema = Schema.Struct({
  timestamp: Schema.Number,
  videoFilename: Schema.String,
});

export const action = async (args: Route.ActionArgs) => {
  const videoId = args.params.videoId;
  const json = await args.request.json();

  return Effect.gen(function* () {
    const { timestamp, videoFilename } =
      yield* Schema.decodeUnknown(RequestSchema)(json);

    const videoOps = yield* VideoOperationsService;
    const ffmpeg = yield* FFmpegCommandsService;
    const fs = yield* FileSystem.FileSystem;

    const video = yield* videoOps.getVideoDeepById(videoId);

    // Determine base directory for saving screenshots
    let baseDir: string;
    if (!video.lesson) {
      baseDir = path.resolve(getStandaloneVideoFilePath(videoId));
    } else {
      const repo = video.lesson.section.repoVersion.repo;
      const section = video.lesson.section;
      baseDir = path.join(repo.filePath!, section.path, video.lesson.path);
    }

    // Find next available screenshot filename
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
  }).pipe(
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("ParseError", () => {
      return Effect.die(data("Invalid request", { status: 400 }));
    }),
    Effect.catchTag("NotFoundError", () => {
      return Effect.die(data("Video not found", { status: 404 }));
    }),
    Effect.catchTag("FFmpegError", (e) => {
      return Effect.die(data(e.message, { status: 500 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Failed to capture screenshot", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};
