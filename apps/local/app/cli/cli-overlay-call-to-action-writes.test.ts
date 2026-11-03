import { describe, it, expect, beforeAll, beforeEach } from "vitest";
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
// cvm overlay: the Call to Action (#2601)
//
// The same seam as cli-overlay-chat-card-writes.test.ts: the full CLI stack
// over a real PGlite.
// ===========================================================================

let testDb: TestDb;
let seedLayer: Layer.Layer<ClipOperationsService>;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;
let s: WriteSeed;
/** A Short with one 10s Clip. */
let short: { videoId: string; clipId: string };

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  seedLayer = ClipOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as never))
  );
  run = makeRun(buildWriteLayer(testDb));
});

const seedClip = (videoId: string) =>
  Effect.gen(function* () {
    const clipOps = yield* ClipOperationsService;
    const [clip] = yield* clipOps.appendClips({
      videoId,
      insertionPoint: { type: "start" },
      clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
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
  const clip = await seedClip(video!.id);
  short = { videoId: video!.id, clipId: clip.id };
});

const addCallToAction = (extra: string[] = [], clip = "") =>
  run([
    "overlay",
    "add",
    "--clip",
    clip || short.clipId,
    "--at",
    "0",
    "--duration",
    "5",
    "--kind",
    "callToAction",
    ...extra,
  ]);

describe("a Call to Action", () => {
  it("defaults to the old AI Hero card's words", async () => {
    const result = await addCallToAction();

    expect(result.exitCode).toBe(0);
    expect(one(result.stdout)).toMatchObject({
      kind: "callToAction",
      title: "AIhero.dev",
      description: "Go from Zero To AI Hero",
      bullets: null,
      chatSpin: null,
    });
  });

  it.each<[string, string[], { title: string; description: string }]>([
    [
      "both lines",
      ["--title", "example.com", "--description", "A fake subline"],
      { title: "example.com", description: "A fake subline" },
    ],
    [
      "a headline only",
      ["--title", "example.com"],
      { title: "example.com", description: "" },
    ],
    [
      "a subline only",
      ["--description", "A fake subline"],
      { title: "", description: "A fake subline" },
    ],
  ])("stores %s as given", async (_, extra, words) => {
    const result = await addCallToAction(extra);

    expect(result.exitCode).toBe(0);
    expect(one(result.stdout)).toMatchObject(words);
  });

  it("is refused on a Video that isn't a Short", async () => {
    const landscape = await seedClip(s.standaloneActiveId);

    const { exitCode, stderr } = await addCallToAction([], landscape.id);

    expect(exitCode).toBe(3);
    expect(stderr).toContain("is not a Short");
  });

  it.each<[string, string[]]>([
    ["bullets", ["--bullets-json", "-"]],
    ["a Chat Highlight", ["--chat-highlight", "h"]],
    ["--no-chat-spin", ["--no-chat-spin"]],
  ])("is refused with %s", async (_, extra) => {
    const { exitCode, stdout } = await addCallToAction(extra);

    expect(exitCode).toBe(3);
    expect(stdout).toBe("");
  });

  it("has its words, timing and Animation Toggles edited by update", async () => {
    const card = one<{ id: string }>((await addCallToAction()).stdout);

    const result = await run([
      "overlay",
      "update",
      "--title",
      "example.com",
      "--description",
      "A fake subline",
      "--at",
      "4",
      "--duration",
      "3",
      "--disable-enter-animation",
      "true",
      "--disable-exit-animation",
      "true",
      card.id,
    ]);

    expect(result.exitCode).toBe(0);
    expect(one(result.stdout)).toMatchObject({
      kind: "callToAction",
      title: "example.com",
      description: "A fake subline",
      at: 4,
      durationInSeconds: 3,
      disableEnterAnimation: true,
      disableExitAnimation: true,
    });
  });

  it("cannot be turned into another Kind, or another Kind into one", async () => {
    const card = one<{ id: string }>((await addCallToAction()).stdout);
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
    const definition = one<{ id: string }>(
      (
        await run([
          "overlay",
          "add",
          "--clip",
          short.clipId,
          "--at",
          "6",
          "--duration",
          "2",
          "--title",
          "t",
          "--description",
          "d",
        ])
      ).stdout
    );
    const made = await run([
      "overlay",
      "update",
      "--kind",
      "callToAction",
      definition.id,
    ]);

    expect([unmade.exitCode, made.exitCode]).toEqual([3, 3]);
    expect(made.stderr).toContain("callToAction");
  });
});
