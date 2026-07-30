import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { NodeContext } from "@effect/platform-node";
import { findSilenceInVideo } from "./silence-detection";
import type { FFmpegCommandsService } from "./ffmpeg-commands";

/**
 * Builds a mock FFmpegCommandsService that returns predetermined output.
 * Only `getFPS` and `detectSilence` are used by `findSilenceInVideo`.
 */
function mockFFmpeg(opts: {
  fps: number;
  silenceOutput: string;
}): FFmpegCommandsService {
  return {
    getFPS: () => Effect.succeed(opts.fps),
    detectSilence: () => Effect.succeed(opts.silenceOutput),
  } as unknown as FFmpegCommandsService;
}

/**
 * Silence detect output with two silence periods → one speaking clip between them.
 * Speaking segment: silence ends at 2.0s, next silence starts at 5.0s → clip 2.0–5.0
 */
const SILENCE_OUTPUT_TWO_PERIODS = [
  "[silencedetect @ 0x1] silence_start: 0",
  "[silencedetect @ 0x1] silence_end: 2.0 | silence_duration: 2.0",
  "[silencedetect @ 0x1] silence_start: 5.0",
  "[silencedetect @ 0x1] silence_end: 6.0 | silence_duration: 1.0",
].join("\n");

/**
 * Real, verbatim ffmpeg output from /mnt/d/raw-footage/2026-07-30_09-54-33.mkv
 * (60fps, 26.27s) at the CVM's production settings (-38dB, d=0.8).
 *
 * Note the negative `silence_start` on the first period: ffmpeg reports a
 * slightly-below-zero start whenever a file begins in silence, which every OBS
 * recording does. The two speaking gaps are 3.411–5.839 and 19.395–22.327.
 */
const SILENCE_OUTPUT_NEGATIVE_FIRST_START = [
  "[silencedetect @ 0x5dcf256ab0c0] silence_start: -0.000166667",
  "[silencedetect @ 0x5dcf256ab0c0] silence_end: 3.41098 | silence_duration: 3.41115",
  "[silencedetect @ 0x5dcf256ab0c0] silence_start: 5.83929",
  "[silencedetect @ 0x5dcf256ab0c0] silence_end: 19.3949 | silence_duration: 13.5556",
  "[silencedetect @ 0x5dcf256ab0c0] silence_start: 22.327",
  "[silencedetect @ 0x5dcf256ab0c0] silence_end: 26.2398 | silence_duration: 3.91283",
].join("\n");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = <A>(effect: Effect.Effect<A, any, any>): Promise<A> =>
  Effect.runPromise(
    effect.pipe(Effect.provide(NodeContext.layer)) as Effect.Effect<A>
  );

describe("findSilenceInVideo", () => {
  it("returns clips without offset when startTime is not provided", async () => {
    const ffmpeg = mockFFmpeg({
      fps: 30,
      silenceOutput: SILENCE_OUTPUT_TWO_PERIODS,
    });

    const result = await run(findSilenceInVideo(ffmpeg, "/test/video.mkv"));

    expect(result.clips).toHaveLength(1);
    const clip = result.clips[0]!;
    // At 30fps: startFrame = round(2.0 * 30) - 0 = 60, startTime = 60/30 = 2.0
    // endFrame = round(5.0 * 30) + round(0.08 * 30) = 150 + 2 = 152, endTime = 152/30 ≈ 5.07
    expect(clip.startTime).toBeCloseTo(2.0, 1);
    expect(clip.endTime).toBeCloseTo(5.07, 1);
  });

  it("adjusts clip timestamps by startTime offset", async () => {
    const ffmpeg = mockFFmpeg({
      fps: 30,
      silenceOutput: SILENCE_OUTPUT_TWO_PERIODS,
    });

    const startTimeOffset = 99;
    const result = await run(
      findSilenceInVideo(ffmpeg, "/test/video.mkv", {
        startTime: startTimeOffset,
      })
    );

    expect(result.clips).toHaveLength(1);
    const clip = result.clips[0]!;
    // Same as above but offset by 99s
    expect(clip.startTime).toBeCloseTo(2.0 + startTimeOffset, 1);
    expect(clip.endTime).toBeCloseTo(5.07 + startTimeOffset, 0);
  });

  it("does not adjust timestamps when startTime is 0", async () => {
    const ffmpeg = mockFFmpeg({
      fps: 30,
      silenceOutput: SILENCE_OUTPUT_TWO_PERIODS,
    });

    const result = await run(
      findSilenceInVideo(ffmpeg, "/test/video.mkv", { startTime: 0 })
    );

    expect(result.clips).toHaveLength(1);
    const clip = result.clips[0]!;
    expect(clip.startTime).toBeCloseTo(2.0, 1);
    expect(clip.endTime).toBeCloseTo(5.07, 1);
  });

  it("keeps the first clip when ffmpeg reports a negative first silence_start", async () => {
    const ffmpeg = mockFFmpeg({
      fps: 60,
      silenceOutput: SILENCE_OUTPUT_NEGATIVE_FIRST_START,
    });

    const result = await run(findSilenceInVideo(ffmpeg, "/test/video.mkv"));

    expect(result.clips).toHaveLength(2);
    // The take that used to be swallowed by the dropped first silence period
    expect(result.clips[0]!.startTime).toBeCloseTo(3.41, 1);
    expect(result.clips[0]!.endTime).toBeCloseTo(5.92, 1);
    expect(result.clips[1]!.startTime).toBeCloseTo(19.4, 1);
    expect(result.clips[1]!.endTime).toBeCloseTo(22.41, 1);
  });
});
