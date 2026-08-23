import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
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
// `cvm clip update --start/--end`: the retiming cascade.
//
// Retiming a Clip moves the footage out from under everything positioned
// relative to that Clip's start, so the recut carries its Transcript Words and
// its Overlays with it. The two are carried DIFFERENTLY on the way out of
// bounds — words are dropped, Overlays are clamped — and this suite pins that
// asymmetry through the CLI, the way an agent actually meets it.
//
// The arithmetic itself is unit-tested directly in
// packages/core/features/videos/retime-cascade.test.ts; what is proved here is
// that the recut and the cascade really are one write over the real stack.
//
// Clips and Transcript Words are seeded straight through the service (neither
// `appendClips` nor `replaceTranscriptWords` has an endpoint on the deployed
// API, and neither should gain one just to seed a test); every verb UNDER test
// goes over HTTP.
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

interface ClipRow {
  id: string;
  sourceStartTime: number;
  sourceEndTime: number;
  text: string;
  transcribedAt: string | null;
}

interface WordRow {
  start: number;
  end: number;
  text: string;
}

interface OverlayRow {
  id: string;
  clipId: string;
  at: number;
  durationInSeconds: number;
  title: string;
  description: string;
}

const seedClip = (
  videoId: string,
  opts: { start: number; end: number; after?: string }
): Promise<ClipRow> =>
  Effect.gen(function* () {
    const clipOps = yield* ClipOperationsService;
    const [clip] = yield* clipOps.appendClips({
      videoId,
      insertionPoint:
        opts.after === undefined
          ? { type: "start" }
          : { type: "after-clip", databaseClipId: opts.after },
      clips: [
        { inputVideo: "test.mp4", startTime: opts.start, endTime: opts.end },
      ],
    });
    return clip as unknown as ClipRow;
  }).pipe(Effect.provide(seedLayer), Effect.runPromise);

/** What a transcription does to a clip: replace its words wholesale. */
const transcribe = (
  clipId: string,
  wordRows: ReadonlyArray<WordRow>
): Promise<unknown> =>
  Effect.gen(function* () {
    const clipOps = yield* ClipOperationsService;
    return yield* clipOps.replaceTranscriptWords(clipId, wordRows);
  }).pipe(Effect.provide(seedLayer), Effect.runPromise);

const words = async (clipId: string): Promise<WordRow[]> =>
  ndjson((await run(["clip", "words", clipId])).stdout) as WordRow[];

const overlays = async (videoId: string): Promise<OverlayRow[]> =>
  ndjson(
    (await run(["overlay", "list", "--video", videoId])).stdout
  ) as OverlayRow[];

const addOverlay = async (
  clipId: string,
  opts: { at: number; title?: string; description?: string }
): Promise<OverlayRow> => {
  const result = await run([
    "overlay",
    "add",
    "--clip",
    clipId,
    "--at",
    String(opts.at),
    "--duration",
    "4",
    "--title",
    opts.title ?? "Hydration",
    "--description",
    opts.description ?? "Attaching handlers to server HTML.",
  ]);
  expect(result.exitCode).toBe(0);
  return one<OverlayRow>(result.stdout);
};

const retime = async (
  clipId: string,
  flags: { start?: number; end?: number }
): Promise<ClipRow> => {
  const result = await run([
    "clip",
    "update",
    ...(flags.start === undefined ? [] : ["--start", String(flags.start)]),
    ...(flags.end === undefined ? [] : ["--end", String(flags.end)]),
    clipId,
  ]);
  expect(result.stderr).toBe("");
  expect(result.exitCode).toBe(0);
  return one<ClipRow>(result.stdout);
};

/** A clip cut 10s -> 20s out of its source, with four one-second words in it. */
const seedTranscribedClip = async (): Promise<ClipRow> => {
  const clip = await seedClip(s.standaloneActiveId, { start: 10, end: 20 });
  await transcribe(clip.id, [
    { start: 0.5, end: 1.5, text: "the" },
    { start: 2, end: 3, text: "quick" },
    { start: 5, end: 6, text: "brown" },
    { start: 8.5, end: 9.5, text: "fox" },
  ]);
  return clip;
};

describe("clip update --start/--end: Transcript Words", () => {
  it("shifts every word by the same delta as the recut", async () => {
    const clip = await seedTranscribedClip();

    // Trim 2s off the head: source second 12.0 was 2.0 into the clip, and is 0
    // into it now.
    await retime(clip.id, { start: 12 });

    expect(await words(clip.id)).toEqual([
      { start: 0, end: 1, text: "quick" },
      { start: 3, end: 4, text: "brown" },
      { start: 6.5, end: 7.5, text: "fox" },
    ]);
  });

  it("shifts words forward when the in-point moves earlier", async () => {
    const clip = await seedTranscribedClip();

    await retime(clip.id, { start: 9 });

    expect(await words(clip.id)).toEqual([
      { start: 1.5, end: 2.5, text: "the" },
      { start: 3, end: 4, text: "quick" },
      { start: 6, end: 7, text: "brown" },
      { start: 9.5, end: 10.5, text: "fox" },
    ]);
  });

  it("drops a word the trimmed head no longer contains", async () => {
    const clip = await seedTranscribedClip();

    await retime(clip.id, { start: 12 });

    expect((await words(clip.id)).map((w) => w.text)).not.toContain("the");
  });

  it("drops a word the trimmed tail no longer contains", async () => {
    const clip = await seedTranscribedClip();

    // Only --end moves, so the delta is 0 — but there is no longer room for
    // "fox" (8.5-9.5) in a 7s clip.
    await retime(clip.id, { end: 17 });

    expect((await words(clip.id)).map((w) => w.text)).toEqual([
      "the",
      "quick",
      "brown",
    ]);
  });

  it("leaves every word shifted but otherwise untouched when none fall out", async () => {
    const clip = await seedTranscribedClip();

    await retime(clip.id, { start: 10.25 });

    expect(await words(clip.id)).toEqual([
      { start: 0.25, end: 1.25, text: "the" },
      { start: 1.75, end: 2.75, text: "quick" },
      { start: 4.75, end: 5.75, text: "brown" },
      { start: 8.25, end: 9.25, text: "fox" },
    ]);
  });

  it("leaves the clip's own text and transcribedAt alone", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 10, end: 20 });
    await transcribe(clip.id, [{ start: 0.5, end: 1.5, text: "the" }]);

    const retimed = await retime(clip.id, { start: 12, end: 18 });

    expect(retimed.text).toBe(clip.text);
    expect(retimed.transcribedAt).toEqual(clip.transcribedAt);
  });

  it("cascades over a clip with no words at all without complaint", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 10, end: 20 });

    const retimed = await retime(clip.id, { start: 12 });

    expect(retimed.sourceStartTime).toBe(12);
    expect(await words(clip.id)).toEqual([]);
  });
});

