import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Effect, Layer } from "effect";
import nodeFs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { buildProgram } from "@/cli/main";
import { makeTestCliOutput } from "@/cli/output";
import {
  FRAME_HEIGHT,
  FRAME_WIDTH,
  FrameCaptureError,
  FrameCaptureService,
} from "@/services/frame-capture-service";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import { LOCAL_MACHINE_ENV_KEY } from "./env";
import {
  buildWriteLayer,
  makeTempClipMockupDir,
  ndjson,
  one,
  seedWrite,
  type RunResult,
  type WriteSeed,
} from "./cli-write-test-harness";

// ===========================================================================
// cvm clip-mockup add/update --html: capture a frame from an HTML page
//
// The capture is the ONE thing in this feature that cannot run in a test: it
// drives a real headless browser. So FrameCaptureService is faked with
// Layer.succeed the way cli-footage-writes.test.ts fakes VideoProcessingService
// — the command branches on Effect.serviceOption, finds the fake and uses it,
// and NO CHROMIUM EVER LAUNCHES HERE. The fake writes canned bytes at exactly
// the path it was asked for, which is all the rest of the verb needs to be
// real: the copy into {CLIP_MOCKUP_DIR}/{lineageId}/, the row write, the
// ordering and the failure paths are the shipping code.
//
// Its own file rather than an addition to cli-clip-mockup-writes.test.ts
// because only this suite needs the fake layer — and because that file is
// already close to the repo's per-file token budget.
// ===========================================================================

/** What the fake does on its next call. Reset in beforeEach. */
let capture: {
  mode: "succeed" | "fail";
  bytes: string;
  calls: Array<{ htmlPath: string; outputPath: string }>;
} = { mode: "succeed", bytes: "CAPTURED-PNG", calls: [] };

const fakeFrameCapture = Layer.succeed(FrameCaptureService, {
  captureHtmlToPng: (params: {
    readonly htmlPath: string;
    readonly outputPath: string;
  }) =>
    Effect.suspend(() => {
      capture.calls.push(params);
      if (capture.mode === "fail") {
        return Effect.fail(
          new FrameCaptureError({
            htmlPath: params.htmlPath,
            cause: null,
            message: "the page would not render",
          })
        );
      }
      nodeFs.writeFileSync(params.outputPath, capture.bytes);
      return Effect.succeed(params.outputPath);
    }),
} as unknown as FrameCaptureService);

let testDb: TestDb;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;
let s: WriteSeed;
let frames: ReturnType<typeof makeTempClipMockupDir>;
let sourceDir: string;
const originalLocalMachine = process.env[LOCAL_MACHINE_ENV_KEY];

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  const layer = Layer.merge(buildWriteLayer(testDb), fakeFrameCapture);
  run = async (argv) => {
    const out = makeTestCliOutput();
    const exitCode = await Effect.runPromise(
      buildProgram(argv).pipe(Effect.provide(out.layer), Effect.provide(layer))
    );
    return { stdout: out.stdout(), stderr: out.stderr(), exitCode };
  };
  frames = makeTempClipMockupDir();
  sourceDir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "cvm-frame-html-"));
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

beforeEach(async () => {
  await truncateAllTables(testDb);
  s = await seedWrite(testDb);
  nodeFs.rmSync(frames.dir, { recursive: true, force: true });
  nodeFs.mkdirSync(frames.dir, { recursive: true });
  capture = { mode: "succeed", bytes: "CAPTURED-PNG", calls: [] };
});

