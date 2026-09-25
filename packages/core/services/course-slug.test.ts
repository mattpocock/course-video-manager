import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { CourseOperationsService } from "./db-course-operations.server.js";
import { DrizzleService } from "./drizzle-service.server.js";
import { courseNameToSlug } from "./course-slug.js";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "../test-utils/pglite.js";

let testDb: TestDb;
let testLayer: Layer.Layer<CourseOperationsService>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;

  testLayer = CourseOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as any))
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

describe("courseNameToSlug", () => {
  it("lowercases and dashes spaces", () => {
    expect(courseNameToSlug("My Course")).toBe("my-course");
  });

  it("strips non-alphanumeric characters", () => {
    expect(courseNameToSlug("A/B")).toBe("ab");
  });

  it("collapses consecutive dashes", () => {
    expect(courseNameToSlug("a--b")).toBe("a-b");
  });

  it("trims leading/trailing dashes", () => {
    expect(courseNameToSlug("-hello-")).toBe("hello");
  });

  it("handles names that collapse to the same slug", () => {
    expect(courseNameToSlug("A B")).toBe(courseNameToSlug("A-B"));
  });

  it("returns empty string for non-alphanumeric input", () => {
    expect(courseNameToSlug("///")).toBe("");
  });

  it("preserves digits", () => {
    expect(courseNameToSlug("Course 101")).toBe("course-101");
  });
});

describe("createCourse uniqueness guard", () => {
  it.effect("sets slug on course creation", () =>
    Effect.gen(function* () {
      const courseOps = yield* CourseOperationsService;
      const course = yield* courseOps.createCourse({
        name: "My Course",
      });
      expect(course.slug).toBe("my-course");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("rejects duplicate course name among active courses", () =>
    Effect.gen(function* () {
      const courseOps = yield* CourseOperationsService;
      yield* courseOps.createCourse({
        name: "My Course",
      });

      const error = yield* courseOps
        .createCourse({ name: "My Course" })
        .pipe(Effect.flip);

      expect(error._tag).toBe("CourseNameTakenError");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "rejects names that produce the same slug (e.g. 'A/B' vs 'AB')",
    () =>
      Effect.gen(function* () {
        const courseOps = yield* CourseOperationsService;
        yield* courseOps.createCourse({ name: "AB" });

        const error = yield* courseOps
          .createCourse({ name: "A/B" })
          .pipe(Effect.flip);

        expect(error._tag).toBe("CourseNameTakenError");
      }).pipe(Effect.provide(testLayer))
  );

  it.effect("allows same name when existing course is archived", () =>
    Effect.gen(function* () {
      const courseOps = yield* CourseOperationsService;
      const first = yield* courseOps.createCourse({
        name: "My Course",
      });
      yield* courseOps.updateCourseArchiveStatus({
        repoId: first.id,
        archived: true,
      });

      const second = yield* courseOps.createCourse({
        name: "My Course",
      });
      expect(second.slug).toBe("my-course");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("rejects empty-slug names", () =>
    Effect.gen(function* () {
      const courseOps = yield* CourseOperationsService;
      const error = yield* courseOps
        .createCourse({ name: "///" })
        .pipe(Effect.flip);

      expect(error._tag).toBe("CourseNameTakenError");
    }).pipe(Effect.provide(testLayer))
  );
});

describe("createCourse uniqueness guard (no filePath)", () => {
  it.effect("sets slug on course creation", () =>
    Effect.gen(function* () {
      const courseOps = yield* CourseOperationsService;
      const course = yield* courseOps.createCourse({
        name: "Sample Course",
      });
      expect(course.slug).toBe("sample-course");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("rejects duplicate course name", () =>
    Effect.gen(function* () {
      const courseOps = yield* CourseOperationsService;
      yield* courseOps.createCourse({ name: "Sample Course" });

      const error = yield* courseOps
        .createCourse({ name: "Sample Course" })
        .pipe(Effect.flip);

      expect(error._tag).toBe("CourseNameTakenError");
    }).pipe(Effect.provide(testLayer))
  );
});

describe("updateCourseName uniqueness guard", () => {
  it.effect("updates slug when renaming", () =>
    Effect.gen(function* () {
      const courseOps = yield* CourseOperationsService;
      const course = yield* courseOps.createCourse({
        name: "Original",
      });

      const updated = yield* courseOps.updateCourseName({
        repoId: course.id,
        name: "Renamed",
      });
      expect(updated.slug).toBe("renamed");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("rejects rename to a taken slug", () =>
    Effect.gen(function* () {
      const courseOps = yield* CourseOperationsService;
      yield* courseOps.createCourse({ name: "Alpha" });
      const beta = yield* courseOps.createCourse({
        name: "Beta",
      });

      const error = yield* courseOps
        .updateCourseName({ repoId: beta.id, name: "Alpha" })
        .pipe(Effect.flip);

      expect(error._tag).toBe("CourseNameTakenError");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("allows renaming a course to its own current name", () =>
    Effect.gen(function* () {
      const courseOps = yield* CourseOperationsService;
      const course = yield* courseOps.createCourse({
        name: "Same Name",
      });

      const updated = yield* courseOps.updateCourseName({
        repoId: course.id,
        name: "Same Name",
      });
      expect(updated.slug).toBe("same-name");
    }).pipe(Effect.provide(testLayer))
  );
});
