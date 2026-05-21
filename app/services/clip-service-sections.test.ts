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

describe("ClipService", () => {
  describe("createChapterAtInsertionPoint", () => {
    it("creates a section at the start", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      const section = await clipService.createChapterAtInsertionPoint({
        videoId: video.id,
        name: "Intro Section",
        insertionPoint: start,
        items: [],
      });

      expect(section).toMatchObject({
        id: expect.any(String),
        videoId: video.id,
        name: "Intro Section",
      });

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline).toHaveLength(1);
      expect(timeline[0]).toMatchObject({ type: "chapter" });
    });

    it("creates a section after a clip", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      const [clip] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
      });

      const section = await clipService.createChapterAtInsertionPoint({
        videoId: video.id,
        name: "After Clip Chapter",
        insertionPoint: afterClip(clip!.id),
        items: await getItems(clipService, video.id),
      });

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline.map((t) => ({ type: t.type, id: t.data.id }))).toEqual([
        { type: "clip", id: clip!.id },
        { type: "chapter", id: section.id },
      ]);
    });
  });

  describe("createChapterAtPosition", () => {
    it("creates a section before a clip", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      const [clip] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
      });

      const section = await clipService.createChapterAtPosition({
        videoId: video.id,
        name: "Before Clip",
        position: "before",
        targetItemId: clip!.id,
        targetItemType: "clip",
      });

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline.map((t) => ({ type: t.type, id: t.data.id }))).toEqual([
        { type: "chapter", id: section.id },
        { type: "clip", id: clip!.id },
      ]);
    });

    it("creates a section after a clip", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      const [clip] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
      });

      const section = await clipService.createChapterAtPosition({
        videoId: video.id,
        name: "After Clip",
        position: "after",
        targetItemId: clip!.id,
        targetItemType: "clip",
      });

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline.map((t) => ({ type: t.type, id: t.data.id }))).toEqual([
        { type: "clip", id: clip!.id },
        { type: "chapter", id: section.id },
      ]);
    });
  });

  describe("updateChapter", () => {
    it("updates the name of a chapter", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      const section = await clipService.createChapterAtInsertionPoint({
        videoId: video.id,
        name: "Original Name",
        insertionPoint: start,
        items: [],
      });

      await clipService.updateChapter(section.id, "Updated Name");

      const timeline = await clipService.getTimeline(video.id);
      const updatedSection = timeline[0]!.data;
      expect((updatedSection as typeof section).name).toBe("Updated Name");
    });
  });

  describe("archiveChapters", () => {
    it("archives a chapter", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      const section = await clipService.createChapterAtInsertionPoint({
        videoId: video.id,
        name: "To Archive",
        insertionPoint: start,
        items: [],
      });

      await clipService.archiveChapters([section.id]);

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline).toHaveLength(0);
    });
  });

  describe("reorderChapter", () => {
    it("moves a section up past a clip", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      const [clip] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
      });

      const section = await clipService.createChapterAtInsertionPoint({
        videoId: video.id,
        name: "Section",
        insertionPoint: afterClip(clip!.id),
        items: await getItems(clipService, video.id),
      });

      // Move section up (before the clip)
      await clipService.reorderChapter(section.id, "up");

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline.map((t) => ({ type: t.type, id: t.data.id }))).toEqual([
        { type: "chapter", id: section.id },
        { type: "clip", id: clip!.id },
      ]);
    });

    it("preserves ordering when moving a section up past another section", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      // Build timeline: [SectionA, Clip1, SectionB, Clip2, SectionC]
      const sectionA = await clipService.createChapterAtInsertionPoint({
        videoId: video.id,
        name: "Section A",
        insertionPoint: start,
        items: [],
      });

      const [clip1] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: afterSection(sectionA.id),
        items: await getItems(clipService, video.id),
        clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
      });

      const sectionB = await clipService.createChapterAtInsertionPoint({
        videoId: video.id,
        name: "Section B",
        insertionPoint: afterClip(clip1!.id),
        items: await getItems(clipService, video.id),
      });

      const [clip2] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: afterSection(sectionB.id),
        items: await getItems(clipService, video.id),
        clips: [{ inputVideo: "test.mp4", startTime: 10, endTime: 20 }],
      });

      const sectionC = await clipService.createChapterAtInsertionPoint({
        videoId: video.id,
        name: "Section C",
        insertionPoint: afterClip(clip2!.id),
        items: await getItems(clipService, video.id),
      });

      // Move SectionB up (past Clip1, which puts it next to SectionA)
      // Expected: [SectionA, SectionB, Clip1, Clip2, SectionC]
      await clipService.reorderChapter(sectionB.id, "up");

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline.map((t) => ({ type: t.type, id: t.data.id }))).toEqual([
        { type: "chapter", id: sectionA.id },
        { type: "chapter", id: sectionB.id },
        { type: "clip", id: clip1!.id },
        { type: "clip", id: clip2!.id },
        { type: "chapter", id: sectionC.id },
      ]);

      // Now move SectionB up again (past SectionA)
      // Expected: [SectionB, SectionA, Clip1, Clip2, SectionC]
      await clipService.reorderChapter(sectionB.id, "up");

      const timeline2 = await clipService.getTimeline(video.id);
      expect(timeline2.map((t) => ({ type: t.type, id: t.data.id }))).toEqual([
        { type: "chapter", id: sectionB.id },
        { type: "chapter", id: sectionA.id },
        { type: "clip", id: clip1!.id },
        { type: "clip", id: clip2!.id },
        { type: "chapter", id: sectionC.id },
      ]);
    });

    it("moves a section up past an adjacent section (no clips between)", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      // Build timeline: [Clip1, SectionA, SectionB, Clip2]
      const [clip1] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
      });

      const sectionA = await clipService.createChapterAtInsertionPoint({
        videoId: video.id,
        name: "Section A",
        insertionPoint: afterClip(clip1!.id),
        items: await getItems(clipService, video.id),
      });

      const sectionB = await clipService.createChapterAtInsertionPoint({
        videoId: video.id,
        name: "Section B",
        insertionPoint: afterSection(sectionA.id),
        items: await getItems(clipService, video.id),
      });

      const [clip2] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: afterSection(sectionB.id),
        items: await getItems(clipService, video.id),
        clips: [{ inputVideo: "test.mp4", startTime: 10, endTime: 20 }],
      });

      // Move SectionB up (past SectionA)
      // Expected: [Clip1, SectionB, SectionA, Clip2]
      await clipService.reorderChapter(sectionB.id, "up");

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline.map((t) => ({ type: t.type, id: t.data.id }))).toEqual([
        { type: "clip", id: clip1!.id },
        { type: "chapter", id: sectionB.id },
        { type: "chapter", id: sectionA.id },
        { type: "clip", id: clip2!.id },
      ]);
    });

    it("preserves ordering when sections created via createChapterAtPosition are moved", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      // Create clips first: [Clip1, Clip2, Clip3, Clip4]
      const allClips = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [
          { inputVideo: "test.mp4", startTime: 0, endTime: 10 },
          { inputVideo: "test.mp4", startTime: 10, endTime: 20 },
          { inputVideo: "test.mp4", startTime: 20, endTime: 30 },
          { inputVideo: "test.mp4", startTime: 30, endTime: 40 },
        ],
      });

      const [clip1, clip2, clip3, clip4] = allClips;

      // Add sections using createChapterAtPosition (context menu style)
      // Add SectionA before Clip2: [Clip1, SectionA, Clip2, Clip3, Clip4]
      const sectionA = await clipService.createChapterAtPosition({
        videoId: video.id,
        name: "Section A",
        position: "before",
        targetItemId: clip2!.id,
        targetItemType: "clip",
      });

      // Add SectionB before Clip4: [Clip1, SectionA, Clip2, Clip3, SectionB, Clip4]
      const sectionB = await clipService.createChapterAtPosition({
        videoId: video.id,
        name: "Section B",
        position: "before",
        targetItemId: clip4!.id,
        targetItemType: "clip",
      });

      // Verify initial timeline
      const initialTimeline = await clipService.getTimeline(video.id);
      expect(
        initialTimeline.map((t) => ({ type: t.type, id: t.data.id }))
      ).toEqual([
        { type: "clip", id: clip1!.id },
        { type: "chapter", id: sectionA.id },
        { type: "clip", id: clip2!.id },
        { type: "clip", id: clip3!.id },
        { type: "chapter", id: sectionB.id },
        { type: "clip", id: clip4!.id },
      ]);

      // Move SectionB up (past Clip3)
      // Expected: [Clip1, SectionA, Clip2, SectionB, Clip3, Clip4]
      await clipService.reorderChapter(sectionB.id, "up");

      const timeline1 = await clipService.getTimeline(video.id);
      expect(timeline1.map((t) => ({ type: t.type, id: t.data.id }))).toEqual([
        { type: "clip", id: clip1!.id },
        { type: "chapter", id: sectionA.id },
        { type: "clip", id: clip2!.id },
        { type: "chapter", id: sectionB.id },
        { type: "clip", id: clip3!.id },
        { type: "clip", id: clip4!.id },
      ]);

      // Move SectionB up again (past Clip2)
      // Expected: [Clip1, SectionA, SectionB, Clip2, Clip3, Clip4]
      await clipService.reorderChapter(sectionB.id, "up");

      const timeline2 = await clipService.getTimeline(video.id);
      expect(timeline2.map((t) => ({ type: t.type, id: t.data.id }))).toEqual([
        { type: "clip", id: clip1!.id },
        { type: "chapter", id: sectionA.id },
        { type: "chapter", id: sectionB.id },
        { type: "clip", id: clip2!.id },
        { type: "clip", id: clip3!.id },
        { type: "clip", id: clip4!.id },
      ]);

      // Move SectionB up again (past SectionA)
      // Expected: [Clip1, SectionB, SectionA, Clip2, Clip3, Clip4]
      await clipService.reorderChapter(sectionB.id, "up");

      const timeline3 = await clipService.getTimeline(video.id);
      expect(timeline3.map((t) => ({ type: t.type, id: t.data.id }))).toEqual([
        { type: "clip", id: clip1!.id },
        { type: "chapter", id: sectionB.id },
        { type: "chapter", id: sectionA.id },
        { type: "clip", id: clip2!.id },
        { type: "clip", id: clip3!.id },
        { type: "clip", id: clip4!.id },
      ]);
    });
  });
});
