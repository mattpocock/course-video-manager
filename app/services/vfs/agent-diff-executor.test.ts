import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect } from "effect";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import { computeContentHash } from "./derive-diff-types";
import type {
  ExecutorContext,
  ExecutorResult,
  ExecutorRejection,
} from "./agent-diff-executor";
import { lessons } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  LESSON_ID,
  SECTION_ID,
  seedGhostCourse,
  seedRealCourse,
  buildVfsFromDb,
  buildCtxFromDb,
  runExecutor,
} from "./agent-diff-executor-test-helpers";

let testDb: TestDb;
beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
});
beforeEach(async () => {
  await truncateAllTables(testDb);
});

describe("agent-diff-executor", () => {
  describe("atomicity", () => {
    it("multi-op pure-DB write commits all-or-nothing", async () => {
      await seedGhostCourse(testDb);
      const root = await buildVfsFromDb(testDb);
      const ctx = buildCtxFromDb(
        testDb,
        null,
        `/courses/test-course/sections/basics/lessons/_members.json`,
        root
      );

      const result = await runExecutor(
        testDb,
        [
          {
            type: "edit",
            entityType: "lesson",
            target: "intro",
            id: LESSON_ID,
            field: "title",
            before: "Introduction",
            after: "Updated Title",
          },
          {
            type: "edit",
            entityType: "lesson",
            target: "intro",
            id: LESSON_ID,
            field: "description",
            before: "",
            after: "New description",
          },
        ],
        ctx
      );

      expect(result.applied).toBe(true);
      const lesson = await testDb.query.lessons.findFirst({
        where: eq(lessons.id, LESSON_ID),
      });
      expect(lesson!.title).toBe("Updated Title");
      expect(lesson!.description).toBe("New description");
    });

    it("sequential edits within the transaction apply in order", async () => {
      await seedGhostCourse(testDb);
      const root = await buildVfsFromDb(testDb);
      const ctx = buildCtxFromDb(
        testDb,
        null,
        `/courses/test-course/sections/basics/lessons/intro/lesson.json`,
        root
      );

      const result = await runExecutor(
        testDb,
        [
          {
            type: "edit",
            entityType: "lesson",
            target: "intro",
            id: LESSON_ID,
            field: "title",
            before: "Introduction",
            after: "Intermediate",
          },
          {
            type: "edit",
            entityType: "lesson",
            target: "intro",
            id: LESSON_ID,
            field: "title",
            before: "Intermediate",
            after: "Final Title",
          },
        ],
        ctx
      );

      expect(result.applied).toBe(true);
      const lesson = await testDb.query.lessons.findFirst({
        where: eq(lessons.id, LESSON_ID),
      });
      expect(lesson!.title).toBe("Final Title");
    });
  });

  describe("FS-limit rejection", () => {
    it("rejects when more than one FS-touching op is present", async () => {
      await seedRealCourse(testDb);
      await testDb
        .insert(lessons)
        .values({
          id: "les-2",
          sectionId: SECTION_ID,
          path: "second",
          title: "Second Lesson",
          fsStatus: "real",
          order: 1,
          authoringStatus: "ready",
        });
      const root = await buildVfsFromDb(testDb);
      const ctx = buildCtxFromDb(
        testDb,
        "/repo/test-course",
        `/courses/test-course/sections/basics/lessons/_members.json`,
        root
      );

      const result = await runExecutor(
        testDb,
        [
          {
            type: "edit",
            entityType: "lesson",
            target: "intro",
            id: LESSON_ID,
            field: "fsStatus",
            before: "ghost",
            after: "real",
          },
          {
            type: "edit",
            entityType: "lesson",
            target: "second",
            id: "les-2",
            field: "slug",
            before: "second",
            after: "renamed",
          },
        ],
        ctx
      );

      expect(result.applied).toBe(false);
      expect((result as ExecutorRejection).rejection.kind).toBe("fs-limit");
    });

    it("allows a single FS-touching op alongside pure-DB ops", async () => {
      await seedRealCourse(testDb);
      const root = await buildVfsFromDb(testDb);
      const ctx = buildCtxFromDb(
        testDb,
        "/repo/test-course",
        `/courses/test-course/sections/basics/lessons/_members.json`,
        root
      );
      const ctxWithFs: ExecutorContext = {
        ...ctx,
        applyFsOp: () => Effect.succeed(["old-path -> new-path"]),
      };

      const result = await runExecutor(
        testDb,
        [
          {
            type: "edit",
            entityType: "lesson",
            target: "intro",
            id: LESSON_ID,
            field: "title",
            before: "Introduction",
            after: "Updated",
          },
          {
            type: "edit",
            entityType: "lesson",
            target: "intro",
            id: LESSON_ID,
            field: "fsStatus",
            before: "ghost",
            after: "real",
          },
        ],
        ctxWithFs
      );

      expect(result.applied).toBe(true);
      expect((result as ExecutorResult).renames).toEqual([
        "old-path -> new-path",
      ]);
    });
  });

  describe("ghost-course materialize guard", () => {
    it("rejects materialize under ghost course", async () => {
      await seedGhostCourse(testDb);
      const root = await buildVfsFromDb(testDb);
      const ctx = buildCtxFromDb(
        testDb,
        null,
        `/courses/test-course/sections/basics/lessons/_members.json`,
        root
      );

      const result = await runExecutor(
        testDb,
        [
          {
            type: "edit",
            entityType: "lesson",
            target: "intro",
            id: LESSON_ID,
            field: "fsStatus",
            before: "ghost",
            after: "real",
          },
        ],
        ctx
      );

      expect(result.applied).toBe(false);
      expect((result as ExecutorRejection).rejection.kind).toBe("ghost-course");
    });
  });

  describe("result shape", () => {
    it("returns re-projected content + hash", async () => {
      await seedGhostCourse(testDb);
      const root = await buildVfsFromDb(testDb);
      const ctx = buildCtxFromDb(
        testDb,
        null,
        `/courses/test-course/sections/basics/lessons/intro/lesson.json`,
        root
      );

      const result = await runExecutor(
        testDb,
        [
          {
            type: "edit",
            entityType: "lesson",
            target: "intro",
            id: LESSON_ID,
            field: "title",
            before: "Introduction",
            after: "Freshly Updated",
          },
        ],
        ctx
      );

      expect(result.applied).toBe(true);
      const r = result as ExecutorResult;
      expect(r.content).toContain("Freshly Updated");
      expect(r.hash).toBe(computeContentHash(r.content));
      expect(r.renames).toEqual([]);
    });
  });

  describe("unarchive ops", () => {
    it("unarchives a lesson into a target section", async () => {
      await seedGhostCourse(testDb);
      await testDb
        .insert(lessons)
        .values({
          id: "les-archived",
          sectionId: SECTION_ID,
          path: "old-lesson",
          title: "Archived Lesson",
          fsStatus: "ghost",
          order: 99,
          archived: true,
        });
      const root = await buildVfsFromDb(testDb);
      const ctx = buildCtxFromDb(
        testDb,
        null,
        `/courses/test-course/sections/basics/lessons/_members.json`,
        root
      );

      const result = await runExecutor(
        testDb,
        [
          {
            type: "add",
            sub: "unarchive",
            entityType: "lesson",
            target: "old-lesson",
            id: "les-archived",
            detail: { sourceParent: "basics" },
          },
        ],
        ctx
      );

      expect(result.applied).toBe(true);
      const lesson = await testDb.query.lessons.findFirst({
        where: eq(lessons.id, "les-archived"),
      });
      expect(lesson!.archived).toBe(false);
      expect(lesson!.sectionId).toBe(SECTION_ID);
    });
  });
});
