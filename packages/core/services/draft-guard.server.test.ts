import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect } from "effect";
import { eq } from "drizzle-orm";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "../test-utils/pglite.js";
import * as schema from "../db/schema.js";
import type { CourseVersionCommitState } from "../db/schema.js";
import {
  requireDraftVersion,
  requireDraftVersionForSection,
  requireDraftVersionForSections,
  requireDraftVersionForLesson,
  requireDraftVersionForLessons,
  requireDraftVersionForVideo,
  requireDraftVersionForClip,
  requireDraftVersionForClips,
  requireDraftVersionForChapter,
  requireDraftVersionForChapters,
  requireDraftVersionForClipWebLink,
} from "./draft-guard.server.js";

let testDb: TestDb;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

const getHasChanges = (versionId: string) =>
  Effect.promise(async () => {
    const [row] = await testDb
      .select({ hasChanges: schema.courseVersions.hasChanges })
      .from(schema.courseVersions)
      .where(eq(schema.courseVersions.id, versionId));
    return row!.hasChanges;
  });

const makeCourse = () =>
  Effect.promise(async () => {
    const [course] = await testDb
      .insert(schema.courses)
      .values({ name: "Test Course" })
      .returning();
    return course!;
  });

const makeVersion = (
  repoId: string,
  commitState: CourseVersionCommitState = "draft"
) =>
  Effect.promise(async () => {
    const [version] = await testDb
      .insert(schema.courseVersions)
      .values({ repoId, name: "", commitState })
      .returning();
    return version!;
  });

const makeSection = (repoVersionId: string, order = 1) =>
  Effect.promise(async () => {
    const [section] = await testDb
      .insert(schema.sections)
      .values({ repoVersionId, title: "intro", order })
      .returning();
    return section!;
  });

const makeLesson = (sectionId: string, order = 1) =>
  Effect.promise(async () => {
    const [lesson] = await testDb
      .insert(schema.lessons)
      .values({ sectionId, order })
      .returning();
    return lesson!;
  });

const makeVideo = (lessonId: string | null) =>
  Effect.promise(async () => {
    const [video] = await testDb
      .insert(schema.videos)
      .values({
        lessonId,
        title: "video",
        originalFootagePath: "footage.mp4",
      })
      .returning();
    return video!;
  });

const makeClip = (videoId: string, order = "1") =>
  Effect.promise(async () => {
    const [clip] = await testDb
      .insert(schema.clips)
      .values({
        videoId,
        videoFilename: "clip.mp4",
        sourceStartTime: 0,
        sourceEndTime: 1,
        order,
        text: "",
      })
      .returning();
    return clip!;
  });

const makeChapter = (videoId: string, order = "1") =>
  Effect.promise(async () => {
    const [chapter] = await testDb
      .insert(schema.chapters)
      .values({ videoId, name: "chapter", order })
      .returning();
    return chapter!;
  });

const makeClipWebLink = (clipId: string) =>
  Effect.promise(async () => {
    const [link] = await testDb
      .insert(schema.clipWebLinks)
      .values({ clipId, url: "https://example.com" })
      .returning();
    return link!;
  });

/** A course + Draft Version fixture, ready for a guard to be pointed at. */
const draftFixture = () =>
  Effect.gen(function* () {
    const course = yield* makeCourse();
    const version = yield* makeVersion(course.id, "draft");
    return { course, version };
  });

