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
// cvm overlay: list / get / add / update / delete
//
// The full CLI stack over a real PGlite — the same seam every other write-verb
// suite uses. Clips are seeded DIRECTLY through ClipOperationsService (`cvm`
// has no clip-creating verb reachable from here), but every `overlay` verb
// under test goes over HTTP through the deployed app.
//
// NOTE on argv shape: flags go BEFORE the trailing positional <id>.
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

describe("overlay add", () => {
  it("places a Definition Card on a Clip at a Clip-relative offset", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 10 });

    const overlay = await addOverlay(clip.id, {
      at: "4.25",
      duration: "5",
      title: "Hydration",
      description: "Attaching event handlers to server HTML.",
    });

    expect(overlay).toMatchObject({
      clipId: clip.id,
      at: 4.25,
      durationInSeconds: 5,
      title: "Hydration",
      description: "Attaching event handlers to server HTML.",
    });
    expect(typeof overlay.id).toBe("string");
  });

  it("lets an Overlay outlast its anchor Clip", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 3 });

    const overlay = await addOverlay(clip.id, { at: "2", duration: "30" });

    expect(overlay.durationInSeconds).toBe(30);
  });

  it("refuses a negative offset", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 10 });

    const { exitCode, stdout, stderr } = await run([
      "overlay",
      "add",
      "--clip",
      clip.id,
      "--at",
      "-1",
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
  });

  it("refuses a zero-length Overlay", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 10 });

    const { exitCode, stderr } = await run([
      "overlay",
      "add",
      "--clip",
      clip.id,
      "--at",
      "1",
      "--duration",
      "0",
      "--title",
      "t",
      "--description",
      "d",
    ]);

    expect(exitCode).toBe(3);
    expect(tagOf(stderr)).toBe("ParseError");
  });

  it("refuses an offset at or past the anchor Clip's own end", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 4, end: 10 });

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
    expect(stderr).toContain(clip.id);
  });

  it("allows an offset in the anchor Clip's last moments", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 4, end: 10 });

    const overlay = await addOverlay(clip.id, { at: "5.9" });

    expect(overlay.at).toBe(5.9);
  });

  it("reports an unknown anchor Clip as not-found", async () => {
    const { exitCode, stdout, stderr } = await run([
      "overlay",
      "add",
      "--clip",
      "no-such-clip",
      "--at",
      "1",
      "--duration",
      "5",
      "--title",
      "t",
      "--description",
      "d",
    ]);

    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    expect(tagOf(stderr)).toBe("NotFoundError");
  });
});

