import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import { lessons, videos, clips, chapters, segments } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import {
  LESSON_ID,
  SECTION_ID,
  VIDEO_ID,
  seedGhostCourse,
  seedVideoWithClips,
  seedVideoWithSegments,
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

describe("agent-diff-executor ops", () => {
  describe("edit ops", () => {
    it("edits lesson title", async () => {
      await seedGhostCourse(testDb);
      const root = await buildVfsFromDb(testDb);
      const ctx = buildCtxFromDb(
        testDb,
        null,
        `/courses/test-course/sections/basics/lessons/intro/lesson.json`,
        root
      );
      await runExecutor(
        testDb,
        [
          {
            type: "edit",
            entityType: "lesson",
            target: "intro",
            id: LESSON_ID,
            field: "title",
            before: "Introduction",
            after: "New Title",
          },
        ],
        ctx
      );
      expect(
        (await testDb.query.lessons.findFirst({
          where: eq(lessons.id, LESSON_ID),
        }))!.title
      ).toBe("New Title");
    });

    it("edits section description", async () => {
      await seedGhostCourse(testDb);
      const root = await buildVfsFromDb(testDb);
      const ctx = buildCtxFromDb(
        testDb,
        null,
        `/courses/test-course/sections/basics/section.json`,
        root
      );
      await runExecutor(
        testDb,
        [
          {
            type: "edit",
            entityType: "section",
            target: "basics",
            id: SECTION_ID,
            field: "description",
            before: "",
            after: "New section desc",
          },
        ],
        ctx
      );
      expect(
        (await testDb.query.sections.findFirst({
          where: eq(segments.id, SECTION_ID),
        }))!.description
      ).toBe("New section desc");
    });

    it("edits clip text", async () => {
      await seedVideoWithClips(testDb);
      const root = await buildVfsFromDb(testDb);
      const ctx = buildCtxFromDb(
        testDb,
        null,
        `/courses/test-course/sections/basics/lessons/intro/videos/vid-01/timeline/clip-a.clip.json`,
        root
      );
      await runExecutor(
        testDb,
        [
          {
            type: "edit",
            entityType: "clip",
            target: "clip-a.clip.json",
            id: "clip-a",
            field: "text",
            before: "Hello",
            after: "Updated Hello",
          },
        ],
        ctx
      );
      expect(
        (await testDb.query.clips.findFirst({ where: eq(clips.id, "clip-a") }))!
          .text
      ).toBe("Updated Hello");
    });

    it("edits chapter name", async () => {
      await seedVideoWithClips(testDb);
      const root = await buildVfsFromDb(testDb);
      const ctx = buildCtxFromDb(
        testDb,
        null,
        `/courses/test-course/sections/basics/lessons/intro/videos/vid-01/timeline/chap-1.chapter.json`,
        root
      );
      await runExecutor(
        testDb,
        [
          {
            type: "edit",
            entityType: "chapter",
            target: "chap-1.chapter.json",
            id: "chap-1",
            field: "name",
            before: "Chapter One",
            after: "Renamed Chapter",
          },
        ],
        ctx
      );
      expect(
        (await testDb.query.chapters.findFirst({
          where: eq(chapters.id, "chap-1"),
        }))!.name
      ).toBe("Renamed Chapter");
    });

    it("edits segment title and kind", async () => {
      await seedVideoWithSegments(testDb);
      const root = await buildVfsFromDb(testDb);
      const ctx = buildCtxFromDb(
        testDb,
        null,
        `/courses/test-course/sections/basics/lessons/intro/videos/vid-01/segments/seg-1.json`,
        root
      );
      await runExecutor(
        testDb,
        [
          {
            type: "edit",
            entityType: "segment",
            target: "seg-1",
            id: "seg-1",
            field: "title",
            before: "Segment One",
            after: "Renamed Segment",
          },
          {
            type: "edit",
            entityType: "segment",
            target: "seg-1",
            id: "seg-1",
            field: "kind",
            before: "definition",
            after: "demo",
          },
        ],
        ctx
      );
      const seg = (await testDb.query.segments.findFirst({
        where: eq(segments.id, "seg-1"),
      }))!;
      expect(seg.title).toBe("Renamed Segment");
      expect(seg.kind).toBe("demo");
    });
  });

  describe("delete ops (soft-delete)", () => {
    it("soft-deletes a lesson without cascading to children", async () => {
      await seedGhostCourse(testDb);
      await testDb
        .insert(videos)
        .values({
          id: VIDEO_ID,
          lessonId: LESSON_ID,
          path: "vid-01",
          originalFootagePath: "/footage/01",
        });
      const root = await buildVfsFromDb(testDb);
      const ctx = buildCtxFromDb(
        testDb,
        null,
        `/courses/test-course/sections/basics/lessons/_members.json`,
        root
      );
      await runExecutor(
        testDb,
        [
          {
            type: "delete",
            entityType: "lesson",
            target: "intro",
            id: LESSON_ID,
          },
        ],
        ctx
      );

      expect(
        (await testDb.query.lessons.findFirst({
          where: eq(lessons.id, LESSON_ID),
        }))!.archived
      ).toBe(true);
      expect(
        (await testDb.query.videos.findFirst({
          where: eq(videos.id, VIDEO_ID),
        }))!.archived
      ).toBe(false);
    });

    it("soft-deletes a clip", async () => {
      await seedVideoWithClips(testDb);
      const root = await buildVfsFromDb(testDb);
      const ctx = buildCtxFromDb(
        testDb,
        null,
        `/courses/test-course/sections/basics/lessons/intro/videos/vid-01/timeline/_members.json`,
        root
      );
      await runExecutor(
        testDb,
        [
          {
            type: "delete",
            entityType: "clip",
            target: "clip-a.clip.json",
            id: "clip-a",
          },
        ],
        ctx
      );
      expect(
        (await testDb.query.clips.findFirst({ where: eq(clips.id, "clip-a") }))!
          .archived
      ).toBe(true);
    });

    it("soft-deletes a segment", async () => {
      await seedVideoWithSegments(testDb);
      const root = await buildVfsFromDb(testDb);
      const ctx = buildCtxFromDb(
        testDb,
        null,
        `/courses/test-course/sections/basics/lessons/intro/videos/vid-01/segments/_members.json`,
        root
      );
      await runExecutor(
        testDb,
        [
          {
            type: "delete",
            entityType: "segment",
            target: "seg-1",
            id: "seg-1",
          },
        ],
        ctx
      );
      expect(
        (await testDb.query.segments.findFirst({
          where: eq(segments.id, "seg-1"),
        }))!.archived
      ).toBe(true);
    });

    it("soft-deletes a video", async () => {
      await seedGhostCourse(testDb);
      await testDb
        .insert(videos)
        .values({
          id: VIDEO_ID,
          lessonId: LESSON_ID,
          path: "vid-01",
          originalFootagePath: "/footage/01",
        });
      const root = await buildVfsFromDb(testDb);
      const ctx = buildCtxFromDb(
        testDb,
        null,
        `/courses/test-course/sections/basics/lessons/intro/videos/_members.json`,
        root
      );
      await runExecutor(
        testDb,
        [
          {
            type: "delete",
            entityType: "video",
            target: "vid-01",
            id: VIDEO_ID,
          },
        ],
        ctx
      );
      expect(
        (await testDb.query.videos.findFirst({
          where: eq(videos.id, VIDEO_ID),
        }))!.archived
      ).toBe(true);
    });
  });

  describe("add ops", () => {
    it("creates a ghost lesson", async () => {
      await seedGhostCourse(testDb);
      const root = await buildVfsFromDb(testDb);
      const ctx = buildCtxFromDb(
        testDb,
        null,
        `/courses/test-course/sections/basics/lessons/_members.json`,
        root
      );
      await runExecutor(
        testDb,
        [
          {
            type: "add",
            sub: "create",
            entityType: "lesson",
            target: "new-lesson",
            detail: { values: { title: "New Lesson", slug: "new-lesson" } },
          },
        ],
        ctx
      );
      const all = await testDb.query.lessons.findMany({
        where: eq(lessons.sectionId, SECTION_ID),
      });
      expect(all).toHaveLength(2);
      const newLesson = all.find((l) => l.path === "new-lesson")!;
      expect(newLesson.title).toBe("New Lesson");
      expect(newLesson.fsStatus).toBe("ghost");
    });

    it("copies a clip with footage match", async () => {
      await seedVideoWithClips(testDb);
      const root = await buildVfsFromDb(testDb);
      const ctx = buildCtxFromDb(
        testDb,
        null,
        `/courses/test-course/sections/basics/lessons/intro/videos/vid-01/timeline/_members.json`,
        root
      );
      await runExecutor(
        testDb,
        [
          {
            type: "add",
            sub: "copy",
            entityType: "clip",
            target: "new-clip",
            detail: {
              footageMatch: {
                videoFilename: "02.mp4",
                sourceStartTime: 5,
                sourceEndTime: 15,
              },
              values: { label: "Copied clip text" },
            },
          },
        ],
        ctx
      );
      const all = await testDb.query.clips.findMany({
        where: eq(clips.videoId, VIDEO_ID),
      });
      expect(all).toHaveLength(3);
      const newClip = all.find((c) => c.videoFilename === "02.mp4")!;
      expect(newClip.sourceStartTime).toBe(5);
      expect(newClip.text).toBe("Copied clip text");
    });
  });

  describe("reorder ops", () => {
    it("reorders lessons with sequential integers", async () => {
      await seedGhostCourse(testDb);
      await testDb
        .insert(lessons)
        .values({
          id: "les-2",
          sectionId: SECTION_ID,
          path: "second",
          title: "Second Lesson",
          fsStatus: "ghost",
          order: 1,
        });
      const root = await buildVfsFromDb(testDb);
      const ctx = buildCtxFromDb(
        testDb,
        null,
        `/courses/test-course/sections/basics/lessons/_members.json`,
        root
      );
      await runExecutor(
        testDb,
        [
          {
            type: "reorder",
            entityType: "lesson",
            target: "_members.json",
            order: [
              { id: "les-2", label: "second", fromIndex: 1, toIndex: 0 },
              { id: LESSON_ID, label: "intro", fromIndex: 0, toIndex: 1 },
            ],
          },
        ],
        ctx
      );
      const reordered = await testDb.query.lessons.findMany({
        where: eq(lessons.sectionId, SECTION_ID),
        orderBy: asc(lessons.order),
      });
      expect(reordered[0]!.id).toBe("les-2");
      expect(reordered[1]!.id).toBe(LESSON_ID);
    });

    it("reorders segments with fractional keys", async () => {
      await seedVideoWithSegments(testDb);
      const root = await buildVfsFromDb(testDb);
      const ctx = buildCtxFromDb(
        testDb,
        null,
        `/courses/test-course/sections/basics/lessons/intro/videos/vid-01/segments/_members.json`,
        root
      );
      await runExecutor(
        testDb,
        [
          {
            type: "reorder",
            entityType: "segment",
            target: "_members.json",
            order: [
              { id: "seg-2", label: "Segment Two", fromIndex: 1, toIndex: 0 },
              { id: "seg-1", label: "Segment One", fromIndex: 0, toIndex: 1 },
            ],
          },
        ],
        ctx
      );
      const reordered = await testDb.query.segments.findMany({
        where: eq(segments.videoId, VIDEO_ID),
        orderBy: asc(segments.order),
      });
      expect(reordered[0]!.id).toBe("seg-2");
      expect(reordered[1]!.id).toBe("seg-1");
    });

    it("reorders timeline items (clips + chapters together)", async () => {
      await seedVideoWithClips(testDb);
      const root = await buildVfsFromDb(testDb);
      const ctx = buildCtxFromDb(
        testDb,
        null,
        `/courses/test-course/sections/basics/lessons/intro/videos/vid-01/timeline/_members.json`,
        root
      );
      await runExecutor(
        testDb,
        [
          {
            type: "reorder",
            entityType: "clip",
            target: "_members.json",
            order: [
              { id: "chap-1", label: "Chapter One", fromIndex: 1, toIndex: 0 },
              { id: "clip-b", label: "World", fromIndex: 2, toIndex: 1 },
              { id: "clip-a", label: "Hello", fromIndex: 0, toIndex: 2 },
            ],
          },
        ],
        ctx
      );
      const reorderedClips = await testDb.query.clips.findMany({
        where: eq(clips.videoId, VIDEO_ID),
        orderBy: asc(clips.order),
      });
      const reorderedChapters = await testDb.query.chapters.findMany({
        where: eq(chapters.videoId, VIDEO_ID),
        orderBy: asc(chapters.order),
      });
      expect(reorderedClips[0]!.id).toBe("clip-b");
      expect(reorderedClips[1]!.id).toBe("clip-a");
      expect(reorderedChapters[0]!.order < reorderedClips[0]!.order).toBe(true);
    });
  });
});
