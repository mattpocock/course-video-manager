import { FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Effect, Option } from "effect";
import crypto from "node:crypto";
import path from "node:path";
import { tmpdir } from "os";
import { FFmpegCommandsService } from "./ffmpeg-commands";
import { VideoEditorLoggerService } from "./video-editor-logger-service";
import { clipFrameFfmpegArgs, type ClipFrame } from "@/packages/clip-source";
import { StillGate } from "./still-gate";
import { assertUnderEffect } from "./assert-under";

export type PauseType = "none" | "long";

export class VideoProcessingService extends Effect.Service<VideoProcessingService>()(
  "VideoProcessingService",
  {
    effect: Effect.gen(function* () {
      const effectFs = yield* FileSystem.FileSystem;
      const ffmpegCommands = yield* FFmpegCommandsService;

      /**
       * Renders a still to a cached PNG. An OBS Clip's frame is cached under
       * its file and time as it always was; a composite under the whole frame.
       * `gated: false` skips the Still Gate (the last-frame overlay, below).
       */
      const renderStill = Effect.fn("renderStill")(function* (
        frame: ClipFrame,
        cacheKeyPrefix: string,
        { gated }: { gated: boolean }
      ) {
        const seek = frame.time.toFixed(2);
        const inputHash = crypto
          .createHash("sha256")
          .update(
            cacheKeyPrefix +
              (frame.kind === "footage"
                ? frame.inputVideo + seek
                : JSON.stringify({ ...frame, time: seek }))
          )
          .digest("hex")
          .slice(0, 10);

        const folder = path.join(tmpdir(), "tt-cli-images");
        yield* effectFs.makeDirectory(folder, { recursive: true });

        const outputFile = path.join(folder, `${inputHash}.png`);

        if (yield* effectFs.exists(outputFile)) return outputFile;

        // Written under a name of its own and renamed once whole: a decode
        // the Still Gate stops at Record leaves no half-written PNG cached.
        const partial = yield* assertUnderEffect(
          folder,
          path.join(folder, `${inputHash}.${crypto.randomUUID()}.partial.png`)
        );
        const cached = yield* assertUnderEffect(folder, outputFile);
        const decode = Effect.gen(function* () {
          // Another request may have made it while this one waited.
          if (yield* effectFs.exists(outputFile)) return;
          yield* ffmpegCommands.runStill(
            [
              ...clipFrameFfmpegArgs(frame, { seek }),
              "-frames:v",
              "1",
              partial,
            ],
            { lowPriority: true }
          );
          if (yield* effectFs.exists(partial))
            yield* effectFs.rename(partial, cached);
        }).pipe(Effect.ensuring(effectFs.remove(partial).pipe(Effect.ignore)));

        // Only the app server gates stills on the recorder (`still-gate.ts`).
        const gate = gated
          ? yield* Effect.serviceOption(StillGate)
          : Option.none();
        yield* Option.match(gate, {
          onNone: () => decode,
          onSome: ({ run }) => run(decode),
        });

        return outputFile;
      });

      // The last frame is NOT gated: the live preview overlays the previous
      // Take's last frame mid-session. #2214 held it until Stop for dropped
      // frames; Matt brought it back to see if they return (#2294).
      const getLastFrame = (frame: ClipFrame) =>
        renderStill(frame, "", { gated: false });

      const getFirstFrame = (frame: ClipFrame) =>
        renderStill(frame, "first-", { gated: true });

      return {
        /**
         * The container duration of a finished file, in seconds.
         *
         * The export step needs this for a file it did not just render — the
         * export it finds already on disk and would otherwise skip. It has to
         * come through this service rather than from ffprobe directly, because
         * this is the seam a Publish test replaces.
         */
        getVideoDurationInSeconds: ffmpegCommands.getVideoDurationInSeconds,
        getLastFrame,
        getFirstFrame,
      };
    }),
    dependencies: [
      NodeContext.layer,
      FFmpegCommandsService.Default,
      VideoEditorLoggerService.Default,
    ],
  }
) {}