describe("overlay list", () => {
  it("returns a Video's Overlays in timeline order", async () => {
    const first = await seedClip(s.standaloneActiveId, { start: 0, end: 10 });
    const second = await seedClip(s.standaloneActiveId, {
      start: 10,
      end: 20,
      after: first.id,
    });
    // Durations kept short: two Overlays may never be on screen at once, and
    // the second Clip starts at 10s on the Video's own timeline.
    await addOverlay(second.id, { at: "1", duration: "1", title: "Third" });
    await addOverlay(first.id, { at: "8", duration: "1", title: "Second" });
    await addOverlay(first.id, { at: "2", duration: "1", title: "First" });

    const rows = ndjson(
      (await run(["overlay", "list", "--video", s.standaloneActiveId])).stdout
    ) as OverlayRow[];

    expect(rows.map((r) => r.title)).toEqual(["First", "Second", "Third"]);
  });

  it("narrows to one Clip with --clip", async () => {
    const first = await seedClip(s.standaloneActiveId, { start: 0, end: 10 });
    const second = await seedClip(s.standaloneActiveId, {
      start: 10,
      end: 20,
      after: first.id,
    });
    await addOverlay(first.id, { title: "On the first" });
    await addOverlay(second.id, { title: "On the second" });

    const rows = ndjson(
      (
        await run([
          "overlay",
          "list",
          "--video",
          s.standaloneActiveId,
          "--clip",
          second.id,
        ])
      ).stdout
    ) as OverlayRow[];

    expect(rows.map((r) => r.title)).toEqual(["On the second"]);
  });

  it("prints nothing for a Video with no Overlays", async () => {
    const { exitCode, stdout } = await run([
      "overlay",
      "list",
      "--video",
      s.standaloneActiveId,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
  });

  it("reports an unknown Video as not-found", async () => {
    const { exitCode, stderr } = await run([
      "overlay",
      "list",
      "--video",
      "no-such-video",
    ]);

    expect(exitCode).toBe(2);
    expect(tagOf(stderr)).toBe("NotFoundError");
  });
});

describe("overlay get", () => {
  it("returns one Overlay as a single object", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 10 });
    const created = await addOverlay(clip.id, { title: "Hydration" });

    const got = one<OverlayRow>(
      (await run(["overlay", "get", created.id])).stdout
    );

    expect(got).toEqual(created);
  });

  it("returns several Overlays as NDJSON", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 10 });
    const a = await addOverlay(clip.id, { at: "1", duration: "1", title: "A" });
    const b = await addOverlay(clip.id, { at: "2", duration: "1", title: "B" });

    const rows = ndjson(
      (await run(["overlay", "get", a.id, b.id])).stdout
    ) as OverlayRow[];

    expect(rows.map((r) => r.title)).toEqual(["A", "B"]);
  });

  it("emits what it found and names what it did not", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 10 });
    const a = await addOverlay(clip.id, { title: "A" });

    const { exitCode, stdout, stderr } = await run([
      "overlay",
      "get",
      a.id,
      "no-such-overlay",
    ]);

    expect((ndjson(stdout) as OverlayRow[]).map((r) => r.id)).toEqual([a.id]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("no-such-overlay");
  });

  it("reports a single unknown id as not-found", async () => {
    const { exitCode, stdout, stderr } = await run([
      "overlay",
      "get",
      "no-such-overlay",
    ]);

    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    expect(tagOf(stderr)).toBe("NotFoundError");
  });
});

