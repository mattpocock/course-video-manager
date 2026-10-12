import { Effect, Schema } from "effect";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { FFmpegCommandsService } from "@/services/ffmpeg-commands";
import { makeAction } from "@/services/route-action.server";
import { getVideoFilePath } from "@/services/video-files";
import { FileSystem } from "@effect/platform";
import path from "node:path";
import { SCENES } from "@/packages/scene-layout";

/**
 * A `ClipFrame` from `@/packages/clip-source`: the picker never names a file.
 * A new-recorder Clip's is a composite, drawn from its screen and camera.
 */
const RequestSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("footage"),
    inputVideo: Schema.String,
    time: Schema.Number,
  }),
  Schema.Struct({
    kind: Schema.Literal("composite"),
    screen: Schema.String,
    camera: Schema.String,
    scene: Schema.Literal(...SCENES),
    time: Schema.Number,
  })
);

export const action = makeAction({
  input: "json",
  errors: { NotFoundError: 404, FFmpegError: 500 },
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const frame = yield* Schema.decodeUnknown(RequestSchema)(payload);

      const videoOps = yield* VideoOperationsService;
      const ffmpeg = yield* FFmpegCommandsService;
      const fs = yield* FileSystem.FileSystem;

      const video = yield* videoOps.getVideoDeepById(params.videoId!);

      const baseDir = path.resolve(getVideoFilePath(video.lineageId));

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

      yield* ffmpeg.captureFrameAtTime(frame, outputPath);

      return { imagePath: `./${filename}` };
    }),
});