describe("requireDraftVersion", () => {
  it.effect("marks a Draft Version as having changes", () =>
    Effect.gen(function* () {
      const { version } = yield* draftFixture();

      yield* requireDraftVersion(testDb as any, version.id);

      expect(yield* getHasChanges(version.id)).toBe(true);
    })
  );

  it.effect("is idempotent once already marked", () =>
    Effect.gen(function* () {
      const { version } = yield* draftFixture();

      yield* requireDraftVersion(testDb as any, version.id);
      yield* requireDraftVersion(testDb as any, version.id);

      expect(yield* getHasChanges(version.id)).toBe(true);
    })
  );

  it.effect("rejects a Pending Version and leaves it unmarked", () =>
    Effect.gen(function* () {
      const course = yield* makeCourse();
      const version = yield* makeVersion(course.id, "pending");

      const result = yield* requireDraftVersion(testDb as any, version.id).pipe(
        Effect.either
      );

      expect(result._tag).toBe("Left");
      expect(yield* getHasChanges(version.id)).toBe(false);
    })
  );

  it.effect("rejects a Published Version and leaves it unmarked", () =>
    Effect.gen(function* () {
      const course = yield* makeCourse();
      const version = yield* makeVersion(course.id, "published");

      const result = yield* requireDraftVersion(testDb as any, version.id).pipe(
        Effect.either
      );

      expect(result._tag).toBe("Left");
      expect(yield* getHasChanges(version.id)).toBe(false);
    })
  );

  it.effect(
    "passes through silently for a version id that does not exist",
    () =>
      Effect.gen(function* () {
        const result = yield* requireDraftVersion(
          testDb as any,
          "missing-version"
        ).pipe(Effect.either);

        expect(result._tag).toBe("Right");
      })
  );
});

describe("requireDraftVersionForSection(s)", () => {
  it.effect("marks the section's owning Draft Version", () =>
    Effect.gen(function* () {
      const { version } = yield* draftFixture();
      const section = yield* makeSection(version.id);

      yield* requireDraftVersionForSection(testDb as any, section.id);

      expect(yield* getHasChanges(version.id)).toBe(true);
    })
  );

  it.effect("passes through for a section id that does not exist", () =>
    Effect.gen(function* () {
      const result = yield* requireDraftVersionForSection(
        testDb as any,
        "missing-section"
      ).pipe(Effect.either);

      expect(result._tag).toBe("Right");
    })
  );

  it.effect("marks every distinct owning version in a batch", () =>
    Effect.gen(function* () {
      const courseA = yield* makeCourse();
      const versionA = yield* makeVersion(courseA.id, "draft");
      const sectionA = yield* makeSection(versionA.id);

      const courseB = yield* makeCourse();
      const versionB = yield* makeVersion(courseB.id, "draft");
      const sectionB = yield* makeSection(versionB.id);

      yield* requireDraftVersionForSections(testDb as any, [
        sectionA.id,
        sectionB.id,
      ]);

      expect(yield* getHasChanges(versionA.id)).toBe(true);
      expect(yield* getHasChanges(versionB.id)).toBe(true);
    })
  );

  it.effect("no-ops for an empty batch", () =>
    Effect.gen(function* () {
      const result = yield* requireDraftVersionForSections(
        testDb as any,
        []
      ).pipe(Effect.either);

      expect(result._tag).toBe("Right");
    })
  );
});

describe("requireDraftVersionForLesson(s)", () => {
  it.effect("marks the lesson's owning Draft Version", () =>
    Effect.gen(function* () {
      const { version } = yield* draftFixture();
      const section = yield* makeSection(version.id);
      const lesson = yield* makeLesson(section.id);

      yield* requireDraftVersionForLesson(testDb as any, lesson.id);

      expect(yield* getHasChanges(version.id)).toBe(true);
    })
  );

  it.effect("passes through for a lesson id that does not exist", () =>
    Effect.gen(function* () {
      const result = yield* requireDraftVersionForLesson(
        testDb as any,
        "missing-lesson"
      ).pipe(Effect.either);

      expect(result._tag).toBe("Right");
    })
  );

  it.effect(
    "rejects when one lesson in a batch belongs to a non-draft version",
    () =>
      Effect.gen(function* () {
        const { version: draftVersion } = yield* draftFixture();
        const draftSection = yield* makeSection(draftVersion.id);
        const draftLesson = yield* makeLesson(draftSection.id);

        const course = yield* makeCourse();
        const publishedVersion = yield* makeVersion(course.id, "published");
        const publishedSection = yield* makeSection(publishedVersion.id);
        const publishedLesson = yield* makeLesson(publishedSection.id);

        const result = yield* requireDraftVersionForLessons(testDb as any, [
          draftLesson.id,
          publishedLesson.id,
        ]).pipe(Effect.either);

        expect(result._tag).toBe("Left");
      })
  );
});

