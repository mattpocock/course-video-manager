import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NodeContext } from "@effect/platform-node";
import { ConfigProvider, Effect, Layer, Logger } from "effect";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FFmpegEncodeService } from "./ffmpeg-encode-commands";
import { DEFAULT_ENCODE_PERMITS } from "./ffmpeg-permits";
import { SidecarContextTest } from "./sidecar-context";
import { idleGpuGate } from "@/test-utils/idle-gpu-gate";

// Publish Job 859b8689 ran six 100-input concats at once and the machine ran
// out of memory. The limit on heavy encodes is one per process, so it has to
// hold across Jobs, not just inside one: here two callers — a Publish-like
// fan-out of concats and a Short's subtitle burn-in fan-out — share one
// Sidecar layer.
describe("encode slots — one limit across the whole Sidecar", () => {
  let dir: string;
  let originalPath: string | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ffmpeg-encode-slots-"));
    // A stand-in `ffmpeg`: records when it starts and ends, and takes long
    // enough that every caller is waiting on it at once.
    fs.writeFileSync(
      path.join(dir, "ffmpeg"),
      `#!/bin/sh
echo start >> "${dir}/runs.txt"
sleep 0.3
echo end >> "${dir}/runs.txt"
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

  /** The most ffmpeg processes that were ever running at the same time. */
  const peakConcurrentRuns = () => {
    const events = fs
      .readFileSync(path.join(dir, "runs.txt"), "utf8")
      .trim()
      .split("\n");
    let running = 0;
    let peak = 0;
    for (const event of events) {
      running += event === "start" ? 1 : -1;
      peak = Math.max(peak, running);
    }
    return { peak, runs: events.filter((e) => e === "start").length };
  };

  const runTwoJobs = (env: Record<string, string>) => {
    const infos: string[] = [];
    const logger = Logger.make(({ logLevel, message }) => {
      if (logLevel._tag === "Info") infos.push(String([message].flat()[0]));
    });

    const program = Effect.gen(function* () {
      const ffmpeg = yield* FFmpegEncodeService;
      const clip = {
        inputVideo: "in.mkv",
        startTime: 0,
        duration: 1,
        pauseType: "none" as const,
      };
      // Caller one: a Publish's export loop, three Videos' concats at once.
      const publish = Effect.forEach(
        [1, 2, 3],
        () =>
          ffmpeg.createAndConcatenateVideoClipsSinglePass(
            [clip],
            { width: 1920, height: 1080 },
            { onLog: () => {} }
          ),
        { concurrency: "unbounded" }
      );
      // Caller two: another Job's subtitle burn-ins, three at once.
      const shorts = Effect.forEach(
        [1, 2, 3],
        (i) =>
          ffmpeg.compositeOverlay(
            "in.mp4",
            "subs.mov",
            path.join(dir, `short-${i}.mp4`),
            () => {}
          ),
        { concurrency: "unbounded" }
      );
      yield* Effect.all([publish, shorts], { concurrency: "unbounded" });
    });

    return Effect.runPromise(
      program.pipe(
        Effect.provide(
          Layer.mergeAll(
            FFmpegEncodeService.Default.pipe(Layer.provide(idleGpuGate)),
            NodeContext.layer,
            SidecarContextTest,
            Logger.replace(Logger.defaultLogger, logger)
          ).pipe(
            Layer.provide(
              Layer.setConfigProvider(
                ConfigProvider.fromMap(new Map(Object.entries(env)))
              )
            )
          )
        )
      )
    ).then(() => ({ infos, ...peakConcurrentRuns() }));
  };

  it("never runs more than the default number of encodes, whichever Job asks", async () => {
    const { peak, runs, infos } = await runTwoJobs({});

    expect(DEFAULT_ENCODE_PERMITS).toBe(2);
    expect(runs).toBe(6);
    expect(peak).toBe(DEFAULT_ENCODE_PERMITS);
    // Four of the six had to wait, and each said so — then said it got in.
    expect(
      infos.filter((m) => m.includes("encode slots are busy; waiting"))
    ).toHaveLength(4);
    expect(infos.filter((m) => m.includes("got an encode slot"))).toHaveLength(
      4
    );
  }, 20_000);

  it("holds a lowered limit too (a verify clone runs one at a time)", async () => {
    const { peak, runs } = await runTwoJobs({ FFMPEG_ENCODE_PERMITS: "1" });

    expect(runs).toBe(6);
    expect(peak).toBe(1);
  }, 20_000);
});
