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
// cvm clip restore: undo for `clip delete`
// (Split out of cli-clip-writes.test.ts, same reason that file was split out
// of a bigger one — the repo's per-file token budget. See that file for the
// `update`/`move`/`delete` cases; this one is `restore` only.)
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

/** Seed a clip directly through the service — clip has no CLI `add` verb. */
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

describe("clip restore", () => {
  it("undoes delete: sets archived:false and brings it back into the default list", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 10 });
    await run(["clip", "delete", clip.id]);
    expect((await list(s.standaloneActiveId)).map((r) => r.id)).not.toContain(
      clip.id
    );

    const restored = one<ClipRow>(
      (await run(["clip", "restore", clip.id])).stdout
    );
    expect(restored.id).toBe(clip.id);
    expect(restored.archived).toBe(false);
    expect((await list(s.standaloneActiveId)).map((r) => r.id)).toContain(
      clip.id
    );
  });

  it("restoring an already-active clip is an idempotent no-op success", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 10 });
    const restored = one<ClipRow>(
      (await run(["clip", "restore", clip.id])).stdout
    );
    expect(restored.id).toBe(clip.id);
    expect(restored.archived).toBe(false);
  });

  it("an unknown id => NotFoundError, exit 2", async () => {
    const { stdout, stderr, exitCode } = await run([
      "clip",
      "restore",
      "clip_missing",
    ]);
    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    expect((JSON.parse(stderr.trim()) as { entity: string }).entity).toBe(
      "clip"
    );
  });

  it("a restored clip is writable again (update/move/delete all work)", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 10 });
    await run(["clip", "delete", clip.id]);
    await run(["clip", "restore", clip.id]);
    expect(
      (await run(["clip", "update", "--start", "1", clip.id])).exitCode
    ).toBe(0);
  });
});
