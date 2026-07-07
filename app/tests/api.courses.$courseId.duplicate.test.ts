import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import * as schema from "@/db/schema";

let testDb: TestDb;
let courseLayer: Layer.Layer<CourseOperationsService>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  courseLayer = CourseOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as any))
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

/**
 * Creates the validation Effect that mirrors the route's logic.
 */
function duplicateCourseValidation(opts: { courseId: string; name: string }) {
  return Effect.gen(function* () {
    const name = opts.name.trim();

    const courseOps = yield* CourseOperationsService;

    const sourceCourse = yield* courseOps.getCourseById(opts.courseId);

    if (name === sourceCourse.name) {
      return yield* Effect.fail({
        error: "New course name must differ from the original",
      });
    }

    const allCourses = yield* courseOps.getCourses();
    const archivedCourses = yield* courseOps.getArchivedCourses();
    const allCoursesCombined = [...allCourses, ...archivedCourses];

    if (allCoursesCombined.some((c) => c.name === name)) {
      return yield* Effect.fail({
        error: "A course with this name already exists",
      });
    }

    const result = yield* courseOps.duplicateCourse({
      sourceCourseId: opts.courseId,
      name,
    });

    return { id: result.course.id };
  });
}

function run<A>(eff: Effect.Effect<A, any, CourseOperationsService>) {
  return Effect.runPromise(eff.pipe(Effect.provide(courseLayer)));
}

function runExpectFail(eff: Effect.Effect<any, any, CourseOperationsService>) {
  return Effect.runPromise(eff.pipe(Effect.flip, Effect.provide(courseLayer)));
}

async function createCourseWithVersion(name: string): Promise<string> {
  const [course] = await testDb
    .insert(schema.courses)
    .values({ name })
    .returning();

  await testDb
    .insert(schema.courseVersions)
    .values({ repoId: course!.id, name: "v1" });

  return course!.id;
}

describe("duplicate course validation", () => {
  it("succeeds when all validations pass", async () => {
    const courseId = await createCourseWithVersion("Course A");

    const result = await run(
      duplicateCourseValidation({
        courseId,
        name: "Course B",
      })
    );

    expect(result).toHaveProperty("id");
  });

  it("rejects name that matches existing course after trimming whitespace", async () => {
    const courseId = await createCourseWithVersion("Course A");
    await createCourseWithVersion("Course B");

    const result = await runExpectFail(
      duplicateCourseValidation({
        courseId,
        name: "  Course B  ",
      })
    );

    expect(result.error).toBe("A course with this name already exists");
  });

  it("rejects name that matches original course after trimming whitespace", async () => {
    const courseId = await createCourseWithVersion("Course A");

    const result = await runExpectFail(
      duplicateCourseValidation({
        courseId,
        name: "  Course A  ",
      })
    );

    expect(result.error).toBe("New course name must differ from the original");
  });
});
