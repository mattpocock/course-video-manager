import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { CourseOperationsService } from "./db-course-operations.server.js";
import { DrizzleService } from "./drizzle-service.server.js";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "../test-utils/pglite.js";
import * as schema from "../db/schema.js";

/**
 * Where a duplicated Course's Thumbnails POINT.
 *
 * Its own file rather than a case in `db-duplicate-course.test.ts`: that one
 * is at the repo's file-token cap, and this needs a Thumbnail whose paths look
 * like a real one's — ABSOLUTE, under the Video's own
 * `{VIDEO_FILES_DIR}/{lineageId}/` — where the shared fixture's is a stub.
 *
 * Copied verbatim those paths did not strand, they ALIASED the SOURCE Video's
 * files: the copy rendered the source's picture, and editing the copy's
 * Thumbnail wrote over the source's PNG, because the update route writes back
 * to the path on the row (#1674).
 */

let testDb: TestDb;
let testLayer: Layer.Layer<CourseOperationsService>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  testLayer = CourseOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as any))
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

const run = <A, E>(eff: Effect.Effect<A, E, CourseOperationsService>) =>
  Effect.runPromise(eff.pipe(Effect.provide(testLayer)));

/** One Course → Section → Lesson → Video, carrying one realistic Thumbnail. */
async function createCourseWithThumbnail() {
  const [course] = await testDb
    .insert(schema.courses)
    .values({ name: "Original Course" })
    .returning();

  const [version] = await testDb
    .insert(schema.courseVersions)
    .values({ repoId: course!.id, name: "v1" })
    .returning();

  const [section] = await testDb
    .insert(schema.sections)
    .values({ repoVersionId: version!.id, title: "01-intro", order: 1 })
    .returning();

  const [lesson] = await testDb
    .insert(schema.lessons)
    .values({ sectionId: section!.id, order: 1, title: "First Lesson" })
    .returning();

  const [video] = await testDb
    .insert(schema.videos)
    .values({
      lessonId: lesson!.id,
      title: "video-01.mp4",
      originalFootagePath: "/footage/raw-01.mp4",
    })
    .returning();

  await testDb.insert(schema.thumbnails).values({
    videoId: video!.id,
    layers: {
      backgroundPhoto: {
        filePath: `/video-files/${video!.lineageId}/thumbnail-01-bg.png`,
        horizontalPosition: 50,
      },
      diagram: null,
      cutout: null,
    },
    filePath: `/video-files/${video!.lineageId}/thumbnail-01.png`,
    selectedForUpload: true,
  });

  return { course: course!, video: video! };
}

const duplicate = (sourceCourseId: string) =>
  run(
    Effect.gen(function* () {
      const courseOps = yield* CourseOperationsService;
      return yield* courseOps.duplicateCourse({ sourceCourseId, name: "Dup" });
    })
  );

const readDuplicatedVideo = async (versionId: string) => {
  const sections = await testDb.query.sections.findMany({
    where: (s, { eq }) => eq(s.repoVersionId, versionId),
    with: { lessons: { with: { videos: { with: { thumbnails: true } } } } },
  });
  return sections[0]!.lessons[0]!.videos[0]!;
};

describe("duplicateCourse — where a copied Thumbnail points", () => {
  it("points the composite at the DUPLICATE's own lineage directory", async () => {
    const { course, video } = await createCourseWithThumbnail();

    const result = await duplicate(course.id);
    const newVideo = await readDuplicatedVideo(result.version.id);

    expect(newVideo.lineageId).not.toBe(video.lineageId);
    expect(newVideo.thumbnails[0]!.filePath).toBe(
      `/video-files/${newVideo.lineageId}/thumbnail-01.png`
    );
    expect(newVideo.thumbnails[0]!.filePath).not.toContain(video.lineageId);
  });

  it("points every layer's path there too", async () => {
    // A layer this missed would keep writing into the SOURCE Video's
    // directory, silently, which is the half that loses Matt's work.
    const { course, video } = await createCourseWithThumbnail();

    const result = await duplicate(course.id);
    const newVideo = await readDuplicatedVideo(result.version.id);

    const layers = newVideo.thumbnails[0]!.layers as {
      backgroundPhoto: { filePath: string };
    };
    expect(layers.backgroundPhoto.filePath).toBe(
      `/video-files/${newVideo.lineageId}/thumbnail-01-bg.png`
    );
    expect(layers.backgroundPhoto.filePath).not.toContain(video.lineageId);
  });
});
