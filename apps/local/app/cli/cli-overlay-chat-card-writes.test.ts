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

describe("a Chat Card", () => {
  it("defaults to the Chat Highlight at the anchor point", async () => {
    // --at 2 on a Clip from file time 4s: 6s in, while the second shows.
    const result = await addChatCard();

    expect(result.exitCode).toBe(0);
    expect(one(result.stdout)).toMatchObject({
      kind: "chatCard",
      title: "@fake_viewer_2",
      description: "Fake question 2",
    });
  });

  it("takes --chat-highlight", async () => {
    const result = await addChatCard([
      "--chat-highlight",
      short.highlightIds[0]!,
    ]);

    expect(result.exitCode).toBe(0);
    expect(one(result.stdout)).toMatchObject({
      title: "@fake_viewer_1",
      description: "Fake question 1",
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

  it("is refused on a Video that isn't a Short, saying so over any overlap", async () => {
    const landscape = await seedClip(s.standaloneActiveId);
    const card = await run([
      "overlay",
      "add",
      "--clip",
      landscape.id,
      "--at",
      "0",
      "--duration",
      "5",
      "--title",
      "A fake term",
      "--description",
      "A fake definition",
    ]);
    expect(card.exitCode).toBe(0);

    const { exitCode, stderr } = await addChatCard([], { clip: landscape.id });

    expect(exitCode).toBe(3);
    expect(stderr).toContain("is not a Short");
  });

  it.each<[string, string[]]>([
    ["--chat-highlight", ["--chat-highlight", "h"]],
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
    expect(stderr).toContain("is a Chat Card flag");
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

// A Call to Action sits in the lower half and a Chat Card at the top, so the
// two may share the screen: the one exception to "one Overlay at a time" (#2602).
describe("a Chat Card beside a Call to Action", () => {
  const addCallToAction = ({ at = "2" } = {}) =>
    run([
      "overlay",
      "add",
      "--clip",
      short.clipId,
      "--at",
      at,
      "--duration",
      "5",
      "--kind",
      "callToAction",
    ]);
  const addDefinitionCard = ({ at = "2" } = {}) =>
    run([
      "overlay",
      "add",
      "--clip",
      short.clipId,
      "--at",
      at,
      "--duration",
      "5",
      "--title",
      "t",
      "--description",
      "d",
    ]);
  const moveTo = (id: string, at: string) =>
    run(["overlay", "update", "--at", at, id]);

  it("may overlap it, whichever is added first", async () => {
    // The Call to Action 0-5s, the Chat Card 2-7s, a second Call to Action 5-10s.
    const results = [
      await addCallToAction({ at: "0" }),
      await addChatCard(),
      await addCallToAction({ at: "5" }),
    ];

    expect(results.map((r) => [r.exitCode, r.stderr])).toEqual([
      [0, ""],
      [0, ""],
      [0, ""],
    ]);
  });

  it("may be moved onto it, either one onto the other", async () => {
    const card = one<{ id: string }>((await addChatCard()).stdout);
    const call = one<{ id: string }>(
      (await addCallToAction({ at: "7" })).stdout
    );

    const callMoved = await moveTo(call.id, "3");
    const cardMoved = await moveTo(card.id, "4");

    expect([callMoved.exitCode, cardMoved.exitCode]).toEqual([0, 0]);
  });

  it.each<[string, () => Promise<RunResult>, () => Promise<RunResult>]>([
    [
      "two Calls to Action",
      () => addCallToAction(),
      () => addCallToAction({ at: "4" }),
    ],
    [
      "two Chat Cards",
      () => addChatCard(),
      () =>
        addChatCard(["--chat-highlight", short.highlightIds[0]!], {
          at: "4",
        }),
    ],
    [
      "a Call to Action over a Definition Card",
      () => addDefinitionCard(),
      () => addCallToAction({ at: "4" }),
    ],
    [
      "a Definition Card over a Call to Action",
      () => addCallToAction(),
      () => addDefinitionCard({ at: "4" }),
    ],
  ])("still refuses %s overlapping", async (_, first, second) => {
    expect((await first()).exitCode).toBe(0);

    const { exitCode, stderr } = await second();

    expect(exitCode).toBe(3);
    expect(stderr).toContain("At most one Overlay");
  });

  it("still refuses a Call to Action moved onto another", async () => {
    await addCallToAction({ at: "0" });
    const mover = one<{ id: string }>(
      (await addCallToAction({ at: "6" })).stdout
    );

    const { exitCode } = await moveTo(mover.id, "3");

    expect(exitCode).toBe(3);
  });
});
