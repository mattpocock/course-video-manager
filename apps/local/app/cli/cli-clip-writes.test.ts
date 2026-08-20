import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Effect, Layer } from "effect";
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
// cvm clip writes: update / move / delete
// (Split out like cli-beat-writes.test.ts. Clip has no `add` verb — the only
// creators are OBS-capture append and "create video from selection", neither
// CLI-facing — so fixtures here are seeded directly through
// ClipOperationsService.appendClips rather than through the CLI.)
//
// NOTE on argv shape: like every other write-verb suite, flags go BEFORE the
// trailing positional <id> (`--start 3 <id>`, not `<id> --start 3`).
// ===========================================================================

let testDb: TestDb;
/**
 * Fixtures reach the database DIRECTLY, the way `seedWrite` does — `cvm` has
 * no clip-creating verb, so `appendClips` has no endpoint on the deployed API
 * and must not gain one just to seed a test. The commands under test still go
 * over HTTP; only the arranging does not.
 */
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
  sourceDir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "cvm-clip-src-"));
});

afterAll(() => {
  nodeFs.rmSync(sourceDir, { recursive: true, force: true });
});

/**
 * Write a fake footage transcript sidecar (the format `footage transcribe`
 * produces) and return the source PATH `clip add --source` should point at.
 * The source file itself need not exist — `clip add` only reads the sidecar.
 */
const seedFootageTranscript = (
  name: string,
  transcript: {
    words: Array<{ start: number; end: number; text: string }>;
    segments: Array<{ start: number; end: number; text: string }>;
  }
): string => {
  const source = nodePath.join(sourceDir, name);
  nodeFs.writeFileSync(
    source + ".transcript.json",
    JSON.stringify({
      version: 1,
      sourcePath: source,
      sourceHash: "0".repeat(64),
      transcribedAt: new Date().toISOString(),
      ...transcript,
    })
  );
  return source;
};

const SAMPLE_TRANSCRIPT = {
  words: [
    { start: 0, end: 2, text: "the" },
    { start: 2, end: 4, text: "quick" },
    { start: 4, end: 6, text: "brown" },
    { start: 6, end: 8, text: "fox" },
  ],
  segments: [{ start: 0, end: 8, text: " the quick brown fox" }],
};

let s: WriteSeed;
beforeEach(async () => {
  await truncateAllTables(testDb);
  s = await seedWrite(testDb);
});

interface ClipRow {
  id: string;
  videoId: string;
  sourceStartTime: number;
  sourceEndTime: number;
  order: string;
  archived: boolean;
  zoomType: string;
  scene: string | null;
  text: string;
  transcribedAt: string | null;
}

const list = async (videoId: string): Promise<ClipRow[]> =>
  ndjson((await run(["clip", "list", "--video", videoId])).stdout) as ClipRow[];

/**
 * Seed a clip directly through the service — clip has no CLI `add` verb.
 * Pass `after` (a previously-seeded clip's id) to append it to the END of
 * the timeline instead of the start, so a chain of `seedClip` calls builds
 * clips in the order they're called rather than each landing at the front.
 */
const seedClip = (
  videoId: string,
  opts: { start: number; end: number; scene?: string; after?: string }
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
    if (opts.scene !== undefined) {
      return (yield* clipOps.updateClip(clip!.id, {
        scene: opts.scene,
      })) as unknown as ClipRow;
    }
    return clip as unknown as ClipRow;
  }).pipe(Effect.provide(seedLayer), Effect.runPromise);

