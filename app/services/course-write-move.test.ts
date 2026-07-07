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

  const getSection = (sectionId: string) =>
    Effect.gen(function* () {
      const lsOps = yield* LessonSectionOperationsService;
      return yield* lsOps.getSectionWithHierarchyById(sectionId);
    }).pipe(Effect.provide(dbLayer), Effect.runPromise);

  return {
    run,
    createSection,
    createLesson,
    getLesson,
    getSection,
  };
};

describe("CourseWriteService", () => {
  describe("moveToSection", () => {
    it("moves a lesson to another section and updates DB paths via planner", async () => {
      const { run, createSection, createLesson, getLesson } = await setup();

      const section1 = await createSection("01-intro", 1);
      const section2 = await createSection("02-advanced", 2);

      const l1 = await createLesson(section1.id, "01.01-first", 1);
      const l2 = await createLesson(section1.id, "01.02-second", 2);
      const l3 = await createLesson(section1.id, "01.03-third", 3);
      await createLesson(section2.id, "02.01-existing", 1);

      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.moveToSection(l2.id, section2.id);
        })
      );

      const movedLesson = await getLesson(l2.id);
      expect(movedLesson.sectionId).toBe(section2.id);
      expect(movedLesson.title).toBe("second");

      const updatedL3 = await getLesson(l3.id);
      expect(updatedL3.title).toBe("third");

      const updatedL1 = await getLesson(l1.id);
      expect(updatedL1.title).toBe("first");
    });

    it("moves the only lesson from a section", async () => {
      const { run, createSection, createLesson, getLesson } = await setup();

      const section1 = await createSection("01-intro", 1);
      const section2 = await createSection("02-advanced", 2);

      const l1 = await createLesson(section1.id, "01.01-only-lesson", 1);
      await createLesson(section2.id, "02.01-existing", 1);

      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.moveToSection(l1.id, section2.id);
        })
      );

      const movedLesson = await getLesson(l1.id);
      expect(movedLesson.sectionId).toBe(section2.id);
    });
  });

  describe("moveLessonsToSection", () => {
    it("moves multiple lessons to another section as a contiguous block", async () => {
      const { run, createSection, createLesson, getLesson } = await setup();

      const section1 = await createSection("01-intro", 1);
      const section2 = await createSection("02-advanced", 2);

      const a = await createLesson(section1.id, "01.01-a", 1);
      const b = await createLesson(section1.id, "01.02-b", 2);
      const c = await createLesson(section1.id, "01.03-c", 3);
      await createLesson(section2.id, "02.01-existing", 1);

      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.moveLessonsToSection([a.id, c.id], section2.id);
        })
      );

      const movedA = await getLesson(a.id);
      const movedC = await getLesson(c.id);
      expect(movedA.sectionId).toBe(section2.id);
      expect(movedA.title).toBe("a");
      expect(movedC.sectionId).toBe(section2.id);
      expect(movedC.title).toBe("c");

      const keptB = await getLesson(b.id);
      expect(keptB.sectionId).toBe(section1.id);
      expect(keptB.title).toBe("b");
    });

    it("handles moving all lessons from a section", async () => {
      const { run, createSection, createLesson, getLesson } = await setup();

      const section1 = await createSection("01-intro", 1);
      const section2 = await createSection("02-advanced", 2);

      const a = await createLesson(section1.id, "01.01-a", 1);
      const b = await createLesson(section1.id, "01.02-b", 2);
      await createLesson(section2.id, "02.01-existing", 1);

      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.moveLessonsToSection([a.id, b.id], section2.id);
        })
      );

      const movedA = await getLesson(a.id);
      const movedB = await getLesson(b.id);
      expect(movedA.sectionId).toBe(section2.id);
      expect(movedB.sectionId).toBe(section2.id);
    });
  });
});
