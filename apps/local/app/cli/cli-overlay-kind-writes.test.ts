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
// cvm overlay: the kind discriminator, and "only one Overlay at a time"
//
// The same seam as cli-overlay-writes.test.ts — the full CLI stack over a real
// PGlite — split into its own file only because the two together outrun the
// repo's per-file token budget. Read that file first: it covers the anchor,
// the duration and the re-anchor rules these cases build on.
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

interface OverlayRow {
  id: string;
  clipId: string;
  at: number;
  durationInSeconds: number;
  kind: string;
  title: string;
  description: string;
}

const seedClip = (
  videoId: string,
  params: { start: number; end: number; after?: string }
) =>
  Effect.gen(function* () {
    const clipOps = yield* ClipOperationsService;
    const [clip] = yield* clipOps.appendClips({
      videoId,
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
    return clip!;
  }).pipe(Effect.provide(seedLayer), Effect.runPromise);

const addOverlay = async (
  clipId: string,
  overrides: Partial<{
    at: string;
    duration: string;
    kind: string;
    title: string;
    description: string;
  }> = {}
): Promise<OverlayRow> => {
  const result = await run([
    "overlay",
    "add",
    "--clip",
    clipId,
    "--at",
    overrides.at ?? "2",
    "--duration",
    overrides.duration ?? "5",
    ...(overrides.kind === undefined ? [] : ["--kind", overrides.kind]),
    "--title",
    overrides.title ?? "Hydration",
    "--description",
    overrides.description ?? "Attaching handlers to server HTML.",
  ]);
  expect(result.exitCode).toBe(0);
  return one<OverlayRow>(result.stdout);
};

const tagOf = (stderr: string) =>
  (JSON.parse(stderr.trim()) as { _tag: string })._tag;

describe("an Overlay's kind", () => {
  it("is definitionCard when --kind is not given", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 10 });

    const overlay = await addOverlay(clip.id);

    expect(overlay.kind).toBe("definitionCard");
  });

  it("is whatever --kind names", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 10 });

    const overlay = await addOverlay(clip.id, { kind: "bulletPanel" });

    expect(overlay.kind).toBe("bulletPanel");
  });

  it("refuses a kind nothing knows how to render", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 10 });

    const { exitCode, stdout } = await run([
      "overlay",
      "add",
      "--clip",
      clip.id,
      "--at",
      "2",
      "--duration",
      "5",
      "--kind",
      "hologram",
      "--title",
      "t",
      "--description",
      "d",
    ]);

    expect(exitCode).not.toBe(0);
    expect(stdout).toBe("");
  });

  it("can be changed in place, and is a field of its own", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 10 });
    const created = await addOverlay(clip.id);

    // --kind alone satisfies the "name at least one field" rule.
    const updated = one<OverlayRow>(
      (await run(["overlay", "update", "--kind", "bulletPanel", created.id]))
        .stdout
    );

    expect(updated).toMatchObject({
      id: created.id,
      kind: "bulletPanel",
      at: created.at,
      durationInSeconds: created.durationInSeconds,
    });
  });

  it("is listed and fetched with the rest of the row", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 10 });
    const created = await addOverlay(clip.id, { kind: "bulletPanel" });

    expect(
      one<OverlayRow>((await run(["overlay", "get", created.id])).stdout)
    ).toMatchObject({ kind: "bulletPanel" });
    expect(
      (
        ndjson(
          (await run(["overlay", "list", "--video", s.standaloneActiveId]))
            .stdout
        ) as OverlayRow[]
      ).map((r) => r.kind)
    ).toEqual(["bulletPanel"]);
  });
});

describe("only one Overlay at a time", () => {
  it("refuses a new Overlay that overlaps one on the same Clip", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 20 });
    const first = await addOverlay(clip.id, { at: "2", duration: "5" });

    const { exitCode, stdout, stderr } = await run([
      "overlay",
      "add",
      "--clip",
      clip.id,
      "--at",
      "6",
      "--duration",
      "5",
      "--title",
      "t",
      "--description",
      "d",
    ]);

    expect(exitCode).toBe(3);
    expect(stdout).toBe("");
    expect(tagOf(stderr)).toBe("ParseError");
    expect(stderr).toContain(first.id);
  });

  it("refuses one that overlaps an Overlay on a different Clip", async () => {
    // The first Overlay outlives its own Clip and is still on screen 2s into
    // the second, so a Clip-local check would let this pair through.
    const first = await seedClip(s.standaloneActiveId, { start: 0, end: 10 });
    const second = await seedClip(s.standaloneActiveId, {
      start: 10,
      end: 20,
      after: first.id,
    });
    await addOverlay(first.id, { at: "8", duration: "4" });

    const { exitCode, stderr } = await run([
      "overlay",
      "add",
      "--clip",
      second.id,
      "--at",
      "1",
      "--duration",
      "3",
      "--title",
      "t",
      "--description",
      "d",
    ]);

    expect(exitCode).toBe(3);
    expect(tagOf(stderr)).toBe("ParseError");
  });

  it("refuses the overlap whatever the two kinds are", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 20 });
    await addOverlay(clip.id, { at: "2", duration: "5", kind: "bulletPanel" });

    const { exitCode, stderr } = await run([
      "overlay",
      "add",
      "--clip",
      clip.id,
      "--at",
      "4",
      "--duration",
      "5",
      "--kind",
      "definitionCard",
      "--title",
      "t",
      "--description",
      "d",
    ]);

    expect(exitCode).toBe(3);
    expect(tagOf(stderr)).toBe("ParseError");
  });

  it("allows one Overlay to start exactly where the last one ended", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 20 });
    await addOverlay(clip.id, { at: "2", duration: "5" });

    const second = await addOverlay(clip.id, { at: "7", duration: "5" });

    expect(second.at).toBe(7);
  });

  it("leaves Overlays on another Video alone", async () => {
    const mine = await seedClip(s.standaloneActiveId, { start: 0, end: 20 });
    const theirs = await seedClip(s.lessonVideoId, { start: 0, end: 20 });
    await addOverlay(theirs.id, { at: "2", duration: "5" });

    const overlay = await addOverlay(mine.id, { at: "2", duration: "5" });

    expect(overlay.clipId).toBe(mine.id);
  });

  it("refuses a move that lands an Overlay on top of another", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 20 });
    await addOverlay(clip.id, { at: "2", duration: "5" });
    const mover = await addOverlay(clip.id, { at: "10", duration: "2" });

    const { exitCode, stderr } = await run([
      "overlay",
      "update",
      "--at",
      "4",
      mover.id,
    ]);

    expect(exitCode).toBe(3);
    expect(tagOf(stderr)).toBe("ParseError");
    expect(
      one<OverlayRow>((await run(["overlay", "get", mover.id])).stdout).at
    ).toBe(10);
  });

  it("refuses a lengthening that runs one Overlay into the next", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 20 });
    const grower = await addOverlay(clip.id, { at: "2", duration: "2" });
    await addOverlay(clip.id, { at: "6", duration: "2" });

    const { exitCode, stderr } = await run([
      "overlay",
      "update",
      "--duration",
      "6",
      grower.id,
    ]);

    expect(exitCode).toBe(3);
    expect(tagOf(stderr)).toBe("ParseError");
    expect(grower.durationInSeconds).toBe(2);
  });

  it("does not read an Overlay as overlapping itself", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 20 });
    const only = await addOverlay(clip.id, { at: "2", duration: "5" });

    const updated = one<OverlayRow>(
      (await run(["overlay", "update", "--duration", "8", only.id])).stdout
    );

    expect(updated.durationInSeconds).toBe(8);
  });
});
