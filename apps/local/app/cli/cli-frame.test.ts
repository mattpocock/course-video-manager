import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ConfigProvider, Effect, Layer } from "effect";
import { NodeContext } from "@effect/platform-node";
import { truncateAllTables } from "@/test-utils/test-db";
import * as schema from "@/db/schema";
import { DrizzleService } from "@/services/drizzle-service.server";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { FFmpegCommandsService } from "@/services/ffmpeg-commands";
import { FFmpegEncodeService } from "@/services/ffmpeg-encode-commands";
import { VideoEditorLoggerService } from "@/services/video-editor-logger-service";
import { RenderVerticalVideoService } from "@/services/render-vertical-video-service";
import { SidecarContextTest } from "@/services/sidecar-context";
import { one } from "./cli-write-test-harness";
import {
  ctx,
  setupFrameTests,
  hasFfmpeg,
  recorder,
  fixture,
  footage,
  sizeOf,
  pixel,
  near,
  fakeOverlayRenderer,
  RED,
  BLUE,
  YELLOW,
  MAGENTA,
} from "@/test-utils/cli-frame-harness";

// cvm footage frame and cvm clip frame on a Short. The harness
// (`test-utils/cli-frame-harness.ts`): the real ffmpeg on lavfi fixtures, a fake
// recorder `/health` for the Still Gate, a fake overlay renderer.

setupFrameTests();

describe.skipIf(!hasFfmpeg)("cvm footage frame", () => {
  it("prints a PNG of the raw frame at t, at the Footage's own size", async () => {
    const source = fixture("two.mp4", ["red", "blue"]);

    const result = await ctx.run(["footage", "frame", "--at", "1.5", source]);

    expect(result.exitCode).toBe(0);
    const { path } = one<{ path: string }>(result.stdout);
    expect(path.startsWith(tmpdir())).toBe(true);
    expect(sizeOf(path)).toEqual({ width: 320, height: 240 });
    expect(near(pixel(path, 160, 120), BLUE)).toBe(true);
    const early = one<{ path: string }>(
      (await ctx.run(["footage", "frame", "--at", "0.5", source])).stdout
    );
    expect(near(pixel(early.path, 160, 120), RED)).toBe(true);
  });

  it("is refused while the recorder records, and again works after the Stop", async () => {
    const source = fixture("held.mp4", ["red"]);
    recorder.recording = true;

    const held = await ctx.run(["footage", "frame", "--at", "0.5", source]);

    expect(held.exitCode).toBe(3);
    expect(JSON.parse(held.stderr)).toMatchObject({
      _tag: "StillHeldError",
      message: "No still while recording: ask again after the Stop",
    });
    expect(held.stdout).toBe("");
    recorder.recording = false;
    expect(
      (await ctx.run(["footage", "frame", "--at", "0.5", source])).exitCode
    ).toBe(0);
  });

  it.each([["-0.1"], ["1"], ["5"]])(
    "refuses a t of %s, outside the one-second Footage",
    async (at) => {
      const source = fixture("short.mp4", ["red"]);

      const result = await ctx.run(["footage", "frame", "--at", at, source]);

      expect(result.exitCode).toBe(3);
      expect(JSON.parse(result.stderr)._tag).toBe("FrameRefusedError");
    }
  );
});

// ---------------------------------------------------------------------------
// cvm clip frame
// ---------------------------------------------------------------------------

/**
 * A Short of two Clips cut from one yellow file: the first untouched, the
 * second drawn from Footage Layers only — the left (red) half of a red and
 * green file as a square on top, a blue file as the band below — with a
 * Chat Card 0.2 s to 0.8 s into it.
 */
const seedShort = async () => {
  const base = footage("base.mp4", "yellow");
  const top = footage("top.mp4", "red");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-i",
    join(ctx.root, top),
    "-vf",
    "drawbox=x=320:y=0:w=320:h=360:color=lime:t=fill",
    "-c:a",
    "copy",
    join(ctx.root, "raw-footage/imported/halves.mp4"),
  ]);
  const face = footage("face.mp4", "blue");
  const [video] = await ctx.testDb
    .insert(schema.videos)
    .values({ title: "Short", originalFootagePath: base, format: "short" })
    .returning();
  const clip = async (order: string, start: number) => {
    const [row] = await ctx.testDb
      .insert(schema.clips)
      .values({
        videoId: video!.id,
        videoFilename: base,
        sourceStartTime: start,
        sourceEndTime: start + 1,
        order,
        text: "hello there",
      })
      .returning();
    return row!.id;
  };
  const first = await clip("a0", 0);
  const second = await clip("a1", 1);
  for (const argv of [
    [
      "--footage",
      "raw-footage/imported/halves.mp4",
      "--crop",
      "0,0,0.5,1",
      "--place",
      "0,0,1080,1080",
    ],
    ["--footage", face, "--place", "0,1080,1080,840"],
  ]) {
    expect(
      (await ctx.run(["clip", "layer", "add", ...argv, second])).exitCode
    ).toBe(0);
  }
  expect(
    (await ctx.run(["clip", "layer", "remove", second, "0"])).exitCode
  ).toBe(0);
  await ctx.testDb.insert(schema.overlays).values({
    clipId: second,
    at: 0.2,
    durationInSeconds: 0.6,
    kind: "chatCard",
    title: "viewer",
    description: "nice",
    disableEnterAnimation: true,
    disableExitAnimation: true,
  });
  return { videoId: video!.id, first, second };
};