describe("cvm clip-mockup --html", () => {
  interface Mockup {
    id: string;
    videoId: string;
    line: string;
    imagePath: string;
    durationSeconds: number | null;
    order: string;
    archived: boolean;
    createdAt: string;
  }

  const obj = (stdout: string): Mockup => one<Mockup>(stdout);

  const failureOf = (result: RunResult) =>
    JSON.parse(result.stderr.trim()) as { _tag: string; message: string };

  /** Write an HTML page for the capture to be pointed at, returning its path. */
  const sourceHtml = (name: string): string => {
    const full = nodePath.join(sourceDir, name);
    nodeFs.writeFileSync(full, "<html><body>a moment</body></html>");
    return full;
  };

  const sourceImage = (name: string): string => {
    const full = nodePath.join(sourceDir, name);
    nodeFs.writeFileSync(full, "PNG-BYTES");
    return full;
  };

  const frameDir = (lineageId: string) => nodePath.join(frames.dir, lineageId);

  const list = async (videoId: string): Promise<Mockup[]> =>
    ndjson(
      (await run(["clip-mockup", "list", "--video", videoId])).stdout
    ) as Mockup[];

  // -----------------------------------------------------------------------
  // add --html
  // -----------------------------------------------------------------------

  it("add --html captures the page and creates the Clip Mockup in one call", async () => {
    const html = sourceHtml("moment-01.html");
    const { stdout, stderr, exitCode } = await run([
      "clip-mockup",
      "add",
      "--video",
      s.standaloneActiveId,
      "--html",
      html,
      "--say",
      "Here's the problem.",
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");

    const row = obj(stdout);
    expect(row.videoId).toBe(s.standaloneActiveId);
    expect(row.line).toBe("Here's the problem.");

    // The page it was asked to capture is the page we passed.
    expect(capture.calls.map((c) => c.htmlPath)).toEqual([html]);

    // The captured PNG lands in the Video's frame directory exactly the way a
    // supplied PNG does: a fresh .png name, stored RELATIVE to the store.
    expect(nodePath.isAbsolute(row.imagePath)).toBe(false);
    expect(row.imagePath.endsWith(".png")).toBe(true);
    const dir = frameDir(s.standaloneActiveLineageId);
    expect(nodeFs.readdirSync(dir)).toEqual([row.imagePath]);
    expect(nodeFs.readFileSync(nodePath.join(dir, row.imagePath), "utf8")).toBe(
      "CAPTURED-PNG"
    );
  });

  it("add --html leaves no scratch file behind once the frame is stored", async () => {
    await run([
      "clip-mockup",
      "add",
      "--video",
      s.standaloneActiveId,
      "--html",
      sourceHtml("moment-02.html"),
      "--say",
      "One line.",
    ]);

    // The capture writes into a SCOPED temp directory; the only lasting copy
    // is the one inside the Clip Mockup store.
    const scratch = capture.calls[0]!.outputPath;
    expect(nodeFs.existsSync(scratch)).toBe(false);
    expect(nodeFs.existsSync(nodePath.dirname(scratch))).toBe(false);
  });

  it("captures at exactly 1920x1080", () => {
    expect([FRAME_WIDTH, FRAME_HEIGHT]).toEqual([1920, 1080]);
  });

  // -----------------------------------------------------------------------
  // The mutually-exclusive rule
  // -----------------------------------------------------------------------

  it("add with BOTH --html and --image is invalid input, exit 3, and writes nothing", async () => {
    const r = await run([
      "clip-mockup",
      "add",
      "--video",
      s.standaloneActiveId,
      "--html",
      sourceHtml("both.html"),
      "--image",
      sourceImage("both.png"),
      "--say",
      "Two pictures.",
    ]);

    expect(r.exitCode).toBe(3);
    expect(r.stdout).toBe("");
    expect(failureOf(r)._tag).toBe("ParseError");
    // Rejected before anything was captured or written.
    expect(capture.calls).toEqual([]);
    expect(nodeFs.existsSync(frameDir(s.standaloneActiveLineageId))).toBe(
      false
    );
    expect(await list(s.standaloneActiveId)).toEqual([]);
  });

  it("add with NEITHER --html nor --image is invalid input, exit 3", async () => {
    const r = await run([
      "clip-mockup",
      "add",
      "--video",
      s.standaloneActiveId,
      "--say",
      "A moment with no picture.",
    ]);

    expect(r.exitCode).toBe(3);
    expect(failureOf(r).message).toContain("--html");
    expect(capture.calls).toEqual([]);
    expect(await list(s.standaloneActiveId)).toEqual([]);
  });

  it("update with BOTH --html and --image is invalid input, exit 3, and changes nothing", async () => {
    const created = obj(
      (
        await run([
          "clip-mockup",
          "add",
          "--video",
          s.standaloneActiveId,
          "--html",
          sourceHtml("before.html"),
          "--say",
          "Before.",
        ])
      ).stdout
    );
    capture.calls = [];

    const r = await run([
      "clip-mockup",
      "update",
      "--html",
      sourceHtml("after.html"),
      "--image",
      sourceImage("after.png"),
      created.id,
    ]);

    expect(r.exitCode).toBe(3);
    expect(failureOf(r)._tag).toBe("ParseError");
    expect(capture.calls).toEqual([]);
    const rows = await list(s.standaloneActiveId);
    expect(rows[0]!.imagePath).toBe(created.imagePath);
  });

  // -----------------------------------------------------------------------
  // The capture failure path
  // -----------------------------------------------------------------------

  it("a page that cannot be captured is a NAMED error, and leaves no row and no file", async () => {
    capture.mode = "fail";

    const r = await run([
      "clip-mockup",
      "add",
      "--video",
      s.standaloneActiveId,
      "--html",
      sourceHtml("broken.html"),
      "--say",
      "This one will not render.",
    ]);

    // Named, not a blank frame: an agent can read this and fix its HTML.
    const failure = failureOf(r);
    expect(failure._tag).toBe("FrameCaptureError");
    expect(failure.message).toContain("would not render");
    expect(r.exitCode).toBe(4);
    expect(r.stdout).toBe("");

    // No row...
    expect(await list(s.standaloneActiveId)).toEqual([]);
    // ...and no orphan file, in the store or in the scratch directory.
    expect(nodeFs.existsSync(frameDir(s.standaloneActiveLineageId))).toBe(
      false
    );
    const scratch = capture.calls[0]!.outputPath;
    expect(nodeFs.existsSync(nodePath.dirname(scratch))).toBe(false);
  });

  it("a capture that writes no PNG is a FrameCaptureError, not an empty frame", async () => {
    // The service "succeeded" but produced nothing. The verb refuses rather
    // than storing a zero-byte picture.
    capture.mode = "succeed";
    const broken = Layer.succeed(FrameCaptureService, {
      captureHtmlToPng: (p: {
        readonly htmlPath: string;
        readonly outputPath: string;
      }) =>
        Effect.sync(() => {
          capture.calls.push(p);
          return p.outputPath;
        }),
    } as unknown as FrameCaptureService);

    const out = makeTestCliOutput();
    const exitCode = await Effect.runPromise(
      buildProgram([
        "clip-mockup",
        "add",
        "--video",
        s.standaloneActiveId,
        "--html",
        sourceHtml("silent.html"),
        "--say",
        "Nothing came out.",
      ]).pipe(
        Effect.provide(out.layer),
        Effect.provide(Layer.merge(buildWriteLayer(testDb), broken))
      )
    );

    expect(exitCode).toBe(4);
    expect(JSON.parse(out.stderr().trim())._tag).toBe("FrameCaptureError");
    expect(await list(s.standaloneActiveId)).toEqual([]);
  });

  it("add --html with a path that is not there is invalid input, and never captures", async () => {
    const r = await run([
      "clip-mockup",
      "add",
      "--video",
      s.standaloneActiveId,
      "--html",
      nodePath.join(sourceDir, "does-not-exist.html"),
      "--say",
      "Missing page.",
    ]);

    expect(r.exitCode).toBe(3);
    expect(failureOf(r)._tag).toBe("ParseError");
    expect(capture.calls).toEqual([]);
    expect(await list(s.standaloneActiveId)).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // update --html
  // -----------------------------------------------------------------------

  it("update --html re-captures the page and repoints the row, leaving the line alone", async () => {
    const created = obj(
      (
        await run([
          "clip-mockup",
          "add",
          "--video",
          s.standaloneActiveId,
          "--html",
          sourceHtml("v1.html"),
          "--say",
          "Number 14.",
        ])
      ).stdout
    );

    capture.bytes = "RECAPTURED-PNG";
    const r = await run([
      "clip-mockup",
      "update",
      "--html",
      sourceHtml("v2.html"),
      created.id,
    ]);

    expect(r.exitCode).toBe(0);
    const updated = obj(r.stdout);
    expect(updated.imagePath).not.toBe(created.imagePath);
    expect(updated.line).toBe("Number 14.");
    expect(updated.durationSeconds).toBeNull();

    const dir = frameDir(s.standaloneActiveLineageId);
    expect(
      nodeFs.readFileSync(nodePath.join(dir, updated.imagePath), "utf8")
    ).toBe("RECAPTURED-PNG");
    // The old frame is left on disk — the row is the state.
    expect(nodeFs.existsSync(nodePath.join(dir, created.imagePath))).toBe(true);
  });

  it("update takes --html and --say at once", async () => {
    const created = obj(
      (
        await run([
          "clip-mockup",
          "add",
          "--video",
          s.standaloneActiveId,
          "--html",
          sourceHtml("both-v1.html"),
          "--say",
          "Too dense.",
        ])
      ).stdout
    );

    const updated = obj(
      (
        await run([
          "clip-mockup",
          "update",
          "--html",
          sourceHtml("both-v2.html"),
          "--say",
          "Shorter.",
          created.id,
        ])
      ).stdout
    );

    expect(updated.line).toBe("Shorter.");
    expect(updated.imagePath).not.toBe(created.imagePath);
  });
});
