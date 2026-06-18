import { describe, it, expect } from "vitest";
import { afterEach, beforeAll, beforeEach } from "vitest";
import {
  courses,
  courseVersions,
  sections,
  lessons,
  videos,
} from "@/db/schema";
import {
  backfillSectionPaths,
  backfillLessonPaths,
  backfillVideoPaths,
} from "@/services/path-uniqueness-backfill";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import {
  dropUniqueIndexes,
  recreateUniqueIndexes,
  createCourseAndVersion,
  createSection,
  createLesson,
  createVideo,
} from "@/services/path-uniqueness-test-helpers";

let testDb: TestDb;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
});

beforeEach(async () => {
  await truncateAllTables(testDb);
  await dropUniqueIndexes(testDb);
});

afterEach(async () => {
  await recreateUniqueIndexes(testDb);
});

describe("backfillSectionPaths", () => {
  it("renames colliding section paths within the same version", async () => {
    const { versionId } = await createCourseAndVersion(testDb);
    const t1 = new Date("2024-01-01");
    const t2 = new Date("2024-01-02");

    await createSection(testDb, versionId, "intro", 1, {
      id: "s1",
      createdAt: t1,
    });
    await createSection(testDb, versionId, "intro", 2, {
      id: "s2",
      createdAt: t2,
    });

    await backfillSectionPaths(testDb as any);

    const all = await testDb.select().from(sections);
    const byId = Object.fromEntries(all.map((s) => [s.id, s]));
    expect(byId["s1"]!.path).toBe("intro");
    expect(byId["s2"]!.path).toBe("intro-2");
  });

  it("uses order as primary tiebreaker", async () => {
    const { versionId } = await createCourseAndVersion(testDb);
    const sameTime = new Date("2024-01-01");

    await createSection(testDb, versionId, "basics", 5, {
      id: "s-high-order",
      createdAt: sameTime,
    });
    await createSection(testDb, versionId, "basics", 1, {
      id: "s-low-order",
      createdAt: sameTime,
    });

    await backfillSectionPaths(testDb as any);

    const all = await testDb.select().from(sections);
    const byId = Object.fromEntries(all.map((s) => [s.id, s]));
    expect(byId["s-low-order"]!.path).toBe("basics");
    expect(byId["s-high-order"]!.path).toBe("basics-2");
  });

  it("skips archived sections (does not rename them)", async () => {
    const { versionId } = await createCourseAndVersion(testDb);
    await createSection(testDb, versionId, "intro", 1, { id: "active" });
    await createSection(testDb, versionId, "intro", 2, {
      id: "archived",
      archivedAt: new Date(),
    });

    await backfillSectionPaths(testDb as any);

    const all = await testDb.select().from(sections);
    const byId = Object.fromEntries(all.map((s) => [s.id, s]));
    expect(byId["active"]!.path).toBe("intro");
    expect(byId["archived"]!.path).toBe("intro");
  });

  it("handles triple collision with -2 and -3 suffixes", async () => {
    const { versionId } = await createCourseAndVersion(testDb);

    await createSection(testDb, versionId, "foo", 1, {
      id: "a",
      createdAt: new Date("2024-01-01"),
    });
    await createSection(testDb, versionId, "foo", 2, {
      id: "b",
      createdAt: new Date("2024-01-02"),
    });
    await createSection(testDb, versionId, "foo", 3, {
      id: "c",
      createdAt: new Date("2024-01-03"),
    });

    await backfillSectionPaths(testDb as any);

    const all = await testDb.select().from(sections);
    const byId = Object.fromEntries(all.map((s) => [s.id, s]));
    expect(byId["a"]!.path).toBe("foo");
    expect(byId["b"]!.path).toBe("foo-2");
    expect(byId["c"]!.path).toBe("foo-3");
  });

  it("scopes collisions to repoVersionId", async () => {
    const { versionId: v1 } = await createCourseAndVersion(testDb);
    const [course2] = await testDb
      .insert(courses)
      .values({ name: "Other", slug: "other", filePath: "/other" })
      .returning();
    const [v2] = await testDb
      .insert(courseVersions)
      .values({ repoId: course2!.id, name: "" })
      .returning();

    await createSection(testDb, v1, "intro", 1, { id: "s1" });
    await createSection(testDb, v2!.id, "intro", 1, { id: "s2" });

    await backfillSectionPaths(testDb as any);

    const all = await testDb.select().from(sections);
    const byId = Object.fromEntries(all.map((s) => [s.id, s]));
    expect(byId["s1"]!.path).toBe("intro");
    expect(byId["s2"]!.path).toBe("intro");
  });
});

