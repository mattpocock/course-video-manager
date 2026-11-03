import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { VideoOperationsService } from "./db-video-operations.server.js";
import { CourseOperationsService } from "./db-course-operations.server.js";
import { DrizzleService } from "./drizzle-service.server.js";
import { asc, eq } from "drizzle-orm";
import {
  clipLayers,
  clips,
  courses,
  courseVersions,
  lessons,
  sections,
  videos,
} from "../db/schema.js";
import { VIDEO_FORMATS } from "../features/videos/video-format.js";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "../test-utils/test-db.js";

let testDb: TestDb;
let testLayer: Layer.Layer<VideoOperationsService>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;

  const drizzleLayer = Layer.succeed(DrizzleService, testDb as any);
  testLayer = VideoOperationsService.Default.pipe(
    Layer.provide(
      CourseOperationsService.Default.pipe(Layer.provide(drizzleLayer))
    ),
    Layer.provide(drizzleLayer)
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

describe("video format", () => {
  it.effect("creates a short video with format short", () =>
    Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;
      const video = yield* videoOps.createStandaloneVideo({
        title: "Short Video",
        format: "short",
      });

      expect(video.format).toBe("short");
      expect(video.lessonId).toBeNull();
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("updateVideoFormat sets format and clears lessonId", () =>
    Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;
      const video = yield* videoOps.createStandaloneVideo({
        title: "Test Video",
        format: "landscape",
      });

      const updated = yield* videoOps.updateVideoFormat({
        videoId: video.id,
        format: "short",
      });

      expect(updated.format).toBe("short");
      expect(updated.lessonId).toBeNull();
    }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "getAllStandaloneVideos with format filter returns only matching",
    () =>
      Effect.gen(function* () {
        const videoOps = yield* VideoOperationsService;

        yield* videoOps.createStandaloneVideo({
          title: "Standard",
          format: "landscape",
        });
        yield* videoOps.createStandaloneVideo({
          title: "Short",
          format: "short",
        });

        const shorts = yield* videoOps.getAllStandaloneVideos({
          format: "short",
        });
        expect(shorts).toHaveLength(1);
        expect(shorts[0]!.title).toBe("Short");

        const standards = yield* videoOps.getAllStandaloneVideos({
          format: "landscape",
        });
        expect(standards).toHaveLength(1);
        expect(standards[0]!.title).toBe("Standard");

        const all = yield* videoOps.getAllStandaloneVideos();
        expect(all).toHaveLength(2);
      }).pipe(Effect.provide(testLayer))
  );

  it.effect("format filter excludes archived shorts", () =>
    Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;

      const short = yield* videoOps.createStandaloneVideo({
        title: "Active Short",
        format: "short",
      });
      const archivedShort = yield* videoOps.createStandaloneVideo({
        title: "Archived Short",
        format: "short",
      });
      yield* videoOps.deleteVideo(archivedShort.id);

      const shorts = yield* videoOps.getAllStandaloneVideos({
        format: "short",
      });
      expect(shorts).toHaveLength(1);
      expect(shorts[0]!.id).toBe(short.id);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "getArchivedStandaloneVideos with format filter returns only matching",
    () =>
      Effect.gen(function* () {
        const videoOps = yield* VideoOperationsService;

        const archivedStandard = yield* videoOps.createStandaloneVideo({
          title: "Archived Standard",
          format: "landscape",
        });
        const archivedShort = yield* videoOps.createStandaloneVideo({
          title: "Archived Short",
          format: "short",
        });

        yield* videoOps.deleteVideo(archivedStandard.id);
        yield* videoOps.deleteVideo(archivedShort.id);

        const standardOnly = yield* videoOps.getArchivedStandaloneVideos({
          format: "landscape",
        });
        expect(standardOnly).toHaveLength(1);
        expect(standardOnly[0]!.title).toBe("Archived Standard");

        const shortOnly = yield* videoOps.getArchivedStandaloneVideos({
          format: "short",
        });
        expect(shortOnly).toHaveLength(1);
        expect(shortOnly[0]!.title).toBe("Archived Short");

        const all = yield* videoOps.getArchivedStandaloneVideos();
        expect(all).toHaveLength(2);
      }).pipe(Effect.provide(testLayer))
  );

  // Production ran for months with every Video on the retired 'standard'
  // format (migration 0004 was skipped), invisible to `--format landscape`.
  // The column now defaults to landscape and refuses anything else.
  it("defaults a Video with no format to landscape", async () => {
    const [row] = await testDb
      .insert(videos)
      .values({ title: "No format", originalFootagePath: "" })
      .returning();
    expect(row!.format).toBe("landscape");
  });

  it("accepts every VIDEO_FORMATS value and refuses anything else", async () => {
    for (const format of VIDEO_FORMATS) {
      await testDb
        .insert(videos)
        .values({ title: format, originalFootagePath: "", format });
    }
    await expect(
      testDb.insert(videos).values({
        title: "Retired",
        originalFootagePath: "",
        format: "standard",
      })
    ).rejects.toThrow();
  });

  describe("carries Footage Layers into the new frame", () => {
    /**
     * A Landscape Video's Clip: a Scene Layer, a full-frame Footage Layer and
     * a partial one (a 16:9 box in the bottom-right corner, cropped to the
     * source's bottom-right quarter); and a Clip with no stored Layers.
     */
    const seed = (lessonId: string | null = null) =>
      Effect.promise(async () => {
        await testDb.insert(videos).values({
          id: "video",
          lessonId,
          title: "Video",
          originalFootagePath: "/footage",
          format: "landscape",
        });
        await testDb.insert(clips).values([
          {
            id: "layered",
            videoId: "video",
            videoFilename: "a.mp4",
            sourceStartTime: 0,
            sourceEndTime: 5,
            order: "a0",
            text: "",
          },
          {
            id: "untouched",
            videoId: "video",
            videoFilename: "a.mp4",
            sourceStartTime: 5,
            sourceEndTime: 9,
            order: "a1",
            text: "",
          },
        ]);
        const footage = {
          clipId: "layered",
          kind: "footage" as const,
          footagePath: "/broll.mp4",
          footageStart: 2,
          volume: 0,
          spanAt: 1,
          spanDuration: 3,
        };
        await testDb.insert(clipLayers).values([
          { clipId: "layered", position: 0, kind: "scene", volume: 1 },
          {
            ...footage,
            position: 1,
            cropX: 0,
            cropY: 0,
            cropW: 1,
            cropH: 1,
            placeX: 0,
            placeY: 0,
            placeW: 1920,
            placeH: 1080,
          },
          {
            ...footage,
            position: 2,
            cropX: 0.5,
            cropY: 0.5,
            cropW: 0.5,
            cropH: 0.5,
            placeX: 1440,
            placeY: 810,
            placeW: 480,
            placeH: 270,
          },
        ]);
      });

    const layerRows = () =>
      Effect.promise(() =>
        testDb
          .select()
          .from(clipLayers)
          .where(eq(clipLayers.clipId, "layered"))
          .orderBy(asc(clipLayers.position))
      );
    const videoRow = () =>
      Effect.promise(async () => {
        const [row] = await testDb
          .select()
          .from(videos)
          .where(eq(videos.id, "video"));
        return row!;
      });
    /** Placement exactly; Source Crop to 9 places (it is a float). */
    const expectGeometry = (
      row: typeof clipLayers.$inferSelect,
      want: { place: number[]; crop: number[] }
    ) => {
      expect([row.placeX, row.placeY, row.placeW, row.placeH]).toEqual(
        want.place
      );
      const crop = [row.cropX, row.cropY, row.cropW, row.cropH];
      want.crop.forEach((value, i) => expect(crop[i]).toBeCloseTo(value, 9));
    };
    const withoutGeometry = ({
      placeX: _px,
      placeY: _py,
      placeW: _pw,
      placeH: _ph,
      cropX: _cx,
      cropY: _cy,
      cropW: _cw,
      cropH: _ch,
      ...rest
    }: typeof clipLayers.$inferSelect) => rest;
    const withoutFormat = ({
      format: _f,
      updatedAt: _u,
      ...rest
    }: typeof videos.$inferSelect) => rest;

    it.effect(
      "Landscape to Short and back moves Placements by fractions, narrows Source Crops, and keeps the rest",
      () =>
        Effect.gen(function* () {
          yield* seed();
          const videoOps = yield* VideoOperationsService;
          const before = yield* layerRows();
          const videoBefore = yield* videoRow();

          yield* videoOps.updateVideoFormat({
            videoId: "video",
            format: "short",
          });
          const short = yield* layerRows();

          // The box's aspect shrinks by (9/16)/(16/9): the crop keeps the
          // middle 81/256 of its width.
          const narrow = 81 / 256;
          expect(short[0]).toEqual(before[0]);
          expectGeometry(short[1]!, {
            place: [0, 0, 1080, 1920],
            crop: [(1 - narrow) / 2, 0, narrow, 1],
          });
          expectGeometry(short[2]!, {
            place: [810, 1440, 270, 480],
            crop: [0.5 + (0.5 - 0.5 * narrow) / 2, 0.5, 0.5 * narrow, 0.5],
          });
          expect(short.map(withoutGeometry)).toEqual(
            before.map(withoutGeometry)
          );

          yield* videoOps.updateVideoFormat({
            videoId: "video",
            format: "landscape",
          });
          const landscape = yield* layerRows();

          // Back in a 16:9 box the crop keeps the middle of its height too.
          expect(landscape[0]).toEqual(before[0]);
          expectGeometry(landscape[1]!, {
            place: [0, 0, 1920, 1080],
            crop: [(1 - narrow) / 2, (1 - narrow) / 2, narrow, narrow],
          });
          expectGeometry(landscape[2]!, {
            place: [1440, 810, 480, 270],
            crop: [
              0.5 + (0.5 - 0.5 * narrow) / 2,
              0.5 + (0.5 - 0.5 * narrow) / 2,
              0.5 * narrow,
              0.5 * narrow,
            ],
          });
          expect(landscape.map(withoutGeometry)).toEqual(
            before.map(withoutGeometry)
          );

          expect(withoutFormat(yield* videoRow())).toEqual(
            withoutFormat(videoBefore)
          );
          const untouched = yield* Effect.promise(() =>
            testDb
              .select()
              .from(clipLayers)
              .where(eq(clipLayers.clipId, "untouched"))
          );
          expect(untouched).toEqual([]);
        }).pipe(Effect.provide(testLayer))
    );

    it.effect("setting the format a Video already has moves nothing", () =>
      Effect.gen(function* () {
        yield* seed();
        const videoOps = yield* VideoOperationsService;
        const before = yield* layerRows();

        yield* videoOps.updateVideoFormat({
          videoId: "video",
          format: "landscape",
        });

        expect(yield* layerRows()).toEqual(before);
      }).pipe(Effect.provide(testLayer))
    );

    it.effect(
      "is refused without a Draft, moving no Layer and keeping the format",
      () =>
        Effect.gen(function* () {
          yield* Effect.promise(async () => {
            const [course] = await testDb
              .insert(courses)
              .values({ name: "course" })
              .returning();
            const [version] = await testDb
              .insert(courseVersions)
              .values({
                repoId: course!.id,
                name: "v1",
                commitState: "published",
              })
              .returning();
            await testDb
              .insert(sections)
              .values({ id: "section", repoVersionId: version!.id, order: 0 });
            await testDb
              .insert(lessons)
              .values({ id: "lesson", sectionId: "section", order: 0 });
          });
          yield* seed("lesson");
          const videoOps = yield* VideoOperationsService;
          const before = yield* layerRows();

          const error = yield* Effect.flip(
            videoOps.updateVideoFormat({ videoId: "video", format: "short" })
          );

          expect(error._tag).toBe("VersionNotDraftError");
          expect(yield* layerRows()).toEqual(before);
          expect((yield* videoRow()).format).toBe("landscape");
        }).pipe(Effect.provide(testLayer))
    );
  });
});
