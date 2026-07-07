import { describe, it, expect } from "vitest";
import { afterEach, beforeAll, beforeEach } from "vitest";
import { sections } from "@/db/schema";
import {
  backfillGhostSectionTitles,
  backfillRealSectionTitles,
  assertNoBlankSectionTitles,
} from "@/services/section-title-backfill";
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
} from "@/services/path-uniqueness-test-helpers";
import { courses, courseVersions } from "@/db/schema";

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

describe("backfillGhostSectionTitles", () => {
  it("sets ghost section title to path verbatim", async () => {
    const { versionId } = await createCourseAndVersion(testDb);
    await createSection(testDb, versionId, "My Future Section", 1, {
      id: "ghost-s",
    });

    await backfillGhostSectionTitles(testDb as any);

    const all = await testDb.select().from(sections);
    expect(all[0]!.title).toBe("My Future Section");
  });

  it("does not overwrite real section titles", async () => {
    const { versionId } = await createCourseAndVersion(testDb);
    const section = await createSection(testDb, versionId, "01-intro", 1, {
      id: "real-s",
    });
    await createLesson(testDb, section.id, "01.01-hello", 1, {
      fsStatus: "real",
    });

    await backfillGhostSectionTitles(testDb as any);

    const all = await testDb.select().from(sections);
    expect(all[0]!.title).toBe("");
  });

  it("handles ghost sections with only ghost lessons", async () => {
    const { versionId } = await createCourseAndVersion(testDb);
    const section = await createSection(testDb, versionId, "Planned Work", 1, {
      id: "ghost-with-lessons",
    });
    await createLesson(testDb, section.id, "ghost-lesson", 1, {
      fsStatus: "ghost",
    });

    await backfillGhostSectionTitles(testDb as any);

    const all = await testDb.select().from(sections);
    expect(all[0]!.title).toBe("Planned Work");
  });
});

describe("backfillRealSectionTitles", () => {
  it("sets real section title from titleFromSlug of de-numbered path", async () => {
    const { versionId } = await createCourseAndVersion(testDb);
    const section = await createSection(
      testDb,
      versionId,
      "01-before-we-start",
      1,
      {
        id: "real-s",
      }
    );
    await createLesson(testDb, section.id, "01.01-hello", 1, {
      fsStatus: "real",
    });

    await backfillRealSectionTitles(testDb as any);

    const all = await testDb.select().from(sections);
    expect(all[0]!.title).toBe("Before We Start");
  });

  it("does not overwrite ghost section titles", async () => {
    const { versionId } = await createCourseAndVersion(testDb);
    await createSection(testDb, versionId, "My Ghost", 1, {
      id: "ghost-s",
    });

    await backfillRealSectionTitles(testDb as any);

    const all = await testDb.select().from(sections);
    expect(all[0]!.title).toBe("");
  });

  it("strips double-digit numbered prefix", async () => {
    const { versionId } = await createCourseAndVersion(testDb);
    const section = await createSection(
      testDb,
      versionId,
      "12-advanced-topic",
      1,
      {
        id: "real-s",
      }
    );
    await createLesson(testDb, section.id, "12.01-deep", 1, {
      fsStatus: "real",
    });

    await backfillRealSectionTitles(testDb as any);

    const all = await testDb.select().from(sections);
    expect(all[0]!.title).toBe("Advanced Topic");
  });

  it("backfills frozen-version sections too", async () => {
    const { versionId: v1 } = await createCourseAndVersion(testDb);
    const s1 = await createSection(testDb, v1, "01-intro", 1, { id: "s-v1" });
    await createLesson(testDb, s1.id, "01.01-hello", 1, {
      fsStatus: "real",
    });

    const [course2] = await testDb
      .insert(courses)
      .values({ name: "Other", slug: "other", filePath: "/other" })
      .returning();
    const [v2] = await testDb
      .insert(courseVersions)
      .values({ repoId: course2!.id, name: "frozen" })
      .returning();
    const s2 = await createSection(testDb, v2!.id, "01-basics", 1, {
      id: "s-v2",
    });
    await createLesson(testDb, s2.id, "01.01-first", 1, {
      fsStatus: "real",
    });

    await backfillRealSectionTitles(testDb as any);

    const all = await testDb.select().from(sections);
    const byId = Object.fromEntries(all.map((s) => [s.id, s]));
    expect(byId["s-v1"]!.title).toBe("Intro");
    expect(byId["s-v2"]!.title).toBe("Basics");
  });
});

describe("assertNoBlankSectionTitles", () => {
  it("passes when all sections have titles", async () => {
    const { versionId } = await createCourseAndVersion(testDb);
    await createSection(testDb, versionId, "01-intro", 1, {
      id: "s1",
      title: "Intro",
    });

    await expect(
      assertNoBlankSectionTitles(testDb as any)
    ).resolves.toBeUndefined();
  });

  it("throws when a real section has blank title", async () => {
    const { versionId } = await createCourseAndVersion(testDb);
    const section = await createSection(testDb, versionId, "01-intro", 1, {
      id: "s1",
    });
    await createLesson(testDb, section.id, "01.01-hello", 1, {
      fsStatus: "real",
    });

    await expect(assertNoBlankSectionTitles(testDb as any)).rejects.toThrow(
      "Post-condition failed"
    );
  });

  it("throws when a ghost section has blank title but non-empty path", async () => {
    const { versionId } = await createCourseAndVersion(testDb);
    await createSection(testDb, versionId, "Some Path", 1, {
      id: "ghost-s",
    });

    await expect(assertNoBlankSectionTitles(testDb as any)).rejects.toThrow(
      "Post-condition failed"
    );
  });

  it("does not throw for ghost section with empty path and blank title", async () => {
    const { versionId } = await createCourseAndVersion(testDb);
    await createSection(testDb, versionId, "", 1, {
      id: "ghost-empty",
    });

    await expect(
      assertNoBlankSectionTitles(testDb as any)
    ).resolves.toBeUndefined();
  });

  it("passes after full backfill", async () => {
    const { versionId } = await createCourseAndVersion(testDb);
    const realSection = await createSection(testDb, versionId, "01-intro", 1, {
      id: "real-s",
    });
    await createLesson(testDb, realSection.id, "01.01-hello", 1, {
      fsStatus: "real",
    });
    await createSection(testDb, versionId, "My Ghost", 2, {
      id: "ghost-s",
    });

    await backfillGhostSectionTitles(testDb as any);
    await backfillRealSectionTitles(testDb as any);

    await expect(
      assertNoBlankSectionTitles(testDb as any)
    ).resolves.toBeUndefined();
  });
});
