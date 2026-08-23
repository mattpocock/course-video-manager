import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Effect, Layer } from "effect";
import { createHash } from "node:crypto";
import nodeFs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
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
// Transcript Words: `cvm clip words`, and the two write paths that fill it —
// `clip add`'s footage-sidecar slice, and a transcription
// (`replaceTranscriptWords`, which the local transcribe route calls; there is
// no CLI verb for it, so it is driven through the service the way `appendClips`
// is). Split out of cli-clip-writes.test.ts, which is at the token budget.
// ===========================================================================

let testDb: TestDb;
let seedLayer: Layer.Layer<ClipOperationsService>;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;
/** Temp dir for the fake footage sidecar caches `clip add` reads. */
let sourceDir: string;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  seedLayer = ClipOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as never))
  );
  run = makeRun(buildWriteLayer(testDb));
  sourceDir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "cvm-clip-words-"));
});

afterAll(() => {
  nodeFs.rmSync(sourceDir, { recursive: true, force: true });
});

/** A fake footage file plus the fresh transcript sidecar `clip add` slices. */
const seedFootageTranscript = (
  name: string,
  transcript: {
    words: Array<{ start: number; end: number; text: string }>;
    segments: Array<{ start: number; end: number; text: string }>;
  }
): string => {
  const source = nodePath.join(sourceDir, name);
  const content = `fake footage bytes for ${name}`;
  nodeFs.writeFileSync(source, content);
  nodeFs.writeFileSync(
    source + ".transcript.json",
    JSON.stringify({
      version: 1,
      sourcePath: source,
      sourceHash: createHash("sha256").update(content).digest("hex"),
      transcribedAt: new Date().toISOString(),
      ...transcript,
    })
  );
  return source;
};

/** Four words, one second each, starting 10s into the footage file. */
const SAMPLE_TRANSCRIPT = {
  words: [
    { start: 10, end: 11, text: "the" },
    { start: 11, end: 12, text: "quick" },
    { start: 12, end: 13, text: "brown" },
    { start: 13, end: 14, text: "fox" },
  ],
  segments: [{ start: 10, end: 14, text: " the quick brown fox" }],
};

interface ClipRow {
  id: string;
  text: string;
}

interface WordRow {
  start: number;
  end: number;
  text: string;
}

let s: WriteSeed;
beforeEach(async () => {
  await truncateAllTables(testDb);
  s = await seedWrite(testDb);
});

/** Seed a bare clip directly — `appendClips` has no endpoint on the API. */
const seedClip = (
  videoId: string,
  opts: { start: number; end: number }
): Promise<ClipRow> =>
  Effect.gen(function* () {
    const clipOps = yield* ClipOperationsService;
    const [clip] = yield* clipOps.appendClips({
      videoId,
      insertionPoint: { type: "start" },
      clips: [
        { inputVideo: "test.mp4", startTime: opts.start, endTime: opts.end },
      ],
    });
    return clip as unknown as ClipRow;
  }).pipe(Effect.provide(seedLayer), Effect.runPromise);

/** What a transcription does to a clip: replace its words wholesale. */
const transcribe = (
  clipId: string,
  words: ReadonlyArray<WordRow>
): Promise<unknown> =>
  Effect.gen(function* () {
    const clipOps = yield* ClipOperationsService;
    return yield* clipOps.replaceTranscriptWords(clipId, words);
  }).pipe(Effect.provide(seedLayer), Effect.runPromise);

const words = async (clipId: string): Promise<WordRow[]> =>
  ndjson((await run(["clip", "words", clipId])).stdout) as WordRow[];

describe("clip words", () => {
  it("returns nothing, successfully, for a clip that has never been transcribed", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 10 });

    const { stdout, exitCode } = await run(["clip", "words", clip.id]);

    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
  });

  it("reads back the words a transcription persisted, in spoken order", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 10 });
    await transcribe(clip.id, [
      { start: 1.5, end: 2, text: "quick" },
      { start: 0, end: 1.5, text: "the" },
    ]);

    expect(await words(clip.id)).toEqual([
      { start: 0, end: 1.5, text: "the" },
      { start: 1.5, end: 2, text: "quick" },
    ]);
  });

  it("keeps only the newest transcription's words when a clip is re-transcribed", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 10 });
    await transcribe(clip.id, [{ start: 0, end: 1, text: "before" }]);

    await transcribe(clip.id, [{ start: 0, end: 1, text: "after" }]);

    expect(await words(clip.id)).toEqual([{ start: 0, end: 1, text: "after" }]);
  });

  it("is a not-found for an unknown clip id", async () => {
    const { stdout, stderr, exitCode } = await run(["clip", "words", "nope"]);

    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    expect((JSON.parse(stderr.trim()) as { _tag: string })._tag).toBe(
      "NotFoundError"
    );
  });

  it("is a not-found for an archived clip, like every other clip verb", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 10 });
    await transcribe(clip.id, [{ start: 0, end: 1, text: "gone" }]);
    await run(["clip", "delete", clip.id]);

    expect((await run(["clip", "words", clip.id])).exitCode).toBe(2);
  });

  it("gives each clip only its own words, not its neighbour's", async () => {
    // Two clips cut from the SAME footage file, back to back — each must read
    // back only the words inside its own window.
    const source = seedFootageTranscript("cascade.mkv", SAMPLE_TRANSCRIPT);
    const first = one<ClipRow>(
      (
        await run([
          "clip",
          "add",
          "--video",
          s.standaloneActiveId,
          "--source",
          source,
          "--start",
          "10",
          "--end",
          "12",
        ])
      ).stdout
    );
    const second = one<ClipRow>(
      (
        await run([
          "clip",
          "add",
          "--video",
          s.standaloneActiveId,
          "--source",
          source,
          "--start",
          "12",
          "--end",
          "14",
        ])
      ).stdout
    );

    expect((await words(first.id)).map((w) => w.text)).toEqual([
      "the",
      "quick",
    ]);
    expect((await words(second.id)).map((w) => w.text)).toEqual([
      "brown",
      "fox",
    ]);
  });
});

describe("clip add", () => {
  it("persists the sliced words at clip-relative offsets", async () => {
    const source = seedFootageTranscript("take.mkv", SAMPLE_TRANSCRIPT);

    const clip = one<ClipRow>(
      (
        await run([
          "clip",
          "add",
          "--video",
          s.standaloneActiveId,
          "--source",
          source,
          "--start",
          "11",
          "--end",
          "13",
        ])
      ).stdout
    );

    // Footage offsets 11-13 become clip offsets 0-2: 0 is the clip's start.
    expect(await words(clip.id)).toEqual([
      { start: 0, end: 1, text: "quick" },
      { start: 1, end: 2, text: "brown" },
    ]);
  });

  it("gives a clip cut from silence no words rather than failing", async () => {
    const source = seedFootageTranscript("silence.mkv", SAMPLE_TRANSCRIPT);

    const clip = one<ClipRow>(
      (
        await run([
          "clip",
          "add",
          "--video",
          s.standaloneActiveId,
          "--source",
          source,
          "--start",
          "20",
          "--end",
          "23",
        ])
      ).stdout
    );

    expect(await words(clip.id)).toEqual([]);
  });
});
