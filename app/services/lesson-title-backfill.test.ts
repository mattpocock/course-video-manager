import { describe, it, expect } from "vitest";
import { afterEach, beforeAll, beforeEach } from "vitest";
import { assertNoBlankLessonTitles } from "@/services/lesson-title-backfill";
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

describe("assertNoBlankLessonTitles", () => {
  it("passes when all titles populated", async () => {
    const { versionId } = await createCourseAndVersion(testDb);
    const section = await createSection(testDb, versionId, "intro", 1, {
      id: "s1",
    });
    await createLesson(testDb, section.id, "hello", 1, {
      id: "l1",
      title: "Hello",
    });

    await expect(
      assertNoBlankLessonTitles(testDb as any)
    ).resolves.toBeUndefined();
  });
});
