import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { eq } from "drizzle-orm";
import { PitchOperationsService } from "@/services/db-pitch-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import * as schema from "@/db/schema";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";

let testDb: TestDb;
let testLayer: Layer.Layer<PitchOperationsService>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;

  testLayer = PitchOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as any))
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

describe("createPitch", () => {
  it.effect("creates a pitch with default values", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;
      const pitch = yield* pitchOps.createPitch();

      expect(pitch.id).toEqual(expect.any(String));
      expect(pitch.title).toBe("");
      expect(pitch.description).toBe("");
      expect(pitch.contentPlan).toBe("");
      expect(pitch.youtubeTitle).toBe("");
      expect(pitch.youtubeThumbnailDescription).toBe("");
      expect(pitch.newsletterTitle).toBe("");
      expect(pitch.tweet).toBe("");
      expect(pitch.status).toBe("idle");
      expect(pitch.priority).toBe(2);
      expect(pitch.archived).toBe(false);
      expect(pitch.createdAt).toBeInstanceOf(Date);
      expect(pitch.updatedAt).toBeInstanceOf(Date);
    }).pipe(Effect.provide(testLayer))
  );
});

describe("listPitches", () => {
  it.effect(
    "returns all non-archived pitches sorted by priority asc then createdAt desc",
    () =>
      Effect.gen(function* () {
        const pitchOps = yield* PitchOperationsService;

        const p1 = yield* pitchOps.createPitch();
        yield* pitchOps.updatePitchField(p1.id, "title", "First");

        const p2 = yield* pitchOps.createPitch();
        yield* pitchOps.updatePitchField(p2.id, "title", "Second");

        const p3 = yield* pitchOps.createPitch();
        yield* pitchOps.updatePitchField(p3.id, "title", "Archived");
        yield* pitchOps.updatePitchField(p3.id, "archived", true);

        const list = yield* pitchOps.listPitches();

        expect(list).toHaveLength(2);
        expect(list[0]!.title).toBe("Second");
        expect(list[1]!.title).toBe("First");
      }).pipe(Effect.provide(testLayer))
  );

  it.effect("returns empty array when no pitches exist", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;
      const list = yield* pitchOps.listPitches();
      expect(list).toEqual([]);
    }).pipe(Effect.provide(testLayer))
  );
});

describe("getPitch", () => {
  it.effect("returns a pitch by id", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;
      const created = yield* pitchOps.createPitch();
      const fetched = yield* pitchOps.getPitch(created.id);

      expect(fetched.id).toBe(created.id);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("fails with NotFoundError for missing id", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;
      const result = yield* pitchOps
        .getPitch("nonexistent-id")
        .pipe(Effect.flip);

      expect(result._tag).toBe("NotFoundError");
    }).pipe(Effect.provide(testLayer))
  );
});

