import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { CourseOperationsService } from "./db-course-operations.server.js";
import { DrizzleService } from "./drizzle-service.server.js";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "../test-utils/pglite.js";
import * as schema from "../db/schema.js";

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

/**
 * A full course -> version -> section -> lesson -> video -> beat tree, plus
 * one Learning Goal on the section, for exercising
 * `getCourseWithSlimClipsById`'s beat<->learning-goal join.
 */
const makeCourseWithBeat = async () => {
  const [course] = await testDb
    .insert(schema.courses)
    .values({ name: "Course" })
    .returning();
  const [version] = await testDb
    .insert(schema.courseVersions)
    .values({ repoId: course!.id, name: "v1" })
    .returning();
  const [section] = await testDb
    .insert(schema.sections)
    .values({ repoVersionId: version!.id, order: 1, title: "Section" })
    .returning();
  const [goal] = await testDb
    .insert(schema.learningGoals)
    .values({ sectionId: section!.id, order: 1, title: "Explain closures" })
    .returning();
  const [lesson] = await testDb
    .insert(schema.lessons)
    .values({ sectionId: section!.id, order: 1, title: "Lesson" })
    .returning();
  const [video] = await testDb
    .insert(schema.videos)
    .values({
      lessonId: lesson!.id,
      title: "Video",
      originalFootagePath: "/footage/video",
    })
    .returning();
  const [beat] = await testDb
    .insert(schema.beats)
    .values({ videoId: video!.id, order: "a0" })
    .returning();

  return { course: course!, section: section!, goal: goal!, beat: beat! };
};

describe("getCourseWithSlimClipsById", () => {
  it.effect(
    "a beat with no Learning Goal link has an empty learningGoalIds",
    () =>
      Effect.gen(function* () {
        const { course } = yield* Effect.promise(() => makeCourseWithBeat());
        const svc = yield* CourseOperationsService;

        const result = yield* svc.getCourseWithSlimClipsById(course.id);

        const beat =
          result.versions[0]!.sections[0]!.lessons[0]!.videos[0]!.beats[0]!;
        expect(beat.learningGoalIds).toEqual([]);
        // The join table's own shape never leaks to the caller.
        expect(beat).not.toHaveProperty("beatLearningGoals");
      }).pipe(Effect.provide(testLayer))
  );

  it.effect("surfaces the Learning Goal(s) a beat serves", () =>
    Effect.gen(function* () {
      const { course, goal, beat } = yield* Effect.promise(() =>
        makeCourseWithBeat()
      );
      yield* Effect.promise(() =>
        testDb
          .insert(schema.beatLearningGoals)
          .values({ beatId: beat.id, learningGoalId: goal.id })
      );
      const svc = yield* CourseOperationsService;

      const result = yield* svc.getCourseWithSlimClipsById(course.id);

      const resultBeat =
        result.versions[0]!.sections[0]!.lessons[0]!.videos[0]!.beats[0]!;
      expect(resultBeat.learningGoalIds).toEqual([goal.id]);
    }).pipe(Effect.provide(testLayer))
  );
});