describe("requireDraftVersionForVideo", () => {
  it.effect("marks the video's owning Draft Version (via its lesson)", () =>
    Effect.gen(function* () {
      const { version } = yield* draftFixture();
      const section = yield* makeSection(version.id);
      const lesson = yield* makeLesson(section.id);
      const video = yield* makeVideo(lesson.id);

      yield* requireDraftVersionForVideo(testDb as any, video.id);

      expect(yield* getHasChanges(version.id)).toBe(true);
    })
  );

  it.effect("passes through for a standalone video (no lesson)", () =>
    Effect.gen(function* () {
      const video = yield* makeVideo(null);

      const result = yield* requireDraftVersionForVideo(
        testDb as any,
        video.id
      ).pipe(Effect.either);

      expect(result._tag).toBe("Right");
    })
  );
});

describe("requireDraftVersionForClip(s)", () => {
  it.effect("marks the clip's owning Draft Version (via its video)", () =>
    Effect.gen(function* () {
      const { version } = yield* draftFixture();
      const section = yield* makeSection(version.id);
      const lesson = yield* makeLesson(section.id);
      const video = yield* makeVideo(lesson.id);
      const clip = yield* makeClip(video.id);

      yield* requireDraftVersionForClip(testDb as any, clip.id);

      expect(yield* getHasChanges(version.id)).toBe(true);
    })
  );

  it.effect("marks every distinct owning version for a batch of clips", () =>
    Effect.gen(function* () {
      const courseA = yield* makeCourse();
      const versionA = yield* makeVersion(courseA.id, "draft");
      const sectionA = yield* makeSection(versionA.id);
      const lessonA = yield* makeLesson(sectionA.id);
      const videoA = yield* makeVideo(lessonA.id);
      const clipA = yield* makeClip(videoA.id);

      const courseB = yield* makeCourse();
      const versionB = yield* makeVersion(courseB.id, "draft");
      const sectionB = yield* makeSection(versionB.id);
      const lessonB = yield* makeLesson(sectionB.id);
      const videoB = yield* makeVideo(lessonB.id);
      const clipB = yield* makeClip(videoB.id);

      yield* requireDraftVersionForClips(testDb as any, [clipA.id, clipB.id]);

      expect(yield* getHasChanges(versionA.id)).toBe(true);
      expect(yield* getHasChanges(versionB.id)).toBe(true);
    })
  );
});

describe("requireDraftVersionForChapter(s)", () => {
  it.effect("marks the chapter's owning Draft Version (via its video)", () =>
    Effect.gen(function* () {
      const { version } = yield* draftFixture();
      const section = yield* makeSection(version.id);
      const lesson = yield* makeLesson(section.id);
      const video = yield* makeVideo(lesson.id);
      const chapter = yield* makeChapter(video.id);

      yield* requireDraftVersionForChapter(testDb as any, chapter.id);

      expect(yield* getHasChanges(version.id)).toBe(true);
    })
  );

  it.effect("marks every distinct owning version for a batch of chapters", () =>
    Effect.gen(function* () {
      const courseA = yield* makeCourse();
      const versionA = yield* makeVersion(courseA.id, "draft");
      const sectionA = yield* makeSection(versionA.id);
      const lessonA = yield* makeLesson(sectionA.id);
      const videoA = yield* makeVideo(lessonA.id);
      const chapterA = yield* makeChapter(videoA.id);

      const courseB = yield* makeCourse();
      const versionB = yield* makeVersion(courseB.id, "draft");
      const sectionB = yield* makeSection(versionB.id);
      const lessonB = yield* makeLesson(sectionB.id);
      const videoB = yield* makeVideo(lessonB.id);
      const chapterB = yield* makeChapter(videoB.id);

      yield* requireDraftVersionForChapters(testDb as any, [
        chapterA.id,
        chapterB.id,
      ]);

      expect(yield* getHasChanges(versionA.id)).toBe(true);
      expect(yield* getHasChanges(versionB.id)).toBe(true);
    })
  );
});

