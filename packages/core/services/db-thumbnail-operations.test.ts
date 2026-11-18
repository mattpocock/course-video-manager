import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { ThumbnailOperationsService } from "./db-thumbnail-operations.server.js";
import { DrizzleService } from "./drizzle-service.server.js";
import * as schema from "../db/schema.js";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "../test-utils/test-db.js";

/**
 * Deleting a Thumbnail archives it (ADR 0060): its row and files stay, so a
 * Thumbnail Diagram that recorded it as a source keeps resolving, but it
 * drops out of every list the author picks a Thumbnail from.
 */

let testDb: TestDb;
let testLayer: Layer.Layer<ThumbnailOperationsService>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  testLayer = ThumbnailOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as any))
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

const createVideo = async () => {
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
      title: "video-01.mp4",
      originalFootagePath: "/footage/raw-01.mp4",
    })
    .returning();
  return video!;
};

const layers = {
  backgroundPhoto: {
    filePath: "/video-files/x/bg.png",
    horizontalPosition: 50,
  },
  diagram: null,
  cutout: null,
};

describe("archiveThumbnail", () => {
  it.effect(
    "keeps the row, with its layers and file, and stamps it archived",
    () =>
      Effect.gen(function* () {
        const video = yield* Effect.promise(createVideo);
        const ops = yield* ThumbnailOperationsService;
        const created = yield* ops.createThumbnail({
          videoId: video.id,
          layers,
          filePath: "/video-files/x/thumbnail.png",
        });

        yield* ops.archiveThumbnail(created.id);

        const archived = yield* ops.getThumbnailById(created.id);
        expect(archived.archivedAt).toBeInstanceOf(Date);
        expect(archived.layers).toEqual(layers);
        expect(archived.filePath).toBe("/video-files/x/thumbnail.png");
      }).pipe(Effect.provide(testLayer))
  );

  it.effect("fails with NotFoundError for a Thumbnail that never existed", () =>
    Effect.gen(function* () {
      const ops = yield* ThumbnailOperationsService;
      const error = yield* ops
        .archiveThumbnail("no-such-thumbnail")
        .pipe(Effect.flip);
      expect(error._tag).toBe("NotFoundError");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("leaves the Video's other Thumbnails listed", () =>
    Effect.gen(function* () {
      const video = yield* Effect.promise(createVideo);
      const ops = yield* ThumbnailOperationsService;
      const kept = yield* ops.createThumbnail({
        videoId: video.id,
        layers,
        filePath: null,
      });
      const gone = yield* ops.createThumbnail({
        videoId: video.id,
        layers,
        filePath: null,
      });

      yield* ops.archiveThumbnail(gone.id);

      const listed = yield* ops.getThumbnailsByVideoId(video.id);
      expect(listed.map((t) => t.id)).toEqual([kept.id]);
    }).pipe(Effect.provide(testLayer))
  );
});
