import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { VersionOperationsService } from "./db-version-operations.server.js";
import { DrizzleService } from "./drizzle-service.server.js";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "../test-utils/pglite.js";
import * as schema from "../db/schema.js";
import { sortByOrder } from "../lib/sort-by-order.js";

/**
 * What a Course Version snapshot does to a Video's Animatic — its Clip Mockups
 * AND its Clip Mockup Chapters, which share one order space.
 *
 * Its own file rather than a case in `db-version-copy.test.ts`: that one is at
 * the repo's file-token cap.
 *
 * The assertion is a MERGED order comparison, not a per-table count. Only a
 * merged list catches the two halves arriving separated — every divider piled
 * at one end — instead of interleaved as the author left them.
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

const run = <A, E>(eff: Effect.Effect<A, E, VersionOperationsService>) =>
  Effect.runPromise(eff.pipe(Effect.provide(testLayer)));

/** The Video's Animatic as one named list, both tables merged by `order`. */
async function animaticLabels(videoId: string) {
  const mockups = await testDb.query.clipMockups.findMany({
    where: (m, { and, eq }) =>
      and(eq(m.videoId, videoId), eq(m.archived, false)),
  });
  const chapters = await testDb.query.clipMockupChapters.findMany({
    where: (c, { and, eq }) =>
      and(eq(c.videoId, videoId), eq(c.archived, false)),
  });

  return sortByOrder([
    ...mockups.map((m) => ({ order: m.order, label: `mockup:${m.line}` })),
    ...chapters.map((c) => ({ order: c.order, label: `chapter:${c.name}` })),
  ]).map((item) => item.label);
}

/** One Course → Version → Section → Lesson → Video, with an interleaved plan. */
async function createCourseWithInterleavedAnimatic() {
  const [course] = await testDb
    .insert(schema.courses)
    .values({ name: "Original Course" })
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
    .values({ sectionId: section!.id, order: 1, title: "First Lesson" })
    .returning();

  const [video] = await testDb
    .insert(schema.videos)
    .values({
      lessonId: lesson!.id,
      title: "video-01.mp4",
      originalFootagePath: "/footage/raw-01.mp4",
    })
    .returning();

  await testDb.insert(schema.clipMockups).values(
    ["One", "Two", "Three"].map((line, i) => ({
      videoId: video!.id,
      line,
      imagePath: `${line}.png`,
      audioPath: `${line}.wav`,
      durationSeconds: 1,
      order: `a${i + 1}`,
    }))
  );

  await testDb.insert(schema.clipMockupChapters).values([
    { videoId: video!.id, name: "Setup", order: "a0" },
    { videoId: video!.id, name: "The bug", order: "a1V" },
    { videoId: video!.id, name: "The fix", order: "a3V" },
    { videoId: video!.id, name: "Cut", order: "a4", archived: true },
  ]);

  return { course: course!, version: version!, video: video! };
}

describe("copyVersionStructure — clip mockup chapters", () => {
  it("carries the chapters, interleaved exactly as the source has them", async () => {
    const { course, version, video } =
      await createCourseWithInterleavedAnimatic();

    const result = await run(
      Effect.gen(function* () {
        const versionOps = yield* VersionOperationsService;
        return yield* versionOps.copyVersionStructure({
          sourceVersionId: version.id,
          repoId: course.id,
          newVersionName: "v2",
        });
      })
    );

    const newVideoId = result.videoIdMappings.find(
      (m) => m.sourceVideoId === video.id
    )!.newVideoId;

    const sourceOrder = await animaticLabels(video.id);
    expect(sourceOrder).toEqual([
      "chapter:Setup",
      "mockup:One",
      "chapter:The bug",
      "mockup:Two",
      "mockup:Three",
      "chapter:The fix",
    ]);

    expect(await animaticLabels(newVideoId)).toEqual(sourceOrder);

    // An archived Chapter is never copied, the way an archived Clip Mockup is
    // not: the copy holds no row for "Cut" at all, archived or otherwise.
    const everyCopiedChapter = await testDb.query.clipMockupChapters.findMany({
      where: (c, { eq }) => eq(c.videoId, newVideoId),
    });
    expect(everyCopiedChapter.map((c) => c.name).sort()).toEqual([
      "Setup",
      "The bug",
      "The fix",
    ]);
  });
});