describe("backfillLessonPaths", () => {
  it("renames colliding lesson paths within the same section", async () => {
    const { versionId } = await createCourseAndVersion(testDb);
    const section = await createSection(testDb, versionId, "intro", 1);

    await createLesson(testDb, section.id, "my-lesson", 1, {
      id: "l1",
      createdAt: new Date("2024-01-01"),
    });
    await createLesson(testDb, section.id, "my-lesson", 2, {
      id: "l2",
      createdAt: new Date("2024-01-02"),
    });

    await backfillLessonPaths(testDb as any);

    const all = await testDb.select().from(lessons);
    const byId = Object.fromEntries(all.map((l) => [l.id, l]));
    expect(byId["l1"]!.path).toBe("my-lesson");
    expect(byId["l2"]!.path).toBe("my-lesson-2");
  });

  it("uses order → createdAt → id as tiebreak", async () => {
    const { versionId } = await createCourseAndVersion(testDb);
    const section = await createSection(testDb, versionId, "intro", 1);
    const sameTime = new Date("2024-01-01");

    await createLesson(testDb, section.id, "lesson", 5, {
      id: "zzz",
      createdAt: sameTime,
    });
    await createLesson(testDb, section.id, "lesson", 5, {
      id: "aaa",
      createdAt: sameTime,
    });

    await backfillLessonPaths(testDb as any);

    const all = await testDb.select().from(lessons);
    const byId = Object.fromEntries(all.map((l) => [l.id, l]));
    expect(byId["aaa"]!.path).toBe("lesson");
    expect(byId["zzz"]!.path).toBe("lesson-2");
  });

  it("skips archived lessons", async () => {
    const { versionId } = await createCourseAndVersion(testDb);
    const section = await createSection(testDb, versionId, "intro", 1);

    await createLesson(testDb, section.id, "lesson", 1, { id: "active" });
    await createLesson(testDb, section.id, "lesson", 2, {
      id: "archived-l",
      archived: true,
    });

    await backfillLessonPaths(testDb as any);

    const all = await testDb.select().from(lessons);
    const byId = Object.fromEntries(all.map((l) => [l.id, l]));
    expect(byId["active"]!.path).toBe("lesson");
    expect(byId["archived-l"]!.path).toBe("lesson");
  });
});

describe("backfillVideoPaths", () => {
  it("renames colliding video paths within the same lesson", async () => {
    const { versionId } = await createCourseAndVersion(testDb);
    const section = await createSection(testDb, versionId, "intro", 1);
    const lesson = await createLesson(testDb, section.id, "lesson", 1);

    await createVideo(testDb, lesson.id, "video.mp4", {
      id: "v1",
      createdAt: new Date("2024-01-01"),
    });
    await createVideo(testDb, lesson.id, "video.mp4", {
      id: "v2",
      createdAt: new Date("2024-01-02"),
    });

    await backfillVideoPaths(testDb as any);

    const all = await testDb.select().from(videos);
    const byId = Object.fromEntries(all.map((v) => [v.id, v]));
    expect(byId["v1"]!.path).toBe("video.mp4");
    expect(byId["v2"]!.path).toBe("video-2.mp4");
  });

  it("inserts suffix before file extension", async () => {
    const { versionId } = await createCourseAndVersion(testDb);
    const section = await createSection(testDb, versionId, "intro", 1);
    const lesson = await createLesson(testDb, section.id, "lesson", 1);

    await createVideo(testDb, lesson.id, "recording.mov", {
      id: "v1",
      createdAt: new Date("2024-01-01"),
    });
    await createVideo(testDb, lesson.id, "recording.mov", {
      id: "v2",
      createdAt: new Date("2024-01-02"),
    });
    await createVideo(testDb, lesson.id, "recording.mov", {
      id: "v3",
      createdAt: new Date("2024-01-03"),
    });

    await backfillVideoPaths(testDb as any);

    const all = await testDb.select().from(videos);
    const byId = Object.fromEntries(all.map((v) => [v.id, v]));
    expect(byId["v1"]!.path).toBe("recording.mov");
    expect(byId["v2"]!.path).toBe("recording-2.mov");
    expect(byId["v3"]!.path).toBe("recording-3.mov");
  });

  it("handles paths without extension", async () => {
    const { versionId } = await createCourseAndVersion(testDb);
    const section = await createSection(testDb, versionId, "intro", 1);
    const lesson = await createLesson(testDb, section.id, "lesson", 1);

    await createVideo(testDb, lesson.id, "video", {
      id: "v1",
      createdAt: new Date("2024-01-01"),
    });
    await createVideo(testDb, lesson.id, "video", {
      id: "v2",
      createdAt: new Date("2024-01-02"),
    });

    await backfillVideoPaths(testDb as any);

    const all = await testDb.select().from(videos);
    const byId = Object.fromEntries(all.map((v) => [v.id, v]));
    expect(byId["v1"]!.path).toBe("video");
    expect(byId["v2"]!.path).toBe("video-2");
  });

  it("uses createdAt → id as tiebreak (videos have no order)", async () => {
    const { versionId } = await createCourseAndVersion(testDb);
    const section = await createSection(testDb, versionId, "intro", 1);
    const lesson = await createLesson(testDb, section.id, "lesson", 1);
    const sameTime = new Date("2024-01-01");

    await createVideo(testDb, lesson.id, "vid.mp4", {
      id: "zzz",
      createdAt: sameTime,
    });
    await createVideo(testDb, lesson.id, "vid.mp4", {
      id: "aaa",
      createdAt: sameTime,
    });

    await backfillVideoPaths(testDb as any);

    const all = await testDb.select().from(videos);
    const byId = Object.fromEntries(all.map((v) => [v.id, v]));
    expect(byId["aaa"]!.path).toBe("vid.mp4");
    expect(byId["zzz"]!.path).toBe("vid-2.mp4");
  });

  it("skips archived videos", async () => {
    const { versionId } = await createCourseAndVersion(testDb);
    const section = await createSection(testDb, versionId, "intro", 1);
    const lesson = await createLesson(testDb, section.id, "lesson", 1);

    await createVideo(testDb, lesson.id, "vid.mp4", { id: "active" });
    await createVideo(testDb, lesson.id, "vid.mp4", {
      id: "archived-v",
      archived: true,
    });

    await backfillVideoPaths(testDb as any);

    const all = await testDb.select().from(videos);
    const byId = Object.fromEntries(all.map((v) => [v.id, v]));
    expect(byId["active"]!.path).toBe("vid.mp4");
    expect(byId["archived-v"]!.path).toBe("vid.mp4");
  });
});
