import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NodeContext } from "@effect/platform-node";
import { Effect, Either, Layer } from "effect";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findCutShortInput } from "./ffmpeg-error";
import { FFmpegEncodeService } from "./ffmpeg-encode-commands";
import { SidecarContextTest } from "./sidecar-context";
import { idleGpuGate } from "@/test-utils/idle-gpu-gate";

// What ffmpeg printed in the real failure (Publish Job 43bfe48a, Video
// "Solution", 104 Clips): the demuxer for input #40 ran out of memory, so that
// input simply ended — 2.9 s early — and ffmpeg still exited 0.
const DEMUX_OUT_OF_MEMORY_STDERR = [
  "Output #0, mp4, to '/tmp/video-processing/aaa129ab7652.mp4':",
  "[in#2/matroska,webm @ 0x602accbd1080] Error during demuxing: Cannot allocate memory",
  "[in#2/matroska,webm @ 0x602accbd1080] Error retrieving a packet from demuxer: Cannot allocate memory",
  "[mp4 @ 0x602b1065de40] Starting second pass: moving the moov atom to the beginning of the file",
  "[aac @ 0x602b1067af80] Qavg: 64733.820",
].join("\n");

describe("findCutShortInput", () => {
  it("finds the input whose demuxer gave up, and why", () => {
    expect(findCutShortInput(DEMUX_OUT_OF_MEMORY_STDERR)).toEqual({
      inputIndex: 2,
      reason: "Cannot allocate memory",
    });
  });

  it("finds nothing in a clean run, or in one that only concealed a bad frame", () => {
    expect(findCutShortInput("")).toBeNull();
    expect(
      findCutShortInput(
        "[h264 @ 0x564072496000] concealing 37 DC, 37 AC, 37 MV errors in P frame\n[in#1/matroska,webm @ 0x1] could not seek to position -0.023"
      )
    ).toBeNull();
  });
});

// A stand-in `ffmpeg` on PATH that does what the real one did: prints the
// demux failure and exits 0.
describe("the single-pass concat, when ffmpeg stops reading a Clip early but exits 0", () => {
  let dir: string;
  let originalPath: string | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ffmpeg-cut-short-"));
    fs.writeFileSync(path.join(dir, "stderr.txt"), DEMUX_OUT_OF_MEMORY_STDERR);
    fs.writeFileSync(
      path.join(dir, "ffmpeg"),
      `#!/bin/sh
cat "${dir}/stderr.txt" >&2
exit 0
`,
      { mode: 0o755 }
    );
    originalPath = process.env.PATH;
    process.env.PATH = `${dir}${path.delimiter}${originalPath ?? ""}`;
  });

  afterEach(() => {
    process.env.PATH = originalPath;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const clip = (inputVideo: string, startTime: number) => ({
    inputVideo,
    startTime,
    duration: 5,
    pauseType: "none" as const,
  });

  it("fails, naming the Clip and the Footage that input was", async () => {
    const result = await Effect.runPromise(
      Effect.flatMap(FFmpegEncodeService, (ffmpeg) =>
        ffmpeg.createAndConcatenateVideoClipsSinglePass(
          [
            clip("/footage/a.mkv", 0),
            clip("/footage/a.mkv", 10),
            clip("/footage/b.mkv", 91.4667),
            clip("/footage/c.mkv", 3),
          ],
          { width: 1920, height: 1080 },
          { onLog: () => {} }
        )
      ).pipe(
        Effect.either,
        Effect.provide(
          Layer.mergeAll(
            FFmpegEncodeService.Default.pipe(Layer.provide(idleGpuGate)),
            NodeContext.layer,
            SidecarContextTest
          )
        )
      )
    );

    expect(Either.isLeft(result)).toBe(true);
    const error = (result as Either.Left<any, unknown>).left;
    expect(error._tag).toBe("FfmpegInputCutShortError");
    expect(error.clipIndex).toBe(2);
    expect(error.inputPath).toBe("/footage/b.mkv");
    expect(error.reason).toBe("Cannot allocate memory");
    expect(error.message).toContain("input #2 (/footage/b.mkv)");
  });
});
