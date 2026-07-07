import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import { courses } from "@/db/schema";
import { courseNameToSlug } from "@/services/course-slug";
import { backfillCourseSlugs } from "@/services/course-slug-backfill";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import { eq } from "drizzle-orm";

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
        name: "Ghost Course",
      });
      expect(course.slug).toBe("ghost-course");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("rejects duplicate course name", () =>
    Effect.gen(function* () {
      const courseOps = yield* CourseOperationsService;
      yield* courseOps.createCourse({ name: "Ghost Course" });

      const error = yield* courseOps
        .createCourse({ name: "Ghost Course" })
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

describe("backfillCourseSlugs", () => {
  it("sets slug for all courses", async () => {
    await testDb
      .insert(courses)
      .values([{ name: "Course A" }, { name: "Course B" }]);

    await backfillCourseSlugs(testDb as any);

    const result = await testDb.select().from(courses);
    expect(result.map((c) => c.slug).sort()).toEqual(["course-a", "course-b"]);
  });

  it("deduplicates colliding slugs deterministically (keep first by createdAt)", async () => {
    const now = new Date();
    const later = new Date(now.getTime() + 1000);

    await testDb.insert(courses).values([
      { id: "first", name: "My Course", createdAt: now },
      { id: "second", name: "My Course", createdAt: later },
    ]);

    await backfillCourseSlugs(testDb as any);

    const first = await testDb.query.courses.findFirst({
      where: eq(courses.id, "first"),
    });
    const second = await testDb.query.courses.findFirst({
      where: eq(courses.id, "second"),
    });

    expect(first!.slug).toBe("my-course");
    expect(first!.name).toBe("My Course");
    expect(second!.slug).toBe("my-course-2");
    expect(second!.name).toBe("My Course-2");
  });

  it("handles triple collision with -2 and -3 suffixes", async () => {
    const t1 = new Date("2024-01-01");
    const t2 = new Date("2024-01-02");
    const t3 = new Date("2024-01-03");

    await testDb.insert(courses).values([
      { id: "a", name: "Foo", createdAt: t1 },
      { id: "b", name: "Foo", createdAt: t2 },
      { id: "c", name: "Foo", createdAt: t3 },
    ]);

    await backfillCourseSlugs(testDb as any);

    const all = await testDb.select().from(courses);
    const byId = Object.fromEntries(all.map((c) => [c.id, c]));

    expect(byId["a"]!.slug).toBe("foo");
    expect(byId["b"]!.slug).toBe("foo-2");
    expect(byId["c"]!.slug).toBe("foo-3");
  });

  it("deduplicates names that produce the same slug", async () => {
    await testDb.insert(courses).values([
      {
        id: "a",
        name: "A B",
        createdAt: new Date("2024-01-01"),
      },
      {
        id: "b",
        name: "A-B",
        createdAt: new Date("2024-01-02"),
      },
    ]);

    await backfillCourseSlugs(testDb as any);

    const all = await testDb.select().from(courses);
    const byId = Object.fromEntries(all.map((c) => [c.id, c]));

    expect(byId["a"]!.slug).toBe("a-b");
    expect(byId["b"]!.slug).toBe("a-b-2");
    expect(byId["b"]!.name).toBe("A-B-2");
  });

  it("does not rename archived courses even if slugs collide", async () => {
    await testDb.insert(courses).values([
      { id: "active", name: "My Course", archived: false },
      { id: "archived", name: "My Course", archived: true },
    ]);

    await backfillCourseSlugs(testDb as any);

    const active = await testDb.query.courses.findFirst({
      where: eq(courses.id, "active"),
    });
    const archived = await testDb.query.courses.findFirst({
      where: eq(courses.id, "archived"),
    });

    expect(active!.slug).toBe("my-course");
    expect(active!.name).toBe("My Course");
    expect(archived!.slug).toBe("my-course");
    expect(archived!.name).toBe("My Course");
  });

  it("uses id as tiebreaker when createdAt is identical", async () => {
    const sameTime = new Date("2024-01-01");

    await testDb.insert(courses).values([
      { id: "zzz", name: "Same", createdAt: sameTime },
      { id: "aaa", name: "Same", createdAt: sameTime },
    ]);

    await backfillCourseSlugs(testDb as any);

    const all = await testDb.select().from(courses);
    const byId = Object.fromEntries(all.map((c) => [c.id, c]));

    expect(byId["aaa"]!.slug).toBe("same");
    expect(byId["aaa"]!.name).toBe("Same");
    expect(byId["zzz"]!.slug).toBe("same-2");
    expect(byId["zzz"]!.name).toBe("Same-2");
  });
});
