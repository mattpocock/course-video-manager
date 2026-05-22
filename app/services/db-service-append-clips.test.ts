import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import { sortByOrder } from "@/lib/sort-by-order";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";

let testDb: TestDb;
let testLayer: Layer.Layer<ClipOperationsService | VideoOperationsService>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;

  testLayer = Layer.mergeAll(
    ClipOperationsService.Default,
    VideoOperationsService.Default
  ).pipe(Layer.provide(Layer.succeed(DrizzleService, testDb as any)));
});

type InsertionPoint =
  | { type: "start" }
  | { type: "after-clip"; databaseClipId: string }
  | { type: "after-chapter"; chapterId: string };

describe("appendClips", () => {
  let videoId: string;
  let clipCounter = 0;

  const appendClips = (insertionPoint: InsertionPoint, clipCount = 1) =>
    Effect.gen(function* () {
      const clipOps = yield* ClipOperationsService;
      const offset = clipCounter;
      clipCounter += clipCount;
      return yield* clipOps.appendClips({
        videoId,
        insertionPoint,
        clips: Array.from({ length: clipCount }, (_, i) => ({
          inputVideo: "test.mp4",
          startTime: (offset + i) * 10,
          endTime: (offset + i + 1) * 10,
        })),
      });
    });

  const createSection = (name: string, insertionPoint: InsertionPoint) =>
    Effect.gen(function* () {
      const clipOps = yield* ClipOperationsService;
      return yield* clipOps.createChapterAtInsertionPoint(
        videoId,
        name,
        insertionPoint
      );
    });

  const getAllItemsSorted = () =>
    Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;
      const video = yield* videoOps.getVideoWithClipsById(videoId);
      return sortByOrder([
        ...video.clips.map((c: any) => ({
          type: "clip" as const,
          id: c.id,
          order: c.order,
        })),
        ...video.chapters.map((s: any) => ({
          type: "chapter" as const,
          id: s.id,
          order: s.order,
        })),
      ]);
    });

  beforeEach(async () => {
    clipCounter = 0;
    await truncateAllTables(testDb);

    const video = await Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;
      return yield* videoOps.createStandaloneVideo({ path: "test-video.mp4" });
    }).pipe(Effect.provide(testLayer), Effect.runPromise);
    videoId = video.id;
  });

  it.effect("inserts after a chapter", () =>
    Effect.gen(function* () {
      // Seed: [Clip A, Section, Clip B]
      const clipA = (yield* appendClips({ type: "start" }))[0]!;
      const section = yield* createSection("Section 1", {
        type: "after-clip",
        databaseClipId: clipA.id,
      });
      const clipB = (yield* appendClips({
        type: "after-chapter",
        chapterId: section.id,
      }))[0]!;

      yield* appendClips({
        type: "after-chapter",
        chapterId: section.id,
      });

      const items = yield* getAllItemsSorted();
      expect(items.map((i) => ({ type: i.type, id: i.id }))).toEqual([
        { type: "clip", id: clipA.id },
        { type: "chapter", id: section.id },
        { type: "clip", id: expect.any(String) }, // New clip
        { type: "clip", id: clipB.id },
      ]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("inserts after a clip (with section following)", () =>
    Effect.gen(function* () {
      // Seed: [Clip A, Section, Clip B]
      const clipA = (yield* appendClips({ type: "start" }))[0]!;
      const section = yield* createSection("Section 1", {
        type: "after-clip",
        databaseClipId: clipA.id,
      });
      const clipB = (yield* appendClips({
        type: "after-chapter",
        chapterId: section.id,
      }))[0]!;

      yield* appendClips({
        type: "after-clip",
        databaseClipId: clipA.id,
      });

      const items = yield* getAllItemsSorted();
      expect(items.map((i) => ({ type: i.type, id: i.id }))).toEqual([
        { type: "clip", id: clipA.id },
        { type: "clip", id: expect.any(String) }, // New clip — before section
        { type: "chapter", id: section.id },
        { type: "clip", id: clipB.id },
      ]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("inserts at start", () =>
    Effect.gen(function* () {
      // Seed: [Section, Clip A]
      const section = yield* createSection("Section 1", { type: "start" });
      const clipA = (yield* appendClips({
        type: "after-chapter",
        chapterId: section.id,
      }))[0]!;

      yield* appendClips({ type: "start" });

      const items = yield* getAllItemsSorted();
      expect(items.map((i) => ({ type: i.type, id: i.id }))).toEqual([
        { type: "clip", id: expect.any(String) }, // New clip
        { type: "chapter", id: section.id },
        { type: "clip", id: clipA.id },
      ]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("inserts after a chapter at end of timeline", () =>
    Effect.gen(function* () {
      // Seed: [Clip A, Section]
      const clipA = (yield* appendClips({ type: "start" }))[0]!;
      const section = yield* createSection("Section 1", {
        type: "after-clip",
        databaseClipId: clipA.id,
      });

      yield* appendClips({
        type: "after-chapter",
        chapterId: section.id,
      });

      const items = yield* getAllItemsSorted();
      expect(items.map((i) => ({ type: i.type, id: i.id }))).toEqual([
        { type: "clip", id: clipA.id },
        { type: "chapter", id: section.id },
        { type: "clip", id: expect.any(String) }, // New clip
      ]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("inserts multiple clips after a section", () =>
    Effect.gen(function* () {
      // Seed: [Clip A, Section]
      const clipA = (yield* appendClips({ type: "start" }))[0]!;
      const section = yield* createSection("Section 1", {
        type: "after-clip",
        databaseClipId: clipA.id,
      });

      yield* appendClips({ type: "after-chapter", chapterId: section.id }, 3);

      const items = yield* getAllItemsSorted();
      expect(items.length).toBe(5); // clip-a + section + 3 new clips
      expect(items[0]!.id).toBe(clipA.id);
      expect(items[1]!.id).toBe(section.id);
      // All 3 new clips should be after the section
      expect(items[2]!.type).toBe("clip");
      expect(items[3]!.type).toBe("clip");
      expect(items[4]!.type).toBe("clip");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "sequential single appends after a section preserve ordering (simulates OBS pen)",
    () =>
      Effect.gen(function* () {
        // Setup: [Section]
        const section = yield* createSection("Section 1", { type: "start" });

        // Append clips one at a time after the section (like OBS pen does)
        const clip1 = (yield* appendClips({
          type: "after-chapter",
          chapterId: section.id,
        }))[0]!;

        const items1 = yield* getAllItemsSorted();
        expect(items1.map((i) => i.type)).toEqual(["chapter", "clip"]);

        // Now append after clip1 (insertion point moves to last clip)
        const clip2 = (yield* appendClips({
          type: "after-clip",
          databaseClipId: clip1.id,
        }))[0]!;

        const items2 = yield* getAllItemsSorted();
        expect(items2.map((i) => ({ type: i.type, id: i.id }))).toEqual([
          { type: "chapter", id: section.id },
          { type: "clip", id: clip1.id },
          { type: "clip", id: clip2.id },
        ]);

        // Third append after clip2
        const clip3 = (yield* appendClips({
          type: "after-clip",
          databaseClipId: clip2.id,
        }))[0]!;

        const items3 = yield* getAllItemsSorted();
        expect(items3.map((i) => ({ type: i.type, id: i.id }))).toEqual([
          { type: "chapter", id: section.id },
          { type: "clip", id: clip1.id },
          { type: "clip", id: clip2.id },
          { type: "clip", id: clip3.id },
        ]);
      }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "appending at end with multiple sections preserves section positions",
    () =>
      Effect.gen(function* () {
        // Build: [Clip A, Section 1, Clip B, Section 2, Clip C]
        const clipA = (yield* appendClips({ type: "start" }))[0]!;
        const section1 = yield* createSection("Section 1", {
          type: "after-clip",
          databaseClipId: clipA.id,
        });
        const clipB = (yield* appendClips({
          type: "after-chapter",
          chapterId: section1.id,
        }))[0]!;
        const section2 = yield* createSection("Section 2", {
          type: "after-clip",
          databaseClipId: clipB.id,
        });
        const clipC = (yield* appendClips({
          type: "after-chapter",
          chapterId: section2.id,
        }))[0]!;

        // Now append after the very last clip
        const clipD = (yield* appendClips({
          type: "after-clip",
          databaseClipId: clipC.id,
        }))[0]!;

        const items = yield* getAllItemsSorted();
        expect(items.map((i) => ({ type: i.type, id: i.id }))).toEqual([
          { type: "clip", id: clipA.id },
          { type: "chapter", id: section1.id },
          { type: "clip", id: clipB.id },
          { type: "chapter", id: section2.id },
          { type: "clip", id: clipC.id },
          { type: "clip", id: clipD.id },
        ]);
      }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "appending after the last clip when a section is the final item",
    () =>
      Effect.gen(function* () {
        // Build: [Clip A, Clip B, Section]
        const clipA = (yield* appendClips({ type: "start" }))[0]!;
        const clipB = (yield* appendClips({
          type: "after-clip",
          databaseClipId: clipA.id,
        }))[0]!;
        const section = yield* createSection("Section 1", {
          type: "after-clip",
          databaseClipId: clipB.id,
        });

        // Append after clipB (not after section) - should go between clipB and section
        yield* appendClips({
          type: "after-clip",
          databaseClipId: clipB.id,
        });

        const items = yield* getAllItemsSorted();
        expect(items.map((i) => i.type)).toEqual([
          "clip",
          "clip",
          "clip", // new clip inserted between Clip B and Section
          "chapter",
        ]);
        expect(items[0]!.id).toBe(clipA.id);
        expect(items[1]!.id).toBe(clipB.id);
        expect(items[3]!.id).toBe(section.id);
      }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "creating a section between sequential appends does not break ordering",
    () =>
      Effect.gen(function* () {
        // Append some clips
        const clip1 = (yield* appendClips({ type: "start" }))[0]!;
        const clip2 = (yield* appendClips({
          type: "after-clip",
          databaseClipId: clip1.id,
        }))[0]!;

        // Create a section after clip2
        const section = yield* createSection("Mid Section", {
          type: "after-clip",
          databaseClipId: clip2.id,
        });

        // Continue appending after section
        const clip3 = (yield* appendClips({
          type: "after-chapter",
          chapterId: section.id,
        }))[0]!;
        const clip4 = (yield* appendClips({
          type: "after-clip",
          databaseClipId: clip3.id,
        }))[0]!;

        const items = yield* getAllItemsSorted();
        expect(items.map((i) => ({ type: i.type, id: i.id }))).toEqual([
          { type: "clip", id: clip1.id },
          { type: "clip", id: clip2.id },
          { type: "chapter", id: section.id },
          { type: "clip", id: clip3.id },
          { type: "clip", id: clip4.id },
        ]);
      }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "multiple sections interspersed with clips maintain correct ordering",
    () =>
      Effect.gen(function* () {
        // Build complex layout: [S1, C1, C2, S2, C3, S3, C4]
        const s1 = yield* createSection("Section 1", { type: "start" });
        const c1 = (yield* appendClips({
          type: "after-chapter",
          chapterId: s1.id,
        }))[0]!;
        const c2 = (yield* appendClips({
          type: "after-clip",
          databaseClipId: c1.id,
        }))[0]!;
        const s2 = yield* createSection("Section 2", {
          type: "after-clip",
          databaseClipId: c2.id,
        });
        const c3 = (yield* appendClips({
          type: "after-chapter",
          chapterId: s2.id,
        }))[0]!;
        const s3 = yield* createSection("Section 3", {
          type: "after-clip",
          databaseClipId: c3.id,
        });
        const c4 = (yield* appendClips({
          type: "after-chapter",
          chapterId: s3.id,
        }))[0]!;

        const items = yield* getAllItemsSorted();
        expect(items.map((i) => ({ type: i.type, id: i.id }))).toEqual([
          { type: "chapter", id: s1.id },
          { type: "clip", id: c1.id },
          { type: "clip", id: c2.id },
          { type: "chapter", id: s2.id },
          { type: "clip", id: c3.id },
          { type: "chapter", id: s3.id },
          { type: "clip", id: c4.id },
        ]);

        // Now append more clips after c4 - sections should stay put
        const c5 = (yield* appendClips({
          type: "after-clip",
          databaseClipId: c4.id,
        }))[0]!;
        const c6 = (yield* appendClips({
          type: "after-clip",
          databaseClipId: c5.id,
        }))[0]!;

        const items2 = yield* getAllItemsSorted();
        expect(items2.map((i) => ({ type: i.type, id: i.id }))).toEqual([
          { type: "chapter", id: s1.id },
          { type: "clip", id: c1.id },
          { type: "clip", id: c2.id },
          { type: "chapter", id: s2.id },
          { type: "clip", id: c3.id },
          { type: "chapter", id: s3.id },
          { type: "clip", id: c4.id },
          { type: "clip", id: c5.id },
          { type: "clip", id: c6.id },
        ]);
      }).pipe(Effect.provide(testLayer))
  );
});
