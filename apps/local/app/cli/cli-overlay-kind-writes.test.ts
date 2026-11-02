import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/test-db";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import * as schema from "@/db/schema";
import { buildProgram } from "@/cli/main";
import { makeTestCliOutput } from "@/cli/output";
import { FootageProbe } from "@/services/footage-probe";
import { LOCAL_MACHINE_ENV_KEY } from "./env";
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
  bulletsPath = join(mkdtempSync(join(tmpdir(), "cvm-kind-")), "bullets.json");
  writeFileSync(
    bulletsPath,
    JSON.stringify([{ icon: "target", text: "A point", revealAt: 0 }]),
    "utf8"
  );
});

/**
 * A Bullet Panel's content, on disk. Every kind here is one of exactly two, and
 * each brings its own required content flag — see
 * cli-overlay-bullet-panel-writes.test.ts for what makes a payload valid.
 */
let bulletsPath: string;

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
    // Each kind carries its own content, and passing the other kind's is
    // refused — so the helper supplies whichever one this kind requires.
    ...(overrides.kind === "bulletPanel"
      ? ["--bullets-json", bulletsPath]
      : [
          "--description",
          overrides.description ?? "Attaching handlers to server HTML.",
        ]),
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

    // A change of kind brings the new kind's content in with it.
    const updated = one<OverlayRow>(
      (
        await run([
          "overlay",
          "update",
          "--kind",
          "bulletPanel",
          "--bullets-json",
          bulletsPath,
          created.id,
        ])
      ).stdout
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

// ===========================================================================
// B-roll: an Imported Footage file's picture over the whole frame. It reads
// the file, so these run as the author's machine, over a temp Storage Root,
// with ffprobe faked: every file is 20s long.
// ===========================================================================

describe("a B-roll", () => {
  let root: string;
  let runLocal: (argv: ReadonlyArray<string>) => Promise<RunResult>;

  beforeAll(() => {
    const layer = Layer.mergeAll(
      buildWriteLayer(testDb),
      Layer.succeed(FootageProbe, {
        probe: () => Effect.succeed({ video: null, durationSeconds: 20 }),
      })
    );
    runLocal = async (argv) => {
      const out = makeTestCliOutput();
      const exitCode = await Effect.runPromise(
        buildProgram(argv).pipe(
          Effect.provide(out.layer),
          Effect.provide(layer)
        )
      );
      return { stdout: out.stdout(), stderr: out.stderr(), exitCode };
    };
  });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "cvm-broll-"));
    mkdirSync(join(root, "raw-footage/imported"), { recursive: true });
    writeFileSync(join(root, "raw-footage/imported/city.mp4"), "x");
    writeFileSync(join(root, "raw-footage/imported/park.mp4"), "x");
    writeFileSync(join(root, "raw-footage/take.mp4"), "x");
    process.env.STORAGE_ROOTS = root;
    process.env[LOCAL_MACHINE_ENV_KEY] = "true";
    return () => {
      delete process.env.STORAGE_ROOTS;
      delete process.env[LOCAL_MACHINE_ENV_KEY];
    };
  });

  const addBRoll = async (
    clipId: string,
    extra: string[] = [],
    { footage = "raw-footage/imported/city.mp4", from = "10" } = {}
  ) =>
    runLocal([
      "overlay",
      "add",
      "--clip",
      clipId,
      "--at",
      "2",
      "--duration",
      "5",
      "--kind",
      "bRoll",
      "--footage",
      footage,
      "--from",
      from,
      ...extra,
    ]);

  it("is added with its Footage and from, and echoed by get and list", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 10 });

    const created = one<OverlayRow>((await addBRoll(clip.id)).stdout);

    const expected = {
      kind: "bRoll",
      title: "",
      description: "",
      footagePath: "raw-footage/imported/city.mp4",
      footageStart: 10,
    };
    expect(created).toMatchObject(expected);
    expect(
      one((await run(["overlay", "get", created.id])).stdout)
    ).toMatchObject(expected);
    expect(
      ndjson(
        (await run(["overlay", "list", "--video", s.standaloneActiveId])).stdout
      )
    ).toMatchObject([expected]);
  });

  it("can change its Footage and from with update", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 10 });
    const created = one<OverlayRow>((await addBRoll(clip.id)).stdout);

    const result = await runLocal([
      "overlay",
      "update",
      "--footage",
      join(root, "raw-footage/imported/park.mp4"),
      "--from",
      "1",
      created.id,
    ]);

    expect(result.exitCode).toBe(0);
    expect(one(result.stdout)).toMatchObject({
      footagePath: "raw-footage/imported/park.mp4",
      footageStart: 1,
    });
  });

  it.each<[string, string[], { footage?: string; from?: string }]>([
    ["a title", ["--title", "t"], {}],
    ["a description", ["--description", "d"], {}],
    ["bullets", ["--bullets-json", "-"], {}],
    ["an Animation Toggle", ["--disable-enter-animation", "true"], {}],
    [
      "Footage that is not Imported Footage",
      [],
      { footage: "raw-footage/take.mp4" },
    ],
    [
      "Footage that is not found",
      [],
      { footage: "raw-footage/imported/gone.mp4" },
    ],
    ["a from below 0", [], { from: "-1" }],
    ["a window past the end of the file", [], { from: "16" }],
  ])("is refused with %s", async (_, extra, flags) => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 10 });

    const { exitCode, stdout, stderr } = await addBRoll(clip.id, extra, flags);

    expect(exitCode).toBe(3);
    expect(stdout).toBe("");
    expect(tagOf(stderr)).toBe("ParseError");
  });

  it("is refused on a Short", async () => {
    const [short] = await testDb
      .insert(schema.videos)
      .values({ title: "short", originalFootagePath: "", format: "short" })
      .returning();
    const clip = await seedClip(short!.id, { start: 0, end: 10 });

    const { exitCode, stderr } = await addBRoll(clip.id);

    expect(exitCode).toBe(3);
    expect(stderr).toContain("is a Short");
  });

  it("lends its --footage and --from to no other kind", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 10 });

    const { exitCode, stderr } = await runLocal([
      "overlay",
      "add",
      "--clip",
      clip.id,
      "--at",
      "2",
      "--duration",
      "5",
      "--title",
      "t",
      "--description",
      "d",
      "--from",
      "3",
    ]);

    expect(exitCode).toBe(3);
    expect(stderr).toContain("--footage and --from are B-roll content");
  });
});
