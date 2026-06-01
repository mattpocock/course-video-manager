/**
 * Shared test setup for CourseEditorService integration tests.
 * Provides PGlite-backed service, test helpers, and DB utilities.
 */

import { beforeAll, beforeEach } from "vitest";
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

export let testDb: TestDb;
export let editorService: CourseEditorService;

export function setupEditorServiceTests() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let runtime: ManagedRuntime.ManagedRuntime<any, any>;

  beforeAll(async () => {
    const result = await createTestDb();
    testDb = result.testDb;
  });

  beforeEach(async () => {
    await truncateAllTables(testDb);

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

    const mockSyncValidationLayer = Layer.succeed(
      CourseRepoSyncValidationService,
      { validate: () => Effect.void } as any
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

    runtime = ManagedRuntime.make(fullLayer);
    editorService = createDirectCourseEditorService((effect) =>
      runtime.runPromise(effect as any)
    );
  });
}

// ============================================================================
// Test helpers
// ============================================================================

export async function createCourseWithVersion(
  filePath: string | null = "/tmp/test-repo"
) {
  const [course] = await testDb
    .insert(schema.courses)
    .values({ name: "Test Course", filePath })
    .returning();

  const [version] = await testDb
    .insert(schema.courseVersions)
    .values({ repoId: course!.id, name: "v1" })
    .returning();

  return { course: course!, version: version! };
}

export async function getSections(repoVersionId: string) {
  return testDb.query.sections.findMany({
    where: (s, { eq, and, isNull }) =>
      and(eq(s.repoVersionId, repoVersionId), isNull(s.archivedAt)),
    orderBy: (s, { asc }) => asc(s.order),
  });
}

export async function getLessons(sectionId: string) {
  return testDb.query.lessons.findMany({
    where: (l, { eq, and }) =>
      and(eq(l.sectionId, sectionId), eq(l.archived, false)),
    orderBy: (l, { asc }) => asc(l.order),
  });
}

export async function getLessonById(lessonId: string) {
  return testDb.query.lessons.findFirst({
    where: (l, { eq }) => eq(l.id, lessonId),
  });
}

export async function createSectionWithLessons(
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
  const [section] = await testDb
    .insert(schema.sections)
    .values({
      repoVersionId,
      path: sectionPath,
      order: sectionOrder,
    })
    .returning();

  const lessons = [];
  for (const def of lessonDefs) {
    const [lesson] = await testDb
      .insert(schema.lessons)
      .values({
        sectionId: section!.id,
        path: def.path,
        title: def.title,
        fsStatus: def.fsStatus,
        order: def.order,
        authoringStatus: def.fsStatus === "real" ? "done" : null,
      })
      .returning();
    lessons.push(lesson!);
  }

  return { section: section!, lessons };
}

export { schema };
