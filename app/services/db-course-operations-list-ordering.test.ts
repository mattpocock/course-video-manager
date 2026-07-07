import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
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
let testLayer: Layer.Layer<CourseOperationsService>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;

  const drizzleLayer = Layer.succeed(DrizzleService, testDb as any);
  testLayer = Layer.mergeAll(CourseOperationsService.Default).pipe(
    Layer.provide(drizzleLayer)
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

// Insert directly so createdAt is explicit — createCourse defaults it to now,
// which is too coarse to assert an ordering on.
const insertCourse = (opts: {
  name: string;
  slug: string;
  createdAt: Date;
  archived?: boolean;
}) =>
  testDb
    .insert(schema.courses)
    .values({
      name: opts.name,
      slug: opts.slug,
      createdAt: opts.createdAt,
      archived: opts.archived ?? false,
    })
    .returning()
    .then(([row]) => row!);

describe("course list ordering", () => {
  it.effect("getCourses orders active courses by createdAt, newest first", () =>
    Effect.gen(function* () {
      const middle = yield* Effect.promise(() =>
        insertCourse({
          name: "Middle",
          slug: "middle",
          createdAt: new Date("2020-01-01T00:00:00Z"),
        })
      );
      const newest = yield* Effect.promise(() =>
        insertCourse({
          name: "Newest",
          slug: "newest",
          createdAt: new Date("2030-01-01T00:00:00Z"),
        })
      );
      const oldest = yield* Effect.promise(() =>
        insertCourse({
          name: "Oldest",
          slug: "oldest",
          createdAt: new Date("2010-01-01T00:00:00Z"),
        })
      );

      const courseOps = yield* CourseOperationsService;
      const courses = yield* courseOps.getCourses();

      expect(courses.map((c) => c.id)).toEqual([
        newest.id,
        middle.id,
        oldest.id,
      ]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "getArchivedCourses orders archived courses by createdAt, newest first",
    () =>
      Effect.gen(function* () {
        const older = yield* Effect.promise(() =>
          insertCourse({
            name: "Older archived",
            slug: "older-archived",
            createdAt: new Date("2010-01-01T00:00:00Z"),
            archived: true,
          })
        );
        const newer = yield* Effect.promise(() =>
          insertCourse({
            name: "Newer archived",
            slug: "newer-archived",
            createdAt: new Date("2030-01-01T00:00:00Z"),
            archived: true,
          })
        );

        const courseOps = yield* CourseOperationsService;
        const archived = yield* courseOps.getArchivedCourses();

        expect(archived.map((c) => c.id)).toEqual([newer.id, older.id]);
      }).pipe(Effect.provide(testLayer))
  );
});
