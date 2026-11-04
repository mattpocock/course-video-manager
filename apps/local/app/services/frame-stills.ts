import crypto from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileSystem } from "@effect/platform";
import { Data, Effect } from "effect";
import { FFmpegError } from "./ffmpeg-error";
import { FFmpegCommandsService } from "./ffmpeg-commands";
import { StillGate } from "./still-gate";
import { assertUnderEffect } from "./assert-under";

/**
 * The frames an agent asks for to choose a Source Crop and check its work:
 * `cvm footage frame` (a raw Footage frame) and `cvm clip frame` (a Clip's
 * composed frame, `clip-frame.ts`). Each decodes raw footage, so each
 * runs through the {@link StillGate}: refused while anything records. The
 * PNGs go to a temp directory, a new file each time.
 */

/** A frame refused for its input: a `t` outside the source, a Video it cannot draw. */
export class FrameRefusedError extends Data.TaggedError("FrameRefusedError")<{
  readonly message: string;
}> {}

/** Where every frame PNG goes. */
export const FRAMES_DIRECTORY = path.join(tmpdir(), "cvm-frames");

/** A new PNG path in {@link FRAMES_DIRECTORY}, its directory made. */
export const newFramePath = (name: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(FRAMES_DIRECTORY, { recursive: true });
    const id = crypto.randomUUID().slice(0, 8);
    return yield* assertUnderEffect(
      FRAMES_DIRECTORY,
      path.join(FRAMES_DIRECTORY, `${name}-${id}.png`)
    );
  });

/** Refuses a `t` outside `[0, duration)`, naming what it is outside. */
export const requireTimeWithin = (at: number, duration: number, of: string) =>
  Number.isFinite(at) && at >= 0 && at < duration
    ? Effect.void
    : Effect.fail(
        new FrameRefusedError({
          message: `--at ${at} is outside the ${of}: it is ${duration.toFixed(3)}s long, so t must be at least 0 and under ${duration.toFixed(3)}`,
        })
      );

/** Runs ffmpeg for a still at the lowest priority; a non-zero exit fails. */
export const runFrameFfmpeg = (args: readonly string[], what: string) =>
  Effect.gen(function* () {
    const ffmpeg = yield* FFmpegCommandsService;
    const code = yield* ffmpeg.runStill(args, { lowPriority: true }).pipe(
      Effect.mapError(
        (cause) =>
          new FFmpegError({
            cause,
            message: `Failed to draw ${what}: ${cause.message}`,
          })
      )
    );
    if (code !== 0) {
      return yield* new FFmpegError({
        cause: null,
        message: `Failed to draw ${what}: ffmpeg exited with code ${code}`,
      });
    }
  });

/**
 * The raw frame of the Footage file at `file` at `at` seconds, at its own
 * size, as a PNG: the frame showing at `at` (B-roll's timing rule: the
 * latest frame at or before it).
 */
export const footageFrame = (file: string, at: number) =>
  Effect.gen(function* () {
    const gate = yield* StillGate;
    const ffmpeg = yield* FFmpegCommandsService;
    // The probe reads the file too: it waits behind the gate with the decode.
    return yield* gate.run(
      Effect.gen(function* () {
        const duration = yield* ffmpeg.getVideoDurationInSeconds(file);
        if (!Number.isFinite(duration)) {
          return yield* new FrameRefusedError({
            message: `${file} has no duration ffprobe can read: it is not a video file`,
          });
        }
        yield* requireTimeWithin(at, duration, "Footage");
        const output = yield* newFramePath("footage");
        yield* runFrameFfmpeg(
          [
            "-y",
            "-hide_banner",
            "-v",
            "error",
            "-ss",
            String(at),
            "-i",
            file,
            "-frames:v",
            "1",
            output,
          ],
          `the frame at ${at}s of ${file}`
        );
        return output;
      })
    );
  });
