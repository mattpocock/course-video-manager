import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import {
  createDirectClipService,
  type VideoProcessingAdapter,
} from "./clip-service-handler";
import type { ClipService } from "./clip-service";
import type {
  FrontendId,
  DatabaseId,
  FrontendTimelineItem,
  FrontendInsertionPoint,
} from "./clip-service";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";

let testDb: TestDb;
let clipService: ClipService;
let mockVideoProcessing: VideoProcessingAdapter;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
});

beforeEach(async () => {
  await truncateAllTables(testDb);

  mockVideoProcessing = {
    getLatestOBSVideoClips: vi.fn().mockResolvedValue({ clips: [] }),
  };

  clipService = createDirectClipService(testDb as any, mockVideoProcessing);
});

const getItems = async (
  clipService: ClipService,
  videoId: string
): Promise<FrontendTimelineItem[]> => {
  const timeline = await clipService.getTimeline(videoId);
  return timeline.map((item): FrontendTimelineItem => {
    if (item.type === "clip") {
      return {
        type: "on-database",
        frontendId: item.data.id as FrontendId,
        databaseId: item.data.id as DatabaseId,
      };
    } else {
      return {
        type: "chapter-on-database",
        frontendId: item.data.id as FrontendId,
        databaseId: item.data.id as DatabaseId,
      };
    }
  });
};

const afterClip = (id: string): FrontendInsertionPoint => ({
  type: "after-clip",
  frontendClipId: id as FrontendId,
});

const afterSection = (id: string): FrontendInsertionPoint => ({
  type: "after-chapter",
  frontendChapterId: id as FrontendId,
});

const start: FrontendInsertionPoint = { type: "start" };
const end: FrontendInsertionPoint = { type: "end" };

