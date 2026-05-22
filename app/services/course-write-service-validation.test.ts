/**
 * Tests that sync validation is skipped for DB-only operations
 * and only runs once (post-operation) for filesystem operations.
 *
 * This verifies the performance optimization from Issue #685:
 * pre-validation was removed and ghost operations skip validation entirely.
 */

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { Effect, Layer, ManagedRuntime } from "effect";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import { createDirectCourseEditorService } from "./course-editor-service-handler";
import type { CourseEditorService } from "./course-editor-service";
import { DrizzleService } from "./drizzle-service.server";
import { CourseOperationsService } from "./db-course-operations.server";
import { LessonSectionOperationsService } from "./db-lesson-section-operations.server";
import { CourseWriteService } from "./course-write-service";
import { CourseRepoWriteService } from "./course-repo-write-service";
import { CourseRepoSyncValidationService } from "./course-repo-sync-validation";
import { NodeFileSystem } from "@effect/platform-node";
import * as schema from "@/db/schema";

let testDb: TestDb;
let editorService: CourseEditorService;
let validateCallCount: number;

function setup() {
  beforeAll(async () => {
    const result = await createTestDb();
    testDb = result.testDb;
  });

  beforeEach(async () => {
    await truncateAllTables(testDb);
    validateCallCount = 0;

    const testDrizzleLayer = Layer.succeed(DrizzleService, testDb as any);
    const testDbFunctionsLayer = Layer.mergeAll(
      CourseOperationsService.Default,
      LessonSectionOperationsService.Default
    ).pipe(Layer.provide(testDrizzleLayer));

    const mockRepoWriteLayer = Layer.succeed(CourseRepoWriteService, {
      createLessonDirectory: Effect.fn(function* (_opts: any) {
        return { lessonDirName: "mock", lessonNumber: 1 };
      }),
      addLesson: Effect.fn(function* (_opts: any) {
        return { newLessonDirName: "mock" };
      }),
      renameLesson: Effect.fn(function* (_opts: any) {
        return { newLessonDirName: "mock" };
      }),
      renameLessons: Effect.fn(function* (_opts: any) {}),
      renameSections: Effect.fn(function* (_opts: any) {}),
      deleteLesson: Effect.fn(function* (_opts: any) {}),
      moveLessonToSection: Effect.fn(function* (_opts: any) {}),
      sectionDirExists: Effect.fn(function* (_opts: any) {
        return false;
      }),
      deleteSectionDir: Effect.fn(function* (_opts: any) {}),
    } as any);

    // Counting mock: tracks how many times validate() is called
    const mockSyncValidationLayer = Layer.succeed(
      CourseRepoSyncValidationService,
      {
        validate: () =>
          Effect.sync(() => {
            validateCallCount++;
          }),
      } as any
    );

    const testLayer = Layer.mergeAll(
      testDbFunctionsLayer,
      mockRepoWriteLayer,
      mockSyncValidationLayer,
      NodeFileSystem.layer
    ).pipe(Layer.provideMerge(testDrizzleLayer));

    const serviceLayer = (
      CourseWriteService as any
    ).DefaultWithoutDependencies.pipe(Layer.provide(testLayer));

    const fullLayer = Layer.merge(testLayer, serviceLayer) as Layer.Layer<
      any,
      never,
      never
    >;

    const runtime = ManagedRuntime.make(fullLayer);
    editorService = createDirectCourseEditorService((effect) =>
      runtime.runPromise(effect as any)
    );
  });
}

const svc = () => editorService;
const db = () => testDb;

async function createCourseWithVersion(
  filePath: string | null = "/tmp/test-repo"
) {
  const [course] = await db()
    .insert(schema.courses)
    .values({ name: "Test Course", filePath })
    .returning();
  const [version] = await db()
    .insert(schema.courseVersions)
    .values({ repoId: course!.id, name: "v1" })
    .returning();
  return { course: course!, version: version! };
}

async function createSectionWithLessons(
  repoVersionId: string,
  sectionPath: string,
  sectionOrder: number,
  lessonDefs: {
    path: string;
    title: string;
    fsStatus: string;
    order: number;
  }[]
) {
  const [section] = await db()
    .insert(schema.sections)
    .values({ repoVersionId, path: sectionPath, order: sectionOrder })
    .returning();
  const lessons = [];
  for (const def of lessonDefs) {
    const [lesson] = await db()
      .insert(schema.lessons)
      .values({
        sectionId: section!.id,
        ...def,
        authoringStatus: def.fsStatus === "real" ? "done" : null,
      })
      .returning();
    lessons.push(lesson!);
  }
  return { section: section!, lessons };
}

