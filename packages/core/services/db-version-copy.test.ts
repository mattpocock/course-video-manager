import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { VersionOperationsService } from "./db-version-operations.server.js";
import { DrizzleService } from "./drizzle-service.server.js";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "../test-utils/pglite.js";
import * as schema from "../db/schema.js";

let testDb: TestDb;
let testLayer: Layer.Layer<VersionOperationsService>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  testLayer = VersionOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as any))
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

const run = <A, E>(eff: Effect.Effect<A, E, VersionOperationsService>) =>
  Effect.runPromise(eff.pipe(Effect.provide(testLayer)));

describe("copyVersionStructure", () => {
  it("preserves lesson icon (type) when copying a version", async () => {
    const [course] = await testDb
      .insert(schema.courses)
      .values({ name: "Test Course" })
      .returning();

    const [version] = await testDb
      .insert(schema.courseVersions)
      .values({ repoId: course!.id, name: "v1" })
      .returning();

    const [section] = await testDb
      .insert(schema.sections)
      .values({ repoVersionId: version!.id, title: "01-intro", order: 1 })
      .returning();

    await testDb.insert(schema.lessons).values({
      sectionId: section!.id,
      order: 1,
      icon: "code",
      title: "Test Lesson",
      authoringStatus: "done",
    });

    const result = await run(
      Effect.gen(function* () {
        const versionOps = yield* VersionOperationsService;
        return yield* versionOps.copyVersionStructure({
          sourceVersionId: version!.id,
          repoId: course!.id,
          newVersionName: "v2",
        });
      })
    );

    const newSections = await testDb.query.sections.findMany({
      where: (s, { eq }) => eq(s.repoVersionId, result.version.id),
      with: { lessons: true },
    });

    expect(newSections).toHaveLength(1);
    expect(newSections[0]!.lessons).toHaveLength(1);
    expect(newSections[0]!.lessons[0]!.icon).toBe("code");
  });

  it("preserves section description when copying a version", async () => {
    const [course] = await testDb
      .insert(schema.courses)
      .values({ name: "Test Course 2" })
      .returning();

    const [version] = await testDb
      .insert(schema.courseVersions)
      .values({ repoId: course!.id, name: "v1" })
      .returning();

    await testDb.insert(schema.sections).values({
      repoVersionId: version!.id,
      title: "01-intro",
      order: 1,
      description: "This is a section description",
    });

    const result = await run(
      Effect.gen(function* () {
        const versionOps = yield* VersionOperationsService;
        return yield* versionOps.copyVersionStructure({
          sourceVersionId: version!.id,
          repoId: course!.id,
          newVersionName: "v2",
        });
      })
    );

    const newSections = await testDb.query.sections.findMany({
      where: (s, { eq }) => eq(s.repoVersionId, result.version.id),
    });

    expect(newSections).toHaveLength(1);
    expect(newSections[0]!.description).toBe("This is a section description");
  });

  it("skips archived sections when copying a version", async () => {
    const [course] = await testDb
      .insert(schema.courses)
      .values({ name: "Archive Copy Test" })
      .returning();

    const [version] = await testDb
      .insert(schema.courseVersions)
      .values({ repoId: course!.id, name: "v1" })
      .returning();

    // One active section, one archived
    await testDb.insert(schema.sections).values([
      { repoVersionId: version!.id, title: "01-active", order: 1 },
      {
        repoVersionId: version!.id,
        title: "02-archived",
        order: 2,
        archivedAt: new Date(),
      },
    ]);

    const result = await run(
      Effect.gen(function* () {
        const versionOps = yield* VersionOperationsService;
        return yield* versionOps.copyVersionStructure({
          sourceVersionId: version!.id,
          repoId: course!.id,
          newVersionName: "v2",
        });
      })
    );

    const newSections = await testDb.query.sections.findMany({
      where: (s, { eq }) => eq(s.repoVersionId, result.version.id),
    });

    expect(newSections).toHaveLength(1);
    expect(newSections[0]!.title).toBe("01-active");
  });

  it("skips archived lessons when copying a version", async () => {
    const [course] = await testDb
      .insert(schema.courses)
      .values({
        name: "Archived Lesson Copy Test",
      })
      .returning();

    const [version] = await testDb
      .insert(schema.courseVersions)
      .values({ repoId: course!.id, name: "v1" })
      .returning();

    const [section] = await testDb
      .insert(schema.sections)
      .values({ repoVersionId: version!.id, title: "01-intro", order: 1 })
      .returning();

    await testDb.insert(schema.lessons).values([
      {
        sectionId: section!.id,
        order: 1,
        title: "Active Lesson",
        authoringStatus: "done",
      },
      {
        sectionId: section!.id,
        order: 2,
        title: "Archived Lesson",
        authoringStatus: "done",
        archived: true,
      },
    ]);

    const result = await run(
      Effect.gen(function* () {
        const versionOps = yield* VersionOperationsService;
        return yield* versionOps.copyVersionStructure({
          sourceVersionId: version!.id,
          repoId: course!.id,
          newVersionName: "v2",
        });
      })
    );

    const newSections = await testDb.query.sections.findMany({
      where: (s, { eq }) => eq(s.repoVersionId, result.version.id),
      with: { lessons: true },
    });

    expect(newSections).toHaveLength(1);
    expect(newSections[0]!.lessons).toHaveLength(1);
    expect(newSections[0]!.lessons[0]!.title).toBe("Active Lesson");
  });

  it("preserves lesson authoringStatus when copying a version", async () => {
    const [course] = await testDb
      .insert(schema.courses)
      .values({ name: "AuthoringStatus Copy" })
      .returning();

    const [version] = await testDb
      .insert(schema.courseVersions)
      .values({ repoId: course!.id, name: "v1" })
      .returning();

    const [section] = await testDb
      .insert(schema.sections)
      .values({ repoVersionId: version!.id, title: "01-intro", order: 1 })
      .returning();

    await testDb.insert(schema.lessons).values([
      {
        sectionId: section!.id,
        order: 1,
        title: "Todo Lesson",
        authoringStatus: "todo",
      },
      {
        sectionId: section!.id,
        order: 2,
        title: "Done Lesson",
        authoringStatus: "done",
      },
      {
        sectionId: section!.id,
        order: 3,
        title: "Lesson",
        authoringStatus: "todo",
      },
    ]);

    const result = await run(
      Effect.gen(function* () {
        const versionOps = yield* VersionOperationsService;
        return yield* versionOps.copyVersionStructure({
          sourceVersionId: version!.id,
          repoId: course!.id,
          newVersionName: "v2",
        });
      })
    );

    const newSections = await testDb.query.sections.findMany({
      where: (s, { eq }) => eq(s.repoVersionId, result.version.id),
      with: { lessons: { orderBy: (l, { asc }) => asc(l.order) } },
    });

    expect(newSections[0]!.lessons).toHaveLength(3);
    expect(newSections[0]!.lessons[0]!.authoringStatus).toBe("todo");
    expect(newSections[0]!.lessons[1]!.authoringStatus).toBe("done");
    expect(newSections[0]!.lessons[2]!.authoringStatus).toBe("todo");
  });

  it("copies a video's beats, preserving kind/title/order", async () => {
    const [course] = await testDb
      .insert(schema.courses)
      .values({ name: "Test Course" })
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
        title: "01-intro/01-lesson/video.mp4",
        originalFootagePath: "/footage/v1",
      })
      .returning();

    await testDb.insert(schema.beats).values([
      {
        videoId: video!.id,
        kind: "definition",
        title: "Closures",
        description: "Explain JS closures",
        order: "a0",
      },
      {
        videoId: video!.id,
        kind: "quest",
        title: "Build a cache",
        description: "Build a memoization cache",
        order: "a1",
      },
    ]);

    const result = await run(
      Effect.gen(function* () {
        const versionOps = yield* VersionOperationsService;
        return yield* versionOps.copyVersionStructure({
          sourceVersionId: version!.id,
          repoId: course!.id,
          newVersionName: "v2",
        });
      })
    );

    const newVideoId = result.videoIdMappings.find(
      (m) => m.sourceVideoId === video!.id
    )!.newVideoId;

    const copied = await testDb.query.beats.findMany({
      where: (s, { eq }) => eq(s.videoId, newVideoId),
      orderBy: (s, { asc }) => asc(s.order),
    });

    expect(
      copied.map((s) => ({
        kind: s.kind,
        title: s.title,
        description: s.description,
      }))
    ).toEqual([
      {
        kind: "definition",
        title: "Closures",
        description: "Explain JS closures",
      },
      {
        kind: "quest",
        title: "Build a cache",
        description: "Build a memoization cache",
      },
    ]);
  });

  it("excludes archived beats when copying a video", async () => {
    const [course] = await testDb
      .insert(schema.courses)
      .values({ name: "Test Course" })
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
        title: "01-intro/01-lesson/video.mp4",
        originalFootagePath: "/footage/v1",
      })
      .returning();

    await testDb.insert(schema.beats).values([
      {
        videoId: video!.id,
        kind: "definition",
        title: "Active",
        order: "a0",
        archived: false,
      },
      {
        videoId: video!.id,
        kind: "quest",
        title: "Archived",
        order: "a1",
        archived: true,
      },
    ]);

    const result = await run(
      Effect.gen(function* () {
        const versionOps = yield* VersionOperationsService;
        return yield* versionOps.copyVersionStructure({
          sourceVersionId: version!.id,
          repoId: course!.id,
          newVersionName: "v2",
        });
      })
    );

    const newVideoId = result.videoIdMappings.find(
      (m) => m.sourceVideoId === video!.id
    )!.newVideoId;

    const copied = await testDb.query.beats.findMany({
      where: (s, { eq }) => eq(s.videoId, newVideoId),
      orderBy: (s, { asc }) => asc(s.order),
    });

    expect(copied.map((s) => ({ kind: s.kind, title: s.title }))).toEqual([
      { kind: "definition", title: "Active" },
    ]);
  });

  it("copies a video's clip mockups, preserving line/imagePath/order", async () => {
    const [course] = await testDb
      .insert(schema.courses)
      .values({ name: "Test Course" })
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
        title: "01-intro/01-lesson/video.mp4",
        originalFootagePath: "/footage/v1",
      })
      .returning();

    // Inserted out of order on purpose: the copy must follow `order`, not
    // insertion order.
    await testDb.insert(schema.clipMockups).values([
      {
        videoId: video!.id,
        line: "Second line",
        imagePath: "frame-002.png",
        audioPath: "speech-002.wav",
        durationSeconds: 3.5,
        order: "a1",
      },
      {
        videoId: video!.id,
        line: "First line",
        imagePath: "frame-001.png",
        audioPath: "speech-001.wav",
        durationSeconds: 1.25,
        order: "a0",
      },
    ]);

    const result = await run(
      Effect.gen(function* () {
        const versionOps = yield* VersionOperationsService;
        return yield* versionOps.copyVersionStructure({
          sourceVersionId: version!.id,
          repoId: course!.id,
          newVersionName: "v2",
        });
      })
    );

    const newVideoId = result.videoIdMappings.find(
      (m) => m.sourceVideoId === video!.id
    )!.newVideoId;

    const copied = await testDb.query.clipMockups.findMany({
      where: (s, { eq }) => eq(s.videoId, newVideoId),
      orderBy: (s, { asc }) => asc(s.order),
    });

    expect(
      copied.map((s) => ({
        line: s.line,
        imagePath: s.imagePath,
        durationSeconds: s.durationSeconds,
        order: s.order,
        archived: s.archived,
      }))
    ).toEqual([
      {
        line: "First line",
        imagePath: "frame-001.png",
        durationSeconds: 1.25,
        order: "a0",
        archived: false,
      },
      {
        line: "Second line",
        imagePath: "frame-002.png",
        durationSeconds: 3.5,
        order: "a1",
        archived: false,
      },
    ]);
  });

  it("excludes archived clip mockups when copying a video", async () => {
    const [course] = await testDb
      .insert(schema.courses)
      .values({ name: "Test Course" })
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
        title: "01-intro/01-lesson/video.mp4",
        originalFootagePath: "/footage/v1",
      })
      .returning();

    await testDb.insert(schema.clipMockups).values([
      {
        videoId: video!.id,
        line: "Active",
        imagePath: "active.png",
        audioPath: "active.wav",
        durationSeconds: 1,
        order: "a0",
        archived: false,
      },
      {
        videoId: video!.id,
        line: "Archived",
        imagePath: "archived.png",
        audioPath: "archived.wav",
        durationSeconds: 1,
        order: "a1",
        archived: true,
      },
    ]);

    const result = await run(
      Effect.gen(function* () {
        const versionOps = yield* VersionOperationsService;
        return yield* versionOps.copyVersionStructure({
          sourceVersionId: version!.id,
          repoId: course!.id,
          newVersionName: "v2",
        });
      })
    );

    const newVideoId = result.videoIdMappings.find(
      (m) => m.sourceVideoId === video!.id
    )!.newVideoId;

    const copied = await testDb.query.clipMockups.findMany({
      where: (s, { eq }) => eq(s.videoId, newVideoId),
    });

    expect(copied.map((s) => s.line)).toEqual(["Active"]);
  });

  it("serializes concurrent clones from the same latest Course Version", async () => {
    const [course] = await testDb
      .insert(schema.courses)
      .values({ name: "Concurrent Course" })
      .returning();
    const [version] = await testDb
      .insert(schema.courseVersions)
      .values({ repoId: course!.id, name: "v1" })
      .returning();

    const clone = () =>
      run(
        Effect.gen(function* () {
          const versionOps = yield* VersionOperationsService;
          return yield* versionOps.copyVersionStructure({
            sourceVersionId: version!.id,
            repoId: course!.id,
            newVersionName: "v2",
          });
        })
      );
    const results = await Promise.allSettled([clone(), clone()]);

    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected")
    ).toHaveLength(1);
    expect(
      await testDb.query.courseVersions.findMany({
        where: (row, { eq }) => eq(row.repoId, course!.id),
      })
    ).toHaveLength(2);
  });
});

