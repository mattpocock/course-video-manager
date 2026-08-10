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

const start: FrontendInsertionPoint = { type: "start" };

describe("ClipService", () => {
  describe("appendFromObs", () => {
    it("returns empty array when CLI detects no clips", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      mockVideoProcessing.getLatestOBSVideoClips = vi
        .fn()
        .mockResolvedValue({ clips: [] });

      const result = await clipService.appendFromObs({
        videoId: video.id,
        insertionPoint: start,
        items: [],
      });

      expect(result).toEqual([]);
      expect(mockVideoProcessing.getLatestOBSVideoClips).toHaveBeenCalledWith({
        filePath: undefined,
        startTime: undefined,
      });
    });

    it("inserts clips detected by CLI", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      mockVideoProcessing.getLatestOBSVideoClips = vi.fn().mockResolvedValue({
        clips: [
          { inputVideo: "/mnt/c/obs/video.mkv", startTime: 0, endTime: 10 },
          { inputVideo: "/mnt/c/obs/video.mkv", startTime: 15, endTime: 25 },
        ],
      });

      const result = await clipService.appendFromObs({
        videoId: video.id,
        insertionPoint: start,
        items: [],
      });

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        videoFilename: "/mnt/c/obs/video.mkv",
        sourceStartTime: 0,
        sourceEndTime: 10,
      });

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline).toHaveLength(2);
    });

    it("converts Windows path to WSL path", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      mockVideoProcessing.getLatestOBSVideoClips = vi
        .fn()
        .mockResolvedValue({ clips: [] });

      await clipService.appendFromObs({
        videoId: video.id,
        filePath: "C:\\Users\\Matt\\Videos\\obs\\recording.mkv",
        insertionPoint: start,
        items: [],
      });

      expect(mockVideoProcessing.getLatestOBSVideoClips).toHaveBeenCalledWith({
        filePath: "/mnt/c/Users/Matt/Videos/obs/recording.mkv",
        startTime: undefined,
      });
    });

    it("deduplicates clips that already exist", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      // First, add a clip directly
      await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [
          { inputVideo: "/mnt/c/obs/video.mkv", startTime: 0, endTime: 10 },
        ],
      });

      // CLI returns the same clip plus a new one
      mockVideoProcessing.getLatestOBSVideoClips = vi.fn().mockResolvedValue({
        clips: [
          { inputVideo: "/mnt/c/obs/video.mkv", startTime: 0, endTime: 10 }, // duplicate
          { inputVideo: "/mnt/c/obs/video.mkv", startTime: 15, endTime: 25 }, // new
        ],
      });

      const result = await clipService.appendFromObs({
        videoId: video.id,
        insertionPoint: start,
        items: await getItems(clipService, video.id),
      });

      // Should only add the new clip
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        sourceStartTime: 15,
        sourceEndTime: 25,
      });

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline).toHaveLength(2);
    });

    it("deduplicates clips with nearly identical start/end times (rounding tolerance)", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      // First, add a clip directly
      await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [
          {
            inputVideo: "/mnt/c/obs/video.mkv",
            startTime: 441.88,
            endTime: 445.06,
          },
        ],
      });

      // CLI returns the "same" clip but with slightly different times (float rounding)
      mockVideoProcessing.getLatestOBSVideoClips = vi.fn().mockResolvedValue({
        clips: [
          {
            inputVideo: "/mnt/c/obs/video.mkv",
            startTime: 441.87,
            endTime: 445.07,
          },
        ],
      });

      const result = await clipService.appendFromObs({
        videoId: video.id,
        insertionPoint: start,
        items: await getItems(clipService, video.id),
      });

      // Should be skipped as a duplicate — times differ by only 0.01s
      expect(result).toHaveLength(0);

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline).toHaveLength(1);
    });

    it("deduplicates clips with drifted startTime from ffmpeg re-detection (0.57s drift)", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      // First clip inserted correctly
      await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [
          {
            inputVideo: "/mnt/c/obs/video.mkv",
            startTime: 2.05,
            endTime: 5.33,
          },
        ],
      });

      // Re-detection returns same clip with drifted startTime (0.57s difference)
      mockVideoProcessing.getLatestOBSVideoClips = vi.fn().mockResolvedValue({
        clips: [
          {
            inputVideo: "/mnt/c/obs/video.mkv",
            startTime: 1.48,
            endTime: 5.33,
          },
        ],
      });

      const result = await clipService.appendFromObs({
        videoId: video.id,
        insertionPoint: start,
        items: await getItems(clipService, video.id),
      });

      // Should be skipped as a duplicate — 0.57s drift is within 0.6s tolerance
      expect(result).toHaveLength(0);

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline).toHaveLength(1);
    });

    it("inserts genuinely distinct clips that differ by more than 0.6s", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      // First clip
      await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [
          {
            inputVideo: "/mnt/c/obs/video.mkv",
            startTime: 2.0,
            endTime: 5.0,
          },
        ],
      });

      // New clip with start and end both differing by more than 0.6s
      mockVideoProcessing.getLatestOBSVideoClips = vi.fn().mockResolvedValue({
        clips: [
          {
            inputVideo: "/mnt/c/obs/video.mkv",
            startTime: 8.0,
            endTime: 12.0,
          },
        ],
      });

      const result = await clipService.appendFromObs({
        videoId: video.id,
        insertionPoint: start,
        items: await getItems(clipService, video.id),
      });

      // Should be inserted — clearly a different clip
      expect(result).toHaveLength(1);

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline).toHaveLength(2);
    });

    it("calculates start time from last clip with same input video", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      // Add existing clip
      await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [
          { inputVideo: "/mnt/c/obs/video.mkv", startTime: 0, endTime: 100 },
        ],
      });

      mockVideoProcessing.getLatestOBSVideoClips = vi.fn().mockResolvedValue({
        clips: [
          { inputVideo: "/mnt/c/obs/video.mkv", startTime: 150, endTime: 200 },
        ],
      });

      await clipService.appendFromObs({
        videoId: video.id,
        filePath: "C:\\obs\\video.mkv",
        insertionPoint: start,
        items: await getItems(clipService, video.id),
      });

      // Should pass startTime = endTime of last clip - 1 = 99
      expect(mockVideoProcessing.getLatestOBSVideoClips).toHaveBeenCalledWith({
        filePath: "/mnt/c/obs/video.mkv",
        startTime: 99,
      });
    });

    it("inserts clips at specified insertion point", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      // Add existing clip
      const [existingClip] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [{ inputVideo: "other.mkv", startTime: 0, endTime: 10 }],
      });

      mockVideoProcessing.getLatestOBSVideoClips = vi.fn().mockResolvedValue({
        clips: [
          { inputVideo: "/mnt/c/obs/new.mkv", startTime: 0, endTime: 10 },
        ],
      });

      const result = await clipService.appendFromObs({
        videoId: video.id,
        insertionPoint: afterClip(existingClip!.id),
        items: await getItems(clipService, video.id),
      });

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline.map((t) => t.data.id)).toEqual([
        existingClip!.id,
        result[0]!.id,
      ]);
    });

    it("serializes concurrent append-from-obs calls via mutex", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      mockVideoProcessing.getLatestOBSVideoClips = vi.fn().mockResolvedValue({
        clips: [
          { inputVideo: "/mnt/c/obs/video.mkv", startTime: 0, endTime: 10 },
          { inputVideo: "/mnt/c/obs/video.mkv", startTime: 15, endTime: 25 },
        ],
      });

      // Fire two concurrent appendFromObs calls — mutex serializes them
      const [result1, result2] = await Promise.all([
        clipService.appendFromObs({
          videoId: video.id,
          insertionPoint: start,
          items: [],
        }),
        clipService.appendFromObs({
          videoId: video.id,
          insertionPoint: start,
          items: [],
        }),
      ]);

      // One call inserts clips, the other finds them as duplicates
      const totalInserted = result1.length + result2.length;
      expect(totalInserted).toBe(2);

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline).toHaveLength(2);
    });

    it("mutex releases on error allowing subsequent calls", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      // First call: mock throws
      mockVideoProcessing.getLatestOBSVideoClips = vi
        .fn()
        .mockRejectedValueOnce(new Error("CLI failed"))
        .mockResolvedValueOnce({
          clips: [
            { inputVideo: "/mnt/c/obs/video.mkv", startTime: 0, endTime: 10 },
          ],
        });

      // First call should fail
      await expect(
        clipService.appendFromObs({
          videoId: video.id,
          insertionPoint: start,
          items: [],
        })
      ).rejects.toThrow();

      // Second call should succeed — mutex was released
      const result = await clipService.appendFromObs({
        videoId: video.id,
        insertionPoint: start,
        items: [],
      });

      expect(result).toHaveLength(1);
    });
  });
});
