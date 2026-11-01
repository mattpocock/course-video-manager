import { NodeContext } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { clipFrame, clipSource } from "@/packages/clip-source";
import { FFmpegCommandsService } from "./ffmpeg-commands";

/**
 * A screenshot of a CVM-recorder Clip — two inputs, both decoded on the GPU —
 * with the real ffmpeg, from tiny lavfi stand-ins (no device). Then the same
 * with the GPU hidden from CUDA, which is what a machine without one looks
 * like: the still must come out all the same, decoded on the CPU.
 */
const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasFfmpeg)("a screenshot, decoded on the GPU", () => {
  const dir = path.join(tmpdir(), `ffmpeg-stills-${process.pid}-${Date.now()}`);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const screen = path.join(dir, "screen.mkv");
  const camera = path.join(dir, "camera.mkv");
  beforeAll(() => {
    mkdirSync(dir, { recursive: true });
    for (const [out, lavfi] of [
      [screen, "color=c=red:s=320x180:r=60:d=2"],
      [camera, "color=c=lime:s=384x216:r=30000/1001:d=2"],
    ] as const) {
      execFileSync("ffmpeg", [
        "-hide_banner",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        lavfi,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        out,
      ]);
    }
  });

  const frame = (opts?: Parameters<typeof clipFrame>[2]) =>
    clipFrame(
      clipSource({
        videoFilename: path.join(dir, "mic.mkv"),
        sourceStartTime: 0.5,
        sourceEndTime: 1.8,
        recordingSession: {
          id: "session-1",
          cameraFilePath: camera,
          screenFilePath: screen,
          micFilePath: path.join(dir, "mic.mkv"),
          micOffsetMs: 150,
          format: "landscape" as const,
          screenCaptured: true,
          sceneEvents: [],
        },
      }),
      "first",
      opts
    );

  const capture = (
    name: string,
    opts?: Parameters<typeof clipFrame>[2] | { footage: string }
  ) => {
    const out = path.join(dir, name);
    const still =
      opts && "footage" in opts
        ? { kind: "footage" as const, inputVideo: opts.footage, time: 0.5 }
        : frame(opts);
    return Effect.runPromise(
      Effect.flatMap(FFmpegCommandsService, (ffmpeg) =>
        ffmpeg.captureFrameAtTime(still, out)
      ).pipe(
        Effect.provide(
          Layer.mergeAll(FFmpegCommandsService.Default, NodeContext.layer)
        )
      )
    ).then(() => {
      expect(existsSync(out)).toBe(true);
      return execFileSync("ffprobe", [
        "-v",
        "error",
        "-show_entries",
        "stream=width,height",
        "-of",
        "csv=p=0",
        out,
      ])
        .toString()
        .trim();
    });
  };

  it("captures a With-face frame at the composite's full 1920x1080, never scaled down", async () => {
    expect(await capture("gpu.png")).toBe("1920,1080");
  });

  it("captures an OBS Clip's frame at its Footage's native size", async () => {
    expect(await capture("footage.png", { footage: camera })).toBe("384,216");
  });

  it("captures a No-face frame as the screen alone, at its native size", async () => {
    expect(await capture("no-face.png", { screenOnly: true })).toBe("320,180");
  });

  it("captures a Diagram frame as the Diagram Frame of the screen, at its native size", async () => {
    const crop = { x: 0.25, y: 0.5, w: 0.5, h: 0.5 };
    expect(await capture("diagram.png", { screenOnly: true, crop })).toBe(
      "160,90"
    );
  });

  describe("with no usable GPU", () => {
    beforeAll(() => {
      vi.stubEnv("CUDA_VISIBLE_DEVICES", "-1");
    });
    afterAll(() => {
      vi.unstubAllEnvs();
    });

    it("captures it all the same, on the CPU", async () => {
      expect(await capture("cpu.png")).toBe("1920,1080");
    });
  });
});
