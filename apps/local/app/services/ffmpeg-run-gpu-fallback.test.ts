import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NodeContext } from "@effect/platform-node";
import { Duration, Effect, Layer, Logger } from "effect";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  BITEXACT_ARGS,
  CLAP_PREVIEW_CPU_FALLBACK_ENCODE_ARGS,
  CLAP_PREVIEW_ENCODE_ARGS,
  GPU_DECODE_ARGS,
  LANDSCAPE_VIDEO_CPU_FALLBACK_ENCODE_ARGS,
  LANDSCAPE_VIDEO_ENCODE_ARGS,
  SHORTS_BURN_IN_CPU_FALLBACK_ENCODE_ARGS,
  SHORTS_BURN_IN_ENCODE_ARGS,
  classifyGpuFailure,
  cpuFallbackArgs,
  withGpuDecode,
} from "./ffmpeg-error";
import { FFmpegEncodeService } from "./ffmpeg-encode-commands";
import { NvencSessionWaits, runFfmpegWithProgress } from "./ffmpeg-run";
import { FfmpegPermitsService } from "./ffmpeg-permits";
import { SidecarContextTest } from "./sidecar-context";

// What ffmpeg printed in the real failure (Publish Job 859b8689): the CUDA
// context would not come up, so NVENC could not open at all.
const CUDA_UNAVAILABLE_STDERR = [
  "[matroska,webm @ 0x5b9342f6c600] Read error at pos. 13112062 (0xc812fe)",
  "[h264_nvenc @ 0x5b9380c58280] dl_fn->cuda_dl->cuCtxCreate(&ctx->cu_context_internal, 0, cu_device) failed -> CUDA_ERROR_UNKNOWN: unknown error",
  "[h264_nvenc @ 0x5b9380c58280] No capable devices found",
  "[vost#0:0/h264_nvenc @ 0x5b9380c57e80] Error while opening encoder - maybe incorrect parameters such as bit_rate, rate, width or height.",
  "Conversion failed!",
].join("\n");

// What h264_nvenc prints when the GPU is fine but every encoder session the
// driver allows is taken (OBS, the recorder, another encode): CUDA came up,
// the session did not. Note the same "No capable devices found" line.
const NVENC_SESSIONS_EXHAUSTED_STDERR = [
  "[h264_nvenc @ 0x55d1c2a8e2c0] OpenEncodeSessionEx failed: out of memory (10): (no details)",
  "[h264_nvenc @ 0x55d1c2a8e2c0] No capable devices found",
  "[vost#0:0/h264_nvenc @ 0x55d1c2a8dd40] Error while opening encoder - maybe incorrect parameters such as bit_rate, rate, width or height.",
  "Conversion failed!",
].join("\n");

const landscapePass = (output: string) => [
  "-y",
  "-i",
  "in.mkv",
  ...LANDSCAPE_VIDEO_ENCODE_ARGS,
  "-c:a",
  "aac",
  ...BITEXACT_ARGS,
  output,
];

describe("classifyGpuFailure", () => {
  it("tells a GPU that cannot open from one that is out of NVENC sessions", () => {
    expect(classifyGpuFailure(CUDA_UNAVAILABLE_STDERR)).toBe("no-usable-gpu");
    expect(classifyGpuFailure(NVENC_SESSIONS_EXHAUSTED_STDERR)).toBe(
      "nvenc-sessions-exhausted"
    );
    // Older drivers report the session limit as a client-key error.
    expect(
      classifyGpuFailure(
        "[h264_nvenc @ 0x1] OpenEncodeSessionEx failed: incompatible client key (21): (no details)\n[h264_nvenc @ 0x1] No capable devices found"
      )
    ).toBe("nvenc-sessions-exhausted");
    // A GPU that cannot encode at all is not "busy".
    expect(
      classifyGpuFailure(
        "[h264_nvenc @ 0x1] OpenEncodeSessionEx failed: unsupported device (2): (no details)\n[h264_nvenc @ 0x1] No capable devices found"
      )
    ).toBe("no-usable-gpu");
    expect(classifyGpuFailure("in.mkv: No such file or directory")).toBeNull();
  });
});