describe("requireDraftVersionForClipWebLink", () => {
  it.effect(
    "marks the link's owning Draft Version (via its clip and video)",
    () =>
      Effect.gen(function* () {
        const { version } = yield* draftFixture();
        const section = yield* makeSection(version.id);
        const lesson = yield* makeLesson(section.id);
        const video = yield* makeVideo(lesson.id);
        const clip = yield* makeClip(video.id);
        const link = yield* makeClipWebLink(clip.id);

        yield* requireDraftVersionForClipWebLink(testDb as any, link.id);

        expect(yield* getHasChanges(version.id)).toBe(true);
      })
  );

  it.effect("passes through for a link id that does not exist", () =>
    Effect.gen(function* () {
      const result = yield* requireDraftVersionForClipWebLink(
        testDb as any,
        "missing-link"
      ).pipe(Effect.either);

      expect(result._tag).toBe("Right");
    })
  );
});

describe("transactional atomicity of the flip", () => {
  it("rolls back an already-flipped version when a later guard in the same transaction rejects", async () => {
    const course = await testDb
      .insert(schema.courses)
      .values({ name: "Test Course" })
      .returning()
      .then((r) => r[0]!);

    const draftVersion = await testDb
      .insert(schema.courseVersions)
      .values({ repoId: course.id, name: "", commitState: "draft" })
      .returning()
      .then((r) => r[0]!);
    const draftSection = await testDb
      .insert(schema.sections)
      .values({ repoVersionId: draftVersion.id, title: "intro", order: 1 })
      .returning()
      .then((r) => r[0]!);
    const draftLesson = await testDb
      .insert(schema.lessons)
      .values({ sectionId: draftSection.id, order: 1 })
      .returning()
      .then((r) => r[0]!);

    const publishedVersion = await testDb
      .insert(schema.courseVersions)
      .values({ repoId: course.id, name: "v1", commitState: "published" })
      .returning()
      .then((r) => r[0]!);
    const publishedSection = await testDb
      .insert(schema.sections)
      .values({
        repoVersionId: publishedVersion.id,
        title: "intro",
        order: 1,
      })
      .returning()
      .then((r) => r[0]!);
    const publishedLesson = await testDb
      .insert(schema.lessons)
      .values({ sectionId: publishedSection.id, order: 1 })
      .returning()
      .then((r) => r[0]!);

    // Composed explicitly as two sequential SINGULAR guard calls, draft
    // first, rather than one requireDraftVersionForLessons([draftLesson,
    // publishedLesson]) batch call: the batch resolves its distinct owning
    // versions via `db.query.lessons.findMany` with no ORDER BY, so which
    // lesson it visits first is unspecified. Sequencing it explicitly here
    // still exercises the exact code both share (lockAndAssertDraft) while
    // guaranteeing the draft's flip actually lands before the rejection —
    // otherwise this test could pass vacuously (nothing ever flipped, so
    // "unflipped after rollback" proves nothing) depending on row order.
    await expect(
      testDb.transaction(async (tx) =>
        Effect.runPromise(
          Effect.gen(function* () {
            yield* requireDraftVersionForLesson(tx as any, draftLesson.id);
            yield* requireDraftVersionForLesson(tx as any, publishedLesson.id);
          })
        )
      )
    ).rejects.toBeTruthy();

    const [row] = await testDb
      .select({ hasChanges: schema.courseVersions.hasChanges })
      .from(schema.courseVersions)
      .where(eq(schema.courseVersions.id, draftVersion.id));
    expect(row!.hasChanges).toBe(false);
  });
});
