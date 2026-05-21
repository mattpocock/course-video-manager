import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { DBFunctionsService } from "@/services/db-service.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import { sortByOrder } from "@/lib/sort-by-order";
import { concatenateVideos } from "@/services/video-concatenation-service";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";

let testDb: TestDb;
let testLayer: Layer.Layer<DBFunctionsService | DrizzleService>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;

  testLayer = Layer.merge(
    DBFunctionsService.Default.pipe(
      Layer.provide(Layer.succeed(DrizzleService, testDb as any))
    ),
    Layer.succeed(DrizzleService, testDb as any)
  );
});

/** Helper: create a standalone video with clips and optional chapters */
const createVideoWithClips = (
  name: string,
  clipSpecs: Array<{
    videoFilename: string;
    startTime: number;
    endTime: number;
    text?: string;
    beatType?: string;
  }>,
  sectionSpecs?: Array<{ name: string; afterClipIndex: number }>
) =>
  Effect.gen(function* () {
    const db = yield* DBFunctionsService;
    const video = yield* db.createStandaloneVideo({ path: name });

    // Add all clips at the start
    const createdClips = yield* db.appendClips({
      videoId: video.id,
      insertionPoint: { type: "start" },
      clips: clipSpecs.map((c) => ({
        inputVideo: c.videoFilename,
        startTime: c.startTime,
        endTime: c.endTime,
      })),
    });

    // Update text and beatType if provided
    for (let i = 0; i < clipSpecs.length; i++) {
      const spec = clipSpecs[i]!;
      if (spec.text || spec.beatType) {
        yield* db.updateClip(createdClips[i]!.id, {
          ...(spec.text ? { text: spec.text } : {}),
          ...(spec.beatType ? { beatType: spec.beatType } : {}),
        });
      }
    }

    // Add chapters after specific clips
    if (sectionSpecs) {
      for (const sectionSpec of sectionSpecs) {
        const afterClip = createdClips[sectionSpec.afterClipIndex]!;
        yield* db.createChapterAtInsertionPoint(video.id, sectionSpec.name, {
          type: "after-clip",
          databaseClipId: afterClip.id,
        });
      }
    }

    return video;
  });