// The read that feeds Publish and Publish Readiness. It loads clips and
// chapters and nothing else per Video, which is the first of the two reasons
// a Clip Mockup can never reach a student (the second is that the shipped
// Video shape has no field for one — see course-json.test.ts). Adding a
// `clipMockups` sub-relation here would be the way to break that, so this
// test fails if anyone does.
describe("getVersionWithSections — the publish read", () => {
  it("does not load clip mockups", async () => {
    const [course] = await testDb
      .insert(schema.courses)
      .values({ name: "Test Course" })
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
        title: "01.01-welcome",
        authoringStatus: "done",
      })
      .returning();

    const [video] = await testDb
      .insert(schema.videos)
      .values({
        lessonId: lesson!.id,
        title: "video.mp4",
        originalFootagePath: "/footage/v1",
      })
      .returning();

    await testDb.insert(schema.clipMockups).values({
      videoId: video!.id,
      line: "And here is the bug.",
      imagePath: "frame-001.png",
      audioPath: "speech-001.wav",
      durationSeconds: 1.75,
      order: "a0",
    });

    const loaded = await run(
      Effect.gen(function* () {
        const versionOps = yield* VersionOperationsService;
        return yield* versionOps.getVersionWithSections(version!.id);
      })
    );

    const loadedVideo = loaded.sections[0]!.lessons[0]!.videos[0]!;
    expect(loadedVideo).not.toHaveProperty("clipMockups");
    expect(loadedVideo).not.toHaveProperty("beats");
  });
});
