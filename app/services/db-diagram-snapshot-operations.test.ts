import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { DiagramOperationsService } from "@/services/db-diagram-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";

let testDb: TestDb;
let testLayer: Layer.Layer<
  | DiagramOperationsService
  | VideoOperationsService
  | ClipOperationsService
  | CourseOperationsService
>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;

  const drizzleLayer = Layer.succeed(DrizzleService, testDb as any);
  testLayer = Layer.mergeAll(
    DiagramOperationsService.Default,
    VideoOperationsService.Default,
    ClipOperationsService.Default,
    CourseOperationsService.Default
  ).pipe(Layer.provide(drizzleLayer));
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

const scene1 = {
  store: { "shape:a": { id: "a", x: 1 } },
  schema: { schemaVersion: 2 },
};
const scene2 = {
  store: { "shape:b": { id: "b", x: 2 } },
  schema: { schemaVersion: 2 },
};

describe("listSnapshots", () => {
  it.effect("returns snapshots for a diagram ordered by createdAt asc", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const diagram = yield* diagramOps.createDiagram();

      yield* diagramOps.updateDiagramHead(diagram.id, scene1);
      const s1 = yield* diagramOps.createSnapshot(diagram.id, {
        preserved: true,
      });

      yield* diagramOps.updateDiagramHead(diagram.id, scene2);
      const s2 = yield* diagramOps.createSnapshot(diagram.id, {
        preserved: true,
      });

      const snapshots = yield* diagramOps.listSnapshots(diagram.id);

      expect(snapshots).toHaveLength(2);
      expect(snapshots[0]!.id).toBe(s1.id);
      expect(snapshots[1]!.id).toBe(s2.id);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("returns empty array when diagram has no snapshots", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const diagram = yield* diagramOps.createDiagram();

      const snapshots = yield* diagramOps.listSnapshots(diagram.id);
      expect(snapshots).toEqual([]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("does not return snapshots from other diagrams", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const d1 = yield* diagramOps.createDiagram();
      const d2 = yield* diagramOps.createDiagram();

      yield* diagramOps.updateDiagramHead(d1.id, scene1);
      yield* diagramOps.createSnapshot(d1.id, { preserved: true });

      yield* diagramOps.updateDiagramHead(d2.id, scene2);
      yield* diagramOps.createSnapshot(d2.id, { preserved: true });

      const snapshots = yield* diagramOps.listSnapshots(d1.id);
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]!.diagramId).toBe(d1.id);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("returns both preserved and non-preserved snapshots", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const diagram = yield* diagramOps.createDiagram();

      yield* diagramOps.updateDiagramHead(diagram.id, scene1);
      yield* diagramOps.createSnapshot(diagram.id, { preserved: true });

      yield* diagramOps.updateDiagramHead(diagram.id, scene2);
      yield* diagramOps.createSnapshot(diagram.id, { preserved: false });

      const snapshots = yield* diagramOps.listSnapshots(diagram.id);
      expect(snapshots).toHaveLength(2);
      expect(snapshots.map((s) => s.preserved)).toEqual([true, false]);
    }).pipe(Effect.provide(testLayer))
  );
});