describe("clip update --start/--end: Overlays", () => {
  it("shifts every anchored Overlay by the same delta as the recut", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 10, end: 20 });
    await addOverlay(clip.id, { at: 3 });
    await addOverlay(clip.id, { at: 7 });

    await retime(clip.id, { start: 12 });

    expect((await overlays(s.standaloneActiveId)).map((o) => o.at)).toEqual([
      1, 5,
    ]);
  });

  it("clamps an anchor pushed off the front to 0 rather than deleting it", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 10, end: 20 });
    await addOverlay(clip.id, { at: 1, title: "Hydration" });

    await retime(clip.id, { start: 14 });

    const [overlay] = await overlays(s.standaloneActiveId);
    expect(overlay?.at).toBe(0);
    expect(overlay?.title).toBe("Hydration");
  });

  it("clamps an anchor pushed off the end back to the clip's last moment", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 10, end: 20 });
    await addOverlay(clip.id, { at: 9 });

    await retime(clip.id, { end: 14 });

    expect((await overlays(s.standaloneActiveId)).map((o) => o.at)).toEqual([
      4,
    ]);
  });

  it("never loses a Definition Card's title or description to a recut", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 10, end: 20 });
    const before = await addOverlay(clip.id, {
      at: 9,
      title: "Hydration",
      description: "Attaching handlers to server HTML.",
    });

    // A brutal recut: 10s of footage down to 2s, leaving the anchor (which
    // shifts to 7) far past the new end.
    await retime(clip.id, { start: 12, end: 14 });

    const after = await overlays(s.standaloneActiveId);
    expect(after).toHaveLength(1);
    expect(after[0]).toEqual({
      ...before,
      at: 2,
    });
  });

  it("leaves an in-bounds Overlay shifted but otherwise untouched", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 10, end: 20 });
    const before = await addOverlay(clip.id, { at: 6 });

    await retime(clip.id, { start: 11, end: 19 });

    expect(await overlays(s.standaloneActiveId)).toEqual([
      { ...before, at: 5 },
    ]);
  });

  it("touches only the retimed clip's Overlays, not its neighbour's", async () => {
    const first = await seedClip(s.standaloneActiveId, { start: 10, end: 20 });
    const second = await seedClip(s.standaloneActiveId, {
      start: 30,
      end: 40,
      after: first.id,
    });
    await addOverlay(first.id, { at: 6, title: "First" });
    const untouched = await addOverlay(second.id, { at: 6, title: "Second" });

    await retime(first.id, { start: 14 });

    const after = await overlays(s.standaloneActiveId);
    expect(after.find((o) => o.title === "First")?.at).toBe(2);
    expect(after.find((o) => o.title === "Second")).toEqual(untouched);
  });

  it("touches only the retimed clip's words, not its neighbour's", async () => {
    const first = await seedClip(s.standaloneActiveId, { start: 10, end: 20 });
    const second = await seedClip(s.standaloneActiveId, {
      start: 30,
      end: 40,
      after: first.id,
    });
    await transcribe(first.id, [{ start: 6, end: 7, text: "first" }]);
    await transcribe(second.id, [{ start: 6, end: 7, text: "second" }]);

    await retime(first.id, { start: 14 });

    expect(await words(first.id)).toEqual([
      { start: 2, end: 3, text: "first" },
    ]);
    expect(await words(second.id)).toEqual([
      { start: 6, end: 7, text: "second" },
    ]);
  });
});

describe("clip update --start/--end: the recut is still refused where it was", () => {
  it("changes nothing when the range is rejected as too short", async () => {
    const clip = await seedTranscribedClip();
    await addOverlay(clip.id, { at: 6 });

    const { exitCode } = await run([
      "clip",
      "update",
      "--start",
      "19.99",
      clip.id,
    ]);

    expect(exitCode).toBe(3);
    expect((await words(clip.id)).map((w) => w.text)).toEqual([
      "the",
      "quick",
      "brown",
      "fox",
    ]);
    expect((await overlays(s.standaloneActiveId)).map((o) => o.at)).toEqual([
      6,
    ]);
  });

  it("is a not-found for an unknown clip id", async () => {
    const { stdout, stderr, exitCode } = await run([
      "clip",
      "update",
      "--start",
      "1",
      "nope",
    ]);

    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    expect((JSON.parse(stderr.trim()) as { _tag: string })._tag).toBe(
      "NotFoundError"
    );
  });
});
