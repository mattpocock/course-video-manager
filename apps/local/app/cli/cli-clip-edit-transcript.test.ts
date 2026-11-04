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
  one,
  seedWrite,
  type RunResult,
  type WriteSeed,
} from "./cli-write-test-harness";

// ===========================================================================
// `cvm clip edit-transcript`: fix a misheard word in a Clip's text, the way
// the editor's Edit Transcript does (#2666). The Clip's Transcript Words are
// rewritten with it, keeping their timings, so a Short's captions change too.
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

let s: WriteSeed;
beforeEach(async () => {
  await truncateAllTables(testDb);
  s = await seedWrite(testDb);
});

interface WordRow {
  start: number;
  end: number;
  text: string;
}

const MISHEARD: WordRow[] = [
  { start: 0, end: 0.4, text: "Ask" },
  { start: 0.4, end: 0.9, text: "Andrea" },
  { start: 0.9, end: 1.6, text: "Karpathy." },
];

/** A transcribed clip: text and words, as a Transcription leaves them. */
const seedTranscribedClip = (text: string, words: WordRow[]) =>
  Effect.gen(function* () {
    const clipOps = yield* ClipOperationsService;
    const [clip] = yield* clipOps.appendClips({
      videoId: s.standaloneActiveId,
      insertionPoint: { type: "start" },
      clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 5 }],
    });
    yield* clipOps.updateClip(clip!.id, { text });
    yield* clipOps.replaceTranscriptWords(clip!.id, words);
    return clip!.id;
  }).pipe(Effect.provide(seedLayer), Effect.runPromise);

const words = async (clipId: string) =>
  ndjson((await run(["clip", "words", clipId])).stdout) as WordRow[];

describe("clip edit-transcript", () => {
  it("corrects the Clip's text and its Transcript Words, keeping their timings", async () => {
    const id = await seedTranscribedClip("Ask Andrea Karpathy.", MISHEARD);

    const result = await run([
      "clip",
      "edit-transcript",
      "--find",
      "Andrea Karpathy",
      "--replace",
      "Andrej Karpathy",
      id,
    ]);

    expect(result.exitCode).toBe(0);
    expect(one<{ text: string }>(result.stdout).text).toBe(
      "Ask Andrej Karpathy."
    );
    expect(await words(id)).toEqual([
      { start: 0, end: 0.4, text: "Ask" },
      { start: 0.4, end: 0.9, text: "Andrej" },
      { start: 0.9, end: 1.6, text: "Karpathy." },
    ]);
  });

  it("refuses a --find that is not in the Clip's text, and changes nothing", async () => {
    const id = await seedTranscribedClip("Ask Andrea Karpathy.", MISHEARD);

    const result = await run([
      "clip",
      "edit-transcript",
      "--find",
      "Andrew",
      "--replace",
      "Andrej",
      id,
    ]);

    expect(result.exitCode).toBe(3);
    expect(result.stdout).toBe("");
    const clip = one<{ text: string }>((await run(["clip", "get", id])).stdout);
    expect(clip.text).toBe("Ask Andrea Karpathy.");
    expect(await words(id)).toEqual(MISHEARD);
  });
});
