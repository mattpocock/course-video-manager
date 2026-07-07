import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import * as schema from "@/db/schema";

let testDb: TestDb;
let testLayer: Layer.Layer<VideoOperationsService>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  const drizzle = Layer.succeed(DrizzleService, testDb as any);
  testLayer = VideoOperationsService.Default.pipe(
    Layer.provide(CourseOperationsService.Default),
    Layer.provide(drizzle)
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

async function seedLessonVideo() {
  const [course] = await testDb
    .insert(schema.courses)
    .values({ name: "Test Course", filePath: "/tmp/test" })
    .returning();
  const [version] = await testDb
    .insert(schema.courseVersions)
    .values({ repoId: course!.id, name: "v1" })
    .returning();
  const [section] = await testDb
    .insert(schema.sections)
    .values({ repoVersionId: version!.id, path: "01-intro", order: 1 })
    .returning();
  const [lesson] = await testDb
    .insert(schema.lessons)
    .values({
      sectionId: section!.id,
      path: "01-hello",
      order: 1,
      fsStatus: "real",
      title: "Hello World",
      authoringStatus: "done",
    })
    .returning();
  const [video] = await testDb
    .insert(schema.videos)
    .values({
      lessonId: lesson!.id,
      path: "explainer",
      originalFootagePath: "/footage/v1",
    })
    .returning();
  return {
    course: course!,
    version: version!,
    section: section!,
    lesson: lesson!,
    video: video!,
  };
}

const run = <A, E>(eff: Effect.Effect<A, E, VideoOperationsService>) =>
  Effect.runPromise(eff.pipe(Effect.provide(testLayer)));

describe("Lesson page — video.body round-trip", () => {
  it("writes body and reads it back from the DB", async () => {
    const { video } = await seedLessonVideo();

    await run(
      Effect.gen(function* () {
        const ops = yield* VideoOperationsService;
        yield* ops.updateVideoBody({
          videoId: video.id,
          body: "# Intro\n\nSome lesson content.",
        });
      })
    );

    const row = await testDb.query.videos.findFirst({
      where: (v, { eq }) => eq(v.id, video.id),
    });

    expect(row!.body).toBe("# Intro\n\nSome lesson content.");
  });

  it("clears body when set to null", async () => {
    const { video } = await seedLessonVideo();

    await run(
      Effect.gen(function* () {
        const ops = yield* VideoOperationsService;
        yield* ops.updateVideoBody({ videoId: video.id, body: "content" });
        yield* ops.updateVideoBody({ videoId: video.id, body: null });
      })
    );

    const row = await testDb.query.videos.findFirst({
      where: (v, { eq }) => eq(v.id, video.id),
    });

    expect(row!.body).toBeNull();
  });
});

describe("Lesson page — video.description round-trip", () => {
  it("writes SEO description and reads it back from the DB", async () => {
    const { video } = await seedLessonVideo();

    await run(
      Effect.gen(function* () {
        const ops = yield* VideoOperationsService;
        yield* ops.updateVideoDescription({
          videoId: video.id,
          description: "A concise SEO description for this lesson.",
        });
      })
    );

    const row = await testDb.query.videos.findFirst({
      where: (v, { eq }) => eq(v.id, video.id),
    });

    expect(row!.description).toBe("A concise SEO description for this lesson.");
  });

  it("does not affect the lesson's own description", async () => {
    const { video, lesson } = await seedLessonVideo();

    await run(
      Effect.gen(function* () {
        const ops = yield* VideoOperationsService;
        yield* ops.updateVideoDescription({
          videoId: video.id,
          description: "Video-level SEO text",
        });
      })
    );

    const dbLesson = await testDb.query.lessons.findFirst({
      where: (l, { eq }) => eq(l.id, lesson.id),
    });

    expect(dbLesson!.description).toBe("");
  });
});
