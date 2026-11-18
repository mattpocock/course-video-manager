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

const createVideo = async (title: string, lineageId?: string) => {
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
      ...(lineageId && { lineageId }),
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

const saveThumbnail = (
  videoId: string,
  thumbnailDiagram: ReturnType<typeof drawing> | null
) =>
  Effect.gen(function* () {
    const ops = yield* ThumbnailOperationsService;
    return yield* ops.createThumbnail({
      videoId,
      layers,
      filePath: null,
      thumbnailDiagram,
      diagramSources: [],
    });
  });

/** A copy of `originalId`'s Thumbnail, as a copy path writes it. */
const copyThumbnail = (
  videoId: string,
  originalId: string,
  thumbnailDiagram: ReturnType<typeof drawing>
) =>
  Effect.gen(function* () {
    const ops = yield* ThumbnailOperationsService;
    return yield* ops.createThumbnail({
      videoId,
      layers,
      filePath: null,
      thumbnailDiagram,
      diagramSources: [{ kind: "thumbnail-diagram", thumbnailId: originalId }],
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
        diagramSources: [],
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

  it.effect("shows A/B Thumbnails with identical drawings, one hit each", () =>
    Effect.gen(function* () {
      const video = yield* Effect.promise(() => createVideo("Agents"));
      const a = yield* saveThumbnail(video.id, drawing("Loop"));
      const b = yield* saveThumbnail(video.id, drawing("Loop"));

      const ops = yield* ThumbnailOperationsService;
      const hits = yield* ops.searchThumbnailDiagrams("loop");

      expect(hits.map((h) => h.thumbnailId).sort()).toEqual(
        [a.id, b.id].sort()
      );
    }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "shows a Version copy's unchanged drawing once: the copy's hit stands for the original",
    () =>
      Effect.gen(function* () {
        const original = yield* Effect.promise(() => createVideo("Agents v1"));
        const before = yield* saveThumbnail(original.id, drawing("Loop"));
        const draft = yield* Effect.promise(() =>
          createVideo("Agents v2", original.lineageId)
        );
        const copy = yield* copyThumbnail(draft.id, before.id, drawing("Loop"));
        const edited = yield* saveThumbnail(original.id, drawing("Loop"));
        const editedCopy = yield* copyThumbnail(
          draft.id,
          edited.id,
          drawing("Loop again")
        );

        const ops = yield* ThumbnailOperationsService;
        const hits = yield* ops.searchThumbnailDiagrams("loop");

        expect(hits.map((h) => h.thumbnailId).sort()).toEqual(
          [copy.id, edited.id, editedCopy.id].sort()
        );
      }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "shows both when the same drawing was copied to a different Video",
    () =>
      Effect.gen(function* () {
        const original = yield* Effect.promise(() => createVideo("Agents"));
        const source = yield* saveThumbnail(original.id, drawing("Loop"));
        const other = yield* Effect.promise(() => createVideo("Tools"));
        const copy = yield* copyThumbnail(other.id, source.id, drawing("Loop"));

        const ops = yield* ThumbnailOperationsService;
        const hits = yield* ops.searchThumbnailDiagrams("loop");

        expect(hits.map((h) => h.thumbnailId).sort()).toEqual(
          [source.id, copy.id].sort()
        );
      }).pipe(Effect.provide(testLayer))
  );

  it.effect("matches %, _ and \\ in a title literally", () =>
    Effect.gen(function* () {
      const literal = yield* Effect.promise(() => createVideo("100% agents"));
      const thumbnail = yield* saveThumbnail(literal.id, drawing("Box"));
      const other = yield* Effect.promise(() => createVideo("100 agents"));
      yield* saveThumbnail(other.id, drawing("Box"));

      const ops = yield* ThumbnailOperationsService;

      expect(
        (yield* ops.searchThumbnailDiagrams("0%")).map((h) => h.thumbnailId)
      ).toEqual([thumbnail.id]);
      expect(yield* ops.searchThumbnailDiagrams("1_0")).toEqual([]);
      expect(yield* ops.searchThumbnailDiagrams("\\")).toEqual([]);
    }).pipe(Effect.provide(testLayer))
  );
});
