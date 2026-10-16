import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Effect, Layer } from "effect";
import nodeFs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import * as schema from "@/db/schema";
import { buildProgram } from "@/cli/main";
import { makeTestCliOutput } from "@/cli/output";
import { FrameCaptureService } from "@/services/frame-capture-service";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/test-db";
import { LOCAL_MACHINE_ENV_KEY } from "./env";
import {
  buildWriteLayer,
  makeTempClipMockupDir,
  ndjson,
  seedWrite,
  type RunResult,
} from "./cli-write-test-harness";
import {
  addArgv,
  updateArgv,
  voiceQueueLayer,
} from "./cli-clip-mockup-test-harness";

// ===========================================================================
// cvm clip-mockup on a SHORT: the composed 1080x1920 frame, and the order
// rule — one Camera moment first, then Code.
//
// The capture is faked as in cli-clip-mockup-html-capture.test.ts (no
// Chromium ever launches), but this fake also KEEPS the page it was asked to
// capture, so a test can read what CVM composed around the agent's page.
// ===========================================================================

let capture: Array<{
  htmlPath: string;
  html: string;
  viewport: { width: number; height: number };
}> = [];

const fakeFrameCapture = Layer.succeed(FrameCaptureService, {
  captureHtmlToPng: (params: {
    readonly htmlPath: string;
    readonly outputPath: string;
    readonly viewport: { width: number; height: number };
  }) =>
    Effect.sync(() => {
      capture.push({
        htmlPath: params.htmlPath,
        html: nodeFs.readFileSync(params.htmlPath, "utf8"),
        viewport: params.viewport,
      });
      nodeFs.writeFileSync(params.outputPath, "CAPTURED-PNG");
      return params.outputPath;
    }),
} as unknown as FrameCaptureService);

let testDb: TestDb;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;
let frames: ReturnType<typeof makeTempClipMockupDir>;
let sourceDir: string;
let short: { id: string; lineageId: string };
let landscape: { id: string; lineageId: string };
const originalLocalMachine = process.env[LOCAL_MACHINE_ENV_KEY];

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
  const layer = Layer.mergeAll(
    buildWriteLayer(testDb),
    fakeFrameCapture,
    voiceQueueLayer(testDb)
  );
  run = async (argv) => {
    const out = makeTestCliOutput();
    const exitCode = await Effect.runPromise(
      buildProgram(argv).pipe(Effect.provide(out.layer), Effect.provide(layer))
    );
    return { stdout: out.stdout(), stderr: out.stderr(), exitCode };
  };
  frames = makeTempClipMockupDir();
  sourceDir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "cvm-short-src-"));
  process.env[LOCAL_MACHINE_ENV_KEY] = "true";
});

afterAll(() => {
  frames.cleanup();
  nodeFs.rmSync(sourceDir, { recursive: true, force: true });
  if (originalLocalMachine === undefined) {
    delete process.env[LOCAL_MACHINE_ENV_KEY];
  } else {
    process.env[LOCAL_MACHINE_ENV_KEY] = originalLocalMachine;
  }
});

const video = async (format: string) => {
  const [v] = await testDb
    .insert(schema.videos)
    .values({ title: `${format}.mp4`, originalFootagePath: "f.mp4", format })
    .returning();
  return { id: v!.id, lineageId: v!.lineageId };
};

beforeEach(async () => {
  await truncateAllTables(testDb);
  await seedWrite(testDb);
  short = await video("short");
  landscape = await video("landscape");
  nodeFs.rmSync(frames.dir, { recursive: true, force: true });
  nodeFs.mkdirSync(frames.dir, { recursive: true });
  capture = [];
});

interface Mockup {
  id: string;
  line: string;
  imagePath: string;
}

const page = (name: string) => {
  const full = nodePath.join(sourceDir, name);
  nodeFs.writeFileSync(full, `<html><body>${name}</body></html>`);
  return full;
};

const failureOf = (r: RunResult) =>
  JSON.parse(r.stderr.trim()) as { _tag: string; message: string };

const list = async (videoId: string) =>
  ndjson(
    (await run(["clip-mockup", "list", "--video", videoId])).stdout
  ) as Mockup[];

/** A Short with its Camera moment and two Code moments. */
const seedShort = async () => {
  const r = await run(
    addArgv(short.id, [
      { say: "Here's a thing about TypeScript.", scene: "camera" },
      { say: "Look at this type.", scene: "code", html: page("a.html") },
      { say: "And this one.", scene: "code", html: page("b.html") },
    ])
  );
  expect(r.exitCode, r.stderr).toBe(0);
  return ndjson(r.stdout) as Mockup[];
};

