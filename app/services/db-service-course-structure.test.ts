import { describe, it, expect } from "@effect/vitest";
import { Effect } from "effect";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import * as schema from "@/db/schema";
import { setupEffectTest } from "@/test-utils/setup-effect-test";

const ctx = setupEffectTest(CourseOperationsService.Default);

const buildCourseWithVideos = async () => {
  const [course] = await ctx.db
    .insert(schema.courses)
    .values({ name: "Test Course", filePath: "/tmp/test-repo" })
    .returning();

  const [version] = await ctx.db
    .insert(schema.courseVersions)
    .values({ repoId: course!.id, name: "v1" })
    .returning();

  const [section] = await ctx.db
    .insert(schema.sections)
    .values({ repoVersionId: version!.id, path: "01-intro", order: 1 })
    .returning();

  const [lessonReal] = await ctx.db
    .insert(schema.lessons)
    .values({
      sectionId: section!.id,
      path: "01-welcome",
      title: "Welcome",
      order: 1,
      fsStatus: "real",
      description: "A welcome lesson",
      authoringStatus: "done",
    })
    .returning();

  const [lessonGhost] = await ctx.db
    .insert(schema.lessons)
    .values({
      sectionId: section!.id,
      path: "02-ghost",
      title: "Ghost Lesson",
      order: 2,
      fsStatus: "ghost",
    })
    .returning();

  // Insert a video with a clip to confirm they are NOT loaded by getCourseStructureById
  const [video] = await ctx.db
    .insert(schema.videos)
    .values({
      lessonId: lessonReal!.id,
      path: "video.mp4",
      originalFootagePath: "footage.mp4",
    })
    .returning();

  await ctx.db.insert(schema.clips).values({
    videoId: video!.id,
    videoFilename: "clip.mp4",
    sourceStartTime: 0,
    sourceEndTime: 10,
    order: "0001",
    text: "hello world",
  });

  return {
    courseId: course!.id,
    versionId: version!.id,
    sectionId: section!.id,
    lessonRealId: lessonReal!.id,
    lessonGhostId: lessonGhost!.id,
    videoId: video!.id,
  };
};

describe("getCourseStructureById - archived section filtering", () => {
  it.effect("excludes archived sections from results", () =>
    Effect.gen(function* () {
      const [course] = yield* Effect.promise(() =>
        ctx.db
          .insert(schema.courses)
          .values({
            name: "Archive Test Course",
            filePath: "/tmp/archive-test",
          })
          .returning()
      );
      const [version] = yield* Effect.promise(() =>
        ctx.db
          .insert(schema.courseVersions)
          .values({ repoId: course!.id, name: "v1" })
          .returning()
      );

      // Insert one active and one archived section
      yield* Effect.promise(() =>
        ctx.db.insert(schema.sections).values([
          { repoVersionId: version!.id, path: "01-active", order: 1 },
          {
            repoVersionId: version!.id,
            path: "02-archived",
            order: 2,
            archivedAt: new Date(),
          },
        ])
      );

      const courseOps = yield* CourseOperationsService;
      const result = yield* courseOps.getCourseStructureById(course!.id);

      const sections = result.versions[0]!.sections;
      expect(sections).toHaveLength(1);
      expect(sections[0]!.path).toBe("01-active");
    }).pipe(Effect.provide(ctx.testLayer))
  );

  it.effect("returns empty sections when all are archived", () =>
    Effect.gen(function* () {
      const [course] = yield* Effect.promise(() =>
        ctx.db
          .insert(schema.courses)
          .values({
            name: "All Archived Course",
            filePath: "/tmp/all-archived",
          })
          .returning()
      );
      const [version] = yield* Effect.promise(() =>
        ctx.db
          .insert(schema.courseVersions)
          .values({ repoId: course!.id, name: "v1" })
          .returning()
      );

      yield* Effect.promise(() =>
        ctx.db.insert(schema.sections).values([
          {
            repoVersionId: version!.id,
            path: "01-archived",
            order: 1,
            archivedAt: new Date(),
          },
          {
            repoVersionId: version!.id,
            path: "02-archived",
            order: 2,
            archivedAt: new Date(),
          },
        ])
      );

      const courseOps = yield* CourseOperationsService;
      const result = yield* courseOps.getCourseStructureById(course!.id);

      expect(result.versions[0]!.sections).toHaveLength(0);
    }).pipe(Effect.provide(ctx.testLayer))
  );
});