describe("clip writes (update / move / delete)", () => {
  describe("update --start / --end", () => {
    it("retimes both ends, leaving text/transcribedAt untouched", async () => {
      const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 10 });
      const updated = one<ClipRow>(
        (await run(["clip", "update", "--start", "2.5", "--end", "8", clip.id]))
          .stdout
      );
      expect(updated.sourceStartTime).toBe(2.5);
      expect(updated.sourceEndTime).toBe(8);
      expect(updated.text).toBe(clip.text);
      expect(updated.transcribedAt).toBe(clip.transcribedAt);
    });

    it("--start alone keeps the existing end", async () => {
      const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 10 });
      const updated = one<ClipRow>(
        (await run(["clip", "update", "--start", "3", clip.id])).stdout
      );
      expect(updated.sourceStartTime).toBe(3);
      expect(updated.sourceEndTime).toBe(clip.sourceEndTime);
    });

    it("--end alone keeps the existing start", async () => {
      const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 10 });
      const updated = one<ClipRow>(
        (await run(["clip", "update", "--end", "9", clip.id])).stdout
      );
      expect(updated.sourceEndTime).toBe(9);
      expect(updated.sourceStartTime).toBe(clip.sourceStartTime);
    });

    it("resulting start >= end => invalid input, exit 3", async () => {
      const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 10 });
      const { stdout, stderr, exitCode } = await run([
        "clip",
        "update",
        "--start",
        "9",
        "--end",
        "9",
        clip.id,
      ]);
      expect(exitCode).toBe(3);
      expect(stdout).toBe("");
      expect((JSON.parse(stderr.trim()) as { _tag: string })._tag).toBe(
        "ParseError"
      );
    });

    it("resulting duration below the minimum clip length => invalid input, exit 3", async () => {
      const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 10 });
      const { exitCode } = await run([
        "clip",
        "update",
        "--start",
        "5",
        "--end",
        "5.5",
        clip.id,
      ]);
      expect(exitCode).toBe(3);
    });

    it("combines with --zoom in one call", async () => {
      const clip = await seedClip(s.standaloneActiveId, {
        start: 0,
        end: 10,
        scene: "Camera",
      });
      const updated = one<ClipRow>(
        (
          await run([
            "clip",
            "update",
            "--start",
            "1",
            "--zoom",
            "subtle",
            clip.id,
          ])
        ).stdout
      );
      expect(updated.sourceStartTime).toBe(1);
      expect(updated.zoomType).toBe("subtle");
    });
  });

  it("update with no flags => invalid input, exit 3", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 10 });
    const { stdout, stderr, exitCode } = await run(["clip", "update", clip.id]);
    expect(exitCode).toBe(3);
    expect(stdout).toBe("");
    expect((JSON.parse(stderr.trim()) as { _tag: string })._tag).toBe(
      "ParseError"
    );
  });

  it("update an unknown id => NotFoundError, exit 2", async () => {
    const { stdout, stderr, exitCode } = await run([
      "clip",
      "update",
      "--start",
      "1",
      "clip_missing",
    ]);
    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    const err = JSON.parse(stderr.trim()) as { _tag: string; entity: string };
    expect(err._tag).toBe("NotFoundError");
    expect(err.entity).toBe("clip");
  });

  describe("delete", () => {
    it("archives the clip, echoes archived:true, hides it from list, no restore", async () => {
      const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 10 });
      const del = one<ClipRow>((await run(["clip", "delete", clip.id])).stdout);
      expect(del.id).toBe(clip.id);
      expect(del.archived).toBe(true);
      expect((await list(s.standaloneActiveId)).map((r) => r.id)).not.toContain(
        clip.id
      );
    });

    it("an unknown id => NotFoundError, exit 2", async () => {
      const { stdout, stderr, exitCode } = await run([
        "clip",
        "delete",
        "clip_missing",
      ]);
      expect(exitCode).toBe(2);
      expect(stdout).toBe("");
      expect((JSON.parse(stderr.trim()) as { entity: string }).entity).toBe(
        "clip"
      );
    });

    it("any write on an already-deleted clip => NotFoundError, exit 2", async () => {
      const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 10 });
      await run(["clip", "delete", clip.id]);
      expect(
        (await run(["clip", "update", "--start", "1", clip.id])).exitCode
      ).toBe(2);
      expect((await run(["clip", "delete", clip.id])).exitCode).toBe(2);
      expect(
        (await run(["clip", "move", "--after", clip.id, clip.id])).exitCode
      ).toBe(2);
    });
  });

  describe("move", () => {
    it("--before jumps to an arbitrary earlier position", async () => {
      const a = await seedClip(s.standaloneActiveId, { start: 0, end: 1 });
      const b = await seedClip(s.standaloneActiveId, {
        start: 1,
        end: 2,
        after: a.id,
      });
      const c = await seedClip(s.standaloneActiveId, {
        start: 2,
        end: 3,
        after: b.id,
      });
      expect((await list(s.standaloneActiveId)).map((r) => r.id)).toEqual([
        a.id,
        b.id,
        c.id,
      ]);
      const moved = one<ClipRow>(
        (await run(["clip", "move", "--before", a.id, c.id])).stdout
      );
      expect(moved.id).toBe(c.id);
      expect((await list(s.standaloneActiveId)).map((r) => r.id)).toEqual([
        c.id,
        a.id,
        b.id,
      ]);
    });

    it("--after positions immediately after the target", async () => {
      const a = await seedClip(s.standaloneActiveId, { start: 0, end: 1 });
      // No `after` here: both land via {type: "start"}, so b lands ahead of a
      // ([b, a]) — the move to "--after a" is what re-establishes [a, b],
      // meaningfully exercising the positioning rather than a no-op.
      const b = await seedClip(s.standaloneActiveId, { start: 1, end: 2 });
      const moved = one<ClipRow>(
        (await run(["clip", "move", "--after", a.id, b.id])).stdout
      );
      expect(moved.id).toBe(b.id);
      expect((await list(s.standaloneActiveId)).map((r) => r.id)).toEqual([
        a.id,
        b.id,
      ]);
    });

    it("with both --before and --after => invalid input, exit 3", async () => {
      const a = await seedClip(s.standaloneActiveId, { start: 0, end: 1 });
      const b = await seedClip(s.standaloneActiveId, { start: 1, end: 2 });
      const { stdout, stderr, exitCode } = await run([
        "clip",
        "move",
        "--before",
        a.id,
        "--after",
        a.id,
        b.id,
      ]);
      expect(exitCode).toBe(3);
      expect(stdout).toBe("");
      expect((JSON.parse(stderr.trim()) as { _tag: string })._tag).toBe(
        "ParseError"
      );
    });

    it("with neither --before nor --after => invalid input, exit 3", async () => {
      const a = await seedClip(s.standaloneActiveId, { start: 0, end: 1 });
      const { exitCode } = await run(["clip", "move", a.id]);
      expect(exitCode).toBe(3);
    });

    it("--before an unknown clip id => NotFoundError, exit 2", async () => {
      const a = await seedClip(s.standaloneActiveId, { start: 0, end: 1 });
      const { stdout, stderr, exitCode } = await run([
        "clip",
        "move",
        "--before",
        "clip_missing",
        a.id,
      ]);
      expect(exitCode).toBe(2);
      expect(stdout).toBe("");
      expect((JSON.parse(stderr.trim()) as { entity: string }).entity).toBe(
        "clip"
      );
    });

    it("--before a clip on a different video => NotFoundError, exit 2 (no cross-video move)", async () => {
      const a = await seedClip(s.standaloneActiveId, { start: 0, end: 1 });
      const other = await seedClip(s.lessonVideoId, { start: 0, end: 1 });
      const { exitCode } = await run([
        "clip",
        "move",
        "--before",
        other.id,
        a.id,
      ]);
      expect(exitCode).toBe(2);
    });
  });
});

