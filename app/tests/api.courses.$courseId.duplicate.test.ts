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
import { FileSystem } from "@effect/platform";
import * as Path from "node:path";

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
 * Creates the validation Effect that mirrors the route's logic,
 * so we can test it with a mock FileSystem layer.
 */
function duplicateCourseValidation(opts: {
  courseId: string;
  name: string;
  filePath: string;
}) {
  return Effect.gen(function* () {
    const name = opts.name.trim();
    const filePath = opts.filePath.trim();

    const courseOps = yield* CourseOperationsService;

    const sourceCourse = yield* courseOps.getCourseById(opts.courseId);

    if (name === sourceCourse.name) {
      return yield* Effect.fail({
        error: "New course name must differ from the original",
      });
    }

    if (filePath === sourceCourse.filePath) {
      return yield* Effect.fail({
        error: "New file path must differ from the original",
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

    if (allCoursesCombined.some((c) => c.filePath === filePath)) {
      return yield* Effect.fail({
        error: "A course with this file path already exists",
      });
    }

    const fs = yield* FileSystem.FileSystem;
    const pathExists = yield* fs.exists(filePath);

    if (!pathExists) {
      return yield* Effect.fail({
        error: `Directory does not exist: ${filePath}`,
      });
    }

    // Check path and ancestors for .git
    let isGitRepo = false;
    let checkDir = filePath;
    while (true) {
      const gitDirPath = Path.join(checkDir, ".git");
      if (yield* fs.exists(gitDirPath)) {
        isGitRepo = true;
        break;
      }
      const parentDir = Path.dirname(checkDir);
      if (parentDir === checkDir) break;
      checkDir = parentDir;
    }

    if (!isGitRepo) {
      return yield* Effect.fail({
        error: `Directory is not a valid git repository: ${filePath}`,
      });
    }

    const result = yield* courseOps.duplicateCourse({
      sourceCourseId: opts.courseId,
      name,
      filePath,
    });

    return { id: result.course.id };
  });
}

function makeFsLayer(existingPaths: string[]) {
  return FileSystem.layerNoop({
    exists: (filePath) =>
      Effect.succeed(existingPaths.includes(filePath as string)),
  });
}

function run<A>(
  eff: Effect.Effect<A, any, CourseOperationsService | FileSystem.FileSystem>,
  existingPaths: string[] = []
) {
  return Effect.runPromise(
    eff.pipe(
      Effect.provide(courseLayer),
      Effect.provide(makeFsLayer(existingPaths))
    )
  );
}

function runExpectFail(
  eff: Effect.Effect<any, any, CourseOperationsService | FileSystem.FileSystem>,
  existingPaths: string[] = []
) {
  return Effect.runPromise(
    eff.pipe(
      Effect.flip,
      Effect.provide(courseLayer),
      Effect.provide(makeFsLayer(existingPaths))
    )
  );
}

async function createCourseWithVersion(
  name: string,
  filePath: string
): Promise<string> {
  const [course] = await testDb
    .insert(schema.courses)
    .values({ name, filePath })
    .returning();

  await testDb
    .insert(schema.courseVersions)
    .values({ repoId: course!.id, name: "v1" });

  return course!.id;
}

describe("duplicate course validation", () => {
  it("rejects duplication if file path is already used by another course", async () => {
    const courseId = await createCourseWithVersion(
      "Course A",
      "/path/to/course-a"
    );
    await createCourseWithVersion("Course B", "/path/to/course-b");

    const result = await runExpectFail(
      duplicateCourseValidation({
        courseId,
        name: "Course C",
        filePath: "/path/to/course-b",
      }),
      ["/path/to/course-b", "/path/to/course-b/.git"]
    );

    expect(result.error).toBe("A course with this file path already exists");
  });

  it("rejects duplication if directory does not exist on disk", async () => {
    const courseId = await createCourseWithVersion(
      "Course A",
      "/path/to/course-a"
    );

    const result = await runExpectFail(
      duplicateCourseValidation({
        courseId,
        name: "Course B",
        filePath: "/path/to/nonexistent",
      }),
      [] // No paths exist on disk
    );

    expect(result.error).toBe("Directory does not exist: /path/to/nonexistent");
  });

  it("rejects duplication if directory is not a git repository", async () => {
    const courseId = await createCourseWithVersion(
      "Course A",
      "/path/to/course-a"
    );

    const result = await runExpectFail(
      duplicateCourseValidation({
        courseId,
        name: "Course B",
        filePath: "/path/to/not-git",
      }),
      ["/path/to/not-git"] // Directory exists but no .git
    );

    expect(result.error).toBe(
      "Directory is not a valid git repository: /path/to/not-git"
    );
  });

  it("succeeds when all validations pass", async () => {
    const courseId = await createCourseWithVersion(
      "Course A",
      "/path/to/course-a"
    );

    const result = await run(
      duplicateCourseValidation({
        courseId,
        name: "Course B",
        filePath: "/path/to/new-course",
      }),
      ["/path/to/new-course", "/path/to/new-course/.git"]
    );

    expect(result).toHaveProperty("id");
  });

  it("rejects file path that matches the original course", async () => {
    const courseId = await createCourseWithVersion(
      "Course A",
      "/path/to/course-a"
    );

    const result = await runExpectFail(
      duplicateCourseValidation({
        courseId,
        name: "Course B",
        filePath: "/path/to/course-a",
      }),
      ["/path/to/course-a", "/path/to/course-a/.git"]
    );

    expect(result.error).toBe("New file path must differ from the original");
  });

  it("rejects file path used by an archived course", async () => {
    const courseId = await createCourseWithVersion(
      "Course A",
      "/path/to/course-a"
    );

    // Create an archived course
    const [archivedCourse] = await testDb
      .insert(schema.courses)
      .values({
        name: "Archived",
        filePath: "/path/to/archived",
        archived: true,
      })
      .returning();

    await testDb
      .insert(schema.courseVersions)
      .values({ repoId: archivedCourse!.id, name: "v1" });

    const result = await runExpectFail(
      duplicateCourseValidation({
        courseId,
        name: "Course B",
        filePath: "/path/to/archived",
      }),
      ["/path/to/archived", "/path/to/archived/.git"]
    );

    expect(result.error).toBe("A course with this file path already exists");
  });

  it("rejects name that matches existing course after trimming whitespace", async () => {
    const courseId = await createCourseWithVersion(
      "Course A",
      "/path/to/course-a"
    );
    await createCourseWithVersion("Course B", "/path/to/course-b");

    const result = await runExpectFail(
      duplicateCourseValidation({
        courseId,
        name: "  Course B  ",
        filePath: "/path/to/new-course",
      }),
      ["/path/to/new-course", "/path/to/new-course/.git"]
    );

    expect(result.error).toBe("A course with this name already exists");
  });

  it("rejects file path that matches existing course after trimming whitespace", async () => {
    const courseId = await createCourseWithVersion(
      "Course A",
      "/path/to/course-a"
    );
    await createCourseWithVersion("Course B", "/path/to/course-b");

    const result = await runExpectFail(
      duplicateCourseValidation({
        courseId,
        name: "Course C",
        filePath: "  /path/to/course-b  ",
      }),
      ["/path/to/course-b", "/path/to/course-b/.git"]
    );

    expect(result.error).toBe("A course with this file path already exists");
  });

  it("succeeds when path is inside a parent git repository (not itself a git root)", async () => {
    const courseId = await createCourseWithVersion(
      "Course A",
      "/path/to/course-a"
    );

    // The directory exists, no .git in it, but a parent has .git
    const result = await run(
      duplicateCourseValidation({
        courseId,
        name: "Course B",
        filePath: "/path/to/parent-repo/sub-dir",
      }),
      ["/path/to/parent-repo/sub-dir", "/path/to/parent-repo/.git"]
    );

    expect(result).toHaveProperty("id");
  });

  it("rejects name that matches original course after trimming whitespace", async () => {
    const courseId = await createCourseWithVersion(
      "Course A",
      "/path/to/course-a"
    );

    const result = await runExpectFail(
      duplicateCourseValidation({
        courseId,
        name: "  Course A  ",
        filePath: "/path/to/new-course",
      }),
      ["/path/to/new-course", "/path/to/new-course/.git"]
    );

    expect(result.error).toBe("New course name must differ from the original");
  });
});