describe("getCourseStructureById", () => {
  it.effect("returns course with versions, sections, and lessons", () =>
    Effect.gen(function* () {
      const { courseId, versionId, sectionId, lessonRealId, lessonGhostId } =
        yield* Effect.promise(() => buildCourseWithVideos());

      const courseOps = yield* CourseOperationsService;
      const result = yield* courseOps.getCourseStructureById(courseId);

      expect(result.id).toBe(courseId);
      expect(result.name).toBe("Test Course");
      expect(result.versions).toHaveLength(1);

      const version = result.versions[0]!;
      expect(version.id).toBe(versionId);
      expect(version.sections).toHaveLength(1);

      const section = version.sections[0]!;
      expect(section.id).toBe(sectionId);
      expect(section.path).toBe("01-intro");
      expect(section.lessons).toHaveLength(2);

      const realLesson = section.lessons.find((l) => l.id === lessonRealId)!;
      expect(realLesson.path).toBe("01-welcome");
      expect(realLesson.description).toBe("A welcome lesson");
      expect(realLesson.fsStatus).toBe("real");

      const ghostLesson = section.lessons.find((l) => l.id === lessonGhostId)!;
      expect(ghostLesson.fsStatus).toBe("ghost");
    }).pipe(Effect.provide(ctx.testLayer))
  );

  it.effect("does not include videos or clips on lessons", () =>
    Effect.gen(function* () {
      const { courseId } = yield* Effect.promise(() => buildCourseWithVideos());

      const courseOps = yield* CourseOperationsService;
      const result = yield* courseOps.getCourseStructureById(courseId);

      const lesson = result.versions[0]!.sections[0]!.lessons[0]!;
      expect((lesson as any).videos).toBeUndefined();
    }).pipe(Effect.provide(ctx.testLayer))
  );

  it.effect("throws NotFoundError for unknown course id", () =>
    Effect.gen(function* () {
      const courseOps = yield* CourseOperationsService;
      const result = yield* courseOps
        .getCourseStructureById("nonexistent-id")
        .pipe(Effect.flip);
      expect(result._tag).toBe("NotFoundError");
    }).pipe(Effect.provide(ctx.testLayer))
  );

  it.effect("includes the memory column on the course", () =>
    Effect.gen(function* () {
      const [course] = yield* Effect.promise(() =>
        ctx.db
          .insert(schema.courses)
          .values({
            name: "Memory Course",
            filePath: "/tmp/memory-repo",
            memory: "This is the AI context for the course",
          })
          .returning()
      );
      yield* Effect.promise(() =>
        ctx.db
          .insert(schema.courseVersions)
          .values({ repoId: course!.id, name: "v1" })
      );

      const courseOps = yield* CourseOperationsService;
      const result = yield* courseOps.getCourseStructureById(course!.id);

      expect(result.memory).toBe("This is the AI context for the course");
    }).pipe(Effect.provide(ctx.testLayer))
  );

  it.effect("orders sections and lessons by their order field", () =>
    Effect.gen(function* () {
      const [course] = yield* Effect.promise(() =>
        ctx.db
          .insert(schema.courses)
          .values({ name: "Ordered Course", filePath: "/tmp/ordered" })
          .returning()
      );
      const [version] = yield* Effect.promise(() =>
        ctx.db
          .insert(schema.courseVersions)
          .values({ repoId: course!.id, name: "v1" })
          .returning()
      );

      // Insert sections out of order
      yield* Effect.promise(() =>
        ctx.db
          .insert(schema.sections)
          .values({ repoVersionId: version!.id, path: "02-advanced", order: 2 })
      );
      const [sectionA] = yield* Effect.promise(() =>
        ctx.db
          .insert(schema.sections)
          .values({ repoVersionId: version!.id, path: "01-basics", order: 1 })
          .returning()
      );

      // Insert lessons out of order in first section
      yield* Effect.promise(() =>
        ctx.db.insert(schema.lessons).values([
          {
            sectionId: sectionA!.id,
            path: "02-second",
            title: "Second",
            order: 2,
            fsStatus: "real",
            authoringStatus: "done",
          },
          {
            sectionId: sectionA!.id,
            path: "01-first",
            title: "First",
            order: 1,
            fsStatus: "real",
            authoringStatus: "done",
          },
        ])
      );

      const courseOps = yield* CourseOperationsService;
      const result = yield* courseOps.getCourseStructureById(course!.id);

      const sections = result.versions[0]!.sections;
      expect(sections[0]!.path).toBe("01-basics");
      expect(sections[1]!.path).toBe("02-advanced");

      const lessons = sections[0]!.lessons;
      expect(lessons[0]!.path).toBe("01-first");
      expect(lessons[1]!.path).toBe("02-second");
    }).pipe(Effect.provide(ctx.testLayer))
  );
});
