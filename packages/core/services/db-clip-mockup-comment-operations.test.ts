import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Either, Layer } from "effect";
import { eq } from "drizzle-orm";
import { ClipMockupCommentOperationsService } from "./db-clip-mockup-comment-operations.server.js";
import { DrizzleService } from "./drizzle-service.server.js";
import * as schema from "../db/schema.js";
import type { CourseVersionCommitState } from "../db/schema.js";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "../test-utils/pglite.js";

let testDb: TestDb;
let testLayer: Layer.Layer<ClipMockupCommentOperationsService>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  testLayer = ClipMockupCommentOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as any))
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

/** A Video in a Course Version of the given state, with one of each parent. */
const makeAnimatic = (commitState: CourseVersionCommitState = "draft") =>
  Effect.promise(async () => {
    const [course] = await testDb
      .insert(schema.courses)
      .values({ name: "Course" })
      .returning();
    const [version] = await testDb
      .insert(schema.courseVersions)
      .values({ repoId: course!.id, name: "", commitState })
      .returning();
    const [section] = await testDb
      .insert(schema.sections)
      .values({ repoVersionId: version!.id, title: "intro", order: 1 })
      .returning();
    const [lesson] = await testDb
      .insert(schema.lessons)
      .values({ sectionId: section!.id, title: "Lesson", order: 1 })
      .returning();
    const [video] = await testDb
      .insert(schema.videos)
      .values({
        lessonId: lesson!.id,
        title: "video.mp4",
        originalFootagePath: "/footage/video",
      })
      .returning();
    const [chapter] = await testDb
      .insert(schema.clipMockupChapters)
      .values({ videoId: video!.id, name: "Setup", order: "a0" })
      .returning();
    const [clipMockup] = await testDb
      .insert(schema.clipMockups)
      .values({
        videoId: video!.id,
        line: "Here's the problem.",
        imagePath: "a.png",
        audioPath: "a.wav",
        durationSeconds: 1,
        order: "a1",
      })
      .returning();
    return { video: video!, chapter: chapter!, clipMockup: clipMockup! };
  });

