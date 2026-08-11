import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { ClipOperationsService } from "./db-clip-operations.server.js";
import { VideoOperationsService } from "./db-video-operations.server.js";
import { DrizzleService } from "./drizzle-service.server.js";
import { sortByOrder } from "../lib/sort-by-order.js";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "../test-utils/pglite.js";

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

describe("reorderClip", () => {
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

  const reorderClip = (clipId: string, direction: "up" | "down") =>
    Effect.gen(function* () {
      const clipOps = yield* ClipOperationsService;
      return yield* clipOps.reorderClip(clipId, direction);
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
      return yield* videoOps.createStandaloneVideo({ title: "test-video.mp4" });
    }).pipe(Effect.provide(testLayer), Effect.runPromise);
    videoId = video.id;
  });

  it.effect("moves a clip up past a section", () =>
    Effect.gen(function* () {
      // Build: [Clip A, Section, Clip B]
      const clipA = (yield* appendClips({ type: "start" }))[0]!;
      const section = yield* createSection("Section 1", {
        type: "after-clip",
        databaseClipId: clipA.id,
      });
      const clipB = (yield* appendClips({
        type: "after-chapter",
        chapterId: section.id,
      }))[0]!;

      // Move Clip B up (should swap with section)
      yield* reorderClip(clipB.id, "up");

      const items = yield* getAllItemsSorted();
      expect(items.map((i) => ({ type: i.type, id: i.id }))).toEqual([
        { type: "clip", id: clipA.id },
        { type: "clip", id: clipB.id },
        { type: "chapter", id: section.id },
      ]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("moves a clip down past a section", () =>
    Effect.gen(function* () {
      // Build: [Clip A, Section, Clip B]
      const clipA = (yield* appendClips({ type: "start" }))[0]!;
      const section = yield* createSection("Section 1", {
        type: "after-clip",
        databaseClipId: clipA.id,
      });
      const clipB = (yield* appendClips({
        type: "after-chapter",
        chapterId: section.id,
      }))[0]!;

      // Move Clip A down (should swap with section)
      yield* reorderClip(clipA.id, "down");

      const items = yield* getAllItemsSorted();
      expect(items.map((i) => ({ type: i.type, id: i.id }))).toEqual([
        { type: "chapter", id: section.id },
        { type: "clip", id: clipA.id },
        { type: "clip", id: clipB.id },
      ]);
    }).pipe(Effect.provide(testLayer))
  );
});

describe("reorderChapter", () => {
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

  const reorderSection = (chapterId: string, direction: "up" | "down") =>
    Effect.gen(function* () {
      const clipOps = yield* ClipOperationsService;
      return yield* clipOps.reorderChapter(chapterId, direction);
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
          name: s.name,
          order: s.order,
        })),
      ]);
    });

  beforeEach(async () => {
    clipCounter = 0;
    await truncateAllTables(testDb);

    const video = await Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;
      return yield* videoOps.createStandaloneVideo({ title: "test-video.mp4" });
    }).pipe(Effect.provide(testLayer), Effect.runPromise);
    videoId = video.id;
  });

  it.effect("moves a section up past a clip", () =>
    Effect.gen(function* () {
      // Build: [Clip A, Section, Clip B]
      const clipA = (yield* appendClips({ type: "start" }))[0]!;
      const section = yield* createSection("Section 1", {
        type: "after-clip",
        databaseClipId: clipA.id,
      });
      yield* appendClips({
        type: "after-chapter",
        chapterId: section.id,
      });

      // Move section up (should swap with Clip A)
      yield* reorderSection(section.id, "up");

      const items = yield* getAllItemsSorted();
      expect(items.map((i) => i.type)).toEqual(["chapter", "clip", "clip"]);
      expect(items[0]!.id).toBe(section.id);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("moves a section down past a clip", () =>
    Effect.gen(function* () {
      // Build: [Clip A, Section, Clip B]
      const clipA = (yield* appendClips({ type: "start" }))[0]!;
      const section = yield* createSection("Section 1", {
        type: "after-clip",
        databaseClipId: clipA.id,
      });
      const clipB = (yield* appendClips({
        type: "after-chapter",
        chapterId: section.id,
      }))[0]!;

      // Move section down (should swap with Clip B)
      yield* reorderSection(section.id, "down");

      const items = yield* getAllItemsSorted();
      expect(items.map((i) => ({ type: i.type, id: i.id }))).toEqual([
        { type: "clip", id: clipA.id },
        { type: "clip", id: clipB.id },
        { type: "chapter", id: section.id },
      ]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("swaps two adjacent sections", () =>
    Effect.gen(function* () {
      // Build: [Section 1, Section 2]
      const s1 = yield* createSection("Section 1", { type: "start" });
      const s2 = yield* createSection("Section 2", {
        type: "after-chapter",
        chapterId: s1.id,
      });

      // Move Section 2 up
      yield* reorderSection(s2.id, "up");

      const items = yield* getAllItemsSorted();
      expect(items.map((i: any) => i.name)).toEqual(["Section 2", "Section 1"]);
    }).pipe(Effect.provide(testLayer))
  );
});

describe("createChapterAtPosition", () => {
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

  const createSectionAtPosition = (
    name: string,
    position: "before" | "after",
    targetItemId: string,
    targetItemType: "clip" | "chapter"
  ) =>
    Effect.gen(function* () {
      const clipOps = yield* ClipOperationsService;
      return yield* clipOps.createChapterAtPosition(
        videoId,
        name,
        position,
        targetItemId,
        targetItemType
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
          name: s.name,
          order: s.order,
        })),
      ]);
    });

  beforeEach(async () => {
    clipCounter = 0;
    await truncateAllTables(testDb);

    const video = await Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;
      return yield* videoOps.createStandaloneVideo({ title: "test-video.mp4" });
    }).pipe(Effect.provide(testLayer), Effect.runPromise);
    videoId = video.id;
  });

  it.effect("creates a section before a clip", () =>
    Effect.gen(function* () {
      // Build: [Clip A, Clip B]
      const clipA = (yield* appendClips({ type: "start" }))[0]!;
      const clipB = (yield* appendClips({
        type: "after-clip",
        databaseClipId: clipA.id,
      }))[0]!;

      // Create section before Clip B
      yield* createSectionAtPosition("Before B", "before", clipB.id, "clip");

      const items = yield* getAllItemsSorted();
      expect(items.map((i) => i.type)).toEqual(["clip", "chapter", "clip"]);
      expect(items[0]!.id).toBe(clipA.id);
      expect(items[2]!.id).toBe(clipB.id);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("creates a section after a clip", () =>
    Effect.gen(function* () {
      // Build: [Clip A, Clip B]
      const clipA = (yield* appendClips({ type: "start" }))[0]!;
      const clipB = (yield* appendClips({
        type: "after-clip",
        databaseClipId: clipA.id,
      }))[0]!;

      // Create section after Clip A
      yield* createSectionAtPosition("After A", "after", clipA.id, "clip");

      const items = yield* getAllItemsSorted();
      expect(items.map((i) => i.type)).toEqual(["clip", "chapter", "clip"]);
      expect(items[0]!.id).toBe(clipA.id);
      expect(items[2]!.id).toBe(clipB.id);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("creates a section before another section", () =>
    Effect.gen(function* () {
      // Build: [Clip A, Section 1, Clip B]
      const clipA = (yield* appendClips({ type: "start" }))[0]!;
      const s1 = yield* createSection("Section 1", {
        type: "after-clip",
        databaseClipId: clipA.id,
      });
      yield* appendClips({
        type: "after-chapter",
        chapterId: s1.id,
      });

      // Create section before Section 1
      yield* createSectionAtPosition("Before S1", "before", s1.id, "chapter");

      const items = yield* getAllItemsSorted();
      expect(items.map((i) => i.type)).toEqual([
        "clip",
        "chapter", // Before S1
        "chapter", // Section 1
        "clip",
      ]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "appending clips after creating section at position preserves order",
    () =>
      Effect.gen(function* () {
        // Build: [Clip A, Clip B]
        const clipA = (yield* appendClips({ type: "start" }))[0]!;
        const clipB = (yield* appendClips({
          type: "after-clip",
          databaseClipId: clipA.id,
        }))[0]!;

        // Create section after Clip A via createChapterAtPosition
        const section = yield* createSectionAtPosition(
          "Mid Section",
          "after",
          clipA.id,
          "clip"
        );

        // Append after section
        const clipC = (yield* appendClips({
          type: "after-chapter",
          chapterId: section.id,
        }))[0]!;

        const items = yield* getAllItemsSorted();
        // clipC should be between section and clipB
        expect(items.map((i) => ({ type: i.type, id: i.id }))).toEqual([
          { type: "clip", id: clipA.id },
          { type: "chapter", id: section.id },
          { type: "clip", id: clipC.id },
          { type: "clip", id: clipB.id },
        ]);
      }).pipe(Effect.provide(testLayer))
  );
});

describe("moveClipToPosition", () => {
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

  const moveClip = (clipId: string, beforeItemId: string | null) =>
    Effect.gen(function* () {
      const clipOps = yield* ClipOperationsService;
      return yield* clipOps.moveClipToPosition(clipId, beforeItemId);
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
      return yield* videoOps.createStandaloneVideo({ title: "test-video.mp4" });
    }).pipe(Effect.provide(testLayer), Effect.runPromise);
    videoId = video.id;
  });

  it.effect("jumps a clip to before a non-adjacent clip", () =>
    Effect.gen(function* () {
      // Build: [Clip A, Clip B, Clip C]
      const clipA = (yield* appendClips({ type: "start" }))[0]!;
      const clipB = (yield* appendClips({
        type: "after-clip",
        databaseClipId: clipA.id,
      }))[0]!;
      const clipC = (yield* appendClips({
        type: "after-clip",
        databaseClipId: clipB.id,
      }))[0]!;

      // Move C to before A in one jump (not an adjacent swap)
      yield* moveClip(clipC.id, clipA.id);

      const items = yield* getAllItemsSorted();
      expect(items.map((i) => i.id)).toEqual([clipC.id, clipA.id, clipB.id]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("positions a clip immediately after a chapter", () =>
    Effect.gen(function* () {
      // Build: [Clip A, Section, Clip B]
      const clipA = (yield* appendClips({ type: "start" }))[0]!;
      const section = yield* createSection("Section 1", {
        type: "after-clip",
        databaseClipId: clipA.id,
      });
      const clipB = (yield* appendClips({
        type: "after-chapter",
        chapterId: section.id,
      }))[0]!;

      // Move Clip B to before Clip A — should land ahead of the section too,
      // since clips and chapters share one order space.
      yield* moveClip(clipB.id, clipA.id);

      const items = yield* getAllItemsSorted();
      expect(items.map((i) => ({ type: i.type, id: i.id }))).toEqual([
        { type: "clip", id: clipB.id },
        { type: "clip", id: clipA.id },
        { type: "chapter", id: section.id },
      ]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("null beforeItemId appends to the end", () =>
    Effect.gen(function* () {
      // Build: [Clip A, Clip B]
      const clipA = (yield* appendClips({ type: "start" }))[0]!;
      const clipB = (yield* appendClips({
        type: "after-clip",
        databaseClipId: clipA.id,
      }))[0]!;

      yield* moveClip(clipA.id, null);

      const items = yield* getAllItemsSorted();
      expect(items.map((i) => i.id)).toEqual([clipB.id, clipA.id]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("unknown beforeItemId => NotFoundError", () =>
    Effect.gen(function* () {
      const clipA = (yield* appendClips({ type: "start" }))[0]!;

      const result = yield* moveClip(clipA.id, "nonexistent-id").pipe(
        Effect.flip
      );
      expect(result._tag).toBe("NotFoundError");
    }).pipe(Effect.provide(testLayer))
  );
});
