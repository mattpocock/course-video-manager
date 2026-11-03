import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { Effect, Layer } from "effect";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/test-db";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import * as schema from "@/db/schema";
import {
  buildWriteLayer,
  makeRun,
  ndjson,
  type RunResult,
} from "./cli-write-test-harness";

// ===========================================================================
// cvm chat-highlight list (#2664): a Streamed Recording Session's Chat
// Highlights, timed on its clock, so a Short can be cut and carded from them.
// The full CLI stack over a real database. All chat here is fake.
// ===========================================================================

let testDb: TestDb;
let seedLayer: Layer.Layer<ClipOperationsService>;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  seedLayer = ClipOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as never))
  );
  run = makeRun(buildWriteLayer(testDb));
});

/** T0 of the streamed Recording Session: file time 0, on the recorder's clock. */
const T0 = 1_000_000;

let seeded: { shortId: string; sessionId: string; highlightIds: string[] };

beforeEach(async () => {
  await truncateAllTables(testDb);
  const [stream] = await testDb
    .insert(schema.videos)
    .values({ title: "stream", originalFootagePath: "" })
    .returning();
  const [short] = await testDb
    .insert(schema.videos)
    .values({ title: "short", originalFootagePath: "", format: "short" })
    .returning();
  const [session] = await testDb
    .insert(schema.recordingSessions)
    .values({
      videoId: stream!.id,
      cameraFilePath: "c.mkv",
      screenFilePath: "s.mkv",
      micFilePath: "m.mkv",
      startedAt: new Date(T0),
    })
    .returning();
  // A Short cut from the stream: its Clip is of the stream's Recording Session.
  const [clip] = await Effect.gen(function* () {
    const clipOps = yield* ClipOperationsService;
    return yield* clipOps.appendClips({
      videoId: short!.id,
      insertionPoint: { type: "start" },
      clips: [{ inputVideo: "test.mp4", startTime: 4, endTime: 14 }],
    });
  }).pipe(Effect.provide(seedLayer), Effect.runPromise);
  await testDb
    .update(schema.clips)
    .set({ recordingSessionId: session!.id })
    .where(eq(schema.clips.id, clip!.id));
  const highlights = await testDb
    .insert(schema.chatHighlights)
    .values(
      (
        [
          [9000, null],
          [1500, 3000],
        ] as const
      ).map(([shown, hidden], i) => ({
        videoId: stream!.id,
        recordingSessionId: session!.id,
        broadcastId: "broadcast",
        messageId: `message-${i + 1}`,
        author: `@fake_viewer_${i + 1}`,
        text: `Fake question ${i + 1}`,
        shownAtMs: T0 + shown,
        hiddenAtMs: hidden === null ? null : T0 + hidden,
      }))
    )
    .returning();
  seeded = {
    shortId: short!.id,
    sessionId: session!.id,
    highlightIds: highlights.map((h) => h.id),
  };
});

/** What each list prints, in shown order: seconds on the session's clock. */
const expected = () => [
  {
    id: seeded.highlightIds[1],
    recordingSessionId: seeded.sessionId,
    shownAt: 1.5,
    hiddenAt: 3,
    author: "@fake_viewer_2",
    text: "Fake question 2",
  },
  {
    id: seeded.highlightIds[0],
    recordingSessionId: seeded.sessionId,
    shownAt: 9,
    hiddenAt: null,
    author: "@fake_viewer_1",
    text: "Fake question 1",
  },
];

describe("cvm chat-highlight list", () => {
  it("lists a Recording Session's Chat Highlights in shown order, timed on its clock", async () => {
    const result = await run([
      "chat-highlight",
      "list",
      "--recording-session",
      seeded.sessionId,
    ]);

    expect(result.exitCode).toBe(0);
    expect(ndjson(result.stdout)).toEqual(expected());
  });

  it("lists those of the Recording Sessions a Video's Clips come from", async () => {
    const result = await run([
      "chat-highlight",
      "list",
      "--video",
      seeded.shortId,
    ]);

    expect(result.exitCode).toBe(0);
    expect(ndjson(result.stdout)).toEqual(expected());
  });
});