describe("cvm clip-mockup on a Short", () => {
  it("composes every frame at 1080x1920: a drawn Camera, and the agent's page in the Code square", async () => {
    await seedShort();

    expect(capture.map((c) => c.viewport)).toEqual([
      { width: 1080, height: 1920 },
      { width: 1080, height: 1920 },
      { width: 1080, height: 1920 },
    ]);
    const [camera, codeA] = capture;
    // The Camera frame is CVM's own: no agent page, an advert's place.
    expect(camera!.html).toContain('data-short-scene="camera"');
    expect(camera!.html).toContain("advert");
    // The Code frame draws the agent's page in the 1080x1080 screen square
    // the Short layout puts at the top, with the 1080x840 camera band below.
    expect(codeA!.html).toContain('data-short-scene="code"');
    expect(codeA!.html).toContain(`src="file://${page("a.html")}"`);
    expect(codeA!.html).toContain(
      "left:0px;top:0px;width:1080px;height:1080px;"
    );
    expect(codeA!.html).toContain(
      "left:0px;top:1080px;width:1080px;height:840px;"
    );
    expect(await list(short.id)).toHaveLength(3);
  });

  it("add refuses a Short that would not open with one Camera moment, writing nothing", async () => {
    const cases = [
      {
        entries: [{ say: "Code first.", scene: "code", html: page("x.html") }],
        message: 'must be "scene": "camera"',
      },
      {
        entries: [{ say: "No scene.", html: page("x.html") }],
        message: 'needs "scene" on a Short',
      },
      {
        entries: [
          { say: "Hi.", scene: "camera" },
          { say: "Hi again.", scene: "camera" },
        ],
        message: 'must be "scene": "code"',
      },
      {
        entries: [{ say: "Hi.", scene: "camera", html: page("x.html") }],
        message: "which CVM draws",
      },
    ];
    for (const { entries, message } of cases) {
      const r = await run(addArgv(short.id, entries));
      expect(r.exitCode, message).toBe(3);
      expect(failureOf(r).message, message).toContain(message);
    }
    expect(capture).toEqual([]);
    expect(await list(short.id)).toEqual([]);
  });

  it("a later add to a Short is Code only, and a Landscape Video takes no scene", async () => {
    await seedShort();

    const again = await run(
      addArgv(short.id, [{ say: "Hello again.", scene: "camera" }])
    );
    expect(again.exitCode).toBe(3);
    expect(failureOf(again).message).toContain(
      "would be Clip Mockup 4 of this Short"
    );

    const onLandscape = await run(
      addArgv(landscape.id, [
        { say: "A line.", scene: "code", html: page("l.html") },
      ])
    );
    expect(onLandscape.exitCode).toBe(3);
    expect(failureOf(onLandscape).message).toContain("this Video is Landscape");
  });

  it("move and delete keep the Camera moment first", async () => {
    const [camera, codeA, codeB] = await seedShort();

    const before = await run([
      "clip-mockup",
      "move",
      "--before",
      camera!.id,
      codeB!.id,
    ]);
    expect(before.exitCode).toBe(3);
    expect(failureOf(before).message).toContain(
      "before this Short's Camera moment"
    );

    const cameraAway = await run(["clip-mockup", "move", camera!.id]);
    expect(cameraAway.exitCode).toBe(3);

    const del = await run(["clip-mockup", "delete", camera!.id]);
    expect(del.exitCode).toBe(3);
    expect(failureOf(del).message).toContain("Camera moment");

    // Code moments reorder among themselves freely.
    const swap = await run([
      "clip-mockup",
      "move",
      "--before",
      codeA!.id,
      codeB!.id,
    ]);
    expect(swap.exitCode, swap.stderr).toBe(0);
    expect((await list(short.id)).map((m) => m.id)).toEqual([
      camera!.id,
      codeB!.id,
      codeA!.id,
    ]);
  });

  it("update redraws a Code frame in the Short layout, and refuses a picture for the Camera", async () => {
    await seedShort();
    capture = [];

    const code = await run(
      updateArgv([{ video: short.id, at: 2, html: page("a2.html") }])
    );
    expect(code.exitCode, code.stderr).toBe(0);
    expect(capture.map((c) => c.viewport)).toEqual([
      { width: 1080, height: 1920 },
    ]);
    expect(capture[0]!.html).toContain('data-short-scene="code"');

    const camera = await run(
      updateArgv([{ video: short.id, at: 1, html: page("c.html") }])
    );
    expect(camera.exitCode).toBe(3);
    expect(failureOf(camera).message).toContain("its Camera moment");
  });
});
