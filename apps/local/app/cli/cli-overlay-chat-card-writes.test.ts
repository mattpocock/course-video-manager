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
  one,
  seedWrite,
  type RunResult,
  type WriteSeed,
} from "./cli-write-test-harness";

// ===========================================================================
// cvm overlay: the Chat Card (#2556)
//
// The same seam as cli-overlay-kind-writes.test.ts — the full CLI stack over a
// real PGlite — in its own file only because that one is near the repo's
// per-file token budget. All chat here is fake.
// ===========================================================================

let testDb: TestDb;
let seedLayer: Layer.Layer<ClipOperationsService>;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;
let s: WriteSeed;

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

/** A Short, a Streamed Recording Session with three fake Chat Highlights,
 * and a Clip of it running from file time 4s to 14s. */
let short: { videoId: string; clipId: string; highlightIds: string[] };

const seedClip = (videoId: string, start = 4, end = 14) =>
  Effect.gen(function* () {
    const clipOps = yield* ClipOperationsService;
    const [clip] = yield* clipOps.appendClips({
      videoId,
      insertionPoint: { type: "start" },
      clips: [{ inputVideo: "test.mp4", startTime: start, endTime: end }],
    });
    return clip!;
  }).pipe(Effect.provide(seedLayer), Effect.runPromise);

beforeEach(async () => {
  await truncateAllTables(testDb);
  s = await seedWrite(testDb);
  const [video] = await testDb
    .insert(schema.videos)
    .values({ title: "short", originalFootagePath: "", format: "short" })
    .returning();
  const [session] = await testDb
    .insert(schema.recordingSessions)
    .values({
      videoId: video!.id,
      cameraFilePath: "c.mkv",
      screenFilePath: "s.mkv",
      micFilePath: "m.mkv",
      startedAt: new Date(T0),
    })
    .returning();
  const clip = await seedClip(video!.id);
  await testDb
    .update(schema.clips)
    .set({ recordingSessionId: session!.id })
    .where(eq(schema.clips.id, clip.id));
  const highlights = await testDb
    .insert(schema.chatHighlights)
    .values(
      (
        [
          [1000, 3000],
          [5000, 8000],
          [9000, null],
        ] as const
      ).map(([shown, hidden], i) => ({
        videoId: video!.id,
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
  short = {
    videoId: video!.id,
    clipId: clip.id,
    highlightIds: highlights.map((h) => h.id),
  };
});

const addChatCard = (extra: string[] = [], { clip = "", at = "2" } = {}) =>
  run([
    "overlay",
    "add",
    "--clip",
    clip || short.clipId,
    "--at",
    at,
    "--duration",
    "5",
    "--kind",
    "chatCard",
    ...extra,
  ]);

const cell = (n: number) => ({
  author: `@fake_viewer_${n}`,
  text: `Fake question ${n}`,
});

describe("a Chat Card", () => {
  it("defaults to the Chat Highlight at the anchor point, with its spin on", async () => {
    // --at 2 on a Clip from file time 4s: 6s in, while the second shows.
    const result = await addChatCard();

    expect(result.exitCode).toBe(0);
    expect(one(result.stdout)).toMatchObject({
      kind: "chatCard",
      title: "@fake_viewer_2",
      description: "Fake question 2",
      chatSpin: [cell(1), cell(3)],
    });
  });

  it("takes --chat-highlight and --no-chat-spin", async () => {
    const result = await addChatCard([
      "--chat-highlight",
      short.highlightIds[0]!,
      "--no-chat-spin",
    ]);

    expect(result.exitCode).toBe(0);
    expect(one(result.stdout)).toMatchObject({
      title: "@fake_viewer_1",
      description: "Fake question 1",
      chatSpin: [],
    });
  });

  it("with no default, is refused naming the session's Chat Highlights", async () => {
    // 0.5s in, on a Clip from file time 0: before the first was shown at 1s.
    const early = await seedClip(short.videoId, 0, 1);
    const [session] = await testDb.select().from(schema.recordingSessions);
    await testDb
      .update(schema.clips)
      .set({ recordingSessionId: session!.id })
      .where(eq(schema.clips.id, early.id));

    const { exitCode, stderr } = await addChatCard([], {
      clip: early.id,
      at: "0.5",
    });

    expect(exitCode).toBe(3);
    expect(stderr).toContain(`${short.highlightIds[0]} (1s, @fake_viewer_1)`);
  });

  it.each<[string, string[]]>([
    ["a title", ["--title", "t"]],
    ["a description", ["--description", "d"]],
    ["bullets", ["--bullets-json", "-"]],
    ["Footage", ["--footage", "raw-footage/imported/x.mp4", "--from", "1"]],
    ["an unknown Chat Highlight", ["--chat-highlight", "no-such-highlight"]],
  ])("is refused with %s", async (_, extra) => {
    const { exitCode, stdout } = await addChatCard(extra);

    expect(exitCode).toBe(3);
    expect(stdout).toBe("");
  });

  it("is refused on a Video that isn't a Short", async () => {
    const landscape = await seedClip(s.standaloneActiveId);

    const { exitCode, stderr } = await addChatCard([], { clip: landscape.id });

    expect(exitCode).toBe(3);
    expect(stderr).toContain("is not a Short");
  });

  it.each<[string, string[]]>([
    ["--chat-highlight", ["--chat-highlight", "h"]],
    ["--no-chat-spin", ["--no-chat-spin"]],
  ])("lends %s to no other kind", async (_, extra) => {
    const { exitCode, stderr } = await run([
      "overlay",
      "add",
      "--clip",
      short.clipId,
      "--at",
      "2",
      "--duration",
      "5",
      "--title",
      "t",
      "--description",
      "d",
      ...extra,
    ]);

    expect(exitCode).toBe(3);
    expect(stderr).toContain("are Chat Card flags");
  });

  it("cannot have its content edited, or be made by update", async () => {
    const card = one<{ id: string }>((await addChatCard()).stdout);
    const retitled = await run(["overlay", "update", "--title", "t", card.id]);
    const unmade = await run([
      "overlay",
      "update",
      "--kind",
      "definitionCard",
      "--title",
      "t",
      "--description",
      "d",
      card.id,
    ]);

    expect([retitled.exitCode, unmade.exitCode]).toEqual([3, 3]);
  });
});
