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
  seedWrite,
  type RunResult,
  type WriteSeed,
} from "./cli-write-test-harness";

// ===========================================================================
// cvm overlay: a camera-moving Overlay may not land on a zoomed Clip
//
// The same seam as cli-overlay-writes.test.ts and cli-overlay-kind-writes.ts —
// the full CLI stack over a real PGlite — in its own file only because the
// three together outrun the repo's per-file token budget. Read
// cli-overlay-writes.test.ts first: it covers the anchor, duration and
// re-anchor rules these cases build on.
//
// A Clip Zoom is baked in by the concat pass and an Overlay Transform is
// applied by the compositing pass afterwards, so the two crops compound rather
// than compose. Nothing reconciles them; the authoring is refused instead.
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

/**
 * A Clip on the seed Video. `scene` is set because a Clip Zoom is legal only
 * on a camera scene — the zoom below goes on through the CLI exactly as a user
 * would set it, rather than being written straight into the column.
 */
const seedClip = (params: { start: number; end: number; after?: string }) =>
  Effect.gen(function* () {
    const clipOps = yield* ClipOperationsService;
    const [clip] = yield* clipOps.appendClips({
      videoId: s.standaloneActiveId,
      insertionPoint:
        params.after === undefined
          ? { type: "start" }
          : { type: "after-clip", databaseClipId: params.after },
      clips: [
        {
          inputVideo: "test.mp4",
          startTime: params.start,
          endTime: params.end,
        },
      ],
    });
    yield* clipOps.updateClip(clip!.id, { scene: "Camera" });
    return clip!;
  }).pipe(Effect.provide(seedLayer), Effect.runPromise);

const zoom = async (clipId: string) => {
  const result = await run(["clip", "update", "--zoom", "subtle", clipId]);
  expect(result.exitCode).toBe(0);
};

const addOverlay = (
  clipId: string,
  overrides: Partial<{ at: string; duration: string; kind: string }> = {}
) =>
  run([
    "overlay",
    "add",
    "--clip",
    clipId,
    "--at",
    overrides.at ?? "1",
    "--duration",
    overrides.duration ?? "3",
    ...(overrides.kind === undefined ? [] : ["--kind", overrides.kind]),
    "--title",
    "Hydration",
    "--description",
    "Attaching handlers to server HTML.",
  ]);

const tagOf = (stderr: string) =>
  (JSON.parse(stderr.trim()) as { _tag: string })._tag;

describe("a camera-moving Overlay over a zoomed Clip", () => {
  it("is refused on its own anchor Clip", async () => {
    const clip = await seedClip({ start: 0, end: 10 });
    await zoom(clip.id);

    const { exitCode, stderr } = await addOverlay(clip.id, {
      kind: "bulletPanel",
    });

    expect(exitCode).toBe(3);
    expect(tagOf(stderr)).toBe("ParseError");
    expect(stderr).toContain(clip.id);
    expect(stderr).toContain("zoom");
  });

  it("is refused on a LATER Clip its duration runs onto", async () => {
    // The Overlay is anchored to an unzoomed Clip and outlives it — an
    // Overlay's duration is free to outrun its anchor, so the whole window is
    // what has to be clear, not just the Clip it hangs off.
    const first = await seedClip({ start: 0, end: 10 });
    const second = await seedClip({ start: 0, end: 10, after: first.id });
    await zoom(second.id);

    const { exitCode, stderr } = await addOverlay(first.id, {
      at: "8",
      duration: "5",
      kind: "bulletPanel",
    });

    expect(exitCode).toBe(3);
    expect(tagOf(stderr)).toBe("ParseError");
    expect(stderr).toContain(second.id);
  });

  it("is allowed when it ends before the zoomed Clip begins", async () => {
    const first = await seedClip({ start: 0, end: 10 });
    const second = await seedClip({ start: 0, end: 10, after: first.id });
    await zoom(second.id);

    const { exitCode } = await addOverlay(first.id, {
      at: "1",
      duration: "3",
      kind: "bulletPanel",
    });

    expect(exitCode).toBe(0);
  });

  it("is allowed on a Clip with no zoom at all", async () => {
    const clip = await seedClip({ start: 0, end: 10 });

    const { exitCode } = await addOverlay(clip.id, { kind: "bulletPanel" });

    expect(exitCode).toBe(0);
  });
});

describe("an Overlay that moves no camera", () => {
  it("is allowed over a zoomed Clip", async () => {
    // A Definition Card is drawn on top of whatever framing the Clip already
    // has, so there is no second crop to compound.
    const clip = await seedClip({ start: 0, end: 10 });
    await zoom(clip.id);

    const { exitCode } = await addOverlay(clip.id);

    expect(exitCode).toBe(0);
  });

  it("cannot be turned into one over a zoomed Clip by `update --kind`", async () => {
    const clip = await seedClip({ start: 0, end: 10 });
    const added = await addOverlay(clip.id);
    expect(added.exitCode).toBe(0);
    const { id } = JSON.parse(added.stdout.trim()) as { id: string };
    await zoom(clip.id);

    const { exitCode, stderr } = await run([
      "overlay",
      "update",
      "--kind",
      "bulletPanel",
      id,
    ]);

    expect(exitCode).toBe(3);
    expect(tagOf(stderr)).toBe("ParseError");
    expect(stderr).toContain(clip.id);
  });
});
