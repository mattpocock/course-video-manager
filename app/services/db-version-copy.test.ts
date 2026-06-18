import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import * as schema from "@/db/schema";
import { setupEffectTest } from "@/test-utils/setup-effect-test";

const ctx = setupEffectTest(VersionOperationsService.Default);

describe("copyVersionStructure", () => {
  it("preserves lesson icon (type) when copying a version", async () => {
    const [course] = await ctx.db
      .insert(schema.courses)
      .values({ name: "Test Course", filePath: "/tmp/test" })
      .returning();

    const [version] = await ctx.db
      .insert(schema.courseVersions)
      .values({ repoId: course!.id, name: "v1" })
      .returning();

    const [section] = await ctx.db
      .insert(schema.sections)
      .values({ repoVersionId: version!.id, path: "01-intro", order: 1 })
      .returning();

    await ctx.db.insert(schema.lessons).values({
      sectionId: section!.id,
      path: "01-intro/01-lesson",
      order: 1,
      icon: "code",
      fsStatus: "real",
      title: "Test Lesson",
      authoringStatus: "done",
    });

    const result = await ctx.run(
      Effect.gen(function* () {
        const versionOps = yield* VersionOperationsService;
        return yield* versionOps.copyVersionStructure({
          sourceVersionId: version!.id,
          repoId: course!.id,
          newVersionName: "v2",
        });
      })
    );

    const newSections = await ctx.db.query.sections.findMany({
      where: (s, { eq }) => eq(s.repoVersionId, result.version.id),
      with: { lessons: true },
    });

    expect(newSections).toHaveLength(1);
    expect(newSections[0]!.lessons).toHaveLength(1);
    expect(newSections[0]!.lessons[0]!.icon).toBe("code");
  });

  it("preserves section description when copying a version", async () => {
    const [course] = await ctx.db
      .insert(schema.courses)
      .values({ name: "Test Course 2", filePath: "/tmp/test2" })
      .returning();

    const [version] = await ctx.db
      .insert(schema.courseVersions)
      .values({ repoId: course!.id, name: "v1" })
      .returning();

    await ctx.db.insert(schema.sections).values({
      repoVersionId: version!.id,
      path: "01-intro",
      order: 1,
      description: "This is a section description",
    });

    const result = await ctx.run(
      Effect.gen(function* () {
        const versionOps = yield* VersionOperationsService;
        return yield* versionOps.copyVersionStructure({
          sourceVersionId: version!.id,
          repoId: course!.id,
          newVersionName: "v2",
        });
      })
    );

    const newSections = await ctx.db.query.sections.findMany({
      where: (s, { eq }) => eq(s.repoVersionId, result.version.id),
    });

    expect(newSections).toHaveLength(1);
    expect(newSections[0]!.description).toBe("This is a section description");
  });

  it("skips archived sections when copying a version", async () => {
    const [course] = await ctx.db
      .insert(schema.courses)
      .values({ name: "Archive Copy Test", filePath: "/tmp/archive-copy" })
      .returning();

    const [version] = await ctx.db
      .insert(schema.courseVersions)
      .values({ repoId: course!.id, name: "v1" })
      .returning();

    // One active section, one archived
    await ctx.db.insert(schema.sections).values([
      { repoVersionId: version!.id, path: "01-active", order: 1 },
      {
        repoVersionId: version!.id,
        path: "02-archived",
        order: 2,
        archivedAt: new Date(),
      },
    ]);

    const result = await ctx.run(
      Effect.gen(function* () {
        const versionOps = yield* VersionOperationsService;
        return yield* versionOps.copyVersionStructure({
          sourceVersionId: version!.id,
          repoId: course!.id,
          newVersionName: "v2",
        });
      })
    );

    const newSections = await ctx.db.query.sections.findMany({
      where: (s, { eq }) => eq(s.repoVersionId, result.version.id),
    });

    expect(newSections).toHaveLength(1);
    expect(newSections[0]!.path).toBe("01-active");
  });

  it("skips archived lessons when copying a version", async () => {
    const [course] = await ctx.db
      .insert(schema.courses)
      .values({
        name: "Archived Lesson Copy Test",
        filePath: "/tmp/archived-lesson-copy",
      })
      .returning();

    const [version] = await ctx.db
      .insert(schema.courseVersions)
      .values({ repoId: course!.id, name: "v1" })
      .returning();

    const [section] = await ctx.db
      .insert(schema.sections)
      .values({ repoVersionId: version!.id, path: "01-intro", order: 1 })
      .returning();

    await ctx.db.insert(schema.lessons).values([
      {
        sectionId: section!.id,
        path: "01.01-active",
        order: 1,
        fsStatus: "real",
        title: "Active Lesson",
        authoringStatus: "done",
      },
      {
        sectionId: section!.id,
        path: "01.02-archived",
        order: 2,
        fsStatus: "real",
        title: "Archived Lesson",
        authoringStatus: "done",
        archived: true,
      },
    ]);

    const result = await ctx.run(
      Effect.gen(function* () {
        const versionOps = yield* VersionOperationsService;
        return yield* versionOps.copyVersionStructure({
          sourceVersionId: version!.id,
          repoId: course!.id,
          newVersionName: "v2",
        });
      })
    );

    const newSections = await ctx.db.query.sections.findMany({
      where: (s, { eq }) => eq(s.repoVersionId, result.version.id),
      with: { lessons: true },
    });

    expect(newSections).toHaveLength(1);
    expect(newSections[0]!.lessons).toHaveLength(1);
    expect(newSections[0]!.lessons[0]!.title).toBe("Active Lesson");
  });

  it("preserves lesson authoringStatus when copying a version", async () => {
    const [course] = await ctx.db
      .insert(schema.courses)
      .values({ name: "AuthoringStatus Copy", filePath: "/tmp/authoring" })
      .returning();

    const [version] = await ctx.db
      .insert(schema.courseVersions)
      .values({ repoId: course!.id, name: "v1" })
      .returning();

    const [section] = await ctx.db
      .insert(schema.sections)
      .values({ repoVersionId: version!.id, path: "01-intro", order: 1 })
      .returning();

    await ctx.db.insert(schema.lessons).values([
      {
        sectionId: section!.id,
        path: "01-lesson",
        order: 1,
        fsStatus: "real",
        title: "Todo Lesson",
        authoringStatus: "todo",
      },
      {
        sectionId: section!.id,
        path: "02-lesson",
        order: 2,
        fsStatus: "real",
        title: "Done Lesson",
        authoringStatus: "done",
      },
      {
        sectionId: section!.id,
        path: "ghost-lesson",
        order: 3,
        fsStatus: "ghost",
        title: "Ghost Lesson",
      },
    ]);

    const result = await ctx.run(
      Effect.gen(function* () {
        const versionOps = yield* VersionOperationsService;
        return yield* versionOps.copyVersionStructure({
          sourceVersionId: version!.id,
          repoId: course!.id,
          newVersionName: "v2",
        });
      })
    );

    const newSections = await ctx.db.query.sections.findMany({
      where: (s, { eq }) => eq(s.repoVersionId, result.version.id),
      with: { lessons: { orderBy: (l, { asc }) => asc(l.order) } },
    });

    expect(newSections[0]!.lessons).toHaveLength(3);
    expect(newSections[0]!.lessons[0]!.authoringStatus).toBe("todo");
    expect(newSections[0]!.lessons[1]!.authoringStatus).toBe("done");
    expect(newSections[0]!.lessons[2]!.authoringStatus).toBeNull();
  });

  it("rejects a real lesson with null authoringStatus (constraint)", async () => {
    const [course] = await ctx.db
      .insert(schema.courses)
      .values({ name: "Constraint Test", filePath: "/tmp/constraint" })
      .returning();

    const [version] = await ctx.db
      .insert(schema.courseVersions)
      .values({ repoId: course!.id, name: "v1" })
      .returning();

    const [section] = await ctx.db
      .insert(schema.sections)
      .values({ repoVersionId: version!.id, path: "01-intro", order: 1 })
      .returning();

    await expect(
      ctx.db.insert(schema.lessons).values({
        sectionId: section!.id,
        path: "01-lesson",
        order: 1,
        fsStatus: "real",
        title: "Real without status",
      })
    ).rejects.toThrow();
  });

  it("rejects a ghost lesson with non-null authoringStatus (constraint)", async () => {
    const [course] = await ctx.db
      .insert(schema.courses)
      .values({ name: "Constraint Test 2", filePath: "/tmp/constraint2" })
      .returning();

    const [version] = await ctx.db
      .insert(schema.courseVersions)
      .values({ repoId: course!.id, name: "v1" })
      .returning();

    const [section] = await ctx.db
      .insert(schema.sections)
      .values({ repoVersionId: version!.id, path: "01-intro", order: 1 })
      .returning();

    await expect(
      ctx.db.insert(schema.lessons).values({
        sectionId: section!.id,
        path: "ghost-lesson",
        order: 1,
        fsStatus: "ghost",
        title: "Ghost with status",
        authoringStatus: "todo",
      })
    ).rejects.toThrow();
  });

  it("preserves lesson fsStatus (ghost/real) when copying a version", async () => {
    const [course] = await ctx.db
      .insert(schema.courses)
      .values({ name: "Test Course 3", filePath: "/tmp/test3" })
      .returning();

    const [version] = await ctx.db
      .insert(schema.courseVersions)
      .values({ repoId: course!.id, name: "v1" })
      .returning();

    const [section] = await ctx.db
      .insert(schema.sections)
      .values({ repoVersionId: version!.id, path: "01-intro", order: 1 })
      .returning();

    await ctx.db.insert(schema.lessons).values([
      {
        sectionId: section!.id,
        path: "01-intro/01-lesson",
        order: 1,
        fsStatus: "real",
        title: "Real Lesson",
        authoringStatus: "done",
      },
      {
        sectionId: section!.id,
        path: "01-intro/02-ghost",
        order: 2,
        fsStatus: "ghost",
        title: "Ghost Lesson",
      },
    ]);

    const result = await ctx.run(
      Effect.gen(function* () {
        const versionOps = yield* VersionOperationsService;
        return yield* versionOps.copyVersionStructure({
          sourceVersionId: version!.id,
          repoId: course!.id,
          newVersionName: "v2",
        });
      })
    );

    const newSections = await ctx.db.query.sections.findMany({
      where: (s, { eq }) => eq(s.repoVersionId, result.version.id),
      with: { lessons: { orderBy: (l, { asc }) => asc(l.order) } },
    });

    expect(newSections[0]!.lessons[0]!.fsStatus).toBe("real");
    expect(newSections[0]!.lessons[1]!.fsStatus).toBe("ghost");
  });

  it("copies a video's segments, preserving kind/title/order", async () => {
    const [course] = await ctx.db
      .insert(schema.courses)
      .values({ name: "Test Course", filePath: "/tmp/test" })
      .returning();

    const [version] = await ctx.db
      .insert(schema.courseVersions)
      .values({ repoId: course!.id, name: "v1" })
      .returning();

    const [section] = await ctx.db
      .insert(schema.sections)
      .values({ repoVersionId: version!.id, path: "01-intro", order: 1 })
      .returning();

    const [lesson] = await ctx.db
      .insert(schema.lessons)
      .values({
        sectionId: section!.id,
        path: "01-intro/01-lesson",
        order: 1,
        fsStatus: "real",
        title: "Lesson",
        authoringStatus: "done",
      })
      .returning();

    const [video] = await ctx.db
      .insert(schema.videos)
      .values({
        lessonId: lesson!.id,
        path: "01-intro/01-lesson/video.mp4",
        originalFootagePath: "/footage/v1",
      })
      .returning();

    await ctx.db.insert(schema.segments).values([
      {
        videoId: video!.id,
        kind: "definition",
        title: "Closures",
        order: "a0",
      },
      {
        videoId: video!.id,
        kind: "quest",
        title: "Build a cache",
        order: "a1",
      },
    ]);

    const result = await ctx.run(
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

    const copied = await ctx.db.query.segments.findMany({
      where: (s, { eq }) => eq(s.videoId, newVideoId),
      orderBy: (s, { asc }) => asc(s.order),
    });

    expect(copied.map((s) => ({ kind: s.kind, title: s.title }))).toEqual([
      { kind: "definition", title: "Closures" },
      { kind: "quest", title: "Build a cache" },
    ]);
  });
});
