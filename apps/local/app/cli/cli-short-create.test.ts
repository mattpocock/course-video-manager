import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Effect, Layer } from "effect";
import { createHash } from "node:crypto";
import nodeFs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { eq } from "drizzle-orm";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/test-db";
import * as schema from "@/db/schema";
import { buildProgram } from "@/cli/main";
import { makeTestCliOutput } from "@/cli/output";
import { FootageProbe } from "@/services/footage-probe";
import {
  buildWriteLayer,
  ndjson,
  one,
  seedWrite,
  type RunResult,
  type WriteSeed,
} from "./cli-write-test-harness";

// ===========================================================================
// cvm short create (#2577): a Standalone Short from ranges of a Video, a
// Recording Session or a Footage file. The full CLI stack over a real
// database; Footage transcripts are fake sidecars in a temp dir, and ffprobe
// is faked: every file is 60s long.
// ===========================================================================

let testDb: TestDb;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;
let sourceDir: string;
let s: WriteSeed;

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
  const layer = Layer.mergeAll(
    buildWriteLayer(testDb),
    Layer.succeed(FootageProbe, {
      probe: () => Effect.succeed({ video: null, durationSeconds: 60 }),
    })
  );
  run = async (argv) => {
    const out = makeTestCliOutput();
    const exitCode = await Effect.runPromise(
      buildProgram(argv).pipe(Effect.provide(out.layer), Effect.provide(layer))
    );
    return { stdout: out.stdout(), stderr: out.stderr(), exitCode };
  };
  sourceDir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "cvm-short-src-"));
});

