import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  one,
  seedWrite,
  type RunResult,
  type WriteSeed,
} from "./cli-write-test-harness";

// ===========================================================================
// cvm overlay: authoring a Bullet Panel's content
//
// The same seam as cli-overlay-writes.test.ts — the whole CLI stack over a real
// PGlite — in its own file only because the three overlay suites together
// outrun the repo's per-file token budget. Read cli-overlay-writes.test.ts for
// the anchor/duration rules and cli-overlay-kind-writes.test.ts for `--kind`
// and the one-at-a-time invariant; this file covers only what `--bullets-json`
// adds on top.
// ===========================================================================

let testDb: TestDb;
let seedLayer: Layer.Layer<ClipOperationsService>;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;
let tmp: string;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  seedLayer = ClipOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as never))
  );
  run = makeRun(buildWriteLayer(testDb));
  tmp = mkdtempSync(join(tmpdir(), "cvm-bullets-"));
});

let s: WriteSeed;
let fileCount = 0;

beforeEach(async () => {
  await truncateAllTables(testDb);
  s = await seedWrite(testDb);
});

interface Bullet {
  icon: string;
  text: string;
  revealAt: number;
}

interface OverlayRow {
  id: string;
  clipId: string;
  at: number;
  durationInSeconds: number;
  kind: string;
  title: string;
  description: string;
  bullets: Bullet[] | null;
  disableEnterAnimation: boolean;
  disableExitAnimation: boolean;
}

/** Write a `--bullets-json` payload to a real file, as an author would. */
const bulletsFile = (payload: unknown): string => {
  const path = join(tmp, `bullets-${fileCount++}.json`);
  writeFileSync(path, JSON.stringify(payload), "utf8");
  return path;
};

const THREE_BULLETS: Bullet[] = [
  { icon: "target", text: "Name the problem", revealAt: 0 },
  { icon: "route", text: "Name the decisions", revealAt: 1.5 },
  { icon: "scissors", text: "Name what is out", revealAt: 3 },
];

const seedClip = (videoId: string, params: { start: number; end: number }) =>
  Effect.gen(function* () {
    const clipOps = yield* ClipOperationsService;
    const [clip] = yield* clipOps.appendClips({
      videoId,
      insertionPoint: { type: "start" },
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

/** `overlay add --kind bulletPanel`, with whatever payload the case needs. */
const addPanel = (
  clipId: string,
  payload: unknown,
  extra: ReadonlyArray<string> = [],
  duration = "10"
) =>
  run([
    "overlay",
    "add",
    "--clip",
    clipId,
    "--at",
    "1",
    "--duration",
    duration,
    "--kind",
    "bulletPanel",
    "--title",
    "What a spec answers",
    "--bullets-json",
    bulletsFile(payload),
    ...extra,
  ]);

const tagOf = (stderr: string) =>
  (JSON.parse(stderr.trim()) as { _tag: string })._tag;

/** Every refusal here is invalid input, not a missing row. */
const expectRefused = (result: RunResult) => {
  expect(result.exitCode).toBe(3);
  expect(result.stdout).toBe("");
  expect(tagOf(result.stderr)).toBe("ParseError");
};

describe("overlay add --kind bulletPanel", () => {
  it("stores the title and the bullets it was given", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 20 });

    const result = await addPanel(clip.id, THREE_BULLETS);

    expect(result.exitCode).toBe(0);
    const row = one<OverlayRow>(result.stdout);
    expect(row).toMatchObject({
      kind: "bulletPanel",
      title: "What a spec answers",
      // A Bullet Panel has no description, and the column is NOT NULL.
      description: "",
      disableEnterAnimation: false,
      disableExitAnimation: false,
    });
    expect(row.bullets).toEqual(THREE_BULLETS);
  });

  it("accepts the full four bullets, and refuses a fifth", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 20 });
    const four: Bullet[] = [
      ...THREE_BULLETS,
      { icon: "flask-conical", text: "Name the tests", revealAt: 4 },
    ];

    expect((await addPanel(clip.id, four)).exitCode).toBe(0);

    const clipTwo = await seedClip(s.lessonVideoId, { start: 0, end: 20 });
    expectRefused(
      await addPanel(clipTwo.id, [
        ...four,
        { icon: "circle-check", text: "One too many", revealAt: 5 },
      ])
    );
  });

  it("refuses a panel with no bullets at all", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 20 });

    expectRefused(await addPanel(clip.id, []));
  });

  it("refuses a bullet with no icon", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 20 });

    expectRefused(await addPanel(clip.id, [{ text: "No glyph", revealAt: 0 }]));
  });

  it("refuses an icon name lucide has never heard of", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 20 });

    const result = await addPanel(clip.id, [
      { icon: "definitely-not-an-icon", text: "Typo", revealAt: 0 },
    ]);

    expectRefused(result);
    expect(result.stderr).toContain("definitely-not-an-icon");
  });

  it("refuses a bullet with no text", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 20 });

    expectRefused(await addPanel(clip.id, [{ icon: "target", revealAt: 0 }]));
  });

  it("refuses bullets submitted out of reveal order", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 20 });

    expectRefused(
      await addPanel(clip.id, [
        { icon: "target", text: "Second spoken", revealAt: 3 },
        { icon: "route", text: "First spoken", revealAt: 1 },
      ])
    );
  });

  it("refuses a reveal time before the Overlay starts", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 20 });

    expectRefused(
      await addPanel(clip.id, [
        { icon: "target", text: "Too early", revealAt: -0.5 },
      ])
    );
  });

  it("refuses a reveal time with no room left to ease in", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 20 });

    // The Overlay is 5s long and a bullet takes 0.35s to arrive, so 4.9s
    // would still be animating in as the whole panel animates out.
    expectRefused(
      await addPanel(
        clip.id,
        [{ icon: "target", text: "Too late", revealAt: 4.9 }],
        [],
        "5"
      )
    );
    // The last frame that does fit is accepted.
    expect(
      (
        await addPanel(
          clip.id,
          [{ icon: "target", text: "Just fits", revealAt: 4.65 }],
          [],
          "5"
        )
      ).exitCode
    ).toBe(0);
  });

  it("refuses a payload that is not a JSON array of bullets", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 20 });

    expectRefused(await addPanel(clip.id, { bullets: THREE_BULLETS }));
  });

  it("refuses a --bullets-json path that cannot be read", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 20 });

    expectRefused(
      await run([
        "overlay",
        "add",
        "--clip",
        clip.id,
        "--at",
        "1",
        "--duration",
        "10",
        "--kind",
        "bulletPanel",
        "--title",
        "t",
        "--bullets-json",
        join(tmp, "no-such-file.json"),
      ])
    );
  });
});