describe("clip add", () => {
  it("slices text from the cached transcript and appends to the end by default", async () => {
    const source = seedFootageTranscript("take.mkv", SAMPLE_TRANSCRIPT);
    // Seed one existing clip so "append to end" is observable.
    const existing = await seedClip(s.standaloneActiveId, { start: 0, end: 1 });

    const added = one<ClipRow>(
      (
        await run([
          "clip",
          "add",
          "--video",
          s.standaloneActiveId,
          "--source",
          source,
          "--start",
          "2",
          "--end",
          "6",
        ])
      ).stdout
    );

    expect(added.videoId).toBe(s.standaloneActiveId);
    expect(added.sourceStartTime).toBe(2);
    expect(added.sourceEndTime).toBe(6);
    // Words overlapping [2, 6): "quick" (2–4) and "brown" (4–6).
    expect(added.text).toBe("quick brown");
    expect((added as unknown as { videoFilename: string }).videoFilename).toBe(
      source
    );

    expect((await list(s.standaloneActiveId)).map((r) => r.id)).toEqual([
      existing.id,
      added.id,
    ]);
  });

  it("positions with --after (and behaves like any other clip afterwards)", async () => {
    const source = seedFootageTranscript("take.mkv", SAMPLE_TRANSCRIPT);
    const a = await seedClip(s.standaloneActiveId, { start: 0, end: 1 });
    const b = await seedClip(s.standaloneActiveId, {
      start: 1,
      end: 2,
      after: a.id,
    });

    const added = one<ClipRow>(
      (
        await run([
          "clip",
          "add",
          "--video",
          s.standaloneActiveId,
          "--source",
          source,
          "--start",
          "2",
          "--end",
          "4",
          "--after",
          a.id,
        ])
      ).stdout
    );

    expect((await list(s.standaloneActiveId)).map((r) => r.id)).toEqual([
      a.id,
      added.id,
      b.id,
    ]);

    // No second-class type: the new clip moves/deletes like any other.
    await run(["clip", "delete", added.id]);
    expect((await list(s.standaloneActiveId)).map((r) => r.id)).toEqual([
      a.id,
      b.id,
    ]);
  });

  it("positions with --before", async () => {
    const source = seedFootageTranscript("take.mkv", SAMPLE_TRANSCRIPT);
    const a = await seedClip(s.standaloneActiveId, { start: 0, end: 1 });
    const b = await seedClip(s.standaloneActiveId, {
      start: 1,
      end: 2,
      after: a.id,
    });

    const added = one<ClipRow>(
      (
        await run([
          "clip",
          "add",
          "--video",
          s.standaloneActiveId,
          "--source",
          source,
          "--start",
          "2",
          "--end",
          "4",
          "--before",
          b.id,
        ])
      ).stdout
    );

    expect((await list(s.standaloneActiveId)).map((r) => r.id)).toEqual([
      a.id,
      added.id,
      b.id,
    ]);
  });

  it("fails cleanly (exit 3) when the source has no cached transcript", async () => {
    const { stdout, stderr, exitCode } = await run([
      "clip",
      "add",
      "--video",
      s.standaloneActiveId,
      "--source",
      nodePath.join(sourceDir, "never-transcribed.mkv"),
      "--start",
      "2",
      "--end",
      "6",
    ]);
    expect(exitCode).toBe(3);
    expect(stdout).toBe("");
    expect((JSON.parse(stderr.trim()) as { _tag: string })._tag).toBe(
      "ParseError"
    );
  });

  it("an unknown video => NotFoundError, exit 2", async () => {
    const source = seedFootageTranscript("take.mkv", SAMPLE_TRANSCRIPT);
    const { exitCode, stderr } = await run([
      "clip",
      "add",
      "--video",
      "video_nope",
      "--source",
      source,
      "--start",
      "2",
      "--end",
      "6",
    ]);
    expect(exitCode).toBe(2);
    const err = JSON.parse(stderr.trim()) as { _tag: string; entity: string };
    expect(err._tag).toBe("NotFoundError");
    expect(err.entity).toBe("video");
  });

  it("start >= end => invalid input, exit 3", async () => {
    const source = seedFootageTranscript("take.mkv", SAMPLE_TRANSCRIPT);
    const { exitCode } = await run([
      "clip",
      "add",
      "--video",
      s.standaloneActiveId,
      "--source",
      source,
      "--start",
      "6",
      "--end",
      "6",
    ]);
    expect(exitCode).toBe(3);
  });
});
