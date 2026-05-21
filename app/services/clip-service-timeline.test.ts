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
  describe("createVideo", () => {
    it("creates a standalone video", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      expect(video).toMatchObject({
        id: expect.any(String),
        path: "test-video.mp4",
        lessonId: null,
      });
    });
  });

  describe("getTimeline", () => {
    it("returns an empty timeline for a video with no clips", async () => {
      const video = await clipService.createVideo("test-video.mp4");
      const timeline = await clipService.getTimeline(video.id);

      expect(timeline).toEqual([]);
    });

    it("returns clips sorted by order", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      const clips = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [
          { inputVideo: "test.mp4", startTime: 0, endTime: 10 },
          { inputVideo: "test.mp4", startTime: 10, endTime: 20 },
        ],
      });

      const timeline = await clipService.getTimeline(video.id);

      expect(timeline).toHaveLength(2);
      expect(timeline[0]).toMatchObject({ type: "clip" });
      expect(timeline[1]).toMatchObject({ type: "clip" });
      expect(timeline[0]!.data.id).toBe(clips[0]!.id);
      expect(timeline[1]!.data.id).toBe(clips[1]!.id);
    });

    it("returns clips and sections interleaved and sorted", async () => {
      const video = await clipService.createVideo("test-video.mp4");

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

      const [clipB] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: afterSection(section.id),
        items: await getItems(clipService, video.id),
        clips: [{ inputVideo: "test.mp4", startTime: 10, endTime: 20 }],
      });

      const timeline = await clipService.getTimeline(video.id);

      expect(timeline).toHaveLength(3);
      expect(timeline.map((t) => ({ type: t.type, id: t.data.id }))).toEqual([
        { type: "clip", id: clipA!.id },
        { type: "chapter", id: section.id },
        { type: "clip", id: clipB!.id },
      ]);
    });
  });

  describe("appendClips", () => {
    it("inserts clips at start", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      const clips = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
      });

      expect(clips).toHaveLength(1);
      expect(clips[0]).toMatchObject({
        id: expect.any(String),
        videoId: video.id,
        videoFilename: "test.mp4",
        sourceStartTime: 0,
        sourceEndTime: 10,
      });
    });

    it("inserts clips after an existing clip", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      const [clipA] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
      });

      await clipService.appendClips({
        videoId: video.id,
        insertionPoint: afterClip(clipA!.id),
        items: await getItems(clipService, video.id),
        clips: [{ inputVideo: "test.mp4", startTime: 10, endTime: 20 }],
      });

      const timeline = await clipService.getTimeline(video.id);

      expect(timeline).toHaveLength(2);
      expect(timeline[0]!.data.id).toBe(clipA!.id);
    });

    it("inserts clips after a chapter", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      const section = await clipService.createChapterAtInsertionPoint({
        videoId: video.id,
        name: "Section 1",
        insertionPoint: start,
        items: [],
      });

      const clips = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: afterSection(section.id),
        items: await getItems(clipService, video.id),
        clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
      });

      const timeline = await clipService.getTimeline(video.id);

      expect(timeline).toHaveLength(2);
      expect(timeline[0]).toMatchObject({ type: "chapter" });
      expect(timeline[1]).toMatchObject({ type: "clip" });
      expect(timeline[1]!.data.id).toBe(clips[0]!.id);
    });

    it("inserts clips at end when last item is a clip", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      const [clipA] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
      });

      await clipService.appendClips({
        videoId: video.id,
        insertionPoint: end,
        items: await getItems(clipService, video.id),
        clips: [{ inputVideo: "test.mp4", startTime: 10, endTime: 20 }],
      });

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline).toHaveLength(2);
      expect(timeline[0]!.data.id).toBe(clipA!.id);
    });

    it("inserts clips at end when last item is a section", async () => {
      const video = await clipService.createVideo("test-video.mp4");

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

      await clipService.appendClips({
        videoId: video.id,
        insertionPoint: end,
        items: await getItems(clipService, video.id),
        clips: [{ inputVideo: "test.mp4", startTime: 10, endTime: 20 }],
      });

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline).toHaveLength(3);
      expect(timeline.map((t) => t.data.id)).toEqual([
        clipA!.id,
        section.id,
        expect.any(String),
      ]);
    });

    it("inserts at start when end is used with empty timeline", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      const clips = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: end,
        items: [],
        clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
      });

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline).toHaveLength(1);
      expect(timeline[0]!.data.id).toBe(clips[0]!.id);
    });
  });

  describe("archiveClips", () => {
    it("archives a single clip", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      const [clip] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
      });

      await clipService.archiveClips([clip!.id]);

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline).toHaveLength(0);
    });

    it("archives multiple clips", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      const clips = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [
          { inputVideo: "test.mp4", startTime: 0, endTime: 10 },
          { inputVideo: "test.mp4", startTime: 10, endTime: 20 },
        ],
      });

      await clipService.archiveClips(clips.map((c) => c.id));

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline).toHaveLength(0);
    });
  });

  describe("updateClips", () => {
    it("updates scene, profile, and beatType for a clip", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      const [clip] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
      });

      await clipService.updateClips([
        {
          id: clip!.id,
          scene: "intro",
          profile: "default",
          beatType: "start",
        },
      ]);

      const timeline = await clipService.getTimeline(video.id);
      const timelineItem = timeline[0]!;

      expect(timelineItem.type).toBe("clip");
      if (timelineItem.type === "clip") {
        expect(timelineItem.data.scene).toBe("intro");
        expect(timelineItem.data.profile).toBe("default");
        expect(timelineItem.data.beatType).toBe("start");
      }
    });
  });

  describe("updateBeat", () => {
    it("updates beat type for a single clip", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      const [clip] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
      });

      await clipService.updateBeat(clip!.id, "transition");

      const timeline = await clipService.getTimeline(video.id);
      const timelineItem = timeline[0]!;

      expect(timelineItem.type).toBe("clip");
      if (timelineItem.type === "clip") {
        expect(timelineItem.data.beatType).toBe("transition");
      }
    });
  });

  describe("reorderClip", () => {
    it("moves a clip up past another clip", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      const clips = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [
          { inputVideo: "test.mp4", startTime: 0, endTime: 10 },
          { inputVideo: "test.mp4", startTime: 10, endTime: 20 },
        ],
      });

      const [clipA, clipB] = clips;

      // Move clipB up
      await clipService.reorderClip(clipB!.id, "up");

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline.map((t) => t.data.id)).toEqual([clipB!.id, clipA!.id]);
    });

    it("moves a clip down past another clip", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      const clips = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [
          { inputVideo: "test.mp4", startTime: 0, endTime: 10 },
          { inputVideo: "test.mp4", startTime: 10, endTime: 20 },
        ],
      });

      const [clipA, clipB] = clips;

      // Move clipA down
      await clipService.reorderClip(clipA!.id, "down");

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline.map((t) => t.data.id)).toEqual([clipB!.id, clipA!.id]);
    });
  });
});