describe("cpuFallbackArgs", () => {
  it("does not move a pass to the CPU when NVENC is only out of sessions", () => {
    expect(
      cpuFallbackArgs(landscapePass("out.mp4"), NVENC_SESSIONS_EXHAUSTED_STDERR)
    ).toBeNull();
  });

  it("swaps only the encoder block for libx264 when NVENC could not open", () => {
    const args = landscapePass("out.mp4");
    expect(cpuFallbackArgs(args, CUDA_UNAVAILABLE_STDERR)).toEqual([
      "-y",
      "-i",
      "in.mkv",
      ...LANDSCAPE_VIDEO_CPU_FALLBACK_ENCODE_ARGS,
      "-c:a",
      "aac",
      ...BITEXACT_ARGS,
      "out.mp4",
    ]);
  });

  it("does not fall back for a failure that is not the GPU", () => {
    expect(
      cpuFallbackArgs(
        landscapePass("out.mp4"),
        "in.mkv: No such file or directory"
      )
    ).toBeNull();
  });

  it("does not touch a pass that never asked for the GPU", () => {
    expect(
      cpuFallbackArgs(
        ["-i", "in.mkv", "-c:v", "libx264", "out.mp4"],
        CUDA_UNAVAILABLE_STDERR
      )
    ).toBeNull();
  });

  // What ffmpeg 6.1 prints when `-hwaccel cuda` finds no device.
  const NVDEC_UNAVAILABLE_STDERR = [
    "[AVHWDeviceContext @ 0x5a306ed94600] cu->cuInit(0) failed -> CUDA_ERROR_NO_DEVICE: no CUDA-capable device is detected",
    "Device creation failed: -542398533.",
    "[vist#0:0/h264 @ 0x5a306ecdf600] Hardware device setup failed for decoder: Generic error in an external library",
  ].join("\n");

  it("drops the GPU decode from every input of a still", () => {
    const args = withGpuDecode([
      "-ss",
      "1",
      "-i",
      "screen.mkv",
      "-ss",
      "1",
      "-i",
      "camera.mkv",
      "-frames:v",
      "1",
      "out.png",
    ]);
    expect(args.filter((a) => a === "-hwaccel")).toHaveLength(2);
    expect(cpuFallbackArgs(args, NVDEC_UNAVAILABLE_STDERR)).toEqual([
      "-ss",
      "1",
      "-i",
      "screen.mkv",
      "-ss",
      "1",
      "-i",
      "camera.mkv",
      "-frames:v",
      "1",
      "out.png",
    ]);
  });

  it("runs a Short's burn-in as the libx264 CRF 18 it was, decoding on the CPU", () => {
    const args = [
      ...GPU_DECODE_ARGS,
      "-i",
      "in.mp4",
      "-i",
      "subs.mov",
      ...SHORTS_BURN_IN_ENCODE_ARGS,
      "out.mp4",
    ];
    expect(cpuFallbackArgs(args, NVDEC_UNAVAILABLE_STDERR)).toEqual([
      "-i",
      "in.mp4",
      "-i",
      "subs.mov",
      "-c:v",
      "libx264",
      "-preset",
      "slow",
      "-crf",
      "18",
      "out.mp4",
    ]);
    expect(SHORTS_BURN_IN_CPU_FALLBACK_ENCODE_ARGS).toEqual([
      "-c:v",
      "libx264",
      "-preset",
      "slow",
      "-crf",
      "18",
    ]);
  });

  it("runs the clap step's Play clip on libx264 ultrafast", () => {
    expect(
      cpuFallbackArgs(
        [
          ...GPU_DECODE_ARGS,
          "-i",
          "camera.mkv",
          ...CLAP_PREVIEW_ENCODE_ARGS,
          "-",
        ],
        CUDA_UNAVAILABLE_STDERR
      )
    ).toEqual([
      "-i",
      "camera.mkv",
      ...CLAP_PREVIEW_CPU_FALLBACK_ENCODE_ARGS,
      "-",
    ]);
  });
});

