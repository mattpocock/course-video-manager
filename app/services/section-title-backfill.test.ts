import { describe, it, expect } from "vitest";
import { afterEach, beforeAll, beforeEach } from "vitest";
import { assertNoBlankSectionTitles } from "@/services/section-title-backfill";
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

describe("assertNoBlankSectionTitles", () => {
  it("passes when all sections have titles", async () => {
    const { versionId } = await createCourseAndVersion(testDb);
    await createSection(testDb, versionId, "Intro", 1, { id: "s1" });

    await expect(
      assertNoBlankSectionTitles(testDb as any)
    ).resolves.toBeUndefined();
  });

  it("throws when a section has blank title", async () => {
    const { versionId } = await createCourseAndVersion(testDb);
    await createSection(testDb, versionId, "", 1, { id: "s1" });

    await expect(assertNoBlankSectionTitles(testDb as any)).rejects.toThrow(
      "Post-condition failed"
    );
  });

  it("passes with multiple sections all having titles", async () => {
    const { versionId } = await createCourseAndVersion(testDb);
    await createSection(testDb, versionId, "Intro", 1, { id: "s1" });
    await createSection(testDb, versionId, "Advanced", 2, { id: "s2" });

    await expect(
      assertNoBlankSectionTitles(testDb as any)
    ).resolves.toBeUndefined();
  });

  it("throws when any section has blank title among others", async () => {
    const { versionId } = await createCourseAndVersion(testDb);
    await createSection(testDb, versionId, "Intro", 1, { id: "s1" });
    await createSection(testDb, versionId, "", 2, { id: "s2" });

    await expect(assertNoBlankSectionTitles(testDb as any)).rejects.toThrow(
      "Post-condition failed"
    );
  });
});
