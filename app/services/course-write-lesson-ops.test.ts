import { describe, it, expect, beforeAll } from "vitest";
import { Effect, Layer } from "effect";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { LessonSectionOperationsService } from "@/services/db-lesson-section-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import { CourseWriteService } from "@/services/course-write-service";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";

let testDb: TestDb;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
});

const setup = async () => {
  await truncateAllTables(testDb);

  const drizzleLayer = Layer.succeed(DrizzleService, testDb as any);

  const testLayer = Layer.mergeAll(
    CourseWriteService.Default,
    CourseOperationsService.Default,
    VersionOperationsService.Default,
    LessonSectionOperationsService.Default
  ).pipe(Layer.provide(drizzleLayer));

  const dbLayer = Layer.mergeAll(
    CourseOperationsService.Default,
    VersionOperationsService.Default,
    LessonSectionOperationsService.Default
  ).pipe(Layer.provide(drizzleLayer));

  const run = <A, E>(effect: Effect.Effect<A, E, CourseWriteService>) =>
    Effect.runPromise(effect.pipe(Effect.provide(testLayer)));

  const repo = await Effect.gen(function* () {
    const courseOps = yield* CourseOperationsService;
    return yield* courseOps.createCourse({
      name: "test-repo",
    });
  }).pipe(Effect.provide(dbLayer), Effect.runPromise);

  const version = await Effect.gen(function* () {
    const versionOps = yield* VersionOperationsService;
    return yield* versionOps.createCourseVersion({
      repoId: repo.id,
      name: "v1",
    });
  }).pipe(Effect.provide(dbLayer), Effect.runPromise);

  const createSection = async (sectionPath: string, order: number) => {
    const sections = await Effect.gen(function* () {
      const lsOps = yield* LessonSectionOperationsService;
      return yield* lsOps.createSections({
        repoVersionId: version.id,
        sections: [
          { sectionPathWithNumber: sectionPath, sectionNumber: order },
        ],
      });
    }).pipe(Effect.provide(dbLayer), Effect.runPromise);
    return sections[0]!;
  };

  const createLesson = async (
    sectionId: string,
    lessonPath: string,
    order: number
  ) => {
    const lessons = await Effect.gen(function* () {
      const lsOps = yield* LessonSectionOperationsService;
      return yield* lsOps.createLessons(sectionId, [
        { lessonPathWithNumber: lessonPath, lessonNumber: order },
      ]);
    }).pipe(Effect.provide(dbLayer), Effect.runPromise);
    return lessons[0]!;
  };

  const getLesson = (lessonId: string) =>
    Effect.gen(function* () {
      const lsOps = yield* LessonSectionOperationsService;
      return yield* lsOps.getLessonWithHierarchyById(lessonId);
    }).pipe(Effect.provide(dbLayer), Effect.runPromise);

  return {
    run,
    createSection,
    createLesson,
    getLesson,
    version,
  };
};

describe("CourseWriteService", () => {
  describe("deleteLesson", () => {
    it("archives a lesson in the database", async () => {
      const { run, createSection, createLesson, getLesson } = await setup();

      const section = await createSection("01-intro", 1);
      const lesson = await createLesson(section.id, "01.01-to-delete", 1);

      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.deleteLesson(lesson.id);
        })
      );

      const archived = await getLesson(lesson.id);
      expect(archived.archived).toBe(true);
    });

    it("archives one lesson without affecting siblings", async () => {
      const { run, createSection, createLesson, getLesson } = await setup();

      const section = await createSection("01-intro", 1);
      const l1 = await createLesson(section.id, "01.01-first", 1);
      const l2 = await createLesson(section.id, "01.02-second", 2);
      const l3 = await createLesson(section.id, "01.03-third", 3);

      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.deleteLesson(l2.id);
        })
      );

      const archivedL2 = await getLesson(l2.id);
      expect(archivedL2.archived).toBe(true);

      const updatedL1 = await getLesson(l1.id);
      expect(updatedL1.archived).toBe(false);

      const updatedL3 = await getLesson(l3.id);
      expect(updatedL3.archived).toBe(false);
    });
  });

  describe("renameLesson", () => {
    it("updates the lesson path in the database", async () => {
      const { run, createSection, createLesson, getLesson } = await setup();

      const section = await createSection("01-intro", 1);
      const lesson = await createLesson(section.id, "01.01-old-slug", 1);

      const result = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.renameLesson(lesson.id, "new-slug");
        })
      );

      expect(result.success).toBe(true);
      expect(result.title).toBe("new-slug");

      const updated = await getLesson(lesson.id);
      expect(updated.title).toBe("new-slug");
    });
  });

  describe("createRealLesson", () => {
    it("creates a lesson with correct slug", async () => {
      const { run, createSection, getLesson } = await setup();

      const section = await createSection("01-intro", 1);

      const result = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.createRealLesson(section.id, "My First Lesson");
        })
      );

      expect(result.success).toBe(true);
      expect(result.path).toBe("my-first-lesson");

      const lesson = await getLesson(result.lessonId);
      expect(lesson.authoringStatus).toBe("todo");
      expect(lesson.title).toBe("My First Lesson");
    });

    it("inserts before an existing lesson when position is specified", async () => {
      const { run, createSection, createLesson, getLesson } = await setup();

      const section = await createSection("01-intro", 1);
      const l1 = await createLesson(section.id, "01.01-first", 1);
      const l2 = await createLesson(section.id, "01.02-second", 2);

      const result = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.createRealLesson(
            section.id,
            "Inserted Lesson",
            { adjacentLessonId: l2.id, position: "before" }
          );
        })
      );

      expect(result.success).toBe(true);

      const inserted = await getLesson(result.lessonId);
      expect(inserted.order).toBe(2);

      const updatedL2 = await getLesson(l2.id);
      expect(updatedL2.order).toBe(3);

      const updatedL1 = await getLesson(l1.id);
      expect(updatedL1.order).toBe(1);
    });
  });
});