describe("content belongs to a kind", () => {
  const addWith = (clipId: string, flags: ReadonlyArray<string>) =>
    run([
      "overlay",
      "add",
      "--clip",
      clipId,
      "--at",
      "1",
      "--duration",
      "10",
      "--title",
      "t",
      ...flags,
    ]);

  it("refuses a bulletPanel with no --bullets-json", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 20 });

    expectRefused(await addWith(clip.id, ["--kind", "bulletPanel"]));
  });

  it("refuses a bulletPanel carrying a Definition Card's --description", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 20 });

    expectRefused(
      await addWith(clip.id, [
        "--kind",
        "bulletPanel",
        "--bullets-json",
        bulletsFile(THREE_BULLETS),
        "--description",
        "not a panel's content",
      ])
    );
  });

  it("refuses a definitionCard carrying --bullets-json", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 20 });

    expectRefused(
      await addWith(clip.id, [
        "--description",
        "d",
        "--bullets-json",
        bulletsFile(THREE_BULLETS),
      ])
    );
  });

  it("still requires --description for a Definition Card", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 20 });

    expectRefused(await addWith(clip.id, []));
  });
});

describe("the animation toggles", () => {
  it("are set on add and left alone by an unrelated update", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 20 });

    const created = one<OverlayRow>(
      (
        await addPanel(clip.id, THREE_BULLETS, [
          "--disable-enter-animation",
          "true",
          "--disable-exit-animation",
          "true",
        ])
      ).stdout
    );
    expect(created).toMatchObject({
      disableEnterAnimation: true,
      disableExitAnimation: true,
    });

    const updated = one<OverlayRow>(
      (await run(["overlay", "update", "--title", "New", created.id])).stdout
    );

    expect(updated).toMatchObject({
      title: "New",
      disableEnterAnimation: true,
      disableExitAnimation: true,
    });
  });

  it("are turned back off by naming them false", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 20 });
    const created = one<OverlayRow>(
      (
        await addPanel(clip.id, THREE_BULLETS, [
          "--disable-enter-animation",
          "true",
        ])
      ).stdout
    );

    const updated = one<OverlayRow>(
      (
        await run([
          "overlay",
          "update",
          "--disable-enter-animation",
          "false",
          created.id,
        ])
      ).stdout
    );

    expect(updated.disableEnterAnimation).toBe(false);
  });
});

describe("overlay update --bullets-json", () => {
  const seedPanel = async (duration = "10") => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 20 });
    const result = await addPanel(clip.id, THREE_BULLETS, [], duration);
    expect(result.exitCode).toBe(0);
    return one<OverlayRow>(result.stdout);
  };

  it("replaces the bullets outright", async () => {
    const created = await seedPanel();
    const replacement: Bullet[] = [
      { icon: "circle-check", text: "Only one now", revealAt: 2 },
    ];

    const updated = one<OverlayRow>(
      (
        await run([
          "overlay",
          "update",
          "--bullets-json",
          bulletsFile(replacement),
          created.id,
        ])
      ).stdout
    );

    expect(updated.bullets).toEqual(replacement);
  });

  it("validates the new bullets against the NEW duration", async () => {
    const created = await seedPanel();

    // 3s fits a 10s Overlay but not the 2s one this same command asks for.
    expectRefused(
      await run([
        "overlay",
        "update",
        "--duration",
        "2",
        "--bullets-json",
        bulletsFile([{ icon: "target", text: "Late", revealAt: 3 }]),
        created.id,
      ])
    );
  });

  it("refuses --bullets-json on an Overlay that is a Definition Card", async () => {
    const clip = await seedClip(s.standaloneActiveId, { start: 0, end: 20 });
    const card = one<OverlayRow>(
      (
        await run([
          "overlay",
          "add",
          "--clip",
          clip.id,
          "--at",
          "1",
          "--duration",
          "10",
          "--title",
          "t",
          "--description",
          "d",
        ])
      ).stdout
    );

    expectRefused(
      await run([
        "overlay",
        "update",
        "--bullets-json",
        bulletsFile(THREE_BULLETS),
        card.id,
      ])
    );
  });

  it("drops the bullets when the Overlay stops being a Bullet Panel", async () => {
    const created = await seedPanel();

    const updated = one<OverlayRow>(
      (
        await run([
          "overlay",
          "update",
          "--kind",
          "definitionCard",
          "--description",
          "A definition now.",
          created.id,
        ])
      ).stdout
    );

    expect(updated.kind).toBe("definitionCard");
    expect(updated.bullets).toBeNull();
  });
});