describe("updatePitchField", () => {
  it.effect("updates only the named field and bumps updatedAt", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;
      const created = yield* pitchOps.createPitch();
      const originalUpdatedAt = created.updatedAt;

      const updated = yield* pitchOps.updatePitchField(
        created.id,
        "title",
        "New Title"
      );

      expect(updated.title).toBe("New Title");
      expect(updated.description).toBe("");
      expect(updated.status).toBe("idle");
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(
        originalUpdatedAt.getTime()
      );
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("updates priority as a number", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;
      const created = yield* pitchOps.createPitch();
      const updated = yield* pitchOps.updatePitchField(
        created.id,
        "priority",
        1
      );

      expect(updated.priority).toBe(1);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("fails with NotFoundError for non-existent pitch", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;
      const result = yield* pitchOps
        .updatePitchField("nonexistent-id", "title", "Nope")
        .pipe(Effect.flip);
      expect(result._tag).toBe("NotFoundError");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("updates status field", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;
      const created = yield* pitchOps.createPitch();

      const updated = yield* pitchOps.updatePitchField(
        created.id,
        "status",
        "scheduled"
      );
      expect(updated.status).toBe("scheduled");

      const updated2 = yield* pitchOps.updatePitchField(
        created.id,
        "status",
        "cancelled"
      );
      expect(updated2.status).toBe("cancelled");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("updating one field does not clobber another", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;
      const created = yield* pitchOps.createPitch();

      yield* pitchOps.updatePitchField(created.id, "title", "My Pitch");
      yield* pitchOps.updatePitchField(
        created.id,
        "description",
        "A description"
      );
      yield* pitchOps.updatePitchField(created.id, "youtubeTitle", "YT Title");

      const fetched = yield* pitchOps.getPitch(created.id);
      expect(fetched.title).toBe("My Pitch");
      expect(fetched.description).toBe("A description");
      expect(fetched.youtubeTitle).toBe("YT Title");
    }).pipe(Effect.provide(testLayer))
  );
});

describe("listPitches with filters", () => {
  it.effect("filters by status", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;

      const p1 = yield* pitchOps.createPitch();
      yield* pitchOps.updatePitchField(p1.id, "title", "Idle one");

      const p2 = yield* pitchOps.createPitch();
      yield* pitchOps.updatePitchField(p2.id, "title", "Scheduled one");
      yield* pitchOps.updatePitchField(p2.id, "status", "scheduled");

      const p3 = yield* pitchOps.createPitch();
      yield* pitchOps.updatePitchField(p3.id, "title", "Cancelled one");
      yield* pitchOps.updatePitchField(p3.id, "status", "cancelled");

      const idleOnly = yield* pitchOps.listPitches({ status: ["idle"] });
      expect(idleOnly).toHaveLength(1);
      expect(idleOnly[0]!.title).toBe("Idle one");

      const multiStatus = yield* pitchOps.listPitches({
        status: ["idle", "scheduled"],
      });
      expect(multiStatus).toHaveLength(2);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("filters by priority", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;

      const p1 = yield* pitchOps.createPitch();
      yield* pitchOps.updatePitchField(p1.id, "priority", 1);

      const p2 = yield* pitchOps.createPitch();
      yield* pitchOps.updatePitchField(p2.id, "priority", 2);

      const p3 = yield* pitchOps.createPitch();
      yield* pitchOps.updatePitchField(p3.id, "priority", 3);

      const highOnly = yield* pitchOps.listPitches({ priority: [1] });
      expect(highOnly).toHaveLength(1);

      const highAndMed = yield* pitchOps.listPitches({ priority: [1, 2] });
      expect(highAndMed).toHaveLength(2);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("filters by archived flag", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;

      yield* pitchOps.createPitch();
      const p2 = yield* pitchOps.createPitch();
      yield* pitchOps.updatePitchField(p2.id, "archived", true);

      const nonArchived = yield* pitchOps.listPitches({ archived: false });
      expect(nonArchived).toHaveLength(1);

      const archivedOnly = yield* pitchOps.listPitches({ archived: true });
      expect(archivedOnly).toHaveLength(1);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("sorts by priority asc then createdAt desc", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;

      const p1 = yield* pitchOps.createPitch();
      yield* pitchOps.updatePitchField(p1.id, "title", "P2 older");
      yield* pitchOps.updatePitchField(p1.id, "priority", 2);

      const p2 = yield* pitchOps.createPitch();
      yield* pitchOps.updatePitchField(p2.id, "title", "P1");
      yield* pitchOps.updatePitchField(p2.id, "priority", 1);

      const p3 = yield* pitchOps.createPitch();
      yield* pitchOps.updatePitchField(p3.id, "title", "P2 newer");
      yield* pitchOps.updatePitchField(p3.id, "priority", 2);

      const list = yield* pitchOps.listPitches();
      expect(list[0]!.title).toBe("P1");
      expect(list[1]!.title).toBe("P2 newer");
      expect(list[2]!.title).toBe("P2 older");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("combines status and priority filters", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;

      const p1 = yield* pitchOps.createPitch();
      yield* pitchOps.updatePitchField(p1.id, "priority", 1);

      const p2 = yield* pitchOps.createPitch();
      yield* pitchOps.updatePitchField(p2.id, "priority", 2);
      yield* pitchOps.updatePitchField(p2.id, "status", "scheduled");

      const p3 = yield* pitchOps.createPitch();
      yield* pitchOps.updatePitchField(p3.id, "priority", 1);
      yield* pitchOps.updatePitchField(p3.id, "status", "scheduled");

      const result = yield* pitchOps.listPitches({
        status: ["scheduled"],
        priority: [1],
      });
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe(p3.id);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "returns all non-archived when called with no filters (backward compat)",
    () =>
      Effect.gen(function* () {
        const pitchOps = yield* PitchOperationsService;

        yield* pitchOps.createPitch();
        yield* pitchOps.createPitch();
        const p3 = yield* pitchOps.createPitch();
        yield* pitchOps.updatePitchField(p3.id, "archived", true);

        const list = yield* pitchOps.listPitches();
        expect(list).toHaveLength(2);
      }).pipe(Effect.provide(testLayer))
  );

  it.effect("treats empty status array as no status filter", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;

      yield* pitchOps.createPitch();
      const p2 = yield* pitchOps.createPitch();
      yield* pitchOps.updatePitchField(p2.id, "status", "scheduled");

      const list = yield* pitchOps.listPitches({ status: [] });
      expect(list).toHaveLength(2);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("treats empty priority array as no priority filter", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;

      const p1 = yield* pitchOps.createPitch();
      yield* pitchOps.updatePitchField(p1.id, "priority", 1);
      const p2 = yield* pitchOps.createPitch();
      yield* pitchOps.updatePitchField(p2.id, "priority", 3);

      const list = yield* pitchOps.listPitches({ priority: [] });
      expect(list).toHaveLength(2);
    }).pipe(Effect.provide(testLayer))
  );
});

describe("deletePitch", () => {
  it.effect("removes the pitch row", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;
      const created = yield* pitchOps.createPitch();
      yield* pitchOps.deletePitch(created.id);

      const result = yield* pitchOps.getPitch(created.id).pipe(Effect.flip);
      expect(result._tag).toBe("NotFoundError");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("does not error when deleting a non-existent pitch", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;
      yield* pitchOps.deletePitch("nonexistent-id");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("sets pitchId to NULL on linked videos", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;
      const pitch = yield* pitchOps.createPitch();
      const [video] = yield* Effect.promise(() =>
        testDb
          .insert(schema.videos)
          .values({ path: "test-vid", originalFootagePath: "" })
          .returning()
      );

      yield* Effect.promise(() =>
        testDb
          .update(schema.videos)
          .set({ pitchId: pitch.id })
          .where(eq(schema.videos.id, video!.id))
      );

      yield* pitchOps.deletePitch(pitch.id);

      const updatedVideo = yield* Effect.promise(() =>
        testDb.query.videos.findFirst({
          where: eq(schema.videos.id, video!.id),
        })
      );
      expect(updatedVideo!.pitchId).toBeNull();
    }).pipe(Effect.provide(testLayer))
  );
});

describe("listPitchesWithVideos", () => {
  it.effect("returns pitches with their linked videos", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;

      const pitch = yield* pitchOps.createPitch();
      yield* pitchOps.updatePitchField(pitch.id, "title", "Has videos");
      const video = yield* pitchOps.createVideoFromPitch(pitch.id);

      const list = yield* pitchOps.listPitchesWithVideos({ status: ["idle"] });
      expect(list).toHaveLength(1);
      expect(list[0]!.videos).toHaveLength(1);
      expect(list[0]!.videos[0]!.id).toBe(video.id);
      expect(list[0]!.videos[0]!.pitchId).toBe(pitch.id);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "returns pitches with empty videos array when no videos linked",
    () =>
      Effect.gen(function* () {
        const pitchOps = yield* PitchOperationsService;

        yield* pitchOps.createPitch();

        const list = yield* pitchOps.listPitchesWithVideos({
          status: ["idle"],
        });
        expect(list).toHaveLength(1);
        expect(list[0]!.videos).toHaveLength(0);
      }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "includes clips relation for computing first frame thumbnails",
    () =>
      Effect.gen(function* () {
        const pitchOps = yield* PitchOperationsService;

        const pitch = yield* pitchOps.createPitch();
        yield* pitchOps.createVideoFromPitch(pitch.id);

        const list = yield* pitchOps.listPitchesWithVideos({
          status: ["idle"],
        });
        expect(list[0]!.videos[0]!.clips).toEqual([]);
      }).pipe(Effect.provide(testLayer))
  );

  it.effect("excludes archived videos from results", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;

      const pitch = yield* pitchOps.createPitch();
      const video1 = yield* pitchOps.createVideoFromPitch(pitch.id);
      yield* pitchOps.createVideoFromPitch(pitch.id);
      yield* Effect.promise(() =>
        testDb
          .update(schema.videos)
          .set({ archived: true })
          .where(eq(schema.videos.id, video1.id))
      );

      const list = yield* pitchOps.listPitchesWithVideos({ status: ["idle"] });
      expect(list).toHaveLength(1);
      expect(list[0]!.videos).toHaveLength(1);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("returns multiple videos per pitch", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;

      const pitch = yield* pitchOps.createPitch();
      yield* pitchOps.createVideoFromPitch(pitch.id);
      yield* pitchOps.createVideoFromPitch(pitch.id);
      yield* pitchOps.createVideoFromPitch(pitch.id);

      const list = yield* pitchOps.listPitchesWithVideos({ status: ["idle"] });
      expect(list).toHaveLength(1);
      expect(list[0]!.videos).toHaveLength(3);
    }).pipe(Effect.provide(testLayer))
  );
});

describe("getPitchWithVideos", () => {
  it.effect("returns a pitch with its linked videos and clips", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;

      const pitch = yield* pitchOps.createPitch();
      const video = yield* pitchOps.createVideoFromPitch(pitch.id);

      const result = yield* pitchOps.getPitchWithVideos(pitch.id);
      expect(result.id).toBe(pitch.id);
      expect(result.videos).toHaveLength(1);
      expect(result.videos[0]!.id).toBe(video.id);
      expect(result.videos[0]!.clips).toEqual([]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("fails with NotFoundError for non-existent pitch", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;
      const result = yield* pitchOps
        .getPitchWithVideos("nonexistent-id")
        .pipe(Effect.flip);
      expect(result._tag).toBe("NotFoundError");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("excludes archived videos", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;

      const pitch = yield* pitchOps.createPitch();
      const video = yield* pitchOps.createVideoFromPitch(pitch.id);
      yield* Effect.promise(() =>
        testDb
          .update(schema.videos)
          .set({ archived: true })
          .where(eq(schema.videos.id, video.id))
      );

      const result = yield* pitchOps.getPitchWithVideos(pitch.id);
      expect(result.videos).toHaveLength(0);
    }).pipe(Effect.provide(testLayer))
  );
});

describe("createVideoFromPitch", () => {
  it.effect("creates a standalone video with pitchId set", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;
      const pitch = yield* pitchOps.createPitch();
      const video = yield* pitchOps.createVideoFromPitch(pitch.id);

      expect(video.id).toEqual(expect.any(String));
      expect(video.pitchId).toBe(pitch.id);
      expect(video.lessonId).toBeNull();
      expect(video.path).toBe("");
      expect(video.originalFootagePath).toBe("");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("creates a video with no clips", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;
      const pitch = yield* pitchOps.createPitch();
      const video = yield* pitchOps.createVideoFromPitch(pitch.id);

      const videoClips = yield* Effect.promise(() =>
        testDb.query.clips.findMany({
          where: eq(schema.clips.videoId, video.id),
        })
      );
      expect(videoClips).toHaveLength(0);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("fails with NotFoundError for non-existent pitch", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;
      const result = yield* pitchOps
        .createVideoFromPitch("nonexistent-pitch-id")
        .pipe(Effect.flip);
      expect(result._tag).toBe("NotFoundError");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("allows multiple videos from the same pitch", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;
      const pitch = yield* pitchOps.createPitch();

      const v1 = yield* pitchOps.createVideoFromPitch(pitch.id);
      const v2 = yield* pitchOps.createVideoFromPitch(pitch.id);

      expect(v1.id).not.toBe(v2.id);
      expect(v1.pitchId).toBe(pitch.id);
      expect(v2.pitchId).toBe(pitch.id);
    }).pipe(Effect.provide(testLayer))
  );
});
