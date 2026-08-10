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

  const createSection = async (sectionTitle: string, order: number) => {
    const sections = await Effect.gen(function* () {
      const lsOps = yield* LessonSectionOperationsService;
      return yield* lsOps.createSections({
        repoVersionId: version.id,
        sections: [
          { sectionPathWithNumber: sectionTitle, sectionNumber: order },
        ],
      });
    }).pipe(Effect.provide(dbLayer), Effect.runPromise);
    return sections[0]!;
  };

  const createLesson = async (
    sectionId: string,
    title: string,
    order: number
  ) => {
    const lessons = await Effect.gen(function* () {
      const lsOps = yield* LessonSectionOperationsService;
      const created = yield* lsOps.createLesson(sectionId, {
        title,
        order,
      });
      yield* lsOps.updateLesson(created[0]!.id, {
        authoringStatus: "todo",
      });
      return created;
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

  const getLessonsInSection = (sectionId: string) =>
    Effect.gen(function* () {
      const lsOps = yield* LessonSectionOperationsService;
      return yield* lsOps.getLessonsBySectionId(sectionId);
    }).pipe(Effect.provide(dbLayer), Effect.runPromise);

  return {
    run,
    repoVersionId: version.id,
    createSection,
    createLesson,
    getLesson,
    getSection,
    getLessonsInSection,
  };
};

describe("CourseWriteService (DB-only)", () => {
  describe("end-to-end: create section → add lesson → rename", () => {
    it("full flow produces correct DB rows", async () => {
      const { run, createSection, getLesson } = await setup();

      const section = await createSection("Before We Start", 1);

      const addResult = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.addLesson(section.id, "Where Were Going");
        })
      );
      expect(addResult.success).toBe(true);

      const lesson = await getLesson(addResult.lessonId);
      expect(lesson.authoringStatus).toBe("todo");

      const renameResult = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.renameLesson(
            addResult.lessonId,
            "where-we-are-going"
          );
        })
      );
      expect(renameResult.title).toBe("where-we-are-going");

      const updatedLesson = await getLesson(addResult.lessonId);
      expect(updatedLesson.title).toBe("where-we-are-going");
    });
  });

  describe("addSection", () => {
    it("creates a section with the given title as its path", async () => {
      const { run, repoVersionId, getSection } = await setup();

      const result = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.addSection(repoVersionId, "Before We Start");
        })
      );

      expect(result.success).toBe(true);
      const section = await getSection(result.sectionId);
      expect(section.title).toBe("Before We Start");
    });
  });

  describe("addLesson creates a plain lesson row", () => {
    it("creates with authoringStatus todo", async () => {
      const { run, createSection, getLesson } = await setup();

      const section = await createSection("Intro", 1);

      const result = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.addLesson(section.id, "My Lesson");
        })
      );

      expect(result.success).toBe(true);
      const lesson = await getLesson(result.lessonId);
      expect(lesson.authoringStatus).toBe("todo");
      expect(lesson.title).toBe("My Lesson");
    });
  });

  describe("createLesson behaves identically to addLesson", () => {
    it("creates a lesson with correct DB state", async () => {
      const { run, createSection, getLesson } = await setup();

      const section = await createSection("Intro", 1);

      const result = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.createLesson(section.id, "My Lesson");
        })
      );

      expect(result.success).toBe(true);
      expect(result.path).toBe("my-lesson");
      const lesson = await getLesson(result.lessonId);
      expect(lesson.authoringStatus).toBe("todo");
    });
  });

  describe("archiveSection", () => {
    it("archives a section regardless of its lessons", async () => {
      const { run, createSection, createLesson, getSection } = await setup();

      const section = await createSection("Intro", 1);
      await createLesson(section.id, "Lesson", 1);

      const result = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.archiveSection(section.id);
        })
      );

      expect(result.success).toBe(true);
      const archived = await getSection(section.id);
      expect(archived.archivedAt).not.toBeNull();
    });
  });
});
