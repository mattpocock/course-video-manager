import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Either, Layer } from "effect";
import { eq } from "drizzle-orm";
import { ThumbnailOperationsService } from "./db-thumbnail-operations.server.js";
import { DrizzleService } from "./drizzle-service.server.js";
import * as schema from "../db/schema.js";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "../test-utils/test-db.js";

/**
 * A Thumbnail hangs off a Video, so a Version owns it: only a Draft's Video
 * takes a Thumbnail write (docs/DRAFT_GUARD.md). A write that names a Video
 * of a Pending or Published Version is a stranded write, and is refused.
 */

let testDb: TestDb;
let testLayer: Layer.Layer<ThumbnailOperationsService>;

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
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
  return { version: version!, video: video! };
};

const publish = (versionId: string) =>
  Effect.promise(() =>
    testDb
      .update(schema.courseVersions)
      .set({ commitState: "published" })
      .where(eq(schema.courseVersions.id, versionId))
  );

const layers = { backgroundPhoto: null, diagram: null, cutout: null };
const save = { layers, filePath: null, thumbnailDiagram: null };

describe("Thumbnail writes and the Draft guard", () => {
  it.effect("refuses a new Thumbnail on a published Version's Video", () =>
    Effect.gen(function* () {
      const { version, video } = yield* Effect.promise(createVideo);
      yield* publish(version.id);
      const ops = yield* ThumbnailOperationsService;

      const result = yield* ops
        .createThumbnail({ videoId: video.id, ...save, diagramSources: [] })
        .pipe(Effect.either);

      expect(Either.isLeft(result) && result.left._tag).toBe(
        "VersionNotDraftError"
      );
      const rows = yield* Effect.promise(() =>
        testDb.query.thumbnails.findMany()
      );
      expect(rows).toEqual([]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "refuses to save, archive or record sources on a Thumbnail once its Version is published",
    () =>
      Effect.gen(function* () {
        const { version, video } = yield* Effect.promise(createVideo);
        const ops = yield* ThumbnailOperationsService;
        const created = yield* ops.createThumbnail({
          videoId: video.id,
          ...save,
          diagramSources: [],
        });
        yield* publish(version.id);

        const update = yield* ops
          .updateThumbnail(created.id, {
            ...save,
            filePath: "/changed.png",
            diagramSources: [],
          })
          .pipe(Effect.either);
        const archive = yield* ops
          .archiveThumbnail(created.id)
          .pipe(Effect.either);
        const sources = yield* ops
          .recordThumbnailDiagramSources(created.id, [
            { kind: "thumbnail-diagram", thumbnailId: "other" },
          ])
          .pipe(Effect.either);

        expect(Either.isLeft(update) && update.left._tag).toBe(
          "VersionNotDraftError"
        );
        expect(Either.isLeft(archive) && archive.left._tag).toBe(
          "VersionNotDraftError"
        );
        expect(Either.isLeft(sources) && sources.left._tag).toBe(
          "VersionNotDraftError"
        );
        const stored = yield* ops.getThumbnailById(created.id);
        expect(stored.filePath).toBeNull();
        expect(stored.archivedAt).toBeNull();
        expect(stored.diagramSources).toEqual([]);
      }).pipe(Effect.provide(testLayer))
  );

  it.effect("still saves a Thumbnail on a Draft's Video", () =>
    Effect.gen(function* () {
      const { video } = yield* Effect.promise(createVideo);
      const ops = yield* ThumbnailOperationsService;
      const created = yield* ops.createThumbnail({
        videoId: video.id,
        ...save,
        diagramSources: [],
      });

      const updated = yield* ops.updateThumbnail(created.id, {
        ...save,
        filePath: "/changed.png",
        diagramSources: [],
      });

      expect(updated.filePath).toBe("/changed.png");
    }).pipe(Effect.provide(testLayer))
  );
});
