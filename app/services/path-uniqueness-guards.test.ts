import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { LessonSectionOperationsService } from "@/services/db-lesson-section-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import { courses, courseVersions, videos } from "@/db/schema";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import { eq } from "drizzle-orm";

let testDb: TestDb;
let testLayer: Layer.Layer<
  LessonSectionOperationsService | VideoOperationsService
>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;

  testLayer = Layer.mergeAll(
    LessonSectionOperationsService.Default,
    VideoOperationsService.Default
  ).pipe(Layer.provide(Layer.succeed(DrizzleService, testDb as any)));
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

async function createCourseAndVersion() {
  const [course] = await testDb
    .insert(courses)
    .values({ name: "Test Course", slug: "test-course", filePath: "/test" })
    .returning();
  const [version] = await testDb
    .insert(courseVersions)
    .values({ repoId: course!.id, name: "" })
    .returning();
  return { courseId: course!.id, versionId: version!.id };
}

describe("section path uniqueness guard", () => {
  it.effect("rejects duplicate section path in same version", () =>
    Effect.gen(function* () {
      const { versionId } = yield* Effect.promise(createCourseAndVersion);
      const lessonSectionOps = yield* LessonSectionOperationsService;

      yield* lessonSectionOps.createSections({
        repoVersionId: versionId,
        sections: [{ sectionPathWithNumber: "intro", sectionNumber: 1 }],
      });

      const error = yield* lessonSectionOps
        .createSections({
          repoVersionId: versionId,
          sections: [{ sectionPathWithNumber: "intro", sectionNumber: 2 }],
        })
        .pipe(Effect.flip);

      expect(error._tag).toBe("SectionPathTakenError");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("allows same path in different versions", () =>
    Effect.gen(function* () {
      const { versionId: v1 } = yield* Effect.promise(createCourseAndVersion);
      const lessonSectionOps = yield* LessonSectionOperationsService;

      yield* lessonSectionOps.createSections({
        repoVersionId: v1,
        sections: [{ sectionPathWithNumber: "intro", sectionNumber: 1 }],
      });

      const [course2] = yield* Effect.promise(() =>
        testDb
          .insert(courses)
          .values({ name: "Other", slug: "other", filePath: "/other" })
          .returning()
      );
      const [v2] = yield* Effect.promise(() =>
        testDb
          .insert(courseVersions)
          .values({ repoId: course2!.id, name: "" })
          .returning()
      );

      const result = yield* lessonSectionOps.createSections({
        repoVersionId: v2!.id,
        sections: [{ sectionPathWithNumber: "intro", sectionNumber: 1 }],
      });
      expect(result.length).toBe(1);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("allows same path when existing is archived", () =>
    Effect.gen(function* () {
      const { versionId } = yield* Effect.promise(createCourseAndVersion);
      const lessonSectionOps = yield* LessonSectionOperationsService;

      const [existing] = yield* lessonSectionOps.createSections({
        repoVersionId: versionId,
        sections: [{ sectionPathWithNumber: "intro", sectionNumber: 1 }],
      });
      yield* lessonSectionOps.archiveSection(existing!.id);

      const result = yield* lessonSectionOps.createSections({
        repoVersionId: versionId,
        sections: [{ sectionPathWithNumber: "intro", sectionNumber: 2 }],
      });
      expect(result.length).toBe(1);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("rejects section path update to taken path", () =>
    Effect.gen(function* () {
      const { versionId } = yield* Effect.promise(createCourseAndVersion);
      const lessonSectionOps = yield* LessonSectionOperationsService;

      yield* lessonSectionOps.createSections({
        repoVersionId: versionId,
        sections: [{ sectionPathWithNumber: "intro", sectionNumber: 1 }],
      });
      const [other] = yield* lessonSectionOps.createSections({
        repoVersionId: versionId,
        sections: [{ sectionPathWithNumber: "basics", sectionNumber: 2 }],
      });

      const error = yield* lessonSectionOps
        .updateSectionPath(other!.id, "intro")
        .pipe(Effect.flip);

      expect(error._tag).toBe("SectionPathTakenError");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("allows section to keep its own path on update", () =>
    Effect.gen(function* () {
      const { versionId } = yield* Effect.promise(createCourseAndVersion);
      const lessonSectionOps = yield* LessonSectionOperationsService;

      const [section] = yield* lessonSectionOps.createSections({
        repoVersionId: versionId,
        sections: [{ sectionPathWithNumber: "intro", sectionNumber: 1 }],
      });

      yield* lessonSectionOps.updateSectionPath(section!.id, "intro");
    }).pipe(Effect.provide(testLayer))
  );
});

describe("lesson path uniqueness guard", () => {
  it.effect("rejects duplicate lesson path in same section", () =>
    Effect.gen(function* () {
      const { versionId } = yield* Effect.promise(createCourseAndVersion);
      const lessonSectionOps = yield* LessonSectionOperationsService;

      const [section] = yield* lessonSectionOps.createSections({
        repoVersionId: versionId,
        sections: [{ sectionPathWithNumber: "intro", sectionNumber: 1 }],
      });

      yield* lessonSectionOps.createGhostLesson(section!.id, {
        title: "Lesson",
        path: "my-lesson",
        order: 1,
      });

      const error = yield* lessonSectionOps
        .createGhostLesson(section!.id, {
          title: "Lesson Dup",
          path: "my-lesson",
          order: 2,
        })
        .pipe(Effect.flip);

      expect(error._tag).toBe("LessonPathTakenError");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("allows same path in different sections", () =>
    Effect.gen(function* () {
      const { versionId } = yield* Effect.promise(createCourseAndVersion);
      const lessonSectionOps = yield* LessonSectionOperationsService;

      const created = yield* lessonSectionOps.createSections({
        repoVersionId: versionId,
        sections: [
          { sectionPathWithNumber: "intro", sectionNumber: 1 },
          { sectionPathWithNumber: "advanced", sectionNumber: 2 },
        ],
      });

      yield* lessonSectionOps.createGhostLesson(created[0]!.id, {
        title: "Lesson",
        path: "my-lesson",
        order: 1,
      });

      const result = yield* lessonSectionOps.createGhostLesson(created[1]!.id, {
        title: "Lesson",
        path: "my-lesson",
        order: 1,
      });
      expect(result.length).toBe(1);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("allows same path when existing is archived", () =>
    Effect.gen(function* () {
      const { versionId } = yield* Effect.promise(createCourseAndVersion);
      const lessonSectionOps = yield* LessonSectionOperationsService;

      const [section] = yield* lessonSectionOps.createSections({
        repoVersionId: versionId,
        sections: [{ sectionPathWithNumber: "intro", sectionNumber: 1 }],
      });

      const [existing] = yield* lessonSectionOps.createGhostLesson(
        section!.id,
        { title: "Lesson", path: "my-lesson", order: 1 }
      );
      yield* lessonSectionOps.deleteLesson(existing!.id);

      const result = yield* lessonSectionOps.createGhostLesson(section!.id, {
        title: "Lesson",
        path: "my-lesson",
        order: 2,
      });
      expect(result.length).toBe(1);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("rejects lesson path update to taken path", () =>
    Effect.gen(function* () {
      const { versionId } = yield* Effect.promise(createCourseAndVersion);
      const lessonSectionOps = yield* LessonSectionOperationsService;

      const [section] = yield* lessonSectionOps.createSections({
        repoVersionId: versionId,
        sections: [{ sectionPathWithNumber: "intro", sectionNumber: 1 }],
      });

      yield* lessonSectionOps.createGhostLesson(section!.id, {
        title: "First",
        path: "first",
        order: 1,
      });
      const [second] = yield* lessonSectionOps.createGhostLesson(section!.id, {
        title: "Second",
        path: "second",
        order: 2,
      });

      const error = yield* lessonSectionOps
        .updateLesson(second!.id, { path: "first" })
        .pipe(Effect.flip);

      expect(error._tag).toBe("LessonPathTakenError");
    }).pipe(Effect.provide(testLayer))
  );
});

describe("video path uniqueness guard", () => {
  it.effect("rejects duplicate video path in same lesson", () =>
    Effect.gen(function* () {
      const { versionId } = yield* Effect.promise(createCourseAndVersion);
      const lessonSectionOps = yield* LessonSectionOperationsService;
      const videoOps = yield* VideoOperationsService;

      const [section] = yield* lessonSectionOps.createSections({
        repoVersionId: versionId,
        sections: [{ sectionPathWithNumber: "intro", sectionNumber: 1 }],
      });
      const [lesson] = yield* lessonSectionOps.createGhostLesson(section!.id, {
        title: "Lesson",
        path: "lesson",
        order: 1,
      });

      yield* videoOps.createVideo(lesson!.id, {
        path: "video.mp4",
        originalFootagePath: "/a",
      });

      const error = yield* videoOps
        .createVideo(lesson!.id, {
          path: "video.mp4",
          originalFootagePath: "/b",
        })
        .pipe(Effect.flip);

      expect(error._tag).toBe("VideoPathTakenError");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("allows same path in different lessons", () =>
    Effect.gen(function* () {
      const { versionId } = yield* Effect.promise(createCourseAndVersion);
      const lessonSectionOps = yield* LessonSectionOperationsService;
      const videoOps = yield* VideoOperationsService;

      const [section] = yield* lessonSectionOps.createSections({
        repoVersionId: versionId,
        sections: [{ sectionPathWithNumber: "intro", sectionNumber: 1 }],
      });
      const [lesson1] = yield* lessonSectionOps.createGhostLesson(section!.id, {
        title: "L1",
        path: "l1",
        order: 1,
      });
      const [lesson2] = yield* lessonSectionOps.createGhostLesson(section!.id, {
        title: "L2",
        path: "l2",
        order: 2,
      });

      yield* videoOps.createVideo(lesson1!.id, {
        path: "video.mp4",
        originalFootagePath: "/a",
      });

      const result = yield* videoOps.createVideo(lesson2!.id, {
        path: "video.mp4",
        originalFootagePath: "/b",
      });
      expect(result.path).toBe("video.mp4");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("allows same path when existing is archived", () =>
    Effect.gen(function* () {
      const { versionId } = yield* Effect.promise(createCourseAndVersion);
      const lessonSectionOps = yield* LessonSectionOperationsService;
      const videoOps = yield* VideoOperationsService;

      const [section] = yield* lessonSectionOps.createSections({
        repoVersionId: versionId,
        sections: [{ sectionPathWithNumber: "intro", sectionNumber: 1 }],
      });
      const [lesson] = yield* lessonSectionOps.createGhostLesson(section!.id, {
        title: "Lesson",
        path: "lesson",
        order: 1,
      });

      const existing = yield* videoOps.createVideo(lesson!.id, {
        path: "video.mp4",
        originalFootagePath: "/a",
      });
      yield* Effect.promise(() =>
        testDb
          .update(videos)
          .set({ archived: true })
          .where(eq(videos.id, existing.id))
      );

      const result = yield* videoOps.createVideo(lesson!.id, {
        path: "video.mp4",
        originalFootagePath: "/b",
      });
      expect(result.path).toBe("video.mp4");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("rejects video path update to taken path", () =>
    Effect.gen(function* () {
      const { versionId } = yield* Effect.promise(createCourseAndVersion);
      const lessonSectionOps = yield* LessonSectionOperationsService;
      const videoOps = yield* VideoOperationsService;

      const [section] = yield* lessonSectionOps.createSections({
        repoVersionId: versionId,
        sections: [{ sectionPathWithNumber: "intro", sectionNumber: 1 }],
      });
      const [lesson] = yield* lessonSectionOps.createGhostLesson(section!.id, {
        title: "Lesson",
        path: "lesson",
        order: 1,
      });

      yield* videoOps.createVideo(lesson!.id, {
        path: "first.mp4",
        originalFootagePath: "/a",
      });
      const second = yield* videoOps.createVideo(lesson!.id, {
        path: "second.mp4",
        originalFootagePath: "/b",
      });

      const error = yield* videoOps
        .updateVideoPath({ videoId: second.id, path: "first.mp4" })
        .pipe(Effect.flip);

      expect(error._tag).toBe("VideoPathTakenError");
    }).pipe(Effect.provide(testLayer))
  );
});

describe("intra-batch collision guard", () => {
  it.effect("rejects duplicate section paths within a single batch", () =>
    Effect.gen(function* () {
      const { versionId } = yield* Effect.promise(createCourseAndVersion);
      const lessonSectionOps = yield* LessonSectionOperationsService;

      const error = yield* lessonSectionOps
        .createSections({
          repoVersionId: versionId,
          sections: [
            { sectionPathWithNumber: "intro", sectionNumber: 1 },
            { sectionPathWithNumber: "intro", sectionNumber: 2 },
          ],
        })
        .pipe(Effect.flip);

      expect(error._tag).toBe("SectionPathTakenError");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("rejects duplicate lesson paths within a single batch", () =>
    Effect.gen(function* () {
      const { versionId } = yield* Effect.promise(createCourseAndVersion);
      const lessonSectionOps = yield* LessonSectionOperationsService;

      const [section] = yield* lessonSectionOps.createSections({
        repoVersionId: versionId,
        sections: [{ sectionPathWithNumber: "intro", sectionNumber: 1 }],
      });

      const error = yield* lessonSectionOps
        .createLessons(section!.id, [
          { lessonPathWithNumber: "lesson-a", lessonNumber: 1 },
          { lessonPathWithNumber: "lesson-a", lessonNumber: 2 },
        ])
        .pipe(Effect.flip);

      expect(error._tag).toBe("LessonPathTakenError");
    }).pipe(Effect.provide(testLayer))
  );
});
