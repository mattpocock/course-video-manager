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
          thumbnailDiagram: null,
          diagramSources: [],
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
        thumbnailDiagram: null,
        diagramSources: [],
      });
      const gone = yield* ops.createThumbnail({
        videoId: video.id,
        layers,
        filePath: null,
        thumbnailDiagram: null,
        diagramSources: [],
      });

      yield* ops.archiveThumbnail(gone.id);

      const listed = yield* ops.getThumbnailsByVideoId(video.id);
      expect(listed.map((t) => t.id)).toEqual([kept.id]);
    }).pipe(Effect.provide(testLayer))
  );
});

/**
 * A Thumbnail Diagram is a tldraw `document`, the same format as a Diagram's
 * head (ADR 0060). A small one, as the editor's `getSnapshot().document` gives it.
 */
const drawing = (text: string) => ({
  store: {
    "document:document": {
      id: "document:document",
      typeName: "document",
      gridSize: 10,
      name: "",
      meta: {},
    },
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

describe("a Thumbnail's Thumbnail Diagram", () => {
  it.effect(
    "is saved with the Thumbnail and loaded back with the Video's list",
    () =>
      Effect.gen(function* () {
        const video = yield* Effect.promise(createVideo);
        const ops = yield* ThumbnailOperationsService;
        const created = yield* ops.createThumbnail({
          videoId: video.id,
          layers,
          filePath: null,
          thumbnailDiagram: drawing("Agent"),
          diagramSources: [],
        });

        const [loaded] = yield* ops.getThumbnailsByVideoId(video.id);
        expect(loaded!.id).toBe(created.id);
        expect(loaded!.thumbnailDiagram).toEqual(drawing("Agent"));
      }).pipe(Effect.provide(testLayer))
  );

  it.effect("is replaced by each save of the Thumbnail", () =>
    Effect.gen(function* () {
      const video = yield* Effect.promise(createVideo);
      const ops = yield* ThumbnailOperationsService;
      const created = yield* ops.createThumbnail({
        videoId: video.id,
        layers,
        filePath: null,
        thumbnailDiagram: drawing("Agent"),
        diagramSources: [],
      });

      yield* ops.updateThumbnail(created.id, {
        layers,
        filePath: null,
        thumbnailDiagram: drawing("Tools"),
        diagramSources: [],
      });

      const loaded = yield* ops.getThumbnailById(created.id);
      expect(loaded.thumbnailDiagram).toEqual(drawing("Tools"));
    }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "belongs to its own Thumbnail: a sibling's save leaves it alone",
    () =>
      Effect.gen(function* () {
        const video = yield* Effect.promise(createVideo);
        const ops = yield* ThumbnailOperationsService;
        const a = yield* ops.createThumbnail({
          videoId: video.id,
          layers,
          filePath: null,
          thumbnailDiagram: drawing("A"),
          diagramSources: [],
        });
        const b = yield* ops.createThumbnail({
          videoId: video.id,
          layers,
          filePath: null,
          thumbnailDiagram: drawing("B"),
          diagramSources: [],
        });

        yield* ops.updateThumbnail(b.id, {
          layers,
          filePath: null,
          thumbnailDiagram: drawing("B, edited"),
          diagramSources: [],
        });

        expect((yield* ops.getThumbnailById(a.id)).thumbnailDiagram).toEqual(
          drawing("A")
        );
      }).pipe(Effect.provide(testLayer))
  );

  it.effect("stays null on a pasted-PNG Thumbnail saved as before", () =>
    Effect.gen(function* () {
      const video = yield* Effect.promise(createVideo);
      const ops = yield* ThumbnailOperationsService;
      const pastedLayers = {
        ...layers,
        diagram: { filePath: "/video-files/x/d.png", horizontalPosition: 20 },
      };
      const created = yield* ops.createThumbnail({
        videoId: video.id,
        layers: pastedLayers,
        filePath: null,
        thumbnailDiagram: null,
        diagramSources: [],
      });
      yield* ops.updateThumbnail(created.id, {
        layers: pastedLayers,
        filePath: null,
        thumbnailDiagram: null,
        diagramSources: [],
      });

      const loaded = yield* ops.getThumbnailById(created.id);
      expect(loaded.thumbnailDiagram).toBeNull();
      expect(loaded.layers).toEqual(pastedLayers);
    }).pipe(Effect.provide(testLayer))
  );
});
