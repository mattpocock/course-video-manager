import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import { NodeContext } from "@effect/platform-node";
import { truncateAllTables } from "@/test-utils/test-db";
import * as schema from "@/db/schema";
import { DrizzleService } from "@/services/drizzle-service.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { FFmpegCommandsService } from "@/services/ffmpeg-commands";
import { FFmpegEncodeService } from "@/services/ffmpeg-encode-commands";
import { VideoEditorLoggerService } from "@/services/video-editor-logger-service";
import { OverlayRenderCacheService } from "@/services/overlay-render-cache.server";
import type { OverlayContent } from "@/services/overlay-render-cache";
import { overlayRenderProps } from "@/services/overlay-content-props";
import { VideoExportService } from "@/services/video-export-service";
import { exportVideoToItsAddress } from "@/services/course-publish-export-video";
import { SidecarContextTest } from "@/services/sidecar-context";
import { one } from "./cli-write-test-harness";
import {
  ctx,
  setupFrameTests,
  hasFfmpeg,
  recorder,
  framesDrawn,
  footage,
  sizeOf,
  pixel,
  near,
  overlaySource,
  RED,
  BLUE,
  YELLOW,
  MAGENTA,
} from "@/test-utils/cli-frame-harness";

setupFrameTests();

// ---------------------------------------------------------------------------
// cvm clip frame on a Landscape Video, against the real course export
// ---------------------------------------------------------------------------

/**
 * A Landscape Video of four one-second Clips cut from one yellow file with a
 * red stripe down its left edge (0-300 px once scaled to 1920): the first
 * untouched, the second under a Definition Card 0.2 s to 0.8 s into it, the
 * third under a Bullet Panel for all of it (its Transform slides the picture
 * right, easing in over 0.5 s), the last with its Scene Layer and a blue
 * Footage Layer in the bottom-left corner.
 */
const seedLandscape = async () => {
  const base = join(ctx.root, "raw-footage/imported/striped.mp4");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=yellow:s=640x360:r=30:d=5,drawbox=x=0:y=0:w=100:h=360:color=red:t=fill",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=5",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    base,
  ]);
  const footagePath = "raw-footage/imported/striped.mp4";
  const face = footage("face.mp4", "blue");
  const [video] = await ctx.testDb
    .insert(schema.videos)
    .values({
      title: "Landscape",
      originalFootagePath: footagePath,
      format: "landscape",
    })
    .returning();
  const clip = async (order: string, start: number) => {
    const [row] = await ctx.testDb
      .insert(schema.clips)
      .values({
        videoId: video!.id,
        videoFilename: footagePath,
        sourceStartTime: start,
        sourceEndTime: start + 1,
        order,
        text: "hello there",
      })
      .returning();
    return row!.id;
  };
  const plain = await clip("a0", 0);
  const carded = await clip("a1", 1);
  const paneled = await clip("a2", 2);
  const layered = await clip("a3", 3);
  await ctx.testDb.insert(schema.overlays).values([
    {
      clipId: carded,
      at: 0.2,
      durationInSeconds: 0.6,
      kind: "definitionCard",
      title: "Term",
      description: "what it means",
      disableEnterAnimation: false,
      disableExitAnimation: false,
    },
    {
      clipId: paneled,
      at: 0,
      durationInSeconds: 1,
      kind: "bulletPanel",
      title: "Points",
      description: "",
      disableEnterAnimation: false,
      disableExitAnimation: false,
    },
  ]);
  expect(
    (
      await ctx.run([
        "clip",
        "layer",
        "add",
        "--footage",
        face,
        "--place",
        "0,780,480,270",
        layered,
      ])
    ).exitCode
  ).toBe(0);
  return { videoId: video!.id, plain, carded, paneled, layered };
};

/**
 * An Overlay's content render as the Overlay Render Cache hands it to the
 * export: drawn by the same fake as a frame's PNG, from the same props.
 */
const fakeOverlayRenderCache = Layer.succeed(OverlayRenderCacheService, {
  renderOverlay: ({ content }: { content: OverlayContent }) =>
    Effect.sync(() => {
      const out = join(
        ctx.root,
        `overlay-${content.kind}-${content.durationInSeconds}.mov`
      );
      execFileSync("ffmpeg", [
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        overlaySource(overlayRenderProps(content)),
        "-c:v",
        "png",
        "-pix_fmt",
        "rgba",
        out,
      ]);
      return out;
    }),
} as unknown as OverlayRenderCacheService);

