import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { ClipOperationsService } from "./db-clip-operations.server.js";
import { OverlayOperationsService } from "./db-overlay-operations.server.js";
import { VideoOperationsService } from "./db-video-operations.server.js";
import { DrizzleService } from "./drizzle-service.server.js";
import type { FootageLayerSpec } from "../features/videos/clip-layer.js";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "../test-utils/test-db.js";

let testDb: TestDb;
let testLayer: Layer.Layer<
  ClipOperationsService | OverlayOperationsService | VideoOperationsService
>;

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
  testLayer = Layer.mergeAll(
    ClipOperationsService.Default,
    OverlayOperationsService.Default,
    VideoOperationsService.Default
  ).pipe(Layer.provide(Layer.succeed(DrizzleService, testDb as any)));
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

const broll: FootageLayerSpec = {
  kind: "footage",
  source: { kind: "file", path: "broll.mp4", start: 30 },
  sourceCrop: { x: 0, y: 0, w: 1, h: 1 },
  placement: { x: 0, y: 0, w: 1080, h: 1920 },
  volume: 0,
  span: null,
};

/** A Short with Clip A (source 10-20, four words, B-roll, an Overlay at 7) then Clip B. */
const seed = Effect.gen(function* () {
  const videoOps = yield* VideoOperationsService;
  const clipOps = yield* ClipOperationsService;
  const overlayOps = yield* OverlayOperationsService;
  const video = yield* videoOps.createStandaloneVideo({
    title: "short",
    format: "short",
  });
  const [a, b] = yield* clipOps.appendClips({
    videoId: video.id,
    insertionPoint: { type: "start" },
    clips: [
      { inputVideo: "take.mp4", startTime: 10, endTime: 20 },
      { inputVideo: "take.mp4", startTime: 30, endTime: 40 },
    ],
  });
  yield* clipOps.updateClip(a!.id, {
    text: "The quick, brown fox.",
    pauseType: "long",
  });
  yield* clipOps.replaceTranscriptWords(a!.id, [
    { start: 0.5, end: 1.5, text: "The" },
    { start: 2, end: 3, text: "quick," },
    { start: 5, end: 6, text: "brown" },
    { start: 8.5, end: 9.5, text: "fox." },
  ]);
  yield* clipOps.setClipLayers([a!.id], [{ kind: "scene", volume: 1 }, broll]);
  const early = yield* overlayOps.createOverlay({
    clipId: a!.id,
    at: 1,
    durationInSeconds: 1,
    title: "early",
    description: "",
  });
  const late = yield* overlayOps.createOverlay({
    clipId: a!.id,
    at: 7,
    durationInSeconds: 1,
    title: "late",
    description: "",
  });
  return { video, a: a!, b: b!, early, late };
});

describe("splitClip", () => {
  it.effect(
    "makes two adjacent Clips at a word boundary, the right side carrying the Layers, later Overlays and words",
    () =>
      Effect.gen(function* () {
        const { video, a, b, early, late } = yield* seed;
        const clipOps = yield* ClipOperationsService;
        const overlayOps = yield* OverlayOperationsService;

        // Source 15.3 is inside "brown" (source 15-16): snaps to its start.
        const { left, right } = yield* clipOps.splitClip(a.id, {
          kind: "source",
          seconds: 15.3,
        });

        expect(
          (yield* clipOps.listTimelineOrder(video.id)).map((i) => i.id)
        ).toEqual([a.id, right.id, b.id]);
        expect(left).toMatchObject({
          id: a.id,
          sourceStartTime: 10,
          sourceEndTime: 15,
          text: "The quick,",
          pauseType: "none",
        });
        expect(right).toMatchObject({
          videoId: video.id,
          videoFilename: "take.mp4",
          sourceStartTime: 15,
          sourceEndTime: 20,
          text: "brown fox.",
          pauseType: "long",
        });

        const words = (id: string) =>
          clipOps
            .listTranscriptWords(id)
            .pipe(Effect.map((ws) => ws.map((w) => [w.start, w.end, w.text])));
        expect(yield* words(a.id)).toEqual([
          [0.5, 1.5, "The"],
          [2, 3, "quick,"],
        ]);
        expect(yield* words(right.id)).toEqual([
          [0, 1, "brown"],
          [3.5, 4.5, "fox."],
        ]);

        expect(yield* clipOps.listClipLayers(right.id)).toEqual([
          { kind: "scene", volume: 1 },
          { ...broll, source: { ...broll.source, start: 35 } },
        ]);

        const overlays = yield* overlayOps.getOverlaysByIds([
          early.id,
          late.id,
        ]);
        expect(overlays.map((o) => [o.title, o.clipId, o.at]).sort()).toEqual([
          ["early", a.id, 1],
          ["late", right.id, 2],
        ]);
      }).pipe(Effect.provide(testLayer))
  );

  it.effect("refuses a split outside the Clip, writing nothing", () =>
    Effect.gen(function* () {
      const { video, a } = yield* seed;
      const clipOps = yield* ClipOperationsService;

      const error = yield* clipOps
        .splitClip(a.id, { kind: "source", seconds: 25 })
        .pipe(Effect.flip);

      expect(error._tag).toBe("ClipSplitRefusedError");
      expect(yield* clipOps.listTimelineOrder(video.id)).toHaveLength(2);
    }).pipe(Effect.provide(testLayer))
  );
});
