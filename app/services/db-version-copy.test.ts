import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import * as schema from "@/db/schema";

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
        title: "Ghost Lesson",
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
});
