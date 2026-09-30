import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { VersionOperationsService } from "./db-version-operations.server.js";
import { DrizzleService, type Database } from "./drizzle-service.server.js";
import { copyVideoImpl } from "./db-video-operations.copy.server.js";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "../test-utils/pglite.js";
import * as schema from "../db/schema.js";

/**
 * A copy of a Video — a Version snapshot, or a duplicated Video — carries its
 * Clip Mockup Comments and RE-POINTS each one at the copy of its parent. A
 * comment left pointing at the source row would show on the old Version and
 * vanish from the Draft the author opens. The Course duplicate shares the
 * Version copy's shape and is covered by the schema-drift guard.
 */

let testDb: TestDb;
let testLayer: Layer.Layer<VersionOperationsService>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  testLayer = VersionOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as any))
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

async function createCommentedVideo() {
  const [course] = await testDb
    .insert(schema.courses)
    .values({ name: "Course" })
    .returning();
  const [version] = await testDb
    .insert(schema.courseVersions)
    .values({ repoId: course!.id, name: "v1" })
    .returning();
  const [section] = await testDb
    .insert(schema.sections)
    .values({ repoVersionId: version!.id, title: "01-intro", order: 1 })
    .returning();
  const [lesson] = await testDb
    .insert(schema.lessons)
    .values({ sectionId: section!.id, order: 1, title: "Lesson" })
    .returning();
  const [video] = await testDb
    .insert(schema.videos)
    .values({
      lessonId: lesson!.id,
      title: "video.mp4",
      originalFootagePath: "/footage/video.mp4",
    })
    .returning();
  const [chapter] = await testDb
    .insert(schema.clipMockupChapters)
    .values({ videoId: video!.id, name: "Setup", order: "a0" })
    .returning();
  const [kept, cut] = await testDb
    .insert(schema.clipMockups)
    .values(
      ["Kept", "Cut"].map((line, i) => ({
        videoId: video!.id,
        line,
        imagePath: `${line}.png`,
        audioPath: `${line}.wav`,
        durationSeconds: 1,
        order: `a${i + 1}`,
        archived: line === "Cut",
      }))
    )
    .returning();
  await testDb.insert(schema.clipMockupComments).values([
    { videoId: video!.id, clipMockupId: kept!.id, body: "on kept" },
    { videoId: video!.id, clipMockupChapterId: chapter!.id, body: "on setup" },
    { videoId: video!.id, clipMockupId: cut!.id, body: "on cut" },
  ]);
  return { course: course!, version: version!, video: video! };
}

/** Each comment on a Video, named by the parent it now points at. */
async function commentsByParent(videoId: string) {
  const comments = await testDb.query.clipMockupComments.findMany({
    where: (c, { eq }) => eq(c.videoId, videoId),
    with: { clipMockup: true, clipMockupChapter: true },
  });
  return comments
    .map((c) => {
      const parent = c.clipMockup ?? c.clipMockupChapter;
      if (parent?.videoId !== videoId) return `${c.body} -> WRONG VIDEO`;
      return c.clipMockup
        ? `${c.body} -> mockup:${c.clipMockup.line}`
        : `${c.body} -> chapter:${c.clipMockupChapter!.name}`;
    })
    .sort();
}

describe("Clip Mockup Comments in a copy", () => {
  it("a Version snapshot re-points them at the copied parents", async () => {
    const { course, version, video } = await createCommentedVideo();

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const versionOps = yield* VersionOperationsService;
        return yield* versionOps.copyVersionStructure({
          sourceVersionId: version.id,
          repoId: course.id,
          newVersionName: "v2",
        });
      }).pipe(Effect.provide(testLayer))
    );
    const newVideoId = result.videoIdMappings.find(
      (m) => m.sourceVideoId === video.id
    )!.newVideoId;

    expect(await commentsByParent(newVideoId)).toEqual([
      "on kept -> mockup:Kept",
      "on setup -> chapter:Setup",
    ]);
    // The source keeps its own three, untouched.
    expect(await commentsByParent(video.id)).toHaveLength(3);
  });

  it("a duplicated Video re-points them at the copied parents", async () => {
    const { video } = await createCommentedVideo();

    const newVideoId = await Effect.runPromise(
      copyVideoImpl(testDb as unknown as Database, {
        sourceVideoId: video.id,
        newTitle: "copy",
        copyClips: false,
        copyBeats: false,
        copyScript: false,
        renameOld: false,
      })
    );

    expect(await commentsByParent(newVideoId)).toEqual([
      "on kept -> mockup:Kept",
      "on setup -> chapter:Setup",
    ]);
  });
});