afterAll(() => {
  nodeFs.rmSync(sourceDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await truncateAllTables(testDb);
  s = await seedWrite(testDb);
});

/** One word a second: "w0" spoken 0-1s, "w1" 1-2s, … up to `count`. */
const wordsFrom = (count: number, from = 0) =>
  Array.from({ length: count }, (_, i) => ({
    start: from + i,
    end: from + i + 1,
    text: `w${from + i}`,
  }));

/** A fake Footage file and its fresh transcript sidecar (one word a second). */
const seedFootage = (name: string, seconds = 60): string => {
  const source = nodePath.join(sourceDir, name);
  const content = `fake footage bytes for ${name}`;
  nodeFs.writeFileSync(source, content);
  const words = wordsFrom(seconds);
  nodeFs.writeFileSync(
    source + ".transcript.json",
    JSON.stringify({
      version: 1,
      sourcePath: source,
      sourceHash: createHash("sha256").update(content).digest("hex"),
      transcribedAt: new Date().toISOString(),
      words,
      segments: [
        { start: 0, end: seconds, text: words.map((w) => w.text).join(" ") },
      ],
    })
  );
  return source;
};

/**
 * A landscape stream Video: three 10s Clips of one Streamed Recording Session
 * (file times 0-10, 10-20, 20-30), each with one Transcript Word a second and
 * a Definition Card Overlay, plus a Chapter and a Chat Highlight shown at 12s.
 */
const T0 = 1_000_000;
const seedStream = async () => {
  const [video] = await testDb
    .insert(schema.videos)
    .values({ title: "stream", originalFootagePath: "" })
    .returning();
  const [session] = await testDb
    .insert(schema.recordingSessions)
    .values({
      videoId: video!.id,
      cameraFilePath: "camera.mkv",
      screenFilePath: "screen.mkv",
      micFilePath: "mic.mkv",
      status: "stopped",
      startedAt: new Date(T0),
    })
    .returning();
  await testDb.insert(schema.recordingSessionSceneEvents).values([
    { recordingSessionId: session!.id, fileTime: 0, scene: "Camera" },
    { recordingSessionId: session!.id, fileTime: 25, scene: "Code" },
  ]);
  await testDb.insert(schema.chatHighlights).values({
    videoId: video!.id,
    recordingSessionId: session!.id,
    broadcastId: "broadcast",
    messageId: "message-1",
    author: "@fake_viewer",
    text: "Fake question",
    shownAtMs: T0 + 12_000,
  });
  const clips = await testDb
    .insert(schema.clips)
    .values(
      [0, 10, 20].map((start, i) => ({
        videoId: video!.id,
        videoFilename: "mic.mkv",
        sourceStartTime: start,
        sourceEndTime: start + 10,
        order: `a${i}`,
        text: wordsFrom(10, start)
          .map((w) => w.text)
          .join(" "),
        recordingSessionId: session!.id,
        scene: "Camera",
        sceneOverride: i === 1 ? ("Code" as const) : null,
      }))
    )
    .returning();
  for (const clip of clips) {
    await testDb.insert(schema.clipTranscriptWords).values(
      wordsFrom(10).map((w) => ({
        clipId: clip.id,
        start: w.start,
        end: w.end,
        text: `w${clip.sourceStartTime + w.start}`,
      }))
    );
    await testDb.insert(schema.overlays).values({
      clipId: clip.id,
      at: 1,
      durationInSeconds: 2,
      title: "Term",
      description: "Definition",
    });
  }
  await testDb
    .insert(schema.chapters)
    .values({ videoId: video!.id, name: "Part", order: "a1V" });
  return {
    videoId: video!.id,
    sessionId: session!.id,
    clipIds: clips.map((c) => c.id),
  };
};

interface ShortLine {
  id: string;
  title: string;
  format: string;
  lessonId: string | null;
  clipIds: string[];
}

interface ClipLine {
  id: string;
  sourceStartTime: number;
  sourceEndTime: number;
  origin: string;
  recordingSessionId: string | null;
  videoFilename: string;
  sceneOverride: string | null;
  text: string;
}

const create = (...args: string[]) =>
  run(["short", "create", "--name", "My Short", ...args]);

/** The new Short (first line) and its Clips, read back through the CLI. */
const created = async (result: RunResult) => {
  expect(result.stderr).toBe("");
  expect(result.exitCode).toBe(0);
  const [short] = ndjson(result.stdout) as ShortLine[];
  const clips = ndjson(
    (await run(["clip", "list", "--video", short!.id])).stdout
  ) as ClipLine[];
  return { short: short!, clips };
};

const words = async (clipId: string) =>
  ndjson((await run(["clip", "words", clipId])).stdout) as Array<{
    start: number;
    end: number;
    text: string;
  }>;

/** Everything the source Video holds, to prove it is untouched. */
const snapshot = async (videoId: string) => ({
  clips: await testDb.query.clips.findMany({
    where: eq(schema.clips.videoId, videoId),
    with: { transcriptWords: true, overlays: true },
    orderBy: schema.clips.order,
  }),
  chapters: await testDb.query.chapters.findMany({
    where: eq(schema.chapters.videoId, videoId),
  }),
});

describe("cvm short create from a Video range", () => {
  it("makes a Standalone, named Short from part of one Clip, its words trimmed", async () => {
    const stream = await seedStream();
    const before = await snapshot(stream.videoId);

    const { short, clips } = await created(
      await create(
        "--video",
        stream.videoId,
        "--range",
        `${stream.clipIds[0]}+2..${stream.clipIds[0]}+7`
      )
    );

    expect(short).toMatchObject({
      title: "My Short",
      format: "short",
      lessonId: null,
    });
    expect(short.clipIds).toEqual(clips.map((c) => c.id));
    expect(clips).toHaveLength(1);
    expect(clips[0]).toMatchObject({
      sourceStartTime: 2,
      sourceEndTime: 7,
      origin: "copy",
      recordingSessionId: stream.sessionId,
      videoFilename: "mic.mkv",
      text: "w2 w3 w4 w5 w6",
    });
    expect(await words(clips[0]!.id)).toEqual([
      { start: 0, end: 1, text: "w2" },
      { start: 1, end: 2, text: "w3" },
      { start: 2, end: 3, text: "w4" },
      { start: 3, end: 4, text: "w5" },
      { start: 4, end: 5, text: "w6" },
    ]);
    expect(await snapshot(stream.videoId)).toEqual(before);
  });
});

describe("cvm short create from Video ranges", () => {
  it("copies every Clip a range covers, trimming the first and last, without Chapters or Overlays", async () => {
    const stream = await seedStream();
    const [c0, , c2] = stream.clipIds;

    const { short, clips } = await created(
      await create("--video", stream.videoId, "--range", `${c0}+5..${c2}+3`)
    );

    expect(
      clips.map((c) => [c.sourceStartTime, c.sourceEndTime, c.origin])
    ).toEqual([
      [5, 10, "copy"],
      [10, 20, "copy"],
      [20, 23, "copy"],
    ]);
    expect(clips.map((c) => c.sceneOverride)).toEqual([null, "Code", null]);
    expect(clips.every((c) => c.recordingSessionId === stream.sessionId)).toBe(
      true
    );
    expect((await words(clips[0]!.id)).map((w) => w.text)).toEqual([
      "w5",
      "w6",
      "w7",
      "w8",
      "w9",
    ]);
    expect(await words(clips[1]!.id)).toHaveLength(10);
    expect(await words(clips[2]!.id)).toEqual([
      { start: 0, end: 1, text: "w20" },
      { start: 1, end: 2, text: "w21" },
      { start: 2, end: 3, text: "w22" },
    ]);
    const copy = await snapshot(short.id);
    expect(copy.chapters).toEqual([]);
    expect(copy.clips.flatMap((c) => c.overlays)).toEqual([]);
  });

  it("from a Short, keeps its Overlays at the same moment of footage, ending by the range's end, leaving out any outside it", async () => {
    const stream = await seedStream();
    const [c0] = stream.clipIds;
    const { short: first, clips: firstClips } = await created(
      await create("--video", stream.videoId, "--range", `${c0}..${c0}`)
    );
    const source = firstClips[0]!.id;
    const chatCard = {
      kind: "chatCard",
      title: "@fake_viewer",
      description: "Fake question",
    };
    await testDb.insert(schema.overlays).values([
      {
        clipId: source,
        kind: "callToAction",
        at: 6,
        durationInSeconds: 3,
        title: "Subscribe",
        description: "for more",
        disableEnterAnimation: true,
      },
      {
        clipId: source,
        ...chatCard,
        at: 4,
        durationInSeconds: 2,
        chatSpin: [],
      },
      // Before the new range, and at its very end: neither is copied.
      { clipId: source, ...chatCard, at: 1, durationInSeconds: 2 },
      { clipId: source, ...chatCard, at: 8, durationInSeconds: 1 },
    ]);
    const before = await snapshot(first.id);

    const { short } = await created(
      await create("--video", first.id, "--range", `${source}+3..${source}+8`)
    );

    const [clip] = (await snapshot(short.id)).clips;
    expect(
      clip!.overlays
        .map((o) => ({
          kind: o.kind,
          at: o.at,
          durationInSeconds: o.durationInSeconds,
          title: o.title,
          description: o.description,
          disableEnterAnimation: o.disableEnterAnimation,
          chatSpin: o.chatSpin,
        }))
        .sort((a, b) => a.at - b.at)
    ).toEqual([
      {
        ...chatCard,
        at: 1,
        durationInSeconds: 2,
        disableEnterAnimation: false,
        chatSpin: [],
      },
      {
        kind: "callToAction",
        at: 3,
        // It ran to 9s of footage; the range ends at 8s.
        durationInSeconds: 2,
        title: "Subscribe",
        description: "for more",
        disableEnterAnimation: true,
        chatSpin: null,
      },
    ]);
    expect(await snapshot(first.id)).toEqual(before);
  });

  it("from a Short, cuts each Overlay at the end of its range, so two from adjacent ranges never collide", async () => {
    const stream = await seedStream();
    const [c0] = stream.clipIds;
    const { short: first, clips: firstClips } = await created(
      await create("--video", stream.videoId, "--range", `${c0}..${c0}`)
    );
    const source = firstClips[0]!.id;
    await testDb.insert(schema.overlays).values([
      // 2s-7s of footage: past the first range's end, and over the jump cut.
      {
        clipId: source,
        kind: "callToAction",
        at: 2,
        durationInSeconds: 5,
        title: "A",
        description: "",
      },
      {
        clipId: source,
        kind: "callToAction",
        at: 8,
        durationInSeconds: 1,
        title: "B",
        description: "",
      },
    ]);

    const { short } = await created(
      await create(
        "--video",
        first.id,
        "--range",
        `${source}+0..${source}+4`,
        "--range",
        `${source}+8..${source}+10`
      )
    );

    // On the Short's timeline: Part 1 is 0-4s, Part 2 is 4-6s.
    const clips = (await snapshot(short.id)).clips;
    expect(
      clips.map((c) =>
        c.overlays.map((o) => [o.title, o.at, o.durationInSeconds])
      )
    ).toEqual([[["A", 2, 2]], [["B", 0, 1]]]);
  });

  it("joins several ranges in the order given, the same Clip twice if asked", async () => {
    const stream = await seedStream();
    const [c0, , c2] = stream.clipIds;

    const { clips } = await created(
      await create(
        "--video",
        stream.videoId,
        "--range",
        `${c0}..${c0}+3`,
        "--range",
        `${c2}+6..${c2}`,
        "--range",
        `${c0}+5..${c0}+9`
      )
    );

    expect(clips.map((c) => [c.sourceStartTime, c.sourceEndTime])).toEqual([
      [0, 3],
      [26, 30],
      [5, 9],
    ]);
    expect(clips.map((c) => c.text)).toEqual([
      "w0 w1 w2",
      "w26 w27 w28 w29",
      "w5 w6 w7 w8",
    ]);
  });

  it("keeps a streamed Clip's Recording Session, so a Chat Card finds its Chat Highlights", async () => {
    const stream = await seedStream();
    const c1 = stream.clipIds[1]!;
    const { clips } = await created(
      await create("--video", stream.videoId, "--range", `${c1}+1..${c1}+6`)
    );

    // 2s into a copy starting at file time 11s: 13s, while the card shows.
    const result = await run([
      "overlay",
      "add",
      "--clip",
      clips[0]!.id,
      "--at",
      "2",
      "--duration",
      "3",
      "--kind",
      "chatCard",
    ]);

    expect(result.exitCode).toBe(0);
    expect(one(result.stdout)).toMatchObject({
      kind: "chatCard",
      title: "@fake_viewer",
      description: "Fake question",
    });
  });
  it("carries a Landscape Clip's Footage Layers into the Short's frame by fractions, centre-cropped so nothing stretches", async () => {
    const stream = await seedStream();
    const c0 = stream.clipIds[0]!;
    const footage = {
      clipId: c0,
      kind: "footage" as const,
      footagePath: "broll.mp4",
      footageStart: 4,
      cropX: 0,
      cropY: 0,
      cropW: 1,
      cropH: 1,
      volume: 0,
    };
    // A migrated full-frame B-roll, and a 640x360 picture-in-picture.
    await testDb.insert(schema.clipLayers).values([
      { clipId: c0, position: 0, kind: "scene", volume: 1 },
      {
        ...footage,
        position: 1,
        placeX: 0,
        placeY: 0,
        placeW: 1920,
        placeH: 1080,
      },
      {
        ...footage,
        position: 2,
        placeX: 1280,
        placeY: 0,
        placeW: 640,
        placeH: 360,
      },
    ]);

    const { clips } = await created(
      await create("--video", stream.videoId, "--range", `${c0}..${c0}`)
    );

    const layers = await testDb.query.clipLayers.findMany({
      where: eq(schema.clipLayers.clipId, clips[0]!.id),
      orderBy: schema.clipLayers.position,
    });
    // 16:9 into 9:16 keeps the middle (9/16) / (16/9) of the width.
    const keep = 9 / 16 / (16 / 9);
    expect(
      layers.map((l) => [l.kind, l.placeX, l.placeY, l.placeW, l.placeH])
    ).toEqual([
      ["scene", null, null, null, null],
      ["footage", 0, 0, 1080, 1920],
      ["footage", 720, 0, 360, 640],
    ]);
    for (const layer of layers.slice(1)) {
      expect(layer.cropW).toBeCloseTo(keep, 9);
      expect(layer.cropX).toBeCloseTo((1 - keep) / 2, 9);
      expect([layer.cropY, layer.cropH]).toEqual([0, 1]);
    }
    // The source keeps its own.
    const source = await testDb.query.clipLayers.findMany({
      where: eq(schema.clipLayers.clipId, c0),
    });
    expect(source.map((l) => l.placeW)).toEqual(
      expect.arrayContaining([1920, 640])
    );
  });
});

describe("cvm short create from a Recording Session or Footage range", () => {
  it("cuts a new Clip of the session on its clock, words from its mic file's transcript", async () => {
    const stream = await seedStream();
    const mic = seedFootage("mic.mkv");
    await testDb
      .update(schema.recordingSessions)
      .set({ micFilePath: mic })
      .where(eq(schema.recordingSessions.id, stream.sessionId));

    const { clips } = await created(
      await create(
        "--recording-session",
        stream.sessionId,
        "--range",
        "26-28.5"
      )
    );

    expect(clips).toHaveLength(1);
    expect(clips[0]).toMatchObject({
      sourceStartTime: 26,
      sourceEndTime: 28.5,
      origin: "cli",
      recordingSessionId: stream.sessionId,
      videoFilename: mic,
      text: "w26 w27 w28",
    });
    const [clip] = await testDb.query.clips.findMany({
      where: eq(schema.clips.id, clips[0]!.id),
    });
    expect(clip!.scene).toBe("Code");
    expect(await words(clips[0]!.id)).toEqual([
      { start: 0, end: 1, text: "w26" },
      { start: 1, end: 2, text: "w27" },
      { start: 2, end: 2.5, text: "w28" },
    ]);
  });

  it("cuts a new Clip of a Footage file, with no Recording Session", async () => {
    const footage = seedFootage("imported.mp4");
    const before = nodeFs.readFileSync(footage, "utf8");

    const { clips } = await created(
      await create("--footage", footage, "--range", "10-12")
    );

    expect(clips).toEqual([
      expect.objectContaining({
        sourceStartTime: 10,
        sourceEndTime: 12,
        origin: "cli",
        recordingSessionId: null,
        videoFilename: footage,
        text: "w10 w11",
      }),
    ]);
    expect((await words(clips[0]!.id)).map((w) => w.text)).toEqual([
      "w10",
      "w11",
    ]);
    expect(nodeFs.readFileSync(footage, "utf8")).toBe(before);
  });
});

describe("cvm short create refuses, exit 3, writing nothing", () => {
  const shortCount = async () =>
    (
      await testDb.query.videos.findMany({
        where: eq(schema.videos.format, "short"),
      })
    ).length;

  const refusals: Array<
    [string, (x: Awaited<ReturnType<typeof seedStream>>) => string[], RegExp]
  > = [
    [
      "an empty range",
      ({ videoId, clipIds: [c0] }) => [
        "--video",
        videoId,
        "--range",
        `${c0}+4..${c0}+4`,
      ],
      /empty or reversed/,
    ],
    [
      "a reversed range",
      ({ videoId, clipIds: [c0, , c2] }) => [
        "--video",
        videoId,
        "--range",
        `${c2}..${c0}`,
      ],
      /reversed/,
    ],
    [
      "a malformed range",
      ({ videoId, clipIds: [c0] }) => [
        "--video",
        videoId,
        "--range",
        `${c0}+x`,
      ],
      /is not <clipId>/,
    ],
    [
      "a range past a Clip's end",
      ({ videoId, clipIds: [c0] }) => [
        "--video",
        videoId,
        "--range",
        `${c0}..${c0}+12`,
      ],
      /only 10s long/,
    ],
    [
      "a trimmed Clip below the minimum length",
      ({ videoId, clipIds: [c0, c1] }) => [
        "--video",
        videoId,
        "--range",
        `${c0}+9.5..${c1}`,
      ],
      /below the 1s minimum clip length/,
    ],
    [
      "a Clip of another Video",
      ({ clipIds: [c0] }) => [
        "--video",
        s.standaloneActiveId,
        "--range",
        `${c0}..${c0}`,
      ],
      /is on Video .*, not on --video/,
    ],
    [
      "an unknown Recording Session",
      () => ["--recording-session", "no-such-session", "--range", "1-5"],
      /no Recording Session no-such-session/,
    ],
    [
      "an unknown Footage path",
      () => ["--footage", "/no/such/file.mp4", "--range", "1-5"],
      /no such Footage file/,
    ],
    [
      "a reversed Footage range",
      () => ["--footage", seedFootage("a.mp4"), "--range", "9-3"],
      /empty or reversed/,
    ],
    [
      "a Footage range past the end of the file",
      () => ["--footage", seedFootage("b.mp4"), "--range", "50-70"],
      /ends past the end of .* \(60s long\)/,
    ],
    [
      "a Footage range below the minimum length",
      () => ["--footage", seedFootage("c.mp4"), "--range", "5-5.5"],
      /below the 1s minimum clip length/,
    ],
    [
      "Footage with no transcript yet",
      () => {
        const bare = nodePath.join(sourceDir, "untranscribed.mp4");
        nodeFs.writeFileSync(bare, "no transcript");
        return ["--footage", bare, "--range", "1-5"];
      },
      /run 'cvm footage transcribe .*untranscribed\.mp4' first/,
    ],
    [
      "two sources at once",
      ({ videoId }) => [
        "--video",
        videoId,
        "--footage",
        "x.mp4",
        "--range",
        "1-5",
      ],
      /exactly one source/,
    ],
  ];

  for (const [what, args, reason] of refusals) {
    it(what, async () => {
      const stream = await seedStream();
      const before = await shortCount();

      const result = await create(...args(stream));

      expect(result.exitCode).toBe(3);
      expect(result.stderr).toMatch(reason);
      expect(await shortCount()).toBe(before);
    });
  }

  it("an archived Clip", async () => {
    const stream = await seedStream();
    const c0 = stream.clipIds[0]!;
    await run(["clip", "delete", c0]);

    const result = await create(
      "--video",
      stream.videoId,
      "--range",
      `${c0}..${c0}`
    );

    expect(result.exitCode).toBe(3);
    expect(result.stderr).toMatch(/is archived/);
    expect(await shortCount()).toBe(0);
  });
});
