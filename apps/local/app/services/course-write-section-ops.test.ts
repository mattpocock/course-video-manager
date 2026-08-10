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

  const getSection = (sectionId: string) =>
    Effect.gen(function* () {
      const lsOps = yield* LessonSectionOperationsService;
      return yield* lsOps.getSectionWithHierarchyById(sectionId);
    }).pipe(Effect.provide(dbLayer), Effect.runPromise);

  return {
    run,
    createSection,
    createLesson,
    getSection,
  };
};

describe("CourseWriteService", () => {
  describe("renameSection", () => {
    it("updates the section path in the database", async () => {
      const { run, createSection, getSection } = await setup();

      const section = await createSection("01-intro", 1);

      const result = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.renameSection(section.id, "introduction");
        })
      );

      expect(result.success).toBe(true);
      expect(result.title).toBe("introduction");

      const updated = await getSection(section.id);
      expect(updated.title).toBe("introduction");
    });

    it("is a no-op when the new slug matches the current path", async () => {
      const { run, createSection, getSection } = await setup();

      const section = await createSection("01-intro", 1);

      const result = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.renameSection(section.id, "01-intro");
        })
      );

      expect(result.success).toBe(true);
      expect(result.title).toBe("01-intro");

      const updated = await getSection(section.id);
      expect(updated.title).toBe("01-intro");
    });
  });

  describe("reorderSections", () => {
    it("updates section order values in the database", async () => {
      const { run, createSection, getSection } = await setup();

      const section1 = await createSection("01-intro", 1);
      const section2 = await createSection("02-advanced", 2);

      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.reorderSections([section2.id, section1.id]);
        })
      );

      const updatedSection1 = await getSection(section1.id);
      expect(updatedSection1.order).toBe(1);

      const updatedSection2 = await getSection(section2.id);
      expect(updatedSection2.order).toBe(0);
    });

    it("is a no-op when the order has not changed", async () => {
      const { run, createSection, getSection } = await setup();

      const section1 = await createSection("01-intro", 1);
      const section2 = await createSection("02-advanced", 2);

      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.reorderSections([section1.id, section2.id]);
        })
      );

      const updatedSection1 = await getSection(section1.id);
      expect(updatedSection1.order).toBe(0);

      const updatedSection2 = await getSection(section2.id);
      expect(updatedSection2.order).toBe(1);
    });
  });
});
