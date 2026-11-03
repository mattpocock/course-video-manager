import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/test-db";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import {
  buildWriteLayer,
  makeRun,
  ndjson,
  seedWrite,
  type RunResult,
  type WriteSeed,
} from "./cli-write-test-harness";

// ===========================================================================
// `cvm clip split` over the real stack (#2670). What each side keeps is
// pinned in packages/core (clip-split.test.ts, db-clip-split.test.ts); this
// proves the verb reads `--at` both ways and refuses a bad cut with exit 3.
// ===========================================================================

let testDb: TestDb;
let seedLayer: Layer.Layer<ClipOperationsService>;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;
let s: WriteSeed;

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
  seedLayer = ClipOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as never))
  );
  run = makeRun(buildWriteLayer(testDb));
});

beforeEach(async () => {
  await truncateAllTables(testDb);
  s = await seedWrite(testDb);
});

interface ClipRow {
  id: string;
  sourceStartTime: number;
  sourceEndTime: number;
  text: string;
}

/** A clip cut 10s -> 20s out of its source, saying "the quick brown fox". */
const seedTranscribedClip = () =>
  Effect.gen(function* () {
    const clipOps = yield* ClipOperationsService;
    const [clip] = yield* clipOps.appendClips({
      videoId: s.standaloneActiveId,
      insertionPoint: { type: "start" },
      clips: [{ inputVideo: "test.mp4", startTime: 10, endTime: 20 }],
    });
    yield* clipOps.updateClip(clip!.id, { text: "the quick brown fox" });
    yield* clipOps.replaceTranscriptWords(clip!.id, [
      { start: 0.5, end: 1.5, text: "the" },
      { start: 2, end: 3, text: "quick" },
      { start: 5, end: 6, text: "brown" },
      { start: 8.5, end: 9.5, text: "fox" },
    ]);
    return clip!;
  }).pipe(Effect.provide(seedLayer), Effect.runPromise);

const split = (clipId: string, at: string) =>
  run(["clip", "split", "--at", at, clipId]);

describe("clip split", () => {
  it("splits at a moment on the source clock, snapped to a word edge, and prints both Clips", async () => {
    const clip = await seedTranscribedClip();

    const result = await split(clip.id, "15.3");

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    const [left, right] = ndjson(result.stdout) as ClipRow[];
    expect(left).toMatchObject({
      id: clip.id,
      sourceStartTime: 10,
      sourceEndTime: 15,
      text: "the quick",
    });
    expect(right).toMatchObject({
      sourceStartTime: 15,
      sourceEndTime: 20,
      text: "brown fox",
    });
  });

  it("splits before a word given as word:<n>", async () => {
    const clip = await seedTranscribedClip();

    const result = await split(clip.id, "word:3");

    expect(result.exitCode).toBe(0);
    const [left, right] = ndjson(result.stdout) as ClipRow[];
    expect(left!.text).toBe("the quick brown");
    expect(right).toMatchObject({ sourceStartTime: 17.25, text: "fox" });
  });

  it("refuses a cut outside the clip with exit 3", async () => {
    const clip = await seedTranscribedClip();

    const result = await split(clip.id, "25");

    expect(result.exitCode).toBe(3);
  });
});
