import { describe, it, expect } from "@effect/vitest";
import { beforeAll } from "vitest";
import { Effect, Layer } from "effect";
import { DBFunctionsService } from "@/services/db-service.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import { createTestDb, type TestDb } from "@/test-utils/pglite";

let testDb: TestDb;
let testLayer: Layer.Layer<DBFunctionsService>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;

  testLayer = DBFunctionsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as any))
  );
});

const EXPECTED_METHODS = [
  "getClipById",
  "getClipsByIds",
  "updateClip",
  "archiveClip",
  "reorderClip",
  "createChapter",
  "createChapterAtInsertionPoint",
  "createChapterAtPosition",
  "getChapterById",
  "updateChapter",
  "archiveChapter",
  "reorderChapter",
  "appendClips",
  "getCourseById",
  "getCourseByFilePath",
  "getCourseWithSectionsById",
  "getCourseStructureById",
  "getCourseWithSlimClipsById",
  "getVideoTranscripts",
  "getCourseWithSectionsByFilePath",
  "getCourses",
  "getTopActiveCourses",
  "getArchivedCourses",
  "createCourse",
  "createGhostCourse",
  "updateCourseName",
  "updateCourseMemory",
  "updateCourseArchiveStatus",
  "updateCourseFilePath",
  "deleteCourse",
  "duplicateCourse",
  "getReferenceVideoCandidates",
  "getVideoById",
  "getVideoWithClipsById",
  "getVideoWithLessonById",
  "getStandaloneVideos",
  "getStandaloneVideosSidebar",
  "getAllStandaloneVideos",
  "getArchivedStandaloneVideos",
  "createVideo",
  "createStandaloneVideo",
  "hasOriginalFootagePathAlreadyBeenUsed",
  "updateVideo",
  "deleteVideo",
  "updateVideoPath",
  "updateVideoLesson",
  "updateVideoArchiveStatus",
  "getNextVideoId",
  "getPreviousVideoId",
  "getNextLessonWithoutVideo",
  "getVideosForFewShotExamples",
  "getCourseVersions",
  "getLatestCourseVersion",
  "getCourseVersionById",
  "getCourseWithSectionsByVersion",
  "getCourseWithSectionsByVersionSlim",
  "getVersionWithSections",
  "createCourseVersion",
  "updateCourseVersion",
  "copyVersionStructure",
  "getVideoIdsForVersion",
  "getAllVersionsWithStructure",
  "getLinks",
  "createLink",
  "deleteLink",
  "getYoutubeAuth",
  "upsertYoutubeAuth",
  "updateYoutubeAccessToken",
  "deleteYoutubeAuth",
  "getAiHeroAuth",
  "upsertAiHeroAuth",
  "deleteAiHeroAuth",
  "getThumbnailsByVideoId",
  "createThumbnail",
  "getThumbnailById",
  "updateThumbnail",
  "deleteThumbnail",
  "createPitch",
  "listPitches",
  "listPitchesWithVideos",
  "getPitch",
  "getPitchWithVideos",
  "updatePitchField",
  "createVideoFromPitch",
  "deletePitch",
  "listDeliverables",
  "createDeliverable",
  "updateDeliverableStatus",
  "updateDeliverable",
  "duplicateDeliverable",
  "archiveDeliverable",
] as const;

describe("DBFunctionsService shim", () => {
  it.effect("exposes all expected methods from domain services", () =>
    Effect.gen(function* () {
      const db = yield* DBFunctionsService;

      const actualKeys = Object.keys(db);

      for (const method of EXPECTED_METHODS) {
        expect(actualKeys).toContain(method);
        expect(typeof db[method]).toBe("function");
      }
    }).pipe(Effect.provide(testLayer))
  );
});