// A stand-in `ffmpeg` on PATH: any run that asks for h264_nvenc fails exactly
// as the GPU-less machine did; any other run records its args and succeeds.
describe("runFfmpegWithProgress — GPU fallback", () => {
  let dir: string;
  let originalPath: string | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ffmpeg-gpu-fallback-"));
    fs.writeFileSync(
      path.join(dir, "nvenc-stderr.txt"),
      CUDA_UNAVAILABLE_STDERR
    );
    fs.writeFileSync(
      path.join(dir, "ffmpeg"),
      `#!/bin/sh
echo "$*" >> "${dir}/runs.txt"
case " $* " in
  *" h264_nvenc "*) cat "${dir}/nvenc-stderr.txt" >&2; exit 187 ;;
esac
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

  const run = (
    args: string[],
    waits: readonly Duration.DurationInput[] = [
      "10 millis",
      "10 millis",
      "10 millis",
    ]
  ) => {
    const warnings: string[] = [];
    const logs: string[][] = [];
    const logger = Logger.make(({ logLevel, message }) => {
      if (logLevel._tag === "Warning")
        warnings.push(String([message].flat()[0]));
    });
    return Effect.runPromise(
      runFfmpegWithProgress({
        args,
        totalDurationSeconds: 1,
        onProgress: undefined,
        onLog: (info) => logs.push(info.command),
        errorPrefix: "Failed to create concatenated video",
        permit: "encode-slot",
      }).pipe(
        Effect.either,
        Effect.provideService(NvencSessionWaits, waits),
        Effect.provide(
          Layer.mergeAll(
            NodeContext.layer,
            SidecarContextTest,
            FfmpegPermitsService.Default,
            Logger.replace(Logger.defaultLogger, logger)
          )
        )
      )
    ).then((result) => ({ result, warnings, logs }));
  };

  const runs = () =>
    fs.readFileSync(path.join(dir, "runs.txt"), "utf8").trim().split("\n");

  it("re-runs a landscape pass on libx264 when h264_nvenc cannot open, and warns", async () => {
    const { result, warnings, logs } = await run(landscapePass("out.mp4"));

    expect(result._tag).toBe("Right");
    expect(runs()).toHaveLength(2);
    expect(runs()[0]).toContain("h264_nvenc");
    expect(runs()[1]).toContain("-c:v libx264 -preset medium -crf 18");
    expect(runs()[1]).not.toContain("h264_nvenc");
    expect(runs()[1]).toContain("out.mp4");
    expect(warnings).toEqual([
      expect.stringContaining("the GPU could not open"),
    ]);
    // Both commands reach the per-video log, so it shows what really ran.
    expect(logs).toHaveLength(2);
  });

  it("re-runs a Short's burn-in on libx264 CRF 18, decoding on the CPU", async () => {
    const result = await Effect.runPromise(
      Effect.flatMap(FFmpegEncodeService, (ffmpeg) =>
        ffmpeg.compositeOverlay(
          "in.mp4",
          "subs.mov",
          path.join(dir, "short.mp4"),
          () => {}
        )
      ).pipe(
        Effect.either,
        Effect.provide(
          Layer.mergeAll(
            FFmpegEncodeService.Default,
            NodeContext.layer,
            SidecarContextTest
          )
        )
      )
    );

    expect(result._tag).toBe("Right");
    expect(runs()).toHaveLength(2);
    expect(runs()[0]).toContain("-hwaccel cuda -i in.mp4");
    expect(runs()[0]).toContain("-c:v h264_nvenc -preset p7");
    expect(runs()[1]).toContain(
      "-i in.mp4 -i subs.mov -filter_complex [0:v][1:v]overlay=0:0:format=auto[outv]"
    );
    expect(runs()[1]).toContain("-c:v libx264 -preset slow -crf 18");
    expect(runs()[1]).not.toContain("-hwaccel");
    expect(runs()[1]).not.toContain("h264_nvenc");
  });

  it("fails without a fallback when the failure is not the GPU", async () => {
    fs.writeFileSync(
      path.join(dir, "ffmpeg"),
      `#!/bin/sh
echo "$*" >> "${dir}/runs.txt"
echo "in.mkv: No such file or directory" >&2
exit 1
`,
      { mode: 0o755 }
    );
    const { result, warnings } = await run(landscapePass("out.mp4"));

    expect(result._tag).toBe("Left");
    expect(runs()).toHaveLength(1);
    expect(warnings).toEqual([]);
  });

  // A stand-in whose NVENC runs are refused for want of a session the first
  // `busyRuns` times, then succeed.
  const busyGpu = (busyRuns: number) => {
    fs.writeFileSync(
      path.join(dir, "busy-stderr.txt"),
      NVENC_SESSIONS_EXHAUSTED_STDERR
    );
    fs.writeFileSync(path.join(dir, "busy-left"), String(busyRuns));
    fs.writeFileSync(
      path.join(dir, "ffmpeg"),
      `#!/bin/sh
echo "$*" >> "${dir}/runs.txt"
case " $* " in
  *" h264_nvenc "*)
    left=$(cat "${dir}/busy-left")
    if [ "$left" -gt 0 ]; then
      echo $((left - 1)) > "${dir}/busy-left"
      cat "${dir}/busy-stderr.txt" >&2
      exit 187
    fi ;;
esac
exit 0
`,
      { mode: 0o755 }
    );
  };

  it("waits and tries NVENC again when it is out of sessions, logging each wait", async () => {
    busyGpu(2);
    const { result, warnings, logs } = await run(landscapePass("out.mp4"));

    expect(result._tag).toBe("Right");
    expect(runs()).toHaveLength(3);
    for (const line of runs()) {
      expect(line).toContain("-c:v h264_nvenc");
      expect(line).not.toContain("libx264");
    }
    expect(warnings).toEqual([
      expect.stringContaining("NVENC has no free encoder session"),
      expect.stringContaining("NVENC has no free encoder session"),
    ]);
    expect(warnings[0]).toContain("(1 of 3)");
    expect(logs).toHaveLength(3);
  });

  it("fails clearly, never on the CPU, when NVENC is still busy after the last wait", async () => {
    busyGpu(99);
    const { result, warnings } = await run(landscapePass("out.mp4"), [
      "10 millis",
      "20 millis",
    ]);

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left.message).toContain(
        "NVENC still had no free encoder session after waiting 30ms (2 retries)"
      );
      expect(result.left.message).toContain("was not moved to the CPU");
    }
    expect(runs()).toHaveLength(3);
    expect(runs().join("\n")).not.toContain("libx264");
    expect(warnings).toHaveLength(2);
  });
});
