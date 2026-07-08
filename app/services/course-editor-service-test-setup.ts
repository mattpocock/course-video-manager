/**
 * Shared test setup for CourseEditorService integration tests.
 * Provides PGlite-backed service, test helpers, and DB utilities.
 */

import { beforeAll, beforeEach } from "vitest";
import { Layer, ManagedRuntime } from "effect";
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
import { BeatOperationsService } from "./db-beat-operations.server";
import { CourseWriteService } from "./course-write-service";
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
      LessonSectionOperationsService.Default,
      BeatOperationsService.Default
    ).pipe(Layer.provide(testDrizzleLayer));

    const testLayer = testDbFunctionsLayer.pipe(
      Layer.provideMerge(testDrizzleLayer)
    );

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

export async function createCourseWithVersion() {
  const [course] = await testDb
    .insert(schema.courses)
    .values({ name: "Test Course" })
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
    title: string;
    order: number;
  }[]
) {
  const [section] = await testDb
    .insert(schema.sections)
    .values({
      repoVersionId,
      title: sectionPath.replace(/^\d+-/, ""),
      order: sectionOrder,
    })
    .returning();

  const lessons = [];
  for (const def of lessonDefs) {
    const [lesson] = await testDb
      .insert(schema.lessons)
      .values({
        sectionId: section!.id,
        title: def.title,
        order: def.order,
        authoringStatus: "done",
      })
      .returning();
    lessons.push(lesson!);
  }

  return { section: section!, lessons };
}

export { schema };
