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
import { VersionOperationsService } from "@/services/db-version-operations.server";

let testDb: TestDb;
let testLayer: Layer.Layer<VideoOperationsService | VersionOperationsService>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  const drizzle = Layer.succeed(DrizzleService, testDb as any);
  testLayer = Layer.mergeAll(
    VideoOperationsService.Default,
    VersionOperationsService.Default
  ).pipe(
    Layer.provide(CourseOperationsService.Default),
    Layer.provide(drizzle)
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

async function seedVideo() {
  const [course] = await testDb
    .insert(schema.courses)
    .values({ name: "Test" })
    .returning();
  const [version] = await testDb
    .insert(schema.courseVersions)
    .values({ repoId: course!.id, name: "v1" })
    .returning();
  const [section] = await testDb
    .insert(schema.sections)
    .values({ repoVersionId: version!.id, title: "01-intro", order: 1 })
    .returning();
  const [lesson] = await testDb
    .insert(schema.lessons)
    .values({
      sectionId: section!.id,
      order: 1,
      title: "Lesson",
      authoringStatus: "done",
    })
    .returning();
  const [video] = await testDb
    .insert(schema.videos)
    .values({
      lessonId: lesson!.id,
      title: "explainer",
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

const run = <A, E>(
  eff: Effect.Effect<A, E, VideoOperationsService | VersionOperationsService>
) => Effect.runPromise(eff.pipe(Effect.provide(testLayer)));

describe("updateVideoBody", () => {
  it("persists a markdown body on a video", async () => {
    const { video } = await seedVideo();

    const updated = await run(
      Effect.gen(function* () {
        const ops = yield* VideoOperationsService;
        return yield* ops.updateVideoBody({
          videoId: video.id,
          body: "# Hello World\n\nThis is the body.",
        });
      })
    );

    expect(updated.body).toBe("# Hello World\n\nThis is the body.");
  });

  it("can set body to null", async () => {
    const { video } = await seedVideo();

    await run(
      Effect.gen(function* () {
        const ops = yield* VideoOperationsService;
        yield* ops.updateVideoBody({
          videoId: video.id,
          body: "some content",
        });
      })
    );

    const updated = await run(
      Effect.gen(function* () {
        const ops = yield* VideoOperationsService;
        return yield* ops.updateVideoBody({
          videoId: video.id,
          body: null,
        });
      })
    );

    expect(updated.body).toBeNull();
  });

  it("fails with NotFoundError for a non-existent video", async () => {
    await expect(
      run(
        Effect.gen(function* () {
          const ops = yield* VideoOperationsService;
          return yield* ops.updateVideoBody({
            videoId: "non-existent-id",
            body: "content",
          });
        })
      )
    ).rejects.toThrow();
  });
});

describe("updateVideoDescription", () => {
  it("persists an SEO description on a video", async () => {
    const { video } = await seedVideo();

    const updated = await run(
      Effect.gen(function* () {
        const ops = yield* VideoOperationsService;
        return yield* ops.updateVideoDescription({
          videoId: video.id,
          description: "Learn about closures in JavaScript",
        });
      })
    );

    expect(updated.description).toBe("Learn about closures in JavaScript");
  });

  it("can set description to null", async () => {
    const { video } = await seedVideo();

    await run(
      Effect.gen(function* () {
        const ops = yield* VideoOperationsService;
        yield* ops.updateVideoDescription({
          videoId: video.id,
          description: "initial",
        });
      })
    );

    const updated = await run(
      Effect.gen(function* () {
        const ops = yield* VideoOperationsService;
        return yield* ops.updateVideoDescription({
          videoId: video.id,
          description: null,
        });
      })
    );

    expect(updated.description).toBeNull();
  });

  it("does not affect lesson.description", async () => {
    const { video, lesson } = await seedVideo();

    await run(
      Effect.gen(function* () {
        const ops = yield* VideoOperationsService;
        yield* ops.updateVideoDescription({
          videoId: video.id,
          description: "SEO description",
        });
      })
    );

    const dbLesson = await testDb.query.lessons.findFirst({
      where: (l, { eq }) => eq(l.id, lesson.id),
    });

    expect(dbLesson!.description).toBe("");
  });
});

describe("video body/description copy-forward", () => {
  it("copies body and description forward on version clone", async () => {
    const { course, version, video } = await seedVideo();

    await run(
      Effect.gen(function* () {
        const ops = yield* VideoOperationsService;
        yield* ops.updateVideoBody({
          videoId: video.id,
          body: "# Lesson body",
        });
        yield* ops.updateVideoDescription({
          videoId: video.id,
          description: "SEO desc",
        });
      })
    );

    const result = await run(
      Effect.gen(function* () {
        const ops = yield* VersionOperationsService;
        return yield* ops.copyVersionStructure({
          sourceVersionId: version.id,
          repoId: course.id,
          newVersionName: "v2",
        });
      })
    );

    const newVideoId = result.videoIdMappings.find(
      (m) => m.sourceVideoId === video.id
    )!.newVideoId;

    const newVideo = await testDb.query.videos.findFirst({
      where: (v, { eq }) => eq(v.id, newVideoId),
    });

    expect(newVideo!.body).toBe("# Lesson body");
    expect(newVideo!.description).toBe("SEO desc");
  });
});
