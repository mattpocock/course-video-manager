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
 * Past Thumbnail Diagrams show up in diagram search, labelled with their
 * Video, so next week's thumbnail can start from this week's (ADR 0060).
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

const createVideo = async (title: string) => {
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
      title,
      originalFootagePath: "/footage/raw-01.mp4",
    })
    .returning();
  return video!;
};

const layers = {
  backgroundPhoto: { filePath: "/video-files/x/bg.png", horizontalPosition: 0 },
  diagram: null,
  cutout: { filePath: "/video-files/x/cutout.png", horizontalPosition: 50 },
};

const drawing = (text: string) => ({
  store: {
    "shape:box": {
      id: "shape:box",
      typeName: "shape",
      type: "text",
      parentId: "page:page",
      props: { text },
    },
  },
  schema: { schemaVersion: 2, sequences: {} },
});

const saveThumbnail = (videoId: string, thumbnailDiagram: unknown) =>
  Effect.gen(function* () {
    const ops = yield* ThumbnailOperationsService;
    return yield* ops.createThumbnail({
      videoId,
      layers,
      filePath: null,
      thumbnailDiagram,
    });
  });

describe("searchThumbnailDiagrams", () => {
  it.effect(
    "finds a Thumbnail Diagram by its text, labelled with its Video",
    () =>
      Effect.gen(function* () {
        const video = yield* Effect.promise(() => createVideo("Agent loops"));
        const thumbnail = yield* saveThumbnail(
          video.id,
          drawing("Context window budget")
        );
        const other = yield* Effect.promise(() => createVideo("Other"));
        yield* saveThumbnail(other.id, drawing("Unrelated words"));

        const ops = yield* ThumbnailOperationsService;
        const hits = yield* ops.searchThumbnailDiagrams("budgets");

        expect(hits).toEqual([
          expect.objectContaining({
            source: "thumbnail-diagram",
            thumbnailId: thumbnail.id,
            videoId: video.id,
            videoTitle: "Agent loops",
            searchText: "Context window budget",
          }),
        ]);
      }).pipe(Effect.provide(testLayer))
  );

  it.effect("finds a Thumbnail Diagram by its Video's title", () =>
    Effect.gen(function* () {
      const video = yield* Effect.promise(() => createVideo("Cursor rules"));
      const thumbnail = yield* saveThumbnail(video.id, drawing("Agents"));

      const ops = yield* ThumbnailOperationsService;
      const hits = yield* ops.searchThumbnailDiagrams("cursor");

      expect(hits.map((h) => h.thumbnailId)).toEqual([thumbnail.id]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("finds the drawing as last saved, not as first created", () =>
    Effect.gen(function* () {
      const video = yield* Effect.promise(() => createVideo("Video"));
      const thumbnail = yield* saveThumbnail(video.id, drawing("Before"));
      const ops = yield* ThumbnailOperationsService;
      yield* ops.updateThumbnail(thumbnail.id, {
        layers,
        filePath: null,
        thumbnailDiagram: drawing("Afterwards"),
      });

      expect(yield* ops.searchThumbnailDiagrams("before")).toEqual([]);
      expect(
        (yield* ops.searchThumbnailDiagrams("afterwards")).map(
          (h) => h.thumbnailId
        )
      ).toEqual([thumbnail.id]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "leaves out archived Thumbnails and pasted-PNG ones with no drawing",
    () =>
      Effect.gen(function* () {
        const video = yield* Effect.promise(() => createVideo("Agents"));
        const archived = yield* saveThumbnail(video.id, drawing("Agents"));
        yield* saveThumbnail(video.id, null);
        const ops = yield* ThumbnailOperationsService;
        yield* ops.archiveThumbnail(archived.id);

        expect(yield* ops.searchThumbnailDiagrams("agents")).toEqual([]);
      }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "shows one drawing once: a copy's hit stands for the original",
    () =>
      Effect.gen(function* () {
        const original = yield* Effect.promise(() => createVideo("Agents v1"));
        yield* saveThumbnail(original.id, drawing("Loop"));
        const copied = yield* Effect.promise(() => createVideo("Agents v2"));
        const copy = yield* saveThumbnail(copied.id, drawing("Loop"));
        const different = yield* saveThumbnail(
          copied.id,
          drawing("Loop twice")
        );

        const ops = yield* ThumbnailOperationsService;
        const hits = yield* ops.searchThumbnailDiagrams("loop");

        expect(hits.map((h) => h.thumbnailId).sort()).toEqual(
          [copy.id, different.id].sort()
        );
      }).pipe(Effect.provide(testLayer))
  );
});