describe("overlay update", () => {
  it("edits the Definition Card's words in place", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 10 });
    const created = await addOverlay(clip.id, { title: "Hydation" });

    const updated = one<OverlayRow>(
      (
        await run([
          "overlay",
          "update",
          "--title",
          "Hydration",
          "--description",
          "Attaching handlers.",
          created.id,
        ])
      ).stdout
    );

    expect(updated).toMatchObject({
      id: created.id,
      title: "Hydration",
      description: "Attaching handlers.",
      at: created.at,
      durationInSeconds: created.durationInSeconds,
    });
  });

  it("re-anchors an Overlay to a different Clip", async () => {
    const first = await seedClip(s.standaloneActiveId, { start: 0, end: 10 });
    const second = await seedClip(s.standaloneActiveId, {
      start: 10,
      end: 20,
      after: first.id,
    });
    const created = await addOverlay(first.id, { at: "8" });

    const updated = one<OverlayRow>(
      (
        await run([
          "overlay",
          "update",
          "--clip",
          second.id,
          "--at",
          "0.5",
          created.id,
        ])
      ).stdout
    );

    expect(updated).toMatchObject({ clipId: second.id, at: 0.5 });
  });

  it("refuses a re-anchor that lands past the new Clip's end", async () => {
    const first = await seedClip(s.standaloneActiveId, { start: 0, end: 10 });
    const second = await seedClip(s.standaloneActiveId, {
      start: 10,
      end: 13,
      after: first.id,
    });
    const created = await addOverlay(first.id, { at: "8" });

    const { exitCode, stderr } = await run([
      "overlay",
      "update",
      "--clip",
      second.id,
      created.id,
    ]);

    expect(exitCode).toBe(3);
    expect(tagOf(stderr)).toBe("ParseError");
  });

  it("refuses an offset past the anchor Clip's own end", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 10 });
    const created = await addOverlay(clip.id);

    const { exitCode, stderr } = await run([
      "overlay",
      "update",
      "--at",
      "10",
      created.id,
    ]);

    expect(exitCode).toBe(3);
    expect(tagOf(stderr)).toBe("ParseError");
  });

  it("refuses a re-anchor into a different Video", async () => {
    const mine = await seedClip(s.standaloneActiveId, { start: 0, end: 10 });
    const theirs = await seedClip(s.lessonVideoId, { start: 0, end: 10 });
    const created = await addOverlay(mine.id, { at: "2" });

    const { exitCode, stderr } = await run([
      "overlay",
      "update",
      "--clip",
      theirs.id,
      "--at",
      "1",
      created.id,
    ]);

    expect(exitCode).toBe(3);
    expect(tagOf(stderr)).toBe("ParseError");

    // Still where it was, and still in the Video it was listed under.
    const rows = ndjson(
      (await run(["overlay", "list", "--video", s.standaloneActiveId])).stdout
    ) as OverlayRow[];
    expect(rows.map((r) => r.clipId)).toEqual([mine.id]);
  });

  it("refuses an update that names no field", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 10 });
    const created = await addOverlay(clip.id);

    const { exitCode, stdout, stderr } = await run([
      "overlay",
      "update",
      created.id,
    ]);

    expect(exitCode).toBe(3);
    expect(stdout).toBe("");
    expect(tagOf(stderr)).toBe("ParseError");
  });

  it("refuses a negative offset", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 10 });
    const created = await addOverlay(clip.id);

    const { exitCode, stderr } = await run([
      "overlay",
      "update",
      "--at",
      "-0.5",
      created.id,
    ]);

    expect(exitCode).toBe(3);
    expect(tagOf(stderr)).toBe("ParseError");
  });

  it("reports an unknown overlay id as not-found", async () => {
    const { exitCode, stderr } = await run([
      "overlay",
      "update",
      "--at",
      "1",
      "no-such-overlay",
    ]);

    expect(exitCode).toBe(2);
    expect(tagOf(stderr)).toBe("NotFoundError");
  });

  it("reports an unknown re-anchor target as not-found", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 10 });
    const created = await addOverlay(clip.id);

    const { exitCode, stderr } = await run([
      "overlay",
      "update",
      "--clip",
      "no-such-clip",
      created.id,
    ]);

    expect(exitCode).toBe(2);
    expect(tagOf(stderr)).toBe("NotFoundError");
  });
});

describe("overlay delete", () => {
  it("removes the Overlay outright, echoing what it deleted", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 10 });
    const created = await addOverlay(clip.id, { title: "Hydration" });

    const deleted = one<OverlayRow>(
      (await run(["overlay", "delete", created.id])).stdout
    );
    expect(deleted).toEqual(created);

    const after = await run(["overlay", "get", created.id]);
    expect(after.exitCode).toBe(2);
    expect(
      ndjson(
        (await run(["overlay", "list", "--video", s.standaloneActiveId])).stdout
      )
    ).toEqual([]);
  });

  it("reports an unknown id as not-found", async () => {
    const { exitCode, stderr } = await run([
      "overlay",
      "delete",
      "no-such-overlay",
    ]);

    expect(exitCode).toBe(2);
    expect(tagOf(stderr)).toBe("NotFoundError");
  });

  it("is not undone by a second delete", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 10 });
    const created = await addOverlay(clip.id);
    await run(["overlay", "delete", created.id]);

    const { exitCode } = await run(["overlay", "delete", created.id]);

    expect(exitCode).toBe(2);
  });
});

describe("a deleted Clip takes its Overlays with it", () => {
  it("stops listing the Overlays of an archived Clip", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 10 });
    await addOverlay(clip.id);

    await run(["clip", "delete", clip.id]);

    expect(
      ndjson(
        (await run(["overlay", "list", "--video", s.standaloneActiveId])).stdout
      )
    ).toEqual([]);
  });
});
