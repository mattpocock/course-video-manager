import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { ThumbnailOperationsService } from "./db-thumbnail-operations.server.js";
import { DiagramOperationsService } from "./db-diagram-operations.server.js";
import { DiagramThumbnailStore } from "./diagram-thumbnail-store.js";
import { DrizzleService } from "./drizzle-service.server.js";
import { isVisibleInTimeline } from "../lib/timeline-visibility.js";
import * as schema from "../db/schema.js";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "../test-utils/test-db.js";

/**
 * Every insert into a Thumbnail Diagram records its source, so the link
 * between a thumbnail and the drawing it came from is never lost (ADR 0060).
 */

let testDb: TestDb;
let testLayer: Layer.Layer<
  ThumbnailOperationsService | DiagramOperationsService
>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  testLayer = Layer.mergeAll(
    ThumbnailOperationsService.Default,
    DiagramOperationsService.Default
  ).pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as any)),
    Layer.provide(DiagramThumbnailStore.noop)
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

const component = {
  kind: "diagram-component",
  diagramComponentId: "component-1",
} as const;

describe("a Thumbnail Diagram's recorded sources", () => {
  it.effect("are saved with the Thumbnail and loaded back with it", () =>
    Effect.gen(function* () {
      const video = yield* Effect.promise(createVideo);
      const ops = yield* ThumbnailOperationsService;
      const created = yield* ops.createThumbnail({
        videoId: video.id,
        layers,
        filePath: null,
        thumbnailDiagram: drawing("Agent"),
        diagramSources: [
          component,
          { kind: "diagram-snapshot", diagramSnapshotId: "snapshot-1" },
          { kind: "thumbnail-diagram", thumbnailId: "thumbnail-1" },
        ],
      });

      const [loaded] = yield* ops.getThumbnailsByVideoId(video.id);
      expect(loaded!.id).toBe(created.id);
      expect(loaded!.diagramSources).toEqual([
        component,
        { kind: "diagram-snapshot", diagramSnapshotId: "snapshot-1" },
        { kind: "thumbnail-diagram", thumbnailId: "thumbnail-1" },
      ]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("start empty on a Thumbnail nothing was inserted into", () =>
    Effect.gen(function* () {
      const video = yield* Effect.promise(createVideo);
      const ops = yield* ThumbnailOperationsService;
      const created = yield* ops.createThumbnail({
        videoId: video.id,
        layers,
        filePath: null,
        thumbnailDiagram: drawing("Pasted only"),
        diagramSources: [],
      });

      expect((yield* ops.getThumbnailById(created.id)).diagramSources).toEqual(
        []
      );
    }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "are never lost: a later save adds its sources to the ones recorded",
    () =>
      Effect.gen(function* () {
        const video = yield* Effect.promise(createVideo);
        const ops = yield* ThumbnailOperationsService;
        const created = yield* ops.createThumbnail({
          videoId: video.id,
          layers,
          filePath: null,
          thumbnailDiagram: drawing("Agent"),
          diagramSources: [component],
        });

        // A save from a page that opened the Thumbnail fresh: it only knows
        // what it inserted since, and the component's shapes were deleted.
        yield* ops.updateThumbnail(created.id, {
          layers,
          filePath: null,
          thumbnailDiagram: drawing("Agent, trimmed"),
          diagramSources: [
            { kind: "diagram-snapshot", diagramSnapshotId: "snapshot-1" },
            component,
          ],
        });
        yield* ops.updateThumbnail(created.id, {
          layers,
          filePath: null,
          thumbnailDiagram: drawing("Agent, trimmed again"),
          diagramSources: [],
        });

        expect(
          (yield* ops.getThumbnailById(created.id)).diagramSources
        ).toEqual([
          component,
          { kind: "diagram-snapshot", diagramSnapshotId: "snapshot-1" },
        ]);
      }).pipe(Effect.provide(testLayer))
  );

  it.effect("still resolve to an archived Thumbnail recorded as a source", () =>
    Effect.gen(function* () {
      const video = yield* Effect.promise(createVideo);
      const ops = yield* ThumbnailOperationsService;
      const original = yield* ops.createThumbnail({
        videoId: video.id,
        layers,
        filePath: null,
        thumbnailDiagram: drawing("Original"),
        diagramSources: [],
      });
      const reuse = yield* ops.createThumbnail({
        videoId: video.id,
        layers,
        filePath: null,
        thumbnailDiagram: drawing("Original"),
        diagramSources: [
          { kind: "thumbnail-diagram", thumbnailId: original.id },
        ],
      });

      yield* ops.archiveThumbnail(original.id);

      const [source] = (yield* ops.getThumbnailById(reuse.id)).diagramSources;
      expect(source).toEqual({
        kind: "thumbnail-diagram",
        thumbnailId: original.id,
      });
      const resolved = yield* ops.getThumbnailById(original.id);
      expect(resolved.thumbnailDiagram).toEqual(drawing("Original"));
    }).pipe(Effect.provide(testLayer))
  );
});

describe("inserting a Diagram's head into a Thumbnail Diagram", () => {
  // The page pins the head (POST /api/diagrams/:id/snapshots, no options)
  // and records the snapshot it gets back, so the record points at exactly
  // what was copied, not at a head that keeps moving.
  const pinHead = (diagramId: string) =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      return yield* diagramOps.createSnapshot(diagramId, {});
    });

  it.effect(
    "pins the head once, unpreserved and off the timeline, however often it is inserted",
    () =>
      Effect.gen(function* () {
        const diagramOps = yield* DiagramOperationsService;
        const diagram = yield* diagramOps.createDiagram();
        yield* diagramOps.updateDiagramHead(diagram.id, drawing("Head"));

        const first = yield* pinHead(diagram.id);
        const second = yield* pinHead(diagram.id);

        expect(second.id).toBe(first.id);
        expect(first.scene).toEqual(drawing("Head"));
        expect(first.preserved).toBe(false);
        const snapshots = yield* diagramOps.listSnapshotsWithClips(diagram.id);
        expect(snapshots).toHaveLength(1);
        expect(
          snapshots.filter((s) => isVisibleInTimeline(s, s.clips))
        ).toEqual([]);
      }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "records the pinned snapshot, which keeps the drawing after the head moves on",
    () =>
      Effect.gen(function* () {
        const diagramOps = yield* DiagramOperationsService;
        const ops = yield* ThumbnailOperationsService;
        const video = yield* Effect.promise(createVideo);
        const diagram = yield* diagramOps.createDiagram();
        yield* diagramOps.updateDiagramHead(diagram.id, drawing("Head"));

        const pinned = yield* pinHead(diagram.id);
        const thumbnail = yield* ops.createThumbnail({
          videoId: video.id,
          layers,
          filePath: null,
          thumbnailDiagram: drawing("Head"),
          diagramSources: [
            { kind: "diagram-snapshot", diagramSnapshotId: pinned.id },
          ],
        });
        yield* diagramOps.updateDiagramHead(
          diagram.id,
          drawing("Head, edited")
        );

        const [source] = (yield* ops.getThumbnailById(thumbnail.id))
          .diagramSources;
        expect(source).toEqual({
          kind: "diagram-snapshot",
          diagramSnapshotId: pinned.id,
        });
        const recorded = yield* diagramOps.getDiagramSnapshot(pinned.id);
        expect(recorded.scene).toEqual(drawing("Head"));
      }).pipe(Effect.provide(testLayer))
  );

  it.effect("keeps a head the author had already preserved preserved", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const diagram = yield* diagramOps.createDiagram();
      yield* diagramOps.updateDiagramHead(diagram.id, drawing("Head"));
      const preserved = yield* diagramOps.createSnapshot(diagram.id, {
        preserved: true,
      });

      const pinned = yield* pinHead(diagram.id);

      expect(pinned.id).toBe(preserved.id);
      expect(pinned.preserved).toBe(true);
    }).pipe(Effect.provide(testLayer))
  );
});