describe("createClipMockupComment", () => {
  it.effect("pins a comment to a Clip Mockup, reading the Video off it", () =>
    Effect.gen(function* () {
      const { video, clipMockup } = yield* makeAnimatic();
      const ops = yield* ClipMockupCommentOperationsService;

      const created = yield* ops.createClipMockupComment(
        { type: "clip-mockup", id: clipMockup.id },
        "Say this slower."
      );

      expect(created).toMatchObject({
        videoId: video.id,
        clipMockupId: clipMockup.id,
        clipMockupChapterId: null,
        body: "Say this slower.",
      });
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("pins a comment to a Clip Mockup Chapter", () =>
    Effect.gen(function* () {
      const { video, chapter } = yield* makeAnimatic();
      const ops = yield* ClipMockupCommentOperationsService;

      const created = yield* ops.createClipMockupComment(
        { type: "clip-mockup-chapter", id: chapter.id },
        "Film this part last."
      );

      expect(created).toMatchObject({
        videoId: video.id,
        clipMockupId: null,
        clipMockupChapterId: chapter.id,
      });
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("refuses an archived parent as not found", () =>
    Effect.gen(function* () {
      const { clipMockup } = yield* makeAnimatic();
      yield* Effect.promise(() =>
        testDb
          .update(schema.clipMockups)
          .set({ archived: true })
          .where(eq(schema.clipMockups.id, clipMockup.id))
      );
      const ops = yield* ClipMockupCommentOperationsService;

      const result = yield* Effect.either(
        ops.createClipMockupComment(
          { type: "clip-mockup", id: clipMockup.id },
          "Too late."
        )
      );

      expect(Either.isLeft(result) && result.left._tag).toBe("NotFoundError");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("refuses a write on a published Version", () =>
    Effect.gen(function* () {
      const { clipMockup } = yield* makeAnimatic("published");
      const ops = yield* ClipMockupCommentOperationsService;

      const result = yield* Effect.either(
        ops.createClipMockupComment(
          { type: "clip-mockup", id: clipMockup.id },
          "Stranded."
        )
      );

      expect(Either.isLeft(result) && result.left._tag).toBe(
        "VersionNotDraftError"
      );
      const rows = yield* Effect.promise(() =>
        testDb.query.clipMockupComments.findMany()
      );
      expect(rows).toEqual([]);
    }).pipe(Effect.provide(testLayer))
  );
});

describe("the one-parent CHECK", () => {
  it.effect("rejects a row with both parents, or with neither", () =>
    Effect.gen(function* () {
      const { video, clipMockup, chapter } = yield* makeAnimatic();
      const insert = (values: {
        clipMockupId: string | null;
        clipMockupChapterId: string | null;
      }) =>
        Effect.tryPromise(() =>
          testDb
            .insert(schema.clipMockupComments)
            .values({ videoId: video.id, body: "x", ...values })
        ).pipe(Effect.either);

      const both = yield* insert({
        clipMockupId: clipMockup.id,
        clipMockupChapterId: chapter.id,
      });
      const neither = yield* insert({
        clipMockupId: null,
        clipMockupChapterId: null,
      });

      expect(Either.isLeft(both)).toBe(true);
      expect(Either.isLeft(neither)).toBe(true);
    })
  );
});

describe("listClipMockupCommentsByVideoId", () => {
  it.effect("lists oldest first and hides comments on archived parents", () =>
    Effect.gen(function* () {
      const { video, clipMockup, chapter } = yield* makeAnimatic();
      const ops = yield* ClipMockupCommentOperationsService;

      yield* ops.createClipMockupComment(
        { type: "clip-mockup", id: clipMockup.id },
        "first"
      );
      yield* ops.createClipMockupComment(
        { type: "clip-mockup-chapter", id: chapter.id },
        "second"
      );
      yield* ops.createClipMockupComment(
        { type: "clip-mockup", id: clipMockup.id },
        "third"
      );

      const all = yield* ops.listClipMockupCommentsByVideoId(video.id);
      expect(all.map((c) => c.body).sort()).toEqual([
        "first",
        "second",
        "third",
      ]);

      yield* Effect.promise(() =>
        testDb
          .update(schema.clipMockupChapters)
          .set({ archived: true })
          .where(eq(schema.clipMockupChapters.id, chapter.id))
      );

      const visible = yield* ops.listClipMockupCommentsByVideoId(video.id);
      expect(visible.map((c) => c.body).sort()).toEqual(["first", "third"]);
    }).pipe(Effect.provide(testLayer))
  );
});

describe("updateClipMockupComment and deleteClipMockupComment", () => {
  it.effect("replaces the body, then deletes the row for good", () =>
    Effect.gen(function* () {
      const { video, clipMockup } = yield* makeAnimatic();
      const ops = yield* ClipMockupCommentOperationsService;
      const created = yield* ops.createClipMockupComment(
        { type: "clip-mockup", id: clipMockup.id },
        "before"
      );

      const updated = yield* ops.updateClipMockupComment(created.id, {
        body: "after",
      });
      expect(updated.body).toBe("after");
      expect(updated.clipMockupId).toBe(clipMockup.id);

      yield* ops.deleteClipMockupComment(created.id);
      const rows = yield* Effect.promise(() =>
        testDb.query.clipMockupComments.findMany({
          where: eq(schema.clipMockupComments.videoId, video.id),
        })
      );
      expect(rows).toEqual([]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("refuses an update on a published Version", () =>
    Effect.gen(function* () {
      const { video, clipMockup } = yield* makeAnimatic("published");
      const [row] = yield* Effect.promise(() =>
        testDb
          .insert(schema.clipMockupComments)
          .values({ videoId: video.id, clipMockupId: clipMockup.id, body: "x" })
          .returning()
      );
      const ops = yield* ClipMockupCommentOperationsService;

      const update = yield* Effect.either(
        ops.updateClipMockupComment(row!.id, { body: "y" })
      );
      const del = yield* Effect.either(ops.deleteClipMockupComment(row!.id));

      expect(Either.isLeft(update) && update.left._tag).toBe(
        "VersionNotDraftError"
      );
      expect(Either.isLeft(del) && del.left._tag).toBe("VersionNotDraftError");
    }).pipe(Effect.provide(testLayer))
  );
});