describe("listSnapshotsWithClips", () => {
  it.effect("returns snapshots with their pinning clips", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const videoOps = yield* VideoOperationsService;
      const clipOps = yield* ClipOperationsService;
      const diagram = yield* diagramOps.createDiagram();
      yield* diagramOps.updateDiagramHead(diagram.id, scene1);

      const video = yield* videoOps.createStandaloneVideo({
        path: "test-video.mp4",
      });
      const clips = yield* clipOps.appendClips({
        videoId: video.id,
        insertionPoint: { type: "start" },
        clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
      });
      const clip = clips[0]!;

      const snapshot = yield* diagramOps.createSnapshotForClip(
        diagram.id,
        clip.id
      );

      const result = yield* diagramOps.listSnapshotsWithClips(diagram.id);
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe(snapshot.id);
      expect(result[0]!.clips).toHaveLength(1);
      expect(result[0]!.clips[0]!.id).toBe(clip.id);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("returns empty clips array for unpinned snapshot", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const diagram = yield* diagramOps.createDiagram();
      yield* diagramOps.updateDiagramHead(diagram.id, scene1);
      yield* diagramOps.createSnapshot(diagram.id, { preserved: true });

      const result = yield* diagramOps.listSnapshotsWithClips(diagram.id);
      expect(result).toHaveLength(1);
      expect(result[0]!.clips).toEqual([]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("includes archived flag on pinning clips", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const videoOps = yield* VideoOperationsService;
      const clipOps = yield* ClipOperationsService;
      const diagram = yield* diagramOps.createDiagram();
      yield* diagramOps.updateDiagramHead(diagram.id, scene1);

      const video = yield* videoOps.createStandaloneVideo({
        path: "test-video.mp4",
      });
      const clips = yield* clipOps.appendClips({
        videoId: video.id,
        insertionPoint: { type: "start" },
        clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
      });
      const clip = clips[0]!;

      yield* diagramOps.createSnapshotForClip(diagram.id, clip.id);
      yield* clipOps.archiveClip(clip.id);

      const result = yield* diagramOps.listSnapshotsWithClips(diagram.id);
      expect(result).toHaveLength(1);
      expect(result[0]!.clips).toHaveLength(1);
      expect(result[0]!.clips[0]!.archived).toBe(true);
    }).pipe(Effect.provide(testLayer))
  );
});

describe("restoreSnapshotToHead", () => {
  it.effect("copies snapshot scene into diagram headScene", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const diagram = yield* diagramOps.createDiagram();

      yield* diagramOps.updateDiagramHead(diagram.id, scene1);
      const snapshot = yield* diagramOps.createSnapshot(diagram.id, {
        preserved: true,
      });

      yield* diagramOps.updateDiagramHead(diagram.id, scene2);

      const updated = yield* diagramOps.restoreSnapshotToHead(
        diagram.id,
        snapshot.id
      );

      expect(updated.headScene).toEqual(scene1);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("does not mutate the snapshot row", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const diagram = yield* diagramOps.createDiagram();

      yield* diagramOps.updateDiagramHead(diagram.id, scene1);
      const snapshotBefore = yield* diagramOps.createSnapshot(diagram.id, {
        preserved: true,
      });

      yield* diagramOps.updateDiagramHead(diagram.id, scene2);
      yield* diagramOps.restoreSnapshotToHead(diagram.id, snapshotBefore.id);

      const snapshots = yield* diagramOps.listSnapshots(diagram.id);
      const snapshotAfter = snapshots.find((s) => s.id === snapshotBefore.id)!;

      expect(snapshotAfter.id).toBe(snapshotBefore.id);
      expect(snapshotAfter.scene).toEqual(snapshotBefore.scene);
      expect(snapshotAfter.contentHash).toBe(snapshotBefore.contentHash);
      expect(snapshotAfter.preserved).toBe(snapshotBefore.preserved);
      expect(snapshotAfter.createdAt.getTime()).toBe(
        snapshotBefore.createdAt.getTime()
      );
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("bumps diagram updatedAt on restore", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const diagram = yield* diagramOps.createDiagram();

      yield* diagramOps.updateDiagramHead(diagram.id, scene1);
      const snapshot = yield* diagramOps.createSnapshot(diagram.id, {
        preserved: true,
      });

      yield* Effect.promise(() => new Promise((r) => setTimeout(r, 50)));
      const updated = yield* diagramOps.restoreSnapshotToHead(
        diagram.id,
        snapshot.id
      );

      expect(updated.updatedAt.getTime()).toBeGreaterThan(
        diagram.updatedAt.getTime()
      );
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("fails with NotFoundError for non-existent diagram", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const result = yield* diagramOps
        .restoreSnapshotToHead("nonexistent-id", "some-snapshot-id")
        .pipe(Effect.flip);
      expect(result._tag).toBe("NotFoundError");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("fails with NotFoundError for non-existent snapshot", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const diagram = yield* diagramOps.createDiagram();

      const result = yield* diagramOps
        .restoreSnapshotToHead(diagram.id, "nonexistent-snapshot-id")
        .pipe(Effect.flip);
      expect(result._tag).toBe("NotFoundError");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("is idempotent when restoring the same snapshot twice", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const diagram = yield* diagramOps.createDiagram();

      yield* diagramOps.updateDiagramHead(diagram.id, scene1);
      const snapshot = yield* diagramOps.createSnapshot(diagram.id, {
        preserved: true,
      });

      yield* diagramOps.updateDiagramHead(diagram.id, scene2);

      const first = yield* diagramOps.restoreSnapshotToHead(
        diagram.id,
        snapshot.id
      );
      const second = yield* diagramOps.restoreSnapshotToHead(
        diagram.id,
        snapshot.id
      );

      expect(first.headScene).toEqual(scene1);
      expect(second.headScene).toEqual(scene1);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "fails with NotFoundError when snapshot belongs to a different diagram",
    () =>
      Effect.gen(function* () {
        const diagramOps = yield* DiagramOperationsService;
        const d1 = yield* diagramOps.createDiagram();
        const d2 = yield* diagramOps.createDiagram();

        yield* diagramOps.updateDiagramHead(d1.id, scene1);
        const snapshot = yield* diagramOps.createSnapshot(d1.id, {
          preserved: true,
        });

        const result = yield* diagramOps
          .restoreSnapshotToHead(d2.id, snapshot.id)
          .pipe(Effect.flip);
        expect(result._tag).toBe("NotFoundError");
      }).pipe(Effect.provide(testLayer))
  );
});

describe("updateClipDiagramPin", () => {
  const scene = {
    store: { "shape:abc": { id: "abc", x: 10 } },
    schema: { schemaVersion: 2 },
  };

  const createVideoWithClip = Effect.gen(function* () {
    const videoOps = yield* VideoOperationsService;
    const clipOps = yield* ClipOperationsService;
    const video = yield* videoOps.createStandaloneVideo({
      path: "test-video.mp4",
    });
    const clips = yield* clipOps.appendClips({
      videoId: video.id,
      insertionPoint: { type: "start" },
      clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
    });
    return { video, clip: clips[0]! };
  });

  it.effect("pins a snapshot to a clip", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const { clip } = yield* createVideoWithClip;
      const diagram = yield* diagramOps.createDiagram();
      yield* diagramOps.updateDiagramHead(diagram.id, scene);
      const snapshot = yield* diagramOps.createSnapshot(diagram.id, {});

      const updated = yield* diagramOps.updateClipDiagramPin(
        clip.id,
        snapshot.id
      );

      expect(updated.diagramSnapshotId).toBe(snapshot.id);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("unpins a snapshot from a clip by setting null", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const clipOps = yield* ClipOperationsService;
      const { clip } = yield* createVideoWithClip;
      const diagram = yield* diagramOps.createDiagram();
      yield* diagramOps.updateDiagramHead(diagram.id, scene);
      const snapshot = yield* diagramOps.createSnapshotForClip(
        diagram.id,
        clip.id
      );

      expect(snapshot.id).toEqual(expect.any(String));
      const pinned = yield* clipOps.getClipById(clip.id);
      expect(pinned.diagramSnapshotId).toBe(snapshot.id);

      const updated = yield* diagramOps.updateClipDiagramPin(clip.id, null);

      expect(updated.diagramSnapshotId).toBeNull();
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("fails with NotFoundError for non-existent clip", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const result = yield* diagramOps
        .updateClipDiagramPin("nonexistent-id", null)
        .pipe(Effect.flip);
      expect(result._tag).toBe("NotFoundError");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "is idempotent — pinning same snapshot twice returns same result",
    () =>
      Effect.gen(function* () {
        const diagramOps = yield* DiagramOperationsService;
        const { clip } = yield* createVideoWithClip;
        const diagram = yield* diagramOps.createDiagram();
        yield* diagramOps.updateDiagramHead(diagram.id, scene);
        const snapshot = yield* diagramOps.createSnapshot(diagram.id, {});

        const first = yield* diagramOps.updateClipDiagramPin(
          clip.id,
          snapshot.id
        );
        const second = yield* diagramOps.updateClipDiagramPin(
          clip.id,
          snapshot.id
        );

        expect(first.diagramSnapshotId).toBe(snapshot.id);
        expect(second.diagramSnapshotId).toBe(snapshot.id);
      }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "rejects non-existent snapshot ID with a DB error (FK constraint)",
    () =>
      Effect.gen(function* () {
        const diagramOps = yield* DiagramOperationsService;
        const { clip } = yield* createVideoWithClip;

        const result = yield* diagramOps
          .updateClipDiagramPin(clip.id, "nonexistent-snapshot-id")
          .pipe(Effect.flip);
        expect(result._tag).toBe("UnknownDBServiceError");
      }).pipe(Effect.provide(testLayer))
  );
});

describe("createSnapshotForClip", () => {
  const scene = {
    store: { "shape:abc": { id: "abc", x: 10 } },
    schema: { schemaVersion: 2 },
  };

  const createVideoWithClipForSnap = Effect.gen(function* () {
    const videoOps = yield* VideoOperationsService;
    const clipOps = yield* ClipOperationsService;
    const video = yield* videoOps.createStandaloneVideo({
      path: "test-video.mp4",
    });
    const clips = yield* clipOps.appendClips({
      videoId: video.id,
      insertionPoint: { type: "start" },
      clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
    });
    return { video, clip: clips[0]! };
  });

  it.effect("inserts a snapshot row and pins the clip", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const clipOps = yield* ClipOperationsService;
      const { clip } = yield* createVideoWithClipForSnap;
      const diagram = yield* diagramOps.createDiagram();
      yield* diagramOps.updateDiagramHead(diagram.id, scene);

      const snapshot = yield* diagramOps.createSnapshotForClip(
        diagram.id,
        clip.id
      );

      expect(snapshot.id).toEqual(expect.any(String));
      expect(snapshot.diagramId).toBe(diagram.id);
      expect(snapshot.scene).toEqual(scene);
      expect(snapshot.preserved).toBe(false);

      const pinnedClip = yield* clipOps.getClipById(clip.id);
      expect(pinnedClip.diagramSnapshotId).toBe(snapshot.id);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "deduplicates — reuses existing snapshot and re-pins the clip",
    () =>
      Effect.gen(function* () {
        const diagramOps = yield* DiagramOperationsService;
        const clipOps = yield* ClipOperationsService;
        const diagram = yield* diagramOps.createDiagram();
        yield* diagramOps.updateDiagramHead(diagram.id, scene);

        const { clip: clip1 } = yield* createVideoWithClipForSnap;
        const snap1 = yield* diagramOps.createSnapshotForClip(
          diagram.id,
          clip1.id
        );

        const { clip: clip2 } = yield* createVideoWithClipForSnap;
        const snap2 = yield* diagramOps.createSnapshotForClip(
          diagram.id,
          clip2.id
        );

        expect(snap2.id).toBe(snap1.id);

        const pinnedClip2 = yield* clipOps.getClipById(clip2.id);
        expect(pinnedClip2.diagramSnapshotId).toBe(snap1.id);
      }).pipe(Effect.provide(testLayer))
  );

  it.effect("does not flip preserved:true to false on dedup auto-pin", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const clipOps = yield* ClipOperationsService;
      const diagram = yield* diagramOps.createDiagram();
      yield* diagramOps.updateDiagramHead(diagram.id, scene);

      yield* diagramOps.createSnapshot(diagram.id, { preserved: true });

      const { clip } = yield* createVideoWithClipForSnap;
      const snapshot = yield* diagramOps.createSnapshotForClip(
        diagram.id,
        clip.id
      );

      expect(snapshot.preserved).toBe(true);

      const pinnedClip = yield* clipOps.getClipById(clip.id);
      expect(pinnedClip.diagramSnapshotId).toBe(snapshot.id);
    }).pipe(Effect.provide(testLayer))
  );
});