/** The Short as `cvm short render` posts it, with the same fake overlay renderer. */
const renderShort = (videoId: string) => {
  const db = Layer.succeed(DrizzleService, ctx.testDb as never);
  const deps = Layer.mergeAll(
    VideoOperationsService.Default.pipe(Layer.provide(db)),
    ClipOperationsService.Default.pipe(Layer.provide(db)),
    FFmpegCommandsService.Default,
    FFmpegEncodeService.Default,
    Layer.succeed(VideoEditorLoggerService, {
      log: () => Effect.void,
    } as never),
    fakeOverlayRenderer,
    NodeContext.layer,
    SidecarContextTest,
    Layer.setConfigProvider(
      ConfigProvider.fromMap(new Map([["STORAGE_ROOTS", ctx.root]]))
    )
  );
  return Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* RenderVerticalVideoService;
      return yield* service.renderVerticalVideo({ videoId });
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          deps,
          RenderVerticalVideoService.DefaultWithoutDependencies.pipe(
            Layer.provide(deps)
          )
        )
      )
    )
  );
};

const LIME = [0, 255, 0];
/** Probe points: in the card, beside it in the top square, and in the band. */
const CARD = [540, 400] as const;
const SQUARE = [540, 900] as const;
const BAND = [540, 1500] as const;

describe.skipIf(!hasFfmpeg)("cvm clip frame", () => {
  beforeEach(async () => {
    await truncateAllTables(ctx.testDb);
  });

  it("draws a Short's Clip as its render does: Footage Layers, then the Chat Card on its frames", async () => {
    const s = await seedShort();
    const exported = await renderShort(s.videoId);
    const frame = async (clip: string, at: string) => {
      const result = await ctx.run(["clip", "frame", "--at", at, clip]);
      expect(result.exitCode).toBe(0);
      return one<{ path: string }>(result.stdout).path;
    };

    const carded = await frame(s.second, "0.5");
    const before = await frame(s.second, "0.1");
    const opening = await frame(s.first, "0.5");

    expect(sizeOf(carded)).toEqual({ width: 1080, height: 1920 });
    // 0.5 s into the second Clip is 1.5 s into the Short.
    for (const [png, t, card] of [
      [carded, 1.5, MAGENTA],
      [before, 1.1, RED],
    ] as const) {
      expect(near(pixel(png, ...CARD), card)).toBe(true);
      expect(near(pixel(exported, ...CARD, t), card)).toBe(true);
      expect(near(pixel(png, ...SQUARE), RED)).toBe(true);
      expect(near(pixel(exported, ...SQUARE, t), RED)).toBe(true);
      expect(near(pixel(png, ...BAND), BLUE)).toBe(true);
      expect(near(pixel(exported, ...BAND, t), BLUE)).toBe(true);
    }
    expect(near(pixel(opening, ...BAND), YELLOW)).toBe(true);
    expect(near(pixel(exported, ...BAND, 0.5), YELLOW)).toBe(true);
    // The square is the left half only: none of the lime right half.
    expect(near(pixel(carded, 1070, 900), LIME)).toBe(false);
  }, 120_000);

  it("is refused while the recorder records", async () => {
    const s = await seedShort();
    recorder.recording = true;

    const held = await ctx.run(["clip", "frame", "--at", "0.5", s.second]);

    expect(held.exitCode).toBe(3);
    expect(JSON.parse(held.stderr)).toMatchObject({
      _tag: "StillHeldError",
      message: "No still while recording: ask again after the Stop",
    });
  });

  it.each([["-0.5"], ["1"], ["2.5"]])(
    "refuses a t of %s, outside the one-second Clip",
    async (at) => {
      const s = await seedShort();

      const result = await ctx.run(["clip", "frame", "--at", at, s.second]);

      expect(result.exitCode).toBe(3);
      expect(JSON.parse(result.stderr)._tag).toBe("FrameRefusedError");
    }
  );
});
