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

  const createGhostLesson = async (
    sectionId: string,
    title: string,
    order: number
  ) => {
    const lesson = await Effect.gen(function* () {
      const lsOps = yield* LessonSectionOperationsService;
      return yield* lsOps.createGhostLesson(sectionId, {
        title,
        order,
      });
    }).pipe(Effect.provide(dbLayer), Effect.runPromise);
    return lesson[0]!;
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
    createGhostLesson,
    getLesson,
  };
};

describe("CourseWriteService", () => {
  describe("reorderLessons", () => {
    it("reverses lesson order values in the database", async () => {
      const { run, createSection, createLesson, getLesson } = await setup();

      const section = await createSection("01-intro", 1);
      const l1 = await createLesson(section.id, "01.01-first", 1);
      const l2 = await createLesson(section.id, "01.02-second", 2);
      const l3 = await createLesson(section.id, "01.03-third", 3);

      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.reorderLessons(section.id, [
            l3.id,
            l2.id,
            l1.id,
          ]);
        })
      );

      const updated1 = await getLesson(l1.id);
      expect(updated1.order).toBe(2);

      const updated2 = await getLesson(l2.id);
      expect(updated2.order).toBe(1);

      const updated3 = await getLesson(l3.id);
      expect(updated3.order).toBe(0);
    });

    it("updates order values for all-ghost lessons", async () => {
      const { run, createSection, createGhostLesson, getLesson } =
        await setup();

      const section = await createSection("01-intro", 1);
      const g1 = await createGhostLesson(section.id, "Alpha", 0);
      const g2 = await createGhostLesson(section.id, "Beta", 1);
      const g3 = await createGhostLesson(section.id, "Gamma", 2);
      const g4 = await createGhostLesson(section.id, "Delta", 3);

      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.reorderLessons(section.id, [
            g4.id,
            g3.id,
            g2.id,
            g1.id,
          ]);
        })
      );

      const updatedG1 = await getLesson(g1.id);
      expect(updatedG1.order).toBe(3);

      const updatedG2 = await getLesson(g2.id);
      expect(updatedG2.order).toBe(2);

      const updatedG3 = await getLesson(g3.id);
      expect(updatedG3.order).toBe(1);

      const updatedG4 = await getLesson(g4.id);
      expect(updatedG4.order).toBe(0);
    });

    it("normalizes a single lesson order to zero", async () => {
      const { run, createSection, createGhostLesson, getLesson } =
        await setup();

      const section = await createSection("01-intro", 1);
      const g1 = await createGhostLesson(section.id, "Only", 5);

      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.reorderLessons(section.id, [g1.id]);
        })
      );

      const updated = await getLesson(g1.id);
      expect(updated.order).toBe(0);
    });
  });

  describe("addGhostLesson (adjacent insertion)", () => {
    it("inserts before the first lesson and shifts others", async () => {
      const { run, createSection, createGhostLesson, getLesson } =
        await setup();

      const section = await createSection("01-intro", 1);
      const g1 = await createGhostLesson(section.id, "First", 0);
      const g2 = await createGhostLesson(section.id, "Second", 1);

      const result = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.addGhostLesson(section.id, "Zeroth", {
            adjacentLessonId: g1.id,
            position: "before",
          });
        })
      );

      const newLesson = await getLesson(result.lessonId);
      expect(newLesson.order).toBe(0);

      const updatedG1 = await getLesson(g1.id);
      expect(updatedG1.order).toBe(1);

      const updatedG2 = await getLesson(g2.id);
      expect(updatedG2.order).toBe(2);
    });
  });
});
