import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { BeatOperationsService } from "./db-beat-operations.server.js";
import { DrizzleService } from "./drizzle-service.server.js";
import {
  beats,
  courses,
  courseVersions,
  lessons,
  sections,
  videos,
} from "../db/schema.js";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "../test-utils/pglite.js";

let testDb: TestDb;
let testLayer: Layer.Layer<BeatOperationsService>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  testLayer = BeatOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as any))
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

describe("listBeatsByScope", () => {
  it.effect(
    "lists a section's active beats in lesson, video title, then beat order",
    () =>
      Effect.gen(function* () {
        const [course] = yield* Effect.promise(() =>
          testDb.insert(courses).values({ name: "course" }).returning()
        );
        const [version] = yield* Effect.promise(() =>
          testDb
            .insert(courseVersions)
            .values({ repoId: course!.id, name: "v1" })
            .returning()
        );
        yield* Effect.promise(() =>
          testDb.insert(sections).values([
            { id: "section-early", repoVersionId: version!.id, order: 1 },
            { id: "section-late", repoVersionId: version!.id, order: 2 },
          ])
        );
        yield* Effect.promise(() =>
          testDb.insert(lessons).values([
            { id: "lesson-early", sectionId: "section-early", order: 1 },
            { id: "lesson-late", sectionId: "section-early", order: 2 },
            { id: "lesson-other", sectionId: "section-late", order: 1 },
          ])
        );
        yield* Effect.promise(() =>
          testDb.insert(videos).values([
            {
              id: "video-z",
              lessonId: "lesson-early",
              title: "z.mp4",
              originalFootagePath: "/z",
            },
            {
              id: "video-a",
              lessonId: "lesson-early",
              title: "a.mp4",
              originalFootagePath: "/a",
            },
            {
              id: "video-late",
              lessonId: "lesson-late",
              title: "late.mp4",
              originalFootagePath: "/late",
            },
            {
              id: "video-archived",
              lessonId: "lesson-late",
              title: "archived.mp4",
              originalFootagePath: "/archived",
              archived: true,
            },
            {
              id: "video-other",
              lessonId: "lesson-other",
              title: "other.mp4",
              originalFootagePath: "/other",
            },
          ])
        );
        yield* Effect.promise(() =>
          testDb.insert(beats).values([
            { id: "beat-z", videoId: "video-z", order: "0001" },
            { id: "beat-a-second", videoId: "video-a", order: "0002" },
            { id: "beat-a-first", videoId: "video-a", order: "0001" },
            { id: "beat-late", videoId: "video-late", order: "0001" },
            {
              id: "beat-archived-video",
              videoId: "video-archived",
              order: "0001",
            },
            {
              id: "beat-archived",
              videoId: "video-late",
              order: "0002",
              archived: true,
            },
            { id: "beat-other", videoId: "video-other", order: "0001" },
          ])
        );
        const svc = yield* BeatOperationsService;

        const listed = yield* svc.listBeatsByScope({
          sectionId: "section-early",
        });

        expect(listed.map((beat) => beat.id)).toEqual([
          "beat-a-first",
          "beat-a-second",
          "beat-z",
          "beat-late",
        ]);
      }).pipe(Effect.provide(testLayer))
  );
});