describe("concatenateVideos", () => {
  beforeEach(async () => {
    await truncateAllTables(testDb);
  });

  it.effect("concatenates two videos with correct clip ordering", () =>
    Effect.gen(function* () {
      const video1 = yield* createVideoWithClips("Video One", [
        {
          videoFilename: "/footage/v1-a.mp4",
          startTime: 0,
          endTime: 10,
          text: "clip 1a",
        },
        {
          videoFilename: "/footage/v1-b.mp4",
          startTime: 10,
          endTime: 20,
          text: "clip 1b",
        },
      ]);
      const video2 = yield* createVideoWithClips("Video Two", [
        {
          videoFilename: "/footage/v2-a.mp4",
          startTime: 0,
          endTime: 15,
          text: "clip 2a",
        },
        {
          videoFilename: "/footage/v2-b.mp4",
          startTime: 15,
          endTime: 30,
          text: "clip 2b",
        },
      ]);

      const result = yield* concatenateVideos({
        name: "Combined Video",
        sourceVideoIds: [video1.id, video2.id],
      });

      // Verify it's a standalone video
      const db = yield* DBFunctionsService;
      const newVideo = yield* db.getVideoWithClipsById(result.id);
      expect(newVideo.path).toBe("Combined Video");
      expect(newVideo.lessonId).toBeNull();

      // Get all items sorted
      const allItems = sortByOrder([
        ...newVideo.clips.map((c: any) => ({ type: "clip" as const, ...c })),
        ...newVideo.chapters.map((s: any) => ({
          type: "section" as const,
          ...s,
        })),
      ]);

      // Should have: clip1a, clip1b, boundary-section, clip2a, clip2b
      expect(allItems).toHaveLength(5);
      expect(allItems[0]).toMatchObject({
        type: "clip",
        videoFilename: "/footage/v1-a.mp4",
      });
      expect(allItems[1]).toMatchObject({
        type: "clip",
        videoFilename: "/footage/v1-b.mp4",
      });
      expect(allItems[2]).toMatchObject({ type: "section", name: "Video Two" });
      expect(allItems[3]).toMatchObject({
        type: "clip",
        videoFilename: "/footage/v2-a.mp4",
      });
      expect(allItems[4]).toMatchObject({
        type: "clip",
        videoFilename: "/footage/v2-b.mp4",
      });
    }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "preserves clip metadata (videoFilename, timestamps, text, beatType)",
    () =>
      Effect.gen(function* () {
        const video1 = yield* createVideoWithClips("Source", [
          {
            videoFilename: "/footage/important.mp4",
            startTime: 5.5,
            endTime: 12.3,
            text: "Hello world",
            beatType: "long",
          },
        ]);

        const result = yield* concatenateVideos({
          name: "Copy",
          sourceVideoIds: [video1.id],
        });

        const db = yield* DBFunctionsService;
        const newVideo = yield* db.getVideoWithClipsById(result.id);

        expect(newVideo.clips).toHaveLength(1);
        const clip = newVideo.clips[0]!;
        expect(clip.videoFilename).toBe("/footage/important.mp4");
        expect(clip.sourceStartTime).toBe(5.5);
        expect(clip.sourceEndTime).toBe(12.3);
        expect(clip.text).toBe("Hello world");
        expect(clip.beatType).toBe("long");
        // New clip should have a different ID than the source
        expect(clip.id).not.toBe(video1.id);
      }).pipe(Effect.provide(testLayer))
  );

  it.effect("preserves chapters from source videos", () =>
    Effect.gen(function* () {
      const video1 = yield* createVideoWithClips(
        "Source With Sections",
        [
          { videoFilename: "a.mp4", startTime: 0, endTime: 10 },
          { videoFilename: "b.mp4", startTime: 10, endTime: 20 },
          { videoFilename: "c.mp4", startTime: 20, endTime: 30 },
        ],
        [{ name: "Intro", afterClipIndex: 0 }]
      );

      const result = yield* concatenateVideos({
        name: "With Sections",
        sourceVideoIds: [video1.id],
      });

      const db = yield* DBFunctionsService;
      const newVideo = yield* db.getVideoWithClipsById(result.id);

      const allItems = sortByOrder([
        ...newVideo.clips.map((c: any) => ({ type: "clip" as const, ...c })),
        ...newVideo.chapters.map((s: any) => ({
          type: "section" as const,
          ...s,
        })),
      ]);

      // Should be: clip-a, section "Intro", clip-b, clip-c
      expect(allItems).toHaveLength(4);
      expect(allItems[0]).toMatchObject({
        type: "clip",
        videoFilename: "a.mp4",
      });
      expect(allItems[1]).toMatchObject({ type: "section", name: "Intro" });
      expect(allItems[2]).toMatchObject({
        type: "clip",
        videoFilename: "b.mp4",
      });
      expect(allItems[3]).toMatchObject({
        type: "clip",
        videoFilename: "c.mp4",
      });
    }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "creates boundary sections between sources with correct names",
    () =>
      Effect.gen(function* () {
        const video1 = yield* createVideoWithClips("Alpha", [
          { videoFilename: "a.mp4", startTime: 0, endTime: 10 },
        ]);
        const video2 = yield* createVideoWithClips("Beta", [
          { videoFilename: "b.mp4", startTime: 0, endTime: 10 },
        ]);
        const video3 = yield* createVideoWithClips("Gamma", [
          { videoFilename: "c.mp4", startTime: 0, endTime: 10 },
        ]);

        const result = yield* concatenateVideos({
          name: "Three Sources",
          sourceVideoIds: [video1.id, video2.id, video3.id],
        });

        const db = yield* DBFunctionsService;
        const newVideo = yield* db.getVideoWithClipsById(result.id);

        const allItems = sortByOrder([
          ...newVideo.clips.map((c: any) => ({ type: "clip" as const, ...c })),
          ...newVideo.chapters.map((s: any) => ({
            type: "section" as const,
            ...s,
          })),
        ]);

        // clip-a, boundary "Beta", clip-b, boundary "Gamma", clip-c
        expect(allItems).toHaveLength(5);
        expect(allItems[0]).toMatchObject({
          type: "clip",
          videoFilename: "a.mp4",
        });
        expect(allItems[1]).toMatchObject({ type: "section", name: "Beta" });
        expect(allItems[2]).toMatchObject({
          type: "clip",
          videoFilename: "b.mp4",
        });
        expect(allItems[3]).toMatchObject({ type: "section", name: "Gamma" });
        expect(allItems[4]).toMatchObject({
          type: "clip",
          videoFilename: "c.mp4",
        });
      }).pipe(Effect.provide(testLayer))
  );

  it.effect("handles single video concatenation (edge case)", () =>
    Effect.gen(function* () {
      const video1 = yield* createVideoWithClips("Solo", [
        { videoFilename: "solo.mp4", startTime: 0, endTime: 10 },
        { videoFilename: "solo.mp4", startTime: 10, endTime: 20 },
      ]);

      const result = yield* concatenateVideos({
        name: "Single Source",
        sourceVideoIds: [video1.id],
      });

      const db = yield* DBFunctionsService;
      const newVideo = yield* db.getVideoWithClipsById(result.id);

      // No boundary sections for single video
      expect(newVideo.chapters).toHaveLength(0);
      expect(newVideo.clips).toHaveLength(2);

      const sortedClips = sortByOrder(newVideo.clips);
      expect(sortedClips[0]!.sourceStartTime).toBe(0);
      expect(sortedClips[1]!.sourceStartTime).toBe(10);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "ordering is correct when concatenating 3+ videos with multiple clips",
    () =>
      Effect.gen(function* () {
        const video1 = yield* createVideoWithClips("V1", [
          { videoFilename: "v1.mp4", startTime: 0, endTime: 5 },
          { videoFilename: "v1.mp4", startTime: 5, endTime: 10 },
        ]);
        const video2 = yield* createVideoWithClips("V2", [
          { videoFilename: "v2.mp4", startTime: 0, endTime: 7 },
        ]);
        const video3 = yield* createVideoWithClips("V3", [
          { videoFilename: "v3.mp4", startTime: 0, endTime: 3 },
          { videoFilename: "v3.mp4", startTime: 3, endTime: 8 },
          { videoFilename: "v3.mp4", startTime: 8, endTime: 12 },
        ]);

        const result = yield* concatenateVideos({
          name: "Big Concat",
          sourceVideoIds: [video1.id, video2.id, video3.id],
        });

        const db = yield* DBFunctionsService;
        const newVideo = yield* db.getVideoWithClipsById(result.id);

        const allItems = sortByOrder([
          ...newVideo.clips.map((c: any) => ({ type: "clip" as const, ...c })),
          ...newVideo.chapters.map((s: any) => ({
            type: "section" as const,
            ...s,
          })),
        ]);

        // v1-clip1, v1-clip2, boundary "V2", v2-clip1, boundary "V3", v3-clip1, v3-clip2, v3-clip3
        expect(
          allItems.map((i: any) =>
            i.type === "section" ? `[${i.name}]` : i.videoFilename
          )
        ).toEqual([
          "v1.mp4",
          "v1.mp4",
          "[V2]",
          "v2.mp4",
          "[V3]",
          "v3.mp4",
          "v3.mp4",
          "v3.mp4",
        ]);
      }).pipe(Effect.provide(testLayer))
  );
});
