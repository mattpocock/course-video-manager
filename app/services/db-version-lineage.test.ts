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

describe("lineageId copy-forward", () => {
  it("copies section lineageId forward unchanged on version clone", async () => {
    const [course] = await testDb
      .insert(schema.courses)
      .values({ name: "Test", filePath: "/tmp/test" })
      .returning();

    const [version] = await testDb
      .insert(schema.courseVersions)
      .values({ repoId: course!.id, name: "v1" })
      .returning();

    const [section] = await testDb
      .insert(schema.sections)
      .values({ repoVersionId: version!.id, path: "01-intro", order: 1 })
      .returning();

    const result = await run(
      Effect.gen(function* () {
        const ops = yield* VersionOperationsService;
        return yield* ops.copyVersionStructure({
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
    expect(newSections[0]!.lineageId).toBe(section!.lineageId);
    expect(newSections[0]!.id).not.toBe(section!.id);
  });

  it("copies lesson lineageId forward unchanged on version clone", async () => {
    const [course] = await testDb
      .insert(schema.courses)
      .values({ name: "Test", filePath: "/tmp/test" })
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
        path: "01-lesson",
        order: 1,
        fsStatus: "real",
        title: "Lesson",
        authoringStatus: "done",
      })
      .returning();

    const result = await run(
      Effect.gen(function* () {
        const ops = yield* VersionOperationsService;
        return yield* ops.copyVersionStructure({
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

    expect(newSections[0]!.lessons[0]!.lineageId).toBe(lesson!.lineageId);
    expect(newSections[0]!.lessons[0]!.id).not.toBe(lesson!.id);
  });

  it("copies video lineageId forward unchanged on version clone", async () => {
    const [course] = await testDb
      .insert(schema.courses)
      .values({ name: "Test", filePath: "/tmp/test" })
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
        path: "01-lesson",
        order: 1,
        fsStatus: "real",
        title: "Lesson",
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

    const result = await run(
      Effect.gen(function* () {
        const ops = yield* VersionOperationsService;
        return yield* ops.copyVersionStructure({
          sourceVersionId: version!.id,
          repoId: course!.id,
          newVersionName: "v2",
        });
      })
    );

    const newVideoId = result.videoIdMappings.find(
      (m) => m.sourceVideoId === video!.id
    )!.newVideoId;

    const newVideo = await testDb.query.videos.findFirst({
      where: (v, { eq }) => eq(v.id, newVideoId),
    });

    expect(newVideo!.lineageId).toBe(video!.lineageId);
    expect(newVideo!.id).not.toBe(video!.id);
  });

  it("assigns fresh lineageId to genuinely new rows", async () => {
    const [course] = await testDb
      .insert(schema.courses)
      .values({ name: "Test", filePath: "/tmp/test" })
      .returning();

    const [version] = await testDb
      .insert(schema.courseVersions)
      .values({ repoId: course!.id, name: "v1" })
      .returning();

    const [s1] = await testDb
      .insert(schema.sections)
      .values({ repoVersionId: version!.id, path: "01-intro", order: 1 })
      .returning();

    const [s2] = await testDb
      .insert(schema.sections)
      .values({ repoVersionId: version!.id, path: "02-advanced", order: 2 })
      .returning();

    expect(s1!.lineageId).toBeTruthy();
    expect(s2!.lineageId).toBeTruthy();
    expect(s1!.lineageId).not.toBe(s2!.lineageId);
  });

  it("preserves lineageId across two successive clones", async () => {
    const [course] = await testDb
      .insert(schema.courses)
      .values({ name: "Test", filePath: "/tmp/test" })
      .returning();

    const [v1] = await testDb
      .insert(schema.courseVersions)
      .values({ repoId: course!.id, name: "v1" })
      .returning();

    const [section] = await testDb
      .insert(schema.sections)
      .values({ repoVersionId: v1!.id, path: "01-intro", order: 1 })
      .returning();

    const originalLineageId = section!.lineageId;

    // Clone v1 → v2
    const r1 = await run(
      Effect.gen(function* () {
        const ops = yield* VersionOperationsService;
        return yield* ops.copyVersionStructure({
          sourceVersionId: v1!.id,
          repoId: course!.id,
          newVersionName: "v2",
        });
      })
    );

    // Clone v2 → v3
    const r2 = await run(
      Effect.gen(function* () {
        const ops = yield* VersionOperationsService;
        return yield* ops.copyVersionStructure({
          sourceVersionId: r1.version.id,
          repoId: course!.id,
          newVersionName: "v3",
        });
      })
    );

    const v3Sections = await testDb.query.sections.findMany({
      where: (s, { eq }) => eq(s.repoVersionId, r2.version.id),
    });

    expect(v3Sections[0]!.lineageId).toBe(originalLineageId);
  });
});