setup();

describe("sync validation optimization (Issue #685)", () => {
  describe("DB-only operations skip validation entirely", () => {
    it("moving a ghost lesson does not trigger validation", async () => {
      const { version } = await createCourseWithVersion();
      const { lessons } = await createSectionWithLessons(
        version.id,
        "01-intro",
        0,
        [{ path: "my-lesson", title: "My Lesson", fsStatus: "ghost", order: 0 }]
      );
      const { section: sectionB } = await createSectionWithLessons(
        version.id,
        "02-basics",
        1,
        []
      );

      validateCallCount = 0;
      await svc().moveLessonToSection(lessons[0]!.id, sectionB.id);
      expect(validateCallCount).toBe(0);
    });

    it("deleting a ghost lesson does not trigger validation", async () => {
      const { version } = await createCourseWithVersion();
      const { lessons } = await createSectionWithLessons(
        version.id,
        "01-intro",
        0,
        [{ path: "my-lesson", title: "My Lesson", fsStatus: "ghost", order: 0 }]
      );

      validateCallCount = 0;
      await svc().deleteLesson(lessons[0]!.id);
      expect(validateCallCount).toBe(0);
    });

    it("renaming a ghost lesson does not trigger validation", async () => {
      const { version } = await createCourseWithVersion();
      const { lessons } = await createSectionWithLessons(
        version.id,
        "01-intro",
        0,
        [{ path: "my-lesson", title: "My Lesson", fsStatus: "ghost", order: 0 }]
      );

      validateCallCount = 0;
      await svc().updateLessonName(lessons[0]!.id, "new-name");
      expect(validateCallCount).toBe(0);
    });

    it("adding a ghost section does not trigger validation", async () => {
      const { version } = await createCourseWithVersion();

      validateCallCount = 0;
      await svc().createSection(version.id, "New Section", 0);
      expect(validateCallCount).toBe(0);
    });

    it("adding a ghost lesson does not trigger validation", async () => {
      const { version } = await createCourseWithVersion();
      const s = await svc().createSection(version.id, "Section A", 0);

      validateCallCount = 0;
      await svc().addGhostLesson(s.sectionId, "New Lesson");
      expect(validateCallCount).toBe(0);
    });
  });

  describe("filesystem operations validate exactly once (post-only)", () => {
    it("creating a real lesson validates once after", async () => {
      const { version } = await createCourseWithVersion("/tmp/test-repo");
      const [section] = await db()
        .insert(schema.sections)
        .values({ repoVersionId: version.id, path: "01-intro", order: 0 })
        .returning();

      validateCallCount = 0;
      await svc().createRealLesson(section!.id, "New Lesson");
      expect(validateCallCount).toBe(1);
    });

    it("deleting a real lesson validates once after", async () => {
      const { version } = await createCourseWithVersion("/tmp/test-repo");
      const { lessons } = await createSectionWithLessons(
        version.id,
        "01-intro",
        0,
        [
          {
            path: "01.01-my-lesson",
            title: "My Lesson",
            fsStatus: "real",
            order: 0,
          },
        ]
      );

      validateCallCount = 0;
      await svc().deleteLesson(lessons[0]!.id);
      expect(validateCallCount).toBe(1);
    });

    it("moving a real lesson validates once after", async () => {
      const { version } = await createCourseWithVersion("/tmp/test-repo");
      const { lessons } = await createSectionWithLessons(
        version.id,
        "01-intro",
        0,
        [
          {
            path: "01.01-my-lesson",
            title: "My Lesson",
            fsStatus: "real",
            order: 0,
          },
        ]
      );
      const { section: sectionB } = await createSectionWithLessons(
        version.id,
        "02-basics",
        1,
        []
      );

      validateCallCount = 0;
      await svc().moveLessonToSection(lessons[0]!.id, sectionB.id);
      expect(validateCallCount).toBe(1);
    });

    it("renaming a real lesson validates once after", async () => {
      const { version } = await createCourseWithVersion("/tmp/test-repo");
      const { lessons } = await createSectionWithLessons(
        version.id,
        "01-intro",
        0,
        [
          {
            path: "01.01-my-lesson",
            title: "My Lesson",
            fsStatus: "real",
            order: 0,
          },
        ]
      );

      validateCallCount = 0;
      await svc().updateLessonName(lessons[0]!.id, "new-name");
      expect(validateCallCount).toBe(1);
    });
  });
});