/** The Video as a Publish exports it: the real passes, the composite included. */
const exportLandscape = (videoId: string) => {
  const db = Layer.succeed(DrizzleService, ctx.testDb as never);
  const logger = Layer.succeed(VideoEditorLoggerService, {
    log: () => Effect.void,
  } as never);
  return Effect.runPromise(
    exportVideoToItsAddress({ videoId, storageRoots: [ctx.root] }).pipe(
      Effect.map(({ targetPath }) => targetPath),
      Effect.provide(
        Layer.mergeAll(
          VideoOperationsService.Default.pipe(Layer.provide(db)),
          VideoExportService.DefaultWithoutDependencies.pipe(
            Layer.provide(
              Layer.mergeAll(
                FFmpegCommandsService.Default,
                FFmpegEncodeService.Default,
                logger,
                NodeContext.layer
              )
            )
          ),
          fakeOverlayRenderCache,
          logger,
          NodeContext.layer,
          SidecarContextTest
        )
      )
    )
  );
};

const CYAN = [0, 255, 255];
const SLIDE = [16, 16, 17];
/** Probe points: the card, the panel, the stripe, beside the stripe, the Footage Layer. */
const DEF_CARD = [1500, 250] as const;
const PANEL = [1800, 950] as const;
const EDGE = [100, 540] as const;
const BESIDE = [400, 540] as const;
const CORNER = [240, 900] as const;

describe.skipIf(!hasFfmpeg)("cvm clip frame on a Landscape Video", () => {
  beforeEach(async () => {
    await truncateAllTables(ctx.testDb);
  });

  it("draws each Clip as the course export ships it: Layers, the Transform, the Definition Card and the Bullet Panel", async () => {
    const s = await seedLandscape();
    const exported = await exportLandscape(s.videoId);
    const frame = async (clip: string, at: string) => {
      const result = await ctx.run(["clip", "frame", "--at", at, clip]);
      expect(result.exitCode).toBe(0);
      return one<{ path: string }>(result.stdout).path;
    };
    /** The frame's pixel and the export's at the same moment, both `rgb`. */
    const both = (
      png: string,
      t: number,
      [x, y]: readonly [number, number],
      rgb: number[]
    ) => {
      expect(near(pixel(png, x, y), rgb)).toBe(true);
      expect(near(pixel(exported, x, y, t), rgb)).toBe(true);
    };

    // No Overlay on screen: the picture alone, and no overlay frame drawn.
    const plain = await frame(s.plain, "0.5");
    const beforeCard = await frame(s.carded, "0.1");
    expect(framesDrawn).toEqual([]);
    expect(sizeOf(plain)).toEqual({ width: 1920, height: 1080 });
    both(plain, 0.505, EDGE, RED);
    both(plain, 0.505, BESIDE, YELLOW);
    both(beforeCard, 1.105, DEF_CARD, YELLOW);

    // Under the Definition Card: 0.5 s in is 0.3 s into the card.
    const carded = await frame(s.carded, "0.5");
    expect(framesDrawn).toEqual([18]);
    both(carded, 1.505, DEF_CARD, MAGENTA);
    both(carded, 1.505, EDGE, RED);

    // Under the Bullet Panel, mid-Transform: the picture has slid right
    // (the stripe at 100 px gone, the slide's fill there, the stripe now at
    // 400 px), with the panel drawn over it, unmoved.
    const paneled = await frame(s.paneled, "0.25");
    both(paneled, 2.255, PANEL, CYAN);
    both(paneled, 2.255, EDGE, SLIDE);
    both(paneled, 2.255, BESIDE, RED);

    // A Scene Layer with a Footage Layer over it.
    const layered = await frame(s.layered, "0.5");
    both(layered, 3.505, CORNER, BLUE);
    both(layered, 3.505, BESIDE, YELLOW);
    both(layered, 3.505, EDGE, RED);
  }, 180_000);

  it("is refused while the recorder records", async () => {
    const s = await seedLandscape();
    recorder.recording = true;

    const held = await ctx.run(["clip", "frame", "--at", "0.5", s.carded]);

    expect(held.exitCode).toBe(3);
    expect(JSON.parse(held.stderr)).toMatchObject({
      _tag: "StillHeldError",
      message: "No still while recording: ask again after the Stop",
    });
    expect(framesDrawn).toEqual([]);
  });
});
