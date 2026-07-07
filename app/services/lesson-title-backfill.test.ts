import { describe, it, expect } from "vitest";
import { afterEach, beforeAll, beforeEach } from "vitest";
import { lessons } from "@/db/schema";
import {
  backfillRealLessonTitles,
  assertNoBlankLessonTitles,
} from "@/services/lesson-title-backfill";
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
import { eq } from "drizzle-orm";

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

describe("backfillRealLessonTitles", () => {
  it("sets a real lesson title from its de-numbered path slug", async () => {
    const { versionId } = await createCourseAndVersion(testDb);
    const section = await createSection(testDb, versionId, "01-intro", 1, {
      id: "s1",
    });
    await createLesson(testDb, section.id, "01.03-getting-started", 3, {
      id: "l1",
      fsStatus: "real",
    });

    await backfillRealLessonTitles(testDb as any);

    const [lesson] = await testDb
      .select()
      .from(lessons)
      .where(eq(lessons.id, "l1"));
    expect(lesson!.title).toBe("Getting Started");
  });

  it("does not overwrite an existing real lesson title", async () => {
    const { versionId } = await createCourseAndVersion(testDb);
    const section = await createSection(testDb, versionId, "01-intro", 1, {
      id: "s1",
    });
    await createLesson(testDb, section.id, "01.01-hello", 1, {
      id: "l1",
      fsStatus: "real",
      title: "Custom Title",
    });

    await backfillRealLessonTitles(testDb as any);

    const [lesson] = await testDb
      .select()
      .from(lessons)
      .where(eq(lessons.id, "l1"));
    expect(lesson!.title).toBe("Custom Title");
  });

  it("leaves ghost lessons untouched", async () => {
    const { versionId } = await createCourseAndVersion(testDb);
    const section = await createSection(testDb, versionId, "01-intro", 1, {
      id: "s1",
    });
    await createLesson(testDb, section.id, "planned-lesson", 1, {
      id: "l1",
      fsStatus: "ghost",
      title: "Planned Lesson",
    });

    await backfillRealLessonTitles(testDb as any);

    const [lesson] = await testDb
      .select()
      .from(lessons)
      .where(eq(lessons.id, "l1"));
    expect(lesson!.title).toBe("Planned Lesson");
  });

  it("assertNoBlankLessonTitles passes after backfill", async () => {
    const { versionId } = await createCourseAndVersion(testDb);
    const section = await createSection(testDb, versionId, "01-intro", 1, {
      id: "s1",
    });
    await createLesson(testDb, section.id, "01.01-hello", 1, {
      id: "l1",
      fsStatus: "real",
    });

    await backfillRealLessonTitles(testDb as any);
    await expect(
      assertNoBlankLessonTitles(testDb as any)
    ).resolves.toBeUndefined();
  });
});
