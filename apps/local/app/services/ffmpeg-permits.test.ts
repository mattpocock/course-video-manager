import { NodeContext } from "@effect/platform-node";
import { ConfigProvider, Deferred, Effect, Layer } from "effect";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FFmpegEncodeService } from "./ffmpeg-encode-commands";
import {
  DEFAULT_CPU_PERMITS,
  DEFAULT_ENCODE_PERMITS,
  FfmpegPermitsService,
} from "./ffmpeg-permits";
import { SidecarContextTest } from "./sidecar-context";

const readPermits = (env: Record<string, string>) =>
  Effect.runPromise(
    FfmpegPermitsService.pipe(
      Effect.map(({ encodePermits, cpuPermits }) => ({
        encodePermits,
        cpuPermits,
      })),
      Effect.provide(
        FfmpegPermitsService.Default.pipe(
          Layer.provide(
            Layer.setConfigProvider(
              ConfigProvider.fromMap(new Map(Object.entries(env)))
            )
          )
        )
      )
    )
  );

describe("FfmpegPermitsService", () => {
  it("keeps 2 encode slots and 12 CPU permits when nothing is set", async () => {
    expect(await readPermits({})).toEqual({
      encodePermits: DEFAULT_ENCODE_PERMITS,
      cpuPermits: DEFAULT_CPU_PERMITS,
    });
  });

  it("lowers both to what a verify clone run sets", async () => {
    expect(
      await readPermits({ FFMPEG_ENCODE_PERMITS: "1", FFMPEG_CPU_PERMITS: "1" })
    ).toEqual({ encodePermits: 1, cpuPermits: 1 });
  });

  it("refuses zero rather than deadlocking every encode", async () => {
    await expect(readPermits({ FFMPEG_ENCODE_PERMITS: "0" })).rejects.toThrow(
      /FFMPEG_ENCODE_PERMITS must be at least 1/
    );
  });
});

// A stand-in `ffmpeg`/`ffprobe` on PATH: ffprobe reports a 10 s stream,
// ffmpeg records its args and succeeds. No real media is touched.
describe("the audio normalize and the encode slots", () => {
  let dir: string;
  let originalPath: string | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ffmpeg-permits-"));
    fs.writeFileSync(path.join(dir, "ffprobe"), "#!/bin/sh\necho 10\n", {
      mode: 0o755,
    });
    fs.writeFileSync(
      path.join(dir, "ffmpeg"),
      `#!/bin/sh\necho "$*" >> "${dir}/runs.txt"\nexit 0\n`,
      { mode: 0o755 }
    );
    originalPath = process.env.PATH;
    process.env.PATH = `${dir}${path.delimiter}${originalPath ?? ""}`;
    // normalizeAudio writes under os.tmpdir(); keep it in the test dir.
    vi.stubEnv("TMPDIR", dir);
  });

  afterEach(() => {
    process.env.PATH = originalPath;
    vi.unstubAllEnvs();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("runs while every encode slot is busy", async () => {
    const program = Effect.gen(function* () {
      const { withEncodeSlot } = yield* FfmpegPermitsService;
      const slotTaken = yield* Deferred.make<void>();
      // An encode that holds the only slot for as long as the test runs.
      yield* Effect.forkScoped(
        withEncodeSlot("Failed to create concatenated video")(
          Deferred.succeed(slotTaken, undefined).pipe(
            Effect.andThen(Effect.never)
          )
        )
      );
      yield* Deferred.await(slotTaken);

      const ffmpeg = yield* FFmpegEncodeService;
      return yield* ffmpeg
        .normalizeAudio("in.mp4", { onLog: () => {} })
        .pipe(Effect.timeout("2 seconds"));
    });

    const output = await Effect.runPromise(
      program.pipe(
        Effect.scoped,
        Effect.provide(
          FFmpegEncodeService.DefaultWithoutDependencies.pipe(
            Layer.provideMerge(
              Layer.mergeAll(
                FfmpegPermitsService.Default,
                NodeContext.layer,
                SidecarContextTest
              )
            ),
            Layer.provide(
              Layer.setConfigProvider(
                ConfigProvider.fromMap(
                  new Map([["FFMPEG_ENCODE_PERMITS", "1"]])
                )
              )
            )
          )
        )
      )
    );

    expect(output.startsWith(dir)).toBe(true);
    expect(fs.readFileSync(path.join(dir, "runs.txt"), "utf8")).toContain(
      "loudnorm"
    );
  });
});