describe("ClipService", () => {
  describe("optimistic insertion point resolution", () => {
    it("resolves after-clip on optimistic item to nearest persisted section", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      // Seed: [ClipA, Section1] in DB
      const [clipA] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
      });
      const section = await clipService.createChapterAtInsertionPoint({
        videoId: video.id,
        name: "Section 1",
        insertionPoint: afterClip(clipA!.id),
        items: await getItems(clipService, video.id),
      });

      // Frontend items: [ClipA (db), Section1 (db), OptClip1 (optimistic)]
      const items: FrontendTimelineItem[] = [
        {
          type: "on-database",
          frontendId: clipA!.id as FrontendId,
          databaseId: clipA!.id as DatabaseId,
        },
        {
          type: "chapter-on-database",
          frontendId: section.id as FrontendId,
          databaseId: section.id as DatabaseId,
        },
        {
          type: "optimistically-added",
          frontendId: "opt-1" as FrontendId,
        },
      ];

      // Insert after the optimistic clip - should resolve to after Section1
      await clipService.appendClips({
        videoId: video.id,
        insertionPoint: {
          type: "after-clip",
          frontendClipId: "opt-1" as FrontendId,
        },
        items,
        clips: [{ inputVideo: "test.mp4", startTime: 10, endTime: 20 }],
      });

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline.map((t) => ({ type: t.type, id: t.data.id }))).toEqual([
        { type: "clip", id: clipA!.id },
        { type: "chapter", id: section.id },
        { type: "clip", id: expect.any(String) }, // New clip after section
      ]);
    });

    it("resolves after-clip on optimistic item to nearest persisted clip", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      // Seed: [Section1, ClipA] in DB
      const section = await clipService.createChapterAtInsertionPoint({
        videoId: video.id,
        name: "Section 1",
        insertionPoint: start,
        items: [],
      });
      const [clipA] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: afterSection(section.id),
        items: await getItems(clipService, video.id),
        clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
      });

      // Frontend items: [Section1 (db), ClipA (db), OptClip1 (optimistic)]
      const items: FrontendTimelineItem[] = [
        {
          type: "chapter-on-database",
          frontendId: section.id as FrontendId,
          databaseId: section.id as DatabaseId,
        },
        {
          type: "on-database",
          frontendId: clipA!.id as FrontendId,
          databaseId: clipA!.id as DatabaseId,
        },
        {
          type: "optimistically-added",
          frontendId: "opt-1" as FrontendId,
        },
      ];

      // Insert after optimistic clip - should resolve to after ClipA
      await clipService.appendClips({
        videoId: video.id,
        insertionPoint: {
          type: "after-clip",
          frontendClipId: "opt-1" as FrontendId,
        },
        items,
        clips: [{ inputVideo: "test.mp4", startTime: 10, endTime: 20 }],
      });

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline.map((t) => ({ type: t.type, id: t.data.id }))).toEqual([
        { type: "chapter", id: section.id },
        { type: "clip", id: clipA!.id },
        { type: "clip", id: expect.any(String) }, // New clip after clipA
      ]);
    });

    it("resolves after-chapter on optimistic section to nearest persisted item", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      // Seed: [Section1, ClipA] in DB
      const section = await clipService.createChapterAtInsertionPoint({
        videoId: video.id,
        name: "Section 1",
        insertionPoint: start,
        items: [],
      });
      const [clipA] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: afterSection(section.id),
        items: await getItems(clipService, video.id),
        clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
      });

      // Frontend items: [Section1 (db), ClipA (db), OptSection (optimistic)]
      const items: FrontendTimelineItem[] = [
        {
          type: "chapter-on-database",
          frontendId: section.id as FrontendId,
          databaseId: section.id as DatabaseId,
        },
        {
          type: "on-database",
          frontendId: clipA!.id as FrontendId,
          databaseId: clipA!.id as DatabaseId,
        },
        {
          type: "chapter-optimistically-added",
          frontendId: "opt-section-1" as FrontendId,
        },
      ];

      // Insert after optimistic section - should resolve to after ClipA
      await clipService.appendClips({
        videoId: video.id,
        insertionPoint: {
          type: "after-chapter",
          frontendChapterId: "opt-section-1" as FrontendId,
        },
        items,
        clips: [{ inputVideo: "test.mp4", startTime: 10, endTime: 20 }],
      });

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline.map((t) => ({ type: t.type, id: t.data.id }))).toEqual([
        { type: "chapter", id: section.id },
        { type: "clip", id: clipA!.id },
        { type: "clip", id: expect.any(String) }, // New clip after clipA
      ]);
    });

    it("resolves to start when no persisted items exist before optimistic item", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      // Frontend items: [OptClip (optimistic)] — no persisted items
      const items: FrontendTimelineItem[] = [
        {
          type: "optimistically-added",
          frontendId: "opt-1" as FrontendId,
        },
      ];

      // Insert after optimistic clip with no persisted items before it
      await clipService.appendClips({
        videoId: video.id,
        insertionPoint: {
          type: "after-clip",
          frontendClipId: "opt-1" as FrontendId,
        },
        items,
        clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
      });

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline).toHaveLength(1);
    });

    it("resolves end with only optimistic items to start", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      // Frontend items: [OptClip (optimistic)] — no persisted items
      const items: FrontendTimelineItem[] = [
        {
          type: "optimistically-added",
          frontendId: "opt-1" as FrontendId,
        },
      ];

      await clipService.appendClips({
        videoId: video.id,
        insertionPoint: end,
        items,
        clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
      });

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline).toHaveLength(1);
    });

    it("skips shouldArchive clips when resolving end insertion point", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      // Create clipA in DB then archive it (simulates optimistic delete -> DB pairing -> archive)
      const [clipA] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
      });
      await clipService.archiveClips([clipA!.id]);

      // Frontend still has clipA as on-database with shouldArchive: true
      const items: FrontendTimelineItem[] = [
        {
          type: "on-database",
          frontendId: clipA!.id as FrontendId,
          databaseId: clipA!.id as DatabaseId,
          shouldArchive: true,
        },
      ];

      mockVideoProcessing.getLatestOBSVideoClips = vi.fn().mockResolvedValue({
        clips: [
          { inputVideo: "/mnt/c/obs/video.mkv", startTime: 0, endTime: 10 },
        ],
      });

      // This should NOT throw "Could not find a clip to insert after"
      // because resolveInsertionPoint should skip the shouldArchive clip
      const result = await clipService.appendFromObs({
        videoId: video.id,
        insertionPoint: end,
        items,
      });

      expect(result).toHaveLength(1);
    });
  });
});
