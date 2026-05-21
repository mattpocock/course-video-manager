import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import {
  createDirectClipService,
  type VideoProcessingAdapter,
} from "./clip-service-handler";
import type { ClipService, FrontendInsertionPoint } from "./clip-service";
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

const start: FrontendInsertionPoint = { type: "start" };

const effectClipDefaults = {
  videoFilename: "/path/to/assets/effects/white-noise.mp4",
  sourceStartTime: 0,
  sourceEndTime: 0.5,
  text: "*white noise*",
  scene: "white noise",
  profile: "main-camera",
  beatType: "none",
};

describe("ClipService", () => {
  describe("createEffectClipAtPosition", () => {
    it("creates an effect clip before a clip", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      const [clip] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
      });

      const effectClip = await clipService.createEffectClipAtPosition({
        videoId: video.id,
        position: "before",
        targetItemId: clip!.id,
        targetItemType: "clip",
        ...effectClipDefaults,
      });

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline.map((t) => ({ type: t.type, id: t.data.id }))).toEqual([
        { type: "clip", id: effectClip.id },
        { type: "clip", id: clip!.id },
      ]);
    });

    it("creates an effect clip after a clip", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      const [clip] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
      });

      const effectClip = await clipService.createEffectClipAtPosition({
        videoId: video.id,
        position: "after",
        targetItemId: clip!.id,
        targetItemType: "clip",
        ...effectClipDefaults,
      });

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline.map((t) => ({ type: t.type, id: t.data.id }))).toEqual([
        { type: "clip", id: clip!.id },
        { type: "clip", id: effectClip.id },
      ]);
    });

    it("creates an effect clip with correct field values", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      const [clip] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
      });

      const effectClip = await clipService.createEffectClipAtPosition({
        videoId: video.id,
        position: "after",
        targetItemId: clip!.id,
        targetItemType: "clip",
        ...effectClipDefaults,
      });

      expect(effectClip).toMatchObject({
        id: expect.any(String),
        videoId: video.id,
        videoFilename: "/path/to/assets/effects/white-noise.mp4",
        sourceStartTime: 0,
        sourceEndTime: 0.5,
        text: "*white noise*",
        scene: "white noise",
        profile: "main-camera",
        beatType: "none",
        archived: false,
        transcribedAt: expect.any(Date),
      });
    });

    it("inserts effect clip between two existing clips with correct ordering", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      const [clip1, clip2] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [
          { inputVideo: "test.mp4", startTime: 0, endTime: 10 },
          { inputVideo: "test.mp4", startTime: 10, endTime: 20 },
        ],
      });

      const effectClip = await clipService.createEffectClipAtPosition({
        videoId: video.id,
        position: "after",
        targetItemId: clip1!.id,
        targetItemType: "clip",
        ...effectClipDefaults,
      });

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline.map((t) => ({ type: t.type, id: t.data.id }))).toEqual([
        { type: "clip", id: clip1!.id },
        { type: "clip", id: effectClip.id },
        { type: "clip", id: clip2!.id },
      ]);
    });

    it("inserts effect clip before a chapter", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      const [clip] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
      });

      const section = await clipService.createChapterAtPosition({
        videoId: video.id,
        name: "Section",
        position: "after",
        targetItemId: clip!.id,
        targetItemType: "clip",
      });

      const effectClip = await clipService.createEffectClipAtPosition({
        videoId: video.id,
        position: "before",
        targetItemId: section.id,
        targetItemType: "chapter",
        ...effectClipDefaults,
      });

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline.map((t) => ({ type: t.type, id: t.data.id }))).toEqual([
        { type: "clip", id: clip!.id },
        { type: "clip", id: effectClip.id },
        { type: "chapter", id: section.id },
      ]);
    });
  });
});
