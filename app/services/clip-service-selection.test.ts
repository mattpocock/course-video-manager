import * as schema from "@/db/schema";
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
  describe("createVideoFromSelection", () => {
    it("copy mode creates a new video with selected clips, originals remain in source", async () => {
      const video = await clipService.createVideo("source-video.mp4");

      const [clipA, clipB] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [
          { inputVideo: "footage.mp4", startTime: 0, endTime: 10 },
          { inputVideo: "footage.mp4", startTime: 10, endTime: 20 },
        ],
      });

      // Copy only clipA to a new video
      const newVideo = await clipService.createVideoFromSelection({
        sourceVideoId: video.id,
        clipIds: [clipA!.id],
        chapterIds: [],
        title: "New Video from Selection",
        mode: "copy",
      });

      expect(newVideo).toMatchObject({
        id: expect.any(String),
        path: "New Video from Selection",
      });

      // New video should have the copied clip
      const newTimeline = await clipService.getTimeline(newVideo.id);
      expect(newTimeline).toHaveLength(1);
      expect(newTimeline[0]!.type).toBe("clip");

      // Source video should still have both clips (originals remain)
      const sourceTimeline = await clipService.getTimeline(video.id);
      expect(sourceTimeline).toHaveLength(2);
      expect(sourceTimeline.map((t) => t.data.id)).toEqual([
        clipA!.id,
        clipB!.id,
      ]);
    });

    it("copy mode creates a new video with selected chapters, originals remain", async () => {
      const video = await clipService.createVideo("source-video.mp4");

      const sectionA = await clipService.createChapterAtInsertionPoint({
        videoId: video.id,
        name: "Section A",
        insertionPoint: start,
        items: [],
      });

      await clipService.createChapterAtInsertionPoint({
        videoId: video.id,
        name: "Section B",
        insertionPoint: afterSection(sectionA.id),
        items: await getItems(clipService, video.id),
      });

      // Copy only sectionA to a new video
      const newVideo = await clipService.createVideoFromSelection({
        sourceVideoId: video.id,
        clipIds: [],
        chapterIds: [sectionA.id],
        title: "Sections Video",
        mode: "copy",
      });

      // New video should have the copied section
      const newTimeline = await clipService.getTimeline(newVideo.id);
      expect(newTimeline).toHaveLength(1);
      expect(newTimeline[0]!.type).toBe("chapter");
      expect((newTimeline[0]!.data as any).name).toBe("Section A");

      // Source video should still have both sections
      const sourceTimeline = await clipService.getTimeline(video.id);
      expect(sourceTimeline).toHaveLength(2);
    });

    it("mixed selection creates a new video with all selected items", async () => {
      const video = await clipService.createVideo("source-video.mp4");

      const sectionA = await clipService.createChapterAtInsertionPoint({
        videoId: video.id,
        name: "Section A",
        insertionPoint: start,
        items: [],
      });

      const [clipA] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: afterSection(sectionA.id),
        items: await getItems(clipService, video.id),
        clips: [{ inputVideo: "footage.mp4", startTime: 0, endTime: 10 }],
      });

      await clipService.createChapterAtInsertionPoint({
        videoId: video.id,
        name: "Section B",
        insertionPoint: afterClip(clipA!.id),
        items: await getItems(clipService, video.id),
      });

      // Copy sectionA and clipA (mixed selection)
      const newVideo = await clipService.createVideoFromSelection({
        sourceVideoId: video.id,
        clipIds: [clipA!.id],
        chapterIds: [sectionA.id],
        title: "Mixed Selection",
        mode: "copy",
      });

      const newTimeline = await clipService.getTimeline(newVideo.id);
      expect(newTimeline).toHaveLength(2);
      expect(newTimeline.map((t) => t.type)).toEqual(["chapter", "clip"]);
    });

    it("items in new video preserve their relative order from source timeline", async () => {
      const video = await clipService.createVideo("source-video.mp4");

      // Create timeline: [ClipA, SectionX, ClipB, ClipC]
      const [clipA] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [{ inputVideo: "footage.mp4", startTime: 0, endTime: 10 }],
      });

      const sectionX = await clipService.createChapterAtInsertionPoint({
        videoId: video.id,
        name: "Section X",
        insertionPoint: afterClip(clipA!.id),
        items: await getItems(clipService, video.id),
      });

      const [, clipC] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: afterSection(sectionX.id),
        items: await getItems(clipService, video.id),
        clips: [
          { inputVideo: "footage.mp4", startTime: 10, endTime: 20 },
          { inputVideo: "footage.mp4", startTime: 20, endTime: 30 },
        ],
      });

      // Select ClipC, ClipA, SectionX (out of order) - should preserve original timeline order
      const newVideo = await clipService.createVideoFromSelection({
        sourceVideoId: video.id,
        clipIds: [clipC!.id, clipA!.id],
        chapterIds: [sectionX.id],
        title: "Ordered Selection",
        mode: "copy",
      });

      const newTimeline = await clipService.getTimeline(newVideo.id);
      expect(newTimeline).toHaveLength(3);
      // Should be in original timeline order: [ClipA, SectionX, ClipC]
      expect(newTimeline.map((t) => t.type)).toEqual([
        "clip",
        "chapter",
        "clip",
      ]);
    });

    it("copied clips retain all metadata", async () => {
      const video = await clipService.createVideo("source-video.mp4");

      const [clip] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [{ inputVideo: "footage.mp4", startTime: 5, endTime: 15 }],
      });

      // Update the clip with all metadata fields
      await clipService.updateClips([
        {
          id: clip!.id,
          scene: "intro-scene",
          profile: "main-camera",
          beatType: "hook",
        },
      ]);

      const newVideo = await clipService.createVideoFromSelection({
        sourceVideoId: video.id,
        clipIds: [clip!.id],
        chapterIds: [],
        title: "Metadata Test",
        mode: "copy",
      });

      const newTimeline = await clipService.getTimeline(newVideo.id);
      expect(newTimeline).toHaveLength(1);

      const copiedClip = newTimeline[0]!.data;
      expect(copiedClip).toMatchObject({
        videoFilename: "footage.mp4",
        sourceStartTime: 5,
        sourceEndTime: 15,
        scene: "intro-scene",
        profile: "main-camera",
        beatType: "hook",
      });
      // Copied clip should have a NEW id
      expect(copiedClip!.id).not.toBe(clip!.id);
    });

    it("copied chapters retain their names", async () => {
      const video = await clipService.createVideo("source-video.mp4");

      const section = await clipService.createChapterAtInsertionPoint({
        videoId: video.id,
        name: "Important Section Name",
        insertionPoint: start,
        items: [],
      });

      const newVideo = await clipService.createVideoFromSelection({
        sourceVideoId: video.id,
        clipIds: [],
        chapterIds: [section.id],
        title: "Section Name Test",
        mode: "copy",
      });

      const newTimeline = await clipService.getTimeline(newVideo.id);
      expect(newTimeline).toHaveLength(1);

      const copiedSection = newTimeline[0]!.data as typeof section;
      expect(copiedSection.name).toBe("Important Section Name");
      // Copied section should have a NEW id
      expect(copiedSection.id).not.toBe(section.id);
    });

    it("new video inherits lessonId from source video", async () => {
      // First create a video with a lesson association
      // We need to create the lesson structure first
      const repoVersionId = crypto.randomUUID();
      const sectionId = crypto.randomUUID();
      const lessonId = crypto.randomUUID();

      // Insert course, courseVersion, section, lesson directly
      await testDb.insert(schema.courses).values({
        id: crypto.randomUUID(),
        filePath: "/test",
        name: "Test Course",
      });

      await testDb.insert(schema.courseVersions).values({
        id: repoVersionId,
        repoId: (await testDb.query.courses.findFirst())!.id,
        name: "v1",
      });

      await testDb.insert(schema.sections).values({
        id: sectionId,
        repoVersionId,
        path: "/test/section",
        order: 0,
      });

      await testDb.insert(schema.lessons).values({
        id: lessonId,
        sectionId,
        path: "/test/lesson",
        order: 0,
        authoringStatus: "done",
      });

      // Create video with lessonId
      await testDb.insert(schema.videos).values({
        id: "source-video-id",
        path: "source-video.mp4",
        originalFootagePath: "",
        lessonId,
      });

      const video = (await testDb.query.videos.findFirst({
        where: (v, { eq }) => eq(v.id, "source-video-id"),
      }))!;

      const [clip] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [{ inputVideo: "footage.mp4", startTime: 0, endTime: 10 }],
      });

      const newVideo = await clipService.createVideoFromSelection({
        sourceVideoId: video.id,
        clipIds: [clip!.id],
        chapterIds: [],
        title: "Inherits Lesson",
        mode: "copy",
      });

      expect(newVideo.lessonId).toBe(lessonId);
    });

    it("selecting a single clip creates a valid new video", async () => {
      const video = await clipService.createVideo("source-video.mp4");

      const [clip] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [{ inputVideo: "footage.mp4", startTime: 0, endTime: 10 }],
      });

      const newVideo = await clipService.createVideoFromSelection({
        sourceVideoId: video.id,
        clipIds: [clip!.id],
        chapterIds: [],
        title: "Single Clip",
        mode: "copy",
      });

      expect(newVideo.id).toBeDefined();
      const newTimeline = await clipService.getTimeline(newVideo.id);
      expect(newTimeline).toHaveLength(1);
    });

    it("selecting all items creates a new video with everything", async () => {
      const video = await clipService.createVideo("source-video.mp4");

      const sectionA = await clipService.createChapterAtInsertionPoint({
        videoId: video.id,
        name: "Section A",
        insertionPoint: start,
        items: [],
      });

      const [clipA, clipB] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: afterSection(sectionA.id),
        items: await getItems(clipService, video.id),
        clips: [
          { inputVideo: "footage.mp4", startTime: 0, endTime: 10 },
          { inputVideo: "footage.mp4", startTime: 10, endTime: 20 },
        ],
      });

      // Select everything
      const newVideo = await clipService.createVideoFromSelection({
        sourceVideoId: video.id,
        clipIds: [clipA!.id, clipB!.id],
        chapterIds: [sectionA.id],
        title: "Complete Copy",
        mode: "copy",
      });

      const newTimeline = await clipService.getTimeline(newVideo.id);
      expect(newTimeline).toHaveLength(3);
      expect(newTimeline.map((t) => t.type)).toEqual([
        "chapter",
        "clip",
        "clip",
      ]);

      // Source should still have all items
      const sourceTimeline = await clipService.getTimeline(video.id);
      expect(sourceTimeline).toHaveLength(3);
    });
  });
});
